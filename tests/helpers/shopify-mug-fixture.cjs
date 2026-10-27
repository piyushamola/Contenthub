'use strict';

exports.settings = {
  SHOPIFY_MUG_INTAKE_ENABLED: 'true', SHOPIFY_MUG_SHOP_DOMAIN: 'fixture-shop.myshopify.com',
  SHOPIFY_MUG_PRODUCT_ID: '8888123', SHOPIFY_MUG_VARIANT_ID: '50934024241209', SHOPIFY_MUG_ASSET_HOSTS: 'assets.example.test',
  SHOPIFY_MUG_RELAY_SECRET: 'fixture-only-relay-secret-at-least-32-characters',
};
exports.fixture = function fixture() {
  return { shop: exports.settings.SHOPIFY_MUG_SHOP_DOMAIN, topic: 'orders/paid', deliveryId: 'fixture-delivery-01',
    payload: { id: 982001, name: '#fixture-mug', updated_at: '2026-10-25T12:00:00Z',
      test: false, financial_status: 'paid', currency: 'INR', presentment_currency: 'INR',
      total_price: '398.00', cancelled_at: null, refunds: [], email: 'fixture@example.test',
      shipping_address: { first_name: 'Fixture', last_name: 'Recipient', address1: 'Synthetic address',
        city: 'Bengaluru', zip: '560001', province: 'Karnataka', country_code: 'IN', phone: '9999900001' },
      line_items: [{ id: 982002, product_id: 8888123, variant_id: 50934024241209, sku: 'WHB-CUSTOM-MUG-11OZ',
        quantity: 1, fulfillable_quantity: 1, price: '349.00', total_discount: '0.00', fulfillment_status: null,
        properties: [{ name: '_whb_personalized', value: 'mug-front-v1' },
          { name: 'Design approved', value: 'Yes' }, { name: 'Print placement', value: 'Front only' },
          { name: 'Design ID', value: 'Mfixture001' }, { name: 'Message', value: 'Happy birthday' },
          { name: 'Print artwork', value: 'https://assets.example.test/flat.png' },
          { name: 'Approved preview', value: 'https://assets.example.test/preview.png' }] }] } };
};
