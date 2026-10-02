'use strict';
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { sendOnce, rememberExistingPublications, UID: DELIVERY_UID } = require('../../src/email/celebration-delivery');
const UID = 'api::happy-birthday.happy-birthday';

module.exports = async function celebrationEmailRegression(app) {
  const email = app.plugin('email').service('email');
  const originalSend = email.send;
  const messages = [];
  email.send = async (message) => { messages.push(message); };
  try {
    const draft = await app.documents(UID).create({ data: {
      personname: 'Email regression', personemail: 'recipient@example.invalid',
      hostname: 'Creator', hostemail: 'email-regression@example.invalid',
      customroute: 'single-email-regression', birthdaymessages: ['Happy birthday'],
      templateId: 'confetti', musicId: 'classic-celebration', journeyType: 'standard',
    } });
    assert.equal(messages.length, 0, 'Draft creation must not send a ready email');
    const publication = await app.documents(UID).publish({ documentId: draft.documentId });
    const published = publication.entries[0];
    for (let attempt = 0; attempt < 100; attempt++) {
      const delivery = await app.db.query(DELIVERY_UID).findOne({ where: { celebrationDocumentId: draft.documentId } });
      if (delivery?.deliveryStatus === 'sent') break;
      await delay(20);
    }
    assert.equal(messages.length, 1, 'Only publication should send the ready email');
    assert.equal(messages[0].replyTo, 'wishhappybday@gmail.com');
    assert.equal(messages[0].to, 'email-regression@example.invalid');
    for (const celebrationStatus of ['paused', 'active']) {
      await app.documents(UID).update({ documentId: draft.documentId, status: 'published', data: { celebrationStatus } });
      await sendOnce(app, published, email.send);
    }
    await Promise.all(Array.from({ length: 5 }, () => sendOnce(app, published, email.send)));
    assert.equal(messages.length, 1, 'Updates, re-publication, and repeated delivery calls cannot resend');
    await assert.rejects(app.db.query(DELIVERY_UID).create({ data: {
      celebrationDocumentId: draft.documentId, deliveryStatus: 'claimed',
    } }), 'The database must enforce unique delivery claims');
    await rememberExistingPublications(app);
    await sendOnce(app, published, email.send);
    assert.equal(messages.length, 1, 'Restart/backfill must not resend existing publications');
    const legacy = await app.documents(UID).create({ data: {
      personname: 'Legacy', personemail: 'recipient@example.invalid',
      hostname: 'Creator', hostemail: 'legacy@example.invalid',
      customroute: 'legacy-email-regression', birthdaymessages: ['Happy birthday'],
      templateId: 'confetti', musicId: 'classic-celebration',
    } });
    // Simulate a published row from before the delivery ledger existed.
    await app.db.query(UID).updateMany({ where: { documentId: legacy.documentId }, data: { publishedAt: new Date().toISOString() } });
    await rememberExistingPublications(app);
    await sendOnce(app, { ...legacy, publishedAt: new Date().toISOString() }, email.send);
    assert.equal(messages.length, 1, 'Pre-deployment celebrations must not receive new ready emails');
    await app.documents(UID).delete({ documentId: legacy.documentId });
    const failed = await app.documents(UID).create({ data: {
      personname: 'Failure', personemail: 'recipient@example.invalid',
      hostname: 'Creator', hostemail: 'failure@example.invalid',
      customroute: 'failed-email-regression', birthdaymessages: ['Happy birthday'],
      templateId: 'confetti', musicId: 'classic-celebration',
    } });
    await app.db.query(UID).updateMany({ where: { documentId: failed.documentId }, data: { publishedAt: new Date().toISOString() } });
    let attempts = 0;
    const failingProvider = async () => { attempts++; throw new Error('Simulated SMTP failure'); };
    const failedEvent = { ...failed, publishedAt: new Date().toISOString() };
    await Promise.all(Array.from({ length: 5 }, () => sendOnce(app, failedEvent, failingProvider)));
    await sendOnce(app, failedEvent, failingProvider);
    assert.equal(attempts, 1, 'An uncertain SMTP result must not trigger duplicate delivery attempts');
    const failedDelivery = await app.db.query(DELIVERY_UID).findOne({ where: { celebrationDocumentId: failed.documentId } });
    assert.equal(failedDelivery.deliveryStatus, 'failed');
    assert.ok(await app.documents(UID).findOne({ documentId: failed.documentId, status: 'published' }));
    await app.documents(UID).delete({ documentId: failed.documentId });
    let rolledBackId;
    await assert.rejects(app.db.transaction(async () => {
      const rolledBack = await app.documents(UID).create({ status: 'published', data: {
        personname: 'Rollback', personemail: 'recipient@example.invalid',
        hostname: 'Creator', hostemail: 'rollback@example.invalid',
        customroute: 'rollback-email-regression', birthdaymessages: ['Happy birthday'],
        templateId: 'confetti', musicId: 'classic-celebration',
      } });
      rolledBackId = rolledBack.documentId;
      throw new Error('Roll back publication');
    }), /Roll back publication/);
    assert.equal(await app.db.query(UID).findOne({ where: { documentId: rolledBackId } }), null);
    assert.equal(await app.db.query(DELIVERY_UID).findOne({ where: { celebrationDocumentId: rolledBackId } }), null);
    assert.equal(messages.length, 1, 'Rolled-back publications must not send mail');
    await app.documents(UID).delete({ documentId: draft.documentId });
  } finally {
    email.send = originalSend;
  }
};
