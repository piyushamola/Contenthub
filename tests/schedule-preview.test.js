'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createController = require('../src/api/happy-birthday/controllers/schedule-preview');

test('preview uses the owned Story country and saved zone without exposing content or writing it', async () => {
  let reads = 0;
  const entry = { country: 'US', timezone: 'America/Los_Angeles', storyContent: { letter: 'Private text' } };
  const controller = createController({ strapi: { service: () => ({ owned: async (id, owner) => {
    reads++; assert.equal(id, 'owned-story'); assert.equal(owner, 7); return entry;
  } }) } });
  const ctx = { request: { body: { ownerId: 7, storyDocumentId: 'owned-story', country: 'IN', browserTimeZone: 'America/New_York', triggerLocal: '2026-12-01T09:00' } }, badRequest(message) { assert.fail(message); } };
  await controller.preview(ctx);
  assert.equal(reads, 1);
  assert.equal(ctx.body.timezone, 'America/Los_Angeles');
  assert.equal(ctx.body.triggerAt, '2026-12-01T17:00:00.000Z');
  assert.equal(Object.hasOwn(ctx.body, 'storyContent'), false);
  assert.deepEqual(entry.storyContent, { letter: 'Private text' });
});

test('missing owners, other-owner Stories, ambiguous inputs and published changes are rejected', async () => {
  const controller = createController({ strapi: { service: () => ({ owned: async (id, owner) => {
    if (owner !== 7) throw new Error('Story not found');
    return { country: 'IN', timezone: 'Asia/Kolkata', triggerAt: '2026-12-01T03:30:00Z', storyFirstPublishedAt: '2026-11-01T00:00:00Z' };
  } }) } });
  for (const body of [{ ownerId: null }, { ownerId: 8, storyDocumentId: 'owned' },
    { ownerId: 7, triggerLocal: '2026-12-01T09:00', preset: 'midnight' },
    { ownerId: 7, storyDocumentId: 'owned', preset: 'midnight' }]) {
    let error;
    const ctx = { request: { body }, badRequest(message) { error = message; } };
    await controller.preview(ctx);
    assert.ok(error);
    assert.equal(ctx.body, undefined);
  }
});

test('an unchanged published Story reports its saved instant and locked zone without revalidating its old date', async () => {
  const entry = { country: 'US', timezone: 'America/Los_Angeles', triggerAt: '2026-01-01T17:00:00Z', storyFirstPublishedAt: '2026-01-01T00:00:00Z' };
  const controller = createController({ strapi: { service: () => ({ owned: async () => entry }) } });
  const ctx = { request: { body: { ownerId: 7, storyDocumentId: 'published', country: 'IN', browserTimeZone: 'America/New_York', triggerLocal: '2026-01-01T09:00' } }, badRequest(message) { assert.fail(message); } };
  await controller.preview(ctx);
  assert.equal(ctx.body.triggerAt, '2026-01-01T17:00:00.000Z');
  assert.equal(ctx.body.timezone, 'America/Los_Angeles');
  assert.equal(ctx.body.triggerLocal, '2026-01-01T09:00');
  assert.equal(ctx.body.locked, true);
  assert.equal(ctx.body.validationError, null);
  assert.equal(entry.triggerAt, '2026-01-01T17:00:00Z');
});

test('unexpected owned-read failures return a generic unavailable response rather than a private error', async () => {
  const controller = createController({ strapi: { service: () => ({ owned: async () => { throw new Error('Private database connection detail'); } }) } });
  const ctx = { request: { body: { ownerId: 7, storyDocumentId: 'owned', preset: 'midnight' } }, badRequest(message) { assert.fail(message); } };
  await controller.preview(ctx);
  assert.equal(ctx.status, 503);
  assert.deepEqual(ctx.body, { error: { message: 'Opening-time preview is unavailable.' } });
});
