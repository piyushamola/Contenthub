'use strict';
const service = (strapi) =>
  strapi.service('api::happy-birthday.birthday-story');
function action(strapi, run) {
  return async function (ctx) {
    try {
      ctx.body = await run(strapi, ctx, ctx.request.body || {});
    } catch (error) {
      return ctx.badRequest(error.message || 'Story request failed');
    }
  };
}
module.exports = ({ strapi }) => ({
  create: action(strapi, (s, c, b) =>
    service(s).create(b.ownerId, b.country, b.creationId),
  ),
  wish: action(strapi, (s, c, b) => service(s).addWish(c.params.slug, b)),
  read: action(strapi, (s, c, b) =>
    service(s).read(c.params.documentId, b.ownerId),
  ),
  save: action(strapi, (s, c, b) =>
    service(s).save(c.params.documentId, b.ownerId, b.content, b.revision, {
      triggerLocal: b.triggerLocal,
      browserTimeZone: b.browserTimeZone,
    }),
  ),
  attach: action(strapi, (s, c, b) =>
    service(s).attach(c.params.documentId, b.ownerId, b.fileId, b.duration),
  ),
  updatePublished: action(strapi, (s, c, b) =>
    service(s).updatePublished(c.params.documentId, b.ownerId, b.revision),
  ),
});
