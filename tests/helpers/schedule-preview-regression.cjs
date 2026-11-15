'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const UID = 'api::happy-birthday.happy-birthday';

module.exports = async function checkSchedulePreview(app, user, request, serverToken, browserToken, otherId) {
  const path = '/celebration-schedule/preview';
  const read = (body, token = serverToken) => request(path, { token, method: 'POST', body });
  assert.equal((await read({ ownerId: user.id }, null)).status, 403);
  assert.equal((await read({ ownerId: user.id }, browserToken)).status, 403);
  const service = app.service('api::happy-birthday.birthday-story');
  const draft = await service.create(user.id, 'US', randomUUID());
  try {
    await app.db.query(UID).updateMany({ where: { documentId: draft.documentId }, data: { timezone: 'America/Los_Angeles' } });
    const before = await app.db.query(UID).findMany({ where: { documentId: draft.documentId }, orderBy: { id: 'asc' } });
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) + 'T09:00';
    const preview = await read({ ownerId: user.id, storyDocumentId: draft.documentId, country: 'IN', browserTimeZone: 'America/New_York', triggerLocal: future });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.timezone, 'America/Los_Angeles');
    assert.equal(preview.body.triggerLocal, future);
    assert.equal(preview.body.locked, false);
    assert.equal(Object.hasOwn(preview.body, 'content'), false);
    assert.equal((await read({ ownerId: otherId, storyDocumentId: draft.documentId, preset: 'midnight', admin: true })).status, 400);
    assert.equal((await read({ ownerId: user.id, triggerLocal: '2026-02-30T12:00' })).status, 400);
    const preset = await read({ ownerId: user.id, country: 'IN', browserTimeZone: 'America/Los_Angeles', preset: 'midnight' });
    assert.equal(preset.status, 200);
    assert.equal(preset.body.timezone, 'Asia/Kolkata');
    assert.match(preset.body.triggerLocal, /T00:00$/);
    assert.deepEqual(await app.db.query(UID).findMany({ where: { documentId: draft.documentId }, orderBy: { id: 'asc' } }), before, 'Preview must not save content, schedules, revisions or publication state');
  } finally { await app.documents(UID).delete({ documentId: draft.documentId }); }
};
