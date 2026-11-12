'use strict';

// Isolated server-token policy for Play Together endpoints.
module.exports = (ctx) =>
  ['api-token', 'content-api-token'].includes(ctx.state.auth?.strategy?.name);
