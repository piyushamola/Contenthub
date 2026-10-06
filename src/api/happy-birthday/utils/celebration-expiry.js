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

/** When the public 24-hour window ends. A trigger time wins over creation time. */
function celebrationWindowEndMs(celebration) {
  const triggerAt = Date.parse(celebration?.triggerAt || '');
  if (Number.isFinite(triggerAt)) return triggerAt + CELEBRATION_DURATION_MS;
  const explicitExpiry = Date.parse(celebration?.expiresAt || '');
  if (Number.isFinite(explicitExpiry)) return explicitExpiry;
  const createdAt = Date.parse(celebration?.createdAt || '');
  return Number.isFinite(createdAt) ? createdAt + CELEBRATION_DURATION_MS : Number.NaN;
}

module.exports = { CELEBRATION_DURATION_MS, celebrationExpiresAt, celebrationWindowEndMs };
