'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { eraseCelebration, retentionDate, celebrationRetentionDate, purgeRetained } = require('../src/privacy/celebration-erasure');
const ownerPolicy = require('../src/api/happy-birthday/policies/is-owner-or-admin');
function fixture({ shared = false, failure = false } = {}) {
  const rows = [{ id: 1, documentId: 'birthday', customroute: 'private-birthday', images: [{ id: 10 }], storyAssets: [{ id: 11 }] }];
  const removed = []; let deleted = false; let unpublished = false; let snapshot = { name: 'Private recipient' };
  return { rows, removed, get deleted() { return deleted; }, get unpublished() { return unpublished; }, get snapshot() { return snapshot; }, strapi: {
    db: { query: uid => ({
      findMany: async () => rows,
      findOne: async ({ where }) => uid === 'plugin::upload.file' ? { id: where.id, related: [{ __type: 'api::happy-birthday.happy-birthday', id: shared && where.id === 11 ? 99 : 1 }] } : null,
      updateMany: async ({ data }) => { if (uid.includes('celebration-purchase')) snapshot = data.storySnapshot; else Object.assign(rows[0], data); return { count: 1 }; },
    }) },
    service: () => ({ unpublishCelebration: async () => { unpublished = true; } }),
    plugin: () => ({ service: () => ({ remove: async file => { if (failure) throw new Error('Storage unavailable'); removed.push(file.id); } }) }),
    documents: () => ({ delete: async () => { deleted = true; } }),
  } };
}
test('scheduled cleanup erases both media kinds and purchase Story payload, retaining financial records', async () => {
 const f = fixture(); const result = await eraseCelebration(f.strapi, 'birthday');
 assert.equal(result.erased, true); assert.equal(f.deleted, true); assert.equal(f.unpublished, true); assert.equal(f.snapshot, null); assert.deepEqual(f.removed, [10, 11]);
});
test('shared media survives another celebration erasure', async () => {
 const f = fixture({ shared: true }); const result = await eraseCelebration(f.strapi, 'birthday'); assert.equal(result.sharedAssets, 1); assert.deepEqual(f.removed, [10]); assert.equal(f.deleted, true);
});
test('storage failure leaves a retry marker and document, while stopping public access', async () => {
 const f = fixture({ failure: true }); await assert.rejects(eraseCelebration(f.strapi, 'birthday'), /Storage unavailable/); assert.equal(f.deleted, false); assert.equal(f.unpublished, true); assert.ok(f.rows[0].erasureRequestedAt);
});
test('demo and absent records cannot accidentally be purged', async () => {
 const f = fixture(); f.rows[0].customroute = 'elena'; await assert.rejects(eraseCelebration(f.strapi, 'birthday'), /Demo/); assert.deepEqual(f.removed, []);
 f.rows.length = 0; assert.equal(await eraseCelebration(f.strapi, 'missing'), null);
});
test('dashboard ownership keeps ordinary actions limited to published celebrations', async () => {
 let filter; const strapi = { query: () => ({ findOne: async () => ({ role: { type: 'authenticated' } }) }), db: { query: () => ({ findOne: async ({ where }) => { filter = where; return { owner: { id: 7 } }; } }) } };
 const ctx = { state: { user: { id: 7 } }, params: { documentId: 'private-draft' } };
 assert.equal(await ownerPolicy(ctx, {}, { strapi }), true); assert.deepEqual(filter.publishedAt, { $notNull: true });
 assert.equal(await ownerPolicy({ ...ctx, state: { user: { id: 8 } } }, {}, { strapi }), false);
});
function cleanupFixture(input, { published = [], failMedia = false } = {}) {
 const rows = input.map((row, index) => ({ id: index + 1, publishedAt: null, images: [], storyAssets: [], ...row }));
 const live = new Set(published); const removed = []; const deleted = []; let scans = 0;
 const state = { failMedia };
 const strapi = {
  log: { error() {} },
  db: { query: uid => ({
   findMany: async ({ where, limit }) => {
    if (where.documentId) return rows.filter(row => row.documentId === where.documentId);
    scans++;
    return rows.filter(row => row.id > where.id.$gt && row.publishedAt === null).slice(0, limit);
   },
   findOne: async ({ where }) => uid === 'plugin::upload.file'
    ? { id: where.id, related: [] }
    : live.has(where.documentId) ? { documentId: where.documentId, publishedAt: '2026-08-01T12:00:00.000Z' } : null,
   updateMany: async ({ where, data }) => {
    if (uid.includes('celebration-purchase')) return { count: 0 };
    const matches = rows.filter(row => row.documentId === where.documentId);
    matches.forEach(row => Object.assign(row, data));
    return { count: matches.length };
   },
  }) },
  service: () => ({ unpublishCelebration: async documentId => { live.delete(documentId); } }),
  plugin: () => ({ service: () => ({ remove: async file => {
   if (state.failMedia) throw new Error('Storage unavailable');
   removed.push(file.id);
  } }) }),
  documents: () => ({ delete: async ({ documentId }) => {
   deleted.push(documentId);
   for (let i = rows.length - 1; i >= 0; i--) if (rows[i].documentId === documentId) rows.splice(i, 1);
  } }),
 };
 return { rows, removed, deleted, strapi, state, get scans() { return scans; } };
}
const retained = {
 documentId: 'retained', customroute: 'retained',
 createdAt: '2026-08-01T12:00:00.000Z', expiresAt: '2026-08-02T12:00:00.000Z',
};
test('retention adds one calendar year and clamps leap day without changing the time', () => {
 assert.equal(retentionDate(Date.parse('2026-08-02T12:34:56.789Z')), '2027-08-02T12:34:56.789Z');
 assert.equal(retentionDate(Date.parse('2028-02-29T12:34:56.789Z')), '2029-02-28T12:34:56.789Z');
 assert.throws(() => retentionDate(Number.NaN), RangeError);
});
test('retention follows the original public window and never-published drafts follow creation', () => {
 assert.equal(celebrationRetentionDate(retained), '2027-08-02T12:00:00.000Z');
 assert.equal(celebrationRetentionDate({ ...retained, triggerAt: '2026-08-20T15:00:00.000Z' }), '2027-08-21T15:00:00.000Z');
 assert.equal(celebrationRetentionDate({ ...retained, journeyType: 'story', storyFirstPublishedAt: '2026-08-01T12:00:00.000Z' }), '2027-08-02T12:00:00.000Z');
 assert.equal(celebrationRetentionDate({ ...retained, journeyType: 'story', triggerAt: '2030-08-01T12:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' }), '2027-08-01T12:00:00.000Z');
 assert.throws(() => celebrationRetentionDate({ createdAt: 'invalid' }), /valid original date/);
});
test('legacy due and future 30-day deadlines are replaced using original dates, once', async () => {
 const f = cleanupFixture([
  { ...retained, retentionExpiresAt: '2026-09-01T12:00:00.000Z' },
  { ...retained, documentId: 'future-legacy', retentionExpiresAt: '2026-11-01T12:00:00.000Z' },
 ]);
 const now = Date.parse('2026-10-30T00:00:00.000Z');
 assert.deepEqual(await purgeRetained(f.strapi, now), { erased: 0, scheduled: 2, failed: 0 });
 assert.ok(f.rows.every(row => row.retentionExpiresAt === '2027-08-02T12:00:00.000Z'));
 assert.deepEqual(await purgeRetained(f.strapi, now + 3600000), { erased: 0, scheduled: 0, failed: 0 });
 assert.deepEqual(f.deleted, []);
});
test('cleanup retains content and media until the year boundary, then erases them', async () => {
 const f = cleanupFixture([{ ...retained, retentionExpiresAt: '2027-08-02T12:00:00.000Z', images: [{ id: 10 }], storyAssets: [{ id: 11 }] }]);
 const deadline = Date.parse('2027-08-02T12:00:00.000Z');
 assert.equal((await purgeRetained(f.strapi, deadline - 1)).erased, 0);
 assert.equal(f.rows.length, 1); assert.deepEqual(f.removed, []);
 assert.deepEqual(await purgeRetained(f.strapi, deadline), { erased: 1, scheduled: 0, failed: 0 });
 assert.equal(f.rows.length, 0); assert.deepEqual(f.removed, [10, 11]);
});
test('never-published checkout draft is deleted one year from creation, not its later edit or schedule', async () => {
 const f = cleanupFixture([{ ...retained, journeyType: 'story', triggerAt: '2030-08-01T12:00:00.000Z', updatedAt: '2027-07-31T12:00:00.000Z' }]);
 const deadline = Date.parse('2027-08-01T12:00:00.000Z');
 assert.equal((await purgeRetained(f.strapi, deadline - 1)).erased, 0);
 assert.equal(f.rows[0].retentionExpiresAt, '2027-08-01T12:00:00.000Z');
 assert.equal((await purgeRetained(f.strapi, deadline)).erased, 1);
});
test('interrupted scheduled cleanup retries failed media removal', async () => {
 const f = cleanupFixture([{ ...retained, erasureRequestedAt: '2027-08-02T12:00:00.000Z', images: [{ id: 10 }] }], { failMedia: true });
 const now = Date.parse('2027-08-02T13:00:00.000Z');
 assert.equal((await purgeRetained(f.strapi, now)).failed, 1);
 assert.equal(f.rows.length, 1); assert.ok(f.rows[0].erasureRequestedAt);
 f.state.failMedia = false;
 assert.equal((await purgeRetained(f.strapi, now)).erased, 1);
 assert.deepEqual(f.removed, [10]);
});
test('retention scan paginates past 200 active drafts, skips demos and continues past invalid dates', async () => {
 const active = Array.from({ length: 200 }, (_, i) => ({ ...retained, documentId: `live-${i}` }));
 const f = cleanupFixture([...active,
  { ...retained, documentId: 'demo', customroute: 'elena' },
  { documentId: 'undated', customroute: 'undated', createdAt: 'invalid' },
  { ...retained, documentId: 'later' },
 ], { published: active.map(row => row.documentId) });
 assert.deepEqual(await purgeRetained(f.strapi, Date.parse('2026-10-30T00:00:00.000Z')), { erased: 0, scheduled: 1, failed: 1 });
 assert.equal(f.scans, 3); assert.equal(f.rows.length, 203);
 assert.equal(f.rows.find(row => row.documentId === 'later').retentionExpiresAt, '2027-08-02T12:00:00.000Z');
 assert.equal(f.rows.find(row => row.documentId === 'demo').retentionExpiresAt, undefined);
});
