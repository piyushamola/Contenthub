'use strict';

module.exports = ({ strapi }) => ({
  async create(ctx) {
    try {
      ctx.body = await strapi.service('api::happy-birthday.celebration-wish')
        .addWish(ctx.params.slug, ctx.request.body);
    } catch (error) {
      if (error.status === 400) return ctx.badRequest(error.message);
      if (error.status === 403) return ctx.forbidden(error.message);
      if (error.status === 404) return ctx.notFound(error.message);
      strapi.log.error('Could not save a celebration wish');
      return ctx.internalServerError('Could not save your wish. Please try again.');
    }
  },
  async open(ctx) {
    try {
      ctx.body = await strapi.service('api::happy-birthday.celebration-wish')
        .recordOpen(ctx.params.slug);
    } catch (error) {
      if (error.status === 400) return ctx.badRequest(error.message);
      if (error.status === 403) return ctx.forbidden(error.message);
      if (error.status === 404) return ctx.notFound(error.message);
      strapi.log.error('Could not record celebration open');
      return ctx.internalServerError('Could not record celebration open.');
    }
  },
});
