'use strict';
function action(strapi, run) {
  return async function (ctx) {
    try { ctx.body = await run(strapi.service('api::happy-birthday.standard-edit'), ctx.params.documentId, ctx.request.body || {}); }
    catch (error) {
      ctx.status = Number.isInteger(error.status) ? error.status : 503;
      ctx.body = { error: { message: error.status ? error.message : 'Could not update the celebration. Try again.' } };
    }
  };
}
module.exports = ({ strapi }) => ({
  read: action(strapi, (service, id, body) => service.read(id, body.ownerId)),
  attach: action(strapi, (service, id, body) => service.attach(id, body.ownerId, body.fileId)),
  save: action(strapi, (service, id, body) => service.save(id, body.ownerId, body.content, body.revision)),
  discard: action(strapi, (service, id, body) => service.discard(id, body.ownerId, body.fileIds)),
});
