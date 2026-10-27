'use strict';
// Only imported by the disposable full-stack launcher. No production startup calls this.
module.exports = async (app, users, frontendOrigin) => {
 const settings = { SHOPIFY_MUG_INTAKE_ENABLED:'true', SHOPIFY_MUG_SHOP_DOMAIN:'fixture-shop.myshopify.com',
  SHOPIFY_MUG_PRODUCT_ID:'8888123', SHOPIFY_MUG_VARIANT_ID:'50934024241209', SHOPIFY_MUG_ASSET_HOSTS:'assets.example.test',
  SHOPIFY_MUG_RELAY_SECRET:'regression-mug-relay-secret-at-least-32-characters', SHOPIFY_MUG_MERCHANT_IDS:String(users.admin.id),
  MUG_ARTIFACT_ENCRYPTION_KEY:'11'.repeat(32), MUG_LIVE_SUBMISSION_ENABLED:'false' };
 Object.assign(process.env,settings);
 const env={...settings}; delete env.MUG_ARTIFACT_ENCRYPTION_KEY;
 for(const [action,name] of [['intake','SHOPIFY_MUG_CMS_TOKEN'],['review','MUG_REVIEW_CMS_TOKEN'],['work','MUG_WORKER_CMS_TOKEN']]){
  env[name]=(await app.admin.services['api-token'].create({name:'regression-mug-'+action,type:'custom',lifespan:null,
   permissions:['api::shopify-mug-order.shopify-mug-order.'+action]})).accessKey;
 }
 return {...env,SHOPIFY_APP_CLIENT_ID:'regression-shopify-app',SHOPIFY_APP_CLIENT_SECRET:'regression-shopify-app-signing-secret',
  SHOPIFY_MUG_APP_URL:frontendOrigin,MUG_ASSET_SIGNING_SECRET:'regression-mug-asset-signing-secret-32-chars',
  MUG_PROVIDER_ASSET_ORIGIN:frontendOrigin,MUG_WORKER_SECRET:'regression-mug-worker-secret-at-least-32-characters'};
};
