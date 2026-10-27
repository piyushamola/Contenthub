'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { approvalBinding } = require('../src/api/shopify-mug-order/utils/production');

test('approval binds both immutable images to the current order revision', () => {
  const order = { orderKey: 'order-key', revision: 3, sourceDigest: 'source-hash', stopRequested: false, issues: [],
    snapshot: { lines: [{ lineId: '12', quantity: 1 }] }, artifacts: { '12': { artwork: 'a'.repeat(64), preview: 'b'.repeat(64) } } };
  const result = approvalBinding(order, 3, '7');
  assert.equal(result.revision, 3); assert.equal(result.lines[0].artwork, 'a'.repeat(64));
  assert.equal(result.lines[0].preview, 'b'.repeat(64)); assert.equal(result.merchantId, '7');
  assert.throws(() => approvalBinding(order, 2, '7'), /stale_revision/);
  assert.throws(() => approvalBinding({ ...order, stopRequested: true }, 3, '7'), /order_held/);
  assert.throws(() => approvalBinding({ ...order, artifacts: null }, 3, '7'), /assets_required/);
});


test('underpaid order totals cannot be approved as a valid retail order',()=>{
 const {prepareIntake}=require('../src/api/shopify-mug-order/utils/intake');
 const {fixture,settings}=require('./helpers/shopify-mug-fixture.cjs');
 const event=fixture();event.payload.total_price='348.00';
 assert.ok(prepareIntake(event,settings).issues.includes('invalid_order_total'));
});


test('two authorized merchants approving identical evidence share one submission identity',()=>{
 const order={orderKey:'key',revision:1,sourceDigest:'source',issues:[],snapshot:{lines:[{lineId:'12',quantity:1}]},
  artifacts:{'12':{artwork:'a'.repeat(64),preview:'b'.repeat(64)}}};
 assert.equal(approvalBinding(order,1,'7').digest,approvalBinding(order,1,'8').digest);
});
