'use strict';
// Synthetic configuration, loaded only by the disposable regression server.
module.exports = async (app, origin) => {
  const secret='synthetic-pod-relay-secret-at-least-32-characters';
  process.env.POD_RELAY_SECRET=secret;
  const token=(await app.admin.services['api-token'].create({name:'pod-stack-private',type:'custom',lifespan:null,
    permissions:['api::pod-order.pod-order.state']})).accessKey;
  const placement={key:'front',placementSku:'fr',providerPlacement:'Front',widthInches:8.5,heightInches:3.5,pixelWidth:2550,pixelHeight:1050,artworkProperty:'Print artwork',previewProperty:'Approved preview'};
  const apparel={key:'front',placementSku:'fr',providerPlacement:'Front',widthInches:12,heightInches:16,pixelWidth:3600,pixelHeight:4800,artworkProperty:'Front artwork',previewProperty:'Front preview'};
  return {SHOPIFY_POD_ENABLED:'true',SHOPIFY_SHOP_DOMAIN:'fixture.myshopify.com',SHOPIFY_APP_CLIENT_ID:'synthetic-app',
    SHOPIFY_APP_CLIENT_SECRET:'synthetic-signing-secret',SHOPIFY_APP_URL:origin,POD_RELAY_SECRET:secret,POD_CMS_TOKEN:token,
    POD_WORKER_SECRET:'synthetic-worker-secret-at-least-32-characters',POD_ASSET_HOSTS:'assets.example.test',
    QIKINK_PRODUCTS_JSON:JSON.stringify([{variantId:'101',sku:'SYNTHETIC-MUG',printTypeId:5,placements:[placement]},
      {variantId:'102',sku:'SYNTHETIC-TEE-BLACK-M',printTypeId:1,placements:[apparel,{...apparel,key:'back',placementSku:'bk',providerPlacement:'Back',widthInches:10,heightInches:12,pixelWidth:3000,pixelHeight:3600,artworkProperty:'Back artwork',previewProperty:'Back preview'}]}])};
};
