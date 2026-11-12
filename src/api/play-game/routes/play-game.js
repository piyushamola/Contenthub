'use strict';

const config = {
  auth: {
    scope: ['api::celebration-purchase.celebration-purchase.createOrder'],
  },
  policies: ['api::play-game.play-server'],
};

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/play-games/create',
      handler: 'play-game.create',
      config,
    },
    {
      method: 'POST',
      path: '/play-games/hub',
      handler: 'play-game.hub',
      config,
    },
    {
      method: 'POST',
      path: '/play-games/:slug/read',
      handler: 'play-game.read',
      config,
    },
    {
      method: 'POST',
      path: '/play-games/:slug/submit',
      handler: 'play-game.submit',
      config,
    },
    {
      method: 'POST',
      path: '/play-games/:slug/remove',
      handler: 'play-game.remove',
      config,
    },
  ],
};
