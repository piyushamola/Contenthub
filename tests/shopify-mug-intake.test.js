'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareIntake, transition } = require('../src/api/shopify-mug-order/utils/intake');
const policy = require('../src/api/shopify-mug-order/policies/mug-relay');
const { fixture, settings } = require('./helpers/shopify-mug-fixture.cjs');

test('paid mug captures only required fields and preserves a canonical line identity', () => {
  const input = fixture();
  input.payload.billing_address = { private: 'unnecessary billing data' };
  const result = prepareIntake(input, settings);
  assert.equal(result.snapshot.lines[0].lineId, '982002');
  assert.equal(result.snapshot.lines[0].unitPricePaise, 34900);
  assert.equal(result.snapshot.totalPaise, 39800);
  assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify(result.snapshot).includes('unnecessary billing data'), false);
  assert.match(result.orderKey, /^[a-f0-9]{64}$/);
});

test('bad payment, region, currency, variant, property, price and contact evidence require review', () => {
  const changes = [
    [(e) => { e.payload.financial_status = 'pending'; }, 'payment_not_paid'],
    [(e) => { e.payload.test = true; }, 'test_or_unknown_order'],
    [(e) => { e.payload.currency = 'USD'; }, 'unsupported_currency'],
    [(e) => { e.payload.shipping_address.country_code = 'US'; }, 'shipping_not_india'],
    [(e) => { e.payload.line_items[0].price = '1.00'; }, 'price_or_discount_review'],
    [(e) => { e.payload.line_items[0].total_discount = '10.00'; }, 'price_or_discount_review'],
    [(e) => { e.payload.line_items[0].properties.push({ name: 'Design ID', value: 'another' }); }, 'duplicate_design_property'],
    [(e) => { e.payload.line_items[0].properties.find((p) => p.name === 'Print artwork').value = 'https://evil.example.test/a.png'; }, 'invalid_asset_link'],
    [(e) => { e.payload.email = ''; }, 'incomplete_contact'],
  ];
  for (const [change, issue] of changes) {
    const input = fixture(); change(input);
    assert.ok(prepareIntake(input, settings).issues.includes(issue), issue);
  }
});

test('unrelated products are ignored; unsafe IDs and unknown sources fail closed', () => {
  const input = fixture(); input.payload.line_items[0].sku = 'TEE'; input.payload.line_items[0].variant_id = 12;
  assert.equal(prepareIntake(input, settings).irrelevant, true);
  assert.throws(() => prepareIntake({ ...fixture(), shop: 'evil.myshopify.com' }, settings), /invalid_event/);
  const unsafe = fixture(); unsafe.payload.id = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => prepareIntake(unsafe, settings), /invalid_event/);
});

test('delivery header changes do not change receipt identity', () => {
  const input = fixture();
  const a = prepareIntake(input, settings);
  input.deliveryId = 'another-delivery-id';
  assert.equal(prepareIntake(input, settings).receiptKey, a.receiptKey);
});

test('refund/cancel before paid is sticky and changed snapshots reset review', () => {
  const refund = prepareIntake({ shop: settings.SHOPIFY_MUG_SHOP_DOMAIN, topic: 'refunds/create',
    deliveryId: 'refund-fixture', payload: { id: 33, order_id: 982001 } }, settings);
  const held = transition({ stopRequested: false, issues: [] }, refund);
  assert.equal(held.stopRequested, true);
  const paid = prepareIntake(fixture(), settings);
  assert.equal(transition({ ...held, reviewDecision: 'reviewed' }, paid).stopRequested, true);
  const previous = { ...transition({ issues: [] }, paid), reviewDecision: 'reviewed', reviewNotes: 'Checked' };
  assert.equal(transition(previous, paid).reviewDecision, undefined);
  const changed = fixture(); changed.payload.line_items[0].properties.find((p) => p.name === 'Message').value = 'Changed';
  const next = transition(previous, prepareIntake(changed, settings));
  assert.equal(next.reviewDecision, 'pending'); assert.equal(next.reviewNotes, '');
});

test('older paid snapshots cannot overwrite newer reviewed content', () => {
  const input = fixture(); const paid = prepareIntake(input, settings);
  const previous = { ...transition({ issues: [] }, paid), reviewDecision: 'reviewed' };
  input.payload.updated_at = '2026-10-24T12:00:00Z';
  assert.deepEqual(transition(previous, prepareIntake(input, settings)), {});
});

test('relay policy rejects anonymous/JWT callers and requires the separate relay secret', () => {
  const previous = process.env.SHOPIFY_MUG_RELAY_SECRET;
  process.env.SHOPIFY_MUG_RELAY_SECRET = settings.SHOPIFY_MUG_RELAY_SECRET;
  try {
    const ctx = (name, secret) => ({ state: { auth: { strategy: { name }, credentials: { type: 'custom', permissions: ['api::shopify-mug-order.shopify-mug-order.intake'] } } }, request: { headers: { 'x-mug-relay-secret': secret } } });
    assert.equal(policy(ctx('users-permissions', settings.SHOPIFY_MUG_RELAY_SECRET)), false);
    assert.equal(policy(ctx('api-token', 'wrong')), false);
    assert.equal(policy(ctx('api-token', settings.SHOPIFY_MUG_RELAY_SECRET)), true);
  } finally {
    if (previous === undefined) delete process.env.SHOPIFY_MUG_RELAY_SECRET;
    else process.env.SHOPIFY_MUG_RELAY_SECRET = previous;
  }
});


test('changing approval evidence resets a previously reviewed snapshot', () => {
  const paid = prepareIntake(fixture(), settings);
  const reviewed = { ...transition({ issues: [] }, paid), reviewDecision: 'reviewed', reviewNotes: 'Checked' };
  const input = fixture();
  input.payload.updated_at = '2026-10-25T13:00:00Z';
  input.payload.line_items[0].properties.find(p => p.name === 'Design approved').value = 'No';
  const next = transition(reviewed, prepareIntake(input, settings));
  assert.equal(next.reviewDecision, 'pending');
  assert.equal(next.reviewNotes, '');
  assert.ok(next.issues.includes('missing_client_approval'));
});


test('a removed mug snapshot advances the source version and blocks delayed paid delivery', () => {
  const initial = prepareIntake(fixture(), settings);
  const current = { ...transition({ issues: [] }, initial), reviewDecision: 'reviewed' };
  const input = fixture(); input.topic = 'orders/updated';
  input.payload.updated_at = '2026-10-25T14:00:00Z'; input.payload.line_items = [];
  const removed = transition(current, prepareIntake(input, settings));
  assert.equal(removed.stopRequested, true);
  assert.equal(removed.hasMug, false);
  assert.equal(removed.sourceUpdatedAt, '2026-10-25T14:00:00.000Z');
  const delayed = transition({ ...current, ...removed }, initial);
  assert.equal(delayed.snapshot, undefined);
});


test('a broad API token is rejected even with the relay secret', () => {
  const previous = process.env.SHOPIFY_MUG_RELAY_SECRET;
  process.env.SHOPIFY_MUG_RELAY_SECRET = settings.SHOPIFY_MUG_RELAY_SECRET;
  try {
    assert.equal(policy({ state: { auth: { strategy: { name: 'content-api-token' },
      credentials: { type: 'full-access', permissions: [] } } },
      request: { headers: { 'x-mug-relay-secret': settings.SHOPIFY_MUG_RELAY_SECRET } } }), false);
  } finally {
    if (previous === undefined) delete process.env.SHOPIFY_MUG_RELAY_SECRET;
    else process.env.SHOPIFY_MUG_RELAY_SECRET = previous;
  }
});


test('conflicting snapshots at the same timestamp are held instead of silently replacing reviewed content', () => {
  const initial = prepareIntake(fixture(), settings);
  const current = { ...transition({ issues: [] }, initial), reviewDecision: 'reviewed' };
  const changed = fixture(); changed.payload.total_price = '399.00';
  const result = transition(current, prepareIntake(changed, settings));
  assert.equal(result.stopRequested, true);
  assert.equal(result.reviewDecision, 'pending');
  assert.ok(result.issues.includes('source_version_conflict'));
  assert.equal(result.snapshot, undefined);
});


test('wrong mug variant or SKU is rejected instead of being accepted as this product', () => {
  for (const change of [e => { e.payload.line_items[0].variant_id = 777; },
    e => { e.payload.line_items[0].sku = 'TEE'; }]) {
    const input = fixture(); change(input);
    assert.throws(() => prepareIntake(input, settings), /invalid_event/);
  }
});


test('changed invalid asset evidence still resets human review', () => {
  const input = fixture(); input.payload.line_items[0].properties.find(p => p.name === 'Print artwork').value = 'https://unapproved.example.test/first.png';
  const first = prepareIntake(input, settings);
  const reviewed = { ...transition({ issues: [] }, first), reviewDecision: 'reviewed' };
  input.payload.updated_at = '2026-10-25T14:00:00Z';
  input.payload.line_items[0].properties.find(p => p.name === 'Print artwork').value = 'https://unapproved.example.test/second.png';
  assert.equal(transition(reviewed, prepareIntake(input, settings)).reviewDecision, 'pending');
});


test('bounds, malformed identities and configuration reject without exposing payload details', () => {
  for (const mutate of [e => { e.payload.line_items = Array(501).fill({}); },
    e => { e.payload.id = '0'; }, e => { e.deliveryId = 'bad/id'; },
    e => { e.payload.updated_at = null; }, e => { e.payload.unused = 'x'.repeat(521 * 1024); }]) {
    const event = fixture(); mutate(event);
    assert.throws(() => prepareIntake(event, settings), /^Error: invalid_event$/);
  }
  assert.throws(() => prepareIntake(fixture(), { ...settings, SHOPIFY_MUG_SHOP_DOMAIN: undefined }), /configuration/);
  assert.throws(() => prepareIntake(fixture(), { ...settings, SHOPIFY_MUG_VARIANT_ID: 'invalid' }), /configuration/);
});

test('unusable money, quantity and asset evidence remains pending with explicit issues', () => {
  for (const mutate of [e => { e.payload.line_items[0].quantity = 0; },
    e => { e.payload.line_items[0].price = '349.001'; },
    e => { e.payload.line_items[0].properties.find(p => p.name === 'Print artwork').value = 'http://assets.example.test/a.png'; },
    e => { e.payload.line_items[0].properties.find(p => p.name === 'Print artwork').value = 'https://user:password@assets.example.test/a.png'; },
    e => { e.payload.shipping_address = null; }]) {
    const event = fixture(); mutate(event);
    const result = transition({ issues: [] }, prepareIntake(event, settings));
    assert.equal(result.reviewDecision, 'pending'); assert.ok(result.issues.length > 0);
  }
});

test('stale cancellation evidence still stops a newer snapshot and retains the stop reason', () => {
  const initial = prepareIntake(fixture(), settings);
  const current = { ...transition({ issues: [] }, initial), reviewDecision: 'reviewed' };
  const event = fixture(); event.payload.updated_at = '2026-10-24T12:00:00Z';
  event.payload.cancelled_at = '2026-10-24T12:00:00Z';
  const result = transition(current, prepareIntake(event, settings));
  assert.equal(result.stopRequested, true); assert.ok(result.issues.includes('cancelled'));
  assert.equal(result.snapshot, undefined); assert.equal(result.reviewDecision, 'pending');
});
