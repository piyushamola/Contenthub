'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const nodePath = require('node:path');
const { purgeRetained, celebrationRetentionDate } = require('../../src/privacy/celebration-erasure');
module.exports = async (app, base, ownerToken, otherToken, serverToken, user) => {
 const UID = 'api::happy-birthday.happy-birthday';
 async function req(path, token, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json().catch(() => null) };
 }
 function storedUploadPaths(file) {
  return [file, ...Object.values(file.formats || {})].map(asset => nodePath.join(app.dirs.static.public, 'uploads', `${asset.hash}${asset.ext}`));
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
 const originalPaths = storedUploadPaths(file);
 for (const filePath of originalPaths) await fs.access(filePath);
 const entry = await app.documents(UID).create({ status: 'published', data: { personname: 'Private recipient', personemail: 'recipient@example.invalid', hostname: 'Owner', hostemail: user.email, customroute: `privacy-${randomUUID()}`, birthdaymessages: ['Personal'], templateId: 'friend', musicId: 'classic-celebration', owner: user.id, images: [file.id] } });
 const path = `/happy-birthdays/${entry.documentId}/erase`;
 for (const token of [undefined, ownerToken, otherToken]) {
  assert.ok([401, 403].includes((await req(path, token, 'DELETE', { ownerId: user.id, country: 'US' })).status), 'Browser callers cannot supply their own country or owner');
 }
 for (const country of ['IN', 'UNKNOWN', 'ZZ', '', 'in', 'IN,US']) assert.equal((await req(path, serverToken, 'DELETE', { ownerId: user.id, country })).status, 403);
 const forbiddenMarker = await req(`/happy-birthdays/${entry.documentId}`, ownerToken, 'PUT', { data: { erasureRequestedAt: new Date().toISOString() } });
 assert.equal(forbiddenMarker.status, 403);
 assert.equal((await req(`/happy-birthdays/${entry.documentId}`, ownerToken, 'DELETE')).status, 403);
 assert.equal((await req(path, serverToken, 'DELETE', { ownerId: user.id + 10000, country: 'US' })).status, 404);
 // A valid JSON DELETE must reach the real controller with owner and country.
 // It erases an active document directly, including both publication versions,
 // media-library records and the original/derived files on disposable storage.
 const activeForm = new FormData(); activeForm.append('files', new Blob([image], { type: 'image/png' }), 'privacy-active.png');
 const activeUpload = await fetch(base + '/upload', { method: 'POST', headers: { Authorization: `Bearer ${serverToken}` }, body: activeForm });
 assert.ok(activeUpload.ok);
 const [activeFile] = await activeUpload.json();
 const activePaths = storedUploadPaths(activeFile);
 for (const filePath of activePaths) await fs.access(filePath);
 const active = await app.documents(UID).create({ status: 'published', data: { personname: 'Active deletion', personemail: user.email, hostname: 'Owner', hostemail: user.email, customroute: `privacy-active-${randomUUID()}`, birthdaymessages: ['Erase all versions'], templateId: 'friend', musicId: 'classic-celebration', owner: user.id, images: [activeFile.id] } });
 const activePath = `/happy-birthdays/${active.documentId}/erase`;
 const versions = await app.db.query(UID).findMany({ where: { documentId: active.documentId } });
 assert.ok(versions.some(row => row.publishedAt));
 assert.ok(versions.some(row => !row.publishedAt));
 assert.equal((await req(activePath, serverToken, 'DELETE')).status, 404, 'A missing actor is denied without disclosing the celebration');
 assert.equal(await app.db.query(UID).count({ where: { documentId: active.documentId } }), versions.length);
 assert.equal(await app.db.query('plugin::upload.file').count({ where: { id: activeFile.id } }), 1);
 for (const filePath of activePaths) await fs.access(filePath);
 const activeErased = await req(activePath, serverToken, 'DELETE', { ownerId: user.id, country: 'US' });
 assert.equal(activeErased.status, 200, JSON.stringify(activeErased.body));
 assert.equal(activeErased.body.erased, true);
 assert.equal(await app.db.query(UID).count({ where: { documentId: active.documentId } }), 0);
 assert.equal(await app.db.query('plugin::upload.file').count({ where: { id: activeFile.id } }), 0);
 for (const filePath of activePaths) await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
 // Public removal retains content/media and persists the calendar-year deadline.
 assert.equal((await req(`/happy-birthdays/${entry.documentId}/delete`, ownerToken, 'PUT')).status, 200);
 const retained = await app.db.query(UID).findOne({ where: { documentId: entry.documentId }, populate: { images: true } });
 assert.equal(retained.publishedAt, null); assert.equal(retained.images.length, 1);
 assert.equal(new Date(retained.retentionExpiresAt).toISOString(), celebrationRetentionDate(retained));
 const dashboard = await req('/happy-birthdays/mine?pageSize=50', ownerToken);
 const card = dashboard.body.data.find(row => row.documentId === entry.documentId);
 assert.equal(card.publiclyAvailable, false);
 assert.equal(new Date(card.retentionExpiresAt).toISOString(), celebrationRetentionDate(retained));
 assert.equal((await req(path, serverToken, 'DELETE', { ownerId: user.id, country: 'IN' })).status, 403);
 assert.equal(await app.db.query(UID).count({ where: { documentId: entry.documentId } }), 1);
 assert.equal(await app.db.query('plugin::upload.file').count({ where: { id: file.id } }), 1);
 const afterRemoval = await app.db.query(UID).findOne({ where: { documentId: entry.documentId }, populate: { images: true } });
 assert.deepEqual(afterRemoval.birthdaymessages, retained.birthdaymessages);
 assert.equal(new Date(afterRemoval.retentionExpiresAt).toISOString(), new Date(retained.retentionExpiresAt).toISOString());
 assert.deepEqual(afterRemoval.images.map(image => image.id), retained.images.map(image => image.id));
 const draft = await app.documents(UID).create({ data: { personname: 'Draft', personemail: user.email, hostname: 'Owner', hostemail: user.email, customroute: `privacy-${randomUUID()}`, birthdaymessages: [], templateId: 'friend', musicId: 'classic-celebration', owner: user.id } });
 assert.equal((await req(`/happy-birthdays/${draft.documentId}/erase`, serverToken, 'DELETE', { ownerId: user.id, country: 'IN' })).status, 403);
 assert.equal(await app.db.query(UID).count({ where: { documentId: draft.documentId } }), 1);
 const erased = await req(path, serverToken, 'DELETE', { ownerId: user.id, country: 'US' });
 assert.equal(erased.status, 200); assert.equal(erased.body.erased, true);
 assert.equal(await app.db.query(UID).count({ where: { documentId: entry.documentId } }), 0);
 assert.equal(await app.db.query('plugin::upload.file').count({ where: { id: file.id } }), 0);
 for (const filePath of originalPaths) await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
 assert.equal((await req(path, serverToken, 'DELETE', { ownerId: user.id, country: 'US' })).status, 404);
 assert.equal((await req(`/happy-birthdays/${draft.documentId}/erase`, serverToken, 'DELETE', { ownerId: user.id, country: 'DE' })).status, 200);
 assert.equal(await app.db.query(UID).count({ where: { documentId: draft.documentId } }), 0);
 // A partial Story and its editor step persist through the real HTTP boundary.
 const story = await req('/birthday-stories', serverToken, 'POST', { ownerId: user.id, country: 'US', creationId: randomUUID() });
 assert.equal(story.status, 200);
 const storyId = story.body.documentId;
 const storyUploadForm = new FormData(); storyUploadForm.append('files', new Blob([image], { type: 'image/png' }), 'story-private.png');
 const storyUpload = await fetch(base + '/upload', { method: 'POST', headers: { Authorization: `Bearer ${serverToken}` }, body: storyUploadForm });
 const [storyFile] = await storyUpload.json();
 assert.ok(storyUpload.ok);
 const storyPaths = storedUploadPaths(storyFile);
 for (const filePath of storyPaths) await fs.access(filePath);
 const attached = await req(`/birthday-stories/${storyId}/attach`, serverToken, 'POST', { ownerId: user.id, fileId: storyFile.id });
 assert.equal(attached.status, 200);
 const storyContent = { ...attached.body.content, forName: 'Saved recipient', memories: attached.body.content.memories.map((m, i) => i ? m : { ...m, photoId: storyFile.id, caption: 'A private photo' }) };
 const savedStory = await req(`/birthday-stories/${storyId}/save`, serverToken, 'POST', { ownerId: user.id, content: storyContent, revision: attached.body.revision, editorStep: 3 });
 assert.equal(savedStory.status, 200); assert.equal(savedStory.body.editorStep, 3);
 const reread = await req(`/birthday-stories/${storyId}/read`, serverToken, 'POST', { ownerId: user.id });
 assert.equal(reread.body.content.forName, 'Saved recipient'); assert.equal(reread.body.editorStep, 3);
 for (const editorStep of [-1, 8, '2']) {
  assert.equal((await req(`/birthday-stories/${storyId}/save`, serverToken, 'POST', { ownerId: user.id, content: storyContent, revision: savedStory.body.revision, editorStep })).status, 400);
 }
 assert.equal((await req(`/birthday-stories/${storyId}/read`, serverToken, 'POST', { ownerId: user.id + 10000 })).status, 400);
 const storyErase = `/happy-birthdays/${storyId}/erase`;
 assert.equal((await req(storyErase, serverToken, 'DELETE', { ownerId: user.id, country: 'IN' })).status, 403);
 assert.equal((await req(storyErase, serverToken, 'DELETE', { ownerId: user.id, country: 'DE' })).status, 200);
 assert.equal(await app.db.query(UID).count({ where: { documentId: storyId } }), 0);
 assert.equal(await app.db.query('plugin::upload.file').count({ where: { id: storyFile.id } }), 0);
 for (const filePath of storyPaths) await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
 // The site admin (users-permissions role, not the Strapi admin-panel user)
 // can erase other-owned and anonymous entries in India/unknown locations.
 const roleQuery = app.db.query('plugin::users-permissions.role');
 const adminRole = await roleQuery.findOne({ where: { type: 'admin' } }) || await roleQuery.create({ data: { name: 'Admin', description: 'Regression admin', type: 'admin' } });
 const admin = await app.db.query('plugin::users-permissions.user').create({ data: { username: `erasure-admin-${randomUUID()}`, email: `erasure-admin-${randomUUID()}@example.invalid`, provider: 'local', confirmed: true, blocked: false, role: adminRole.id } });
 const adminToken = app.plugin('users-permissions').service('jwt').issue({ id: admin.id });
 for (const country of ['IN', 'UNKNOWN']) {
  const adminForm = new FormData(); adminForm.append('files', new Blob([image], { type: 'image/png' }), 'admin-erasure.png');
  const uploaded = await fetch(base + '/upload', { method: 'POST', headers: { Authorization: `Bearer ${serverToken}` }, body: adminForm });
  assert.ok(uploaded.ok);
  const [adminFile] = await uploaded.json();
  const adminFilePaths = storedUploadPaths(adminFile);
  for (const filePath of adminFilePaths) await fs.access(filePath);
  const target = await app.documents(UID).create({ status: 'published', data: { personname: 'Admin target', personemail: user.email, hostname: 'Creator', hostemail: user.email, customroute: `admin-erase-${randomUUID()}`, birthdaymessages: ['Private customer content'], templateId: 'friend', musicId: 'classic-celebration', owner: country === 'IN' ? user.id : null, images: [adminFile.id] } });
  const targetPath = `/happy-birthdays/${target.documentId}/erase`;
  assert.ok([401, 403].includes((await req(targetPath, adminToken, 'DELETE', { ownerId: admin.id, country })).status), 'Even an admin browser JWT cannot impersonate the internal server');
  assert.equal((await req(targetPath, serverToken, 'DELETE', { ownerId: user.id, country, admin: true, isAdmin: true })).status, 403, 'Body flags cannot grant the admin country exemption');
  const removedByAdmin = await req(targetPath, serverToken, 'DELETE', { ownerId: admin.id, country });
  assert.equal(removedByAdmin.status, 200, JSON.stringify(removedByAdmin.body));
  assert.equal(removedByAdmin.body.erased, true);
  assert.equal(await app.db.query(UID).count({ where: { documentId: target.documentId } }), 0);
  assert.equal(await app.db.query('plugin::upload.file').count({ where: { id: adminFile.id } }), 0);
  for (const filePath of adminFilePaths) await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
 }
 // A role revoked after login is authoritative on the CMS side too.
 const ordinaryRole = await roleQuery.findOne({ where: { type: 'authenticated' } });
 await app.db.query('plugin::users-permissions.user').update({ where: { id: admin.id }, data: { role: ordinaryRole.id } });
 const revokedTarget = await app.documents(UID).create({ data: { personname: 'Revoked permission target', personemail: user.email, hostname: 'Owner', hostemail: user.email, customroute: `revoked-admin-${randomUUID()}`, birthdaymessages: [], templateId: 'friend', musicId: 'classic-celebration', owner: user.id } });
 const revokedPath = `/happy-birthdays/${revokedTarget.documentId}/erase`;
 assert.equal((await req(revokedPath, serverToken, 'DELETE', { ownerId: admin.id, country: 'IN', admin: true })).status, 403);
 assert.equal(await app.db.query(UID).count({ where: { documentId: revokedTarget.documentId } }), 1);
 assert.equal((await req(revokedPath, serverToken, 'DELETE', { ownerId: user.id, country: 'US' })).status, 200);
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
