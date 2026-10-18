'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const createService = require('../src/api/happy-birthday/services/birthday-story');

function fixture(overrides = {}) {
  const entry = {
    customroute: 'sam-standard', personname: 'Sam', hostname: 'Alex', musicId: 'classic',
    birthdaymessages: ['Happy birthday!', 'One', 'Two', 'Three', '__wishhappybday_experience:premium'],
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    images: [{ id: 10, url: '/uploads/photo.jpg', name: 'photo.jpg' }], ...overrides,
  };
  const service = createService({ strapi: { db: { query: () => ({
    findOne: async ({ where, populate }) => {
      assert.equal(where.publishedAt.$notNull, true);
      assert.deepEqual(where.$or, [{ journeyType: 'standard' }, { journeyType: null }]);
      assert.deepEqual(populate, { images: true });
      return where.owner === 7 && where.customroute === entry.customroute ? entry : null;
    },
  }) } } });
  return { entry, service };
}

test('Standard prefill returns only reusable fields and never mutates source messages or assets', async () => {
  const { entry, service } = fixture();
  const before = structuredClone(entry);
  const result = await service.fromStandard('sam-standard', 7, { country: 'IN' });
  assert.deepEqual(result, {
    slug: 'sam-standard', forName: 'Sam', hostName: 'Alex', musicId: 'classic',
    headline: 'Happy birthday!', triggerLocal: '', captions: ['One', 'Two', 'Three'],
    photos: [{ url: '/uploads/photo.jpg', name: 'photo.jpg', caption: 'One' }],
  });
  assert.deepEqual(entry, before);
});

test('wrong owners, anonymous IDs, malformed routes and expired Standard sources reveal no data', async () => {
  const { service } = fixture();
  for (const owner of [undefined, null, '7', 8]) await assert.rejects(service.fromStandard('sam-standard', owner), /not found/);
  await assert.rejects(service.fromStandard('../sam-standard', 7), /not found/);
  const expired = fixture({ expiresAt: new Date(Date.now() - 1000).toISOString() }).service;
  await assert.rejects(expired.fromStandard('sam-standard', 7), /not found/);
});

test('only a future schedule is copied and it uses the new Story country and browser timezone', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const { service } = fixture({ triggerAt: future, timezone: 'Asia/Kolkata' });
  const result = await service.fromStandard('sam-standard', 7, { country: 'US', browserTimeZone: 'America/Los_Angeles' });
  const { formatLocal } = require('../src/api/happy-birthday/utils/celebration-schedule');
  assert.equal(result.triggerLocal, formatLocal(future, 'America/Los_Angeles'));
  const live = fixture({ triggerAt: new Date(Date.now() - 1000).toISOString() }).service;
  assert.equal((await live.fromStandard('sam-standard', 7, { country: 'IN' })).triggerLocal, '');
});

test('legacy serialized messages and plain text remain available while malformed structures are safe', async () => {
  for (const messages of [JSON.stringify(['Happy birthday!', 'One', 'Two', 'Three']), ['Happy birthday!', 'One', 'Two', 'Three']]) {
    const result = await fixture({ birthdaymessages: messages }).service.fromStandard('sam-standard', 7);
    assert.equal(result.headline, 'Happy birthday!');
    assert.deepEqual(result.captions, ['One', 'Two', 'Three']);
  }
  const plain = await fixture({ birthdaymessages: 'A legacy birthday wish' }).service.fromStandard('sam-standard', 7);
  assert.equal(plain.headline, 'A legacy birthday wish');
  assert.deepEqual(plain.captions, ['A legacy birthday wish']);
  for (const messages of [null, {}, '{"invalid":true}', 42]) {
    const result = await fixture({ birthdaymessages: messages }).service.fromStandard('sam-standard', 7);
    assert.equal(result.headline, '');
    assert.deepEqual(result.captions, []);
  }
  const malformed = await fixture({ birthdaymessages: '[not-json' }).service.fromStandard('sam-standard', 7);
  assert.equal(malformed.headline, '[not-json');
});
