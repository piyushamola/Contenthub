'use strict';

/**
 * happy-birthday service
 */

const { createCoreService } = require('@strapi/strapi').factories;

const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';
const { CELEBRATION_DURATION_MS, celebrationWindowEndMs } = require('../utils/celebration-expiry');
const CLEANUP_CONCURRENCY = 5;
const DEFAULT_NON_EXPIRING_ROUTES = 'elena,matt,mike';
const nonExpiringRoutes = (
  process.env.BIRTHDAY_EXPIRY_EXCLUDED_ROUTES ?? DEFAULT_NON_EXPIRING_ROUTES
)
  .split(',')
  .map((route) => route.trim().toLowerCase())
  .filter(Boolean);

function errorMessage(error) {
  return String(error?.message || error || 'Unknown cleanup error').slice(
    0,
    1000
  );
}

async function forEachWithConcurrency(items, concurrency, callback) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await callback(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

module.exports = createCoreService(HAPPY_BIRTHDAY_UID, ({ strapi }) => ({
  /** Remove public access while retaining the draft and its uploaded media. */
  async unpublishCelebration(documentId) {
    const published = await strapi.db.query(HAPPY_BIRTHDAY_UID).findOne({
      where: { documentId, publishedAt: { $notNull: true } },
      select: ['documentId', 'customroute'],
    });
    if (!published) return null;

    await strapi.db.query(HAPPY_BIRTHDAY_UID).updateMany({ where: { documentId, journeyType: 'story' }, data: { storyExpiredAt: new Date().toISOString() } });
    const result = await strapi.documents(HAPPY_BIRTHDAY_UID).unpublish({ documentId });
    if (Array.isArray(result?.entries) && result.entries.length === 0) return null;
    return { documentId, customroute: published.customroute };
  },

  /** Unpublish expired celebrations, retaining their draft content and photos. */
  async unpublishExpired() {
    const now = new Date();
    const createdAtCutoff = new Date(now.getTime() - CELEBRATION_DURATION_MS);
    const entries = await strapi.db.query(HAPPY_BIRTHDAY_UID).findMany({
      where: {
        $or: [
          { expiresAt: { $lte: now } },
          {
            $and: [
              { expiresAt: { $null: true } },
              { createdAt: { $lte: createdAtCutoff } },
            ],
          },
        ],
        publishedAt: { $notNull: true },
        ...(nonExpiringRoutes.length
          ? { customroute: { $notIn: nonExpiringRoutes } }
          : {}),
      },
      select: [
        'documentId',
        'customroute',
        'createdAt',
        'expiresAt',
      ],
      orderBy: { createdAt: 'asc' },
    });

    const targets = new Map();
    for (const entry of entries) {
      if (!entry.documentId) continue;
      targets.set(entry.documentId, entry);
    }

    const result = {
      checked: targets.size,
      unpublished: 0,
      alreadyUnpublished: 0,
      skippedActive: 0,
      failed: 0,
      routes: [],
      expiredAtOrBefore: now.toISOString(),
      legacyCreatedBefore: createdAtCutoff.toISOString(),
    };

    await forEachWithConcurrency(
      Array.from(targets.values()),
      CLEANUP_CONCURRENCY,
      async (target) => {
        try {
          const current = await strapi.db.query(HAPPY_BIRTHDAY_UID).findOne({
            where: {
              documentId: target.documentId,
              publishedAt: { $notNull: true },
            },
          });

          if (!current) {
            result.alreadyUnpublished += 1;
            return;
          }

          // Re-read immediately before unpublishing so a concurrent update
          // cannot make the cleanup decision from stale data. A trigger time
          // starts the 24-hour window, so a celebration created earlier stays
          // published until 24 hours after it opens.
          const effectiveExpiry = celebrationWindowEndMs(current);
          if (Number.isFinite(effectiveExpiry) && effectiveExpiry > Date.now()) {
            result.skippedActive += 1;
            return;
          }

          const unpublished = await this.unpublishCelebration(target.documentId);
          if (!unpublished) result.alreadyUnpublished += 1;
          else {
            result.unpublished += 1;
            if (unpublished.customroute) result.routes.push(unpublished.customroute);
          }
        } catch (error) {
          result.failed += 1;
          strapi.log.error(
            `Failed to unpublish celebration ${target.documentId}: ${errorMessage(
              error
            )}`
          );
        }
      }
    );

    result.routes = [...new Set(result.routes)];

    if (result.unpublished || result.failed) {
      strapi.log.info(
        `Celebration expiry checked ${result.checked}, unpublished ${result.unpublished}, and failed ${result.failed}.`
      );
    }

    return result;
  },
}));
