'use strict';
const { createHash, randomBytes } = require('node:crypto');
const UID = 'api::pod-order.pod-order';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const future = delay => new Date(Date.now() + delay).toISOString();
const token = () => randomBytes(16).toString('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && /^[1-9][0-9]{0,24}$/.test(value);
const fail = (message = 'state_conflict') => { throw new Error(message); };

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(UID);
  async function locked(key, action) {
    if (!validHash(key)) fail('invalid_request');
    return strapi.db.transaction(async ({ trx }) => {
      const found = await query().findOne({ where:{orderKey:key} }); if (!found) fail();
      await trx(strapi.db.metadata.get(UID).tableName).where('id',found.id).forUpdate().first();
      return action(await query().findOne({where:{id:found.id}}));
    });
  }
  return {
    ...require('../utils/admin-orders')({strapi,locked}),
    async state(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_request');
      if (body.op === 'get' && !body.orderKey && validId(body.orderId) && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(body.shop || '')) {
        body={...body,orderKey:hash(body.shop+'/'+body.orderId)};
      }
      if (body.op === 'capture') {
        if (!validId(body.orderId) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(body.shop || '')) fail('invalid_request');
        const orderKey = hash(body.shop + '/' + body.orderId);
        if (body.stop !== true && (!validHash(body.sourceDigest) || !body.snapshot || body.snapshot.orderId !== body.orderId ||
          !Array.isArray(body.snapshot.lines) || body.snapshot.lines.length > 500 || !Array.isArray(body.issues) || body.issues.length > 50 ||
          body.issues.some(issue => typeof issue !== 'string' || !/^[a-z_]{1,80}$/.test(issue)) ||
          !Number.isFinite(Date.parse(body.sourceUpdatedAt)) || hash({snapshot:body.snapshot,issues:body.issues,stop:false}) !== body.sourceDigest)) fail('invalid_request');
        let row = await query().findOne({where:{orderKey}});
        if (!row && body.stop !== true && !body.snapshot.lines.length && !body.issues.length) return {orderKey,ignored:true};
        if (!row) {
          try { row = await query().create({data:{documentId:token(),orderKey,reference:'p'+orderKey.slice(0,14),shop:body.shop,shopifyOrderId:body.orderId,state:'ignored'}}); }
          catch (error) { row = await query().findOne({where:{orderKey}}); if (!row) throw error; }
        }
        await locked(orderKey, async current => {
          if (current.erased) return;
          if (current.stopRequested) return;
          if (body.stop === true) {
            await query().update({where:{id:current.id},data:{stopRequested:true,state:'hold',reason:'cancelled_or_refunded',
              adminRevision:(current.adminRevision||0)+1,leaseToken:null,leaseUntil:null}}); return;
          }
          if (current.sourceUpdatedAt && Date.parse(body.sourceUpdatedAt) < Date.parse(current.sourceUpdatedAt)) return;
          if (current.sourceUpdatedAt && Date.parse(current.sourceUpdatedAt)===Date.parse(body.sourceUpdatedAt) && current.snapshot?.financialStatus==='paid' && body.snapshot.financialStatus==='pending') return;
          if (current.sourceDigest === body.sourceDigest) return;
          const changedAfterIntent = !!current.intentAt || !!current.providerId;
          const removed = current.snapshot?.lines?.length && !body.snapshot.lines.length;
          if (changedAfterIntent || removed) {
            await query().update({where:{id:current.id},data:{state:'hold',...(removed?{stopRequested:true}:{}),
              adminRevision:(current.adminRevision||0)+1,
              reason:changedAfterIntent?'changed_after_submission':'personalized_lines_removed'}}); return;
          }
          const paused=['paused','validating'].includes(current.state);
          await query().update({where:{id:current.id},data:{snapshot:body.snapshot,sourceDigest:body.sourceDigest,
            adminRevision:(current.adminRevision||0)+(current.snapshot?1:0),
            orderNumber:body.snapshot.orderNumber||body.orderId,paymentMode:body.snapshot.paymentMode||(body.snapshot.financialStatus==='paid'?'prepaid':'unknown'),
            totalPaise:body.snapshot.totalPaise,codCollectiblePaise:body.snapshot.amounts?.codCollectiblePaise||0,
            corrections:null,correctionSourceDigest:null,
            sourceUpdatedAt:body.sourceUpdatedAt,issues:body.issues,state:body.issues.length?'hold':body.snapshot.lines.length?'queued':'ignored',
            ...(paused?{state:'paused'}:{}),reason:paused?'source_changed_revalidate':body.issues.length?body.issues[0]:null,
            leaseToken:null,leaseUntil:null,nextRunAt:future(0)}});
        });
        return {orderKey};
      }
      if (body.op === 'claim') {
        return strapi.db.transaction(async ({trx}) => {
          const now = new Date();
          let selection = trx(strapi.db.metadata.get(UID).tableName)
            .whereIn('state',['validating','queued','intent','reconcile','submitted','fulfillment_intent','fulfillment_reconcile','fulfilled'])
            .where(part => part.whereNull('lease_until').orWhere('lease_until','<',now))
            .where(part => part.whereNull('next_run_at').orWhere('next_run_at','<=',now)).orderBy('id').forUpdate();
          if (['pg','postgres'].includes(strapi.db.connection.client.config.client)) selection = selection.skipLocked();
          const selected = await selection.first(); if (!selected) return {order:null};
          const current = await query().findOne({where:{id:selected.id}});
          const state = current.state==='intent'?'reconcile':current.state==='fulfillment_intent'?'fulfillment_reconcile':current.state;
          return {order:await query().update({where:{id:current.id},data:{state,leaseToken:token(),leaseUntil:future(180_000)}})};
        });
      }
      return locked(body.orderKey, async current => {
        if (body.op === 'get') return {order:current};
        if (body.op === 'erase') {
          if (body.confirmErase !== true) fail('invalid_request');
          await query().update({where:{id:current.id},data:{snapshot:null,tracking:null,corrections:null,adminNotes:null,erased:true,stopRequested:true,state:'hold',reason:'privacy_erased'}});
          return {externalDeletionRequired:!!current.intentAt};
        }
        const lease = typeof body.leaseToken === 'string' && body.leaseToken === current.leaseToken && Date.parse(current.leaseUntil) > Date.now();
        const lateProviderResult = body.op === 'submitted' && body.leaseToken === current.intentToken;
        const lateFulfillmentResult = body.op === 'fulfilled' && body.leaseToken === current.fulfillmentToken;
        if (!lease && !lateProviderResult && !lateFulfillmentResult) fail();
        let data;
        if (body.op === 'ready') {
          if(current.state!=='validating'||current.intentAt||current.providerId||current.stopRequested||current.issues?.length||body.sourceDigest!==current.sourceDigest)fail();
          data={state:'queued',reason:null,nextRunAt:future(0)};
        } else if (body.op === 'intent') {
          if (current.state !== 'queued' || current.intentAt || current.providerId || current.stopRequested || current.issues?.length ||
            !current.snapshot?.lines?.length || body.sourceDigest !== current.sourceDigest || !validHash(body.requestDigest)) fail();
          data={state:'intent',intentAt:future(0),intentToken:current.leaseToken,requestDigest:body.requestDigest};
        } else if (body.op === 'submitted') {
          if (!current.intentAt || !validId(body.providerId) || current.providerId && current.providerId !== body.providerId) fail();
          data={providerId:body.providerId,providerStatus:current.providerStatus || 'Created',
            state:current.state==='hold'?'hold':['intent','reconcile'].includes(current.state)?'submitted':current.state,nextRunAt:future(300_000)};
        } else if (body.op === 'uncertain') {
          if (!current.intentAt || !['intent','reconcile'].includes(current.state)) fail();
          data={state:'reconcile',reason:'provider_outcome_uncertain',nextRunAt:future(300_000)};
        } else if (body.op === 'defer') data={nextRunAt:future(300_000)};
        else if (body.op === 'hold') data={state:'hold',
          ...(validId(body.providerId) && (!current.providerId || current.providerId===body.providerId) ? {providerId:body.providerId}:{}),
          reason:['source_changed','invalid_artwork','provider_mismatch','provider_rejected','native_fulfillment_conflict','fulfillment_changed','existing_reference'].includes(body.reason)?body.reason:'manual_check_required'};
        else if (body.op === 'status') {
          if (!current.providerId || !/^[A-Za-z -]{1,50}$/.test(body.status || '')) fail('invalid_request');
          data={providerStatus:body.status,nextRunAt:future(['Delivered','Cancelled','Returned'].includes(body.status)?30*86_400_000:300_000)};
        } else if (body.op === 'fulfillment-intent') {
          if (current.state !== 'submitted' || current.stopRequested || body.sourceDigest !== current.sourceDigest || !body.tracking ||
            !/^[A-Za-z0-9-]{1,100}$/.test(body.tracking.number || '')) fail();
          data={state:'fulfillment_intent',fulfillmentToken:current.leaseToken,tracking:body.tracking};
        } else if (body.op === 'fulfillment-uncertain') {
          if (current.state !== 'fulfillment_intent') fail();
          data={state:'fulfillment_reconcile',nextRunAt:future(300_000)};
        } else if (body.op === 'fulfilled') {
          if (!current.fulfillmentToken || !/^gid:\/\/shopify\/Fulfillment\/[0-9]+$/.test(body.fulfillmentId || '') || current.fulfillmentId && current.fulfillmentId !== body.fulfillmentId) fail();
          data={state:current.state==='hold'?'hold':'fulfilled',fulfillmentId:body.fulfillmentId,nextRunAt:future(300_000)};
        } else fail('invalid_request');
        if (!['intent','fulfillment-intent'].includes(body.op)) Object.assign(data,{leaseToken:null,leaseUntil:null});
        await query().update({where:{id:current.id},data}); return {saved:true};
      });
    },
  };
};
