'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const purchaseFactory = require('../src/api/celebration-purchase/services/celebration-purchase');

const PURCHASE_UID = 'api::celebration-purchase.celebration-purchase';
const CELEBRATION_UID = 'api::happy-birthday.happy-birthday';
const PRICING_UID = 'api::premium-pricing.premium-pricing';
const WEBHOOK_UID = 'api::payment-webhook-event.payment-webhook-event';
const PURCHASE_ID = '00000000-0000-4000-8000-000000000001';

// These doubles stop at the database and provider boundaries. Every assertion
// calls the real service API; the integration suite covers actual Strapi writes.
function fixture({ celebration = {}, purchase = {} } = {}) {
  const celebrationRow = celebration === null ? null : {
    documentId: 'celebration-1',
    customroute: 'regression-birthday',
    owner: { id: 42 },
    country: 'IN',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    publishedAt: new Date().toISOString(),
    premiumUnlocked: false,
    ...celebration,
  };
  const purchaseRow = {
    purchaseId: PURCHASE_ID,
    celebrationDocumentId: 'celebration-1',
    celebrationSlug: 'regression-birthday',
    productType: 'premium',
    razorpayOrderId: 'order_1',
    amountPaise: 900,
    currency: 'INR',
    status: 'created',
    ...purchase,
  };
  const rows = {
    [CELEBRATION_UID]: celebrationRow ? [celebrationRow] : [],
    [PURCHASE_UID]: [purchaseRow],
    [WEBHOOK_UID]: [],
  };
  function matches(row, where) {
    return Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === 'object') {
        if ('$eqi' in expected) return row[key]?.toLowerCase() === expected.$eqi;
        if ('$notNull' in expected) return row[key] != null;
        if ('$ne' in expected) return row[key] !== expected.$ne;
        assert.fail(`Unsupported fixture filter for ${key}`);
      }
      return row[key] === expected;
    });
  }
  const service = purchaseFactory({
    strapi: {
      contentType: (uid) => ({ uid }),
      service: (uid) => {
        if (uid === PRICING_UID) return { currentPrices: async () => ({ INR: 900, USD: 100 }) };
        if (uid === 'api::happy-birthday.birthday-story') return { findBySlug: async () => null };
        assert.fail(`Unexpected service ${uid}`);
      },
      db: {
        query: (uid) => {
          assert.ok(rows[uid], `Unexpected query ${uid}`);
          return {
            findOne: async ({ where }) => rows[uid].find((row) => matches(row, where)) || null,
            create: async ({ data }) => {
              const row = { ...data };
              rows[uid].push(row);
              return row;
            },
            update: async ({ where, data }) => {
              const row = rows[uid].find((candidate) => matches(candidate, where));
              assert.ok(row, 'Update must target an existing fixture row');
              Object.assign(row, data);
              return row;
            },
            updateMany: async ({ where, data }) => {
              const found = rows[uid].filter((row) => matches(row, where));
              found.forEach((row) => Object.assign(row, data));
              return { count: found.length };
            },
          };
        },
      },
    },
  });
  const payment = {
    id: 'pay_1', order_id: 'order_1', amount: 900, currency: 'INR',
    status: 'captured', created_at: Math.floor(Date.now() / 1000),
  };
  const order = { id: 'order_1', amount: 900, currency: 'INR', status: 'paid' };
  const providerCalls = [];
  service.razorpay = async (endpoint) => {
    providerCalls.push(endpoint);
    if (endpoint === '/payments/pay_1') return payment;
    if (endpoint === '/orders/order_1') return order;
    assert.fail(`Unexpected provider call ${endpoint}`);
  };
  return { service, celebration: celebrationRow, purchase: purchaseRow, payment, order, rows, providerCalls };
}

test('checkout rejects invalid owners, ids, demos, expired and missing celebrations before charging', async (t) => {
  const cases = [
    { name: 'missing login', ownerId: undefined, message: /logged-in creator/ },
    { name: 'another owner', ownerId: 43, message: /logged-in creator/ },
    { name: 'string owner id', ownerId: '42', message: /logged-in creator/ },
    { name: 'invalid purchase id', purchaseId: 'bad-id', message: /valid purchase id/ },
    { name: 'expired', celebration: { expiresAt: new Date(Date.now() - 60_000).toISOString() }, message: /expired/ },
    { name: 'demo', celebration: { customroute: 'elena' }, slug: 'elena', message: /do not require payment/ },
    { name: 'deleted', celebration: null, message: /not found/ },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const f = fixture({ celebration: item.celebration });
    await assert.rejects(f.service.createOrder({
      slug: item.slug || 'regression-birthday', purchaseId: item.purchaseId || PURCHASE_ID,
      ownerId: Object.hasOwn(item, 'ownerId') ? item.ownerId : 42,
    }), item.message);
    assert.deepEqual(f.providerCalls, []);
    assert.equal(f.rows[PURCHASE_UID].length, 1);
  });
});

test('checkout cannot reuse another celebration payment attempt', async () => {
  const f = fixture({ purchase: { celebrationDocumentId: 'someone-elses-celebration' } });
  await assert.rejects(f.service.createOrder({
    slug: f.celebration.customroute, purchaseId: PURCHASE_ID, ownerId: 42,
  }), /another celebration/);
  assert.deepEqual(f.providerCalls, []);
});

test('payment verification rejects tampered signatures and mismatched orders without contacting provider', async () => {
  for (const signature of ['', 'wrong', 'a'.repeat(64)]) {
    const f = fixture();
    await assert.rejects(f.service.verifyPayment({
      purchaseId: PURCHASE_ID, orderId: 'order_1', paymentId: 'pay_1', signature,
    }), /signature is invalid/);
    assert.equal(f.celebration.premiumUnlocked, false);
    assert.deepEqual(f.providerCalls, []);
  }
  const f = fixture();
  await assert.rejects(f.service.verifyPayment({ purchaseId: PURCHASE_ID, orderId: 'order_other' }), /does not match/);
  assert.deepEqual(f.providerCalls, []);
});

test('a signed payment is unlocked only after the provider confirms capture and the paid order', async () => {
  const f = fixture();
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update('order_1|pay_1').digest('hex');
  const expiresAt = f.celebration.expiresAt;
  const access = await f.service.verifyPayment({
    purchaseId: PURCHASE_ID, orderId: 'order_1', paymentId: 'pay_1', signature,
  });
  assert.equal(access.unlocked, true);
  assert.deepEqual(access.features, ['video', 'collage']);
  assert.equal(f.celebration.premiumPaymentId, 'pay_1');
  assert.equal(f.celebration.expiresAt, expiresAt, 'Payment must not extend the celebration');
  assert.equal(f.purchase.status, 'paid');
  assert.deepEqual(f.providerCalls, ['/payments/pay_1', '/orders/order_1']);
});

test('wrong provider amount, currency, authorization or order status never grants access', async (t) => {
  const cases = [
    ['payment amount', 'payment', 'amount', 1],
    ['payment currency', 'payment', 'currency', 'USD'],
    ['authorization without capture', 'payment', 'status', 'authorized'],
    ['order amount', 'order', 'amount', 1],
    ['order currency', 'order', 'currency', 'USD'],
    ['unpaid order', 'order', 'status', 'attempted'],
  ];
  for (const [name, target, key, value] of cases) await t.test(name, async () => {
    const f = fixture();
    f[target][key] = value;
    const result = await f.service.reconcileCapturedPurchase(f.purchase, 'pay_1');
    assert.equal(result.pending, true);
    assert.equal(f.celebration.premiumUnlocked, false);
    assert.equal(f.purchase.status, 'created');
  });
  const f = fixture();
  f.payment.order_id = 'order_other';
  await assert.rejects(f.service.reconcileCapturedPurchase(f.purchase, 'pay_1'), /does not belong/);
  assert.equal(f.celebration.premiumUnlocked, false);
});

test('captured payments after deletion or expiry are recorded for refund without restoring access', async (t) => {
  for (const celebration of [null, { expiresAt: new Date(Date.now() - 60_000).toISOString() }]) {
    await t.test(celebration ? 'expired' : 'deleted', async () => {
      const f = fixture({ celebration });
      const access = await f.service.grantCapturedPurchase(f.purchase, f.payment);
      assert.equal(access.unlocked, false);
      assert.equal(access.expired, true);
      assert.equal(f.purchase.status, 'paid');
      assert.match(f.purchase.failureReason, /review for refund/);
      if (f.celebration) assert.equal(f.celebration.premiumUnlocked, false);
    });
  }
});

test('capture retries are idempotent and duplicate captures preserve the original entitlement', async () => {
  const f = fixture();
  await f.service.grantCapturedPurchase(f.purchase, f.payment);
  const expiry = f.celebration.expiresAt;
  const again = await f.service.grantCapturedPurchase(f.purchase, f.payment);
  assert.equal(again.duplicatePayment, false);
  const duplicate = { ...f.purchase, purchaseId: '00000000-0000-4000-8000-000000000002' };
  f.rows[PURCHASE_UID].push(duplicate);
  const result = await f.service.grantCapturedPurchase(duplicate, { ...f.payment, id: 'pay_duplicate' });
  assert.equal(result.duplicatePayment, true);
  assert.equal(f.celebration.premiumPaymentId, 'pay_1');
  assert.equal(f.celebration.expiresAt, expiry);
  assert.match(duplicate.failureReason, /Duplicate captured payment/);
});

test('refunds revoke access only for a full refund of the canonical payment', async (t) => {
  for (const [name, refunded, canonical, revoked] of [
    ['partial refund', 100, 'pay_1', false],
    ['full refund', 900, 'pay_1', true],
    ['duplicate payment refund', 900, 'pay_original', false],
  ]) await t.test(name, async () => {
    const f = fixture({
      celebration: { premiumUnlocked: true, premiumPaymentId: canonical },
      purchase: { status: 'paid', razorpayPaymentId: 'pay_1' },
    });
    f.payment.amount_refunded = refunded;
    const result = await f.service.revokeRefundedPayment('pay_1');
    assert.equal(result.entitlementRevoked, revoked);
    assert.equal(f.celebration.premiumUnlocked, !revoked);
    assert.equal(f.purchase.status, refunded === 900 ? 'refunded' : 'paid');
  });
});

test('duplicate webhooks do not grant twice, and failed webhook processing can be retried', async () => {
  const f = fixture();
  const request = {
    eventId: 'event_1',
    event: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } },
  };
  const provider = f.service.razorpay;
  f.service.razorpay = async () => { throw new Error('Provider temporarily unavailable'); };
  await assert.rejects(f.service.processWebhook(request), /temporarily unavailable/);
  assert.equal(f.rows[WEBHOOK_UID][0].status, 'failed');
  assert.equal(f.celebration.premiumUnlocked, false);
  f.service.razorpay = provider;
  assert.equal((await f.service.processWebhook(request)).unlocked, true);
  assert.equal(f.rows[WEBHOOK_UID][0].status, 'processed');
  const providerCalls = f.providerCalls.length;
  assert.deepEqual(await f.service.processWebhook(request), { duplicate: true });
  assert.equal(f.providerCalls.length, providerCalls);
  assert.equal(f.rows[WEBHOOK_UID].length, 1);
});

test('free, paid, expired and unpublished access return the expected capabilities', () => {
  const f = fixture();
  const prices = { INR: 900, USD: 100 };
  const free = f.service.accessFor(f.celebration, prices);
  assert.deepEqual(free.features, ['collage']);
  assert.equal(free.ownerId, 42);
  assert.deepEqual(f.service.accessFor({ ...f.celebration, premiumUnlocked: true }, prices).features, ['video', 'collage']);
  assert.equal(f.service.accessFor({ ...f.celebration, premiumUnlocked: true, expiresAt: '2000-01-01' }, prices).unlocked, false);
  const story = { ...f.celebration, journeyType: 'story', premiumUnlocked: true };
  assert.deepEqual(f.service.accessFor(story, prices).features, []);
  assert.deepEqual(f.service.accessFor({ ...story, storyIsPublished: true }, prices).features, ['video', 'pdf']);
  assert.equal(f.service.accessFor({ ...story, storyIsPublished: true, storyExpiredAt: new Date().toISOString() }, prices).unlocked, false);
});
