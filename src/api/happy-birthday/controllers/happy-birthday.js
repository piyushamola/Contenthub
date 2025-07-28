'use strict';

/**
 * happy-birthday controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::happy-birthday.happy-birthday');
