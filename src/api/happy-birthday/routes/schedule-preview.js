'use strict';

module.exports = {
  routes: [{
    method: 'POST',
    path: '/celebration-schedule/preview',
    handler: 'schedule-preview.preview',
    config: {
      auth: { scope: ['api::celebration-purchase.celebration-purchase.createOrder'] },
      policies: ['api::happy-birthday.story-server'],
    },
  }],
};
