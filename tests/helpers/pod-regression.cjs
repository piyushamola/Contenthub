'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

module.exports = async (app, base, jwt, broad) => {
  const before = process.env.POD_RELAY_SECRET;
  process.env.POD_RELAY_SECRET = 'synthetic-pod-relay-secret-at-least-32-characters';
  const token = (await app.admin.services['api-token'].create({ name: 'pod-restricted', type: 'custom', lifespan: null,
    permissions: ['api::pod-order.pod-order.state'] })).accessKey;
  const request = async (body, key = token, secret = process.env.POD_RELAY_SECRET) => {
    const response = await fetch(base + '/pod-orders/state', { method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(key ? { Authorization: 'Bearer ' + key } : {}), 'X-Pod-Relay-Secret': secret }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const key of ['', jwt, broad]) assert.ok([401,403].includes((await request({op:'claim'}, key)).status));
    assert.equal((await request({op:'claim'}, token, 'wrong')).status, 403);
    const snapshot = { orderId:'8001', currency:'INR', financialStatus:'paid', test:false, totalPaise:34900,
      lines:[{id:'11',variantId:'101',quantity:1,unitPricePaise:34900}], shipping:{first_name:'Synthetic',address1:'Fixture address'} };
    const body = { op:'capture', shop:'fixture.myshopify.com', orderId:'8001', sourceUpdatedAt:'2026-10-27T12:00:00Z',
      snapshot, issues:[], stop:false, sourceDigest:hash({snapshot,issues:[],stop:false}) };
    const firstDeliveries=await Promise.all(Array.from({length:6},()=>request(body)));
    firstDeliveries.forEach(result=>assert.equal(result.status,200));
    console.log('PASS: private generic order capture rejects anonymous/JWT/broad tokens and requires the relay secret.');
    const orderKey = (await request(body)).body.orderKey;
    const get = async key => (await request({op:'get',orderKey:key || orderKey})).body.order;
    const first = await get();
    const copy={documentId:'synthetic-unique-guard',orderKey,reference:'synthetic-distinct-reference',
      shop:body.shop,shopifyOrderId:body.orderId,state:'ignored'};
    await assert.rejects(()=>app.db.query('api::pod-order.pod-order').create({data:copy}),
      /unique|duplicate|already exists/i,'The database must reject another row for the same Shopify order');
    await assert.rejects(()=>app.db.query('api::pod-order.pod-order').create({data:{...copy,
      orderKey:'f'.repeat(64),reference:first.reference}}),
      /unique|duplicate|already exists/i,'The database must reject a reused provider reference');
    await Promise.all(Array.from({length:6},()=>request(body).then(result=>assert.equal(result.status,200))));
    assert.equal((await get()).id,first.id);
    assert.equal(await app.db.query('api::pod-order.pod-order').count({where:{orderKey}}),1,
      'Concurrent capture must persist exactly one order row');
    const claims = await Promise.all([request({op:'claim'}),request({op:'claim'})]);
    assert.equal(claims.filter(result=>result.body.order).length,1,
      JSON.stringify(claims.map(result=>({status:result.status,id:result.body.order?.id,
        orderKey:result.body.order?.orderKey,leaseUntil:result.body.order?.leaseUntil}))));
    let claimed = claims.find(result=>result.body.order).body.order;
    assert.equal(claimed.id,first.id);
    // Reopen only this synthetic lease between waves. Each worker must race
    // through the real HTTP route and transaction, not a mocked lock.
    for (let wave=0;wave<20;wave++) {
      await app.db.query('api::pod-order.pod-order').update({where:{id:first.id},data:{
        leaseUntil:new Date(Date.now()-1000).toISOString(),
      }});
      const contenders=await Promise.all(Array.from({length:6},()=>request({op:'claim'})));
      contenders.forEach(result=>assert.equal(result.status,200));
      const winners=contenders.flatMap(result=>result.body.order?[result.body.order]:[]);
      assert.equal(winners.length,1,`Lease wave ${wave}: `+JSON.stringify(winners.map(order=>({id:order.id,orderKey:order.orderKey}))));
      assert.equal(winners[0].id,first.id);
      claimed=winners[0];
      assert.equal((await get()).leaseToken,claimed.leaseToken,'The winning lease must be persisted');
      assert.equal((await request({op:'claim'})).body.order,null,
        'A later worker must not reclaim an unexpired lease');
    }
    const lease = {orderKey,leaseToken:claimed.leaseToken};
    const intent = {...lease,op:'intent',sourceDigest:body.sourceDigest,requestDigest:'a'.repeat(64)};
    assert.equal((await request(intent)).status,200);
    assert.equal((await request(intent)).status,409);
    console.log('PASS: duplicate/concurrent deliveries retain one record and concurrent workers claim one lease.');
    await app.db.query('api::pod-order.pod-order').update({where:{id:first.id},data:{leaseUntil:new Date(Date.now()-1000).toISOString()}});
    const recovered = (await request({op:'claim'})).body.order;
    assert.equal(recovered.state,'reconcile'); assert.equal(recovered.reference,first.reference);
    assert.equal((await request({...intent,leaseToken:recovered.leaseToken})).status,409);
    const unsubscribe = app.db.lifecycles.subscribe({models:['api::pod-order.pod-order'],beforeUpdate(event){
      if(event.params.data.providerId) throw new Error('synthetic database failure');
    }});
    assert.equal((await request({...lease,op:'submitted',providerId:'555001'})).status,503);
    assert.equal((await get()).providerId,null); unsubscribe();
    assert.equal((await request({...lease,op:'submitted',providerId:'555001'})).status,200);
    assert.equal((await get()).providerId,'555001'); assert.equal((await get()).state,'submitted');
    console.log('PASS: crash recovery reconciles the original reference; failed result storage does not lose intent; late results persist.');
    const changed = structuredClone(body); changed.sourceUpdatedAt='2026-10-27T12:30:00Z';
    changed.snapshot.shipping.address1='Changed synthetic address'; changed.sourceDigest=hash({snapshot:changed.snapshot,issues:[],stop:false});
    assert.equal((await request(changed)).status,200);
    assert.equal((await get()).state,'hold'); assert.equal((await get()).providerId,'555001');
    assert.equal((await request(body)).status,200); assert.equal((await get()).state,'hold');
    assert.equal((await request({op:'erase',orderKey,confirmErase:true})).body.externalDeletionRequired,true);
    assert.equal((await get()).snapshot,null);
    assert.equal((await request(changed)).status,200); assert.equal((await get()).snapshot,null);
    console.log('PASS: edits after submission hold the record; privacy erasure cannot be undone by webhook replay.');

    const event = (id,snapshotOverride={}) => {
      const snapshot = {...structuredClone(body.snapshot),orderId:id,...snapshotOverride};
      return {...body,orderId:id,snapshot,sourceDigest:hash({snapshot,issues:[],stop:false})};
    };
    const beforePayment = await request({op:'capture',shop:body.shop,orderId:'8002',stop:true});
    assert.equal((await request(event('8002'))).status,200);
    assert.equal((await get(beforePayment.body.orderKey)).state,'hold');
    const editable = event('8003'); const editableKey=(await request(editable)).body.orderKey;
    const removal=event('8003',{lines:[]}); removal.sourceUpdatedAt='2026-10-27T13:00:00Z';
    assert.equal((await request(removal)).status,200); assert.equal((await get(editableKey)).state,'hold');
    assert.equal((await get(editableKey)).stopRequested,true);
    assert.equal((await request(editable)).status,200); assert.equal((await get(editableKey)).state,'hold');
    console.log('PASS: cancellation/refund before payment and removing all personalized lines cannot be restored by delayed events.');

    const retryable=event('8004'),retryKey=(await request(retryable)).body.orderKey;
    const revision=event('8004',{totalPaise:39900}); revision.sourceUpdatedAt='2026-10-27T14:00:00Z';
    const stopTransaction=app.db.lifecycles.subscribe({models:['api::pod-order.pod-order'],beforeUpdate(event){
      if(event.params.data.sourceDigest===revision.sourceDigest)throw new Error('synthetic transaction failure');
    }});
    assert.equal((await request(revision)).status,503);
    assert.equal((await get(retryKey)).sourceDigest,retryable.sourceDigest); stopTransaction();
    assert.equal((await request(revision)).status,200); assert.equal((await get(retryKey)).sourceDigest,revision.sourceDigest);
    const queued=(await request({op:'claim'})).body.order;
    assert.equal(queued.shopifyOrderId,'8004');
    const queuedLease={orderKey:queued.orderKey,leaseToken:queued.leaseToken};
    assert.equal((await request({...queuedLease,op:'intent',sourceDigest:revision.sourceDigest,requestDigest:'c'.repeat(64)})).status,200);
    assert.equal((await request({op:'capture',shop:body.shop,orderId:'8004',stop:true})).status,200);
    assert.equal((await request({...queuedLease,op:'submitted',providerId:'555004'})).status,200);
    assert.equal((await get(retryKey)).state,'hold'); assert.equal((await get(retryKey)).providerId,'555004');
    console.log('PASS: failed capture transactions return failure and retain previous state; cancellation during POST still saves the provider ID while held.');

    const fulfillEvent=event('8005'),fulfillKey=(await request(fulfillEvent)).body.orderKey;
    const fulfillClaim=(await request({op:'claim'})).body.order;
    const fulfillLease={orderKey:fulfillKey,leaseToken:fulfillClaim.leaseToken};
    assert.equal((await request({...fulfillLease,op:'intent',sourceDigest:fulfillEvent.sourceDigest,requestDigest:'d'.repeat(64)})).status,200);
    assert.equal((await request({...fulfillLease,op:'submitted',providerId:'555005'})).status,200);
    await app.db.query('api::pod-order.pod-order').update({where:{id:fulfillClaim.id},data:{nextRunAt:new Date(Date.now()-1000).toISOString()}});
    const shipClaim=(await request({op:'claim'})).body.order;
    const shipLease={orderKey:fulfillKey,leaseToken:shipClaim.leaseToken};
    assert.equal((await request({...shipLease,op:'fulfillment-intent',sourceDigest:fulfillEvent.sourceDigest,tracking:{number:'SYNTHETIC1',url:'https://tracking.example.test/1',company:'Synthetic'}})).status,200);
    await app.db.query('api::pod-order.pod-order').update({where:{id:fulfillClaim.id},data:{leaseUntil:new Date(Date.now()-1000).toISOString()}});
    assert.equal((await request({op:'claim'})).body.order.state,'fulfillment_reconcile');
    assert.equal((await request({...shipLease,op:'fulfilled',fulfillmentId:'gid://shopify/Fulfillment/55'})).status,200);
    assert.equal((await get(fulfillKey)).state,'fulfilled');
    console.log('PASS: fulfillment intent survives a crash and the original worker can persist its returned fulfillment ID.');
    assert.equal((await fetch(base+'/pod-orders')).status,404);
    const ordinary=event('8006',{lines:[]});
    assert.equal((await request(ordinary)).body.ignored,true);
    const bad=await request({op:'capture',shop:body.shop,orderId:'8006',snapshot:{shipping:{phone:'PRIVATE-MARKER'}}});
    assert.equal(bad.status,400); assert.equal(JSON.stringify(bad.body).includes('PRIVATE-MARKER'),false);
    const quick=event('8008'),quickKey=(await request(quick)).body.orderKey;
    const paidUpdate=event('8008',{totalPaise:39900});
    assert.equal((await request(paidUpdate)).status,200);
    assert.equal((await get(quickKey)).state,'queued');
    assert.equal((await get(quickKey)).sourceDigest,paidUpdate.sourceDigest);
    await request({op:'capture',shop:body.shop,orderId:'8008',stop:true});
    console.log('PASS: no public CRUD or customer data in error responses. Generic POD database suite complete.');
    await require('./pod-admin-regression.cjs')(app,base,jwt,broad);
  } finally {
    if (before === undefined) delete process.env.POD_RELAY_SECRET; else process.env.POD_RELAY_SECRET = before;
  }
};
