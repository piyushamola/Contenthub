'use strict';

module.exports = {
  routes: [{
    method: 'POST',
    path: '/celebration-wishes/:slug',
    handler: 'celebration-wish.create',
    config: {
      auth: { scope: ['api::celebration-purchase.celebration-purchase.createOrder'] },
      policies: ['api::happy-birthday.story-server'],
    },
  }],
};
