'use strict';
const { randomBytes } = require('node:crypto');
const { approvalBinding, digest } = require('../utils/production');
const { saveArtifact, readArtifact } = require('../utils/artifacts');
const O = 'api::shopify-mug-order.shopify-mug-order';
const J = 'api::mug-job.mug-job';
const identity = () => randomBytes(16).toString('hex');
const future = ms => new Date(Date.now() + ms).toISOString();

module.exports = ({ strapi }) => {
  const orders = () => strapi.db.query(O); const jobs = () => strapi.db.query(J);
  async function lockedOrder(key, fn) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('invalid_operation');
    return strapi.db.transaction(async ({ trx }) => {
      const meta = strapi.db.metadata.get(O);
      const found = await orders().findOne({ where: { orderKey: key } });
      if (!found) throw new Error('invalid_operation');
      await trx(meta.tableName).where('id', found.id).forUpdate().first();
      return fn(await orders().findOne({ where: { id: found.id } }));
    });
  }
  function merchant(body) {
    const ids = (process.env.SHOPIFY_MUG_MERCHANT_IDS || '').split(',');
    if (!/^[1-9][0-9]*$/.test(String(body?.actorId)) || !ids.includes(String(body.actorId))) throw new Error('merchant_forbidden');
  }
  function enabled(order) {
    if (process.env.MUG_LIVE_SUBMISSION_ENABLED !== 'true' || process.env.MUG_NATIVE_DUPLICATION_VERIFIED !== 'true' ||
      !process.env.MUG_NATIVE_DUPLICATION_EVIDENCE || process.env.MUG_PRINT_CONTRACT_VERIFIED !== 'true' ||
      !(process.env.MUG_FIRST_ORDER_ALLOWLIST || '').split(',').includes(order.shopifyOrderId)) throw new Error('submission_disabled');
  }
  const view = row => ({ orderKey: row.orderKey, shopifyOrderId: row.shopifyOrderId, revision: row.revision,
    snapshot: row.snapshot, artifacts: row.artifacts, reviewDecision: row.reviewDecision,
    issues: row.issues, held: row.stopRequested || row.productionHold, holdReason: row.holdReason || null,
    sourceUpdatedAt: row.sourceUpdatedAt, approval: row.approval ? { digest: row.approval.digest, approvedAt: row.approval.approvedAt } : null });
  return {
    async review(body) {
      merchant(body);
      if (body.op === 'list') return { orders: await Promise.all((await orders().findMany({ orderBy: { updatedAt: 'desc' }, limit: 50 })).map(async row => ({ ...view(row),
        jobs: (await jobs().findMany({ where: { orderKey: row.orderKey } })).map(job => ({ lineId: job.lineId, state: job.state,
          providerId: job.providerId, providerStatus: job.providerStatus, reason: job.reason, fulfillmentId: job.fulfillmentId })) }))) };
      if (body.op === 'asset') return readArtifact(strapi, body.digest);
      // Decode/encrypt before the row lock, then check the revision again under lock.
      let prepared;
      if (['prepare','prepare-line'].includes(body.op)) {
        if (!Array.isArray(body.assets) || body.assets.length > 20) throw new Error('invalid_asset');
        prepared = {};
        for (const asset of body.assets) {
          if (typeof asset.lineId !== 'string' || prepared[asset.lineId]) throw new Error('invalid_asset');
          prepared[asset.lineId] = { artwork: await saveArtifact(strapi, asset.artwork, true), preview: await saveArtifact(strapi, asset.preview, false) };
        }
      }
      return lockedOrder(body.orderKey, async order => {
        if (body.op === 'get') return { order: view(order), jobs: (await jobs().findMany({ where: { orderKey: order.orderKey } })).map(j => ({ lineId: j.lineId, state: j.state, providerId: j.providerId, providerStatus: j.providerStatus, reason: j.reason })) };
        if (body.revision !== order.revision) throw new Error('stale_revision');
        if (['prepare','prepare-line'].includes(body.op)) {
          if (order.stopRequested || order.productionHold) throw new Error('order_held');
          if ((await jobs().findMany({ where: { orderKey: order.orderKey } })).some(job => job.intentAt || job.providerId)) throw new Error('order_held');
          const ids = order.snapshot.lines.map(l => l.lineId).sort();
          if (body.op === 'prepare' ? JSON.stringify(ids) !== JSON.stringify(Object.keys(prepared).sort()) :
            Object.keys(prepared).length !== 1 || !ids.includes(Object.keys(prepared)[0])) throw new Error('invalid_asset');
          if (body.op === 'prepare-line') prepared = { ...(order.artifacts || {}), ...prepared };
          await jobs().updateMany({ where: { orderKey: order.orderKey, state: 'queued' }, data: { state: 'hold', reason: 'assets_changed' } });
          await orders().update({ where: { id: order.id }, data: { artifacts: prepared, approval: null, reviewDecision: 'pending' } });
        } else if (body.op === 'approve') {
          if (body.confirmPhotoAndPreview !== true || body.confirmFrontOnly !== true || body.confirmReverseBlank !== true) throw new Error('invalid_operation');
          const approval = { ...approvalBinding(order, body.revision, String(body.actorId)), approvedAt: new Date().toISOString() };
          const existing = await jobs().findMany({ where: { orderKey: order.orderKey } });
          if (existing.some(j => j.intentAt || j.providerId)) throw new Error('order_held');
          for (const line of approval.lines) {
            const jobKey = digest({ orderKey: order.orderKey, lineId: line.lineId, revision: order.revision, approval: approval.digest });
            const prior = await jobs().findOne({ where: { jobKey } });
            if (prior) {
              if (!prior.intentAt) await jobs().update({ where: { id: prior.id }, data: { state: 'queued', leaseToken: null, leaseUntil: null, nextRunAt: future(0), approval } });
              continue;
            }
            await jobs().create({ data: { documentId: identity(), jobKey, orderKey: order.orderKey,
              shopifyOrderId: order.shopifyOrderId, lineId: line.lineId, revision: order.revision,
              reference: 'm' + jobKey.slice(0,14), designCode: 'M' + jobKey.slice(0,19), state: 'queued',
              nextRunAt: future(0), approval, snapshot: order.snapshot } });
          }
          await orders().update({ where: { id: order.id }, data: { approval, reviewDecision: 'reviewed' } });
        } else if (body.op === 'erase') {
          if (body.confirmErase !== true) throw new Error('invalid_operation');
          const all = await jobs().findMany({ where: { orderKey: order.orderKey } });
          const digests = [...Object.values(order.artifacts || {}).flatMap(pair => [pair.artwork, pair.preview]),
            ...all.flatMap(job => (job.approval?.lines || []).flatMap(line => [line.artwork, line.preview]))];
          await jobs().updateMany({ where: { orderKey: order.orderKey }, data: { state: 'hold', reason: 'privacy_erased',
            snapshot: { orderId: order.shopifyOrderId, lines: [] }, approval: null, tracking: null } });
          await orders().update({ where: { id: order.id }, data: { snapshot: { orderId: order.shopifyOrderId, lines: [] },
            artifacts: null, approval: null, reviewNotes: '', hasMug: false, stopRequested: true, productionHold: true,
            holdReason: 'privacy_erased', issues: ['privacy_erased'], revision: order.revision + 1, reviewDecision: 'pending' } });
          const otherOrders = await orders().findMany({ where: { orderKey: { $ne: order.orderKey } }, select: ['artifacts'] });
          const otherJobs = await jobs().findMany({ where: { orderKey: { $ne: order.orderKey } }, select: ['approval'] });
          const references = JSON.stringify([otherOrders,otherJobs]);
          for (const value of new Set(digests)) if (!references.includes(value)) await strapi.db.query('api::mug-artifact.mug-artifact').delete({ where: { digest: value } });
          return { erased: true, externalDeletionRequired: all.some(job => job.intentAt || job.providerId) };
        } else if (body.op === 'reject') {
          await orders().update({ where: { id: order.id }, data: { approval: null, reviewDecision: 'rejected' } });
          await jobs().updateMany({ where: { orderKey: order.orderKey }, data: { state: 'hold', reason: 'merchant_rejected' } });
        } else throw new Error('invalid_operation');
        return { order: view(await orders().findOne({ where: { id: order.id } })) };
      });
    },
    async work(body) {
      if (body?.op === 'asset') return readArtifact(strapi, body.digest);
      if (body?.op === 'claim') {
        // The database lock and conditional lease, not process memory, own a job.
        return strapi.db.transaction(async ({ trx }) => {
          const meta = strapi.db.metadata.get(J); const now = new Date();
          const client = strapi.db.connection.client.config.client;
          let query = trx(meta.tableName).whereIn('state', ['queued','intent','reconcile','submitted','fulfillment_intent','fulfillment_reconcile','fulfilled'])
            .where(q => q.whereNull('lease_until').orWhere('lease_until','<',now))
            .where(q => q.whereNull('next_run_at').orWhere('next_run_at','<=',now)).orderBy('id').forUpdate();
          if (client === 'pg' || client === 'postgres') query = query.skipLocked();
          const row = await query.first(); if (!row) return { job: null };
          const current = await jobs().findOne({ where: { id: row.id } });
          const leaseToken = identity();
          const state = current.state === 'intent' ? 'reconcile' : current.state === 'fulfillment_intent' ? 'fulfillment_reconcile' : current.state;
          const job = await jobs().update({ where: { id: row.id }, data: { state, leaseToken, leaseUntil: future(180_000) } });
          const order = await orders().findOne({ where: { orderKey: job.orderKey } });
          return { job, order: view(order) };
        });
      }
      if (!body || typeof body.jobKey !== 'string') throw new Error('invalid_operation');
      const candidate = await jobs().findOne({ where: { jobKey: body.jobKey } });
      if (!candidate) throw new Error('invalid_operation');
      return lockedOrder(candidate.orderKey, async order => {
        const job = await jobs().findOne({ where: { id: candidate.id } });
        const hasLease = body.leaseToken === job.leaseToken && Date.parse(job.leaseUntil) > Date.now();
        const intentResult = body.leaseToken === job.intentToken && body.op === 'submitted';
        if (!hasLease && !intentResult) throw new Error('lease_lost');
        let data;
        if (body.op === 'intent') {
          enabled(order);
          if (job.state !== 'queued' || job.intentAt || Date.parse(job.approval?.approvedAt) < Date.now() - 7 * 86_400_000 || order.stopRequested || order.productionHold ||
            order.reviewDecision !== 'reviewed' || !(process.env.SHOPIFY_MUG_MERCHANT_IDS || '').split(',').includes(String(order.approval?.merchantId)) || job.revision !== order.revision || job.approval.digest !== order.approval?.digest) throw new Error('state_conflict');
          if (!/^[a-f0-9]{64}$/.test(body.requestDigest || '')) throw new Error('invalid_operation');
          data = { state: 'intent', intentAt: future(0), intentToken: job.leaseToken, requestDigest: body.requestDigest };
        } else if (body.op === 'submitted') {
          if (!job.intentAt || !/^[1-9][0-9]{0,24}$/.test(body.providerId || '') || (job.providerId && job.providerId !== body.providerId)) throw new Error('state_conflict');
          data = { state: 'submitted', providerId: body.providerId, providerStatus: 'Created', nextRunAt: future(300_000) };
        } else if (body.op === 'uncertain') {
          if (!job.intentAt) throw new Error('state_conflict');
          data = { state: 'reconcile', reason: 'provider_outcome_uncertain', nextRunAt: future(300_000) };
        } else if (body.op === 'defer') data = { nextRunAt: future(300_000) };
        else if (body.op === 'hold') data = { state: 'hold', ...(typeof body.providerId === 'string' && /^[1-9][0-9]{0,24}$/.test(body.providerId) && (!job.providerId || job.providerId === body.providerId) ? { providerId: body.providerId } : {}), reason: ['source_changed','provider_mismatch','provider_rejected','asset_expired','native_conflict','invalid_source'].includes(body.reason) ? body.reason : 'manual_review_required' };
        else if (body.op === 'status') {
          if (!job.providerId || typeof body.status !== 'string' || !/^[A-Za-z -]{1,50}$/.test(body.status)) throw new Error('invalid_operation');
          data = { providerStatus: body.status, nextRunAt: future(['Delivered','Cancelled','Returned'].includes(body.status) ? 30 * 86_400_000 : 300_000) };
        } else if (body.op === 'fulfillment-intent') {
          enabled(order);
          if (job.state !== 'submitted' || order.stopRequested || order.productionHold || job.revision !== order.revision || !job.providerId) throw new Error('state_conflict');
          if (!body.tracking || !/^[A-Za-z0-9-]{1,100}$/.test(body.tracking.number || '')) throw new Error('invalid_operation');
          data = { state: 'fulfillment_intent', tracking: body.tracking,
            providerStatus: typeof body.status === 'string' && /^[A-Za-z -]{1,50}$/.test(body.status) ? body.status : job.providerStatus };
        } else if (body.op === 'fulfilled') {
          if (!['fulfillment_intent','fulfillment_reconcile'].includes(job.state) || !/^gid:\/\/shopify\/Fulfillment\/[0-9]+$/.test(body.fulfillmentId || '')) throw new Error('state_conflict');
          data = { state: 'fulfilled', fulfillmentId: body.fulfillmentId, nextRunAt: future(300_000) };
        } else if (body.op === 'fulfillment-uncertain') {
          if (job.state !== 'fulfillment_intent') throw new Error('state_conflict');
          data = { state: 'fulfillment_reconcile', nextRunAt: future(300_000) };
        } else throw new Error('invalid_operation');
        // Intent keeps its lease until the POST finishes or a crash expires it.
        if (!['intent','fulfillment-intent'].includes(body.op)) Object.assign(data, { leaseToken: null, leaseUntil: null });
        await jobs().update({ where: { id: job.id }, data });
        return { saved: true };
      });
    },
  };
};
