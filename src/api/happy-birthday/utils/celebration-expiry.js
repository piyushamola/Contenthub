'use strict';

const CELEBRATION_DURATION_MS = 24 * 60 * 60 * 1000;
const PAID_CELEBRATION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function isPaidCelebration(celebration) {
  return Boolean(celebration?.premiumUnlocked || celebration?.journeyType === 'story');
}

function celebrationDurationMs(celebration) {
  return isPaidCelebration(celebration)
    ? PAID_CELEBRATION_DURATION_MS
    : CELEBRATION_DURATION_MS;
}

function celebrationExpiresAt(celebration) {
  const explicitExpiry = Date.parse(celebration?.expiresAt || '');
  if (Number.isFinite(explicitExpiry)) return new Date(explicitExpiry).toISOString();
  const createdAt = Date.parse(celebration?.createdAt || '');
  return Number.isFinite(createdAt)
    ? new Date(createdAt + celebrationDurationMs(celebration)).toISOString()
    : null;
}

/**
 * Compute the 7-day expiry for a newly paid Standard Premium celebration,
 * anchored to its scheduled triggerAt (if future/set) or its original createdAt.
 */
function paidCelebrationExpiresAt(celebration, fallbackIso) {
  const triggerAt = Date.parse(celebration?.triggerAt || '');
  if (Number.isFinite(triggerAt)) {
    return new Date(triggerAt + PAID_CELEBRATION_DURATION_MS).toISOString();
  }
  const createdAt = Date.parse(celebration?.createdAt || fallbackIso || '');
  if (Number.isFinite(createdAt)) {
    return new Date(createdAt + PAID_CELEBRATION_DURATION_MS).toISOString();
  }
  const explicitExpiry = Date.parse(celebration?.expiresAt || '');
  if (Number.isFinite(explicitExpiry)) {
    return new Date(explicitExpiry).toISOString();
  }
  return null;
}

/** When the public window ends. A trigger time wins over creation time unless an explicit expiry was set. */
function celebrationWindowEndMs(celebration) {
  const durationMs = celebrationDurationMs(celebration);
  const triggerAt = Date.parse(celebration?.triggerAt || '');
  if (Number.isFinite(triggerAt)) return triggerAt + durationMs;
  const explicitExpiry = Date.parse(celebration?.expiresAt || '');
  if (Number.isFinite(explicitExpiry)) return explicitExpiry;
  const createdAt = Date.parse(celebration?.createdAt || '');
  return Number.isFinite(createdAt) ? createdAt + durationMs : Number.NaN;
}

module.exports = {
  CELEBRATION_DURATION_MS,
  PAID_CELEBRATION_DURATION_MS,
  celebrationDurationMs,
  celebrationExpiresAt,
  paidCelebrationExpiresAt,
  celebrationWindowEndMs,
};
