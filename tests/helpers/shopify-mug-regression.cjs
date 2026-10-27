'use strict';

const assert = require('node:assert/strict');
const { format } = require('node:util');
const { fixture, settings } = require('./shopify-mug-fixture.cjs');
const UID = 'api::shopify-mug-order.shopify-mug-order';
const RECEIPT = 'api::shopify-mug-receipt.shopify-mug-receipt';
const ACTION = 'api::shopify-mug-order.shopify-mug-order.intake';

module.exports = async function checkMugIntake(app, base, jwt, broadToken) {
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const orders = app.db.query(UID);
  const receipts = app.db.query(RECEIPT);
  const tokenService = app.admin.services['api-token'];
  const restricted = await tokenService.create({ name: 'mug-intake-only', type: 'custom', lifespan: null, permissions: [ACTION] });
  const other = await tokenService.create({ name: 'mug-no-intake', type: 'custom', lifespan: null,
    permissions: ['api::celebration-purchase.celebration-purchase.pricing'] });
  const apiToken = restricted.accessKey;
  const logs = [];
  const originals = Object.fromEntries(['warn', 'error', 'info', 'debug', 'http'].map(level => [level, app.log[level]]));
  for (const level of Object.keys(originals)) app.log[level] = (...args) => logs.push(format(...args));
  const celebrationCounts = await Promise.all(['api::happy-birthday.happy-birthday',
    'api::celebration-purchase.celebration-purchase'].map(uid => app.db.query(uid).count()));
  let checks = 0;
  async function check(name, action) {
    await action(); checks++;
    console.log('PASS: mug intake ' + name);
  }
  const send = async (body, token = apiToken, relay = settings.SHOPIFY_MUG_RELAY_SECRET) => {
    const response = await fetch(base + '/shopify-mug-orders/intake', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(relay === null ? {} : { 'X-Mug-Relay-Secret': relay }) }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000) });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw), raw };
  };
  const stored = id => orders.findOne({ where: { shopifyOrderId: String(id) } });
  const inputFor = id => { const event = fixture(); event.payload.id = id; return event; };
  let unsubscribe;
  let permission;
  try {
    await check('anonymous, JWT, unrelated/broad token and missing/wrong relay rejected', async () => {
      // Granting this action to the ordinary role must not bypass the API-token policy.
      const role = await app.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
      permission = await app.db.query('plugin::users-permissions.permission').create({ data: { action: ACTION, role: role.id } });
      for (const [token, relay] of [[null], [jwt], [broadToken], [other.accessKey], [apiToken, null], [apiToken, 'wrong']]) {
        assert.equal((await send(fixture(), token, relay)).status, 403);
      }
      assert.equal(await orders.count(), 0);
    });
    await check('default-off and incomplete configuration fail closed', async () => {
      delete process.env.SHOPIFY_MUG_INTAKE_ENABLED;
      assert.equal((await send(fixture())).status, 503);
      process.env.SHOPIFY_MUG_INTAKE_ENABLED = 'true';
      process.env.SHOPIFY_MUG_VARIANT_ID = '';
      assert.equal((await send(fixture())).status, 503);
      process.env.SHOPIFY_MUG_VARIANT_ID = settings.SHOPIFY_MUG_VARIANT_ID;
    });
    await check('configured shop and exact mug variant/SKU enforced', async () => {
      for (const change of [e => { e.shop = 'wrong.myshopify.com'; }, e => { e.topic = 'orders/create'; },
        e => { e.payload.line_items[0].variant_id = 7; }, e => { e.payload.line_items[0].sku = 'TEE'; },
        e => { e.payload.updated_at = 'invalid'; }, e => { e.payload.id = Number.MAX_SAFE_INTEGER + 1; }]) {
        const event = fixture(); change(event);
        assert.equal((await send(event)).status, 400);
      }
      assert.equal(await orders.count(), 0);
    });
    await check('restricted token captures privately and repeated deliveries persist one receipt', async () => {
      const input = fixture();
      assert.deepEqual(await send(input), { status: 200, body: { received: true }, raw: '{"received":true}' });
      assert.equal((await send({ ...input, deliveryId: 'new-delivery-id' })).status, 200);
      const row = await stored(982001);
      assert.equal(await orders.count({ where: { shopifyOrderId: '982001' } }), 1);
      assert.equal(row.reviewDecision, 'pending');
      assert.equal(row.snapshot.lines[0].message, 'Happy birthday');
      assert.equal(await receipts.count({ where: { orderKey: row.orderKey } }), 1);
      // The database, not only application reads, rejects a duplicate identity.
      await assert.rejects(() => orders.create({ data: { documentId: 'synthetic-duplicate-order',
        orderKey: row.orderKey, shopDomain: row.shopDomain, shopifyOrderId: row.shopifyOrderId } }));
      assert.equal(await orders.count({ where: { orderKey: row.orderKey } }), 1);
    });
    await check('concurrent first delivery creates one order and one receipt', async () => {
      const event = inputFor(982020);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => send({ ...event, deliveryId: 'parallel-' + i })));
      assert.ok(results.every(result => [200, 503].includes(result.status)));
      if (process.env.DATABASE_CLIENT === 'postgres') assert.ok(results.every(result => result.status === 200));
      // SQLite may reject contention. Re-delivery is safe and captures any uncommitted attempt.
      for (const result of results) if (result.status === 503) assert.equal((await send(event)).status, 200);
      const row = await stored(982020);
      assert.equal(await orders.count({ where: { orderKey: row.orderKey } }), 1);
      assert.equal(await receipts.count({ where: { orderKey: row.orderKey } }), 1);
      assert.equal(row.hasMug, true);
    });
    await check('relevant updates reset review while unchanged snapshots retain it', async () => {
      const row = await stored(982001);
      await orders.update({ where: { id: row.id }, data: { reviewDecision: 'reviewed', reviewNotes: 'Checked' } });
      const same = fixture(); same.topic = 'orders/updated'; same.payload.updated_at = '2026-10-25T13:00:00Z';
      assert.equal((await send(same)).status, 200);
      assert.equal((await stored(982001)).reviewDecision, 'reviewed');
      same.payload.updated_at = '2026-10-25T14:00:00Z';
      same.payload.line_items[0].properties.find(p => p.name === 'Design approved').value = 'No';
      assert.equal((await send(same)).status, 200);
      const changed = await stored(982001);
      assert.equal(changed.reviewDecision, 'pending'); assert.equal(changed.reviewNotes, '');
      assert.ok(changed.issues.includes('missing_client_approval'));
      assert.equal((await send(fixture())).status, 200);
      assert.equal((await stored(982001)).snapshot.lines[0].approval.approved, 'No');
    });
    await check('refund/cancel before and after payment stay held through retries', async () => {
      for (const topic of ['refunds/create', 'orders/cancelled']) for (const before of [true, false]) {
        const id = 982030 + (topic === 'refunds/create' ? 0 : 2) + Number(before);
        const paid = inputFor(id);
        const stop = { shop: settings.SHOPIFY_MUG_SHOP_DOMAIN, topic, deliveryId: 'stop-' + id,
          payload: topic === 'refunds/create' ? { id: 44, order_id: id } : { id, cancelled_at: '2026-10-25T15:00:00Z' } };
        if (!before) assert.equal((await send(paid)).status, 200);
        assert.equal((await send(stop)).status, 200);
        assert.equal((await send(paid)).status, 200);
        paid.topic = 'orders/updated'; paid.payload.updated_at = '2026-10-25T16:00:00Z';
        assert.equal((await send(paid)).status, 200);
        const row = await stored(id);
        assert.equal(row.stopRequested, true); assert.equal(row.reviewDecision, 'pending');
        assert.ok(row.issues.includes(topic === 'refunds/create' ? 'refund_received' : 'cancelled'));
      }
    });
    await check('mug removal and concurrent delayed payment cannot restore an earlier design', async () => {
      const paid = inputFor(982040); assert.equal((await send(paid)).status, 200);
      const row = await stored(982040);
      await orders.update({ where: { id: row.id }, data: { reviewDecision: 'reviewed' } });
      const removed = inputFor(982040); removed.topic = 'orders/updated'; removed.payload.updated_at = '2026-10-25T16:00:00Z';
      removed.payload.line_items = [];
      const results = await Promise.all([send(removed), send(paid)]);
      for (let i = 0; i < results.length; i++) if (results[i].status === 503) assert.equal((await send([removed, paid][i])).status, 200);
      const held = await stored(982040);
      assert.equal(held.stopRequested, true); assert.equal(held.hasMug, false);
      assert.deepEqual(held.snapshot.lines, []); assert.ok(held.issues.includes('mug_removed'));
      assert.equal(held.reviewDecision, 'pending');
      // A removal arriving first also establishes an ordering tombstone.
      removed.payload.id = 982041; assert.equal((await send(removed)).status, 200);
      assert.equal((await send(inputFor(982041))).status, 200);
      assert.equal((await stored(982041)).hasMug, false);
    });
    await check('failed transaction rolls back snapshot, review and receipt; retry captures once', async () => {
      const event = inputFor(982050); assert.equal((await send(event)).status, 200);
      const row = await stored(982050);
      await orders.update({ where: { id: row.id }, data: { reviewDecision: 'reviewed', reviewNotes: 'Checked' } });
      const before = await stored(982050);
      let fail = true;
      unsubscribe = app.db.lifecycles.subscribe({ models: [RECEIPT], beforeCreate() {
        if (fail) throw new Error('private-storage-detail https://assets.example.test/private.png');
      } });
      event.topic = 'orders/updated'; event.payload.updated_at = '2026-10-25T17:00:00Z';
      event.payload.line_items[0].quantity = 2;
      const failure = await send(event);
      assert.equal(failure.status, 503); assert.equal(failure.raw.includes('private-storage-detail'), false);
      const after = await stored(982050);
      assert.deepEqual(after.snapshot, before.snapshot); assert.equal(after.reviewDecision, 'reviewed');
      assert.equal(await receipts.count({ where: { orderKey: row.orderKey } }), 1);
      const firstFailure = inputFor(982051);
      assert.equal((await send(firstFailure)).status, 503);
      const placeholder = await stored(982051);
      assert.equal(placeholder.hasMug, false); assert.equal(placeholder.snapshot, null);
      assert.equal(await receipts.count({ where: { orderKey: placeholder.orderKey } }), 0);
      fail = false;
      assert.equal((await send(event)).status, 200); assert.equal((await send(firstFailure)).status, 200);
      assert.equal((await stored(982050)).reviewDecision, 'pending');
      assert.equal((await stored(982050)).snapshot.lines[0].quantity, 2);
      assert.equal(await receipts.count({ where: { orderKey: row.orderKey } }), 2);
    });
    await check('mixed carts isolate mug evidence and leave celebration/payment records unchanged', async () => {
      const input = inputFor(982060);
      input.payload.line_items.push({ id: 982099, variant_id: 7, sku: 'TEE', quantity: 1, properties: [] });
      assert.equal((await send(input)).status, 200);
      const row = await stored(982060);
      assert.equal(row.snapshot.lines.length, 1);
      await orders.update({ where: { id: row.id }, data: { reviewDecision: 'reviewed' } });
      input.topic = 'orders/updated'; input.payload.updated_at = '2026-10-25T18:00:00Z';
      input.payload.line_items[1].properties = [{ name: 'Size', value: 'L' }];
      assert.equal((await send(input)).status, 200);
      assert.equal((await stored(982060)).reviewDecision, 'reviewed');
      input.payload.id = 982061; input.payload.line_items.shift();
      assert.equal((await send(input)).status, 200);
      const ignored = await stored(982061);
      assert.equal(ignored.hasMug, false); assert.deepEqual(ignored.snapshot, { orderId: '982061', lines: [] });
      assert.deepEqual(await Promise.all(['api::happy-birthday.happy-birthday',
        'api::celebration-purchase.celebration-purchase'].map(uid => app.db.query(uid).count())), celebrationCounts);
    });
    await check('Content Manager supports private human review without clearing holds', async () => {
      const role = await app.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } });
      const password = 'Synthetic-review-only-123!';
      await app.admin.services.user.create({ firstname: 'Mug', lastname: 'Reviewer', email: 'mug-review-admin@example.test',
        password, isActive: true, roles: [role.id] });
      const origin = base.replace(/\/api$/, '');
      const login = await fetch(origin + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mug-review-admin@example.test', password }) });
      assert.equal(login.status, 200);
      const auth = await login.json();
      const headers = { Authorization: 'Bearer ' + auth.data.token, 'Content-Type': 'application/json' };
      const before = await stored(982030);
      const route = origin + '/content-manager/collection-types/' + UID + '/' + before.documentId;
      const read = await fetch(route, { headers });
      assert.equal(read.status, 200);
      const document = await read.json();
      assert.deepEqual(document.data.snapshot, before.snapshot, 'Reviewers must be able to inspect the private snapshot');
      const saved = await fetch(route, { method: 'PUT', headers, body: JSON.stringify({ reviewDecision: 'rejected', reviewNotes: 'Synthetic manual review' }) });
      assert.equal(saved.status, 200);
      const after = await stored(982030);
      assert.equal(after.reviewDecision, 'rejected'); assert.equal(after.reviewNotes, 'Synthetic manual review');
      assert.equal(after.stopRequested, true); assert.deepEqual(after.snapshot, before.snapshot);
      assert.equal(await orders.count({ where: { orderKey: before.orderKey } }), 1);
    });
    await check('no generic public or token CRUD exposes private collections', async () => {
      for (const route of ['/shopify-mug-orders', '/shopify-mug-receipts']) for (const token of [null, jwt, apiToken, broadToken]) {
        assert.equal((await fetch(base + route, { headers: token ? { Authorization: 'Bearer ' + token } : {} })).status, 404);
      }
      const privateValues = [apiToken, settings.SHOPIFY_MUG_RELAY_SECRET, fixture().payload.email,
        fixture().payload.shipping_address.address1, 'https://assets.example.test/flat.png', 'private-storage-detail'];
      const output = logs.join(' ');
      for (const value of privateValues) assert.equal(output.includes(value), false, 'Private value leaked into server logs');
    });
    await require('./shopify-mug-production-regression.cjs')(app, base, jwt, apiToken);
    console.log('PASS: ' + checks + ' mug HTTP/database groups (' + process.env.DATABASE_CLIENT + ').');
  } finally {
    unsubscribe?.();
    if (permission) await app.db.query('plugin::users-permissions.permission').delete({ where: { id: permission.id } });
    Object.assign(app.log, originals);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
};
