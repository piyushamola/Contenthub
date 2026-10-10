'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::celebration-purchase.celebration-purchase';

function message(error) {
  const cause = error?.cause;
  const detail = [cause?.code, cause?.message].filter(Boolean).join(': ');
  const base = String(error?.message || error || 'Payment request failed');
  return (detail ? `${base}: ${detail}` : base).slice(0, 1000);
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async pricing(ctx) {
    const pricing = strapi.service('api::premium-pricing.premium-pricing');
    ctx.body = ctx.query.product === 'story' ? await pricing.storySettings() : await pricing.currentPrices();
  },

  async access(ctx) {
    const slug = String(ctx.params.slug || '');
    // A missing or nonsensical route is a normal page view, not a service failure.
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/i.test(slug)) {
      ctx.body = { found: false, unlocked: false, features: [], journeyType: 'standard', expiresAt: null, amountPaise: 0, currency: 'INR', ownerId: null };
      return;
    }
    const result = await strapi.service(UID).getAccess(slug);
    if (!result) {
      ctx.body = { found: false, unlocked: false, features: [], journeyType: 'standard', expiresAt: null, amountPaise: 0, currency: 'INR', ownerId: null };
      return;
    }
    ctx.body = { found: true, ...result };
  },

  async createOrder(ctx) {
    try {
      // Note: this route is authenticated with a server-only API token, so
      // ctx.state.user is not populated here. When the creator is logged in,
      // the trusted Next.js server includes `ownerId` in the request body
      // (derived from its own verified session) and the service persists it.
      ctx.body = await strapi.service(UID).createOrder(ctx.request.body || {});
    } catch (error) {
      strapi.log.error(`Create celebration order failed: ${message(error)}`);
      return ctx.badRequest(message(error));
    }
  },

  async verify(ctx) {
    try {
      ctx.body = await strapi.service(UID).verifyPayment(ctx.request.body || {});
    } catch (error) {
      strapi.log.error(`Verify celebration payment failed: ${message(error)}`);
      return ctx.badRequest(message(error));
    }
  },

  async status(ctx) {
    const result = await strapi.service(UID).getStatus(ctx.params.purchaseId);
    if (!result) return ctx.notFound('Purchase not found');
    ctx.body = result;
  },

  async webhook(ctx) {
    try {
      ctx.body = await strapi.service(UID).processWebhook(ctx.request.body || {});
    } catch (error) {
      strapi.log.error(`Process Razorpay webhook failed: ${message(error)}`);
      return ctx.internalServerError('Webhook could not be processed');
    }
  },
}));
