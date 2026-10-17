'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricingFactory = require('../src/api/premium-pricing/services/premium-pricing');
const purchaseFactory = require('../src/api/celebration-purchase/services/celebration-purchase');

const PRICING_UID = 'api::premium-pricing.premium-pricing';
const PURCHASE_UID = 'api::celebration-purchase.celebration-purchase';
const CELEBRATION_UID = 'api::happy-birthday.happy-birthday';

function fakeContentType(uid) {
  return { uid };
}

test('Strapi prices are converted from editable rupees and dollars to payment units', async () => {
  let settings = null;
  const pricing = pricingFactory({
    strapi: {
      contentType: fakeContentType,
      db: { query: () => ({ findOne: async () => settings }) },
    },
  });

  assert.deepEqual(await pricing.currentPrices(), { INR: 900, USD: 100, originalINR: null, originalUSD: null });
  settings = { indiaPriceRupees: '18', otherCountriesPriceUsd: '5.50' };
  assert.deepEqual(await pricing.currentPrices(), { INR: 1800, USD: 550, originalINR: null, originalUSD: null });
  settings = { indiaPriceRupees: '18.001', otherCountriesPriceUsd: '5' };
  await assert.rejects(pricing.currentPrices(), /at most two decimal places/);
});

for (const product of [
  { label: 'Standard Premium', method: 'currentPrices', current: ['indiaPriceRupees', 'otherCountriesPriceUsd'], original: ['indiaOriginalPriceRupees', 'otherCountriesOriginalPriceUsd'] },
  { label: 'Birthday Story', method: 'storySettings', current: ['storyIndiaPriceRupees', 'storyOtherCountriesPriceUsd'], original: ['storyIndiaOriginalPriceRupees', 'storyOtherCountriesOriginalPriceUsd'] },
]) {
  test(`${product.label} originals are optional, validated display amounts for each currency`, async (t) => {
    const settings = { [product.current[0]]: '18', [product.current[1]]: '5.50' };
    const pricing = pricingFactory({ strapi: {
      contentType: fakeContentType,
      db: { query: () => ({ findOne: async () => settings }) },
    } });
    const expected = { INR: 1800, USD: 550, originalINR: null, originalUSD: null };
    assert.deepEqual(await pricing[product.method](), expected);
    settings[product.original[0]] = '36.25';
    settings[product.original[1]] = 10;
    assert.deepEqual(await pricing[product.method](), { ...expected, originalINR: 3625, originalUSD: 1000 });

    for (const [index, currency, current] of [[0, 'INR', 18], [1, 'USD', 5.5]]) {
      for (const [label, value] of [
        ['missing', undefined], ['null', null], ['empty', ''], ['whitespace', '  '],
        ['invalid text', 'not-a-price'], ['zero', 0], ['negative', -1],
        ['nonfinite', Infinity], ['NaN', NaN], ['boolean', true], ['object', {}],
        ['three decimal places', '99.999'], ['unsafe amount', Number.MAX_SAFE_INTEGER],
        ['equal to current', current], ['lower than current', current - 0.01],
      ]) await t.test(`${currency}: ${label} hides the original without changing current prices`, async () => {
        settings[product.original[index]] = value;
        const result = await pricing[product.method]();
        assert.equal(result[`original${currency}`], null);
        assert.equal(result.INR, 1800);
        assert.equal(result.USD, 550);
      });
    }
    settings[product.original[0]] = '50';
    settings[product.current[0]] = '18.001';
    await assert.rejects(pricing[product.method](), /at most two decimal places/, 'A valid original cannot rescue an invalid charged price');
  });
}

test('new Razorpay orders use the saved price and existing orders retain theirs', async () => {
  const previousKeyId = process.env.RAZORPAY_KEY_ID;
  const previousKeySecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = 'test_key';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret';

  try {
    let settings = { indiaPriceRupees: '18', otherCountriesPriceUsd: '5', indiaOriginalPriceRupees: '99', otherCountriesOriginalPriceUsd: '12' };
    const purchases = new Map();
    const providerOrders = [];
    const celebration = {
      documentId: 'celebration-1',
      customroute: 'birthday-test',
      country: 'IN',
      owner: { id: 42 },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      premiumUnlocked: false,
    };
    const pricing = pricingFactory({
      strapi: {
        contentType: fakeContentType,
        db: { query: () => ({ findOne: async () => settings }) },
      },
    });
    const strapi = {
      contentType: fakeContentType,
      service: (uid) => {
        assert.equal(uid, PRICING_UID);
        return pricing;
      },
      db: {
        query: (uid) => {
          if (uid === CELEBRATION_UID) {
            return { findOne: async () => celebration };
          }
          assert.equal(uid, PURCHASE_UID);
          return {
            findOne: async ({ where }) => purchases.get(where.purchaseId) || null,
            create: async ({ data }) => {
              purchases.set(data.purchaseId, { ...data });
            },
            update: async ({ where, data }) => {
              purchases.set(where.purchaseId, {
                ...purchases.get(where.purchaseId),
                ...data,
              });
            },
            updateMany: async ({ where, data }) => {
              const current = purchases.get(where.purchaseId);
              if (!current || current.status !== where.status) return { count: 0 };
              purchases.set(where.purchaseId, { ...current, ...data });
              return { count: 1 };
            },
          };
        },
      },
    };
    const purchase = purchaseFactory({ strapi });
    purchase.razorpay = async (_path, init) => {
      const order = JSON.parse(init.body);
      providerOrders.push(order);
      return { id: `order_${providerOrders.length}`, status: 'created' };
    };

    const firstId = '00000000-0000-4000-8000-000000000001';
    const first = await purchase.createOrder({
      slug: celebration.customroute,
      purchaseId: firstId,
      country: 'US',
      ownerId: 42,
    });
    assert.equal(first.amount, 1800);
    assert.equal(first.currency, 'INR');
    assert.equal(providerOrders[0].amount, 1800);

    settings = { indiaPriceRupees: '36', otherCountriesPriceUsd: '5', indiaOriginalPriceRupees: '72', otherCountriesOriginalPriceUsd: '10' };
    const existing = await purchase.createOrder({
      slug: celebration.customroute,
      purchaseId: firstId,
      country: 'US',
      ownerId: 42,
    });
    assert.equal(existing.amount, 1800);
    assert.equal(providerOrders.length, 1);

    const second = await purchase.createOrder({
      slug: celebration.customroute,
      purchaseId: '00000000-0000-4000-8000-000000000002',
      country: 'US',
      ownerId: 42,
    });
    assert.equal(second.amount, 3600);
    assert.equal(providerOrders[1].amount, 3600);

    celebration.country = 'US';
    const international = await purchase.createOrder({
      slug: celebration.customroute,
      purchaseId: '00000000-0000-4000-8000-000000000003',
      country: 'IN',
      ownerId: 42,
    });
    assert.equal(international.amount, 500);
    assert.equal(international.currency, 'USD');
    assert.equal(providerOrders[2].amount, 500);

    for (const [index, country] of [null, 'India'].entries()) {
      celebration.country = country;
      const quote = await purchase.getAccess(celebration.customroute, 'IN');
      assert.equal(quote.amountPaise, 3600);
      assert.equal(quote.currency, 'INR');
      assert.equal(quote.originalAmountPaise, 7200);
      const legacyOrder = await purchase.createOrder({
        slug: celebration.customroute,
        purchaseId: `00000000-0000-4000-8000-00000000000${index + 4}`,
        country: 'IN', ownerId: 42,
      });
      assert.equal(legacyOrder.amount, quote.amountPaise);
      assert.equal(legacyOrder.currency, quote.currency);
      assert.equal(providerOrders[index + 3].amount, quote.amountPaise);
      assert.equal(providerOrders[index + 3].currency, quote.currency);
    }
  } finally {
    if (previousKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = previousKeyId;
    if (previousKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = previousKeySecret;
  }
});
