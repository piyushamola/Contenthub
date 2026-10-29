'use strict';
const UID='api::pod-order.pod-order';
const actions=['read','notes','operate'];
module.exports={
  register({strapi}){
    // Hidden Content Manager schemas must not become a raw editing bypass.
    strapi.server.use(async(ctx,next)=>{
      let path;try{path=decodeURIComponent(ctx.path);}catch{return ctx.badRequest('Invalid path');}
      if(path.startsWith('/content-manager/')&&['api::pod-order.pod-order','api::pod-order-audit.pod-order-audit'].some(uid=>path.includes(uid)))return ctx.forbidden('Use the POD orders admin view');
      return next();
    });
  },
  async bootstrap({strapi}){
    await strapi.admin.services.permission.actionProvider.registerMany(actions.map(uid=>({section:'plugins',displayName:{read:'View POD orders',notes:'Edit internal notes',operate:'Pause, validate and correct orders'}[uid],uid,pluginName:'pod-orders'})));
    // Additive metadata backfill only. References, states, leases, snapshots and
    // provider/fulfillment history are never regenerated.
    for(;;){const rows=await strapi.db.query(UID).findMany({where:{paymentMode:{$null:true}},limit:200});if(!rows.length)break;
      for(const row of rows)await strapi.db.query(UID).update({where:{id:row.id,paymentMode:{$null:true}},data:{
        orderNumber:row.snapshot?.orderNumber||row.shopifyOrderId,paymentMode:row.snapshot?.paymentMode||(row.snapshot?'prepaid':'unknown'),
        totalPaise:row.snapshot?.totalPaise||0,codCollectiblePaise:row.snapshot?.amounts?.codCollectiblePaise||0}});
    }
  },
  routes:{admin:{type:'admin',routes:[
    {method:'GET',path:'/orders',handler:'orders.list',config:{policies:['admin::isAuthenticatedAdmin',{name:'admin::hasPermissions',config:{actions:['plugin::pod-orders.read']}}]}},
    {method:'GET',path:'/orders/:id',handler:'orders.get',config:{policies:['admin::isAuthenticatedAdmin',{name:'admin::hasPermissions',config:{actions:['plugin::pod-orders.read']}}]}},
    ...['notes','pause','resume','correct'].map(action=>({method:'POST',path:`/orders/:id/${action}`,handler:`orders.${action}`,config:{policies:['admin::isAuthenticatedAdmin',
      {name:'admin::hasPermissions',config:{actions:['plugin::pod-orders.read',`plugin::pod-orders.${action==='notes'?'notes':'operate'}`]}}]}})),
  ]}},
  controllers:{orders:({strapi})=>{
    const service=()=>strapi.service(UID);
    const reply=async(ctx,fn)=>{ctx.set('Cache-Control','no-store');try{ctx.body=await fn();}catch(error){
      ctx.status=error.message==='invalid_request'?400:error.message==='state_conflict'?409:503;
      ctx.body={error:ctx.status===400?'Invalid order action':ctx.status===409?'Order changed or action is locked':'Order action unavailable'};
    }};
    return {list:ctx=>reply(ctx,()=>service().adminList(ctx.query)),get:ctx=>reply(ctx,()=>service().adminGet(ctx.params.id)),
      ...Object.fromEntries(['notes','pause','resume','correct'].map(action=>[action,ctx=>reply(ctx,()=>service().adminAction(ctx.params.id,action,ctx.request.body,ctx.state.user.id))]))};
  }},
};
