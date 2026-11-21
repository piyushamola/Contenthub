'use strict';

const { errors } = require('@strapi/utils');

const SUPPORTED_CURRENCIES = new Set([
  'INR',
  'USD',
  'GBP',
  'EUR',
  'PKR',
  'PHP',
  'IDR',
  'MYR',
  'SGD',
]);

const CURRENT_FIELDS = ['standardPrice', 'storyPrice'];
const ORIGINAL_FIELDS = ['standardOriginalPrice', 'storyOriginalPrice'];

function usesMinorUnits(value) {
  if (!['number', 'string'].includes(typeof value) || value === '') return false;
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  return (
    Number.isFinite(amount) &&
    amount > 0 &&
    Number.isSafeInteger(minor) &&
    Math.abs(amount * 100 - minor) <= 0.000001
  );
}

function validateCurrencyPricing(event) {
  const data = event.params?.data;
  if (!data) return;

  if (Object.hasOwn(data, 'currency')) {
    const normalized = String(data.currency || '').trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(normalized)) {
      throw new errors.ValidationError(
        `currency must be one of: ${[...SUPPORTED_CURRENCIES].join(', ')}`,
      );
    }
    data.currency = normalized;
  }

  for (const field of CURRENT_FIELDS) {
    if (Object.hasOwn(data, field) && !usesMinorUnits(data[field])) {
      throw new errors.ValidationError(
        `${field} must be a positive amount with at most two decimal places`,
      );
    }
  }

  for (const field of ORIGINAL_FIELDS) {
    const value = data[field];
    if (
      ['number', 'string'].includes(typeof value) &&
      Number.isFinite(Number(value)) &&
      Number(value) > 0 &&
      !usesMinorUnits(value)
    ) {
      data[field] = null;
    }
  }
}

function notifyFrontendPriceRevalidation() {
  const frontendUrl = process.env.FRONTEND_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!frontendUrl || !secret || typeof fetch !== 'function') return;
  void fetch(`${frontendUrl.replace(/\/$/, '')}/api/revalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-revalidate-secret': secret,
    },
    body: JSON.stringify({ event: 'entry.update', model: 'currency-pricing' }),
  }).catch(() => {});
}

module.exports = {
  beforeCreate: validateCurrencyPricing,
  beforeUpdate: validateCurrencyPricing,
  beforeUpdateMany: validateCurrencyPricing,
  afterCreate: notifyFrontendPriceRevalidation,
  afterUpdate: notifyFrontendPriceRevalidation,
  afterDelete: notifyFrontendPriceRevalidation,
};
