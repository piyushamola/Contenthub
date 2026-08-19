'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController(
  'api::payment-webhook-event.payment-webhook-event'
);
