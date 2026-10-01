'use strict';

// Existing stories keep their original publication time. Shorten their old
// 30-day expiry once; the regular celebration cleanup handles unpublishing.
module.exports = {
  async up(knex) {
    const table = 'happy_birthdays';
    if (!(await knex.schema.hasTable(table))) return;
    if (!(await knex.schema.hasColumn(table, 'story_first_published_at'))) return;

    const entries = await knex(table)
      .where('journey_type', 'story')
      .whereNotNull('story_first_published_at')
      .select('id', 'story_first_published_at', 'expires_at');
    for (const entry of entries) {
      const firstPublishedAt = new Date(entry.story_first_published_at).getTime();
      if (!Number.isFinite(firstPublishedAt)) continue;
      const expiry = firstPublishedAt + 24 * 60 * 60 * 1000;
      const previousExpiry = entry.expires_at == null
        ? NaN
        : new Date(entry.expires_at).getTime();
      // Never extend an already-expired celebration.
      if (!Number.isFinite(previousExpiry) || previousExpiry > expiry) {
        await knex(table).where('id', entry.id).update({ expires_at: new Date(expiry) });
      }
    }
  },
};
