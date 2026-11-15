'use strict';
const { celebrationWindowEndMs } = require('../utils/celebration-expiry');
const { fail, revision, positiveId, normalizeStandardEdit, splitMessages, uploadPrefix } = require('../utils/standard-edit');
const { withCelebrationLock } = require('../utils/celebration-lock');
const UID = 'api::happy-birthday.happy-birthday';
const FILE = 'plugin::upload.file';
const populate = { owner: true, images: true, standardEditAssets: true };
const image = file => ({ id: file.id, name: file.name, url: file.url, mime: file.mime });
const ids = values => [...new Set((Array.isArray(values) ? values : []).filter(positiveId))];

module.exports = ({ strapi }) => ({
  async owned(documentId, ownerId) {
    if (!positiveId(ownerId) || typeof documentId !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(documentId)) fail(404, 'Celebration not found');
    const entry = await strapi.db.query(UID).findOne({ where: { documentId, publishedAt: null, owner: ownerId,
      $or: [{ journeyType: 'standard' }, { journeyType: null }] }, populate });
    if (!entry) fail(404, 'Celebration not found');
    return entry;
  },
  async editable(documentId, ownerId) {
    const entry = await this.owned(documentId, ownerId);
    if (entry.erasureRequestedAt || entry.retentionExpiresAt) fail(410, 'This celebration is no longer available for editing');
    if (!Number.isFinite(celebrationWindowEndMs(entry)) || celebrationWindowEndMs(entry) <= Date.now()) fail(410, 'This celebration has expired and cannot be edited');
    const published = await strapi.db.query(UID).findOne({ where: { documentId, publishedAt: { $notNull: true } }, select: ['id'] });
    if (!published) fail(410, 'This celebration is no longer published');
    return entry;
  },
  present(entry) {
    const text = splitMessages(entry.birthdaymessages);
    return { documentId: entry.documentId, slug: entry.customroute, revision: entry.standardRevision || 0,
      forName: entry.personname || '', personEmail: entry.personemail || '', headline: text.headline, captions: text.captions,
      images: (entry.images || []).map(image), pendingImages: (entry.standardEditAssets || []).map(image), expiresAt: entry.expiresAt,
      windowEndsAt: new Date(celebrationWindowEndMs(entry)).toISOString(), triggerAt: entry.triggerAt || null,
      timezone: entry.timezone || null, status: entry.celebrationStatus || 'active', premiumUnlocked: Boolean(entry.premiumUnlocked),
      uploadPrefix: uploadPrefix(entry.documentId, entry.owner.id) };
  },
  async read(documentId, ownerId) {
    const entry = await this.editable(documentId, ownerId);
    await this.cleanup(documentId, ownerId).catch(() => {});
    return this.present(entry);
  },
  async attach(documentId, ownerId, fileId) {
    if (!positiveId(fileId)) fail(400, 'Invalid photo');
    await withCelebrationLock(strapi, documentId, async () => {
      const entry = await this.editable(documentId, ownerId);
      if ((entry.standardEditAssets || []).some(asset => asset.id === fileId)) return;
      if ((entry.standardEditCleanupIds || []).includes(fileId)) fail(400, 'This photo is already being removed. Upload it again.');
      if ((entry.standardEditAssets || []).length >= 12) fail(400, 'Save or discard the current photo changes before uploading more');
      const file = await strapi.db.query(FILE).findOne({ where: { id: fileId }, populate: { related: true } });
      if (!file || !file.mime?.startsWith('image/') || !file.name?.startsWith(uploadPrefix(documentId, ownerId)) || file.related?.length)
        fail(400, 'This photo is not available for this celebration');
      await strapi.documents(UID).update({ documentId, status: 'draft', data: { standardEditAssets: { connect: [fileId] } } });
    });
    const entry = await this.editable(documentId, ownerId);
    const file = (entry.standardEditAssets || []).find(asset => asset.id === fileId);
    if (!file) fail(400, 'The uploaded photo could not be attached');
    return { asset: image(file) };
  },
  async save(documentId, ownerId, input, expectedRevision) {
    const content = normalizeStandardEdit(input);
    revision(expectedRevision);
    let saved;
    await withCelebrationLock(strapi, documentId, async () => {
      let entry = await this.editable(documentId, ownerId);
      const lock = await strapi.db.query(UID).updateMany({ where: { id: entry.id,
        ...(expectedRevision === 0 ? { $or: [{ standardRevision: 0 }, { standardRevision: null }] } : { standardRevision: expectedRevision }),
        retentionExpiresAt: null, erasureRequestedAt: null, celebrationStatus: entry.celebrationStatus,
        expiresAt: entry.expiresAt ?? null, triggerAt: entry.triggerAt ?? null }, data: { standardRevision: expectedRevision + 1 } });
      if (!lock.count) fail(409, 'Another change was saved. Reload before updating this celebration.');
      entry = await this.editable(documentId, ownerId);
      const allowed = new Set([...(entry.images || []), ...(entry.standardEditAssets || [])].map(asset => asset.id));
      if (content.imageIds.some(id => !allowed.has(id))) fail(400, 'Choose photos uploaded for this celebration');
      const pending = ids([...(entry.standardEditCleanupIds || []), ...[...(entry.images || []), ...(entry.standardEditAssets || [])].map(asset => asset.id)])
        .filter(id => !content.imageIds.includes(id));
      const data = {
        personname: content.forName, personemail: content.personEmail,
        birthdaymessages: [content.headline, ...content.captions, ...splitMessages(entry.birthdaymessages).markers],
        images: content.imageIds, standardEditAssets: [], standardEditCleanupIds: pending, standardRevision: expectedRevision + 1,
      };
      const versions = await strapi.db.query(UID).findMany({ where: { documentId }, select: ['id', 'publishedAt'], orderBy: { id: 'asc' } });
      if (!versions.some(row => row.publishedAt)) fail(410, 'This celebration is no longer published');
      // Keep the existing row identities. Re-publication would delete/recreate
      // a published row and could make an already waiting payment/status write
      // miss it. QueryEngine.update also updates the image relations.
      for (const row of versions) await strapi.db.query(UID).update({ where: { id: row.id }, data });
      saved = this.present(await this.owned(documentId, ownerId));
    });
    await this.cleanup(documentId, ownerId).catch(() => {});
    // A later expiry/removal or cleanup failure cannot turn a committed update
    // into a reported failure. Return the committed content if it vanished.
    return this.owned(documentId, ownerId).then(entry => this.present(entry), () => saved);
  },
  async discard(documentId, ownerId, fileIds) {
    if (!positiveId(ownerId) || !Array.isArray(fileIds) || fileIds.length > 12 || fileIds.some(id => !positiveId(id))) fail(400, 'Invalid photo cleanup');
    const candidates = ids(fileIds);
    let exists = false;
    await withCelebrationLock(strapi, documentId, async () => {
      const entry = await this.owned(documentId, ownerId).catch(error => { if (error.status === 404) return null; throw error; });
      if (!entry) return;
      exists = true;
      const current = new Set((entry.images || []).map(asset => asset.id));
      if (candidates.some(id => current.has(id))) fail(409, 'A published photo cannot be discarded');
      const ownedUploads = [];
      for (const id of candidates) {
        const file = await strapi.db.query(FILE).findOne({ where: { id }, populate: { related: true } });
        if (file?.name?.startsWith(uploadPrefix(documentId, ownerId))) ownedUploads.push(id);
      }
      const remaining = (entry.standardEditAssets || []).filter(asset => !candidates.includes(asset.id)).map(asset => asset.id);
      await strapi.documents(UID).update({ documentId, status: 'draft', data: {
        standardEditAssets: remaining, standardEditCleanupIds: ids([...(entry.standardEditCleanupIds || []), ...ownedUploads]),
      } });
    });
    // Prefix + no remaining relations also covers upload-success/attach-failure.
    for (const id of exists ? [] : candidates) {
      const file = await strapi.db.query(FILE).findOne({ where: { id }, populate: { related: true } });
      if (file && file.name?.startsWith(uploadPrefix(documentId, ownerId)) && !(file.related || []).length)
        await strapi.plugin('upload').service('upload').remove(file).catch(() => {});
    }
    if (exists) await this.cleanup(documentId, ownerId).catch(() => {});
    return { ok: true };
  },
  async cleanup(documentId, ownerId) {
    const candidates = await withCelebrationLock(strapi, documentId, async () => {
      const entry = await this.owned(documentId, ownerId);
      const abandoned = await strapi.db.query(FILE).findMany({ where: { name: { $startsWith: uploadPrefix(documentId, ownerId) },
        createdAt: { $lt: new Date(Date.now() - 86_400_000).toISOString() } }, populate: { related: true }, limit: 100 });
      const pending = ids([...(entry.standardEditCleanupIds || []), ...abandoned.filter(file => !(file.related || []).length).map(file => file.id)]);
      if (pending.length) await strapi.db.query(UID).updateMany({ where: { documentId }, data: { standardEditCleanupIds: pending } });
      return pending;
    });
    // Provider I/O runs after committing the retirement queue. Attach checks
    // that queue under the same lock, so no retired file can be adopted now.
    const remaining = [];
    for (const id of candidates) {
      try {
        const file = await strapi.db.query(FILE).findOne({ where: { id }, populate: { related: true } });
        if (file && !(file.related || []).length) await strapi.plugin('upload').service('upload').remove(file);
      } catch { remaining.push(id); }
    }
    if (candidates.length) await withCelebrationLock(strapi, documentId, async () => {
      // Merge under the same draft-row lock used by save/discard. A content
      // revision alone cannot detect a concurrent cleanup-queue addition.
      const current = await this.owned(documentId, ownerId);
      const completed = new Set(candidates.filter(id => !remaining.includes(id)));
      const next = ids([...(current.standardEditCleanupIds || []).filter(id => !completed.has(id)), ...remaining]);
      await strapi.db.query(UID).updateMany({ where: { documentId }, data: { standardEditCleanupIds: next } });
    });
  },
});
