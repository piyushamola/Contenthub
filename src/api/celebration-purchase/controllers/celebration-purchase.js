'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::celebration-purchase.celebration-purchase';

function message(error) {
  return String(error?.message || error || 'Payment request failed');
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async pricing(ctx) {
    ctx.body = await strapi.service('api::premium-pricing.premium-pricing').currentPrices();
  },

  async access(ctx) {
    const result = await strapi.service(UID).getAccess(ctx.params.slug);
    if (!result) return ctx.notFound('Celebration not found');
    ctx.body = result;
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
