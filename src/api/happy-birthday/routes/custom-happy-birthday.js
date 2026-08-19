'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/happy-birthdays/:documentId/go-live',
      handler: 'happy-birthday.goLive',
      config: {
        auth: true,
      },
    },
  ],
};
