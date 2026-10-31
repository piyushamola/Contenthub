'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { purgeRetained, celebrationRetentionDate } = require('../../src/privacy/celebration-erasure');
module.exports = async (app, base, ownerToken, otherToken, serverToken, user) => {
 const UID = 'api::happy-birthday.happy-birthday';
 async function req(path, token, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json().catch(() => null) };
 }
 // Strapi's unmatched POST fallback is 405 with a plain-text response.
 // The retired intake must reject notices even from the internal API token.
 assert.equal((await req('/privacy-requests/submit', serverToken, 'POST', {})).status, 405);
 // Use an actual upload and document in the disposable server/database.
 const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#f8d6e1' } }).png().toBuffer();
 const form = new FormData(); form.append('files', new Blob([image], { type: 'image/png' }), 'privacy-regression.png');
 const upload = await fetch(base + '/upload', { method: 'POST', headers: { Authorization: `Bearer ${serverToken}` }, body: form });
 const uploadBody = await upload.json();
 assert.ok(upload.ok, `Upload returned ${upload.status}: ${JSON.stringify(uploadBody)}`);
 const [file] = uploadBody;
 const entry = await app.documents(UID).create({ status: 'published', data: { personname: 'Private recipient', personemail: 'recipient@example.invalid', hostname: 'Owner', hostemail: user.email, customroute: `privacy-${randomUUID()}`, birthdaymessages: ['Personal'], templateId: 'friend', musicId: 'classic-celebration', owner: user.id, images: [file.id] } });
 const path = `/happy-birthdays/${entry.documentId}/erase`;
 for (const token of [undefined, ownerToken, otherToken, serverToken]) {
  assert.ok([404, 405].includes((await req(path, token, 'DELETE')).status), 'The removed erasure endpoint is unavailable');
 }
 // Public removal retains content/media and persists the calendar-year deadline.
 assert.equal((await req(`/happy-birthdays/${entry.documentId}/delete`, ownerToken, 'PUT')).status, 200);
 const retained = await app.db.query(UID).findOne({ where: { documentId: entry.documentId }, populate: { images: true } });
 assert.equal(retained.publishedAt, null); assert.equal(retained.images.length, 1);
 assert.equal(new Date(retained.retentionExpiresAt).toISOString(), celebrationRetentionDate(retained));
 const dashboard = await req('/happy-birthdays/mine?pageSize=50', ownerToken);
 const card = dashboard.body.data.find(row => row.documentId === entry.documentId);
 assert.equal(card.publiclyAvailable, false);
 assert.equal(new Date(card.retentionExpiresAt).toISOString(), celebrationRetentionDate(retained));
 assert.ok([404, 405].includes((await req(path, ownerToken, 'DELETE')).status));
 assert.equal(await app.db.query(UID).count({ where: { documentId: entry.documentId } }), 1);
 assert.equal(await app.db.query('plugin::upload.file').count({ where: { id: file.id } }), 1);
 const afterRemoval = await app.db.query(UID).findOne({ where: { documentId: entry.documentId }, populate: { images: true } });
 assert.deepEqual(afterRemoval.birthdaymessages, retained.birthdaymessages);
 assert.equal(new Date(afterRemoval.retentionExpiresAt).toISOString(), new Date(retained.retentionExpiresAt).toISOString());
 assert.deepEqual(afterRemoval.images.map(image => image.id), retained.images.map(image => image.id));
 const draft = await app.documents(UID).create({ data: { personname: 'Draft', personemail: user.email, hostname: 'Owner', hostemail: user.email, customroute: `privacy-${randomUUID()}`, birthdaymessages: [], templateId: 'friend', musicId: 'classic-celebration', owner: user.id } });
 assert.ok([404, 405].includes((await req(`/happy-birthdays/${draft.documentId}/erase`, ownerToken, 'DELETE')).status));
 assert.equal(await app.db.query(UID).count({ where: { documentId: draft.documentId } }), 1);
 // Exercise real persisted migration and cleanup with dates relative to now.
 const now = Date.now();
 const legacy = await app.documents(UID).create({ data: { personname: 'Retained history', personemail: user.email, hostname: 'Owner', hostemail: user.email, customroute: `privacy-${randomUUID()}`, birthdaymessages: ['Keep this memory'], templateId: 'friend', musicId: 'classic-celebration', owner: user.id } });
 await app.db.query(UID).updateMany({ where: { documentId: legacy.documentId }, data: {
  createdAt: new Date(now - 41 * 86400000).toISOString(),
  expiresAt: new Date(now - 40 * 86400000).toISOString(),
  retentionExpiresAt: new Date(now - 10 * 86400000).toISOString(),
 } });
 await purgeRetained(app, now);
 const migrated = await app.db.query(UID).findOne({ where: { documentId: legacy.documentId } });
 assert.ok(migrated, 'The old due 30-day deadline must not erase retained content');
 assert.equal(new Date(migrated.retentionExpiresAt).toISOString(), celebrationRetentionDate(migrated));
 assert.ok(Date.parse(migrated.retentionExpiresAt) > now);
 await purgeRetained(app, now);
 const repeated = await app.db.query(UID).findOne({ where: { documentId: legacy.documentId } });
 assert.equal(new Date(repeated.retentionExpiresAt).toISOString(), new Date(migrated.retentionExpiresAt).toISOString());
 assert.deepEqual(repeated.birthdaymessages, ['Keep this memory']);
 // An entry past its year is erased even if a previous deadline was too late.
 await app.db.query(UID).updateMany({ where: { documentId: legacy.documentId }, data: {
  createdAt: new Date(now - 402 * 86400000).toISOString(),
  expiresAt: new Date(now - 401 * 86400000).toISOString(),
  retentionExpiresAt: new Date(now + 30 * 86400000).toISOString(),
 } });
 await purgeRetained(app, now);
 assert.equal(await app.db.query(UID).count({ where: { documentId: legacy.documentId } }), 0);

};
