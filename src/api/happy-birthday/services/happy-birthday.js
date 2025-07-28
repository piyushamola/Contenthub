'use strict';

/**
 * happy-birthday service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::happy-birthday.happy-birthday');
