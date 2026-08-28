'use strict';

/**
 * happy-birthday controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';
const LIVE_DURATION_MS = 24 * 60 * 60 * 1000;

module.exports = createCoreController(HAPPY_BIRTHDAY_UID, ({ strapi }) => ({
  async unpublishExpired(ctx) {
    const result = await strapi
      .service(HAPPY_BIRTHDAY_UID)
      .unpublishExpired();

    ctx.body = { data: result };
  },

  async goLive(ctx) {
    const { documentId } = ctx.params;
    const paymentRequired = Boolean(ctx.request.body?.paymentRequired);
    const countryCode = String(ctx.request.body?.countryCode || '')
      .trim()
      .toUpperCase()
      .slice(0, 2);

    if (!documentId) {
      return ctx.badRequest('Celebration documentId is required');
    }

    const existingPublished = await strapi
      .documents(HAPPY_BIRTHDAY_UID)
      .findOne({ documentId, status: 'published', populate: ['images'] });

    if (existingPublished) {
      ctx.body = { data: existingPublished };
      return;
    }

    const draft = await strapi.documents(HAPPY_BIRTHDAY_UID).findOne({
      documentId,
      status: 'draft',
    });

    if (!draft) {
      return ctx.notFound('Celebration draft not found');
    }

    const liveAt = new Date();
    const expiresAt = new Date(liveAt.getTime() + LIVE_DURATION_MS);

    await strapi.documents(HAPPY_BIRTHDAY_UID).update({
      documentId,
      status: 'draft',
      data: {
        paymentRequired,
        goLiveCountry: countryCode || null,
        expiresAt,
      },
    });

    await strapi.documents(HAPPY_BIRTHDAY_UID).publish({ documentId });

    const published = await strapi.documents(HAPPY_BIRTHDAY_UID).findOne({
      documentId,
      status: 'published',
      populate: ['images'],
    });

    ctx.body = { data: published };
  },
}));
