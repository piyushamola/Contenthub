const HAPPY_BIRTHDAY_UID = 'api::happy-birthday.happy-birthday';
const PAYMENT_UID = 'api::celebration-payment.celebration-payment';
const LIVE_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_FULFILLMENT_RETRIES = 3;
const UNPUBLISH_EXCLUDED_CUSTOM_ROUTES = ['elena', 'matt', 'mike'];
const EVERY_FIVE_MINUTES = '*/5 * * * *';

function errorMessage(error) {
  return String(error?.message || error || 'Unknown fulfillment error').slice(
    0,
    1000
  );
}

async function publishPaidCelebration(strapi, payment) {
  const documentId = payment.celebrationDocumentId;
  const existingPublished = await strapi
    .documents(HAPPY_BIRTHDAY_UID)
    .findOne({ documentId, status: 'published' });

  if (!existingPublished) {
    const draft = await strapi.documents(HAPPY_BIRTHDAY_UID).findOne({
      documentId,
      status: 'draft',
    });

    if (!draft) {
      throw new Error('Celebration draft no longer exists');
    }

    const expiresAt = new Date(Date.now() + LIVE_DURATION_MS);
    await strapi.documents(HAPPY_BIRTHDAY_UID).update({
      documentId,
      status: 'draft',
      data: {
        paymentRequired: true,
        goLiveCountry: payment.countryCode || 'IN',
        expiresAt,
      },
    });
    await strapi.documents(HAPPY_BIRTHDAY_UID).publish({ documentId });
  }

  await strapi.db.query(PAYMENT_UID).update({
    where: { id: payment.id },
    data: {
      status: 'fulfilled',
      fulfilledAt: new Date(),
      lastError: null,
    },
  });
}

async function notifyManualRefund(strapi, payment, operationsEmail) {
  if (!operationsEmail) {
    strapi.log.warn(
      `Manual refund required for Razorpay order ${payment.orderId}; PAYMENT_OPERATIONS_EMAIL is not configured.`
    );
    return;
  }

  try {
    await strapi.plugin('email').service('email').send({
      to: operationsEmail,
      subject: `Manual refund required: ${payment.orderId}`,
      text: [
        'A captured WishHappyBday payment could not be fulfilled after three attempts.',
        `Order: ${payment.orderId}`,
        `Payment: ${payment.paymentId || 'unknown'}`,
        `Celebration: ${payment.celebrationSlug}`,
        'Issue a full INR 49 refund from the Razorpay Dashboard.',
      ].join('\n'),
    });
    await strapi.db.query(PAYMENT_UID).update({
      where: { id: payment.id },
      data: { operationsNotifiedAt: new Date() },
    });
  } catch (error) {
    strapi.log.error(
      `Failed to send manual-refund notification for ${payment.orderId}: ${errorMessage(
        error
      )}`
    );
  }
}

async function notifyPendingManualRefunds(strapi, operationsEmail) {
  const pending = await strapi.db.query(PAYMENT_UID).findMany({
    where: {
      status: 'manual_refund_required',
      operationsNotifiedAt: { $null: true },
    },
    limit: 100,
  });
  for (const payment of pending) {
    await notifyManualRefund(strapi, payment, operationsEmail);
  }
}

async function retryPaidFulfillment(strapi, operationsEmail) {
  const payments = await strapi.db.query(PAYMENT_UID).findMany({
    where: { status: 'paid' },
    orderBy: { paidAt: 'asc' },
    limit: 100,
  });

  for (const payment of payments) {
    if ((payment.retryCount || 0) >= MAX_FULFILLMENT_RETRIES) {
      await strapi.db.query(PAYMENT_UID).update({
        where: { id: payment.id },
        data: { status: 'manual_refund_required' },
      });
      await notifyManualRefund(strapi, payment, operationsEmail);
      continue;
    }

    try {
      await publishPaidCelebration(strapi, payment);
    } catch (error) {
      const retryCount = (payment.retryCount || 0) + 1;
      const requiresRefund = retryCount >= MAX_FULFILLMENT_RETRIES;
      await strapi.db.query(PAYMENT_UID).update({
        where: { id: payment.id },
        data: {
          retryCount,
          lastError: errorMessage(error),
          status: requiresRefund ? 'manual_refund_required' : 'paid',
        },
      });

      if (requiresRefund) {
        await notifyManualRefund(
          strapi,
          { ...payment, retryCount, lastError: errorMessage(error) },
          operationsEmail
        );
      }
    }
  }
}

async function unpublishExpiredCelebrations(strapi) {
  const now = new Date();
  const legacyCutoff = new Date(Date.now() - LIVE_DURATION_MS);
  const entries = await strapi.db.query(HAPPY_BIRTHDAY_UID).findMany({
    where: {
      publishedAt: { $notNull: true },
      customroute: { $notIn: UNPUBLISH_EXCLUDED_CUSTOM_ROUTES },
      $or: [
        { expiresAt: { $notNull: true, $lte: now } },
        { expiresAt: { $null: true }, publishedAt: { $lte: legacyCutoff } },
      ],
    },
    select: ['documentId', 'locale'],
  });

  const targets = new Map();
  for (const entry of entries) {
    if (!entry.documentId) continue;
    const localeKey = entry.locale || '';
    targets.set(`${entry.documentId}:${localeKey}`, entry);
  }

  for (const target of targets.values()) {
    const params = { documentId: target.documentId };
    if (target.locale) params.locale = target.locale;
    await strapi.documents(HAPPY_BIRTHDAY_UID).unpublish(params);
  }

  if (targets.size) {
    strapi.log.info(`Auto-unpublished ${targets.size} expired celebrations.`);
  }
}

async function deleteAbandonedDrafts(strapi) {
  const cutoff = new Date(Date.now() - LIVE_DURATION_MS);
  const drafts = await strapi.db.query(HAPPY_BIRTHDAY_UID).findMany({
    where: {
      paymentRequired: true,
      publishedAt: { $null: true },
      createdAt: { $lte: cutoff },
    },
    populate: { images: true },
    limit: 100,
  });

  const seen = new Set();
  for (const draft of drafts) {
    if (!draft.documentId || seen.has(draft.documentId)) continue;
    seen.add(draft.documentId);

    const published = await strapi.documents(HAPPY_BIRTHDAY_UID).findOne({
      documentId: draft.documentId,
      status: 'published',
    });
    if (published) continue;

    await strapi.db.query(PAYMENT_UID).updateMany({
      where: {
        celebrationDocumentId: draft.documentId,
        status: 'created',
      },
      data: { status: 'expired' },
    });

    await strapi
      .documents(HAPPY_BIRTHDAY_UID)
      .delete({ documentId: draft.documentId });

    for (const image of draft.images || []) {
      try {
        await strapi.plugin('upload').service('upload').remove(image);
      } catch (error) {
        strapi.log.warn(
          `Could not remove abandoned upload ${image.id}: ${errorMessage(error)}`
        );
      }
    }
  }

  if (seen.size) {
    strapi.log.info(`Cleaned up ${seen.size} abandoned payment drafts.`);
  }
}

module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: {
    enabled: true,
    tasks: {
      happyBirthdayAutoUnpublish: {
        task: async ({ strapi }) => {
          try {
            await unpublishExpiredCelebrations(strapi);
          } catch (error) {
            strapi.log.error(
              `Failed to auto-unpublish celebrations: ${errorMessage(error)}`
            );
          }
        },
        options: { rule: EVERY_FIVE_MINUTES },
      },
      happyBirthdayPaymentRecovery: {
        task: async ({ strapi }) => {
          try {
            await retryPaidFulfillment(
              strapi,
              env('PAYMENT_OPERATIONS_EMAIL')
            );
            await notifyPendingManualRefunds(
              strapi,
              env('PAYMENT_OPERATIONS_EMAIL')
            );
          } catch (error) {
            strapi.log.error(
              `Failed to recover paid celebrations: ${errorMessage(error)}`
            );
          }
        },
        options: { rule: EVERY_FIVE_MINUTES },
      },
      happyBirthdayAbandonedDraftCleanup: {
        task: async ({ strapi }) => {
          try {
            await deleteAbandonedDrafts(strapi);
          } catch (error) {
            strapi.log.error(
              `Failed to clean abandoned drafts: ${errorMessage(error)}`
            );
          }
        },
        options: { rule: EVERY_FIVE_MINUTES },
      },
    },
  },
});
