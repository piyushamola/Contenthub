'use strict';

const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const UID = 'api::happy-birthday.happy-birthday';

// Models the transaction/raw-query boundary for service unit doubles. It does
// not simulate database isolation or restore mutated fixture rows on rollback;
// disposable real-database cases cover those guarantees.
function celebrationLockFixture(db, { events = [], onLock = async () => {} } = {}) {
  const transactions = new AsyncLocalStorage();
  const columns = { id: 'celebration_pk', documentId: 'document_key', publishedAt: 'published_on' };
  const tableName = 'fixture_celebrations';
  const connection = table => {
    assert.equal(table, tableName);
    const filters = new Map();
    let draftOnly = false;
    let transaction;
    return {
      where(column, value) { filters.set(column, value); return this; },
      whereNull(column) { assert.equal(column, columns.publishedAt); draftOnly = true; return this; },
      transacting(trx) { transaction = trx; return this; },
      async update(data) {
        assert.equal(transaction, transactions.getStore()?.trx, 'The lock must use the active Strapi transaction');
        assert.ok(transaction, 'A lock outside a transaction is invalid');
        assert.equal(draftOnly, true, 'The stable draft row must be targeted');
        assert.equal(filters.size, 1);
        assert.equal(typeof filters.get(columns.documentId), 'string');
        assert.deepEqual(data, { [columns.id]: { identifier: columns.id } }, 'The lock must leave persisted fields unchanged');
        const documentId = filters.get(columns.documentId);
        events.push(`lock:${documentId}`);
        await onLock({ documentId, trx: transaction });
        return 1;
      },
    };
  };
  connection.ref = identifier => ({ identifier });
  return {
    ...db,
    connection,
    metadata: { get(uid) {
      assert.equal(uid, UID);
      return { tableName, attributes: Object.fromEntries(Object.entries(columns).map(([key, columnName]) => [key, { columnName }])) };
    } },
    async transaction(run) {
      const current = transactions.getStore();
      if (current) return run(current);
      return transactions.run({ trx: {} }, async () => {
        events.push('transaction:begin');
        try {
          const result = await run(transactions.getStore());
          events.push('transaction:commit');
          return result;
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        }
      });
    },
  };
}

module.exports = { celebrationLockFixture };
