'use strict';

const { timingSafeEqual } = require('node:crypto');

module.exports = (ctx, config = {}) => {
  if (!['api-token', 'content-api-token'].includes(ctx.state.auth?.strategy?.name)) return false;
  const credentials = ctx.state.auth.credentials;
  if (credentials?.type !== 'custom' || credentials.permissions?.length !== 1 ||
      credentials.permissions[0] !== (config.action || 'api::pod-order.pod-order.state')) return false;
  const expected = process.env.POD_RELAY_SECRET;
  const supplied = ctx.request.headers['x-pod-relay-secret'];
  if (!expected || expected.length < 32 || expected.length > 256 || typeof supplied !== 'string' || supplied.length > 256) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
};
