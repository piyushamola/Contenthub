'use strict';

/**
 * happy-birthday service
 */

const { createCoreService } = require('@strapi/strapi').factories;

const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';
const LIVE_DURATION_MS = 24 * 60 * 60 * 1000;
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
  /**
   * Unpublish celebrations created at least 24 hours ago.
   */
  async unpublishExpired() {
    const now = new Date();
    const createdAtCutoff = new Date(now.getTime() - LIVE_DURATION_MS);
    const entries = await strapi.db.query(HAPPY_BIRTHDAY_UID).findMany({
      where: {
        publishedAt: { $notNull: true },
        createdAt: { $lte: createdAtCutoff },
        ...(nonExpiringRoutes.length
          ? { customroute: { $notIn: nonExpiringRoutes } }
          : {}),
      },
      select: ['documentId', 'customroute', 'locale'],
      orderBy: { createdAt: 'asc' },
    });

    // Strapi can return one row per locale/version. De-duplicate before
    // mutating so duplicate or overlapping cron invocations stay idempotent.
    const targets = new Map();
    for (const entry of entries) {
      if (!entry.documentId) continue;
      const localeKey = entry.locale || '';
      targets.set(`${entry.documentId}:${localeKey}`, entry);
    }

    const result = {
      checked: targets.size,
      unpublished: 0,
      alreadyUnpublished: 0,
      failed: 0,
      routes: [],
      expiredAtOrBefore: now.toISOString(),
      legacyCreatedBefore: createdAtCutoff.toISOString(),
    };

    await forEachWithConcurrency(
      Array.from(targets.values()),
      CLEANUP_CONCURRENCY,
      async (target) => {
        const params = { documentId: target.documentId };
        if (target.locale) params.locale = target.locale;

        try {
          const published = await strapi.documents(HAPPY_BIRTHDAY_UID).findOne({
            ...params,
            status: 'published',
          });

          if (!published) {
            result.alreadyUnpublished += 1;
            return;
          }

          const unpublishResult = await strapi
            .documents(HAPPY_BIRTHDAY_UID)
            .unpublish(params);
          if (
            Array.isArray(unpublishResult?.entries) &&
            unpublishResult.entries.length === 0
          ) {
            result.alreadyUnpublished += 1;
          } else {
            result.unpublished += 1;
            if (target.customroute) result.routes.push(target.customroute);
          }
        } catch (error) {
          // Another invocation may have unpublished this document after our
          // findOne call. Treat that race as an idempotent success.
          try {
            const stillPublished = await strapi
              .documents(HAPPY_BIRTHDAY_UID)
              .findOne({ ...params, status: 'published' });

            if (!stillPublished) {
              result.alreadyUnpublished += 1;
              return;
            }
          } catch {
            // Preserve the original mutation error below.
          }

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
        `Expired celebration cleanup checked ${result.checked}, unpublished ${result.unpublished}, and failed ${result.failed}.`
      );
    }

    return result;
  },
}));
