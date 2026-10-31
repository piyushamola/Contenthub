'use strict';

const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';

module.exports = {
  purgeRetainedCelebrations: {
    task: async ({ strapi }) => {
      const result = await require('../src/privacy/celebration-erasure').purgeRetained(strapi);
      if (result.failed) throw new Error('Privacy cleanup has pending erasures; review server logs');
    },
    options: { rule: '0 35 * * * *', tz: 'UTC' },
  },
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
