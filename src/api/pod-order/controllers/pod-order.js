'use strict';
module.exports = ({ strapi }) => ({
  async state(ctx) {
    ctx.set('Cache-Control', 'no-store');
    try { ctx.body = { ok:true, ...await strapi.service('api::pod-order.pod-order').state(ctx.request.body) }; }
    catch (error) {
      if (error.message === 'invalid_request') return ctx.badRequest('Invalid POD request');
      if (error.message === 'state_conflict') return ctx.conflict('Order state changed');
      return ctx.serviceUnavailable('Order storage unavailable');
    }
  },
});
