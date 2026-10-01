'use strict';

const CELEBRATION_DURATION_MS = 24 * 60 * 60 * 1000;

function celebrationExpiresAt(celebration) {
  const explicitExpiry = Date.parse(celebration?.expiresAt || '');
  if (Number.isFinite(explicitExpiry)) return new Date(explicitExpiry).toISOString();
  const createdAt = Date.parse(celebration?.createdAt || '');
  return Number.isFinite(createdAt)
    ? new Date(createdAt + CELEBRATION_DURATION_MS).toISOString()
    : null;
}

module.exports = { CELEBRATION_DURATION_MS, celebrationExpiresAt };
