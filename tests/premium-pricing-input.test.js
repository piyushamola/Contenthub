'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const lifecycle = require('../src/api/premium-pricing/content-types/premium-pricing/lifecycles');

const current = { indiaPriceRupees: 9, otherCountriesPriceUsd: 1, storyIndiaPriceRupees: 36, storyOtherCountriesPriceUsd: 5 };
const originals = { indiaOriginalPriceRupees: 18.001, otherCountriesOriginalPriceUsd: '2.501', storyIndiaOriginalPriceRupees: 72.001, storyOtherCountriesOriginalPriceUsd: '10.001' };

for (const hook of ['beforeCreate', 'beforeUpdate', 'beforeUpdateMany']) {
  test(`${hook} preserves exact minor-unit prices and valid optional originals`, () => {
    const data = { ...current, indiaPriceRupees: 0.29, otherCountriesPriceUsd: '1.99',
      indiaOriginalPriceRupees: 18, otherCountriesOriginalPriceUsd: '2.50',
      storyIndiaOriginalPriceRupees: null, note: 'Unrelated data stays intact' };
    const before = structuredClone(data);
    lifecycle[hook]({ params: { data } });
    assert.deepEqual(data, before);
  });

  test(`${hook} rejects invalid current prices before a database can round the charge`, () => {
    for (const field of Object.keys(current)) {
      for (const value of [9.001, '1.999', 0, -1, null, true, {}, 'not-a-price', Infinity, Number.MAX_SAFE_INTEGER]) {
        const data = { ...current, ...originals, [field]: value };
        const before = structuredClone(data);
        assert.throws(() => lifecycle[hook]({ params: { data } }), error =>
          error.name === 'ValidationError' && /two decimal places/i.test(error.message));
        assert.deepEqual(data, before);
      }
    }
  });

  test(`${hook} clears over-precise display prices while preserving current charges`, () => {
    const data = { ...current, ...originals, note: 'Keep this value' };
    lifecycle[hook]({ params: { data } });
    for (const [field, value] of Object.entries(current)) assert.equal(data[field], value);
    for (const field of Object.keys(originals)) assert.equal(data[field], null);
    assert.equal(data.note, 'Keep this value');
  });
}
