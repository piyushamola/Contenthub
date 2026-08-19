'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService(
  'api::payment-webhook-event.payment-webhook-event'
);
