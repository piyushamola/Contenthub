'use strict';

const assert = require('node:assert/strict');

const PRICING_UID = 'api::premium-pricing.premium-pricing';
const CELEBRATION_UID = 'api::happy-birthday.happy-birthday';
const ORIGINAL_FIELDS = ['indiaOriginalPriceRupees', 'otherCountriesOriginalPriceUsd', 'storyIndiaOriginalPriceRupees', 'storyOtherCountriesOriginalPriceUsd'];

// Called by the existing real Strapi/HTTP gate with its isolated database.
module.exports = async function checkOriginalPricing(app, user, celebration, request, token) {
  const pricing = await app.documents(PRICING_UID).create({ data: {
    indiaPriceRupees: 9, otherCountriesPriceUsd: 1,
    storyIndiaPriceRupees: 36, storyOtherCountriesPriceUsd: 5,
  } });
  const previous = await app.db.query(CELEBRATION_UID).findOne({ where: { documentId: celebration.documentId } });
  let story;
  async function expectPricing(standardOriginal, storyOriginal) {
    const standard = await request('/celebration-payments/pricing', { token });
    const storyPrices = await request('/celebration-payments/pricing?product=story', { token });
    assert.equal(standard.status, 200);
    assert.equal(storyPrices.status, 200);
    assert.deepEqual(standard.body, { INR: 900, USD: 100, originalINR: standardOriginal[0], originalUSD: standardOriginal[1] });
    assert.deepEqual(storyPrices.body, { INR: 3600, USD: 500, originalINR: storyOriginal[0], originalUSD: storyOriginal[1] });
  }
  try {
    const saved = await app.db.query(PRICING_UID).findOne({ where: { documentId: pricing.documentId } });
    for (const field of ORIGINAL_FIELDS) assert.equal(saved[field], null, 'Existing pricing without originals must not acquire a default discount');
    await expectPricing([null, null], [null, null]);
    await app.documents(PRICING_UID).update({ documentId: pricing.documentId, data: {
      indiaOriginalPriceRupees: 18, otherCountriesOriginalPriceUsd: 2.5,
      storyIndiaOriginalPriceRupees: 72, storyOtherCountriesOriginalPriceUsd: 10,
    } });
    await expectPricing([1800, 250], [7200, 1000]);

    story = await app.service('api::happy-birthday.birthday-story').create(user.id, 'IN', require('node:crypto').randomUUID());
    for (const [documentId, slug, amounts, originals, journeyType] of [
      [celebration.documentId, celebration.customroute, [900, 100], [1800, 250], 'standard'],
      [story.documentId, story.slug, [3600, 500], [7200, 1000], 'story'],
    ]) {
      for (const [index, country, currency] of [[0, 'IN', 'INR'], [1, 'US', 'USD']]) {
        await app.db.query(CELEBRATION_UID).updateMany({ where: { documentId }, data: { country } });
        const oppositeCountry = country === 'IN' ? 'US' : 'IN';
        const access = await request(`/celebration-payments/access/${slug}?country=${oppositeCountry}`, { token });
        assert.equal(access.status, 200);
        assert.equal(access.body.journeyType, journeyType);
        assert.equal(access.body.amountPaise, amounts[index]);
        assert.equal(access.body.currency, currency);
        assert.equal(access.body.originalAmountPaise, originals[index]);
        assert.equal(access.body.unlocked, false, 'A comparison price cannot grant paid access');
      }
      for (const country of [null, 'India']) {
        await app.db.query(CELEBRATION_UID).updateMany({ where: { documentId }, data: { country } });
        for (const [index, fallback, currency] of [[0, 'in', 'INR'], [1, 'US', 'USD']]) {
          const access = await request(`/celebration-payments/access/${slug}?country=${fallback}`, { token });
          assert.equal(access.status, 200);
          assert.equal(access.body.journeyType, journeyType);
          assert.equal(access.body.amountPaise, amounts[index]);
          assert.equal(access.body.currency, currency);
          assert.equal(access.body.originalAmountPaise, originals[index]);
          assert.equal(access.body.unlocked, false);
        }
      }
      // Only a single two-letter string is accepted. Missing/invalid country
      // hints keep the existing international quote for legacy records.
      for (const query of ['', '?country=India', '?country=IN&country=US', '?country[code]=IN']) {
        const access = await request(`/celebration-payments/access/${slug}${query}`, { token });
        assert.equal(access.status, 200);
        assert.equal(access.body.currency, 'USD');
        assert.equal(access.body.amountPaise, amounts[1]);
        assert.equal(access.body.originalAmountPaise, originals[1]);
      }
      const unauthorized = await request(`/celebration-payments/access/${slug}?country=IN`);
      assert.equal(unauthorized.status, 403, 'Country hints do not make the server-only access route public');
    }

    await app.documents(PRICING_UID).update({ documentId: pricing.documentId, data: {
      indiaOriginalPriceRupees: 9, otherCountriesOriginalPriceUsd: 0.99,
      storyIndiaOriginalPriceRupees: 36, storyOtherCountriesOriginalPriceUsd: 4.99,
    } });
    await expectPricing([null, null], [null, null]);

    // Decimal columns can hold extra precision; display metadata is ignored
    // rather than blocking a valid current checkout price.
    await app.documents(PRICING_UID).update({ documentId: pricing.documentId, data: {
      indiaOriginalPriceRupees: 18.001, otherCountriesOriginalPriceUsd: 2.501,
      storyIndiaOriginalPriceRupees: 72.001, storyOtherCountriesOriginalPriceUsd: 10.001,
    } });
    await expectPricing([null, null], [null, null]);
    for (const field of ORIGINAL_FIELDS) {
      for (const invalid of [0, -1, 'not-a-price']) {
        await assert.rejects(() => app.documents(PRICING_UID).update({ documentId: pricing.documentId, data: { [field]: invalid } }));
      }
    }
    await app.documents(PRICING_UID).update({ documentId: pricing.documentId, data: Object.fromEntries(ORIGINAL_FIELDS.map(field => [field, null])) });
    const cleared = await app.db.query(PRICING_UID).findOne({ where: { documentId: pricing.documentId } });
    for (const field of ORIGINAL_FIELDS) assert.equal(cleared[field], null);
    await expectPricing([null, null], [null, null]);
  } finally {
    await app.db.query(CELEBRATION_UID).updateMany({ where: { documentId: celebration.documentId }, data: { country: previous.country } });
    if (story) await app.documents(CELEBRATION_UID).delete({ documentId: story.documentId });
    await app.documents(PRICING_UID).delete({ documentId: pricing.documentId });
  }
  console.log('PASS: optional original pricing persists, clears and updates through real Strapi; INR/USD Standard and Story HTTP quotes retain current charges and permissions.');
};
