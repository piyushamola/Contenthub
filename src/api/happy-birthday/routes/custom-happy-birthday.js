'use strict';

const HAPPY_BIRTHDAY_SCOPE = 'api::happy-birthday.happy-birthday';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/happy-birthdays/actions/unpublish-expired',
      handler: 'happy-birthday.unpublishExpired',
      config: {
        auth: {
          scope: [`${HAPPY_BIRTHDAY_SCOPE}.unpublishExpired`],
        },
      },
    },
    {
      method: 'POST',
      path: '/happy-birthdays/:documentId/go-live',
      handler: 'happy-birthday.goLive',
      config: {
        auth: {
          scope: [`${HAPPY_BIRTHDAY_SCOPE}.goLive`],
        },
      },
    },
  ],
};
