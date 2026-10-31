'use strict';

const { randomUUID } = require('node:crypto');
const { celebrationWindowEndMs } = require('../utils/celebration-expiry');
const { isBeforeTrigger } = require('../utils/celebration-schedule');

const UID = 'api::happy-birthday.happy-birthday';
const NON_EXPIRING_ROUTES = new Set(
  (process.env.BIRTHDAY_EXPIRY_EXCLUDED_ROUTES || 'elena,matt,mike')
    .split(',').map((slug) => slug.trim().toLowerCase()).filter(Boolean),
);

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function available(entry, storyOnly) {
  const expiry = celebrationWindowEndMs(entry);
  const isStory = entry?.journeyType === 'story';
  if (!entry?.publishedAt || entry.erasureRequestedAt ||
      entry.celebrationStatus === 'paused' || entry.storyExpiredAt ||
      (storyOnly && !isStory) || (isStory && !entry.premiumUnlocked) ||
      (!NON_EXPIRING_ROUTES.has(String(entry.customroute).toLowerCase()) &&
        (!Number.isFinite(expiry) || expiry <= Date.now()))) {
    fail('Celebration not available', 404);
  }
}

function storedWishes(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

module.exports = ({ strapi }) => ({
  async addWish(slug, input, { storyOnly = false } = {}) {
    const route = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(route)) fail('Celebration not available', 404);
    if (route === 'elena') fail('Wishes are disabled for this demo', 403);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    if (!name || name.length > 100 || message.length < 4 || message.length > 2000) {
      fail('Add your name (1–100 characters) and wish (4–2000 characters)', 400);
    }

    return strapi.db.transaction(async () => {
      const query = strapi.db.query(UID);
      const entry = await query.findOne({ where: {
        customroute: { $eqi: route }, publishedAt: { $notNull: true },
        ...(storyOnly ? { journeyType: 'story' } : {}),
      } });
      available(entry, storyOnly);

      // Updating the published row takes the same transaction lock used by
      // Story wishes. Re-read after the lock so concurrent appends do not lose
      // wishes and a pause, unpublish or erasure cannot use stale eligibility.
      await query.updateMany({ where: { id: entry.id }, data: { updatedAt: new Date() } });
      const current = await query.findOne({ where: { id: entry.id } });
      available(current, storyOnly);
      const erasing = await query.findOne({ where: {
        documentId: current.documentId, erasureRequestedAt: { $notNull: true },
      } });
      if (erasing) fail('Celebration not available', 404);

      const wish = { id: randomUUID(), name, message, createdAt: new Date().toISOString() };
      const wishes = [...storedWishes(current.guestwishes), wish];
      // Do not use Document Service publication here: it would also publish
      // the creator's unfinished edits. Keep both copies' wish lists in sync.
      await query.updateMany({
        where: { documentId: current.documentId },
        data: { guestwishes: wishes, updatedAt: new Date() },
      });
      return isBeforeTrigger(current.triggerAt) ? { wish } : { wish, wishes };
    });
  },
});
