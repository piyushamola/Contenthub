'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

const UID = 'api::premium-pricing.premium-pricing';
const DEFAULT_PRICES = Object.freeze({ INR: 900, USD: 100 });

function toMinorUnits(value, label) {
  const amount = Number(value);
  const minorUnits = Math.round(amount * 100);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(minorUnits) ||
    Math.abs(amount * 100 - minorUnits) > 0.000001
  ) {
    throw new Error(`${label} must be a positive amount with at most two decimal places`);
  }
  return minorUnits;
}

function originalMinorUnits(value, currentAmount) {
  // Optional display metadata must never block checkout or change its amount.
  if (!['number', 'string'].includes(typeof value) || value === '') return null;
  try {
    const original = toMinorUnits(value, 'Original price');
    return original > currentAmount ? original : null;
  } catch {
    return null;
  }
}

module.exports = createCoreService(UID, ({ strapi }) => ({
  async storySettings() {
    const settings = await strapi.db.query(UID).findOne({
      select: ['storyIndiaPriceRupees', 'storyOtherCountriesPriceUsd', 'storyIndiaOriginalPriceRupees', 'storyOtherCountriesOriginalPriceUsd'],
    });
    const INR = toMinorUnits(settings?.storyIndiaPriceRupees ?? 36, 'Story India price');
    const USD = toMinorUnits(settings?.storyOtherCountriesPriceUsd ?? 5, 'Story other countries price');
    return {
      INR,
      USD,
      originalINR: originalMinorUnits(settings?.storyIndiaOriginalPriceRupees, INR),
      originalUSD: originalMinorUnits(settings?.storyOtherCountriesOriginalPriceUsd, USD),
    };
  },
  async currentPrices() {
    const settings = await strapi.db.query(UID).findOne({
      select: ['indiaPriceRupees', 'otherCountriesPriceUsd', 'indiaOriginalPriceRupees', 'otherCountriesOriginalPriceUsd'],
    });
    // The old prices stay in effect until the singleton is saved for the
    // first time in Strapi. Once saved, invalid data must fail closed.
    if (!settings) return { ...DEFAULT_PRICES, originalINR: null, originalUSD: null };
    const INR = toMinorUnits(settings.indiaPriceRupees, 'India price');
    const USD = toMinorUnits(settings.otherCountriesPriceUsd, 'Other countries price');
    return {
      INR,
      USD,
      originalINR: originalMinorUnits(settings.indiaOriginalPriceRupees, INR),
      originalUSD: originalMinorUnits(settings.otherCountriesOriginalPriceUsd, USD),
    };
  },
}));
