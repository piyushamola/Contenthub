'use strict';

// Owner ids on these internal endpoints come only from the Next.js session.
module.exports = (ctx) =>
  ['api-token', 'content-api-token'].includes(ctx.state.auth?.strategy?.name);
