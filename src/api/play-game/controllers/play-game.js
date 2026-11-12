'use strict';

const service = (strapi) => strapi.service('api::play-game.play-game');

function handleError(ctx, error, fallback) {
  const status = error?.status || 400;
  const message = error?.message || fallback;
  if (status === 404) return ctx.notFound(message);
  if (status === 403) return ctx.forbidden(message);
  return ctx.badRequest(message);
}

module.exports = ({ strapi }) => ({
  async create(ctx) {
    try {
      ctx.body = await service(strapi).createGame(ctx.request.body || {});
    } catch (error) {
      return handleError(ctx, error, 'Could not create game');
    }
  },

  async hub(ctx) {
    try {
      ctx.body = await service(strapi).getUserHub(ctx.request.body || {});
    } catch (error) {
      return handleError(ctx, error, 'Could not load play hub');
    }
  },

  async read(ctx) {
    try {
      ctx.body = await service(strapi).readGame(ctx.params.slug, ctx.request.body || {});
    } catch (error) {
      return handleError(ctx, error, 'Game not found');
    }
  },

  async submit(ctx) {
    try {
      ctx.body = await service(strapi).submitPlay(ctx.params.slug, ctx.request.body || {});
    } catch (error) {
      return handleError(ctx, error, 'Could not save game score');
    }
  },

  async remove(ctx) {
    try {
      ctx.body = await service(strapi).removeGameCard(ctx.params.slug, ctx.request.body || {});
    } catch (error) {
      return handleError(ctx, error, 'Could not remove game card');
    }
  },
});
