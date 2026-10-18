'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { formatLocal } = require('../../src/api/happy-birthday/utils/celebration-schedule');
const UID = 'api::happy-birthday.happy-birthday';

module.exports = async function checkStandardPrefill(app, user, request, serverToken, browserToken, otherId) {
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const source = await app.documents(UID).create({ status: 'published', data: {
    personname: 'Prefill Sam', personemail: 'private-recipient@example.invalid',
    hostname: 'Prefill Alex', hostemail: user.email, owner: user.id,
    customroute: `prefill-${randomUUID().slice(0, 8)}`, journeyType: 'standard',
    templateId: 'friend', musicId: 'classic-celebration', country: 'IN', expiresAt,
    birthdaymessages: ['A special birthday', 'First caption', 'Second caption', 'Third caption'],
  } });
  let story;
  const route = `/birthday-stories/from-standard/${source.customroute}`;
  const read = (body = {}, token = serverToken) => request(route, { token, method: 'POST', body: { ownerId: user.id, country: 'IN', ...body } });
  try {
    assert.equal((await request(route, { method: 'POST', body: { ownerId: user.id } })).status, 403);
    assert.equal((await read({}, browserToken)).status, 403, 'A browser JWT cannot call internal import reads');
    assert.equal((await read({ ownerId: otherId, admin: true })).status, 400, 'An admin hint cannot bypass source ownership');
    const count = await app.db.query(UID).count();
    const original = await app.db.query(UID).findMany({ where: { documentId: source.documentId }, populate: ['owner', 'images'] });
    const valid = await read();
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.body, {
      slug: source.customroute, forName: 'Prefill Sam', hostName: 'Prefill Alex',
      headline: 'A special birthday', musicId: 'classic-celebration', triggerLocal: '',
      photos: [], captions: ['First caption', 'Second caption', 'Third caption'],
    });
    assert.equal(await app.db.query(UID).count(), count, 'Reading prefill must not create any Story record');
    assert.deepEqual(await app.db.query(UID).findMany({ where: { documentId: source.documentId }, populate: ['owner', 'images'] }), original);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await app.db.query(UID).updateMany({ where: { documentId: source.documentId }, data: { triggerAt: future, timezone: 'Asia/Kolkata' } });
    const scheduled = await read({ country: 'US', browserTimeZone: 'America/Los_Angeles' });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.triggerLocal, formatLocal(future, 'America/Los_Angeles'));
    await app.db.query(UID).updateMany({ where: { documentId: source.documentId }, data: { triggerAt: null, expiresAt: new Date(Date.now() - 1000).toISOString() } });
    assert.equal((await read()).status, 400, 'Expired Standard sources cannot be imported');
    story = await app.service('api::happy-birthday.birthday-story').create(user.id, 'IN', randomUUID());
    assert.equal((await request(`/birthday-stories/from-standard/${story.slug}`, { token: serverToken, method: 'POST', body: { ownerId: user.id } })).status, 400);
    await app.documents(UID).delete({ documentId: source.documentId });
    assert.equal((await read()).status, 400, 'Deleted sources remain unavailable');
  } finally {
    await app.documents(UID).delete({ documentId: source.documentId });
    if (story) await app.documents(UID).delete({ documentId: story.documentId });
  }
};
