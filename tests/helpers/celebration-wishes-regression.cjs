'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const UID = 'api::happy-birthday.happy-birthday';

module.exports = async function checkCelebrationWishes(app, user, request, serverToken, browserToken) {
  const documents = [];
  const readOnly = await app.admin.services['api-token'].create({
    name: `wish-read-only-${randomUUID()}`, description: 'Disposable regression access only',
    type: 'read-only', lifespan: null,
  });
  async function create(journeyType, status = 'published') {
    const entry = await app.documents(UID).create({ status, data: {
      personname: 'Scheduled birthday', personemail: 'birthday@example.invalid',
      hostname: 'Birthday host', hostemail: user.email, owner: user.id,
      customroute: `wish-${randomUUID()}`, journeyType, country: 'IN',
      templateId: 'classic', musicId: 'none', birthdaymessages: ['Published message'],
      guestwishes: [{ id: 'earlier-wish', name: 'Earlier visitor', message: 'A private early wish' }],
      triggerAt: new Date(Date.now() + 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 90_000_000).toISOString(),
      ...(journeyType === 'story' ? {
        premiumUnlocked: true, storyFirstPublishedAt: new Date().toISOString(),
        storyPublishedContent: { letter: 'The public Story letter' },
        storyContent: { letter: 'Initial saved Story letter' },
      } : {}),
    } });
    documents.push(entry.documentId);
    return entry;
  }
  const send = (slug, body = { name: '  Jamie  ', message: '  Happy birthday to you!  ' }, token = serverToken) =>
    request(`/celebration-wishes/${slug}`, { token, method: 'POST', body });
  try {
    for (const journeyType of ['standard', 'story']) {
      const entry = await create(journeyType);
      const where = { documentId: entry.documentId };
      const readRows = () => app.db.query(UID).findMany({ where });
      await app.db.query(UID).updateMany({ where: { ...where, publishedAt: null }, data: {
        birthdaymessages: ['Private unfinished message'],
        ...(journeyType === 'story' ? { storyContent: { letter: 'Private unfinished Story letter' } } : {}),
      } });
      const original = await readRows();
      for (const token of [null, browserToken, readOnly.accessKey]) {
        assert.equal((await send(entry.customroute, undefined, token)).status, 403, 'Only the internal server token may append wishes');
      }
      for (const body of [{ name: ' ', message: 'Happy birthday' }, { name: ['Jamie'], message: 'Happy birthday' },
        { name: 'Jamie', message: ' x ' }, { name: 'x'.repeat(101), message: 'Happy birthday' },
        { name: 'Jamie', message: 'x'.repeat(2001) }]) {
        assert.equal((await send(entry.customroute, body)).status, 400);
      }
      assert.deepEqual(await readRows(), original, 'Denied requests never change content or timestamps');
      const early = await send(entry.customroute.toUpperCase());
      assert.equal(early.status, 200);
      assert.deepEqual(Object.keys(early.body), ['wish'], 'Scheduled response must not expose the whole wish list');
      assert.equal(early.body.wish.name, 'Jamie');
      assert.equal(early.body.wish.message, 'Happy birthday to you!');
      assert.equal(typeof early.body.wish.id, 'string');
      const saved = await readRows();
      assert.equal(saved.length, 2);
      assert.ok(saved.every((row) => row.guestwishes.length === 2));
      assert.deepEqual(saved[0].guestwishes, saved[1].guestwishes);
      for (const row of saved) {
        const before = original.find((item) => item.id === row.id);
        assert.deepEqual(row.birthdaymessages, before.birthdaymessages);
        assert.deepEqual(row.storyContent, before.storyContent);
        assert.deepEqual(row.storyPublishedContent, before.storyPublishedContent);
        assert.equal(row.expiresAt, before.expiresAt);
        assert.equal(row.triggerAt, before.triggerAt);
        assert.equal(row.publishedAt, before.publishedAt);
      }
      if (journeyType === 'standard') {
        const compatibility = await request(`/birthday-stories/wishes/${entry.customroute}`, {
          token: serverToken, method: 'POST', body: { name: 'Story route', message: 'This must not be saved' },
        });
        assert.equal(compatibility.status, 400, 'The old Story endpoint remains Story-only');
      }
      for (const patch of [
        { celebrationStatus: 'paused' }, { erasureRequestedAt: new Date().toISOString() },
        ...(journeyType === 'story' ? [{ premiumUnlocked: false }, { storyExpiredAt: new Date().toISOString() }] : []),
      ]) {
        await app.db.query(UID).updateMany({ where, data: patch });
        assert.equal((await send(entry.customroute)).status, 404);
        assert.ok((await readRows()).every((row) => row.guestwishes.length === 2));
        await app.db.query(UID).updateMany({ where, data: {
          celebrationStatus: 'active', erasureRequestedAt: null, storyExpiredAt: null,
          premiumUnlocked: journeyType === 'story',
        } });
      }
      await app.db.query(UID).updateMany({ where, data: {
        triggerAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 86_340_000).toISOString(),
      } });
      const together = await Promise.all(['First visitor', 'Second visitor'].map((name) => send(entry.customroute, { name, message: 'A wish after opening' })));
      assert.ok(together.every((response) => response.status === 200 && Array.isArray(response.body.wishes)));
      const opened = await readRows();
      assert.ok(opened.every((row) => row.guestwishes.length === 4), 'Concurrent appends must preserve both wishes');
      assert.deepEqual(opened[0].guestwishes, opened[1].guestwishes);
      assert.ok(opened[0].guestwishes.some((wish) => wish.id === early.body.wish.id));
      await app.db.query(UID).updateMany({ where, data: {
        triggerAt: null, expiresAt: new Date(Date.now() - 1).toISOString(),
      } });
      assert.equal((await send(entry.customroute)).status, 404);
      assert.ok((await readRows()).every((row) => row.guestwishes.length === 4));
    }
    const unpublished = await create('standard', 'draft');
    assert.equal((await send(unpublished.customroute)).status, 404);
    const unpublishedStory = await create('story', 'draft');
    assert.equal((await send(unpublishedStory.customroute)).status, 404);
    assert.equal((await send('not-a-real-birthday')).status, 404);
    assert.equal((await send('elena')).status, 403);
  } finally {
    for (const documentId of documents) await app.documents(UID).delete({ documentId });
  }
};
