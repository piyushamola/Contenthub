'use strict';
// Run only with an isolated SQLite database; never load the project's .env.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');
const {
  normalizeStory,
} = require('../src/api/happy-birthday/utils/birthday-story');
if (
  process.env.ENV_PATH !== '/dev/null' ||
  process.env.DATABASE_CLIENT !== 'sqlite' ||
  !process.env.DATABASE_FILENAME?.startsWith('/tmp/')
)
  throw new Error(
    'Use ENV_PATH=/dev/null and an isolated /tmp SQLite database',
  );
const databasePath = process.env.DATABASE_FILENAME;
let testPublicDir;
// The app's SQLite config joins filenames to the project root, including absolute paths.
process.env.DATABASE_FILENAME = require('node:path').relative(
  process.cwd(),
  process.env.DATABASE_FILENAME,
);
const UID = 'api::happy-birthday.happy-birthday';
let app;
(async () => {
  testPublicDir = await fs.mkdtemp(path.join(path.dirname(databasePath), 'birthday-story-test-public-'));
  await fs.mkdir(path.join(testPublicDir, 'uploads'));
  app = createStrapi({
    appDir: process.cwd(),
    distDir: process.cwd(),
  });
  app.config.set('dirs.static.public', testPublicDir);
  await app.load();
  app.plugin('email').service('email').send = async () => {};
  const role = await app.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });
  const user = await app.db.query('plugin::users-permissions.user').create({
    data: {
      username: 'story-test',
      email: 'story-test@example.invalid',
      provider: 'local',
      confirmed: true,
      role: role.id,
    },
  });
  const service = app.service('api::happy-birthday.birthday-story');
  const pricing = await app
    .service('api::premium-pricing.premium-pricing')
    .storySettings();
  assert.deepEqual(pricing, { INR: 3600, USD: 500 });
  let draft = await service.create(user.id, 'IN', crypto.randomUUID());
  assert.equal(draft.state, 'draft');
  assert.equal(draft.content.slug, '', 'A new story needs a creator-entered link');
  const internalDraftRoute = draft.slug;
  draft = await service.save(
    draft.documentId,
    user.id,
    { ...draft.content, forName: 'Aanya' },
    draft.revision,
  );
  assert.equal(draft.content.slug, '', 'Saving an incomplete draft must not fill its link');
  assert.equal(draft.slug, internalDraftRoute, 'The private draft keeps its storage route');
  for (const reservedRoute of [internalDraftRoute, `story-${crypto.randomUUID()}`]) {
    await assert.rejects(
      () => service.save(
        draft.documentId,
        user.id,
        { ...draft.content, slug: reservedRoute },
        draft.revision,
      ),
      /reserved for private drafts/i,
      'A creator cannot choose a link that looks like an internal draft route',
    );
  }
  assert.equal((await service.read(draft.documentId, user.id)).revision, draft.revision);
  const unlinkedDashboard = { state: { user: { id: user.id } }, query: {} };
  await app.controller(UID).mine(unlinkedDashboard);
  assert.equal(
    unlinkedDashboard.body.data.find((item) => item.documentId === draft.documentId).storyLinkName,
    '',
    'The dashboard must not expose the internal route as a personal link',
  );
  const legacyEntry = await service.draft(draft.documentId);
  await app.db.query(UID).updateMany({
    where: { id: legacyEntry.id },
    data: { storyContent: { ...legacyEntry.storyContent, slug: internalDraftRoute } },
  });
  assert.equal(
    (await service.read(draft.documentId, user.id)).content.slug,
    '',
    'An older unpublished draft must also ask for a personal link',
  );
  await assert.rejects(
    async () => service.snapshot(await service.draft(draft.documentId)),
    /link name/i,
  );
  draft = await service.save(
    draft.documentId,
    user.id,
    { ...(await service.read(draft.documentId, user.id)).content, slug: '' },
    draft.revision,
  );
  assert.equal((await service.draft(draft.documentId)).storyContent.slug, '');
  assert.equal(
    await app.db.query(UID).count({
      where: {
        documentId: draft.documentId,
        publishedAt: { $notNull: true },
      },
    }),
    0,
  );
  await assert.rejects(
    () => service.read(draft.documentId, user.id + 100),
    /not found/,
  );
  const files = [];
  for (let index = 0; index < 5; index++) {
    const file = await app.db.query('plugin::upload.file').create({
      data: {
        name: `memory-${index}.jpg`,
        hash: crypto.randomUUID(),
        ext: '.jpg',
        mime: 'image/jpeg',
        size: 1,
        url: '/test-photo.jpg',
        provider: 'local',
      },
    });
    files.push(file);
    await service.attach(draft.documentId, user.id, file.id, null);
  }
  const audio = await app.db.query('plugin::upload.file').create({
    data: {
      name: 'voice.mp3',
      hash: crypto.randomUUID(),
      ext: '.mp3',
      mime: 'audio/mpeg',
      size: 1,
      url: '/test-voice.mp3',
      provider: 'local',
    },
  });
  await assert.rejects(
    () => service.attach(draft.documentId, user.id, audio.id, 31),
    /30 seconds/,
  );
  await service.attach(draft.documentId, user.id, audio.id, 30);
  let content = {
    ...draft.content,
    forName: 'Aanya',
    hostName: 'Sam',
    slug: 'story-test-aanya',
    intro: 'Before the wishes…',
    greeting: 'Happy birthday!',
    cakeMessage: 'Make a wish.',
    letter: 'You mean so much to me.',
    reasons: ['Your kindness', 'Your laugh', 'Our adventures'],
    memories: files.slice(0, 3).map((file, index) => ({
      photoId: file.id,
      caption: `Memory ${index + 1}`,
      date: '',
    })),
    voiceId: audio.id,
    scratchMessage: 'I would choose you again.',
  };
  draft = await service.save(
    draft.documentId,
    user.id,
    { ...content, slug: '' },
    draft.revision,
  );
  assert.equal(draft.content.slug, '', 'A complete but unlinked story remains unlinked');
  await assert.rejects(
    async () => service.snapshot(await service.draft(draft.documentId)),
    /link name/i,
  );
  draft = await service.save(
    draft.documentId,
    user.id,
    content,
    draft.revision,
  );
  assert.equal(draft.slug, content.slug, 'The entered link becomes the public route');
  const linkedDashboard = { state: { user: { id: user.id } }, query: {} };
  await app.controller(UID).mine(linkedDashboard);
  assert.equal(
    linkedDashboard.body.data.find((item) => item.documentId === draft.documentId).storyLinkName,
    content.slug,
  );
  const duplicate = await service.create(user.id, 'IN', crypto.randomUUID());
  await assert.rejects(
    () => service.save(
      duplicate.documentId,
      user.id,
      { ...duplicate.content, slug: content.slug },
      duplicate.revision,
    ),
    /link name is already taken/i,
  );
  await assert.rejects(
    () => service.save(draft.documentId, user.id, content, 0),
    /another tab/,
  );
  const entry = await service.draft(draft.documentId);
  assert.throws(
    () =>
      normalizeStory(
        { ...content, reasons: ['Only one'] },
        {
          complete: true,
          assets: entry.storyAssets,
          metadata: entry.storyAssetMetadata,
        },
      ),
    /3–5/,
  );
  assert.throws(
    () =>
      normalizeStory(
        { ...content, memories: [...content.memories, ...content.memories] },
        {
          complete: true,
          assets: entry.storyAssets,
          metadata: entry.storyAssetMetadata,
        },
      ),
    /3–5/,
  );
  assert.throws(
    () =>
      normalizeStory(
        { ...content, quizEnabled: true, quiz: [content.quiz[0]] },
        {
          complete: true,
          assets: entry.storyAssets,
          metadata: entry.storyAssetMetadata,
        },
      ),
    /2–5/,
  );
  const payments = app.service(
    'api::celebration-purchase.celebration-purchase',
  );
  payments.razorpay = async () => ({
    id: 'order_story_test',
    status: 'created',
  });
  await assert.rejects(
    () =>
      payments.createOrder({
        slug: content.slug,
        purchaseId: crypto.randomUUID(),
        country: 'IN',
        ownerId: user.id + 100,
      }),
    /creator/,
  );
  const order = await payments.createOrder({
    slug: content.slug,
    purchaseId: crypto.randomUUID(),
    country: 'IN',
    ownerId: user.id,
  });
  assert.equal(order.amount, 3600);
  assert.equal(order.currency, 'INR');
  const retry = await payments.createOrder({
    slug: content.slug,
    purchaseId: crypto.randomUUID(),
    country: 'IN',
    ownerId: user.id,
  });
  assert.equal(retry.orderId, order.orderId);
  assert.equal(retry.purchaseId, order.purchaseId);
  const purchase = await app.db
    .query('api::celebration-purchase.celebration-purchase')
    .findOne({ where: { purchaseId: order.purchaseId } });
  const payment = {
    id: 'pay_story_test',
    status: 'captured',
    created_at: Math.floor(Date.now() / 1000),
  };
  const granted = await payments.grantCapturedPurchase(purchase, payment);
  assert.equal(granted.unlocked, true);
  assert.deepEqual(granted.features, ['video', 'pdf']);
  const originalExpiry = granted.expiresAt;
  const firstPublication = await service.draft(draft.documentId);
  assert.equal(
    Date.parse(originalExpiry) - Date.parse(firstPublication.storyFirstPublishedAt),
    24 * 60 * 60 * 1000,
    'Birthday Story uses the same 24-hour lifetime as standard celebrations',
  );
  const again = await payments.grantCapturedPurchase(purchase, payment);
  assert.equal(again.expiresAt, originalExpiry);
  draft = await service.read(draft.documentId, user.id);
  assert.equal(draft.content.slug, content.slug, 'A published link stays unchanged');
  await assert.rejects(
    () => service.save(
      draft.documentId,
      user.id,
      { ...draft.content, slug: '' },
      draft.revision,
    ),
    /link name cannot change after checkout starts/i,
  );
  assert.equal((await service.read(draft.documentId, user.id)).slug, content.slug);
  content = { ...content, letter: 'My private unfinished change.' };
  draft = await service.save(
    draft.documentId,
    user.id,
    content,
    draft.revision,
  );
  let published = await app.db.query(UID).findOne({
    where: { documentId: draft.documentId, publishedAt: { $notNull: true } },
  });
  assert.equal(
    published.storyPublishedContent.letter,
    'You mean so much to me.',
  );
  await service.addWish(content.slug, {
    name: 'Guest',
    message: 'Have a wonderful birthday!',
  });
  published = await app.db.query(UID).findOne({
    where: { documentId: draft.documentId, publishedAt: { $notNull: true } },
  });
  assert.equal(published.guestwishes.length, 1);
  assert.equal(
    published.storyPublishedContent.letter,
    'You mean so much to me.',
  );
  await service.updatePublished(draft.documentId, user.id, draft.revision);
  published = await app.db.query(UID).findOne({
    where: { documentId: draft.documentId, publishedAt: { $notNull: true } },
  });
  assert.equal(published.storyPublishedContent.letter, content.letter);
  assert.equal(published.expiresAt, originalExpiry);
  assert.equal(published.guestwishes.length, 1);
  await app.db.query(UID).updateMany({
    where: { documentId: draft.documentId },
    data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
  });
  await app.service(UID).unpublishExpired();
  assert.equal(
    (await service.read(draft.documentId, user.id)).state,
    'expired',
  );
  assert.equal((await payments.getAccess(content.slug)).unlocked, false);
  assert.equal(
    (await payments.grantCapturedPurchase(purchase, payment)).unlocked,
    false,
  );
  await assert.rejects(
    () => service.updatePublished(draft.documentId, user.id, draft.revision),
    /cannot be updated/,
  );
  await assert.rejects(
    () =>
      payments.createOrder({
        slug: content.slug,
        purchaseId: crypto.randomUUID(),
        country: 'IN',
        ownerId: user.id,
      }),
    /expired/,
  );
  const ctx = { state: { user: { id: user.id } }, query: {} };
  await app.controller(UID).mine(ctx);
  assert.equal(
    ctx.body.data.filter((v) => v.documentId === draft.documentId).length,
    1,
  );
  assert.equal(
    ctx.body.data.find((item) => item.documentId === draft.documentId).storyState,
    'expired',
  );
  // Simulate a pre-fix draft that reached checkout with its generated route.
  const legacyCreationId = crypto.randomUUID();
  let pendingLegacy = await service.create(user.id, 'IN', legacyCreationId);
  for (const file of files.slice(0, 3))
    await service.attach(pendingLegacy.documentId, user.id, file.id, null);
  const temporaryLink = 'legacy-checkout-temp';
  pendingLegacy = await service.save(
    pendingLegacy.documentId,
    user.id,
    { ...content, slug: temporaryLink, voiceId: null },
    pendingLegacy.revision,
  );
  payments.razorpay = async () => ({ id: 'order_legacy_link', status: 'created' });
  const legacyOrder = await payments.createOrder({
    slug: temporaryLink,
    purchaseId: crypto.randomUUID(),
    country: 'IN',
    ownerId: user.id,
  });
  const purchaseUid = 'api::celebration-purchase.celebration-purchase';
  const staleLegacyPurchase = await app.db.query(purchaseUid).findOne({
    where: { purchaseId: legacyOrder.purchaseId },
  });
  const generatedLink = `story-${legacyCreationId}`;
  await app.db.query(UID).updateMany({
    where: { documentId: pendingLegacy.documentId },
    data: {
      customroute: generatedLink,
      storyContent: { ...pendingLegacy.content, slug: generatedLink },
    },
  });
  await app.db.query(purchaseUid).update({
    where: { purchaseId: legacyOrder.purchaseId },
    data: {
      celebrationSlug: generatedLink,
      storySnapshot: { ...staleLegacyPurchase.storySnapshot, slug: generatedLink },
    },
  });
  let unlinkedPending = await service.read(pendingLegacy.documentId, user.id);
  assert.equal(unlinkedPending.content.slug, '', 'Checkout-era generated links still need creator input');
  const pendingDashboard = { state: { user: { id: user.id } }, query: {} };
  await app.controller(UID).mine(pendingDashboard);
  assert.equal(
    pendingDashboard.body.data.find((item) => item.documentId === pendingLegacy.documentId).storyLinkName,
    '',
  );
  await assert.rejects(
    async () => service.snapshot(await service.draft(pendingLegacy.documentId)),
    /link name/i,
  );
  const capturedLegacyPayment = {
    id: 'pay_legacy_link',
    status: 'captured',
    created_at: Math.floor(Date.now() / 1000),
  };
  await assert.rejects(
    () => payments.grantCapturedPurchase(staleLegacyPurchase, capturedLegacyPayment),
    /link name/i,
    'Capture cannot publish the old generated link',
  );
  assert.equal((await service.draft(pendingLegacy.documentId)).storyFirstPublishedAt, null);
  unlinkedPending = await service.save(
    pendingLegacy.documentId,
    user.id,
    { ...unlinkedPending.content, slug: '' },
    unlinkedPending.revision,
  );
  assert.equal(unlinkedPending.content.slug, '', 'Blank autosave keeps old checkout recoverable');
  await assert.rejects(
    () => service.save(
      pendingLegacy.documentId,
      user.id,
      { ...unlinkedPending.content, slug: content.slug },
      unlinkedPending.revision,
    ),
    /link name is already taken/i,
    'Repair still enforces global route uniqueness',
  );
  const chosenLegacyLink = 'legacy-creator-link';
  pendingLegacy = await service.save(
    pendingLegacy.documentId,
    user.id,
    { ...unlinkedPending.content, slug: chosenLegacyLink },
    unlinkedPending.revision,
  );
  assert.equal(pendingLegacy.slug, chosenLegacyLink);
  const relinkedPurchase = await app.db.query(purchaseUid).findOne({
    where: { purchaseId: legacyOrder.purchaseId },
  });
  assert.equal(relinkedPurchase.celebrationSlug, chosenLegacyLink);
  assert.equal(relinkedPurchase.storySnapshot.slug, chosenLegacyLink);
  assert.equal(relinkedPurchase.amountPaise, legacyOrder.amount);
  const reusedLegacyOrder = await payments.createOrder({
    slug: chosenLegacyLink,
    purchaseId: crypto.randomUUID(),
    country: 'IN',
    ownerId: user.id,
  });
  assert.equal(reusedLegacyOrder.orderId, legacyOrder.orderId);
  const legacyGrant = await payments.grantCapturedPurchase(staleLegacyPurchase, capturedLegacyPayment);
  assert.equal(legacyGrant.celebrationSlug, chosenLegacyLink);
  const legacyPublished = await app.db.query(UID).findOne({
    where: { documentId: pendingLegacy.documentId, publishedAt: { $notNull: true } },
  });
  assert.equal(legacyPublished.customroute, chosenLegacyLink);
  assert.equal(legacyPublished.storyPublishedContent.slug, chosenLegacyLink);
  await assert.rejects(
    () => service.save(
      pendingLegacy.documentId,
      user.id,
      { ...pendingLegacy.content, slug: 'another-legacy-link' },
      pendingLegacy.revision,
    ),
    /link name cannot change after checkout starts/i,
  );
  let other = await service.create(user.id, 'US', crypto.randomUUID());
  for (const file of files)
    await service.attach(other.documentId, user.id, file.id, null);
  other = await service.save(
    other.documentId,
    user.id,
    { ...content, slug: 'story-test-global', voiceId: null },
    other.revision,
  );
  let orderCalls = 0;
  payments.razorpay = async () => {
    orderCalls++;
    return { id: `order_global_${orderCalls}`, status: 'created' };
  };
  const simultaneous = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      payments.createOrder({
        slug: other.slug,
        purchaseId: crypto.randomUUID(),
        country: 'US',
        ownerId: user.id,
      }),
    ),
  );
  assert.equal(
    orderCalls,
    1,
    'Concurrent checkouts must create only one provider order',
  );
  const globalOrder = simultaneous.find(
    (result) => result.status === 'fulfilled',
  ).value;
  assert.equal(globalOrder.amount, 500);
  assert.equal(globalOrder.currency, 'USD');
  const priceEntry = await app
    .documents('api::premium-pricing.premium-pricing')
    .create({
      data: {
        storyIndiaPriceRupees: 42,
        storyOtherCountriesPriceUsd: 7,
      },
    });
  assert.deepEqual(
    await app.service('api::premium-pricing.premium-pricing').storySettings(),
    { INR: 4200, USD: 700 },
  );
  const pinnedOrder = await payments.createOrder({
    slug: other.slug,
    purchaseId: crypto.randomUUID(),
    country: 'US',
    ownerId: user.id,
  });
  assert.equal(
    pinnedOrder.amount,
    500,
    'An existing order keeps its original price',
  );
  assert.equal(
    (await payments.getAccess(other.slug)).amountPaise,
    500,
    'Checkout quote matches the pending order',
  );
  await app
    .documents('api::premium-pricing.premium-pricing')
    .delete({ documentId: priceEntry.documentId });
  const recovering = await service.create(user.id, 'IN', crypto.randomUUID());
  for (const file of files)
    await service.attach(recovering.documentId, user.id, file.id, null);
  await service.save(
    recovering.documentId,
    user.id,
    { ...content, slug: 'recovering-story', voiceId: null },
    recovering.revision,
  );
  let releaseOldOrder, notifyStarted;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  let attempts = 0;
  payments.razorpay = async () => {
    if (++attempts === 1) {
      notifyStarted();
      return new Promise((resolve) => {
        releaseOldOrder = resolve;
      });
    }
    return { id: 'order_recovered', status: 'created' };
  };
  const oldId = crypto.randomUUID();
  const interrupted = payments.createOrder({
    slug: 'recovering-story',
    purchaseId: oldId,
    country: 'IN',
    ownerId: user.id,
  });
  await started;
  await app.db
    .query('api::celebration-purchase.celebration-purchase')
    .update({
      where: { purchaseId: oldId },
      data: { createdAt: new Date(Date.now() - 180000) },
    });
  const recovered = await payments.createOrder({
    slug: 'recovering-story',
    purchaseId: crypto.randomUUID(),
    country: 'IN',
    ownerId: user.id,
  });
  assert.equal(recovered.orderId, 'order_recovered');
  const oldRejected = assert.rejects(interrupted, /replaced/);
  releaseOldOrder({ id: 'order_stale', status: 'created' });
  await oldRejected;
  const standard = await app
    .documents(UID)
    .create({
      status: 'published',
      data: {
        personname: 'Standard',
        personemail: user.email,
        hostname: 'Sam',
        hostemail: user.email,
        customroute: 'standard-regression',
        birthdaymessages: ['One', 'Two', 'Three'],
        templateId: 'classic',
        musicId: 'none',
        owner: user.id,
        country: 'IN',
      },
    });
  const standardAccess = await payments.getAccess('standard-regression');
  assert.equal(standardAccess.amountPaise, 900);
  assert.equal(standardAccess.journeyType, 'standard');
  assert.equal(standardAccess.unlocked, false);
  assert.deepEqual(standardAccess.features, ['collage']);
  assert.ok(
    Math.abs(
      Date.parse(standardAccess.expiresAt) -
        Date.parse(standard.createdAt) -
        86400000,
    ) < 1000,
  );
  const migration = require('../database/migrations/2026.09.30T18.00.00.birthday-story-one-day');
  const legacy = await service.create(user.id, 'IN', crypto.randomUUID());
  const firstPublishedAt = new Date().toISOString();
  const standardExpiryBefore = (await payments.getAccess('standard-regression')).expiresAt;
  await app.db.query(UID).updateMany({
    where: { documentId: legacy.documentId },
    data: {
      storyFirstPublishedAt: firstPublishedAt,
      expiresAt: new Date(Date.parse(firstPublishedAt) + 30 * 86400000).toISOString(),
    },
  });
  const expiredBefore = (await service.read(draft.documentId, user.id)).expiresAt;
  await migration.up(app.db.connection);
  const migrated = await service.read(legacy.documentId, user.id);
  assert.equal(Date.parse(migrated.expiresAt) - Date.parse(firstPublishedAt), 86400000);
  assert.equal((await service.read(draft.documentId, user.id)).expiresAt, expiredBefore);
  assert.equal((await service.read(other.documentId, user.id)).expiresAt, null);
  assert.equal((await payments.getAccess('standard-regression')).expiresAt, standardExpiryBefore);
  await migration.up(app.db.connection);
  assert.equal((await service.read(legacy.documentId, user.id)).expiresAt, migrated.expiresAt);

  await require('../tests/helpers/http-regression.cjs')(app, user, standard);

  console.log(
    'PASS: pricing, private drafts, ownership, media limits, validation, checkout retries, paid publication, edit isolation, guest wishes, 24-hour expiry, migration, dashboard, and no republishing.',
  );

})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise(setImmediate);
    try {
      if (app) await app.destroy();
    } finally {
      if (testPublicDir) await fs.rm(testPublicDir, { recursive: true, force: true });
      await Promise.all(['', '-wal', '-shm'].map((suffix) =>
        fs.rm(databasePath + suffix, { force: true }),
      ));
    }
  });
