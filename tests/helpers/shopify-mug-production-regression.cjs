'use strict';
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { fixture, settings } = require('./shopify-mug-fixture.cjs');
const O = 'api::shopify-mug-order.shopify-mug-order'; const J = 'api::mug-job.mug-job';
module.exports = async (app, base, jwt, intakeToken) => {
  const values = { SHOPIFY_MUG_MERCHANT_IDS: '7,8', MUG_ARTIFACT_ENCRYPTION_KEY: '11'.repeat(32), MUG_LIVE_SUBMISSION_ENABLED: 'false',
    MUG_FIRST_ORDER_ALLOWLIST: '982080', MUG_NATIVE_DUPLICATION_VERIFIED: 'true', MUG_NATIVE_DUPLICATION_EVIDENCE: 'synthetic-operator-evidence', MUG_PRINT_CONTRACT_VERIFIED: 'true' };
  const previous = Object.fromEntries(Object.keys(values).map(k => [k,process.env[k]])); Object.assign(process.env, values);
  const tokens = {};
  for (const op of ['review','work']) tokens[op] = (await app.admin.services['api-token'].create({ name: 'mug-' + op, type: 'custom', lifespan: null,
    permissions: ['api::shopify-mug-order.shopify-mug-order.' + op] })).accessKey;
  const request = async (route, body, token) => {
    const response = await fetch(base + '/shopify-mug-orders/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (token || tokens[route]), 'X-Mug-Relay-Secret': settings.SHOPIFY_MUG_RELAY_SECRET }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('review', { op:'list', actorId:7 }, jwt)).status, 403);
    assert.equal((await request('review', { op:'list', actorId:7 }, intakeToken)).status, 403);
    assert.equal((await request('review', { op:'list', actorId:9 })).status, 403);
    const event = fixture(); event.payload.id = 982080;
    assert.equal((await request('intake', event, intakeToken)).status, 200);
    const row = await app.db.query(O).findOne({ where: { shopifyOrderId: '982080' } });
    const common = { actorId:7, orderKey:row.orderKey, revision:row.revision };
    const approve = { ...common, op:'approve', confirmPhotoAndPreview:true, confirmFrontOnly:true, confirmReverseBlank:true };
    assert.equal((await request('review', approve)).status, 409);
    const artwork = (await sharp({ create: { width:2550,height:1050,channels:3,background:'white' } }).png().toBuffer()).toString('base64');
    const preview = (await sharp({ create: { width:100,height:100,channels:3,background:'white' } }).png().toBuffer()).toString('base64');
    assert.equal((await request('review', { ...common, op:'prepare', assets:[{lineId:'982002',artwork,preview}] })).status, 200);
    assert.equal((await request('review', approve)).status, 200);
    assert.equal((await request('review', {...approve,actorId:8})).status, 200);
    assert.equal(await app.db.query(J).count({ where:{orderKey:row.orderKey} }), 1);
    const claims = await Promise.all([request('work',{op:'claim'}),request('work',{op:'claim'})]);
    const winners = claims.filter(x => x.body.job?.shopifyOrderId === '982080');
    assert.equal(winners.length,1);
    const job = winners[0].body.job;
    const lease = { jobKey:job.jobKey, leaseToken:job.leaseToken };
    assert.equal((await request('work',{...lease,op:'intent',requestDigest:'a'.repeat(64)})).status,409);
    process.env.MUG_LIVE_SUBMISSION_ENABLED='true';
    process.env.SHOPIFY_MUG_MERCHANT_IDS='7';
    assert.equal((await request('work',{...lease,op:'intent',requestDigest:'a'.repeat(64)})).status,409);
    process.env.SHOPIFY_MUG_MERCHANT_IDS='7,8';
    assert.equal((await request('work',{...lease,op:'intent',requestDigest:'a'.repeat(64)})).status,200);
    assert.equal((await request('work',{...lease,op:'intent',requestDigest:'a'.repeat(64)})).status,409);
    // Simulate a crash after durable intent. A later claim is reconciliation only.
    await app.db.query(J).update({where:{id:job.id},data:{leaseUntil:new Date(Date.now()-1000).toISOString()}});
    const recovered = (await request('work',{op:'claim'})).body.job;
    assert.equal(recovered.state,'reconcile');
    assert.equal(recovered.reference,job.reference);
    assert.equal((await request('work',{jobKey:job.jobKey,leaseToken:recovered.leaseToken,op:'intent',requestDigest:'a'.repeat(64)})).status,409);
    const stopOutcome = app.db.lifecycles.subscribe({ models:[J], beforeUpdate(event) {
      if(event.params.data.providerId) throw new Error('synthetic-storage-failure');
    } });
    assert.equal((await request('work',{...lease,op:'submitted',providerId:'123456789'})).status,503);
    assert.equal((await app.db.query(J).findOne({where:{id:job.id}})).state,'reconcile');
    assert.equal((await app.db.query(J).findOne({where:{id:job.id}})).providerId,null);
    stopOutcome();
    assert.equal((await request('work',{...lease,op:'submitted',providerId:'123456789'})).status,200);
    const stored = await app.db.query(J).findOne({where:{id:job.id}});
    assert.equal(stored.providerId,'123456789');
    event.topic='orders/updated'; event.payload.updated_at='2026-10-25T19:00:00Z'; event.payload.line_items[0].quantity=2;
    assert.equal((await request('intake',event,intakeToken)).status,200);
    const held = await app.db.query(O).findOne({where:{id:row.id}});
    assert.equal(held.productionHold,true); assert.equal(held.approval,null);
    assert.equal((await app.db.query(J).findOne({where:{id:job.id}})).state,'hold');
    assert.equal((await request('review',{...approve,revision:held.revision})).status,409);
    const artifactRows = await app.db.query('api::mug-artifact.mug-artifact').findMany();
    assert.ok(artifactRows.length); assert.ok(artifactRows.every(a => !a.encryptedBytes.includes(artwork)));
    const erased = await request('review',{actorId:7,op:'erase',orderKey:row.orderKey,revision:held.revision,confirmErase:true});
    assert.equal(erased.status,200); assert.equal(erased.body.externalDeletionRequired,true);
    assert.equal(await app.db.query('api::mug-artifact.mug-artifact').count(),0);
    assert.deepEqual((await app.db.query(O).findOne({where:{id:row.id}})).snapshot,{orderId:'982080',lines:[]});
    assert.equal((await request('intake',{...event,deliveryId:'after-erasure-replay',payload:{...event.payload,updated_at:'2026-10-25T20:00:00Z'}},intakeToken)).status,200);
    assert.deepEqual((await app.db.query(O).findOne({where:{id:row.id}})).snapshot,{orderId:'982080',lines:[]});
    console.log('PASS: privacy erasure clears local personal data, flags external deletion and prevents replay restoration.');
    console.log('PASS: real approval, private immutable assets, duplicate approval, atomic claim, default-off intent, crash reconciliation and post-submission edit hold.');
  } finally {
    for(const [k,v] of Object.entries(previous)) { if(v===undefined)delete process.env[k];else process.env[k]=v; }
  }
};
