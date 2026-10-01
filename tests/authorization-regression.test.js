'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ownerOrAdmin = require('../src/api/happy-birthday/policies/is-owner-or-admin');
const adminOnly = require('../src/api/happy-birthday/policies/is-admin');
const storyServer = require('../src/api/happy-birthday/policies/story-server');

test('dashboard ownership policy permits the owner or admin and denies guests and other users', async (t) => {
  for (const [name, user, role, owner, expected] of [
    ['guest', null, 'authenticated', 42, false],
    ['owner', { id: 42 }, 'authenticated', 42, true],
    ['another user', { id: 43 }, 'authenticated', 42, false],
    ['admin', { id: 43 }, 'admin', 42, true],
    ['missing owner', { id: 42 }, 'authenticated', null, false],
    ['missing celebration', { id: 42 }, 'authenticated', undefined, false],
  ]) await t.test(name, async () => {
    const strapi = {
      query: () => ({ findOne: async () => ({ role: { type: role } }) }),
      db: { query: () => ({ findOne: async () => owner === undefined ? null : { owner: owner === null ? null : { id: owner } } }) },
    };
    assert.equal(await ownerOrAdmin({ state: { user }, params: { documentId: 'celebration-1' } }, {}, { strapi }), expected);
    assert.equal(await ownerOrAdmin({ state: { user }, params: {} }, {}, { strapi }), false);
  });
});

test('admin dashboard denies ordinary users even when their JWT has no populated role', async () => {
  const strapi = { query: () => ({ findOne: async () => ({ role: { type: 'authenticated' } }) }) };
  assert.equal(await adminOnly({ state: {} }, {}, { strapi }), false);
  assert.equal(await adminOnly({ state: { user: { id: 42 } } }, {}, { strapi }), false);
  strapi.query = () => ({ findOne: async () => ({ role: { type: 'admin' } }) });
  assert.equal(await adminOnly({ state: { user: { id: 42 } } }, {}, { strapi }), true);
});

test('internal story routes reject browser JWTs and unauthenticated callers', () => {
  for (const strategy of [undefined, 'users-permissions', 'jwt']) {
    assert.equal(storyServer({ state: { auth: { strategy: { name: strategy } } } }), false);
  }
  for (const strategy of ['api-token', 'content-api-token']) {
    assert.equal(storyServer({ state: { auth: { strategy: { name: strategy } } } }), true);
  }
});
