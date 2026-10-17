'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { errors } = require('@strapi/utils');
const createMiddleware = require('../src/middlewares/api-failure-log');

function fixture(overrides = {}) {
  const logs = [];
  const headers = {};
  const ctx = {
    path: '/api/happy-birthdays', method: 'POST', status: 200,
    querystring: 'status=published&filters[customroute][$eqi]=private-birthday',
    state: { auth: { strategy: { name: 'api-token' } } },
    get: () => 'Bearer secret-token',
    set: (name, value) => { headers[name] = value; },
    ...overrides,
  };
  const middleware = createMiddleware({}, { strapi: { log: Object.fromEntries(
    ['warn', 'error'].map((level) => [level, (line) => logs.push({ level, record: JSON.parse(line.slice('[api_request_failed] '.length)), line })]),
  ) } });
  return { ctx, logs, headers, middleware };
}

test('successful and unrelated requests produce no failure logs or diagnostic headers', async () => {
  for (const overrides of [{}, { path: '/api/blog-articles', status: 500 }, { path: '/api/happy-birthdays-other', status: 400 }]) {
    const f = fixture(overrides);
    let calls = 0;
    await f.middleware(f.ctx, async () => { calls++; });
    assert.equal(calls, 1);
    assert.deepEqual(f.logs, []);
    assert.deepEqual(f.headers, {});
  }
});

test('returned failures log once with safe query shape and preserve the response', async () => {
  const f = fixture({ status: 400, body: { error: { name: 'ValidationError', message: 'Invalid key message' } } });
  const originalBody = f.ctx.body;
  await f.middleware(f.ctx, async () => {});
  assert.equal(f.ctx.status, 400);
  assert.equal(f.ctx.body, originalBody);
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0].level, 'warn');
  const record = f.logs[0].record;
  assert.equal(record.event, 'api_request_failed');
  assert.equal(record.method, 'POST');
  assert.equal(record.endpoint, '/api/happy-birthdays');
  assert.equal(record.reason, 'invalid_field');
  assert.equal(record.invalidField, 'message');
  assert.equal(record.publicationStatus, 'published');
  assert.equal(record.lookupBy, 'customroute');
  assert.equal(record.authStrategy, 'api-token');
  assert.equal(record.requestId, f.headers['X-Contenthub-Request-Id']);
  assert.match(record.requestId, /^[0-9a-f-]{36}$/);
  assert.ok(record.durationMs >= 0);
  assert.doesNotMatch(f.logs[0].line, /secret-token|private-birthday/);
});

test('thrown Strapi and HTTP errors keep their real status and original exception', async () => {
  for (const [error, status, reason] of [
    [new errors.ValidationError('Invalid key message'), 400, 'invalid_field'],
    [new errors.UnauthorizedError(), 401, 'authentication_failed'],
    [new errors.PolicyError(), 403, 'access_denied'],
    [new errors.NotFoundError(), 404, 'not_found'],
    [new errors.PayloadTooLargeError(), 413, 'payload_too_large'],
    [new errors.RateLimitError(), 429, 'rate_limited'],
    [new errors.NotImplementedError(), 501, 'internal_error'],
    [Object.assign(new Error('duplicate'), { status: 409 }), 409, 'conflict'],
    [Object.assign(new Error('unavailable'), { statusCode: 503 }), 503, 'internal_error'],
    [Object.assign(new Error('database down'), { code: 'ECONNREFUSED' }), 500, 'internal_error'],
  ]) {
    const f = fixture();
    await assert.rejects(f.middleware(f.ctx, async () => { throw error; }), (actual) => actual === error);
    assert.equal(f.logs.length, 1);
    assert.equal(f.logs[0].record.status, status);
    assert.equal(f.logs[0].record.reason, reason);
    assert.equal(f.logs[0].level, status >= 500 ? 'error' : 'warn');
    if (error.code) assert.equal(f.logs[0].record.errorCode, error.code);
  }
});

test('auth rejection and owner routes are logged without private path segments or payloads', async () => {
  for (const [path, route] of [
    ['/api/users/me', '/api/users/me'],
    ['/api/happy-birthdays/mine', '/api/happy-birthdays/mine'],
    ['/api/happy-birthdays/all', '/api/happy-birthdays/all'],
    ['/api/happy-birthdays/private-document/pause', '/api/happy-birthdays/:documentId/pause'],
    ['/api/happy-birthdays/private-document', '/api/happy-birthdays/:documentId'],
  ]) {
    const f = fixture({ path, status: 403, state: {}, get: () => '', request: { body: { email: 'private@example.test', password: 'private-password' } } });
    await f.middleware(f.ctx, async () => {});
    assert.equal(f.logs[0].record.route, route);
    assert.equal(f.logs[0].record.hasAuthorization, false);
    assert.equal(f.logs[0].record.reason, 'access_denied');
    assert.doesNotMatch(f.logs[0].line, /private-document|private@example|private-password/);
  }
});

test('untrusted error text, names, fields, query values and database details are excluded', async () => {
  const f = fixture({
    status: 400, querystring: 'status=private-status&email=private@example.test',
    body: { error: { name: 'private-name', message: 'Invalid key privateField at private@example.test', code: 'private-code', details: { sql: 'private-query' } } },
  });
  await f.middleware(f.ctx, async () => {});
  assert.equal(f.logs[0].record.errorName, 'Error');
  assert.equal(f.logs[0].record.invalidField, 'unknown');
  assert.equal(f.logs[0].record.publicationStatus, 'other');
  assert.doesNotMatch(f.logs[0].line, /private/);
});

test('validation field names are useful without logging rejected values or custom fields', async () => {
  const error = new errors.ValidationError('private value', { errors: [
    { path: ['personemail'], value: 'private@example.test', message: 'private validation' },
    { path: 'templateId', value: 'private-template' },
    { path: ['private-field'], value: 'private-content' },
    { path: ['personemail'], value: 'private@example.test' },
  ] });
  const f = fixture();
  await assert.rejects(f.middleware(f.ctx, async () => { throw error; }), (actual) => actual === error);
  assert.deepEqual(f.logs[0].record.validationFields, ['personemail', 'templateId']);
  assert.doesNotMatch(f.logs[0].line, /private/);
});

test('a non-Error thrown value is still recorded as a server failure and rethrown', async () => {
  const f = fixture();
  let caught = false;
  try {
    await f.middleware(f.ctx, async () => { throw null; });
  } catch (error) {
    caught = true;
    assert.equal(error, null);
  }
  assert.equal(caught, true);
  assert.equal(f.logs[0].record.status, 500);
});

test('logging failure cannot replace a response or the original thrown error', async () => {
  const middleware = createMiddleware({}, { strapi: { log: {
    warn: () => { throw new Error('logger failed'); },
    error: () => { throw new Error('logger failed'); },
  } } });
  const f = fixture({ status: 403 });
  await middleware(f.ctx, async () => {});
  assert.equal(f.ctx.status, 403);
  const error = new Error('original');
  await assert.rejects(middleware(f.ctx, async () => { throw error; }), (actual) => actual === error);
});
