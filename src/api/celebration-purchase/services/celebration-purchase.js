'use strict';

const crypto = require('crypto');
const { createCoreService } = require('@strapi/strapi').factories;

const PURCHASE_UID = 'api::celebration-purchase.celebration-purchase';
const WEBHOOK_UID = 'api::payment-webhook-event.payment-webhook-event';
const CELEBRATION_UID = 'api::happy-birthday.happy-birthday';
const AMOUNT_PAISE = 2700;
const CURRENCY = 'INR';
const CELEBRATION_DURATION_MS = 24 * 60 * 60 * 1000;
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

function toIsoFromUnix(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

function celebrationExpiresAt(celebration) {
  const explicitExpiry = Date.parse(celebration?.expiresAt || '');
  if (Number.isFinite(explicitExpiry)) {
    return new Date(explicitExpiry).toISOString();
  }
  const createdAt = Date.parse(celebration?.createdAt || '');
  return Number.isFinite(createdAt)
    ? new Date(createdAt + CELEBRATION_DURATION_MS).toISOString()
    : null;
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
    return strapi.db.query(CELEBRATION_UID).findOne({
      where: {
        customroute: { $eqi: normalizedSlug },
        publishedAt: { $notNull: true },
      },
      select: [
        'documentId',
        'customroute',
        'createdAt',
        'expiresAt',
        'premiumUnlocked',
        'premiumPurchasedAt',
        'premiumPurchaseId',
        'premiumPaymentId',
      ],
    });
  },

  accessFor(celebration) {
    const expiresAt = celebrationExpiresAt(celebration);
    const expiryMs = Date.parse(expiresAt || '');
    const unlocked = Boolean(
      celebration?.premiumUnlocked &&
        Number.isFinite(expiryMs) &&
        expiryMs > Date.now(),
    );
    return {
      unlocked,
      features: unlocked ? ['video', 'collage'] : [],
      expiresAt,
      amountPaise: AMOUNT_PAISE,
      currency: CURRENCY,
    };
  },

  async getAccess(slug) {
    const celebration = await this.findCelebration(slug);
    if (!celebration) return null;
    return this.accessFor(celebration);
  },

  async createOrder({ slug, purchaseId }) {
    if (!PURCHASE_ID_PATTERN.test(String(purchaseId || ''))) {
      throw new Error('A valid purchase id is required');
    }

    const celebration = await this.findCelebration(slug);
    if (!celebration) throw new Error('Celebration not found');
    if (DEMO_SLUGS.has(celebration.customroute.toLowerCase())) {
      throw new Error('Demo celebrations do not require payment');
    }
    const access = this.accessFor(celebration);
    if (!access.expiresAt || Date.parse(access.expiresAt) <= Date.now()) {
      throw new Error('Celebration has expired');
    }
    if (access.unlocked) return { alreadyUnlocked: true, access };

    const existing = await strapi.db.query(PURCHASE_UID).findOne({
      where: { purchaseId },
    });
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
      throw new Error('This payment attempt cannot be reused');
    }

    const receipt = `whb_${purchaseId.replace(/-/g, '').slice(0, 28)}`;
    await strapi.db.query(PURCHASE_UID).create({
      data: {
        purchaseId,
        celebrationDocumentId: celebration.documentId,
        celebrationSlug: celebration.customroute,
        receipt,
        amountPaise: AMOUNT_PAISE,
        currency: CURRENCY,
        status: 'creating',
      },
    });

    try {
      const order = await this.razorpay('/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: AMOUNT_PAISE,
          currency: CURRENCY,
          receipt,
          notes: {
            product: 'celebration_keepsake_v1',
            celebration_id: celebration.documentId,
          },
        }),
      });
      await strapi.db.query(PURCHASE_UID).update({
        where: { purchaseId },
        data: {
          razorpayOrderId: order.id,
          providerStatus: order.status,
          status: 'created',
        },
      });
      return {
        purchaseId,
        orderId: order.id,
        keyId: this.credentials.keyId,
        amount: AMOUNT_PAISE,
        currency: CURRENCY,
      };
    } catch (error) {
      await strapi.db.query(PURCHASE_UID).update({
        where: { purchaseId },
        data: { status: 'failed', failureReason: safeMessage(error) },
      });
      throw error;
    }
  },

  async grantCapturedPurchase(purchase, payment) {
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
    if (!celebrationBeforeGrant) throw new Error('Celebration not found');
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
        amountPaise: AMOUNT_PAISE,
        currency: CURRENCY,
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
      amountPaise: AMOUNT_PAISE,
      currency: CURRENCY,
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
      unlocked: Boolean(purchase.status === 'paid' && access?.unlocked),
      expired: Boolean(purchase.status === 'paid' && !access?.unlocked),
      expiresAt: access?.expiresAt || null,
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
          status: result.ignored ? 'ignored' : 'processed',
          processedAt: new Date().toISOString(),
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
}));
