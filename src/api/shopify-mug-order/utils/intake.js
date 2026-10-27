'use strict';

const { createHash } = require('node:crypto');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const TOPICS = new Set(['orders/paid', 'orders/updated', 'orders/cancelled', 'refunds/create']);
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function id(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]{0,24}$/.test(value)) return value;
  throw new Error('invalid_event');
}
function text(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function paise(value) {
  if (typeof value !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
}
function asset(value, hosts) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !hosts.includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

/** Parse only a trusted relay event. Properties remain customer-controlled evidence. */
function prepareIntake(envelope, env) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(env.SHOPIFY_MUG_SHOP_DOMAIN || '')) throw new Error('configuration');
  if (!object(envelope) || envelope.shop !== env.SHOPIFY_MUG_SHOP_DOMAIN || !TOPICS.has(envelope.topic) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(envelope.deliveryId || '') || !object(envelope.payload)) throw new Error('invalid_event');
  if (!/^[1-9][0-9]{0,24}$/.test(env.SHOPIFY_MUG_VARIANT_ID || '')) throw new Error('configuration');
  if (Buffer.byteLength(JSON.stringify(envelope)) > 520 * 1024) throw new Error('invalid_event');
  if (!/^[1-9][0-9]{0,24}$/.test(env.SHOPIFY_MUG_PRODUCT_ID || '')) throw new Error('configuration');
  const payload = envelope.payload;
  const orderId = id(envelope.topic === 'refunds/create' ? payload.order_id : payload.id);
  const orderKey = hash(`${envelope.shop}/${orderId}`);
  // Body identity prevents a changed delivery header from defeating deduplication.
  const receiptKey = hash(`${orderKey}/${envelope.topic}/${JSON.stringify(payload)}`);
  const base = { orderKey, receiptKey, shopDomain: envelope.shop, shopifyOrderId: orderId,
    topic: envelope.topic, deliveryId: envelope.deliveryId };
  if (envelope.topic === 'refunds/create' || envelope.topic === 'orders/cancelled') {
    if (envelope.topic === 'orders/cancelled' && !payload.cancelled_at) throw new Error('invalid_event');
    return { ...base, stop: true, issues: [envelope.topic === 'refunds/create' ? 'refund_received' : 'cancelled'] };
  }
  if (!Array.isArray(payload.line_items) || payload.line_items.length > 500) throw new Error('invalid_event');
  const hosts = (env.SHOPIFY_MUG_ASSET_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  const lines = [];
  const lineEvidence = [];
  const issues = [];
  for (const line of payload.line_items) {
    if (!object(line)) throw new Error('invalid_event');
    const matchesVariant = String(line.variant_id) === env.SHOPIFY_MUG_VARIANT_ID;
    if (!matchesVariant && line.sku !== 'WHB-CUSTOM-MUG-11OZ') continue;
    if (!matchesVariant || line.sku !== 'WHB-CUSTOM-MUG-11OZ' || String(line.product_id) !== env.SHOPIFY_MUG_PRODUCT_ID) throw new Error('invalid_event');
    lineEvidence.push({ id: line.id, variant: line.variant_id, sku: line.sku, quantity: line.quantity,
      price: line.price, discount: line.total_discount, fulfillmentStatus: line.fulfillment_status,
      fulfillableQuantity: line.fulfillable_quantity, properties: line.properties });
    const props = new Map();
    if (!Array.isArray(line.properties) || line.properties.length > 100) issues.push('missing_design_properties');
    for (const prop of Array.isArray(line.properties) ? line.properties.slice(0, 100) : []) {
      if (!object(prop) || typeof prop.name !== 'string') { issues.push('invalid_design_property'); continue; }
      if (props.has(prop.name)) issues.push('duplicate_design_property');
      props.set(prop.name, prop.value);
    }
    const artworkUrl = asset(props.get('Print artwork'), hosts);
    const previewUrl = asset(props.get('Approved preview'), hosts);
    if (!artworkUrl || !previewUrl) issues.push('invalid_asset_link');
    if (props.get('_whb_personalized') !== 'mug-front-v1' || props.get('Design approved') !== 'Yes' ||
        props.get('Print placement') !== 'Front only') issues.push('missing_client_approval');
    const designId = props.get('Design ID');
    if (typeof designId !== 'string' || !/^[A-Za-z0-9_]{1,20}$/.test(designId)) issues.push('invalid_design_id');
    const message = props.get('Message');
    if (message !== undefined && (typeof message !== 'string' || message.length > 45)) issues.push('invalid_message');
    const quantity = line.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) issues.push('invalid_quantity');
    const unitPricePaise = paise(line.price);
    const discountPaise = paise(line.total_discount);
    if (unitPricePaise !== 34900 || discountPaise !== 0) issues.push('price_or_discount_review');
    if (line.fulfillment_status || (line.fulfillable_quantity !== undefined && line.fulfillable_quantity !== quantity)) issues.push('fulfillment_already_changed');
    lines.push({ lineId: id(line.id), variantId: text(String(line.variant_id), 25),
      quantity: Number.isInteger(quantity) ? quantity : 0, unitPricePaise, discountPaise,
      fulfillmentStatus: text(line.fulfillment_status, 40),
      fulfillableQuantity: Number.isInteger(line.fulfillable_quantity) ? line.fulfillable_quantity : null,
      approval: { personalized: text(props.get('_whb_personalized'), 40),
        approved: text(props.get('Design approved'), 20), placement: text(props.get('Print placement'), 40) },
      artworkUrl, previewUrl, designId: text(designId, 20), message: text(message, 45) });
  }
  const updatedAt = Date.parse(payload.updated_at);
  if (typeof payload.updated_at !== 'string' || !Number.isFinite(updatedAt)) throw new Error('invalid_event');
  if (!lines.length) {
    const snapshot = { orderId, lines: [] };
    return { ...base, irrelevant: true, snapshot, sourceDigest: hash(JSON.stringify(snapshot)),
      sourceUpdatedAt: new Date(updatedAt).toISOString(), stop: !!payload.cancelled_at ||
        (Array.isArray(payload.refunds) && payload.refunds.length > 0) ||
        ['refunded', 'partially_refunded', 'voided'].includes(payload.financial_status), issues: [] };
  }
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) issues.push('duplicate_line_id');
  if (payload.test !== false) issues.push('test_or_unknown_order');
  if (payload.financial_status !== 'paid') issues.push('payment_not_paid');
  if (payload.currency !== 'INR' || payload.presentment_currency !== 'INR') issues.push('unsupported_currency');
  if (payload.cancelled_at) issues.push('cancelled');
  if (Array.isArray(payload.refunds) && payload.refunds.length) issues.push('refund_received');
  if (paise(payload.total_price) === null || paise(payload.total_price) < lines.reduce((sum,line) => sum + (line.unitPricePaise || 0) * line.quantity, 0)) issues.push('invalid_order_total');
  if (payload.total_discounts !== undefined && paise(payload.total_discounts) !== 0) issues.push('price_or_discount_review');
  if (payload.total_outstanding !== undefined && paise(payload.total_outstanding) !== 0) issues.push('payment_not_paid');
  const address = object(payload.shipping_address) ? payload.shipping_address : {};
  if (address.country_code !== 'IN') issues.push('shipping_not_india');
  if (!/^[1-9][0-9]{5}$/.test(address.zip || '') || !address.address1 || !address.city || !address.first_name) issues.push('incomplete_shipping');
  const email = payload.email || payload.contact_email;
  const phone = address.phone || payload.phone;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof phone !== 'string' || !/^\+?[0-9 ()-]{10,20}$/.test(phone)) issues.push('incomplete_contact');
  const snapshot = { orderId, orderName: text(payload.name, 100), currency: text(payload.currency, 3),
    totalPaise: paise(payload.total_price), test: payload.test === false ? false : true,
    presentmentCurrency: text(payload.presentment_currency, 3), financialStatus: text(payload.financial_status, 40), lines,
    shipping: { first_name: text(address.first_name, 100), last_name: text(address.last_name, 100),
      address1: text(address.address1, 90), address2: text(address.address2, 90), city: text(address.city, 100),
      province: text(address.province, 100), zip: text(address.zip, 6), country_code: text(address.country_code, 2),
      phone: text(phone, 20), email: text(email, 254) } };
  return { ...base, snapshot, sourceDigest: hash(JSON.stringify({ snapshot, lineEvidence, address, email, phone,
      presentmentCurrency: payload.presentment_currency, issues: [...new Set(issues)].sort() })), sourceUpdatedAt: new Date(updatedAt).toISOString(),
    stop: !!payload.cancelled_at || (Array.isArray(payload.refunds) && payload.refunds.length > 0) ||
      ['refunded', 'partially_refunded', 'voided'].includes(payload.financial_status), issues: [...new Set(issues)] };
}

function transition(current, event) {
  const stale = current.sourceUpdatedAt && event.sourceUpdatedAt && Date.parse(event.sourceUpdatedAt) < Date.parse(current.sourceUpdatedAt);
  const removed = event.irrelevant && current.hasMug && !stale;
  const blocked = current.stopRequested || event.stop === true || removed;
  const issues = [...new Set([...(blocked ? current.issues || [] : []), ...event.issues, ...(removed ? ['mug_removed'] : [])])];
  // A cancellation/refund arriving first stays blocked after delayed paid events.
  if (!event.snapshot) return { stopRequested: blocked, reviewDecision: 'pending', reviewNotes: '',
    issues, lastTopic: event.topic };
  if (stale) return blocked ? { stopRequested: true, reviewDecision: 'pending', reviewNotes: '', issues, lastTopic: event.topic } : {};
  const changed = current.sourceDigest !== event.sourceDigest;
  if (changed && current.sourceUpdatedAt && Date.parse(current.sourceUpdatedAt) === Date.parse(event.sourceUpdatedAt)) {
    return { stopRequested: true, reviewDecision: 'pending', reviewNotes: '', lastTopic: event.topic,
      issues: [...new Set([...issues, 'source_version_conflict'])] };
  }
  return { snapshot: event.snapshot, sourceDigest: event.sourceDigest, sourceUpdatedAt: event.sourceUpdatedAt,
    hasMug: !event.irrelevant, stopRequested: blocked,
    issues,
    lastTopic: event.topic,
    ...(changed || blocked ? { reviewDecision: 'pending', reviewNotes: '' } : {}) };
}

module.exports = { prepareIntake, transition };
