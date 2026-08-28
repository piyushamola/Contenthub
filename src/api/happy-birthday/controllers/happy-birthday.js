'use strict';

/**
 * happy-birthday controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';

module.exports = createCoreController(HAPPY_BIRTHDAY_UID, ({ strapi }) => ({
  async unpublishExpired(ctx) {
    const result = await strapi
      .service(HAPPY_BIRTHDAY_UID)
      .unpublishExpired();

    ctx.body = { data: result };
  },
}));
