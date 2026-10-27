'use strict';
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function approvalBinding(order, revision, merchantId) {
  if (revision !== order.revision) throw new Error('stale_revision');
  if (order.stopRequested || order.productionHold || order.issues?.length || !order.hasMug && order.hasMug !== undefined) throw new Error('order_held');
  const lines = order.snapshot?.lines;
  if (!Array.isArray(lines) || !lines.length) throw new Error('order_held');
  const approved = lines.map(line => {
    const asset = order.artifacts?.[line.lineId];
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.artwork) || !/^[a-f0-9]{64}$/.test(asset.preview)) throw new Error('assets_required');
    return { lineId: line.lineId, quantity: line.quantity, artwork: asset.artwork, preview: asset.preview };
  });
  const binding = { revision, sourceDigest: order.sourceDigest, merchantId, lines: approved };
  return { ...binding, digest: digest({ orderKey: order.orderKey, revision, sourceDigest: order.sourceDigest, lines: approved }) };
}
module.exports = { approvalBinding, digest };
