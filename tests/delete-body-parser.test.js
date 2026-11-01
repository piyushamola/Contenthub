'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const Koa = require('koa');
const { koaBody } = require('koa-body');
const middlewares = require('../config/middlewares');

test('the configured body parser preserves DELETE owner/country JSON and existing mutation bodies', async (t) => {
  const app = new Koa();
  const options = middlewares.find((middleware) => middleware.name === 'strapi::body').config;
  app.use(koaBody(options));
  app.use((ctx) => { ctx.body = ctx.request.body; });
  const server = http.createServer(app.callback());
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/happy-birthdays/owned/erase`;
  const body = { ownerId: 17, country: 'US' };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body, `${method} must reach the controller with its JSON intact`);
  }
  const invalid = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400, 'Malformed DELETE JSON is rejected before any controller action');
});
