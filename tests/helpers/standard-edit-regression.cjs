'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { uploadPrefix } = require('../../src/api/happy-birthday/utils/standard-edit');
const { withCelebrationLock } = require('../../src/api/happy-birthday/utils/celebration-lock');
const { sendOnce, UID: EMAIL } = require('../../src/email/celebration-delivery');
const { eraseCelebration } = require('../../src/privacy/celebration-erasure');
const UID = 'api::happy-birthday.happy-birthday';
const FILE = 'plugin::upload.file';
const PURCHASE = 'api::celebration-purchase.celebration-purchase';

module.exports = async function standardEditContracts(app, user, request, token, browserToken, otherId) {
  const service = app.service('api::happy-birthday.standard-edit');
  const upload = app.plugin('upload').service('upload');
  const originalRemove = upload.remove;
  const removed = []; const failRemoval = new Set(); const documents = []; const files = []; const purchases = [];
  upload.remove = async file => {
    if (failRemoval.has(file.id)) throw new Error('Controlled provider failure');
    removed.push(file.id); await app.db.query(FILE).delete({ where: { id: file.id } });
  };
  async function media(name) {
    const file = await app.db.query(FILE).create({ data: { name, hash: randomUUID().replaceAll('-', ''), ext: '.jpg', mime: 'image/jpeg', size: 1,
      url: `/uploads/${randomUUID()}.jpg`, provider: 'local' } });
    files.push(file.id); return file;
  }
  async function create({ premium = true, paused = true, images = [] } = {}) {
    const triggerAt = new Date(Date.now() + 3_600_000).toISOString();
    const entry = await app.documents(UID).create({ status: 'published', data: {
      personname: 'Original Friend', personemail: 'original@example.invalid', hostname: 'Original Host', hostemail: user.email, owner: user.id,
      customroute: `owner-edit-${randomUUID().slice(0, 12)}`, journeyType: 'standard', country: 'GB', templateId: 'friend', musicId: 'classic-celebration',
      birthdaymessages: ['Original greeting', 'First memory', 'Second memory', 'Third memory', '__wishhappybday_experience:premium'], images,
      triggerAt, timezone: 'Europe/London', expiresAt: new Date(Date.parse(triggerAt) + (premium ? 7 : 1) * 86_400_000).toISOString(),
      premiumUnlocked: premium, ...(premium ? { premiumPurchasedAt: new Date().toISOString(), premiumPurchaseId: `original-${randomUUID()}`, premiumPaymentId: `pay-${randomUUID()}` } : {}),
      celebrationStatus: paused ? 'paused' : 'active',
    } });
    documents.push(entry.documentId); return entry;
  }
  const rows = id => app.db.query(UID).findMany({ where: { documentId: id }, populate: { owner: true, images: true, standardEditAssets: true }, orderBy: { id: 'asc' } });
  const path = (id, action) => `/standard-celebrations/${id}/${action}`;
  const call = (id, action, body = {}, bearer = token) => request(path(id, action), { token: bearer, method: 'POST', body: { ...body, ownerId: body.ownerId ?? user.id } });
  const content = snapshot => ({ forName: snapshot.forName, personEmail: snapshot.personEmail, headline: snapshot.headline, captions: [...snapshot.captions], imageIds: snapshot.images.map(image => image.id) });
  const immutable = row => Object.fromEntries(['id', 'documentId', 'customroute', 'hostname', 'hostemail', 'country', 'templateId', 'musicId', 'createdAt', 'publishedAt', 'expiresAt', 'triggerAt', 'timezone', 'premiumUnlocked', 'premiumPurchasedAt', 'premiumPurchaseId', 'premiumPaymentId', 'celebrationStatus'].map(key => [key, row[key] instanceof Date ? row[key].toISOString() : row[key]]).concat([['owner', row.owner?.id]]));
  try {
    const originals = await Promise.all([0, 1, 2].map(i => media(`original-${i}.jpg`)));
    const entry = await create({ images: originals.map(file => file.id) });
    const existingOrder = await app.db.query(PURCHASE).create({ data: { purchaseId: entry.premiumPurchaseId, receipt: `existing-edit-${randomUUID()}`,
      celebrationDocumentId: entry.documentId, celebrationSlug: entry.customroute, owner: user.id, amountPaise: 315, currency: 'GBP',
      status: 'paid', productType: 'premium', purchasedAt: entry.premiumPurchasedAt, razorpayPaymentId: entry.premiumPaymentId } });
    purchases.push(existingOrder.id);
    const orderBefore = await app.db.query(PURCHASE).findOne({ where: { id: existingOrder.id } });
    const shared = await create({ images: [originals[1].id] });
    const unrelated = await media('another-document-photo.jpg');
    await sendOnce(app, entry, async () => {});
    const emailBefore = await app.db.query(EMAIL).findMany({ where: { celebrationDocumentId: entry.documentId } });
    const before = await rows(entry.documentId);
    const base = await call(entry.documentId, 'read');
    assert.equal(base.status, 200); assert.equal(base.body.status, 'paused');
    assert.equal(base.body.headline, 'Original greeting'); assert.deepEqual(base.body.images.map(image => image.id), originals.map(file => file.id));
    for (const bearer of [undefined, browserToken]) {
      const denied = await request(path(entry.documentId, 'read'), { token: bearer, method: 'POST', body: { ownerId: user.id } });
      assert.equal(denied.status, 403, 'Only the internal token may supply an owner ID');
    }
    assert.equal((await call(entry.documentId, 'read', { ownerId: otherId, admin: true })).status, 404);
    const replacement = await media(`${uploadPrefix(entry.documentId, user.id)}${randomUUID()}.jpg`);
    assert.equal((await call(entry.documentId, 'attach', { fileId: unrelated.id })).status, 400);
    assert.equal((await call(entry.documentId, 'attach', { ownerId: otherId, fileId: replacement.id })).status, 404);
    assert.equal((await call(entry.documentId, 'attach', { fileId: replacement.id })).status, 200);
    const valid = { ...content(base.body), forName: 'Corrected Friend', personEmail: 'corrected@example.invalid', headline: 'A corrected personal greeting', imageIds: [originals[1].id, replacement.id, originals[2].id] };
    for (const patch of [{ slug: 'forged' }, { expiresAt: '2099-01-01' }, { triggerAt: null }, { owner: otherId }, { country: 'US' }, { premiumUnlocked: false }, { templateId: 'love' }, { musicId: 'none' }])
      assert.equal((await call(entry.documentId, 'save', { revision: base.body.revision, content: { ...valid, ...patch } })).status, 400);
    assert.equal((await call(entry.documentId, 'save', { revision: base.body.revision, content: { ...valid, personEmail: 'invalid' } })).status, 400);
    assert.equal((await call(entry.documentId, 'save', { revision: base.body.revision, content: { ...valid, imageIds: [replacement.id, unrelated.id, originals[2].id] } })).status, 400);
    const saved = await call(entry.documentId, 'save', { revision: base.body.revision, content: valid });
    assert.equal(saved.status, 200); assert.equal(saved.body.revision, base.body.revision + 1);
    const after = await rows(entry.documentId);
    assert.deepEqual(after.map(immutable), before.map(immutable), 'Editing cannot move the URL/times, row identities, ownership or paid state');
    assert.deepEqual(await app.db.query(PURCHASE).findOne({ where: { id: existingOrder.id } }), orderBefore, 'Editing cannot rewrite or create a paid order');
    assert.equal(await app.db.query(PURCHASE).count({ where: { celebrationDocumentId: entry.documentId } }), 1, 'Editing cannot create another order');
    for (const row of after) {
      assert.equal(row.personname, valid.forName); assert.equal(row.personemail, valid.personEmail);
      assert.deepEqual(row.images.map(image => image.id), valid.imageIds, 'Both version relations preserve the requested order');
      assert.deepEqual(row.birthdaymessages, [valid.headline, ...valid.captions, '__wishhappybday_experience:premium']);
    }
    assert.ok(removed.includes(originals[0].id));
    assert.ok(await app.db.query(FILE).findOne({ where: { id: originals[1].id } }), 'A photo still shared with another document survives');
    assert.equal((await call(entry.documentId, 'save', { revision: base.body.revision, content: valid })).status, 409);
    assert.deepEqual((await rows(entry.documentId)).map(immutable), before.map(immutable));
    assert.equal(await app.db.query(EMAIL).count({ where: { celebrationDocumentId: entry.documentId } }), emailBefore.length);
    let resent = 0; await sendOnce(app, after.find(row => row.publishedAt), async () => { resent++; }); assert.equal(resent, 0);

    const unused = await media(`${uploadPrefix(entry.documentId, user.id)}${randomUUID()}.jpg`);
    assert.equal((await call(entry.documentId, 'attach', { fileId: unused.id })).status, 200);
    assert.equal((await call(entry.documentId, 'discard', { fileIds: [valid.imageIds[0]] })).status, 409);
    assert.equal((await call(entry.documentId, 'discard', { fileIds: [unused.id] })).status, 200);
    assert.equal(await app.db.query(FILE).findOne({ where: { id: unused.id } }), null);

    // A failure after the draft's scalar/media update must roll back both rows,
    // their relations and the claimed revision; the staged image remains retryable.
    const rollbackAsset = await media(`${uploadPrefix(entry.documentId, user.id)}${randomUUID()}.jpg`);
    assert.equal((await call(entry.documentId, 'attach', { fileId: rollbackAsset.id })).status, 200);
    const rollbackBefore = await rows(entry.documentId);
    const publishedId = rollbackBefore.find(row => row.publishedAt).id;
    const unsubscribe = app.db.lifecycles.subscribe({ models: [UID], beforeUpdate(event) {
      if (event.params.where?.id === publishedId && event.params.data.personname === 'Rollback attempt') throw new Error('Controlled second-version failure');
    } });
    try {
      assert.equal((await call(entry.documentId, 'save', { revision: saved.body.revision, content: { ...valid, forName: 'Rollback attempt', imageIds: [rollbackAsset.id, ...valid.imageIds.slice(1)] } })).status, 503);
    } finally { unsubscribe(); }
    assert.deepEqual(await rows(entry.documentId), rollbackBefore, 'Failed second-row update rolls back native rows and media relations');
    assert.ok(await app.db.query(FILE).findOne({ where: { id: rollbackAsset.id } }));

    failRemoval.add(originals[2].id);
    const retried = await call(entry.documentId, 'save', { revision: saved.body.revision, content: { ...valid, imageIds: [valid.imageIds[0], valid.imageIds[1], rollbackAsset.id] } });
    assert.equal(retried.status, 200, 'Provider cleanup failure cannot report a committed edit as failed');
    assert.ok((await rows(entry.documentId))[0].standardEditCleanupIds.includes(originals[2].id));
    failRemoval.clear(); await call(entry.documentId, 'read');
    assert.equal(await app.db.query(FILE).findOne({ where: { id: originals[2].id } }), null);

    const expired = new Date(Date.now() - 1000).toISOString();
    await app.db.query(UID).updateMany({ where: { documentId: entry.documentId }, data: { expiresAt: expired, triggerAt: null } });
    assert.equal((await call(entry.documentId, 'read')).status, 410);
    assert.equal((await call(entry.documentId, 'save', { revision: retried.body.revision, content: valid })).status, 410);
    await app.db.query(UID).updateMany({ where: { documentId: entry.documentId }, data: { expiresAt: before[0].expiresAt, triggerAt: before[0].triggerAt, erasureRequestedAt: new Date().toISOString() } });
    assert.equal((await call(entry.documentId, 'read')).status, 410);
    await app.db.query(UID).updateMany({ where: { documentId: entry.documentId }, data: { erasureRequestedAt: null } });
    const removedEntry = await create(); await app.service(UID).unpublishCelebration(removedEntry.documentId);
    assert.equal((await call(removedEntry.documentId, 'read')).status, 410);
    const story = await app.service('api::happy-birthday.birthday-story').create(user.id, 'IN', randomUUID());
    documents.push(story.documentId);
    assert.equal((await call(story.documentId, 'read')).status, 404, 'Story content cannot enter the Standard editor');

    // Hold the common native draft lock while edit, status and payment requests
    // begin, then release them together. The installed SQL dialect supplies the
    // actual serialization; only the payment provider boundary is bypassed.
    const raceImages = await Promise.all([0, 1, 2].map(i => media(`race-${i}.jpg`)));
    const race = await create({ premium: false, paused: false, images: raceImages.map(file => file.id) });
    const raceRead = (await call(race.documentId, 'read')).body;
    const raceIds = (await rows(race.documentId)).map(row => row.id);
    const purchase = await app.db.query(PURCHASE).create({ data: { purchaseId: randomUUID(), receipt: `edit-${randomUUID()}`, celebrationDocumentId: race.documentId,
      celebrationSlug: race.customroute, owner: user.id, amountPaise: 900, currency: 'INR', status: 'created', productType: 'premium' } });
    purchases.push(purchase.id);
    let acquired; let release;
    const locked = new Promise(resolve => { acquired = resolve; }); const hold = new Promise(resolve => { release = resolve; });
    const barrier = withCelebrationLock(app, race.documentId, async () => { acquired(); await hold; });
    let results;
    try {
      // A failed SQL lock must reject this wait instead of leaving the helper
      // waiting forever for a callback the transaction never entered.
      await Promise.race([locked, barrier]);
      const editRace = service.save(race.documentId, user.id, { ...content(raceRead), headline: 'Edited during a captured upgrade', imageIds: [raceImages[1].id, raceImages[0].id, raceImages[2].id] }, raceRead.revision);
      const paymentRace = app.service(PURCHASE).grantCapturedPurchase(purchase, { id: `pay-edit-${randomUUID()}`, status: 'captured', created_at: Math.floor(Date.now() / 1000) });
      const pauseRace = request(`/happy-birthdays/${race.documentId}/pause`, { token: browserToken, method: 'PUT' });
      release();
      results = await Promise.all([barrier, editRace, paymentRace, pauseRace]);
    } finally { release(); }
    const [, editResult, grantResult, pauseResult] = results;
    assert.equal(editResult.headline, 'Edited during a captured upgrade'); assert.equal(grantResult.unlocked, true); assert.equal(pauseResult.status, 200);
    const raceAfter = await rows(race.documentId);
    assert.deepEqual(raceAfter.map(row => row.id), raceIds);
    for (const row of raceAfter) {
      assert.equal(row.premiumUnlocked, true); assert.equal(row.celebrationStatus, 'paused');
      assert.equal(row.premiumPaymentId, grantResult.paymentId || (await app.db.query(PURCHASE).findOne({ where: { id: purchase.id } })).razorpayPaymentId);
      assert.equal(new Date(row.expiresAt).toISOString(), new Date(grantResult.expiresAt).toISOString());
      assert.deepEqual(row.images.map(image => image.id), [raceImages[1].id, raceImages[0].id, raceImages[2].id]);
    }
    assert.equal((await app.db.query(PURCHASE).findOne({ where: { id: purchase.id } })).status, 'paid');

    // Erasure also covers private staged/failed-cleanup/orphan upload media.
    const orphan = await media(`${uploadPrefix(entry.documentId, user.id)}${randomUUID()}.jpg`);
    const staged = await media(`${uploadPrefix(entry.documentId, user.id)}${randomUUID()}.jpg`);
    assert.equal((await call(entry.documentId, 'attach', { fileId: staged.id })).status, 200);
    assert.equal((await eraseCelebration(app, entry.documentId)).erased, true);
    assert.equal(await app.db.query(FILE).findOne({ where: { id: orphan.id } }), null);
    assert.equal(await app.db.query(FILE).findOne({ where: { id: staged.id } }), null);
    assert.ok(await app.db.query(FILE).findOne({ where: { id: originals[1].id } }), 'Another document still owns the shared image');
    assert.ok(shared.documentId);
  } finally {
    upload.remove = originalRemove;
    for (const id of documents.reverse()) await app.documents(UID).delete({ documentId: id });
    for (const id of files) await app.db.query(FILE).delete({ where: { id } });
    for (const id of purchases) await app.db.query(PURCHASE).delete({ where: { id } });
  }
};
