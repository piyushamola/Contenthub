'use strict';
module.exports = { routes: [{ method:'POST', path:'/pod-orders/state', handler:'pod-order.state',
  config:{ auth:{ scope:['api::pod-order.pod-order.state'] }, policies:['api::pod-order.relay'] } }] };
