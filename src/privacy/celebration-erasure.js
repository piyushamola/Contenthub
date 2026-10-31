'use strict';
const UID = 'api::happy-birthday.happy-birthday';
const PURCHASE = 'api::celebration-purchase.celebration-purchase';
const { celebrationWindowEndMs } = require('../api/happy-birthday/utils/celebration-expiry');
const DEMOS = new Set(['elena', 'matt', 'mike', ...(process.env.BIRTHDAY_EXPIRY_EXCLUDED_ROUTES || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)]);
// Add a calendar year in UTC, clamping leap day to 28 February.
function retentionDate(anchor = Date.now()) {
  const date = new Date(anchor);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString();
}

function celebrationRetentionDate(celebration) {
  // Never-published checkout drafts have no public window, even if scheduled.
  const unpublishedStory = celebration.journeyType === 'story' && !celebration.storyFirstPublishedAt;
  const windowEnd = unpublishedStory ? Number.NaN : celebrationWindowEndMs(celebration);
  const createdAt = Date.parse(celebration.createdAt || '');
  const anchor = Number.isFinite(windowEnd) ? windowEnd : createdAt;
  // Do not erase an undated legacy record or silently restart its clock hourly.
  if (!Number.isFinite(anchor)) throw new Error('Celebration retention needs a valid original date');
  return retentionDate(anchor);
}

async function eraseCelebration(strapi, documentId) {
  const rows = await strapi.db.query(UID).findMany({ where: { documentId }, populate: { images: true, storyAssets: true } });
  if (!rows.length) return null;
  if (rows.some(row => DEMOS.has(String(row.customroute).toLowerCase()))) throw new Error('Demo celebrations cannot be erased here');
  const customroute = rows[0].customroute;
  const rowIds = new Set(rows.map(row => row.id));
  const mediaIds = new Set(rows.flatMap(row => [...(row.images || []), ...(row.storyAssets || [])]).map(file => file.id));
  // This marker keeps a failed provider removal retryable and blocks new checkout/editing.
  await strapi.db.query(UID).updateMany({ where: { documentId }, data: { erasureRequestedAt: new Date().toISOString() } });
  await strapi.service(UID).unpublishCelebration(documentId);
  // Financial records survive; their user-generated Story payload does not.
  await strapi.db.query(PURCHASE).updateMany({ where: { celebrationDocumentId: documentId }, data: { storySnapshot: null } });
  let sharedAssets = 0;
  for (const id of mediaIds) {
    const file = await strapi.db.query('plugin::upload.file').findOne({ where: { id }, populate: { related: true } });
    if (!file) continue;
    // Never delete a shared CMS/catalog file or another celebration's media.
    const shared = (file.related || []).some(ref =>
      ref.__type !== UID || (!rowIds.has(ref.id) && ref.documentId !== documentId));
    if (shared) { sharedAssets++; continue; }
    // Provider errors propagate: retain the document/relations for a subsequent retry.
    await strapi.plugin('upload').service('upload').remove(file);
  }
  await strapi.documents(UID).delete({ documentId });
  return { documentId, customroute, erased: true, sharedAssets };
}

async function purgeRetained(strapi, now = Date.now()) {
  const result = { erased: 0, scheduled: 0, failed: 0 };
  let cursor = 0;
  for (;;) {
    // Scan every retained draft so old 30-day deadlines are corrected before
    // they become due, including entries with a future legacy deadline.
    const rows = await strapi.db.query(UID).findMany({
      where: { id: { $gt: cursor }, publishedAt: null },
      select: ['id', 'documentId', 'customroute', 'journeyType', 'storyFirstPublishedAt', 'createdAt', 'expiresAt', 'triggerAt', 'retentionExpiresAt', 'erasureRequestedAt'],
      orderBy: { id: 'asc' }, limit: 200,
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      if (DEMOS.has(String(row.customroute).toLowerCase())) continue;
      try {
        const published = await strapi.db.query(UID).findOne({ where: { documentId: row.documentId, publishedAt: { $notNull: true } } });
        if (published && !row.erasureRequestedAt) continue;
        // An explicit erasure request always takes priority over retention.
        if (!row.erasureRequestedAt) {
          const deadline = celebrationRetentionDate(row);
          if (Date.parse(row.retentionExpiresAt || '') !== Date.parse(deadline)) {
            await strapi.db.query(UID).updateMany({ where: { documentId: row.documentId }, data: { retentionExpiresAt: deadline } });
            result.scheduled++;
          }
          if (Date.parse(deadline) > now) continue;
        }
        if (await eraseCelebration(strapi, row.documentId)) result.erased++;
      } catch {
        result.failed++;
        strapi.log.error('Privacy erasure failed; retained for retry or date review');
      }
    }
  }
  return result;
}
module.exports = { eraseCelebration, purgeRetained, retentionDate, celebrationRetentionDate };
