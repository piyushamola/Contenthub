'use strict';
const {createHash}=require('node:crypto');
const UID='api::pod-order.pod-order';
const summary=value=>({length:String(value||'').length,sha256:createHash('sha256').update(String(value||'')).digest('hex')});
const fail=(message='invalid_request')=>{throw new Error(message);};
const url=value=>{try{const u=new URL(value);return typeof value==='string'&&value.length<=512&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.hostname.includes('.')&&!/[\s\u0000-\u001f]/.test(value);}catch{return false;}};
const amounts=row=>({orderNumber:row.orderNumber||row.snapshot?.orderNumber||row.shopifyOrderId,
  paymentMode:row.paymentMode||row.snapshot?.paymentMode||(row.snapshot?.financialStatus==='paid'?'prepaid':'unknown'),
  totalPaise:Number(row.totalPaise??row.snapshot?.totalPaise??0),codCollectiblePaise:Number(row.codCollectiblePaise??row.snapshot?.amounts?.codCollectiblePaise??0)});
function view(row){return {id:row.id,shopifyOrderId:row.shopifyOrderId,...amounts(row),createdAt:row.createdAt,updatedAt:row.updatedAt,
  state:row.state,providerId:row.providerId,providerStatus:row.providerStatus,awb:row.tracking?.number||null,
  reason:row.reason,issues:row.issues||[],adminNotes:row.adminNotes||'',revision:row.adminRevision||0,
  shopifyUrl:`https://${row.shop}/admin/orders/${row.shopifyOrderId}`};}
module.exports=({strapi,locked})=>{
  const query=()=>strapi.db.query(UID);
  async function get(id){if(!/^[1-9][0-9]*$/.test(String(id)))fail();const row=await query().findOne({where:{id:Number(id)}});if(!row)fail('state_conflict');return row;}
  return {
    async adminList(input={}){
      const page=Number(input.page||1),pageSize=Number(input.pageSize||20);
      if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail();
      const where={};
      if(input.state){if(!strapi.contentType(UID).attributes.state.enum.includes(input.state))fail();where.state=input.state;}
      if(input.paymentMode){if(!['prepaid','cod','unknown'].includes(input.paymentMode))fail();
        where.$or=[{paymentMode:input.paymentMode},...(input.paymentMode==='prepaid'?[{paymentMode:{$null:true},snapshot:{$notNull:true}}]:[])];}
      for(const [key,op] of [['from','$gte'],['to','$lte']])if(input[key]){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(input[key])||!Number.isFinite(Date.parse(input[key]))||new Date(input[key]).toISOString().slice(0,10)!==input[key])fail();
        where.createdAt={...where.createdAt,[op]:input[key]+(key==='from'?'T00:00:00.000Z':'T23:59:59.999Z')};}
      if(input.search){const search=String(input.search);if(!/^[#A-Za-z0-9 _-]{1,80}$/.test(search))fail();
        where.$and=[{$or:[{shopifyOrderId:{$contains:search}},{orderNumber:{$contains:search}},{providerId:{$contains:search}}]}];}
      const [rows,total]=await Promise.all([query().findMany({where,orderBy:{id:'desc'},offset:(page-1)*pageSize,limit:pageSize}),query().count({where})]);
      return {orders:rows.map(view),pagination:{page,pageSize,total,pageCount:Math.ceil(total/pageSize)}};
    },
    async adminGet(id){const row=await get(id);return {...view(row),
      editable:!row.intentAt&&!row.providerId&&!row.stopRequested&&!row.erased,
      lines:row.erased?[]:(row.snapshot?.lines||[]).map(line=>({id:line.id,sku:line.product?.sku,quantity:line.quantity,
        designs:(line.designs||[]).map(d=>({key:d.key,artworkUrl:d.artworkUrl,previewUrl:d.previewUrl,
          ...(row.corrections||[]).find(c=>c.lineId===line.id&&c.key===d.key)}))})),
      audit:await strapi.db.query('api::pod-order-audit.pod-order-audit').findMany({where:{podOrderId:row.id},orderBy:{id:'desc'},limit:50,
        select:['id','actorId','action','reason','changes','createdAt']})};},
    async adminAction(id,action,body,actorId){
      if(!body||typeof body!=='object'||Array.isArray(body)||!['notes','pause','resume','correct'].includes(action))fail();
      const allowed=action==='correct'?['revision','reason','lineId','key','artworkUrl','previewUrl']:action==='notes'?['revision','reason','notes']:['revision','reason'];
      if(Object.keys(body).some(key=>!allowed.includes(key))||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>300||
        !Number.isInteger(body.revision)||!Number.isInteger(actorId))fail();
      const row=await get(id);
      return locked(row.orderKey,async current=>{
        if(body.revision!==(current.adminRevision||0))fail('state_conflict');
        const data={adminRevision:(current.adminRevision||0)+1};let changes={};
        if(action==='notes'){
          if(current.erased)fail('state_conflict');
          if(typeof body.notes!=='string'||body.notes.length>4000)fail();
          data.adminNotes=body.notes;changes={notes:{before:summary(current.adminNotes),after:summary(body.notes)}};
        }else{
          if(current.intentAt||current.providerId||current.stopRequested||current.erased)fail('state_conflict');
          if(action==='pause'){
            if(!['queued','validating'].includes(current.state))fail('state_conflict');
            Object.assign(data,{state:'paused',reason:'admin_paused'});
          }else if(action==='resume'){
            if(current.state!=='paused'||current.issues?.length||!current.snapshot?.lines?.length||current.snapshot.test!==false||
              !(current.snapshot.financialStatus==='paid'||current.snapshot.paymentMode==='cod'))fail('state_conflict');
            Object.assign(data,{state:'validating',reason:'admin_validation_pending',nextRunAt:new Date().toISOString()});
          }else{
            if(!['queued','paused','validating','hold'].includes(current.state)||current.issues?.length||!url(body.artworkUrl)||!url(body.previewUrl)||
              !current.snapshot?.lines?.some(line=>line.id===body.lineId&&line.designs?.some(d=>d.key===body.key)))fail();
            const correction={lineId:body.lineId,key:body.key,artworkUrl:body.artworkUrl,previewUrl:body.previewUrl};
            const previous=(current.corrections||[]).find(c=>c.lineId===body.lineId&&c.key===body.key);
            Object.assign(data,{state:'paused',reason:'admin_correction_pending',correctionSourceDigest:current.sourceDigest,
              corrections:[...(current.corrections||[]).filter(c=>c.lineId!==body.lineId||c.key!==body.key),correction]});
            changes.correction={lineId:body.lineId,key:body.key,before:previous?{artwork:summary(previous.artworkUrl),preview:summary(previous.previewUrl)}:null,
              after:{artwork:summary(body.artworkUrl),preview:summary(body.previewUrl)}};
          }
          Object.assign(data,{leaseToken:null,leaseUntil:null});changes.state={before:current.state,after:data.state};
        }
        const updated=await query().update({where:{id:current.id},data});
        await strapi.db.query('api::pod-order-audit.pod-order-audit').create({data:{podOrderId:current.id,actorId:String(actorId),action,reason:body.reason.trim(),changes}});
        return view(updated);
      });
    },
  };
};
