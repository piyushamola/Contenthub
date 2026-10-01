'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');

async function main() {
  const temporary = await fs.mkdtemp('/tmp/contenthub-server-test-');
  const readyFile = path.join(temporary, 'ready.json');
  const launcher = path.join(__dirname, 'start-regression-server.cjs');
  const rejected = spawnSync(process.execPath, [launcher, '--ready-file', readyFile, '--payments', 'razorpay-test'], {
    env: { ...process.env, REGRESSION_RAZORPAY_KEY_ID: 'rzp_live_forbidden', REGRESSION_RAZORPAY_KEY_SECRET: 'must-not-be-used' },
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /live credentials are rejected/);
  const child = spawn(process.execPath, [launcher, '--port', '0', '--ready-file', readyFile], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const capture = (value) => { logs = (logs + value).slice(-20_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  try {
    let ready;
    const deadline = Date.now() + 90_000;
    while (!ready && Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Server exited before readiness: ${logs}`);
      try { ready = JSON.parse(await fs.readFile(readyFile, 'utf8')); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, `Server did not become ready: ${logs}`);
    assert.equal(ready.paymentMode, 'mock');
    assert.equal(Object.hasOwn(ready.frontendEnv, 'RAZORPAY_KEY_SECRET'), false);
    assert.equal((await fs.stat(readyFile)).mode & 0o777, 0o600);
    async function request(route, { method = 'GET', data, control = false, token } = {}) {
      const response = await fetch(ready.cmsUrl + route, {
        method, headers: {
          ...(token || control ? { Authorization: `Bearer ${control ? ready.control.token : token}` } : {}),
          ...(data ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10_000),
      });
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await request('/__regression/state')).status, 401);
    assert.equal((await request('/__regression/state', { control: true })).status, 200);
    for (const user of Object.values(ready.users)) {
      const login = await request('/api/auth/local', { method: 'POST', data: { identifier: user.email, password: user.password } });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.id, user.id);
    }
    // All browser projects share the Next server IP. Cross Strapi's ordinary
    // ten-login threshold to prove the harness supports the combined suite.
    for (let i = 0; i < 9; i++) {
      const login = await request('/api/auth/local', { method: 'POST', data: {
        identifier: ready.users.creator.email, password: ready.users.creator.password,
      } });
      assert.equal(login.status, 200);
    }
    const token = ready.frontendEnv.AUTHORIZATION_TOKEN;
    assert.deepEqual((await request('/api/celebration-payments/pricing', { token })).data, { INR: 900, USD: 100 });
    const slug = `server-smoke-${crypto.randomUUID()}`;
    const creation = await request('/api/happy-birthdays?status=published', { method: 'POST', token, data: { data: {
      personname: 'Smoke test', personemail: 'smoke@example.test', hostname: 'Regression Creator', hostemail: ready.users.creator.email,
      customroute: slug, birthdaymessages: ['One', 'Two', 'Three'], templateId: 'classic', musicId: 'none', country: 'IN', owner: ready.users.creator.id,
    } } });
    assert.equal(creation.status, 201);
    const purchaseId = crypto.randomUUID();
    const order = await request('/api/celebration-payments/orders', { method: 'POST', token, data: {
      slug, purchaseId, country: 'IN', ownerId: ready.users.creator.id,
    } });
    assert.equal(order.status, 200);
    assert.equal(order.data.amount, 900);
    const captured = await request(`/__regression/payments/${order.data.orderId}/capture`, { method: 'POST', control: true, data: {} });
    assert.equal(captured.status, 200);
    const verifyData = { purchaseId, orderId: order.data.orderId, paymentId: captured.data.paymentId, signature: captured.data.signature };
    assert.equal((await request('/api/celebration-payments/verify', { method: 'POST', token, data: { ...verifyData, signature: 'wrong' } })).status, 400);
    const verified = await request('/api/celebration-payments/verify', { method: 'POST', token, data: verifyData });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.unlocked, true);
    const state = await request(`/__regression/celebrations/${slug}`, { control: true });
    assert.equal(state.data.rows.length, 2);
    assert.ok(state.data.rows.every((row) => row.premiumUnlocked && row.owner.id === ready.users.creator.id));
    assert.ok(state.data.rows.every((row) => !Object.hasOwn(row.owner, 'password')));
    const refunded = await request(`/__regression/payments/${captured.data.paymentId}/refund`, { method: 'POST', control: true, data: {} });
    assert.equal(refunded.status, 200);
    const event = JSON.parse(refunded.data.webhook.rawBody);
    const refund = await request('/api/celebration-payments/webhook', { method: 'POST', token, data: { eventId: refunded.data.eventId, event } });
    assert.equal(refund.data.entitlementRevoked, true);
    const replayAfterRefund = await request('/api/celebration-payments/verify', { method: 'POST', token, data: verifyData });
    assert.equal(replayAfterRefund.data.pending, true);
    const refundedState = await request(`/__regression/celebrations/${slug}`, { control: true });
    assert.ok(refundedState.data.rows.every((row) => row.premiumUnlocked === false));
    const expired = await request(`/__regression/celebrations/${slug}/expire`, { method: 'POST', control: true, data: {} });
    assert.equal(expired.status, 200);
    assert.equal(expired.data.cleanup.unpublished, 1);
    const afterExpiry = await request(`/__regression/celebrations/${slug}`, { control: true });
    assert.equal(afterExpiry.data.rows.length, 1);
    assert.equal(afterExpiry.data.rows[0].publishedAt, null);
    const outbox = await request(`/__regression/outbox?email=${encodeURIComponent(ready.users.creator.email)}`, { control: true });
    assert.ok(outbox.data.messages.length > 0);
    console.log('PASS: disposable server, confirmed users, guarded controls, test-key rejection, real HTTP create/payment/refund/expiry and captured email.');
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    if (child.exitCode === null) {
      const finished = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await finished;
      clearTimeout(timer);
    }
    assert.equal(await fs.access(readyFile).then(() => true, () => false), false, 'Server removes its readiness file on shutdown');
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
