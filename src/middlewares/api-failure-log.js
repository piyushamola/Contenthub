'use strict';

const { randomUUID } = require('node:crypto');
const { errors } = require('@strapi/utils');
const schema = require('../api/happy-birthday/content-types/happy-birthday/schema.json');

const PREFIX = '[api_request_failed] ';
const knownFields = new Set([
  ...Object.keys(schema.attributes), 'message', 'documentId', 'id',
  'filters', 'populate', 'fields', 'status', 'pagination', 'sort',
]);
const knownNames = new Set([
  'Error', 'ApplicationError', 'ValidationError', 'PaginationError',
  'UnauthorizedError', 'ForbiddenError', 'PolicyError', 'NotFoundError',
  'PayloadTooLargeError', 'RateLimitError', 'NotImplementedError',
  'BadRequestError', 'InternalServerError',
]);

function requestRoute(path) {
  if (/^\/api\/users\/me\/?$/.test(path)) return { endpoint: '/api/users/me', route: '/api/users/me' };
  if (!/^\/api\/happy-birthdays(?:\/|$)/.test(path)) return null;
  const parts = path.slice('/api/happy-birthdays'.length).split('/').filter(Boolean);
  const suffix = !parts.length ? ''
    : parts.length === 1 && ['mine', 'all'].includes(parts[0]) ? `/${parts[0]}`
      : parts.length === 1 ? '/:documentId'
        : parts.length === 2 && ['pause', 'resume', 'delete'].includes(parts[1]) ? `/:documentId/${parts[1]}`
          : '/:unmatched';
  return { endpoint: '/api/happy-birthdays', route: `/api/happy-birthdays${suffix}` };
}

// Match the status mapping used by Strapi's outer errors middleware. In
// particular, ApplicationError subclasses do not carry an HTTP status.
function thrownStatus(error) {
  if (error instanceof errors.ApplicationError) {
    for (const [type, status] of [
      [errors.UnauthorizedError, 401], [errors.ForbiddenError, 403],
      [errors.NotFoundError, 404], [errors.PayloadTooLargeError, 413],
      [errors.RateLimitError, 429], [errors.NotImplementedError, 501],
    ]) if (error instanceof type) return status;
    return 400;
  }
  const status = error?.status || error?.statusCode;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function safeError(error, status) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const invalidKey = /Invalid key ([a-zA-Z_][a-zA-Z0-9_]*)\b/.exec(message)?.[1];
  let reason = status >= 500 ? 'internal_error' : 'request_rejected';
  if (status === 400) reason = invalidKey ? 'invalid_field' : 'validation_failed';
  if (status === 401) reason = 'authentication_failed';
  if (status === 403) reason = 'access_denied';
  if (status === 404) reason = 'not_found';
  if (status === 409) reason = 'conflict';
  if (status === 413) reason = 'payload_too_large';
  if (status === 429) reason = 'rate_limited';
  const code = error?.code || error?.cause?.code;
  const validationFields = Array.isArray(error?.details?.errors)
    ? [...new Set(error.details.errors.slice(0, 8).map((item) => {
      const path = item?.path;
      return Array.isArray(path) ? path[0] : typeof path === 'string' ? path.split('.')[0] : null;
    }).filter((field) => knownFields.has(field)))] : [];
  return {
    errorName: knownNames.has(error?.name) ? error.name : 'Error',
    reason,
    ...(invalidKey ? { invalidField: knownFields.has(invalidKey) ? invalidKey : 'unknown' } : {}),
    ...(validationFields.length ? { validationFields } : {}),
    ...(['23505', '23502', '23503', '53300', '57P01', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'SQLITE_BUSY', 'SQLITE_CONSTRAINT'].includes(code) ? { errorCode: code } : {}),
  };
}

module.exports = (_config, { strapi }) => async (ctx, next) => {
  const route = requestRoute(ctx.path);
  if (!route) return next();
  const started = performance.now();
  let failure;
  let didThrow = false;
  try {
    await next();
  } catch (error) {
    failure = error;
    didThrow = true;
    throw error;
  } finally {
    const status = didThrow ? thrownStatus(failure) : ctx.status;
    if (status >= 400) {
      // Diagnostics must never change the original response or exception.
      try {
        const requestId = randomUUID();
        ctx.set('X-Contenthub-Request-Id', requestId);
        const query = new URLSearchParams(ctx.querystring || '');
        const publicationStatus = query.get('status');
        const strategy = ctx.state.auth?.strategy?.name;
        const record = {
          event: 'api_request_failed', requestId, ...route,
          method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(ctx.method) ? ctx.method : 'OTHER',
          status, durationMs: Math.max(0, Math.round(performance.now() - started)),
          authStrategy: ['api-token', 'content-api-token', 'users-permissions'].includes(strategy) ? strategy : 'unknown',
          hasAuthorization: Boolean(ctx.get('authorization')),
          publicationStatus: publicationStatus === null ? 'default' : ['published', 'draft'].includes(publicationStatus) ? publicationStatus : 'other',
          lookupBy: query.has('filters[customroute][$eqi]') || query.has('filters[customroute][$eq]') ? 'customroute'
            : query.has('filters[documentId][$eq]') ? 'documentId' : 'other',
          ...safeError(failure || ctx.body?.error, status),
        };
        strapi.log[status >= 500 ? 'error' : 'warn'](PREFIX + JSON.stringify(record));
      } catch {
        // A logger/transport failure must not break a CMS request.
      }
    }
  }
};
