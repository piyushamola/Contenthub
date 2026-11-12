'use strict';

const { randomUUID } = require('node:crypto');

const UID = 'api::play-game.play-game';
const GAME_TYPES = new Set([
  'memory-quiz',
  'birthday-wheel',
  'most-likely-to',
]);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanText(value, maxLength, label, required = true) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (required && !trimmed) fail(`${label} is required`);
  if (trimmed.length > maxLength) fail(`${label} must be ${maxLength} characters or fewer`);
  return trimmed;
}

function cleanPhotoUrl(value, idx) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) fail(`Upload a photo for question ${idx + 1}`);
  if (trimmed.length > 1_500_000) {
    fail(`Photo for question ${idx + 1} is too large`);
  }
  if (
    !trimmed.startsWith('data:image/') &&
    !trimmed.startsWith('/') &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('http://')
  ) {
    fail(`Invalid photo format for question ${idx + 1}`);
  }
  return trimmed;
}

function parsePlays(raw) {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function parseConfig(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function validateAndNormalizeConfig(gameType, inputConfig) {
  const raw = parseConfig(inputConfig);

  if (gameType === 'memory-quiz') {
    const questions = Array.isArray(raw.questions) ? raw.questions : [];
    if (questions.length < 3 || questions.length > 5) {
      fail('Photo Memory Quiz requires 3 to 5 questions');
    }
    return {
      questions: questions.map((item, idx) => {
        const photoUrl = cleanPhotoUrl(item?.photoUrl, idx);
        const prompt = cleanText(item?.prompt, 200, `Question ${idx + 1}`);
        const options = Array.isArray(item?.options) ? item.options : [];
        if (options.length !== 4) {
          fail(`Question ${idx + 1} needs exactly 4 options`);
        }
        const cleanedOptions = options.map((opt, oIdx) =>
          cleanText(opt, 140, `Question ${idx + 1} option ${oIdx + 1}`),
        );
        const correctIndex = Number(item?.correctIndex);
        if (![0, 1, 2, 3].includes(correctIndex)) {
          fail(`Choose the correct option (1–4) for question ${idx + 1}`);
        }
        return {
          photoUrl,
          prompt,
          options: cleanedOptions,
          correctIndex,
        };
      }),
    };
  }

  if (gameType === 'birthday-wheel') {
    const slices = Array.isArray(raw.slices) ? raw.slices : [];
    if (slices.length < 4 || slices.length > 8) {
      fail('Spin the Birthday Wheel requires 4 to 8 prize slices');
    }
    return {
      slices: slices.map((slice, idx) => ({
        emoji: cleanText(slice?.emoji || '🎁', 12, `Slice ${idx + 1} emoji`),
        label: cleanText(slice?.label, 120, `Slice ${idx + 1} prize`),
      })),
    };
  }

  if (gameType === 'most-likely-to') {
    const questions = Array.isArray(raw.questions) ? raw.questions : [];
    if (questions.length < 3 || questions.length > 5) {
      fail('Most Likely To requires 3 to 5 questions');
    }
    return {
      questions: questions.map((q, idx) => {
        const prompt = cleanText(q?.prompt, 180, `Question ${idx + 1}`);
        const optionA = cleanText(q?.optionA, 100, `Question ${idx + 1} option A`);
        const optionB = cleanText(q?.optionB, 100, `Question ${idx + 1} option B`);
        const creatorChoice = Number(q?.creatorChoice);
        if (![0, 1].includes(creatorChoice)) {
          fail(`Pick your own choice for question ${idx + 1}`);
        }
        return { prompt, optionA, optionB, creatorChoice };
      }),
    };
  }

  fail('Unsupported game type');
}

function sanitizeConfigForPlayer(gameType, config) {
  const parsed = parseConfig(config);
  if (gameType === 'memory-quiz') {
    return {
      questions: (parsed.questions || []).map((q) => ({
        photoUrl: q.photoUrl,
        prompt: q.prompt,
        options: q.options,
      })),
    };
  }
  if (gameType === 'most-likely-to') {
    return {
      questions: (parsed.questions || []).map((q) => ({
        prompt: q.prompt,
        optionA: q.optionA,
        optionB: q.optionB,
      })),
    };
  }
  return parsed;
}

function evaluatePlay(gameType, config, payload) {
  const parsed = parseConfig(config);

  if (gameType === 'memory-quiz') {
    const questions = parsed.questions || [];
    const answers = Array.isArray(payload?.answers) ? payload.answers.map(Number) : [];
    if (
      answers.length !== questions.length ||
      answers.some((a) => ![0, 1, 2, 3].includes(a))
    ) {
      fail('Answer every question in the carousel before submitting');
    }
    let score = 0;
    const breakdown = questions.map((q, idx) => {
      const picked = answers[idx];
      const correct = picked === q.correctIndex;
      if (correct) score++;
      return {
        prompt: q.prompt,
        pickedIndex: picked,
        correctIndex: q.correctIndex,
        correct,
      };
    });
    const maxScore = questions.length;
    const badge =
      score === maxScore
        ? '🏆 Memory Master'
        : score >= Math.ceil(maxScore / 2)
          ? '✨ True Inner Circle'
          : '😂 Needs a Memory Refresh';
    return {
      score,
      maxScore,
      summary: `Scored ${score}/${maxScore} · ${badge}`,
      details: { answers, breakdown },
    };
  }

  if (gameType === 'birthday-wheel') {
    const slices = parsed.slices || [];
    const sliceIndex = Number(payload?.sliceIndex);
    if (!Number.isInteger(sliceIndex) || sliceIndex < 0 || sliceIndex >= slices.length) {
      fail('Spin the wheel to land on a valid prize');
    }
    const won = slices[sliceIndex];
    return {
      score: 1,
      maxScore: 1,
      summary: `Won: ${won.emoji} ${won.label}`,
      details: { sliceIndex, prize: won },
    };
  }

  if (gameType === 'most-likely-to') {
    const questions = parsed.questions || [];
    const answers = Array.isArray(payload?.answers) ? payload.answers.map(Number) : [];
    if (answers.length !== questions.length || answers.some((a) => ![0, 1].includes(a))) {
      fail('Answer every question before submitting');
    }
    let score = 0;
    const breakdown = questions.map((q, idx) => {
      const picked = answers[idx];
      const matched = picked === q.creatorChoice;
      if (matched) score++;
      return {
        prompt: q.prompt,
        pickedIndex: picked,
        creatorChoice: q.creatorChoice,
        matched,
      };
    });
    const maxScore = questions.length;
    const percent = Math.round((score / maxScore) * 100);
    return {
      score,
      maxScore,
      summary: `${score}/${maxScore} Vibe Match (${percent}% in sync ⚡)`,
      details: { answers, breakdown, percent },
    };
  }

  fail('Unsupported game type');
}

function generateSlug(gameType, recipientName) {
  const base =
    recipientName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'birthday';
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${gameType}-${base}-${suffix}`;
}

module.exports = ({ strapi }) => ({
  async createGame(input) {
    const ownerId = Number(input?.ownerId);
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      fail('Log in to create a game', 403);
    }
    const user = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: ownerId } });
    if (!user) fail('Log in to create a game', 403);

    const gameType = String(input?.gameType || '').trim();
    if (!GAME_TYPES.has(gameType)) {
      fail('Choose a valid game type');
    }

    const recipientName = cleanText(input?.recipientName, 80, 'Recipient or friend name');
    const creatorName = cleanText(
      input?.creatorName || user.displayName || user.username || 'Friend',
      80,
      'Your name',
    );
    const title = cleanText(
      input?.title || `${recipientName}'s Birthday Game`,
      140,
      'Game title',
    );
    const config = validateAndNormalizeConfig(gameType, input?.config);
    const slug = generateSlug(gameType, recipientName);

    const created = await strapi.db.query(UID).create({
      data: {
        slug,
        gameType,
        title,
        recipientName,
        creatorName,
        creatorEmail: user.email || null,
        config,
        plays: [],
        playCount: 0,
        owner: ownerId,
      },
    });

    return {
      slug: created.slug,
      gameType: created.gameType,
      title: created.title,
      recipientName: created.recipientName,
      creatorName: created.creatorName,
      playCount: 0,
      createdAt: created.createdAt,
    };
  },

  async readGame(slug, { userId } = {}) {
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,90}$/.test(normalizedSlug)) {
      fail('Game not found', 404);
    }
    const entry = await strapi.db.query(UID).findOne({
      where: { slug: normalizedSlug },
      populate: { owner: { select: ['id', 'username', 'displayName', 'email'] } },
    });
    if (!entry) fail('Game not found', 404);

    const numericUserId = Number(userId);
    const isCreator = Number.isInteger(numericUserId) && entry.owner?.id === numericUserId;
    const plays = parsePlays(entry.plays);
    const myPlay = Number.isInteger(numericUserId)
      ? plays.find((p) => Number(p.userId) === numericUserId) || null
      : null;

    return {
      slug: entry.slug,
      gameType: entry.gameType,
      title: entry.title,
      recipientName: entry.recipientName,
      creatorName: entry.creatorName,
      config:
        isCreator || myPlay
          ? parseConfig(entry.config)
          : sanitizeConfigForPlayer(entry.gameType, entry.config),
      playCount: plays.length,
      isCreator,
      myPlay,
      plays: isCreator
        ? plays.map((p) => ({
            id: p.id,
            playerName: p.playerName,
            score: p.score,
            maxScore: p.maxScore,
            summary: p.summary,
            playedAt: p.playedAt,
          }))
        : [],
      createdAt: entry.createdAt,
    };
  },

  async submitPlay(slug, input) {
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,90}$/.test(normalizedSlug)) {
      fail('Game not found', 404);
    }
    const userId = Number(input?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      fail('Log in to play this game', 403);
    }
    const user = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: userId } });
    if (!user) fail('Log in to play this game', 403);

    const playerName = cleanText(
      input?.playerName || user.displayName || user.username || 'Player',
      80,
      'Your name',
    );

    return strapi.db.transaction(async () => {
      const query = strapi.db.query(UID);
      const entry = await query.findOne({
        where: { slug: normalizedSlug },
        populate: { owner: { select: ['id'] } },
      });
      if (!entry) fail('Game not found', 404);

      const evaluated = evaluatePlay(entry.gameType, entry.config, input);
      const plays = parsePlays(entry.plays);
      const existingIndex = plays.findIndex((p) => Number(p.userId) === userId);
      const playRecord = {
        id: existingIndex >= 0 ? plays[existingIndex].id : randomUUID(),
        userId,
        playerName,
        playerEmail: user.email || null,
        score: evaluated.score,
        maxScore: evaluated.maxScore,
        summary: evaluated.summary,
        details: evaluated.details,
        playedAt: new Date().toISOString(),
      };

      const nextPlays =
        existingIndex >= 0
          ? plays.map((item, idx) => (idx === existingIndex ? playRecord : item))
          : [...plays, playRecord];

      await query.updateMany({
        where: { id: entry.id },
        data: {
          plays: nextPlays,
          playCount: nextPlays.length,
          updatedAt: new Date(),
        },
      });

      return {
        slug: entry.slug,
        gameType: entry.gameType,
        title: entry.title,
        recipientName: entry.recipientName,
        creatorName: entry.creatorName,
        playCount: nextPlays.length,
        myPlay: playRecord,
        config: parseConfig(entry.config),
      };
    });
  },

  async getUserHub({ userId } = {}) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
      return { createdGames: [], playedGames: [] };
    }

    const allGames = await strapi.db.query(UID).findMany({
      populate: { owner: { select: ['id'] } },
      orderBy: { createdAt: 'desc' },
      limit: 100,
    });

    const createdGames = [];
    const playedGames = [];

    for (const game of allGames) {
      if (!GAME_TYPES.has(game.gameType)) continue;
      const plays = parsePlays(game.plays);
      if (game.owner?.id === numericUserId) {
        createdGames.push({
          slug: game.slug,
          gameType: game.gameType,
          title: game.title,
          recipientName: game.recipientName,
          creatorName: game.creatorName,
          playCount: plays.length,
          plays: plays.map((p) => ({
            id: p.id,
            playerName: p.playerName,
            score: p.score,
            maxScore: p.maxScore,
            summary: p.summary,
            playedAt: p.playedAt,
          })),
          createdAt: game.createdAt,
        });
      }

      const myPlay = plays.find((p) => Number(p.userId) === numericUserId);
      if (myPlay) {
        playedGames.push({
          slug: game.slug,
          gameType: game.gameType,
          title: game.title,
          recipientName: game.recipientName,
          creatorName: game.creatorName,
          score: myPlay.score,
          maxScore: myPlay.maxScore,
          summary: myPlay.summary,
          playedAt: myPlay.playedAt,
        });
      }
    }

    return { createdGames, playedGames };
  },

  async removeGameCard(slug, input = {}) {
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,90}$/.test(normalizedSlug)) {
      fail('Game not found', 404);
    }
    const userId = Number(input?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      fail('Log in to manage your games', 403);
    }
    const scope = input?.scope === 'created' ? 'created' : 'played';

    return strapi.db.transaction(async () => {
      const query = strapi.db.query(UID);
      const entry = await query.findOne({
        where: { slug: normalizedSlug },
        populate: { owner: { select: ['id'] } },
      });
      if (!entry) fail('Game not found', 404);

      if (scope === 'created') {
        if (entry.owner?.id !== userId) {
          fail('Only the creator can remove this created game', 403);
        }
        await query.delete({ where: { id: entry.id } });
        return { removed: true, scope: 'created', slug: entry.slug };
      }

      const plays = parsePlays(entry.plays);
      const nextPlays = plays.filter((p) => Number(p.userId) !== userId);
      await query.updateMany({
        where: { id: entry.id },
        data: {
          plays: nextPlays,
          playCount: nextPlays.length,
          updatedAt: new Date(),
        },
      });
      return { removed: true, scope: 'played', slug: entry.slug };
    });
  },
});
