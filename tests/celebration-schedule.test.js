'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveTrigger,
  storyTriggerExpiry,
  storyTriggerPatch,
  timezoneForCountry,
  zonedLocalToUtc,
} = require('../src/api/happy-birthday/utils/celebration-schedule');

test('midnight is interpreted in the celebration country, not UTC', () => {
  assert.equal(zonedLocalToUtc('2026-10-07T00:00', 'Asia/Kolkata'), '2026-10-06T18:30:00.000Z');
  assert.equal(zonedLocalToUtc('2026-01-04T00:00', 'America/Los_Angeles'), '2026-01-04T08:00:00.000Z');
  assert.equal(zonedLocalToUtc('2026-07-04T00:00', 'America/Los_Angeles'), '2026-07-04T07:00:00.000Z');
});

test('a country with several time zones uses the creator zone when it belongs there', () => {
  assert.equal(timezoneForCountry('US', 'America/Los_Angeles'), 'America/Los_Angeles');
  assert.equal(timezoneForCountry('US', 'Asia/Kolkata'), 'America/New_York');
  assert.equal(timezoneForCountry('IN', 'America/New_York'), 'Asia/Kolkata');
  assert.equal(
    timezoneForCountry('US', 'America/Chicago', 'America/Los_Angeles'),
    'America/Los_Angeles',
  );
});

test('an unknown country falls back to the creator clock, then UTC', () => {
  assert.equal(timezoneForCountry('UNKNOWN', 'Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(timezoneForCountry('', 'Not/AZone'), 'UTC');
});

test('trigger time must be soon enough to be real and not more than a year away', () => {
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  const indiaMidnight = resolveTrigger({
    country: 'IN',
    localTime: '2026-10-07T00:00',
    now,
  });
  assert.equal(indiaMidnight.triggerAt, '2026-10-06T18:30:00.000Z');
  assert.equal(indiaMidnight.expiresAt, '2026-10-07T18:30:00.000Z');
  assert.match(indiaMidnight.timezoneLabel, /India/);

  const tooSoon = resolveTrigger({
    country: 'IN',
    localTime: '2026-10-06T17:30',
    now,
  });
  assert.match(tooSoon.error, /at least a minute/);

  const missing = resolveTrigger({
    country: 'US',
    browserTimeZone: 'America/New_York',
    localTime: '2026-03-08T02:30',
    now: Date.parse('2026-03-01T00:00:00.000Z'),
  });
  assert.match(missing.error, /valid date and time/);
});

test('a published story keeps the trigger time that was set in the form', () => {
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  const draft = storyTriggerPatch(
    { country: 'US', storyFirstPublishedAt: null },
    { triggerLocal: '2026-10-07T00:00', browserTimeZone: 'America/Los_Angeles' },
    now,
  );
  assert.equal(draft.timezone, 'America/Los_Angeles');
  assert.equal(draft.triggerAt, '2026-10-07T07:00:00.000Z');

  const published = {
    country: 'US',
    timezone: 'America/Los_Angeles',
    triggerAt: draft.triggerAt,
    storyFirstPublishedAt: '2026-10-06T12:00:00.000Z',
  };
  assert.deepEqual(
    storyTriggerPatch(published, { triggerLocal: '2026-10-07T00:00' }, now),
    {},
  );
  assert.throws(
    () => storyTriggerPatch(published, { triggerLocal: '2026-10-08T01:00' }, now),
    /only set the trigger time once/,
  );
  assert.deepEqual(storyTriggerPatch({ storyFirstPublishedAt: null }, {}, now), {});
});

test('a story without a trigger lasts 24 hours from publish, and a passed trigger cannot be published', () => {
  const publishedAt = '2026-10-06T12:00:00.000Z';
  assert.equal(
    storyTriggerExpiry({ triggerAt: null }, publishedAt, Date.parse(publishedAt)),
    '2026-10-07T12:00:00.000Z',
  );
  assert.equal(
    storyTriggerExpiry({ triggerAt: '2026-10-07T00:00:00.000Z' }, publishedAt, Date.parse(publishedAt)),
    '2026-10-08T00:00:00.000Z',
  );
  assert.equal(
    storyTriggerExpiry(
      { triggerAt: '2026-10-05T00:00:00.000Z' },
      publishedAt,
      Date.parse(publishedAt),
    ),
    null,
  );
});
