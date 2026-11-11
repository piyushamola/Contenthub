'use strict';

const { randomUUID } = require('node:crypto');
const { celebrationWindowEndMs } = require('../utils/celebration-expiry');
const { isBeforeTrigger } = require('../utils/celebration-schedule');
const { REPLY_TO } = require('../../../email/settings');

const UID = 'api::happy-birthday.happy-birthday';
const NON_EXPIRING_ROUTES = new Set(
  (process.env.BIRTHDAY_EXPIRY_EXCLUDED_ROUTES || 'elena,matt,mike')
    .split(',').map((slug) => slug.trim().toLowerCase()).filter(Boolean),
);
const SITE_ORIGIN = (process.env.FRONTEND_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://www.wishhappybdayto.me'
    : 'http://localhost:3000')).replace(/\/$/, '');

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function getEmailService(strapi) {
  return strapi?.plugin?.('email')?.service('email') ||
    strapi?.plugins?.email?.services?.email || null;
}

async function notifyHostOnFirstOpen(strapi, entry) {
  if (!entry?.hostemail) return;
  const emailService = getEmailService(strapi);
  if (!emailService) return;
  const hostName = entry.hostname || 'there';
  const personName = entry.personname || 'your recipient';
  const celebrationUrl = `${SITE_ORIGIN}/${encodeURIComponent(entry.customroute)}`;
  const dashboardUrl = `${SITE_ORIGIN}/dashboard`;
  try {
    await emailService.send({
      to: entry.hostemail,
      replyTo: REPLY_TO,
      subject: `✨ ${personName} just opened their birthday surprise!`,
      text: `Hi ${hostName},\n\nGreat news — ${personName} just opened their birthday surprise for the first time!\n\nView the celebration: ${celebrationUrl}\nManage on your dashboard: ${dashboardUrl}\n\nWith love,\nWishHappyBday`,
      html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#fff8f3;font-family:Arial,sans-serif;color:#302146">
<table role="presentation" style="width:100%;max-width:560px;margin:auto;border-collapse:collapse;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #f0dde6">
<tr><td style="padding:24px 32px;background:#8a4561;color:#fff;font-size:20px;font-weight:700">🎂 WishHappyBday</td></tr>
<tr><td style="padding:32px"><p style="margin:0 0 12px;font-size:17px">Hi ${escapeHtml(hostName)},</p>
<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25">✨ ${escapeHtml(personName)} just opened their birthday surprise!</h1>
<p style="font-size:15px;line-height:1.6">Your birthday surprise was just unwrapped. You can view the live celebration page or check the open status on your dashboard.</p>
<p style="margin:24px 0"><a href="${celebrationUrl}" style="display:inline-block;padding:13px 22px;background:#8a4561;color:#fff;text-decoration:none;border-radius:30px;font-weight:700">View celebration</a></p>
<p style="margin-top:24px;font-size:14px;color:#62546d">With love,<br>WishHappyBday</p></td></tr></table></body></html>`,
    });
  } catch (err) {
    strapi?.log?.warn?.(`Could not send first-open notification email: ${err?.message || err}`);
  }
}

async function notifyHostOnReaction(strapi, entry, wish) {
  if (!entry?.hostemail) return;
  const emailService = getEmailService(strapi);
  if (!emailService) return;
  const hostName = entry.hostname || 'there';
  const personName = entry.personname || 'your birthday celebration';
  const celebrationUrl = `${SITE_ORIGIN}/${encodeURIComponent(entry.customroute)}`;
  const reactionLabel = wish.reaction ? `${wish.reaction}` : '💬 New wish';
  try {
    await emailService.send({
      to: entry.hostemail,
      replyTo: REPLY_TO,
      subject: `${wish.reaction ? `${wish.reaction} from ${wish.name}` : `New birthday wish from ${wish.name}`} on ${personName}'s celebration`,
      text: `Hi ${hostName},\n\n${wish.name} just left a birthday wish on ${personName}'s surprise page!\n\n${wish.reaction ? `Reaction: ${reactionLabel}\n` : ''}Message: "${wish.message}"\n\nView it on the celebration page: ${celebrationUrl}\n\nWith love,\nWishHappyBday`,
      html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#fff8f3;font-family:Arial,sans-serif;color:#302146">
<table role="presentation" style="width:100%;max-width:560px;margin:auto;border-collapse:collapse;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #f0dde6">
<tr><td style="padding:24px 32px;background:#8a4561;color:#fff;font-size:20px;font-weight:700">🎂 WishHappyBday</td></tr>
<tr><td style="padding:32px"><p style="margin:0 0 12px;font-size:17px">Hi ${escapeHtml(hostName)},</p>
<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25">${escapeHtml(wish.name)} left a wish on ${escapeHtml(personName)}&rsquo;s celebration!</h1>
<div style="margin:18px 0;padding:16px 20px;background:#fdf4f7;border-left:4px solid #8a4561;border-radius:10px">
${wish.reaction ? `<p style="margin:0 0 8px;font-size:18px;font-weight:700">${escapeHtml(wish.reaction)}</p>` : ''}
<p style="margin:0;font-size:15px;line-height:1.5">&ldquo;${escapeHtml(wish.message)}&rdquo;</p>
<p style="margin:8px 0 0;font-size:13px;color:#62546d">&mdash; ${escapeHtml(wish.name)}</p>
</div>
<p style="margin:24px 0"><a href="${celebrationUrl}" style="display:inline-block;padding:13px 22px;background:#8a4561;color:#fff;text-decoration:none;border-radius:30px;font-weight:700">View celebration</a></p>
<p style="margin-top:24px;font-size:14px;color:#62546d">With love,<br>WishHappyBday</p></td></tr></table></body></html>`,
    });
  } catch (err) {
    strapi?.log?.warn?.(`Could not send reaction notification email: ${err?.message || err}`);
  }
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function available(entry, storyOnly) {
  const expiry = celebrationWindowEndMs(entry);
  const isStory = entry?.journeyType === 'story';
  if (!entry?.publishedAt || entry.erasureRequestedAt ||
      entry.celebrationStatus === 'paused' || entry.storyExpiredAt ||
      (storyOnly && !isStory) || (isStory && !entry.premiumUnlocked) ||
      (!NON_EXPIRING_ROUTES.has(String(entry.customroute).toLowerCase()) &&
        (!Number.isFinite(expiry) || expiry <= Date.now()))) {
    fail('Celebration not available', 404);
  }
}

function storedWishes(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

module.exports = ({ strapi }) => ({
  async addWish(slug, input, { storyOnly = false } = {}) {
    const route = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(route)) fail('Celebration not available', 404);
    if (route === 'elena') fail('Wishes are disabled for this demo', 403);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const reaction = typeof input?.reaction === 'string' ? input.reaction.trim().slice(0, 60) : '';
    const rawMessage = typeof input?.message === 'string' ? input.message.trim() : '';
    const message = rawMessage || (reaction.length >= 4 ? reaction : '');
    if (!name || name.length > 100 || message.length < 4 || message.length > 2000) {
      fail('Add your name (1–100 characters) and wish (4–2000 characters)', 400);
    }

    let notifyTarget = null;
    const outcome = await strapi.db.transaction(async () => {
      const query = strapi.db.query(UID);
      const entry = await query.findOne({ where: {
        customroute: { $eqi: route }, publishedAt: { $notNull: true },
        ...(storyOnly ? { journeyType: 'story' } : {}),
      } });
      available(entry, storyOnly);

      // Updating the published row takes the same transaction lock used by
      // Story wishes. Re-read after the lock so concurrent appends do not lose
      // wishes and a pause, unpublish or erasure cannot use stale eligibility.
      await query.updateMany({ where: { id: entry.id }, data: { updatedAt: new Date() } });
      const current = await query.findOne({ where: { id: entry.id } });
      available(current, storyOnly);
      const erasing = await query.findOne({ where: {
        documentId: current.documentId, erasureRequestedAt: { $notNull: true },
      } });
      if (erasing) fail('Celebration not available', 404);

      const wish = {
        id: randomUUID(),
        name,
        message,
        ...(reaction ? { reaction } : {}),
        createdAt: new Date().toISOString(),
      };
      const wishes = [...storedWishes(current.guestwishes), wish];
      // Do not use Document Service publication here: it would also publish
      // the creator's unfinished edits. Keep both copies' wish lists in sync.
      await query.updateMany({
        where: { documentId: current.documentId },
        data: { guestwishes: wishes, updatedAt: new Date() },
      });
      if (!isBeforeTrigger(current.triggerAt) && (reaction || current.journeyType === 'story')) {
        notifyTarget = { entry: current, wish };
      }
      return isBeforeTrigger(current.triggerAt) ? { wish } : { wish, wishes };
    });

    if (notifyTarget) {
      await notifyHostOnReaction(strapi, notifyTarget.entry, notifyTarget.wish);
    }
    return outcome;
  },

  async recordOpen(slug) {
    const route = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(route)) fail('Celebration not available', 404);
    if (NON_EXPIRING_ROUTES.has(route)) {
      return { opened: false, demo: true };
    }

    let firstOpenEntry = null;
    const result = await strapi.db.transaction(async () => {
      const query = strapi.db.query(UID);
      const entry = await query.findOne({
        where: { customroute: { $eqi: route }, publishedAt: { $notNull: true } },
      });
      available(entry, false);
      if (isBeforeTrigger(entry.triggerAt)) fail('Celebration not available', 404);

      await query.updateMany({ where: { id: entry.id }, data: { updatedAt: new Date() } });
      const current = await query.findOne({ where: { id: entry.id } });
      available(current, false);
      if (isBeforeTrigger(current.triggerAt)) fail('Celebration not available', 404);

      const metadata = current.storyAssetMetadata && typeof current.storyAssetMetadata === 'object'
        ? current.storyAssetMetadata
        : {};
      const previous = metadata.__engagement && typeof metadata.__engagement === 'object'
        ? metadata.__engagement
        : {};
      const now = new Date().toISOString();
      const isFirstOpen = !previous.firstOpenedAt;
      const firstOpenedAt = previous.firstOpenedAt || now;
      const openCount = (Number.isInteger(previous.openCount) && previous.openCount > 0 ? previous.openCount : 0) + 1;
      const nextMetadata = {
        ...metadata,
        __engagement: {
          ...previous,
          firstOpenedAt,
          lastOpenedAt: now,
          openCount,
        },
      };

      await query.updateMany({
        where: { documentId: current.documentId },
        data: { storyAssetMetadata: nextMetadata },
      });

      if (isFirstOpen) {
        firstOpenEntry = current;
      }
      return { opened: true, isFirstOpen, firstOpenedAt, openCount };
    });

    if (firstOpenEntry) {
      await notifyHostOnFirstOpen(strapi, firstOpenEntry);
    }
    return result;
  },
});
