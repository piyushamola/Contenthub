'use strict';
module.exports = { routes: ['intake','review','work'].map(action => ({ method: 'POST',
  path: '/shopify-mug-orders/' + action, handler: 'shopify-mug-order.' + action,
  config: { auth: { scope: ['api::shopify-mug-order.shopify-mug-order.' + action] },
    policies: [{ name: 'api::shopify-mug-order.mug-relay', config: { action: 'api::shopify-mug-order.shopify-mug-order.' + action } }] } })) };
