'use strict';

const {
  normalizeStory,
  materializeStory,
  storyExpired,
  isInternalStoryDraftLink,
  isInternalStoryDraftRoute,
} = require('../utils/birthday-story');
const { celebrationExpiresAt } = require('../utils/celebration-expiry');
const {
  isBeforeTrigger,
  presentSchedule,
  storyTriggerExpiry,
  storyTriggerPatch,
} = require('../utils/celebration-schedule');
const UID = 'api::happy-birthday.happy-birthday';
const PURCHASE = 'api::celebration-purchase.celebration-purchase';
const populate = { owner: true, storyAssets: true };

module.exports = ({ strapi }) => ({
  async draft(documentId) {
    return strapi.db
      .query(UID)
      .findOne({
        where: { documentId, journeyType: 'story', publishedAt: null },
        populate,
      });
  },
  async owned(documentId, ownerId) {
    const entry = await this.draft(documentId);
    if (!entry || !Number.isInteger(ownerId) || entry.owner?.id !== ownerId)
      throw new Error('Story not found');
    return entry;
  },
  async findBySlug(slug) {
    return strapi.db
      .query(UID)
      .findOne({
        where: {
          customroute: String(slug).toLowerCase(),
          journeyType: 'story',
          publishedAt: null,
        },
        populate,
      });
  },
  async addWish(slug, input) {
    const name = String(input?.name || '').trim();
    const message = String(input?.message || '').trim();
    if (!name || name.length > 100 || !message || message.length > 2000)
      throw new Error(
        'Add your name (up to 100 characters) and wish (up to 2000 characters)',
      );
    return strapi.db.transaction(async () => {
      const where = {
        customroute: slug,
        journeyType: 'story',
        publishedAt: { $notNull: true },
      };
      const entry = await strapi.db.query(UID).findOne({ where });
      if (
        !entry ||
        storyExpired(entry) ||
        isBeforeTrigger(entry.triggerAt) ||
        !entry.premiumUnlocked ||
        entry.celebrationStatus === 'paused'
      )
        throw new Error('Story not available');
      // Serialize appends without publishing any of the creator's pending edits.
      await strapi.db
        .query(UID)
        .updateMany({
          where: { id: entry.id },
          data: { updatedAt: new Date() },
        });
      const current = await strapi.db
        .query(UID)
        .findOne({ where: { id: entry.id } });
      const wish = { name, message, id: require('crypto').randomUUID() };
      const wishes = [
        ...(Array.isArray(current.guestwishes) ? current.guestwishes : []),
        wish,
      ];
      await strapi.db
        .query(UID)
        .updateMany({
          where: { documentId: entry.documentId },
          data: { guestwishes: wishes },
        });
      return { wish, wishes };
    });
  },
  async read(documentId, ownerId) {
    const entry = await this.owned(documentId, ownerId);
    const generatedDraftLink = isInternalStoryDraftLink(entry);
    return {
      documentId,
      content: generatedDraftLink
        ? { ...entry.storyContent, slug: '' }
        : entry.storyContent,
      revision: entry.storyRevision,
      assets: (entry.storyAssets || []).map((a) => ({
        id: a.id,
        url: a.url,
        name: a.name,
        mime: a.mime,
        duration: entry.storyAssetMetadata?.[a.id]?.duration,
      })),
      state: storyExpired(entry)
        ? 'expired'
        : entry.storyFirstPublishedAt
          ? 'active'
          : 'draft',
      expiresAt: entry.expiresAt,
      ...presentSchedule(entry),
      triggerLocked: Boolean(entry.storyFirstPublishedAt),
      hasUnpublishedChanges:
        entry.storyRevision !== entry.storyPublishedRevision,
      slug: entry.customroute,
    };
  },
  async create(ownerId, country, creationId) {
    const user = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: ownerId } });
    if (!user) throw new Error('Log in to create a story');
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(creationId || ''))
      throw new Error('Invalid draft request');
    const slug = `story-${creationId}`;
    const previous = await this.findBySlug(slug);
    if (previous) return this.read(previous.documentId, ownerId);
    const content = {
      version: 1,
      forName: '',
      hostName: user.displayName || user.username || '',
      // The required database route identifies this private draft. Only the
      // creator can choose the link that will eventually be published.
      slug: '',
      musicId: '',
      intro: '',
      greeting: '',
      cakeMessage: '',
      letter: '',
      reasons: ['', '', ''],
      memories: Array.from({ length: 3 }, () => ({
        photoId: null,
        caption: '',
        date: '',
      })),
      voiceId: null,
      scratchMessage: '',
      quizEnabled: false,
      quiz: Array.from({ length: 2 }, () => ({
        question: '',
        choices: ['', ''],
        correctIndex: 0,
      })),
    };
    const entry = await strapi.documents(UID).create({
      status: 'draft',
      data: {
        journeyType: 'story',
        customroute: slug,
        owner: ownerId,
        country,
        hostemail: user.email,
        personemail: user.email,
        hostname: content.hostName,
        templateId: 'birthday-story',
        musicId: 'none',
        birthdaymessages: [],
        storyContent: content,
        storyRevision: 0,
        storyAssetMetadata: {},
      },
    });
    return this.read(entry.documentId, ownerId);
  },
  async save(documentId, ownerId, input, revision, trigger = {}) {
    let paidRecovery = null;
    await strapi.db.transaction(async () => {
      const entry = await this.owned(documentId, ownerId);
      if (storyExpired(entry))
        throw new Error(
          'This story has expired and cannot be changed or republished',
        );
      const content = normalizeStory(input, {
        assets: entry.storyAssets || [],
        metadata: entry.storyAssetMetadata || {},
      });
      if (isInternalStoryDraftRoute(content.slug) &&
        !(entry.storyFirstPublishedAt && content.slug === entry.customroute))
        throw new Error('This link name is reserved for private drafts');
      const purchases = await strapi.db.query(PURCHASE).findMany({
        where: { celebrationDocumentId: documentId, productType: 'story' },
      });
      const repairingInternalRoute = isInternalStoryDraftLink(entry);
      if (content.slug !== entry.customroute) {
        if (entry.storyFirstPublishedAt || (purchases.length && !repairingInternalRoute))
          throw new Error('The link name cannot change after checkout starts');
        if (content.slug) {
          const used = await strapi.db.query(UID).findOne({
            where: {
              customroute: { $eqi: content.slug },
              documentId: { $ne: documentId },
            },
          });
          if (used) throw new Error('That link name is already taken');
        }
      }
      const triggerPatch = storyTriggerPatch(entry, trigger);
      const result = await strapi.db.query(UID).updateMany({
        where: { id: entry.id, storyRevision: revision },
        data: {
          storyContent: content,
          storyRevision: revision + 1,
          customroute: content.slug || entry.customroute,
          personname: content.forName,
          hostname: content.hostName,
          ...triggerPatch,
        },
      });
      if (!result.count)
        throw new Error(
          'This story changed in another tab. Reload before editing again',
        );
      if (repairingInternalRoute && content.slug) {
        // A pre-fix checkout may already point at the draft's generated route.
        // Keep its order, price, and captured content, changing only the link.
        for (const purchase of purchases) {
          if (purchase.celebrationSlug !== entry.customroute) continue;
          if (purchase.storySnapshot?.slug !== entry.customroute)
            throw new Error('This checkout needs manual link recovery');
          const updated = await strapi.db.query(PURCHASE).updateMany({
            where: {
              id: purchase.id,
              status: purchase.status,
              celebrationSlug: entry.customroute,
            },
            data: {
              celebrationSlug: content.slug,
              storySnapshot: { ...purchase.storySnapshot, slug: content.slug },
            },
          });
          if (!updated.count)
            throw new Error('Checkout changed while saving. Reload and try again');
          if (purchase.status === 'paid' && purchase.razorpayPaymentId)
            paidRecovery = { purchaseId: purchase.purchaseId, paymentId: purchase.razorpayPaymentId };
        }
      }
    });
    if (paidRecovery) {
      const purchase = await strapi.db.query(PURCHASE).findOne({
        where: { purchaseId: paidRecovery.purchaseId },
      });
      await this.publishCaptured(purchase, { id: paidRecovery.paymentId });
    }
    return this.read(documentId, ownerId);
  },
  async attach(documentId, ownerId, fileId, duration) {
    const entry = await this.owned(documentId, ownerId);
    if (storyExpired(entry)) throw new Error('This story has expired');
    const asset = await strapi.db
      .query('plugin::upload.file')
      .findOne({ where: { id: fileId } });
    if (!asset || !/^(image|audio)\//.test(asset.mime))
      throw new Error('Unsupported story upload');
    if (asset.mime.startsWith('audio/') && !(duration > 0 && duration <= 30))
      throw new Error('Voice message must be 30 seconds or shorter');
    if ((entry.storyAssets || []).length >= 30)
      throw new Error('This story has reached its upload limit');
    await strapi.documents(UID).update({
      documentId,
      status: 'draft',
      data: {
        storyAssets: { connect: [fileId] },
        storyAssetMetadata: {
          ...(entry.storyAssetMetadata || {}),
          [fileId]: { duration: duration || null },
        },
      },
    });
    return this.read(documentId, ownerId);
  },
  async snapshot(entry) {
    if (isInternalStoryDraftLink(entry))
      throw new Error('Add link name');
    const content = normalizeStory(entry.storyContent, {
      complete: true,
      assets: entry.storyAssets || [],
      metadata: entry.storyAssetMetadata || {},
    });
    return materializeStory(
      content,
      entry.storyAssets || [],
      entry.storyAssetMetadata || {},
    );
  },
  publicationFields(snapshot) {
    return {
      personname: snapshot.forName,
      hostname: snapshot.hostName,
      birthdaymessages: snapshot.memories.map((m) => m.caption),
      musicId: snapshot.musicId || 'none',
      templateId: 'birthday-story',
      images: snapshot.memories.map((m) => m.photoId),
      storyPublishedContent: snapshot,
    };
  },
  async updatePublished(documentId, ownerId, revision) {
    return strapi.db.transaction(async () => {
      const entry = await this.owned(documentId, ownerId);
      if (
        !entry.storyFirstPublishedAt ||
        storyExpired(entry) ||
        !entry.premiumUnlocked
      )
        throw new Error('This story cannot be updated');
      const lock = await strapi.db
        .query(UID)
        .updateMany({
          where: { id: entry.id, storyRevision: revision },
          data: { storyPublishedRevision: revision },
        });
      if (!lock.count)
        throw new Error('Save the latest changes before publishing');
      const snapshot = await this.snapshot(entry);
      await strapi
        .documents(UID)
        .update({
          documentId,
          status: 'draft',
          data: {
            ...this.publicationFields(snapshot),
            storyPublishedRevision: revision,
          },
        });
      await strapi.documents(UID).publish({ documentId });
      return this.read(documentId, ownerId);
    });
  },
  async publishCaptured(purchase, payment) {
    return strapi.db.transaction(async () => {
      // Callers may hold an order row read before a creator repaired an old
      // generated link. The canonical row is the publication source.
      purchase = await strapi.db.query(PURCHASE).findOne({
        where: { purchaseId: purchase.purchaseId },
      });
      if (!purchase) throw new Error('Story payment record is unavailable');
      const entry = await this.draft(purchase.celebrationDocumentId);
      if (!entry || storyExpired(entry))
        return {
          unlocked: false,
          expired: true,
          celebrationSlug: purchase.celebrationSlug,
        };
      const alreadyPublished = await strapi.db.query(UID).findOne({
        where: {
          documentId: entry.documentId,
          publishedAt: { $notNull: true },
        },
      });
      if (!alreadyPublished && (
        isInternalStoryDraftRoute(entry.customroute) ||
        purchase.celebrationSlug !== entry.customroute ||
        purchase.storySnapshot?.slug !== entry.customroute
      )) throw new Error('Add link name before publishing this paid story');
      // Claim the first publication once. Replayed webhooks never move the expiry.
      const firstPublishedAt = new Date().toISOString();
      const expiresAt = entry.triggerAt
        ? storyTriggerExpiry(entry, firstPublishedAt)
        : celebrationExpiresAt({ createdAt: firstPublishedAt });
      if (entry.triggerAt && !expiresAt) {
        return {
          unlocked: false,
          expired: true,
          celebrationSlug: purchase.celebrationSlug,
        };
      }
      await strapi.db.query(UID).updateMany({
        where: { id: entry.id, storyFirstPublishedAt: null },
        data: {
          storyFirstPublishedAt: firstPublishedAt,
          expiresAt,
          premiumUnlocked: true,
          premiumPaymentId: payment.id,
          premiumPurchaseId: purchase.purchaseId,
          premiumPurchasedAt: firstPublishedAt,
        },
      });
      const current = await this.draft(entry.documentId);
      const duplicatePayment = current.premiumPaymentId !== payment.id;
      if (!current.premiumUnlocked)
        return {
          unlocked: false,
          expired: true,
          celebrationSlug: purchase.celebrationSlug,
        };
      if (!alreadyPublished) {
        const canonical = duplicatePayment
          ? await strapi.db
              .query(PURCHASE)
              .findOne({ where: { purchaseId: current.premiumPurchaseId } })
          : purchase;
        if (!canonical?.storySnapshot)
          throw new Error('Story payment snapshot is unavailable');
        await strapi.documents(UID).update({
          documentId: entry.documentId,
          status: 'draft',
          data: {
            ...this.publicationFields(canonical.storySnapshot),
            storyPublishedRevision: canonical.storyRevision,
          },
        });
        await strapi.documents(UID).publish({ documentId: entry.documentId });
      }
      return {
        unlocked: true,
        duplicatePayment,
        celebrationSlug: purchase.celebrationSlug,
        expiresAt: current.expiresAt,
        features: ['video', 'pdf'],
        amountPaise: purchase.amountPaise,
        currency: purchase.currency,
      };
    });
  },
});
