'use strict';

/**
 * happy-birthday router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::happy-birthday.happy-birthday');
