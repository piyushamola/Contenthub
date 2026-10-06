'use strict';

const { CELEBRATION_DURATION_MS } = require('./celebration-expiry');

const MIN_LEAD_MS = 60 * 1000;
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;

// The first zone is the one most people in that country use. A creator whose
// browser zone is also in the list keeps that zone, so "midnight" in
// California is Pacific time rather than New York.
const TIME_ZONES = {
  AE: ['Asia/Dubai'],
  AR: ['America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba'],
  AT: ['Europe/Vienna'],
  AU: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin', 'Australia/Lord_Howe'],
  BD: ['Asia/Dhaka'],
  BE: ['Europe/Brussels'],
  BR: ['America/Sao_Paulo', 'America/Manaus', 'America/Recife', 'America/Fortaleza', 'America/Belem', 'America/Cuiaba', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'],
  CA: ['America/Toronto', 'America/Winnipeg', 'America/Edmonton', 'America/Vancouver', 'America/Halifax', 'America/St_Johns', 'America/Regina'],
  CH: ['Europe/Zurich'],
  CL: ['America/Santiago', 'Pacific/Easter'],
  CN: ['Asia/Shanghai', 'Asia/Urumqi'],
  CO: ['America/Bogota'],
  DE: ['Europe/Berlin'],
  DK: ['Europe/Copenhagen'],
  EG: ['Africa/Cairo'],
  ES: ['Europe/Madrid', 'Atlantic/Canary'],
  FI: ['Europe/Helsinki'],
  FR: ['Europe/Paris'],
  GB: ['Europe/London'],
  GH: ['Africa/Accra'],
  GR: ['Europe/Athens'],
  HK: ['Asia/Hong_Kong'],
  ID: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'],
  IE: ['Europe/Dublin'],
  IL: ['Asia/Jerusalem'],
  IN: ['Asia/Kolkata'],
  IT: ['Europe/Rome'],
  JP: ['Asia/Tokyo'],
  KE: ['Africa/Nairobi'],
  KR: ['Asia/Seoul'],
  KZ: ['Asia/Almaty', 'Asia/Aqtobe', 'Asia/Qostanay', 'Asia/Aqtau'],
  LK: ['Asia/Colombo'],
  MX: ['America/Mexico_City', 'America/Cancun', 'America/Monterrey', 'America/Mazatlan', 'America/Tijuana', 'America/Chihuahua', 'America/Hermosillo'],
  MY: ['Asia/Kuala_Lumpur'],
  NG: ['Africa/Lagos'],
  NL: ['Europe/Amsterdam'],
  NO: ['Europe/Oslo'],
  NP: ['Asia/Kathmandu'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham'],
  PH: ['Asia/Manila'],
  PK: ['Asia/Karachi'],
  PL: ['Europe/Warsaw'],
  PT: ['Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira'],
  RU: ['Europe/Moscow', 'Europe/Kaliningrad', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Sakhalin', 'Asia/Kamchatka'],
  SA: ['Asia/Riyadh'],
  SE: ['Europe/Stockholm'],
  SG: ['Asia/Singapore'],
  TH: ['Asia/Bangkok'],
  TR: ['Europe/Istanbul'],
  TW: ['Asia/Taipei'],
  UA: ['Europe/Kyiv'],
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Adak', 'Pacific/Honolulu', 'America/Boise', 'America/Indiana/Indianapolis', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Nome'],
  VN: ['Asia/Ho_Chi_Minh'],
  ZA: ['Africa/Johannesburg'],
};

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonesForCountry(country) {
  const code = String(country || '').trim().toUpperCase();
  return TIME_ZONES[code] ? [...TIME_ZONES[code]] : [];
}

function timezoneForCountry(country, browserTimeZone, existingTimezone) {
  if (isValidTimeZone(existingTimezone)) return existingTimezone;
  const zones = zonesForCountry(country);
  if (isValidTimeZone(browserTimeZone) && zones.includes(browserTimeZone)) return browserTimeZone;
  if (zones.length) return zones[0];
  if (isValidTimeZone(browserTimeZone)) return browserTimeZone;
  return 'UTC';
}

function wallParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  // Some engines report midnight as 24:00.
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocal(iso, timeZone) {
  const parsed = Date.parse(iso || '');
  if (!Number.isFinite(parsed) || !isValidTimeZone(timeZone)) return null;
  const parts = wallParts(new Date(parsed), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function timezoneLabel(timeZone, country) {
  if (!isValidTimeZone(timeZone)) return null;
  const zoneName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longGeneric',
  }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || timeZone;
  const code = String(country || '').trim().toUpperCase();
  let countryName = '';
  if (code && code !== 'UNKNOWN') {
    try {
      countryName = new Intl.DisplayNames('en', { type: 'region' }).of(code) || '';
    } catch {
      countryName = '';
    }
  }
  return countryName ? `${zoneName} (${countryName})` : zoneName;
}

function zoneOffset(date, timeZone) {
  const parts = wallParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedLocalToUtc(localTime, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(localTime || ''));
  if (!match || !isValidTimeZone(timeZone)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffset(new Date(utcGuess), timeZone);
  let utc = utcGuess - firstOffset;
  const secondOffset = zoneOffset(new Date(utc), timeZone);
  if (firstOffset !== secondOffset) utc = utcGuess - secondOffset;

  const check = wallParts(new Date(utc), timeZone);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) {
    return null;
  }
  return new Date(utc).toISOString();
}

function resolveTrigger({
  country,
  existingTimezone,
  browserTimeZone,
  localTime,
  now = Date.now(),
}) {
  const timezone = timezoneForCountry(country, browserTimeZone, existingTimezone);
  const triggerAt = zonedLocalToUtc(localTime, timezone);
  if (!triggerAt) {
    return { error: 'Choose a valid date and time. That clock time needs to exist in the celebration time zone.' };
  }
  const triggerMs = Date.parse(triggerAt);
  if (triggerMs < now + MIN_LEAD_MS) {
    return { error: 'Choose a time at least a minute from now.' };
  }
  if (triggerMs > now + MAX_LEAD_MS) {
    return { error: 'Choose a time within the next year.' };
  }
  return {
    triggerAt,
    timezone,
    triggerLocal: formatLocal(triggerAt, timezone),
    timezoneLabel: timezoneLabel(timezone, country),
    expiresAt: new Date(triggerMs + CELEBRATION_DURATION_MS).toISOString(),
  };
}

function presentSchedule(entry) {
  const timezone = isValidTimeZone(entry?.timezone) ? entry.timezone : null;
  const triggerAt = typeof entry?.triggerAt === 'string' && Number.isFinite(Date.parse(entry.triggerAt))
    ? new Date(entry.triggerAt).toISOString()
    : null;
  return {
    triggerAt,
    timezone,
    triggerLocal: triggerAt && timezone ? formatLocal(triggerAt, timezone) : null,
    timezoneLabel: timezone ? timezoneLabel(timezone, entry?.country) : null,
  };
}

function isBeforeTrigger(triggerAt, now = Date.now()) {
  const parsed = Date.parse(triggerAt || '');
  return Number.isFinite(parsed) && parsed > now;
}

function storyTriggerPatch(entry, trigger = {}, now = Date.now()) {
  if (!Object.prototype.hasOwnProperty.call(trigger, 'triggerLocal') || trigger.triggerLocal === undefined) {
    return {};
  }
  const nextLocal = trigger.triggerLocal == null ? '' : String(trigger.triggerLocal).trim();
  if (entry?.storyFirstPublishedAt) {
    const existing = presentSchedule(entry).triggerLocal || '';
    if (nextLocal === existing) return {};
    throw new Error('You can only set the trigger time once. It cannot be changed after you publish.');
  }
  if (!nextLocal) return { triggerAt: null, timezone: null };
  const resolved = resolveTrigger({
    country: entry?.country,
    existingTimezone: entry?.timezone,
    browserTimeZone: trigger.browserTimeZone,
    localTime: nextLocal,
    now,
  });
  if (resolved.error) throw new Error(resolved.error);
  return { triggerAt: resolved.triggerAt, timezone: resolved.timezone };
}

function storyTriggerExpiry(entry, publishedAt, now = Date.now()) {
  const triggerMs = Date.parse(entry?.triggerAt || '');
  if (!Number.isFinite(triggerMs)) {
    return new Date(Date.parse(publishedAt) + CELEBRATION_DURATION_MS).toISOString();
  }
  if (triggerMs + CELEBRATION_DURATION_MS <= now) return null;
  return new Date(triggerMs + CELEBRATION_DURATION_MS).toISOString();
}

module.exports = {
  TIME_ZONES,
  formatLocal,
  isBeforeTrigger,
  presentSchedule,
  resolveTrigger,
  storyTriggerExpiry,
  storyTriggerPatch,
  timezoneForCountry,
  timezoneLabel,
  zonedLocalToUtc,
};
