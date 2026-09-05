'use strict';

const scope = (action) =>
  `api::celebration-purchase.celebration-purchase.${action}`;

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/celebration-payments/access/:slug',
      handler: 'celebration-purchase.access',
      config: { auth: { scope: [scope('access')] } },
    },
    {
      method: 'POST',
      path: '/celebration-payments/orders',
      handler: 'celebration-purchase.createOrder',
      config: { auth: { scope: [scope('createOrder')] } },
    },
    {
      method: 'POST',
      path: '/celebration-payments/verify',
      handler: 'celebration-purchase.verify',
      config: { auth: { scope: [scope('verify')] } },
    },
    {
      method: 'GET',
      path: '/celebration-payments/status/:purchaseId',
      handler: 'celebration-purchase.status',
      config: { auth: { scope: [scope('status')] } },
    },
    {
      method: 'POST',
      path: '/celebration-payments/webhook',
      handler: 'celebration-purchase.webhook',
      config: { auth: { scope: [scope('webhook')] } },
    },
  ],
};
