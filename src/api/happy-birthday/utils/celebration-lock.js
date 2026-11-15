'use strict';

const UID = 'api::happy-birthday.happy-birthday';

/**
 * Serialize document mutations on its stable draft row before reading state.
 * A raw id=id write acquires a write lock on SQLite and a row lock on Postgres
 * without changing revisions, timestamps, entitlements or publication data.
 * Nested callers reuse Strapi's current transaction and retain the same lock.
 */
async function withCelebrationLock(strapi, documentId, run) {
  return strapi.db.transaction(async ({ trx }) => {
    const { tableName, attributes } = strapi.db.metadata.get(UID);
    const column = name => attributes[name]?.columnName || name;
    const connection = strapi.db.connection;
    const id = column('id');
    await connection(tableName)
      .where(column('documentId'), documentId)
      .whereNull(column('publishedAt'))
      .transacting(trx)
      .update({ [id]: connection.ref(id) });
    return run();
  });
}

module.exports = { withCelebrationLock };
