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
    return { status: response.status, body: await response.json() };
  }

  const anonymous = await request('/happy-birthdays/mine');
  assert.equal(anonymous.status, 403, 'Dashboard requires authentication');
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
  const pricing = await request('/celebration-payments/pricing', { token: serverToken.accessKey });
  assert.equal(pricing.status, 200);
  assert.deepEqual(pricing.body, { INR: 900, USD: 100 });
  const storyPricing = await request('/celebration-payments/pricing?product=story', { token: serverToken.accessKey });
  assert.equal(storyPricing.status, 200);
  assert.deepEqual(storyPricing.body, { INR: 3600, USD: 500 });
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
  assert.equal((await request('/birthday-stories', {
    token, method: 'POST', body: { ownerId: user.id },
  })).status, 403, 'A browser JWT cannot call internal story endpoints');
  console.log('PASS: real HTTP login, users/me, dashboard ownership, pause/resume, API-token pricing and access contracts.');
};
