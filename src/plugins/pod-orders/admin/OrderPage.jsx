import React,{useEffect,useState} from 'react';
import {Page,useFetchClient,useRBAC} from '@strapi/strapi/admin';
const scopes={read:[{action:'plugin::pod-orders.read',subject:null}],notes:[{action:'plugin::pod-orders.notes',subject:null}],operate:[{action:'plugin::pod-orders.operate',subject:null}]};
const states=['ignored','queued','paused','validating','intent','reconcile','submitted','fulfillment_intent','fulfillment_reconcile','fulfilled','hold'];
const money=value=>'₹'+(Number(value)/100).toFixed(2);
const date=value=>value?new Date(value).toLocaleString():'—';
const control={padding:'8px',border:'1px solid #888',borderRadius:4,color:'inherit',background:'transparent'};
function Orders(){
  const client=useFetchClient(),{allowedActions}=useRBAC(scopes);
  const [filters,setFilters]=useState({search:'',state:'',paymentMode:'',from:'',to:''}),[page,setPage]=useState(1);
  const [result,setResult]=useState({orders:[],pagination:{total:0,pageCount:0}}),[selected,setSelected]=useState(null);
  const [notes,setNotes]=useState(''),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [correction,setCorrection]=useState({lineId:'',key:'',artworkUrl:'',previewUrl:''});
  async function load(){try{const {data}=await client.get('/pod-orders/orders?'+new URLSearchParams({...filters,page:String(page)}));setResult(data);}catch{setMessage('Cannot load orders. Check your admin permissions.');}}
  useEffect(()=>{void load();},[page,filters]);
  async function open(id){try{const {data}=await client.get('/pod-orders/orders/'+id);setSelected(data);setNotes(data.adminNotes);setReason('');setCorrection({lineId:'',key:'',artworkUrl:'',previewUrl:''});}catch{setMessage('Cannot open this order.');}}
  async function action(name,extra={}){setBusy(true);setMessage('');try{
    await client.post(`/pod-orders/orders/${selected.id}/${name}`,{revision:selected.revision,reason,...extra});
    await open(selected.id);await load();setMessage(name==='resume'?'Validation requested. Run the worker to validate; a later run may submit.':'Saved.');
  }catch(error){setMessage(error.response?.status===409?'Order changed or action is locked. Reopen the order.':'Action rejected. Check inputs, permissions and order eligibility.');}finally{setBusy(false);}}
  const field=(name,label,type='text')=><label>{label}<input aria-label={label} type={type} style={control} value={filters[name]} onChange={e=>{setPage(1);setFilters({...filters,[name]:e.target.value});}}/></label>;
  return <main style={{padding:32,maxWidth:1600}}>
    <h1>POD orders</h1><p>Shopify owns payment, totals, products, quantities and delivery details. Correct those in Shopify.</p>
    <form onSubmit={e=>e.preventDefault()} style={{display:'flex',gap:12,flexWrap:'wrap',margin:'20px 0'}}>
      {field('search','Search order number or ID')}
      <label>State<select aria-label="State" style={control} value={filters.state} onChange={e=>{setPage(1);setFilters({...filters,state:e.target.value});}}><option value="">All states</option>{states.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Payment mode<select aria-label="Payment mode" style={control} value={filters.paymentMode} onChange={e=>{setPage(1);setFilters({...filters,paymentMode:e.target.value});}}><option value="">All modes</option>{['prepaid','cod','unknown'].map(s=><option key={s}>{s}</option>)}</select></label>
      {field('from','From','date')}{field('to','To','date')}<button style={control} onClick={load}>Refresh</button>
    </form>
    <p role="status">{message}</p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',textAlign:'left'}}><thead><tr>
      {['Shopify order','Created / updated','Payment','Value / COD collect','State','Qikink ID / status','AWB','Reason','Notes'].map(s=><th key={s} style={{padding:8}}>{s}</th>)}
    </tr></thead><tbody>{result.orders.map(o=><tr key={o.id} style={{borderTop:'1px solid #888'}}>
      <td style={{padding:8}}><button style={control} onClick={()=>open(o.id)}>{o.orderNumber}</button><small style={{display:'block'}}>{o.shopifyOrderId}</small></td>
      <td>{date(o.createdAt)}<br/>{date(o.updatedAt)}</td><td>{o.paymentMode}</td><td>{money(o.totalPaise)} / {money(o.codCollectiblePaise)}</td>
      <td>{o.state}</td><td>{o.providerId||'—'}<br/>{o.providerStatus||'—'}</td><td>{o.awb||'—'}</td>
      <td>{o.reason||'—'}<br/>{o.issues.join(', ')}</td><td>{o.adminNotes.slice(0,100)}</td>
    </tr>)}</tbody></table></div>
    {!result.orders.length&&<p>No orders match these filters.</p>}
    <nav aria-label="Pagination" style={{display:'flex',gap:12,margin:'20px 0'}}><button style={control} disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button>
      <span>Page {page} of {result.pagination.pageCount||1} · {result.pagination.total} orders</span><button style={control} disabled={page>=result.pagination.pageCount} onClick={()=>setPage(page+1)}>Next</button></nav>
    {selected&&<section aria-label="Order details" style={{border:'1px solid #888',padding:24,borderRadius:8}}>
      <h2>{selected.orderNumber} · {selected.state}</h2><a href={selected.shopifyUrl} target="_blank" rel="noopener noreferrer">Open order in Shopify to correct payment, totals, products, quantities or delivery</a>
      <p>Reason: {selected.reason||'None'} {selected.issues.join(', ')}</p>
      <label style={{display:'block'}}>Reason for change<input aria-label="Reason for change" style={control} value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label>
      {allowedActions.canNotes&&<div><label>Internal notes<textarea aria-label="Internal notes" style={{...control,width:'100%'}} maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)}/></label><button style={control} disabled={busy||reason.trim().length<3} onClick={()=>action('notes',{notes})}>Save notes</button></div>}
      {allowedActions.canOperate&&selected.editable&&<div style={{marginTop:20}}>
        {['queued','validating'].includes(selected.state)&&<button style={control} disabled={busy||reason.trim().length<3} onClick={()=>action('pause')}>Pause order</button>}
        {selected.state==='paused'&&<button style={control} disabled={busy||reason.trim().length<3||selected.issues.length>0} onClick={()=>action('resume')}>Resume through validation</button>}
        <h3>Correct artwork links before submission</h3><p>The worker checks the trusted host, image bytes and dimensions, then re-reads Shopify before queueing. Shipping corrections belong in Shopify.</p>
        <label>Placement<select aria-label="Placement" style={control} value={correction.lineId+'/'+correction.key} onChange={e=>{
          const [lineId,key]=e.target.value.split('/');const design=selected.lines.find(l=>l.id===lineId)?.designs.find(d=>d.key===key);
          setCorrection({lineId,key,artworkUrl:design?.artworkUrl||'',previewUrl:design?.previewUrl||''});
        }}><option value="/">Choose a placement</option>{selected.lines.flatMap(l=>l.designs.map(d=><option key={l.id+'/'+d.key} value={l.id+'/'+d.key}>{l.sku} · line {l.id} · {d.key}</option>))}</select></label>
        {['artworkUrl','previewUrl'].map(key=><label key={key} style={{display:'block'}}>{key}<input aria-label={key} style={{...control,width:'100%'}} type="url" value={correction[key]} maxLength={512} onChange={e=>setCorrection({...correction,[key]:e.target.value})}/></label>)}
        <button style={control} disabled={busy||reason.trim().length<3||!correction.lineId||selected.issues.length>0} onClick={()=>action('correct',correction)}>Save correction and pause</button>
      </div>}
      {!selected.editable&&<p>Fulfillment edits are locked. Existing submission intent/provider history must be reconciled; this screen cannot force a retry.</p>}
      <h3>Audit history</h3><ul>{selected.audit.map(a=><li key={a.id}>{date(a.createdAt)} · Admin {a.actorId} · {a.action} · {a.reason}</li>)}</ul>
    </section>}
  </main>;
}
export default function OrderPage(){return <Page.Protect permissions={scopes.read}><Orders/></Page.Protect>;}
