'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canPermanentlyDelete, eraseOwnedCelebration } = require('../src/privacy/regional-celebration-erasure');
test('non-admin regional erasure rejects India, unknown and malformed locations before reading celebrations or mutating data', async () => {
  const strapi = { db: { query(uid) {
    assert.equal(uid, 'plugin::users-permissions.user', 'Only the acting account may be read before the country gate');
    return { findOne: async () => ({ id: 1, role: { type: 'authenticated' } }) };
  } } };
  for (const country of ['IN', 'UNKNOWN', '', 'in', 'IN,US', 'ZZ', null]) {
    assert.equal(canPermanentlyDelete(country), false);
    await assert.rejects(() => eraseOwnedCelebration(strapi, 'owned', 1, country), error => error.status === 403);
  }
  for (const country of ['US', 'GB', 'DE', 'CH']) assert.equal(canPermanentlyDelete(country), true);
});
test('regional erasure denies absent, invalid and wrong owners, including private drafts', async () => {
  const entry = { documentId: 'owned', owner: { id: 1 } };
  const strapi = { db: { query: uid => ({ findOne: async () => uid === 'plugin::users-permissions.user' ? { id: 1, role: { type: 'authenticated' } } : entry }) } };
  for (const ownerId of [undefined, 0, '1', 2]) await assert.rejects(() => eraseOwnedCelebration(strapi, 'owned', ownerId, 'US'), error => error.status === 404);
});
test('a failed media provider reports queued cleanup without claiming permanent removal', async () => {
  const entry = { id: 1, documentId: 'owned', owner: { id: 1 }, customroute: 'private-story', storyAssets: [{ id: 10 }] };
  let deleted = false;
  const strapi = {
    log: { error() {} },
    db: { query: uid => ({
      findMany: async () => [entry],
      findOne: async () => uid === 'plugin::users-permissions.user' ? { id: 1, role: { type: 'authenticated' } } : uid === 'plugin::upload.file' ? { id: 10, related: [] } : entry,
      updateMany: async ({ data }) => { Object.assign(entry, data); return { count: 1 }; },
    }) },
    service: () => ({ unpublishCelebration: async () => {} }),
    plugin: () => ({ service: () => ({ remove: async () => { throw new Error('Provider down'); } }) }),
    documents: () => ({ delete: async () => { deleted = true; } }),
  };
  assert.deepEqual(await eraseOwnedCelebration(strapi, 'owned', 1, 'US'), { documentId: 'owned', customroute: 'private-story', erased: false, pending: true });
  assert.ok(entry.erasureRequestedAt); assert.equal(deleted, false);
});

function adminFixture({ role = 'admin', blocked = false, ownerId = 99, slug = 'someone-elses-story' } = {}) {
  const rows = [{ id: 1, documentId: 'other-entry', owner: ownerId ? { id: ownerId } : null, customroute: slug, publishedAt: '2026-11-01T00:00:00.000Z', images: [{ id: 10 }] }];
  const actor = { id: 7, blocked, role: { type: role } };
  const removed = [];
  let unpublished = false;
  const strapi = {
    db: { query: uid => ({
      findOne: async ({ where }) => {
        if (uid === 'plugin::users-permissions.user') return where.id === actor.id ? actor : null;
        if (uid === 'plugin::upload.file') return { id: 10, related: [] };
        return rows.find(row => row.documentId === where.documentId &&
          (!Object.hasOwn(where, 'owner') || row.owner?.id === where.owner) &&
          (!Object.hasOwn(where, 'publishedAt') || row.publishedAt === where.publishedAt)) || null;
      },
      findMany: async () => rows,
      updateMany: async ({ data }) => { if (uid === 'api::happy-birthday.happy-birthday') rows.forEach(row => Object.assign(row, data)); return { count: 1 }; },
    }) },
    service: () => ({ unpublishCelebration: async () => { unpublished = true; } }),
    plugin: () => ({ service: () => ({ remove: async file => { removed.push(file.id); } }) }),
    documents: () => ({ delete: async () => { rows.length = 0; } }),
  };
  return { strapi, rows, actor, removed, get unpublished() { return unpublished; } };
}

test('a verified admin can erase another owner or an anonymous entry from any country', async () => {
  for (const country of ['IN', 'US', 'UNKNOWN', '', null]) {
    for (const ownerId of [99, null]) {
      const f = adminFixture({ ownerId });
      const result = await eraseOwnedCelebration(f.strapi, 'other-entry', f.actor.id, country);
      assert.equal(result.erased, true);
      assert.equal(f.rows.length, 0);
      assert.deepEqual(f.removed, [10]);
      assert.equal(f.unpublished, true);
    }
  }
});

test('admin authority comes from the current account role and cannot be supplied as a flag', async () => {
  for (const options of [{ role: 'authenticated' }, { blocked: true }]) {
    const f = adminFixture(options);
    await assert.rejects(() => eraseOwnedCelebration(f.strapi, 'other-entry', f.actor.id, 'IN', { admin: true }), error => [403, 404].includes(error.status));
    assert.equal(f.rows.length, 1);
    assert.deepEqual(f.removed, []);
  }
  const f = adminFixture();
  await assert.rejects(() => eraseOwnedCelebration(f.strapi, 'other-entry', 1234, 'US'), error => error.status === 404);
  f.actor.role.type = 'authenticated';
  await assert.rejects(() => eraseOwnedCelebration(f.strapi, 'other-entry', f.actor.id, 'US'), error => error.status === 404);
  assert.equal(f.rows.length, 1);
});

test('explicit admin erasure can remove a demo while ordinary retention remains protected', async () => {
  const f = adminFixture({ slug: 'elena' });
  assert.equal((await eraseOwnedCelebration(f.strapi, 'other-entry', f.actor.id, 'IN')).erased, true);
  assert.equal(f.rows.length, 0);
});
