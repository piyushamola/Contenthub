'use strict';

const crypto = require('crypto');
const { createCoreService } = require('@strapi/strapi').factories;

const PURCHASE_UID = 'api::celebration-purchase.celebration-purchase';
const WEBHOOK_UID = 'api::payment-webhook-event.payment-webhook-event';
const CELEBRATION_UID = 'api::happy-birthday.happy-birthday';
const PRICING_UID = 'api::premium-pricing.premium-pricing';
const { celebrationExpiresAt } = require('../../happy-birthday/utils/celebration-expiry');
const DEMO_SLUGS = new Set(
  (process.env.BIRTHDAY_EXPIRY_EXCLUDED_ROUTES || 'elena,matt,mike')
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean),
);
const PURCHASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeMessage(error) {
  return String(error?.message || error || 'Unknown payment error').slice(0, 1000);
}

function offerForCountry(country, prices) {
  const currency = String(country || '').trim().toUpperCase() === 'IN' ? 'INR' : 'USD';
  return { amountPaise: prices[currency], currency };
}

function billingCountry(celebration, fallbackCountry) {
  const savedCountry = String(celebration?.country || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(savedCountry) ? savedCountry : fallbackCountry;
}

function toIsoFromUnix(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

module.exports = createCoreService(PURCHASE_UID, ({ strapi }) => ({
  get credentials() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error('Razorpay is not configured');
    }
    return { keyId, keySecret };
  },

  async razorpay(path, init = {}) {
    const { keyId, keySecret } = this.credentials;
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      signal: init.signal || AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error?.description || `Razorpay request failed (${response.status})`);
    }
    return data;
  },

  async findCelebration(slug) {
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    if (!normalizedSlug) return null;
    const published = await strapi.db.query(CELEBRATION_UID).findOne({
      where: {
        customroute: { $eqi: normalizedSlug },
        publishedAt: { $notNull: true },
      },
      select: [
        'documentId',
        'customroute',
        'createdAt',
        'expiresAt',
        'country',
        'premiumUnlocked',
        'premiumPurchasedAt',
        'premiumPurchaseId',
        'premiumPaymentId',
        'journeyType', 'storyFirstPublishedAt', 'storyExpiredAt',
      ],
      populate: { owner: { select: ['id'] } },
    });
    if (published) return { ...published, storyIsPublished: true };
    const draft = await strapi.service('api::happy-birthday.birthday-story').findBySlug(normalizedSlug);
    return draft ? { ...draft, storyIsPublished: false } : null;
  },

  accessFor(celebration, prices, fallbackCountry) {
    const expiresAt = celebration.journeyType === 'story' ? celebration.expiresAt : celebrationExpiresAt(celebration);
    const expiryMs = Date.parse(expiresAt || '');
    const unlocked = Boolean(
      celebration?.premiumUnlocked &&
        (celebration.journeyType !== 'story' || (celebration.storyIsPublished && !celebration.storyExpiredAt)) &&
        Number.isFinite(expiryMs) &&
        expiryMs > Date.now(),
    );
    const offer = offerForCountry(billingCountry(celebration, fallbackCountry), prices);
    return {
      unlocked,
      features: celebration.journeyType === 'story' ? (unlocked ? ['video', 'pdf'] : []) : unlocked ? ['video', 'collage'] : ['collage'],
      journeyType: celebration.journeyType || 'standard',
      expiresAt,
      amountPaise: offer.amountPaise,
      currency: offer.currency,
      // Lets the Next.js layer recognize a logged-in owner as the host from
      // any device, without a second round trip just to read this field.
      ownerId: celebration?.owner?.id ?? null,
    };
  },

  async getAccess(slug) {
    const celebration = await this.findCelebration(slug);
    if (!celebration) return null;
    const prices = celebration.journeyType === 'story' ? await strapi.service(PRICING_UID).storySettings() : await strapi.service(PRICING_UID).currentPrices();
    const access = this.accessFor(celebration, prices);
    if (celebration.journeyType === 'story' && !access.unlocked) {
      const pending = await strapi.db.query(PURCHASE_UID).findOne({ where: { celebrationDocumentId: celebration.documentId, productType: 'story', status: 'created' } });
      if (pending) return { ...access, amountPaise: pending.amountPaise, currency: pending.currency };
    }
    return access;
  },

  async createOrder({ slug, purchaseId, country, ownerId }) {
    const normalizedOwnerId = Number.isInteger(ownerId) ? ownerId : null;
    if (!PURCHASE_ID_PATTERN.test(String(purchaseId || ''))) {
      throw new Error('A valid purchase id is required');
    }
    const celebration = await this.findCelebration(slug);
    if (!celebration) throw new Error('Celebration not found');
    if (!normalizedOwnerId || celebration.owner?.id !== normalizedOwnerId) {
      throw new Error('Only the logged-in creator can upgrade this celebration');
    }
    if (DEMO_SLUGS.has(celebration.customroute.toLowerCase())) {
      throw new Error('Demo celebrations do not require payment');
    }
    const prices = celebration.journeyType === 'story' ? await strapi.service(PRICING_UID).storySettings() : await strapi.service(PRICING_UID).currentPrices();
    const access = this.accessFor(celebration, prices, country);
    if (celebration.storyExpiredAt || (celebration.journeyType !== 'story' && !access.expiresAt) || (access.expiresAt && Date.parse(access.expiresAt) <= Date.now())) {
      throw new Error('Celebration has expired');
    }
    if (access.unlocked) return { alreadyUnlocked: true, access };

    let existing = celebration.journeyType === 'story'
      ? await strapi.db.query(PURCHASE_UID).findOne({ where: { celebrationDocumentId: celebration.documentId, productType: 'story', status: { $in: ['creating', 'created', 'paid'] } }, orderBy: { createdAt: 'desc' } })
      : await strapi.db.query(PURCHASE_UID).findOne({ where: { purchaseId } });
    if (celebration.journeyType === 'story' && existing?.status === 'creating' && !existing.razorpayOrderId && Date.parse(existing.createdAt) < Date.now() - 120_000) {
      // No checkout was returned to a browser. Recover a worker that stopped
      // between claiming the attempt and recording the provider order.
      const released = await strapi.db.query(PURCHASE_UID).updateMany({ where: { id: existing.id, status: 'creating', razorpayOrderId: null }, data: { status: 'failed', storyOrderKey: null, failureReason: 'Checkout preparation interrupted' } });
      if (released.count) existing = null;
    }
    if (existing) {
      if (existing.celebrationDocumentId !== celebration.documentId) {
        throw new Error('Purchase id belongs to another celebration');
      }
      if (existing.status === 'paid') {
        const existingAccess = await this.getAccess(slug);
        if (existingAccess?.unlocked) {
          return { alreadyUnlocked: true, access: existingAccess };
        }
        throw new Error('This celebration has expired and the payment attempt cannot be reused');
      }
      if (existing.status === 'created' && existing.razorpayOrderId) {
        return {
          purchaseId: existing.purchaseId,
          orderId: existing.razorpayOrderId,
          keyId: this.credentials.keyId,
          amount: existing.amountPaise,
          currency: existing.currency,
        };
      }
      throw new Error(existing.productType === 'story' ? 'Checkout is already being prepared. Please try again in a moment' : 'This payment attempt cannot be reused');
    }

    // Only new orders use the latest Strapi price. A Razorpay order that
    // already exists keeps the amount recorded when it was created.
    if (celebration.journeyType === 'story' && celebration.storyFirstPublishedAt) throw new Error('This story cannot be republished');
    const storyDraft = celebration.journeyType === 'story' ? await strapi.service('api::happy-birthday.birthday-story').owned(celebration.documentId, normalizedOwnerId) : null;
    const storySnapshot = storyDraft ? await strapi.service('api::happy-birthday.birthday-story').snapshot(storyDraft) : null;
    const offer = offerForCountry(billingCountry(celebration, country), prices);
    const receipt = `whb_${purchaseId.replace(/-/g, '').slice(0, 28)}`;
    try { await strapi.db.query(PURCHASE_UID).create({
      data: {
        purchaseId,
        celebrationDocumentId: celebration.documentId,
        celebrationSlug: celebration.customroute,
        receipt,
        productType: storyDraft ? 'story' : 'premium',
        // A database constraint also protects checkout across workers/tabs.
        storyOrderKey: storyDraft ? celebration.documentId : null,
        storySnapshot, storyRevision: storyDraft?.storyRevision ?? null,
        amountPaise: offer.amountPaise,
        currency: offer.currency,
        status: 'creating',
        owner: normalizedOwnerId,
      },
    }); } catch (error) {
      if (storyDraft && await strapi.db.query(PURCHASE_UID).findOne({ where: { storyOrderKey: celebration.documentId } })) throw new Error('Checkout is already being prepared. Please try again in a moment');
      throw error;
    }

    try {
      const order = await this.razorpay('/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: offer.amountPaise,
          currency: offer.currency,
          receipt,
          notes: {
            product: storyDraft ? 'birthday_story_v1' : 'celebration_keepsake_v1',
            celebration_id: celebration.documentId,
          },
        }),
      });
      const savedOrder = await strapi.db.query(PURCHASE_UID).updateMany({
        where: { purchaseId, status: 'creating' },
        data: {
          razorpayOrderId: order.id,
          providerStatus: order.status,
          status: 'created',
        },
      });
      if (!savedOrder.count) throw new Error('This checkout was replaced. Please try again');
      return {
        purchaseId,
        orderId: order.id,
        keyId: this.credentials.keyId,
        amount: offer.amountPaise,
        currency: offer.currency,
      };
    } catch (error) {
      await strapi.db.query(PURCHASE_UID).update({
        where: { purchaseId },
        data: { status: 'failed', storyOrderKey: null, failureReason: safeMessage(error) },
      });
      throw error;
    }
  },

  async grantCapturedPurchase(purchase, payment) {
    if (purchase.productType === 'story') {
      const result = await strapi.service('api::happy-birthday.birthday-story').publishCaptured(purchase, payment);
      await strapi.db.query(PURCHASE_UID).update({ where: { purchaseId: purchase.purchaseId }, data: {
        razorpayPaymentId: payment.id, providerStatus: payment.status, status: 'paid', purchasedAt: toIsoFromUnix(payment.created_at),
        failureReason: result.duplicatePayment ? 'Duplicate captured payment; review for refund' : result.expired ? 'Story no longer available; review for refund' : null,
      } });
      return result;
    }
    const purchasedAt = toIsoFromUnix(payment.created_at);
    const celebrationBeforeGrant = await strapi.db.query(CELEBRATION_UID).findOne({
      where: { documentId: purchase.celebrationDocumentId },
      select: [
        'createdAt',
        'expiresAt',
        'premiumUnlocked',
        'premiumPaymentId',
      ],
    });
    if (!celebrationBeforeGrant) {
      await strapi.db.query(PURCHASE_UID).update({
        where: { purchaseId: purchase.purchaseId },
        data: {
          razorpayPaymentId: payment.id,
          providerStatus: payment.status,
          status: 'paid',
          purchasedAt,
          failureReason:
            'Payment captured after the celebration was deleted; review for refund',
        },
      });
      return {
        status: 'paid',
        unlocked: false,
        expired: true,
        celebrationSlug: purchase.celebrationSlug,
        features: [],
        expiresAt: null,
        amountPaise: purchase.amountPaise,
        currency: purchase.currency,
      };
    }
    const expiresAt = celebrationExpiresAt(celebrationBeforeGrant);
    const celebrationActive = Boolean(
      expiresAt && Date.parse(expiresAt) > Date.now(),
    );

    if (!celebrationActive) {
      await strapi.db.query(PURCHASE_UID).update({
        where: { purchaseId: purchase.purchaseId },
        data: {
          razorpayPaymentId: payment.id,
          providerStatus: payment.status,
          status: 'paid',
          purchasedAt,
          failureReason:
            'Payment captured after the celebration expired; review for refund',
        },
      });
      return {
        status: 'paid',
        unlocked: false,
        expired: true,
        celebrationSlug: purchase.celebrationSlug,
        features: [],
        expiresAt,
        amountPaise: purchase.amountPaise,
        currency: purchase.currency,
      };
    }

    const updateResult = await strapi.db.query(CELEBRATION_UID).updateMany({
      where: {
        documentId: purchase.celebrationDocumentId,
        premiumUnlocked: { $ne: true },
      },
      data: {
        premiumUnlocked: true,
        premiumPurchasedAt: purchasedAt,
        premiumPurchaseId: purchase.purchaseId,
        premiumPaymentId: payment.id,
      },
    });

    let canonicalPaymentId = payment.id;
    if (!updateResult?.count) {
      const celebration = await strapi.db.query(CELEBRATION_UID).findOne({
        where: { documentId: purchase.celebrationDocumentId },
        select: ['premiumUnlocked', 'premiumPaymentId'],
      });
      if (!celebration?.premiumUnlocked || !celebration?.premiumPaymentId) {
        throw new Error('Could not grant celebration access');
      }
      canonicalPaymentId = celebration.premiumPaymentId;
    }

    await strapi.db.query(PURCHASE_UID).update({
      where: { purchaseId: purchase.purchaseId },
      data: {
        razorpayPaymentId: payment.id,
        providerStatus: payment.status,
        status: 'paid',
        purchasedAt,
        failureReason:
          canonicalPaymentId && canonicalPaymentId !== payment.id
            ? 'Duplicate captured payment; review for refund'
            : null,
      },
    });

    return {
      unlocked: true,
      celebrationSlug: purchase.celebrationSlug,
      features: ['video', 'collage'],
      expiresAt,
      amountPaise: purchase.amountPaise,
      currency: purchase.currency,
      duplicatePayment: Boolean(
        canonicalPaymentId && canonicalPaymentId !== payment.id,
      ),
    };
  },

  async reconcileCapturedPurchase(purchase, paymentId) {
    const payment = await this.razorpay(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== purchase.razorpayOrderId) {
      throw new Error('Payment does not belong to this order');
    }
    await strapi.db.query(PURCHASE_UID).update({
      where: { purchaseId: purchase.purchaseId },
      data: {
        razorpayPaymentId: payment.id,
        providerStatus: payment.status,
      },
    });
    const order = await this.razorpay(
      `/orders/${encodeURIComponent(purchase.razorpayOrderId)}`,
    );
    if (
      payment.amount !== purchase.amountPaise ||
      payment.currency !== purchase.currency ||
      payment.status !== 'captured' ||
      order.amount !== purchase.amountPaise ||
      order.currency !== purchase.currency ||
      order.status !== 'paid'
    ) {
      return { pending: true, status: payment.status };
    }
    return this.grantCapturedPurchase(purchase, payment);
  },

  async verifyPayment({ purchaseId, orderId, paymentId, signature }) {
    const purchase = await strapi.db.query(PURCHASE_UID).findOne({
      where: { purchaseId },
    });
    if (!purchase || purchase.razorpayOrderId !== orderId) {
      throw new Error('Payment does not match this purchase');
    }
    const expected = crypto
      .createHmac('sha256', this.credentials.keySecret)
      .update(`${purchase.razorpayOrderId}|${paymentId}`)
      .digest('hex');
    const provided = Buffer.from(String(signature || ''), 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      provided.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(provided, expectedBuffer)
    ) {
      throw new Error('Payment signature is invalid');
    }
    return this.reconcileCapturedPurchase(purchase, paymentId);
  },

  async getStatus(purchaseId) {
    const purchase = await strapi.db.query(PURCHASE_UID).findOne({
      where: { purchaseId },
    });
    if (!purchase) return null;
    if (
      purchase.status === 'created' &&
      purchase.razorpayOrderId
    ) {
      return this.reconcileOrder(
        purchase.razorpayOrderId,
        purchase.razorpayPaymentId,
      );
    }
    const access = await this.getAccess(purchase.celebrationSlug);
    return {
      status: purchase.status,
      celebrationSlug: purchase.celebrationSlug,
      unlocked: Boolean(purchase.status === 'paid' && access?.unlocked),
      expired: Boolean(purchase.status === 'paid' && !access?.unlocked),
      expiresAt: access?.expiresAt || null,
      amountPaise: purchase.amountPaise,
      currency: purchase.currency,
    };
  },

  async reconcileOrder(orderId, preferredPaymentId) {
    const purchase = await strapi.db.query(PURCHASE_UID).findOne({
      where: { razorpayOrderId: orderId },
    });
    if (!purchase) return { ignored: true };
    let paymentId = preferredPaymentId;
    if (!paymentId) {
      const payments = await this.razorpay(
        `/orders/${encodeURIComponent(orderId)}/payments`,
      );
      paymentId = payments.items?.find((item) => item.status === 'captured')?.id;
    }
    if (!paymentId) return { pending: true };
    return this.reconcileCapturedPurchase(purchase, paymentId);
  },

  async revokeRefundedPayment(paymentId) {
    const purchase = await strapi.db.query(PURCHASE_UID).findOne({
      where: { razorpayPaymentId: paymentId },
    });
    if (!purchase) return { ignored: true };
    const payment = await this.razorpay(
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    const refundedAmount = Number(payment.amount_refunded);
    if (!Number.isFinite(refundedAmount)) {
      throw new Error('Refund total is unavailable');
    }
    if (refundedAmount < purchase.amountPaise) {
      await strapi.db.query(PURCHASE_UID).update({
        where: { purchaseId: purchase.purchaseId },
        data: { providerStatus: 'partially_refunded' },
      });
      return { refunded: true, partial: true, entitlementRevoked: false };
    }
    await strapi.db.query(PURCHASE_UID).update({
      where: { purchaseId: purchase.purchaseId },
      data: { status: 'refunded', providerStatus: 'refunded' },
    });
    const celebration = await strapi.db.query(CELEBRATION_UID).findOne({
      where: {
        documentId: purchase.celebrationDocumentId,
        premiumPaymentId: paymentId,
      },
      select: ['documentId'],
    });
    if (!celebration) return { refunded: true, entitlementRevoked: false };
    await strapi.db.query(CELEBRATION_UID).updateMany({
      where: {
        documentId: purchase.celebrationDocumentId,
        premiumPaymentId: paymentId,
      },
      data: {
        premiumUnlocked: false,
      },
    });
    if (purchase.productType === 'story') {
      await strapi.db.query(CELEBRATION_UID).updateMany({ where: { documentId: purchase.celebrationDocumentId }, data: { storyExpiredAt: new Date().toISOString() } });
      await strapi.service(CELEBRATION_UID).unpublishCelebration(purchase.celebrationDocumentId);
    }
    return { refunded: true, entitlementRevoked: true };
  },

  async processWebhook({ eventId, event }) {
    if (!eventId || !event?.event) throw new Error('Invalid webhook event');
    let inbox = await strapi.db.query(WEBHOOK_UID).findOne({
      where: { eventId },
    });
    if (inbox?.status === 'processed' || inbox?.status === 'ignored') {
      return { duplicate: true };
    }
    if (!inbox) {
      const payment = event.payload?.payment?.entity;
      const order = event.payload?.order?.entity;
      const refund = event.payload?.refund?.entity;
      inbox = await strapi.db.query(WEBHOOK_UID).create({
        data: {
          eventId,
          eventType: event.event,
          status: 'received',
          payload: {
            paymentId: payment?.id || null,
            orderId: order?.id || payment?.order_id || null,
            refundId: refund?.id || null,
            refundPaymentId: refund?.payment_id || null,
            paymentStatus: payment?.status || null,
            refundStatus: refund?.status || null,
          },
        },
      });
    }
    try {
      let result = { ignored: true };
      const payment = event.payload?.payment?.entity;
      const order = event.payload?.order?.entity;
      const refund = event.payload?.refund?.entity;
      if (event.event === 'payment.captured' && payment?.order_id) {
        result = await this.reconcileOrder(payment.order_id, payment.id);
      } else if (event.event === 'order.paid' && order?.id) {
        result = await this.reconcileOrder(order.id, payment?.id);
      } else if (event.event === 'refund.processed' && refund?.payment_id) {
        result = await this.revokeRefundedPayment(refund.payment_id);
      }
      await strapi.db.query(WEBHOOK_UID).update({
        where: { eventId },
        data: {
          status: result.pending
            ? 'received'
            : result.ignored
              ? 'ignored'
              : 'processed',
          processedAt: result.pending ? null : new Date().toISOString(),
          lastError: null,
        },
      });
      return result;
    } catch (error) {
      await strapi.db.query(WEBHOOK_UID).update({
        where: { eventId },
        data: { status: 'failed', lastError: safeMessage(error) },
      });
      throw error;
    }
  },

  /** Retry captured payments and webhook events missed by a request worker. */
  async reconcilePending() {
    const now = Date.now();
    const purchases = await strapi.db.query(PURCHASE_UID).findMany({
      where: {
        status: 'created',
        razorpayOrderId: { $notNull: true },
        createdAt: {
          $gte: new Date(now - 48 * 60 * 60 * 1000),
          $lte: new Date(now - 2 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
      limit: 50,
    });
    const events = await strapi.db.query(WEBHOOK_UID).findMany({
      where: { status: { $in: ['received', 'failed'] } },
      orderBy: { createdAt: 'desc' },
      limit: 50,
    });
    const result = { purchasesChecked: 0, eventsChecked: 0, failed: 0 };

    for (const purchase of purchases) {
      try {
        await this.reconcileOrder(
          purchase.razorpayOrderId,
          purchase.razorpayPaymentId,
        );
        result.purchasesChecked += 1;
      } catch (error) {
        result.failed += 1;
        strapi.log.error(
          `Payment recovery failed for ${purchase.purchaseId}: ${safeMessage(error)}`,
        );
      }
    }

    for (const event of events) {
      const payload = event.payload || {};
      try {
        let outcome = { ignored: true };
        if (
          (event.eventType === 'payment.captured' ||
            event.eventType === 'order.paid') &&
          payload.orderId
        ) {
          outcome = await this.reconcileOrder(payload.orderId, payload.paymentId);
        } else if (
          event.eventType === 'refund.processed' &&
          payload.refundPaymentId
        ) {
          outcome = await this.revokeRefundedPayment(payload.refundPaymentId);
        }
        await strapi.db.query(WEBHOOK_UID).update({
          where: { eventId: event.eventId },
          data: {
            status: outcome.pending
              ? 'received'
              : outcome.ignored
                ? 'ignored'
                : 'processed',
            processedAt: outcome.pending ? null : new Date().toISOString(),
            lastError: null,
          },
        });
        result.eventsChecked += 1;
      } catch (error) {
        result.failed += 1;
        await strapi.db.query(WEBHOOK_UID).update({
          where: { eventId: event.eventId },
          data: { status: 'failed', lastError: safeMessage(error) },
        });
        strapi.log.error(
          `Webhook recovery failed for ${event.eventId}: ${safeMessage(error)}`,
        );
      }
    }

    return result;
  },
}));
