'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::currency-pricing.currency-pricing');
