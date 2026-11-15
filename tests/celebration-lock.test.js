'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withCelebrationLock } = require('../src/api/happy-birthday/utils/celebration-lock');
const { celebrationLockFixture } = require('./helpers/celebration-lock-fixture.cjs');

test('document work starts only after the mapped stable-row lock finishes', async () => {
  const events = [];
  let release;
  let acquired;
  const entering = new Promise(resolve => { acquired = resolve; });
  const db = celebrationLockFixture({}, { events, onLock: async () => {
    acquired();
    await new Promise(resolve => { release = resolve; });
  } });
  let ran = false;
  const result = withCelebrationLock({ db }, 'owned', async () => { ran = true; events.push('document:work'); return { saved: true }; });
  await Promise.race([entering, result.then(() => { assert.fail('Document work completed before the lock gate was released'); })]);
  assert.equal(ran, false);
  release();
  assert.deepEqual(await result, { saved: true });
  assert.deepEqual(events, ['transaction:begin', 'lock:owned', 'document:work', 'transaction:commit']);
});

test('a failed lock prevents document work and propagates the retryable failure', async () => {
  const events = [];
  const failure = new Error('The database lock is unavailable');
  const db = celebrationLockFixture({}, { events, onLock: async () => { throw failure; } });
  let ran = false;
  await assert.rejects(withCelebrationLock({ db }, 'owned', async () => { ran = true; }), error => error === failure);
  assert.equal(ran, false);
  assert.deepEqual(events, ['transaction:begin', 'lock:owned', 'transaction:rollback']);
});

test('nested document operations keep the outer transaction until all work finishes', async () => {
  const events = [];
  const transactions = [];
  const db = celebrationLockFixture({}, { events, onLock: async ({ trx }) => { transactions.push(trx); } });
  const strapi = { db };
  await withCelebrationLock(strapi, 'owned', () => withCelebrationLock(strapi, 'owned', async () => { events.push('document:work'); }));
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0], transactions[1]);
  assert.deepEqual(events, ['transaction:begin', 'lock:owned', 'lock:owned', 'document:work', 'transaction:commit']);
});

test('document callback failures propagate through the transaction boundary', async () => {
  const events = [];
  const db = celebrationLockFixture({}, { events });
  const failure = new Error('The content update failed');
  await assert.rejects(withCelebrationLock({ db }, 'owned', async () => { throw failure; }), error => error === failure);
  assert.deepEqual(events, ['transaction:begin', 'lock:owned', 'transaction:rollback']);
});
