'use strict';

/**
 * happy-birthday router
 *
 * Custom dashboard/ownership routes are declared first because Strapi/Koa
 * matches routes in registration order. If the core router's dynamic
 * "/happy-birthdays/:id" route were registered first, a request to
 * "/happy-birthdays/mine" would incorrectly match it with id="mine".
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

const UID = 'api::happy-birthday.happy-birthday';

const customRoutes = [
  {
    method: 'GET',
    path: '/happy-birthdays/mine',
    handler: 'happy-birthday.mine',
    config: { policies: [] },
  },
  {
    method: 'GET',
    path: '/happy-birthdays/all',
    handler: 'happy-birthday.all',
    config: { policies: ['api::happy-birthday.is-admin'] },
  },
  {
    method: 'PUT',
    path: '/happy-birthdays/:documentId/pause',
    handler: 'happy-birthday.pause',
    config: { policies: ['api::happy-birthday.is-owner-or-admin'] },
  },
  {
    method: 'PUT',
    path: '/happy-birthdays/:documentId/resume',
    handler: 'happy-birthday.resume',
    config: { policies: ['api::happy-birthday.is-owner-or-admin'] },
  },
  {
    method: 'PUT',
    path: '/happy-birthdays/:documentId/delete',
    handler: 'happy-birthday.deleteCelebration',
    config: { policies: ['api::happy-birthday.is-owner-or-admin'] },
  },
];

module.exports = {
  // `routes` must stay a lazily-evaluated getter: createCoreRouter(UID).routes
  // itself is a getter that reads the content-type registry, which is not
  // fully populated yet at the moment this file is first required during
  // Strapi's API-loading phase. Strapi only reads this property later, once
  // loading is complete, so deferring the core router creation until then
  // avoids a "Cannot read properties of undefined (reading 'kind')" crash.
  get routes() {
    return [...customRoutes, ...createCoreRouter(UID).routes];
  },
};
