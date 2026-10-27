'use strict';
const invalid = new Set(['invalid_event','invalid_asset','invalid_operation']);
const conflicts = new Set(['stale_revision','order_held','assets_required','lease_lost','state_conflict','submission_disabled']);
module.exports = ({ strapi }) => Object.fromEntries(['intake','review','work'].map(action => [action, async ctx => {
  ctx.set('Cache-Control', 'no-store');
  try { ctx.body = await strapi.service('api::shopify-mug-order.' + (action === 'intake' ? 'shopify-mug-order' : 'production'))[action](ctx.request.body); }
  catch (error) {
    if (invalid.has(error?.message)) return ctx.badRequest('Invalid mug request');
    if (error?.message === 'merchant_forbidden') return ctx.forbidden('Merchant access required');
    if (conflicts.has(error?.message)) return ctx.conflict('Mug state changed or is blocked');
    return ctx.serviceUnavailable('Mug service unavailable');
  }
}]));
