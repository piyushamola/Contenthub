'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const createService = require('../src/api/happy-birthday/services/celebration-wish');
const createStoryService = require('../src/api/happy-birthday/services/birthday-story');
const createController = require('../src/api/happy-birthday/controllers/celebration-wish');
const serverPolicy = require('../src/api/happy-birthday/policies/story-server');

function fixture(overrides = {}, { afterLock, failSave = false } = {}) {
  let rows = [{
    id: 1, documentId: 'celebration-1', customroute: 'sam-birthday',
    journeyType: 'standard', celebrationStatus: 'active',
    publishedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    guestwishes: [{ id: 'old-wish', name: 'Alex', message: 'A previous wish' }],
    birthdaymessages: ['Published message'], ...overrides,
  }];
  rows.push({ ...structuredClone(rows[0]), id: 2, publishedAt: null,
    birthdaymessages: ['Private unfinished message'], storyContent: { letter: 'Private letter' } });
  const matches = (row, where) => Object.entries(where).every(([field, value]) => {
    if (value?.$eqi !== undefined) return String(row[field]).toLowerCase() === value.$eqi;
    if (value?.$notNull) return row[field] != null;
    return row[field] === value;
  });
  let pending = Promise.resolve();
  const strapi = { db: {
    transaction: (callback) => {
      const operation = pending.then(async () => {
        const before = structuredClone(rows);
        try { return await callback(); } catch (error) { rows = before; throw error; }
      });
      pending = operation.catch(() => {});
      return operation;
    },
    query: () => ({
      findOne: async ({ where }) => structuredClone(rows.find((row) => matches(row, where)) || null),
      updateMany: async ({ where, data }) => {
        if (data.guestwishes && failSave) throw new Error('Database unavailable');
        const matched = rows.filter((row) => matches(row, where));
        for (const row of matched) Object.assign(row, structuredClone(data));
        if (where.id && afterLock) afterLock(rows);
        return { count: matched.length };
      },
    }),
  } };
  const service = createService({ strapi });
  strapi.service = () => service;
  return { service, storyService: createStoryService({ strapi }), rows: () => rows };
}

test('a scheduled wish is persisted on both copies without disclosing other wishes or pending edits', async () => {
  for (const journeyType of ['standard', 'story']) {
    const { service, rows } = fixture({ journeyType, premiumUnlocked: journeyType === 'story',
      triggerAt: new Date(Date.now() + 3_600_000).toISOString() });
    const result = await service.addWish('SAM-BIRTHDAY', { name: '  Jamie  ', message: '  Have a lovely birthday!  ' });
    assert.deepEqual(Object.keys(result), ['wish']);
    assert.equal(result.wish.name, 'Jamie');
    assert.equal(result.wish.message, 'Have a lovely birthday!');
    assert.match(result.wish.id, /^[a-f0-9-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(result.wish.createdAt)));
    assert.ok(rows().every((row) => row.guestwishes.length === 2));
    assert.deepEqual(rows()[0].guestwishes, rows()[1].guestwishes);
    assert.deepEqual(rows()[0].birthdaymessages, ['Published message']);
    assert.deepEqual(rows()[1].birthdaymessages, ['Private unfinished message']);
    assert.deepEqual(rows()[1].storyContent, { letter: 'Private letter' });
  }
});

test('live wishes return the saved list and retain legacy serialized wishes', async () => {
  const { service, rows } = fixture({ guestwishes: JSON.stringify([{ name: 'Earlier guest', message: 'Earlier wish' }]) });
  const result = await service.addWish('sam-birthday', { name: 'New guest', message: 'A new wish' });
  assert.equal(result.wishes.length, 2);
  assert.equal(result.wishes[0].name, 'Earlier guest');
  assert.deepEqual(rows()[0].guestwishes, result.wishes);
});

test('input types, trimmed bounds and malformed routes are rejected without writes', async () => {
  const { service, rows } = fixture();
  const before = structuredClone(rows());
  for (const input of [null, {}, { name: 1, message: 'Happy birthday' },
    { name: {}, message: 'Happy birthday' }, { name: '  ', message: 'Happy birthday' },
    { name: 'A'.repeat(101), message: 'Happy birthday' }, { name: 'Sam', message: ['Happy birthday'] },
    { name: 'Sam', message: ' abc ' }, { name: 'Sam', message: 'x'.repeat(2001) }]) {
    await assert.rejects(service.addWish('sam-birthday', input), { status: 400 });
  }
  await assert.rejects(service.addWish('../sam-birthday', { name: 'Sam', message: 'Happy birthday' }), { status: 404 });
  assert.deepEqual(rows(), before);
  const accepted = await service.addWish('sam-birthday', { name: 'n'.repeat(100), message: 'm'.repeat(2000) });
  assert.equal(accepted.wish.name.length, 100);
  assert.equal(accepted.wish.message.length, 2000);
});

test('unavailable states cannot receive wishes, including paused scheduled celebrations', async () => {
  for (const override of [
    { celebrationStatus: 'paused', triggerAt: new Date(Date.now() + 3_600_000).toISOString() },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
    { triggerAt: new Date(Date.now() - 86_400_001).toISOString() },
    { publishedAt: null }, { erasureRequestedAt: new Date().toISOString() },
    { journeyType: 'story', premiumUnlocked: false },
    { journeyType: 'story', premiumUnlocked: true, storyExpiredAt: new Date().toISOString() },
  ]) {
    const { service, rows } = fixture(override);
    const before = structuredClone(rows());
    await assert.rejects(service.addWish('sam-birthday', { name: 'Sam', message: 'Happy birthday' }), { status: 404 });
    assert.deepEqual(rows(), before);
  }
  await assert.rejects(fixture().service.addWish('missing-birthday', { name: 'Sam', message: 'Happy birthday' }), { status: 404 });
});

test('eligibility is checked again after the append lock', async () => {
  for (const change of [
    (rows) => { rows[0].celebrationStatus = 'paused'; },
    (rows) => { rows[0].publishedAt = null; },
    (rows) => { rows[0].erasureRequestedAt = new Date().toISOString(); },
    (rows) => { rows[1].erasureRequestedAt = new Date().toISOString(); },
    (rows) => { rows.splice(0, 1); },
  ]) {
    const { service, rows } = fixture({}, { afterLock: change });
    await assert.rejects(service.addWish('sam-birthday', { name: 'Sam', message: 'Happy birthday' }), { status: 404 });
    assert.equal(rows()[0].guestwishes.length, 1);
  }
});

test('failed persistence returns an error and rolls back the wish', async () => {
  const { service, rows } = fixture({}, { failSave: true });
  const before = structuredClone(rows());
  await assert.rejects(service.addWish('sam-birthday', { name: 'Sam', message: 'Happy birthday' }), /Database unavailable/);
  assert.deepEqual(rows(), before);
});

test('successive appends preserve every wish on both copies', async () => {
  const { service, rows } = fixture();
  await Promise.all(['First guest', 'Second guest'].map((name) => service.addWish('sam-birthday', { name, message: 'Happy birthday' })));
  assert.deepEqual(rows()[0].guestwishes.map((wish) => wish.name), ['Alex', 'First guest', 'Second guest']);
  assert.deepEqual(rows()[0].guestwishes, rows()[1].guestwishes);
});

test('Story-only compatibility route cannot write Standard wishes and Story demo stays read-only', async () => {
  await assert.rejects(fixture().storyService.addWish('sam-birthday', { name: 'Sam', message: 'Happy birthday' }), { status: 404 });
  const story = fixture({ journeyType: 'story', premiumUnlocked: true,
    triggerAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.deepEqual(Object.keys(await story.storyService.addWish('sam-birthday', { name: 'Sam', message: 'Happy birthday' })), ['wish']);
  await assert.rejects(fixture({ customroute: 'elena', journeyType: 'story', premiumUnlocked: true }).service
    .addWish('Elena', { name: 'Sam', message: 'Happy birthday' }), { status: 403 });
  const standardDemo = fixture({ customroute: 'mike', expiresAt: new Date(0).toISOString() });
  assert.equal((await standardDemo.service.addWish('mike', { name: 'Sam', message: 'Happy birthday' })).wishes.length, 2);
});

test('internal policy requires API tokens and controller reports save failures without leaking database errors', async () => {
  for (const strategy of ['api-token', 'content-api-token']) assert.equal(serverPolicy({ state: { auth: { strategy: { name: strategy } } } }), true);
  for (const strategy of [undefined, 'users-permissions']) assert.equal(serverPolicy({ state: { auth: { strategy: { name: strategy } } } }), false);
  for (const status of [400, 403, 404, 500]) {
    const error = Object.assign(new Error('Private database error'), { status });
    const controller = createController({ strapi: { service: () => ({ addWish: async () => { throw error; } }), log: { error() {} } } });
    const ctx = { params: { slug: 'sam-birthday' }, request: { body: {} } };
    for (const [name, code] of Object.entries({ badRequest: 400, forbidden: 403, notFound: 404, internalServerError: 500 })) {
      ctx[name] = (message) => { ctx.status = code; ctx.body = { message }; };
    }
    await controller.create(ctx);
    assert.equal(ctx.status, status);
    if (status === 500) assert.equal(ctx.body.message, 'Could not save your wish. Please try again.');
  }
});
