'use strict';

const assert = require('node:assert/strict');

// Exercise the real router, JWT authentication, policies and JSON contracts.
// The server binds only to loopback and gets an unused port from the OS.
module.exports = async function checkHttpContracts(app, user, celebration) {
  await new Promise((resolve, reject) => {
    app.server.httpServer.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api`;
  async function request(route, { token, method = 'GET', body } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    return {
      status: response.status, body: await response.json(),
      failureRequestId: response.headers.get('x-contenthub-request-id'),
    };
  }

  async function captureFailures(action) {
    const logs = [];
    const originals = { warn: app.log.warn, error: app.log.error };
    for (const level of Object.keys(originals)) {
      app.log[level] = function (...args) {
        if (typeof args[0] === 'string' && args[0].startsWith('[api_request_failed] ')) {
          logs.push({ level, ...JSON.parse(args[0].slice('[api_request_failed] '.length)) });
        }
        return originals[level].apply(this, args);
      };
    }
    try {
      return { response: await action(), logs };
    } finally {
      Object.assign(app.log, originals);
    }
  }

  const { response: anonymous, logs: anonymousLogs } = await captureFailures(() => request('/happy-birthdays/mine'));
  assert.equal(anonymous.status, 403, 'Dashboard requires authentication');
  assert.equal(anonymousLogs.length, 1, 'Middleware must capture failures rejected before the controller');
  assert.equal(anonymousLogs[0].status, anonymous.status);
  assert.equal(anonymousLogs[0].route, '/api/happy-birthdays/mine');
  assert.equal(anonymousLogs[0].requestId, anonymous.failureRequestId);
  assert.equal(anonymousLogs[0].hasAuthorization, false);
  const { response: invalidSession, logs: sessionLogs } = await captureFailures(() => request('/users/me', { token: 'regression-invalid-jwt' }));
  assert.equal(invalidSession.status, 401);
  assert.equal(sessionLogs.length, 1);
  assert.equal(sessionLogs[0].endpoint, '/api/users/me');
  assert.equal(sessionLogs[0].reason, 'authentication_failed');
  assert.equal(sessionLogs[0].requestId, invalidSession.failureRequestId);
  assert.equal(sessionLogs[0].hasAuthorization, true);
  const password = 'RegressionOnly-Password42!';
  await app.plugin('users-permissions').service('user').edit(user.id, { password });
  const rejectedLogin = await request('/auth/local', {
    method: 'POST', body: { identifier: user.email, password: 'incorrect-password' },
  });
  assert.equal(rejectedLogin.status, 400);
  const login = await request('/auth/local', {
    method: 'POST', body: { identifier: user.email, password },
  });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.jwt, 'string');
  assert.equal(login.body.user.id, user.id);
  assert.equal(Object.hasOwn(login.body.user, 'password'), false);
  const token = login.body.jwt;

  const me = await request('/users/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.id, user.id);
  assert.equal(Object.hasOwn(me.body, 'password'), false);
  const mine = await request('/happy-birthdays/mine?pageSize=50', { token });
  assert.equal(mine.status, 200);
  assert.ok(Array.isArray(mine.body.data));
  assert.ok(mine.body.data.some((entry) => entry.documentId === celebration.documentId));
  assert.ok(mine.body.data.every((entry) => entry.owner.id === user.id));
  assert.equal(mine.body.meta.pagination.pageSize, 50);
  assert.equal(mine.body.meta.pagination.total, mine.body.data.length);
  assert.equal((await request('/happy-birthdays/all', { token })).status, 403);

  const role = await app.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
  const other = await app.db.query('plugin::users-permissions.user').create({
    data: { username: 'http-other', email: 'http-other@example.invalid', provider: 'local', confirmed: true, role: role.id },
  });
  const otherToken = app.plugin('users-permissions').service('jwt').issue({ id: other.id });
  const othersDashboard = await request('/happy-birthdays/mine', { token: otherToken });
  assert.equal(othersDashboard.status, 200);
  assert.deepEqual(othersDashboard.body.data, []);
  const pauseRoute = `/happy-birthdays/${celebration.documentId}/pause`;
  assert.equal((await request(pauseRoute, { token: otherToken, method: 'PUT' })).status, 403);
  const paused = await request(pauseRoute, { token, method: 'PUT' });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.data.status, 'paused');
  const resumed = await request(`/happy-birthdays/${celebration.documentId}/resume`, { token, method: 'PUT' });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.data.status, 'active');

  assert.equal((await request('/celebration-payments/pricing')).status, 403);
  const serverToken = await app.admin.services['api-token'].create({
    name: 'regression-only', description: 'Temporary test database only', type: 'full-access', lifespan: null,
  });
  await require('./pod-regression.cjs')(app, base, token, serverToken.accessKey);
  const pricing = await request('/celebration-payments/pricing', { token: serverToken.accessKey });
  assert.equal(pricing.status, 200);
  assert.deepEqual(pricing.body, { INR: 900, USD: 100, originalINR: null, originalUSD: null });
  const storyPricing = await request('/celebration-payments/pricing?product=story', { token: serverToken.accessKey });
  assert.equal(storyPricing.status, 200);
  assert.deepEqual(storyPricing.body, { INR: 3600, USD: 500, originalINR: null, originalUSD: null });
  await require('./premium-pricing-regression.cjs')(app, user, celebration, request, serverToken.accessKey);
  await require('./story-from-standard-regression.cjs')(app, user, request, serverToken.accessKey, token, other.id);
  const standardData = {
    personname: 'HTTP Standard', personemail: 'http-standard@example.invalid',
    hostname: 'Regression Creator', hostemail: user.email, owner: user.id,
    customroute: 'http-standard-create-contract', country: 'IN',
    birthdaymessages: ['Happy birthday!', 'First memory', 'Second memory', 'Third memory'],
    templateId: 'classic', musicId: 'none',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  const { response: unsupportedHeadline, logs: validationLogs } = await captureFailures(() => request('/happy-birthdays?status=published', {
    token: serverToken.accessKey, method: 'POST',
    body: { data: { ...standardData, message: 'Happy birthday!' } },
  }));
  assert.equal(unsupportedHeadline.status, 400, 'A separate message attribute is not in the CMS schema');
  assert.match(unsupportedHeadline.body.error.message, /message/i);
  assert.equal(validationLogs.length, 1);
  assert.equal(validationLogs[0].reason, 'invalid_field');
  assert.equal(validationLogs[0].invalidField, 'message');
  assert.equal(validationLogs[0].status, unsupportedHeadline.status);
  assert.equal(validationLogs[0].requestId, unsupportedHeadline.failureRequestId);
  assert.ok(['api-token', 'content-api-token'].includes(validationLogs[0].authStrategy));
  assert.equal(JSON.stringify(validationLogs).includes(serverToken.accessKey), false);
  assert.equal(JSON.stringify(validationLogs).includes(user.email), false);
  const { response: standardCreated, logs: successLogs } = await captureFailures(() => request('/happy-birthdays?status=published', {
    token: serverToken.accessKey, method: 'POST', body: { data: standardData },
  }));
  assert.equal(standardCreated.status, 201, 'The frontend payload must succeed on its first schema-valid write');
  assert.deepEqual(successLogs, []);
  assert.equal(standardCreated.failureRequestId, null);
  assert.deepEqual(standardCreated.body.data.birthdaymessages, standardData.birthdaymessages);
  const storedStandard = await app.documents('api::happy-birthday.happy-birthday').findOne({
    documentId: standardCreated.body.data.documentId, status: 'published', populate: ['owner'],
  });
  assert.deepEqual(storedStandard.birthdaymessages, standardData.birthdaymessages);
  assert.equal(storedStandard.owner.id, user.id);
  assert.ok(storedStandard.publishedAt);
  for (const customroute of ['a', 'ab']) {
    const shortRoute = await request('/happy-birthdays?status=published', {
      token: serverToken.accessKey, method: 'POST',
      body: { data: { ...standardData, customroute } },
    });
    assert.equal(shortRoute.status, 400, 'Strapi must keep the three-character minimum');
    assert.match(shortRoute.body.error.message, /customroute must be at least 3 characters/);
    assert.equal(await app.db.query('api::happy-birthday.happy-birthday').count({ where: { customroute } }), 0);
  }
  const minimumRoute = await request('/happy-birthdays?status=published', {
    token: serverToken.accessKey, method: 'POST',
    body: { data: { ...standardData, customroute: 'abc' } },
  });
  assert.equal(minimumRoute.status, 201, 'A valid three-character route is supported');
  assert.equal(minimumRoute.body.data.customroute, 'abc');
  const duplicate = await request('/happy-birthdays', {
    token: serverToken.accessKey,
    method: 'POST',
    body: { data: {
      personname: 'Duplicate',
      personemail: user.email,
      hostname: 'Regression Creator',
      hostemail: user.email,
      customroute: celebration.customroute,
      birthdaymessages: ['One', 'Two', 'Three'],
      templateId: 'classic',
      musicId: 'none',
      country: 'IN',
    } },
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error.message, /already taken/i);

  const access = await request(`/celebration-payments/access/${celebration.customroute}`, { token: serverToken.accessKey });
  assert.equal(access.status, 200);
  assert.equal(access.body.ownerId, user.id);
  assert.equal(access.body.unlocked, false);
  assert.equal(access.body.amountPaise, 900);
  assert.deepEqual(access.body.features, ['collage']);
  assert.equal(typeof access.body.contentVersion, 'string');
  const updated = await request(`/happy-birthdays/${celebration.documentId}`, {
    token: serverToken.accessKey, method: 'PUT',
    body: { data: { guestwishes: [{ name: 'HTTP guest', message: 'A persisted birthday wish' }] } },
  });
  assert.equal(updated.status, 200);
  const afterWish = await request(`/celebration-payments/access/${celebration.customroute}`, { token: serverToken.accessKey });
  assert.equal(afterWish.status, 200);
  assert.equal(typeof afterWish.body.contentVersion, 'string');
  assert.notEqual(afterWish.body.contentVersion, access.body.contentVersion);
  const publicRead = await request(`/happy-birthdays?filters[customroute][$eqi]=${celebration.customroute}&status=published`, { token: serverToken.accessKey });
  assert.equal(publicRead.status, 200);
  assert.ok(publicRead.body.data.some(entry => entry.guestwishes.some(wish => wish.message === 'A persisted birthday wish')));
  assert.equal((await request('/birthday-stories', {
    token, method: 'POST', body: { ownerId: user.id },
  })).status, 403, 'A browser JWT cannot call internal story endpoints');
  console.log('PASS: real HTTP login, users/me, dashboard ownership, pause/resume, API-token pricing and access contracts.');
};
