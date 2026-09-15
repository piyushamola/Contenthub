'use strict';

const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';

module.exports = {
  expireCelebrations: {
    task: async ({ strapi }) => {
      const result = await strapi
        .service(HAPPY_BIRTHDAY_UID)
        .unpublishExpired();

      if (result.failed > 0) {
        throw new Error(
          `Celebration expiry finished with ${result.failed} failed item(s)`
        );
      }
    },
    options: {
      // At second 0, minute 5 of every hour (UTC).
      rule: '0 5 * * * *',
      tz: 'UTC',
    },
  },
};
