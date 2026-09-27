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

module.exports = createCoreService(UID, ({ strapi }) => ({
  async currentPrices() {
    const settings = await strapi.db.query(UID).findOne({
      select: ['indiaPriceRupees', 'otherCountriesPriceUsd'],
    });
    // The old prices stay in effect until the singleton is saved for the
    // first time in Strapi. Once saved, invalid data must fail closed.
    if (!settings) return DEFAULT_PRICES;
    return {
      INR: toMinorUnits(settings.indiaPriceRupees, 'India price'),
      USD: toMinorUnits(settings.otherCountriesPriceUsd, 'Other countries price'),
    };
  },
}));
