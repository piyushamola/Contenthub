'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

const UID = 'api::currency-pricing.currency-pricing';

const DEFAULT_PPP_CURRENCY_PRICES = Object.freeze([
  { currency: 'INR', standardPrice: 18, standardOriginalPrice: 49, storyPrice: 45, storyOriginalPrice: 99 },
  { currency: 'PKR', standardPrice: 60, standardOriginalPrice: 150, storyPrice: 150, storyOriginalPrice: 350 },
  { currency: 'PHP', standardPrice: 49, standardOriginalPrice: 149, storyPrice: 99, storyOriginalPrice: 249 },
  { currency: 'IDR', standardPrice: 15000, standardOriginalPrice: 39000, storyPrice: 29000, storyOriginalPrice: 69000 },
  { currency: 'MYR', standardPrice: 4, standardOriginalPrice: 12, storyPrice: 8, storyOriginalPrice: 19 },
  { currency: 'SGD', standardPrice: 1.99, standardOriginalPrice: 5, storyPrice: 3.99, storyOriginalPrice: 9 },
  { currency: 'GBP', standardPrice: 0.99, standardOriginalPrice: 2.99, storyPrice: 2.49, storyOriginalPrice: 6.99 },
  { currency: 'EUR', standardPrice: 0.99, standardOriginalPrice: 2.99, storyPrice: 2.99, storyOriginalPrice: 6.99 },
  { currency: 'USD', standardPrice: 1, standardOriginalPrice: 3, storyPrice: 2.99, storyOriginalPrice: 7 },
]);

module.exports = createCoreService(UID, ({ strapi }) => ({
  getDefaultPppRows() {
    return DEFAULT_PPP_CURRENCY_PRICES;
  },

  async ensureDefaultPppRows() {
    const query = strapi.db?.query?.(UID);
    if (!query || typeof query.findMany !== 'function') return;
    const existing = await query.findMany({ select: ['currency'] });
    const existingCurrencies = new Set(
      (existing || []).map((row) => String(row.currency || '').trim().toUpperCase()),
    );
    for (const row of DEFAULT_PPP_CURRENCY_PRICES) {
      if (existingCurrencies.has(row.currency)) continue;
      if (strapi.documents) {
        await strapi.documents(UID).create({ data: row });
      } else if (typeof query.create === 'function') {
        await query.create({ data: row });
      }
    }
  },
}));
