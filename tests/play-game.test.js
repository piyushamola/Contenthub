'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const createPlayService = require('../src/api/play-game/services/play-game');

function createHarness() {
  const games = [];
  const users = [
    { id: 101, username: 'creator', displayName: 'Sam Creator', email: 'creator@example.test' },
    { id: 202, username: 'player1', displayName: 'Aanya Player', email: 'aanya@example.test' },
    { id: 303, username: 'player2', displayName: 'Rohan Player', email: 'rohan@example.test' },
  ];
  let nextId = 1;

  const strapi = {
    db: {
      transaction: async (cb) => cb(),
      query: (uid) => {
        if (uid === 'plugin::users-permissions.user') {
          return {
            findOne: async ({ where }) => users.find((u) => u.id === where.id) || null,
          };
        }
        assert.equal(uid, 'api::play-game.play-game');
        return {
          create: async ({ data }) => {
            const row = {
              id: nextId++,
              ...structuredClone(data),
              owner: users.find((u) => u.id === data.owner) || { id: data.owner },
              createdAt: new Date().toISOString(),
            };
            games.push(row);
            return structuredClone(row);
          },
          findOne: async ({ where }) => {
            const found = games.find((g) => g.slug === where.slug);
            return found ? structuredClone(found) : null;
          },
          findMany: async () => structuredClone(games),
          updateMany: async ({ where, data }) => {
            const matched = games.filter((g) => g.id === where.id);
            for (const row of matched) Object.assign(row, structuredClone(data));
            return { count: matched.length };
          },
          delete: async ({ where }) => {
            const idx = games.findIndex((g) => g.id === where.id);
            if (idx >= 0) games.splice(idx, 1);
            return { count: idx >= 0 ? 1 : 0 };
          },
        };
      },
    },
  };

  return { service: createPlayService({ strapi }), games };
}

test('creates, plays, scores, and tracks all 3 Play Together game types (memory-quiz, birthday-wheel, most-likely-to) with creator and player history', async () => {
  const { service } = createHarness();

  // 1. Photo Memory Quiz (3 to 5 questions, each with photoUrl, prompt, 4 options, and correctIndex)
  const memoryQuiz = await service.createGame({
    ownerId: 101,
    gameType: 'memory-quiz',
    recipientName: 'Aanya',
    creatorName: 'Sam',
    title: 'How well do you remember our moments?',
    config: {
      questions: [
        {
          photoUrl: '/images/celebration-samples/friend-1.webp',
          prompt: 'Where was this photo taken?',
          options: ['Goa Beach', 'Manali Hills', 'Mumbai Cafe', 'Jaipur Fort'],
          correctIndex: 1,
        },
        {
          photoUrl: '/images/celebration-samples/friend-2.webp',
          prompt: 'What happened right after this picture?',
          options: ['It started pouring rain', 'We dropped the cake', 'We missed our cab', 'We met a celebrity'],
          correctIndex: 1,
        },
        {
          photoUrl: '/images/celebration-samples/friend-3.webp',
          prompt: 'Who took this photo for us?',
          options: ['A random stranger', 'Rohan', 'The waiter', 'Self-timer on a rock'],
          correctIndex: 3,
        },
      ],
    },
  });
  assert.match(memoryQuiz.slug, /^memory-quiz-aanya-/);

  // Unplayed player read hides correctIndex
  const unplayedRead = await service.readGame(memoryQuiz.slug, { userId: 202 });
  assert.equal(unplayedRead.isCreator, false);
  assert.equal(unplayedRead.myPlay, null);
  assert.equal(unplayedRead.config.questions[0].correctIndex, undefined);
  assert.equal(unplayedRead.config.questions[0].options.length, 4);

  // Player 202 plays and gets 2/3
  const submitted = await service.submitPlay(memoryQuiz.slug, {
    userId: 202,
    playerName: 'Aanya',
    answers: [1, 1, 0],
  });
  assert.equal(submitted.myPlay.score, 2);
  assert.equal(submitted.myPlay.maxScore, 3);
  assert.match(submitted.myPlay.summary, /Scored 2\/3/);
  assert.equal(submitted.playCount, 1);

  // Returning player 202 sees their saved score
  const returningRead = await service.readGame(memoryQuiz.slug, { userId: 202 });
  assert.equal(returningRead.myPlay.score, 2);
  assert.equal(returningRead.plays.length, 0, 'Non-creator does not see other players list');

  // Creator 101 sees all players and scores
  const creatorRead = await service.readGame(memoryQuiz.slug, { userId: 101 });
  assert.equal(creatorRead.isCreator, true);
  assert.equal(creatorRead.playCount, 1);
  assert.equal(creatorRead.plays[0].playerName, 'Aanya');
  assert.equal(creatorRead.plays[0].score, 2);

  // 2. Spin the Birthday Wheel
  const wheel = await service.createGame({
    ownerId: 101,
    gameType: 'birthday-wheel',
    recipientName: 'Aanya',
    creatorName: 'Sam',
    config: {
      slices: [
        { emoji: '🍝', label: 'Dinner on me' },
        { emoji: '🎬', label: 'Movie night' },
        { emoji: '☕', label: 'Coffee treat' },
        { emoji: '🍦', label: 'Ice cream run' },
      ],
    },
  });
  const wheelPlay = await service.submitPlay(wheel.slug, {
    userId: 202,
    playerName: 'Aanya',
    sliceIndex: 0,
  });
  assert.equal(wheelPlay.myPlay.summary, 'Won: 🍝 Dinner on me');

  // 3. Most Likely To / Vibe Match
  const vibe = await service.createGame({
    ownerId: 101,
    gameType: 'most-likely-to',
    recipientName: 'Aanya',
    creatorName: 'Sam',
    config: {
      questions: [
        { prompt: 'Who texts back slower?', optionA: 'Sam', optionB: 'Aanya', creatorChoice: 1 },
        { prompt: 'Who plans the trip?', optionA: 'Sam', optionB: 'Aanya', creatorChoice: 0 },
        { prompt: 'Who laughs at their own joke first?', optionA: 'Sam', optionB: 'Aanya', creatorChoice: 1 },
      ],
    },
  });
  const vibePlay = await service.submitPlay(vibe.slug, {
    userId: 202,
    playerName: 'Aanya',
    answers: [1, 0, 1],
  });
  assert.equal(vibePlay.myPlay.score, 3);
  assert.match(vibePlay.myPlay.summary, /100% in sync/);

  // Hub for creator (101) vs player (202)
  const creatorHub = await service.getUserHub({ userId: 101 });
  assert.equal(creatorHub.createdGames.length, 3);
  assert.equal(creatorHub.playedGames.length, 0);

  const playerHub = await service.getUserHub({ userId: 202 });
  assert.equal(playerHub.createdGames.length, 0);
  assert.equal(playerHub.playedGames.length, 3);

  // Player 202 removes a played game card
  const removedPlayed = await service.removeGameCard(memoryQuiz.slug, {
    userId: 202,
    scope: 'played',
  });
  assert.deepEqual(removedPlayed, {
    removed: true,
    scope: 'played',
    slug: memoryQuiz.slug,
  });
  assert.equal((await service.getUserHub({ userId: 202 })).playedGames.length, 2);

  // Non-creator cannot delete a created game
  await assert.rejects(
    service.removeGameCard(memoryQuiz.slug, { userId: 202, scope: 'created' }),
    { status: 403 },
  );

  // Creator 101 deletes a created game card
  const removedCreated = await service.removeGameCard(memoryQuiz.slug, {
    userId: 101,
    scope: 'created',
  });
  assert.deepEqual(removedCreated, {
    removed: true,
    scope: 'created',
    slug: memoryQuiz.slug,
  });
  assert.equal((await service.getUserHub({ userId: 101 })).createdGames.length, 2);
});
