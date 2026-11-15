'use strict';

const { previewCelebrationSchedule, presentSchedule, timezoneForCountry, timezoneLabel } = require('../utils/celebration-schedule');

module.exports = ({ strapi }) => ({
  async preview(ctx) {
    const body = ctx.request.body || {};
    try {
      if (!Number.isSafeInteger(body.ownerId) || body.ownerId <= 0) throw new Error('Log in to preview an opening time.');
      if (body.browserTimeZone !== undefined && (typeof body.browserTimeZone !== 'string' || body.browserTimeZone.length > 128)) throw new Error('Invalid browser time zone.');
      if (body.preset !== undefined && body.triggerLocal) throw new Error('Choose an opening time or a quick option, not both.');
      let country = body.country;
      let existingTimezone;
      if (body.storyDocumentId !== undefined) {
        if (typeof body.storyDocumentId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.storyDocumentId)) throw new Error('Story not found');
        let entry;
        try {
          entry = await strapi.service('api::happy-birthday.birthday-story').owned(body.storyDocumentId, body.ownerId);
        } catch (error) {
          if (error?.message === 'Story not found') throw error;
          ctx.status = 503;
          ctx.body = { error: { message: 'Opening-time preview is unavailable.' } };
          return;
        }
        country = entry.country;
        existingTimezone = entry.timezone;
        if (entry.storyFirstPublishedAt) {
          if (body.preset !== undefined || body.triggerLocal !== undefined && String(body.triggerLocal).trim() !== (presentSchedule(entry).triggerLocal || '')) throw new Error('The published opening time cannot be changed.');
          const schedule = presentSchedule(entry);
          const timezone = timezoneForCountry(country, body.browserTimeZone, existingTimezone);
          ctx.body = { ...schedule, timezone, timezoneLabel: timezoneLabel(timezone, country), triggerLocal: schedule.triggerLocal || '', validationError: null, locked: true, serverNow: new Date().toISOString() };
          return;
        }
      }
      ctx.body = { ...previewCelebrationSchedule({ country, existingTimezone, browserTimeZone: body.browserTimeZone, localTime: body.triggerLocal, preset: body.preset }), locked: false };
    } catch (error) {
      return ctx.badRequest(error.message || 'Could not preview the opening time.');
    }
  },
});
