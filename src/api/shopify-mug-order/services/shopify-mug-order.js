'use strict';

const { prepareIntake, transition } = require('../utils/intake');
const { randomBytes } = require('node:crypto');
const UID = 'api::shopify-mug-order.shopify-mug-order';
const RECEIPT = 'api::shopify-mug-receipt.shopify-mug-receipt';

module.exports = ({ strapi }) => ({
  async intake(envelope) {
    if (process.env.SHOPIFY_MUG_INTAKE_ENABLED !== 'true') throw new Error('disabled');
    const event = prepareIntake(envelope, process.env);
    const orders = strapi.db.query(UID);
    // Unique placeholder first; if the following transaction fails, Shopify's
    // retry can safely resume. No processing is acknowledged before commit.
    let row = await orders.findOne({ where: { orderKey: event.orderKey } });
    if (!row) {
      try {
        row = await orders.create({ data: { documentId: randomBytes(12).toString('hex'), orderKey: event.orderKey,
          shopDomain: event.shopDomain, shopifyOrderId: event.shopifyOrderId,
          hasMug: false, stopRequested: false, reviewDecision: 'pending', issues: [] } });
      } catch (error) {
        row = await orders.findOne({ where: { orderKey: event.orderKey } });
        if (!row) throw error;
      }
    }
    await strapi.db.transaction(async ({ trx }) => {
      const meta = strapi.db.metadata.get(UID);
      // Serialize event application per order across workers. On SQLite the
      // enclosing write transaction provides database-level write serialization.
      await trx(meta.tableName).where('id', row.id).forUpdate().first();
      const receipts = strapi.db.query(RECEIPT);
      if (await receipts.findOne({ where: { receiptKey: event.receiptKey } })) return;
      const current = await orders.findOne({ where: { id: row.id } });
      // A privacy-erasure tombstone retains delivery identity without restoring customer data on replay.
      if (current.holdReason === 'privacy_erased') {
        await receipts.create({ data: { documentId: randomBytes(12).toString('hex'), receiptKey: event.receiptKey,
          orderKey: event.orderKey, topic: event.topic, deliveryId: event.deliveryId } });
        return;
      }
      const data = transition(current, event);
      if ((data.sourceDigest && data.sourceDigest !== current.sourceDigest) || (data.stopRequested && !current.stopRequested)) {
        data.revision = (current.revision || 1) + 1; data.artifacts = null; data.approval = null;
        const jobs = strapi.db.query('api::mug-job.mug-job');
        const existing = await jobs.findMany({ where: { orderKey: current.orderKey } });
        if (existing.some(job => job.intentAt || job.providerId)) Object.assign(data, { productionHold: true, holdReason: 'order_changed_after_submission' });
        await jobs.updateMany({ where: { orderKey: current.orderKey }, data: { state: 'hold', reason: 'source_changed' } });
      }
      if (Object.keys(data).length) await orders.update({ where: { id: row.id }, data });
      await receipts.create({ data: { documentId: randomBytes(12).toString('hex'), receiptKey: event.receiptKey, orderKey: event.orderKey,
        topic: event.topic, deliveryId: event.deliveryId } });
    });
    return { received: true };
  },
});
