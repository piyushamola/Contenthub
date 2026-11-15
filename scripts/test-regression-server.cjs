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
    // Startup now includes a fresh isolated admin build as well as CMS boot.
    const deadline = Date.now() + 120_000;
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
    const adminLogin = await fetch(ready.cmsUrl + '/admin/auth/login', { signal: AbortSignal.timeout(10_000) });
    assert.equal(adminLogin.status, 200, 'The real Strapi admin login serves its built HTML');
    assert.match(adminLogin.headers.get('content-type'), /text\/html/);
    const adminHtml = await adminLogin.text();
    assert.match(adminHtml, /id=["']strapi["']/);
    const adminScripts = [...adminHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => new URL(match[1], ready.cmsUrl + '/admin/'));
    assert.ok(adminScripts.length > 0, 'Admin HTML references a real JavaScript bundle');
    for (const script of adminScripts) {
      assert.equal(script.origin, ready.cmsUrl, 'The disposable admin uses its own CMS origin');
      const response = await fetch(script, { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200, 'The admin entry bundle is served instead of a missing-build fallback');
      assert.match(response.headers.get('content-type'), /(?:java|ecma)script/);
      assert.ok((await response.text()).length > 0);
    }
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
    // Next reads blogs with its internal CMS token. Seeding content must not
    // grant anonymous access to the generic CMS collection or its drafts.
    assert.equal((await request('/api/blog-articles?status=published')).status, 403);
    assert.equal((await request('/api/blog-articles?status=draft')).status, 403);
    const publishedBlogs = await request('/api/blog-articles?status=published', { token });
    assert.equal(publishedBlogs.status, 200);
    assert.deepEqual(publishedBlogs.data.data.map(article => article.slug), ['regression-published-birthday-guide']);
    assert.equal(publishedBlogs.data.data[0].title, 'A birthday guide from the disposable CMS');
    assert.ok(publishedBlogs.data.data[0].publishedAt);
    const publishedBlog = await request('/api/blog-articles?status=published&filters[slug][$eq]=regression-published-birthday-guide', { token });
    assert.equal(publishedBlog.status, 200);
    assert.equal(publishedBlog.data.data.length, 1);
    assert.match(publishedBlog.data.data[0].content, /This guide comes from the disposable CMS/);
    const unpublishedBlog = await request('/api/blog-articles?status=published&filters[slug][$eq]=regression-draft-only-birthday-guide', { token });
    assert.equal(unpublishedBlog.status, 200);
    assert.deepEqual(unpublishedBlog.data.data, []);
    const privateDraft = await request('/api/blog-articles?status=draft&filters[slug][$eq]=regression-draft-only-birthday-guide', { token });
    assert.equal(privateDraft.status, 200);
    assert.equal(privateDraft.data.data.length, 1);
    assert.equal(privateDraft.data.data[0].publishedAt, null);
    assert.deepEqual((await request('/api/celebration-payments/pricing', { token })).data, { INR: 900, USD: 100, originalINR: null, originalUSD: null });
    assert.equal((await request('/__regression/pricing')).status, 401);
    assert.equal((await request('/__regression/pricing', { method: 'PATCH', data: { indiaPriceRupees: 1 } })).status, 401);
    const pricingBefore = await request('/__regression/pricing', { control: true });
    assert.equal(pricingBefore.status, 200);
    assert.equal((await request('/__regression/pricing', { method: 'PATCH', control: true, data: { unrelatedField: 1 } })).status, 400);
    assert.equal((await request('/__regression/pricing', { method: 'PATCH', control: true, data: { indiaPriceRupees: -1 } })).status, 400);
    const originalPricing = await request('/__regression/pricing', { method: 'PATCH', control: true, data: { indiaOriginalPriceRupees: 18 } });
    assert.equal(originalPricing.status, 200);
    assert.equal(Number(originalPricing.data.data.indiaPriceRupees), 9);
    assert.deepEqual((await request('/api/celebration-payments/pricing', { token })).data, { INR: 900, USD: 100, originalINR: 1800, originalUSD: null });
    assert.equal((await request('/__regression/pricing', { method: 'PATCH', control: true, data: pricingBefore.data.data })).status, 200);
    const slug = `server-smoke-${crypto.randomUUID()}`;
    const creation = await request('/api/happy-birthdays?status=published', { method: 'POST', token, data: { data: {
      personname: 'Smoke test', personemail: 'smoke@example.test', hostname: 'Regression Creator', hostemail: ready.users.creator.email,
      customroute: slug, birthdaymessages: ['One', 'Two', 'Three'], templateId: 'classic', musicId: 'none', country: 'IN', owner: ready.users.creator.id,
    } } });
    assert.equal(creation.status, 201);
    const scheduleRoute = `/__regression/celebrations/${slug}/schedule`;
    const triggerAt = new Date(Date.now() + 3_600_000).toISOString();
    assert.equal((await request(scheduleRoute, { method: 'POST', data: { triggerAt } })).status, 401);
    assert.equal((await request(scheduleRoute, { method: 'POST', token, data: { triggerAt } })).status, 401);
    assert.equal((await request(scheduleRoute, { method: 'POST', control: true, data: { triggerAt: 'not-a-date' } })).status, 400);
    assert.equal((await request('/__regression/celebrations/missing/schedule', { method: 'POST', control: true, data: { triggerAt } })).status, 404);
    const scheduled = await request(scheduleRoute, { method: 'POST', control: true, data: { triggerAt } });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.data.triggerAt, triggerAt);
    assert.equal(Date.parse(scheduled.data.expiresAt) - Date.parse(triggerAt), 86_400_000);
    const earlyWish = await request(`/api/celebration-wishes/${slug}`, { method: 'POST', token, data: { name: 'Smoke visitor', message: 'An early birthday wish' } });
    assert.equal(earlyWish.status, 200);
    assert.deepEqual(Object.keys(earlyWish.data), ['wish']);
    const openTrigger = new Date(Date.now() - 60_000).toISOString();
    assert.equal((await request(scheduleRoute, { method: 'POST', control: true, data: { triggerAt: openTrigger } })).status, 200);
    const openedState = await request(`/__regression/celebrations/${slug}`, { control: true });
    assert.ok(openedState.data.rows.every((row) => row.triggerAt === openTrigger && row.guestwishes.some((wish) => wish.id === earlyWish.data.wish.id)));
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
    console.log('PASS: disposable server and built admin HTML/JavaScript, confirmed users, guarded controls, published/draft blog HTTP boundaries, test-key rejection, real HTTP create/payment/refund/expiry and captured email.');
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
