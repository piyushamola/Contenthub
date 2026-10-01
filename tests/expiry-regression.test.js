'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { celebrationExpiresAt } = require('../src/api/happy-birthday/utils/celebration-expiry');
const celebrationFactory = require('../src/api/happy-birthday/services/happy-birthday');

test('legacy celebrations last 24 hours and explicit expiry is preserved', () => {
  assert.equal(celebrationExpiresAt({ createdAt: '2026-01-01T12:00:00.000Z' }), '2026-01-02T12:00:00.000Z');
  assert.equal(celebrationExpiresAt({ createdAt: '2026-01-01', expiresAt: '2026-01-01T15:00:00.000Z' }), '2026-01-01T15:00:00.000Z');
  assert.equal(celebrationExpiresAt({ createdAt: 'invalid' }), null);
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
