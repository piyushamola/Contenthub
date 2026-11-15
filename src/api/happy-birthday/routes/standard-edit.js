'use strict';
module.exports = {
  routes: ['read', 'attach', 'save', 'discard'].map(action => ({
    method: 'POST', path: `/standard-celebrations/:documentId/${action}`, handler: `standard-edit.${action}`,
    config: { auth: { scope: ['api::celebration-purchase.celebration-purchase.createOrder'] }, policies: ['api::happy-birthday.story-server'] },
  })),
};
