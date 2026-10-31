'use strict';

const { errors } = require('@strapi/utils');

const CURRENT_FIELDS = ['indiaPriceRupees', 'otherCountriesPriceUsd', 'storyIndiaPriceRupees', 'storyOtherCountriesPriceUsd'];
const ORIGINAL_FIELDS = ['indiaOriginalPriceRupees', 'otherCountriesOriginalPriceUsd', 'storyIndiaOriginalPriceRupees', 'storyOtherCountriesOriginalPriceUsd'];

function usesMinorUnits(value) {
  if (!['number', 'string'].includes(typeof value) || value === '') return false;
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(minor) &&
    Math.abs(amount * 100 - minor) <= 0.000001;
}

function validatePrices(event) {
  const data = event.params?.data;
  if (!data) return;
  // Validate before PostgreSQL can round a decimal column to two places.
  // A required current price must never silently become a different charge.
  for (const field of CURRENT_FIELDS) {
    if (Object.hasOwn(data, field) && !usesMinorUnits(data[field])) {
      throw new errors.ValidationError(`${field} must be a positive amount with at most two decimal places`);
    }
  }
  // Optional comparisons do not change checkout amounts. Ignore invalid
  // precision instead of turning a rounded value into an advertised discount.
  for (const field of ORIGINAL_FIELDS) {
    const value = data[field];
    if (['number', 'string'].includes(typeof value) && Number.isFinite(Number(value)) &&
        Number(value) > 0 && !usesMinorUnits(value)) data[field] = null;
  }
}

module.exports = {
  beforeCreate: validatePrices,
  beforeUpdate: validatePrices,
  beforeUpdateMany: validatePrices,
};
