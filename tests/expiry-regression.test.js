'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { celebrationExpiresAt, celebrationWindowEndMs } = require('../src/api/happy-birthday/utils/celebration-expiry');
const celebrationFactory = require('../src/api/happy-birthday/services/happy-birthday');

test('legacy celebrations last 24 hours and explicit expiry is preserved', () => {
  assert.equal(celebrationExpiresAt({ createdAt: '2026-01-01T12:00:00.000Z' }), '2026-01-02T12:00:00.000Z');
  assert.equal(celebrationExpiresAt({ createdAt: '2026-01-01', expiresAt: '2026-01-01T15:00:00.000Z' }), '2026-01-01T15:00:00.000Z');
  assert.equal(celebrationExpiresAt({ createdAt: 'invalid' }), null);
});

test('the hourly cleanup waits 24 hours after the trigger time', () => {
  const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const triggerAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const windowEnd = celebrationWindowEndMs({ createdAt, expiresAt: createdAt, triggerAt });
  assert.equal(windowEnd - Date.parse(triggerAt), 24 * 60 * 60 * 1000);
  assert.ok(windowEnd > Date.now());
});

test('expiry cleanup keeps a scheduled celebration published until its trigger window ends', async () => {
  const createdLongAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const triggerSoon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const triggerAlreadyOver = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const removed = [];
  const service = celebrationFactory({ strapi: {
    contentType: (uid) => ({ uid }),
    log: { info() {}, error() {} },
    db: { query: () => ({
      findMany: async () => [
        { documentId: 'waiting', expiresAt: createdLongAgo },
        { documentId: 'finished', expiresAt: createdLongAgo },
      ],
      findOne: async ({ where }) => ({
        documentId: where.documentId,
        createdAt: createdLongAgo,
        expiresAt: createdLongAgo,
        triggerAt: where.documentId === 'waiting' ? triggerSoon : triggerAlreadyOver,
      }),
    }) },
  } });
  service.unpublishCelebration = async (documentId) => {
    removed.push(documentId);
    return { documentId, customroute: documentId };
  };
  const result = await service.unpublishExpired();
  assert.deepEqual(removed, ['finished']);
  assert.equal(result.skippedActive, 1);
  assert.equal(result.unpublished, 1);
});

test('expiry cleanup rechecks active records, deduplicates drafts and keeps processing after a failure', async () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const candidates = ['expired', 'expired', 'renewed', 'already-unpublished', 'broken'].map((documentId) => ({ documentId, expiresAt: expired }));
  const removed = [];
  const service = celebrationFactory({ strapi: {
    contentType: (uid) => ({ uid }),
    log: { info() {}, error() {} },
    db: { query: () => ({
      findMany: async ({ where }) => {
        assert.deepEqual(where.customroute.$notIn, ['elena', 'matt', 'mike']);
        assert.deepEqual(where.publishedAt, { $notNull: true });
        return candidates;
      },
      findOne: async ({ where }) => where.documentId === 'already-unpublished' ? null : {
        documentId: where.documentId,
        expiresAt: where.documentId === 'renewed' ? new Date(Date.now() + 60_000).toISOString() : expired,
      },
    }) },
  } });
  service.unpublishCelebration = async (documentId) => {
    if (documentId === 'broken') throw new Error('Database unavailable for this item');
    removed.push(documentId);
    return { documentId, customroute: documentId };
  };
  const result = await service.unpublishExpired();
  assert.deepEqual(removed, ['expired']);
  assert.equal(result.checked, 4);
  assert.equal(result.unpublished, 1);
  assert.equal(result.alreadyUnpublished, 1);
  assert.equal(result.skippedActive, 1);
  assert.equal(result.failed, 1);
});


test('public removal persists the original one-year deadline and keeps media without restarting on removal', async () => {
  const data = {
    documentId: 'owned', customroute: 'owned', journeyType: 'standard',
    createdAt: '2026-08-01T12:00:00.000Z', expiresAt: '2026-08-02T12:00:00.000Z',
    triggerAt: '2026-08-10T12:00:00.000Z', retentionExpiresAt: '2026-09-01T12:00:00.000Z',
  };
  let published = true;
  const service = celebrationFactory({ strapi: {
    contentType: uid => ({ uid }),
    db: { query: () => ({
      findOne: async () => published ? data : null,
      updateMany: async ({ where, data: patch }) => {
        if (where.journeyType) return { count: 0 };
        Object.assign(data, patch); return { count: 1 };
      },
    }) },
    documents: () => ({ unpublish: async () => { published = false; return { entries: [data] }; } }),
  } });
  assert.deepEqual(await service.unpublishCelebration('owned'), { documentId: 'owned', customroute: 'owned' });
  assert.equal(data.retentionExpiresAt, '2027-08-11T12:00:00.000Z');
  assert.equal(await service.unpublishCelebration('owned'), null);
  assert.equal(data.retentionExpiresAt, '2027-08-11T12:00:00.000Z');
});
