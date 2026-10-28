import { fail, transaction } from '../db/database.js';
import { columns } from '../db/schema.js';
import { workflows } from './workflows.js';
import { calculateDocument } from './calculations.js';
import { webhookInput } from './automations.js';

function ensureSeqTable(db){db.exec("CREATE TABLE IF NOT EXISTS _jobber_seq(name TEXT PRIMARY KEY,val INTEGER NOT NULL)");}
export function saveJobLineSeq(db,val,org=1){if(!Number.isSafeInteger(val)||val<1)return;ensureSeqTable(db);db.prepare("INSERT INTO _jobber_seq(name,val) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET val=MAX(val,excluded.val)").run('job_line_seq:'+org,val);}
export const isJobPref=name=>typeof name==='string'&&(name==='job_line_seq'||name.startsWith('job_lines:')||name.startsWith('job_options:'));
function upsertPref(db,org,name,value_json){
 const row=db.prepare('SELECT id FROM preferences WHERE organization_id=? AND name=? ORDER BY id ASC LIMIT 1').get(org,name);
 if(row){
  db.prepare('UPDATE preferences SET value_json=? WHERE id=? AND organization_id=?').run(value_json,row.id,org);
  db.prepare('DELETE FROM preferences WHERE organization_id=? AND name=? AND id<>?').run(org,name,row.id);
 }
 else db.prepare('INSERT INTO preferences(organization_id,name,value_json) VALUES(?,?,?)').run(org,name,value_json);
 return db.prepare('SELECT * FROM preferences WHERE organization_id=? AND name=?').get(org,name);
}
const dbLineState=new WeakMap();
function syncJobLineState(db,org=1){
 let orgs=dbLineState.get(db);if(!orgs)dbLineState.set(db,orgs=new Map());
 let state=orgs.get(org);if(!state)orgs.set(org,state={prefs:new Map(),byLineId:new Map(),seq:0});
 const rows=db.prepare("SELECT id,organization_id,name,value_json FROM preferences WHERE organization_id=? AND name GLOB 'job_lines:*' ORDER BY id ASC").all(org),seen=new Set();let changed=false;
 for(const row of rows){
  seen.add(row.id);const prev=state.prefs.get(row.id);
  if(prev&&prev.name===row.name&&prev.json===row.value_json)continue;
  let parsed;try{if(/"id"\s*:|\\u/i.test(row.value_json))parsed=JSON.parse(row.value_json);}catch{}
  const lines=Array.isArray(parsed)?parsed.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Number.isSafeInteger(item.id)&&item.id>=1):[];
  const suffix=row.name.slice(10),jobId=/^[1-9]\d*$/.test(suffix)?Number(suffix):null;
  state.prefs.set(row.id,{jobId,name:row.name,json:row.value_json,lines});changed=true;
 }
 for(const id of state.prefs.keys())if(!seen.has(id)){state.prefs.delete(id);changed=true;}
 if(changed){
  state.byLineId.clear();state.seq=0;const seenJobIds=new Set();
  for(const {id} of rows){
   const row=state.prefs.get(id),authoritative=row.jobId!==null&&!seenJobIds.has(row.jobId);
   for(const item of row.lines){if(item.id>state.seq)state.seq=item.id;if(authoritative&&!state.byLineId.has(item.id))state.byLineId.set(item.id,{jobId:row.jobId,line:item});}
   seenJobIds.add(row.jobId);
  }
 }
 return state;
}
export function maxJobLineSeq(db,org=1){
 ensureSeqTable(db);const durable=db.prepare("SELECT val FROM _jobber_seq WHERE name=?").get('job_line_seq:'+org)?.val;
 let seq=Math.max(1000000,db.prepare('SELECT COALESCE(MAX(id),0)*1000 AS n FROM jobs WHERE organization_id=?').get(org).n,syncJobLineState(db,org).seq,Number.isSafeInteger(durable)?durable:0);
 for(const r of db.prepare("SELECT value_json FROM preferences WHERE organization_id=? AND name='job_line_seq'").all(org)){const n=Number(r.value_json);if(Number.isSafeInteger(n))seq=Math.max(seq,n);}
 return seq;
}
export function writeJobPreference(db,org,r,existingPref,data){
 if(existingPref&&data.name!==undefined&&data.name!==existingPref.name&&(isJobPref(existingPref.name)||isJobPref(data.name)))fail('Cannot rename internal job preference');
 if(Object.keys(data).some(k=>!['name','value_json'].includes(k)))fail('Invalid preference field');
 const name=data.name??existingPref?.name,raw=data.value_json!==undefined?data.value_json:existingPref?.value_json;let parsed;
 try{parsed=typeof raw==='string'?JSON.parse(raw):raw;}catch{fail('Invalid preference JSON');}
 if(name==='job_line_seq'){
  if(typeof parsed!=='number'||!Number.isSafeInteger(parsed)||parsed>=Number.MAX_SAFE_INTEGER||parsed<maxJobLineSeq(db,org))fail('Invalid job_line_seq');
  return transaction(db,()=>{saveJobLineSeq(db,parsed,org);return upsertPref(db,org,name,String(parsed));});
 }
 const lines=name.startsWith('job_lines:'),suffix=name.slice(lines?10:12),jobId=Number(suffix);
 if(!/^[1-9]\d*$/.test(suffix)||!Number.isSafeInteger(jobId)||jobId<1)fail(`Invalid ${lines?'job_lines':'job_options'} preference`);
 const job=db.prepare('SELECT * FROM jobs WHERE organization_id=? AND id=?').get(org,jobId);if(!job)fail('Job not found for preference');
 if(lines){if(!Array.isArray(parsed))fail('job_lines preference must be an array');}
 else {
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('job_options preference must be an object');
  if(Object.keys(parsed).some(k=>!['tax_rate','discount_type','discount_value'].includes(k)))fail('Invalid job_options field');
  if(parsed.discount_type!==undefined&&!['percent','fixed'].includes(parsed.discount_type))fail('Invalid discount_type');
  calculateDocument([],parsed);
 }
 return transaction(db,()=>{
  hydrateJobState(db,org,job);
  if(lines){
   const stored=storeJobLines(db,org,jobId,parsed),calc=calculateDocument(stored,job._storedOptions||{});
   r.update('jobs',jobId,{subtotal_cents:calc.subtotal_cents,tax_cents:calc.tax_cents,total_cents:calc.total_cents});
   if(job._storedOptions&&!readJobOptions(db,org,jobId))storeJobOptions(db,org,jobId,job._storedOptions);
  }else{
   upsertPref(db,org,name,JSON.stringify(parsed));
   const manualBase=job.subtotal_cents||job.total_cents;
   if(Array.isArray(job._storedLines)||manualBase){const calc=calculateDocument(job._storedLines||[{name:job.title||'Job',quantity:1,unit_price_cents:manualBase,taxable:1}],parsed);r.update('jobs',jobId,{subtotal_cents:calc.subtotal_cents,tax_cents:calc.tax_cents,total_cents:calc.total_cents});}
  }
  return db.prepare('SELECT * FROM preferences WHERE organization_id=? AND name=?').get(org,name);
 });
}
export function readJobLines(db,org,id){
 const row=db.prepare('SELECT value_json FROM preferences WHERE organization_id=? AND name=? ORDER BY id ASC LIMIT 1').get(org,`job_lines:${id}`);
 try{const parsed=row?JSON.parse(row.value_json):null;return Array.isArray(parsed)?parsed:null;}catch{return null;}
}
export function readJobOptions(db,org,id){
 const row=db.prepare('SELECT value_json FROM preferences WHERE organization_id=? AND name=? ORDER BY id ASC LIMIT 1').get(org,`job_options:${id}`);
 try{
  const parsed=row?JSON.parse(row.value_json):null;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
  const keys=Object.keys(parsed),clean={};for(const k of ['tax_rate','discount_type','discount_value'])if(parsed[k]!==undefined)clean[k]=parsed[k];
  if(keys.length>0&&!Object.keys(clean).length)return null;
  if(clean.discount_type!==undefined&&!['percent','fixed'].includes(clean.discount_type))return null;
  calculateDocument([],clean);return clean;
 }catch{return null;}
}
export function hydrateJobState(db,org,job,onStep=null){
 if(!job)return job;
 let lines=readJobLines(db,org,job.id),opts=readJobOptions(db,org,job.id);
 if(Array.isArray(lines)){onStep?.(lines.length||1);lines=lines.filter(l=>l&&typeof l==='object'&&!Array.isArray(l));}
 if((!lines||!opts)&&job.quote_id){
  const q=db.prepare('SELECT * FROM quotes WHERE organization_id=? AND id=?').get(org,job.quote_id);
  if(q){
   const rawQLines=db.prepare('SELECT * FROM quote_line_items WHERE organization_id=? AND quote_id=? ORDER BY sort_order,id').all(org,q.id);
   onStep?.(rawQLines.length||1);
   const qLines=rawQLines.filter(l=>!l.is_optional||l.is_selected);
   const activeLines=lines??qLines,effOpts=opts||{tax_rate:q.tax_rate,discount_type:q.discount_type,discount_value:q.discount_value};
   let calc;try{calc=calculateDocument(activeLines,effOpts);}catch{}
   const match=Boolean(calc&&job.subtotal_cents===calc.subtotal_cents&&job.tax_cents===calc.tax_cents&&job.total_cents===calc.total_cents);
   if(!lines&&match)lines=qLines;
   if(!opts&&match)opts={tax_rate:q.tax_rate,discount_type:q.discount_type,discount_value:q.discount_value};
  }
 }
 job._storedLines=lines;job._storedOptions=opts;return job;
}
export function storeJobOptions(db,org,id,patch={}){
 const prev=readJobOptions(db,org,id)||{},next={...prev};
 for(const k of ['tax_rate','discount_type','discount_value'])if(patch[k]!==undefined)next[k]=patch[k];
 if(!Object.keys(next).length)return null;
 if(next.discount_type!==undefined&&!['percent','fixed'].includes(next.discount_type))fail('Invalid discount_type');
 calculateDocument([],next);
 upsertPref(db,org,`job_options:${id}`,JSON.stringify(next));
 return next;
}
export function storeJobLines(db,org,id,items){
 if(!Array.isArray(items))fail('job_lines preference must be an array');
 for(const l of items){
  if(!l||typeof l!=='object'||Array.isArray(l))fail('Invalid line item');
  for(const k of ['taxable','is_optional','is_selected'])if(l[k]!==undefined&&![true,false,1,0].includes(l[k]))fail(`Invalid boolean value for ${k}`);
  if(typeof l.name!=='string'||!l.name.trim())fail('Line item name is required');
  if(l.quantity!==undefined&&(typeof l.quantity==='boolean'||l.quantity===null||(typeof l.quantity!=='number'&&(typeof l.quantity!=='string'||!l.quantity.trim()))||!(Number(l.quantity)>0)))fail('Invalid line item quantity');
  if(l.description!=null&&typeof l.description!=='string')fail('Invalid line item description');
  if(l.unit!=null&&typeof l.unit!=='string')fail('Invalid line item unit');
  for(const k of Object.keys(l))if(!['id','name','description','quantity','unit','unit_cost_cents','markup_percent','unit_price_cents','total_cents','is_optional','is_selected','taxable','sort_order','product_service_id'].includes(k))fail(`Invalid line item field ${k}`);
  if(l.product_service_id!=null){
   const psId=decodeGid(l.product_service_id,'ProductOrService');
   if(!db.prepare('SELECT 1 FROM products_services WHERE id=? AND organization_id=?').get(psId,org))fail('Product or service not found',404);
  }
 }
 return transaction(db,()=>{
 const prev=new Set((readJobLines(db,org,id)||[]).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)&&Number.isSafeInteger(x.id)&&x.id>=1).map(x=>x.id)),used=new Set();
 const state=syncJobLineState(db,org);
 let seq=maxJobLineSeq(db,org);
 const stored=calculateDocument(items).lines.map(l=>{let lineId=l.id;if(!(Number.isSafeInteger(l.id)&&l.id>=1&&prev.has(l.id)&&state.byLineId.get(l.id)?.jobId===id&&!used.has(l.id))){if(!Number.isSafeInteger(seq)||seq>=Number.MAX_SAFE_INTEGER)fail('Job line ID sequence exhausted');lineId=++seq;}used.add(lineId);if(lineId>seq)seq=lineId;const is_optional=l.is_optional?1:0,is_selected=is_optional?(l.is_selected?1:0):(l.is_selected??1)?1:0;return {...l,...(l.product_service_id!==undefined?{product_service_id:l.product_service_id===null?null:decodeGid(l.product_service_id,'ProductOrService')}:{}),id:lineId,description:l.description||'',taxable:(l.taxable??1)?1:0,is_optional,is_selected};});
 saveJobLineSeq(db,seq,org);
 upsertPref(db,org,'job_line_seq',String(seq));
 upsertPref(db,org,`job_lines:${id}`,JSON.stringify(stored));
 return stored;
 });
}

export const encodeGid=(type,id)=>Buffer.from(`gid://jobber/${type}/${id}`).toString('base64');
export function decodeGid(value,expectedType=null){
 const invalid=()=>{fail(`Invalid Global ID${expectedType?` for ${expectedType}`:''}`);};
 if(typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value)){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)invalid();return n;}
 if(typeof value!=='string')invalid();
 const raw=value.startsWith('gid://')?value:Buffer.from(value,'base64').toString('utf8'),m=/^gid:\/\/jobber\/([A-Za-z][A-Za-z0-9]*)\/(?:(user|client|quote|line|job):)?(\d+)$/.exec(raw);
 const lineTypes=['QuoteLineItem','InvoiceLineItem','JobLineItem'];
 if(!m||m[2]&&(['quote','line','job'].includes(m[2])?m[1]!=='JobLineItem':!['PhoneNumber','Email'].includes(m[1]))||expectedType&&m[1]!==expectedType&&!(lineTypes.includes(expectedType)&&m[1]==='LineItem')&&!(expectedType==='JobLineItem'&&m[1]==='QuoteLineItem'))invalid();return decodeGid(m[3],expectedType);
}
const snake=s=>s.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const camel=s=>s.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
function argsEqual(a,b,eqCache){
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 let sub=eqCache.get(a);if(sub?.has(b))return sub.get(b);if(!sub)eqCache.set(a,sub=new WeakMap());
 const same=Array.isArray(a)?a.length===b.length&&a.every((x,i)=>argsEqual(x,b[i],eqCache)):(()=>{const ak=Object.keys(a),bk=Object.keys(b);return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&argsEqual(a[k],b[k],eqCache));})();
 sub.set(b,same);return same;
}
const scheduledTypes=new Set(['Visit','Assessment','Task']);
const typeCompatible=(fragType,targetType)=>!fragType||!targetType||fragType===targetType||fragType==='Node'&&(targetType==='Node'||nodeTypes.has(targetType)||targetType==='ScheduledItem')||targetType==='Node'&&(nodeTypes.has(fragType)||fragType==='ScheduledItem')||fragType==='ScheduledItem'&&(targetType==='ScheduledItem'||scheduledTypes.has(targetType)||targetType==='Node')||targetType==='ScheduledItem'&&(scheduledTypes.has(fragType)||fragType==='Node');
const object=(type,fields)=>({__typename:type,...(type==='__Schema'?{description:null}:type==='__Type'?{description:null,specifiedByURL:null,isOneOf:false,fields:null,interfaces:null,possibleTypes:null,enumValues:null,inputFields:null,ofType:null}:{}),...fields});
const entities={WebhookSubscription:['webhook_subscriptions','automations','webhookSubscription','webhookSubscriptions'],Account:['organizations','settings','account','accounts'],User:['users','team','user','users'],Client:['clients','clients','client','clients'],Property:['properties','clients','property','properties'],Request:['requests','requests','request','requests'],Quote:['quotes','quotes','quote','quotes'],Job:['jobs','jobs','job','jobs'],Visit:['visits','schedule','visit','visits'],Invoice:['invoices','invoices','invoice','invoices'],PaymentRecord:['payments','payments','paymentRecord','paymentRecords'],Expense:['expenses','jobs','expense','expenses'],TimeSheetEntry:['time_entries','team','timeSheetEntry','timeSheetEntries'],ProductOrService:['products_services','catalog','productOrService','productsAndServices'],Task:['tasks','schedule','task','tasks']};
const nodeTypes=new Set([...Object.keys(entities),'Assessment','QuoteLineItem','InvoiceLineItem','JobLineItem','Email','PhoneNumber']);
const fieldsByType={
 WebhookSubscription:'topic targetUrl webhookUrl url secret active deliveryCount lastDeliveredAt lastPayloadJson lastSignature createdAt',
 Account:'name industry timezone currency phone email createdAt',
 User:'name email phone status isAccountOwner isAdmin createdAt updatedAt',
 Client:'name firstName lastName companyName isCompany isLead isArchived status balance totalBalance balanceCents emails phones billingAddress clientProperties properties requests quotes jobs invoices notes jobberWebUri clientHubUri createdAt updatedAt',
 Property:'address isPrimary taxRate client requests quotes jobs createdAt',
 Request:'title requestStatus source serviceDetails contactName email phone client property assessment quotes jobs createdAt updatedAt',
 Quote:'quoteNumber title quoteStatus message amounts client property request jobs lineItems issuedAt approvedAt createdAt updatedAt',
 Job:'jobNumber title instructions jobStatus jobType billingType total subtotal taxAmount totalCents client property quote request lineItems visits invoices timeSheetEntries expenses jobCosting createdAt updatedAt',
 Visit:'title instructions completionNotes status visitStatus isComplete invoiced startAt endAt completedAt billableAmount billableAmountCents client property job assignedUsers createdAt',
 Invoice:'invoiceNumber subject message invoiceStatus invoiceNet issuedDate dueDate amounts client property job quote lineItems paymentRecords createdAt updatedAt',
 PaymentRecord:'amount amountCents refundedAmount refundedCents paymentMethod paymentType status entryDate client invoice quote',
 Expense:'title description amount amountCents date accountingCode reimbursable job paidByUser',
 TimeSheetEntry:'startAt endAt duration durationMinutes note label hourlyCost totalCost totalCostCents user job visit',
 ProductOrService:'name description category defaultUnitCost unitPriceCents internalUnitCost markup taxable visible',
 Task:'title instructions status isComplete startAt endAt dueDate startTime endTime completedAt client job assignedUser createdAt'
};

// A bounded recursive-descent parser; variables remain AST nodes until execution.
export function parseGraphQL(source){
 if(typeof source!=='string'||source.length>100000)throw new Error('Query must be a string of at most 100000 characters');
 const tokens=[];let pos=0;
 while(pos<source.length){const rest=source.slice(pos),ignored=/^(?:[\s,﻿]+|#[^\n\r]*)/.exec(rest);if(ignored){pos+=ignored[0].length;continue;}
  const m=/^(?:\.\.\.|[!$():=@\[\]{|}]|[_A-Za-z][_0-9A-Za-z]*|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|"(?:[^"\\\r\n]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*")/.exec(rest);
  if(!m)throw new Error(`Syntax error at character ${pos}`);tokens.push(m[0]);pos+=m[0].length;if(tokens.length>15000)throw new Error('Query too large');
 }
 let i=0,depth=0;const peek=()=>tokens[i],take=()=>tokens[i++],expect=t=>{if(take()!==t)throw new Error(`Expected ${t}`);},name=()=>{const n=take();if(!/^[_A-Za-z][_0-9A-Za-z]*$/.test(n||''))throw new Error('Expected name');return n;};
 function bounded(fn){if(++depth>40)throw new Error('Query depth exceeded');try{return fn();}finally{depth--;}}
 function value(){return bounded(()=>{const t=take();if(t==='$')return {variable:name()};if(t==='['){const a=[];while(peek()!==']'){if(!peek())throw new Error('Unclosed list');a.push(value());}take();return {list:a};}if(t==='{'){const o={};while(peek()!=='}'){const k=name();expect(':');if(Object.hasOwn(o,k))throw new Error('Duplicate input field');o[k]=value();}take();return {object:o};}if(t?.startsWith('"'))return JSON.parse(t);if(t==='true'||t==='false')return t==='true';if(t==='null')return null;if(/^-?\d/.test(t||''))return Number(t);if(/^[_A-Za-z]/.test(t||''))return t;throw new Error('Expected value');});}
 function args(){const o={};if(peek()==='('){take();while(peek()!==')'){const k=name();expect(':');if(Object.hasOwn(o,k))throw new Error('Duplicate argument');o[k]=value();}take();}return o;}
 function directives(){const out=[];while(peek()==='@'){take();const n=name();if(!['skip','include'].includes(n))throw new Error(`Unknown directive @${n}`);out.push({name:n,args:args()});}return out;}
 function selection(){return bounded(()=>{expect('{');const out=[];while(peek()!=='}'){if(!peek())throw new Error('Unclosed selection');if(peek()==='...'){take();if(peek()==='on'){take();const type=name(),dirs=directives();out.push({type,dirs,selection:selection()});}else if(peek()==='@'||peek()==='{'){const dirs=directives();out.push({dirs,selection:selection()});}else {const spread=name();out.push({spread,dirs:directives()});}continue;}let field=name(),alias=field;if(peek()===':'){take();field=name();}const a=args(),dirs=directives(),s=peek()==='{'?selection():null;out.push({field,alias,args:a,dirs,selection:s});}take();if(!out.length)throw new Error('Empty selection');return out;});}
 function type(){if(peek()==='['){take();const inner=type();expect(']');return {list:inner,required:peek()==='!'?(take(),true):false};}const n=name();return {name:n,required:peek()==='!'?(take(),true):false};}
 const operations=[],fragments={};while(peek()){if(peek()==='fragment'){take();const n=name();expect('on');const t=name();if(fragments[n])throw new Error('Duplicate fragment');fragments[n]={type:t,dirs:directives(),selection:selection()};continue;}if(peek()==='{'){operations.push({kind:'query',variables:[],selection:selection()});continue;}const kind=take();if(!['query','mutation'].includes(kind))throw new Error('Only query and mutation operations are supported');const n=peek()!=='('&&peek()!=='{'?name():null,variables=[],seenVars=new Set();if(peek()==='('){take();while(peek()!==')'){expect('$');const v=name();if(seenVars.has(v))throw new Error(`Duplicate variable $${v}`);seenVars.add(v);expect(':');const t=type();let def;if(peek()==='='){take();def=value();}variables.push({name:v,type:t,default:def});}take();}operations.push({kind,name:n,variables,selection:selection()});}
 if(!operations.length)throw new Error('No operation supplied');return {operations,fragments};
}
function evaluate(v,vars,declaredVars=new Set(Object.keys(vars)),cache=new WeakMap(),onStep=null){onStep?.();if(v&&typeof v==='object'){if(cache.has(v))return cache.get(v);if(v.variable){if(!declaredVars.has(v.variable))throw new Error(`Variable $${v.variable} is not defined`);return Object.hasOwn(vars,v.variable)?vars[v.variable]:undefined;}let result;if(v.list)result=v.list.map(x=>evaluate(x,vars,declaredVars,cache,onStep));else if(v.object)result=Object.fromEntries(Object.entries(v.object).map(([k,x])=>[k,evaluate(x,vars,declaredVars,cache,onStep)]).filter(([,val])=>val!==undefined));else return v;cache.set(v,result);return result;}return v;}
const cursor=id=>Buffer.from(`arrayconnection:${id}`).toString('base64');
const taskTime=(d,t)=>t?.includes('T')?t:d&&t?`${d}T${/^\d{2}:\d{2}$/.test(t)?t+':00Z':/^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(t)?t+'Z':t}`:null;
function connection(type,rows,args={},mapNode=x=>x,onStep=null,onFilterStep=onStep){
 onStep?.(rows.length||1);
 const searchableCols=['name','display_name','first_name','last_name','company_name','email','phone','mobile_phone','title','subject','description','item_name','notes','street1','city','state','postal_code','status','category','accounting_code','topic','target_url'];
 if(args.searchTerm){const term=String(args.searchTerm).toLowerCase();rows=rows.filter(x=>{onFilterStep?.(1);return searchableCols.some(col=>typeof x[col]==='string'&&x[col].toLowerCase().includes(term));});}
 if(args.filter){
  if(typeof args.filter!=='object'||Array.isArray(args.filter))throw new Error('Invalid filter');
  const idTargets={work_order_id:'Job',work_request_id:'Request',paid_by_user_id:'User',account_id:'Account',client_id:'Client',property_id:'Property',request_id:'Request',quote_id:'Quote',job_id:'Job',visit_id:'Visit',invoice_id:'Invoice',payment_id:'PaymentRecord',payment_record_id:'PaymentRecord',expense_id:'Expense',time_sheet_entry_id:'TimeSheetEntry',time_entry_id:'TimeSheetEntry',task_id:'Task',user_id:'User',assigned_user_id:'User',completed_by_user_id:'User',uploaded_by_user_id:'User',actor_user_id:'User',product_service_id:'ProductOrService',product_or_service_id:'ProductOrService',service_id:'ProductOrService'};
  const matchers=Object.entries(args.filter).map(([k,v])=>{
   const col=snake(k);if(['portal_token','password_hash'].includes(col))throw new Error(`Cannot filter on ${k}`);
   const targetType=idTargets[col]||(col==='id'||col===snake(type)+'_id'?type:null),isId=Boolean(targetType||col==='id'||col.endsWith('_id'));
   const booleanCol=['taxable','active','visible','is_primary','is_completed','is_complete','invoiced','reimbursable','billable','is_optional','is_selected','is_active','is_company','is_lead','is_archived','receives_email','receives_sms','receives_marketing'].includes(col);
   const scalar=x=>{if(x==null)return null;if(typeof x==='boolean')return x?'1':'0';const s=String(x).toLowerCase();return booleanCol&&['true','false'].includes(s)?s==='true'?'1':'0':s;};
   const isScheduledId=type==='ScheduledItem'&&(col==='id'||col==='scheduled_item_id');
   const decodeScheduledId=x=>{
    if(typeof x==='number'||(typeof x==='string'&&/^\d+$/.test(x)))return String(decodeGid(x,'ScheduledItem'));
    if(typeof x!=='string')fail('Invalid Global ID for ScheduledItem');
    const raw=x.startsWith('gid://')?x:Buffer.from(x,'base64').toString('utf8'),m=/^gid:\/\/jobber\/([A-Za-z][A-Za-z0-9]*)\/(\d+)$/.exec(raw);
    if(!m||!['Visit','Assessment','Task','ScheduledItem'].includes(m[1]))fail('Invalid Global ID for ScheduledItem');
    const n=decodeGid(m[2],'ScheduledItem');return m[1]==='ScheduledItem'?String(n):`${m[1].toLowerCase()}:${n}`;
   };
   const isJobLineId=type==='JobLineItem'&&(col==='id'||col==='job_line_item_id');
   const decodeJobLineId=x=>{
    if(typeof x==='number'||(typeof x==='string'&&/^\d+$/.test(x)))return String(decodeGid(x,'JobLineItem'));
    if(typeof x!=='string')fail('Invalid Global ID for JobLineItem');
    const raw=x.startsWith('gid://')?x:Buffer.from(x,'base64').toString('utf8'),m=/^gid:\/\/jobber\/([A-Za-z][A-Za-z0-9]*)\/(?:(quote|line|job):)?(\d+)$/.exec(raw);
    if(!m||!['JobLineItem','LineItem','QuoteLineItem'].includes(m[1])||(m[2]&&m[1]!=='JobLineItem'))fail('Invalid Global ID for JobLineItem');
    const n=decodeGid(m[3],'JobLineItem');
    if(m[1]==='LineItem')return String(n);
    if(m[1]==='QuoteLineItem'||m[2]==='quote')return `quote:${n}`;
    if(m[2]==='line')return `line:${n}`;
    return `job:${n}`;
   };
   const isTypedId=isScheduledId||isJobLineId;
   const keyOf=row=>isJobLineId?row.lineKey:row.cursorId;
   const norm=x=>isScheduledId?(x==null?null:decodeScheduledId(x)):isJobLineId?(x==null?null:decodeJobLineId(x)):scalar(x!=null&&isId?decodeGid(x,targetType):x);
   const aliases={...(type==='WebhookSubscription'?{webhook_url:'target_url',url:'target_url'}:{}),product_or_service_id:'product_service_id',payment_record_id:'payment_id',time_sheet_entry_id:'time_entry_id',work_order_id:'job_id',work_request_id:'request_id',paid_by_user_id:'user_id',message:'client_message',province:'state',note:'notes',label:'category',markup:'markup_percent',invoice_net:'payment_terms',issued_at:'issued_date',payment_method:'method',entry_date:'paid_at',request_status:'status',quote_status:'status',invoice_status:'status',job_status:'status',visit_status:'status',...(type==='Client'?{name:'display_name'}:type==='Expense'?{title:'item_name',date:'date_incurred'}:type==='Invoice'?{title:'subject'}:{})};
   const valOf=row=>{
    const projectedType=type==='ScheduledItem'?row.itemType:type;
    if(projectedType==='User'&&col==='status')return scalar(row.is_active?'ACTIVE':'DEACTIVATED');
    if(projectedType==='User'&&col==='updated_at')return scalar(row.updated_at||row.created_at);
    if(projectedType==='Task'&&col==='start_at')return scalar(taskTime(row.due_date,row.start_time)??(row.due_date?`${row.due_date}T00:00:00Z`:null));
    if(projectedType==='Task'&&col==='end_at')return scalar(taskTime(row.due_date,row.end_time));
    if(projectedType==='Assessment'&&col==='status')return scalar(row.status||'scheduled');
    if(projectedType==='Client'&&col==='jobber_web_uri')return scalar('/clients/'+row.id);
    if(projectedType==='Account'&&col==='industry')return scalar(row.industry??'Tile & Flooring');
    if(projectedType==='TimeSheetEntry'&&col==='duration')return scalar(row.duration_minutes!=null?row.duration_minutes*60:row.duration);
    if((projectedType==='Quote'&&col==='quote_number')||(projectedType==='Invoice'&&col==='invoice_number')||(projectedType==='Job'&&col==='job_number'))return scalar(String(row[col]||row.id));
    const moneyFields={Client:{balance:'balance_cents',total_balance:'balance_cents'},Job:{total:'total_cents',subtotal:'subtotal_cents',tax_amount:'tax_cents'},Visit:{billable_amount:'billable_amount_cents'},PaymentRecord:{amount:'amount_cents',refunded_amount:'refunded_cents'},Expense:{amount:'amount_cents'},TimeSheetEntry:{hourly_cost:'hourly_cost_cents',total_cost:'total_cost_cents'},ProductOrService:{default_unit_cost:'unit_price_cents',internal_unit_cost:'unit_cost_cents'},QuoteLineItem:{unit_price:'unit_price_cents',total_price:'total_cents'},InvoiceLineItem:{unit_price:'unit_price_cents',total_price:'total_cents'},JobLineItem:{unit_price:'unit_price_cents',total_price:'total_cents'}};
    if(moneyFields[projectedType]?.[col])return scalar(row[moneyFields[projectedType][col]]/100);
    const field=col==='start_at'&&Object.hasOwn(row,'scheduled_start')?'scheduled_start':col==='end_at'&&Object.hasOwn(row,'scheduled_end')?'scheduled_end':col==='service_id'&&!Object.hasOwn(row,'service_id')?'product_service_id':col==='product_service_id'&&!Object.hasOwn(row,'product_service_id')?'service_id':aliases[col]||col;return scalar(col==='legacy_id'?row.id:col==='visible'?row.active:col==='is_complete'?row.status==='completed':col==='is_company'?Boolean(row.company_name):col==='is_lead'?row.status==='lead':col==='is_archived'?row.status==='archived':Object.hasOwn(row,field)?row[field]:row[k]);};
   const equals=expected=>isTypedId?row=>expected==null?row.id==null:expected.includes(':')?keyOf(row)===expected:String(row.id)===expected:row=>valOf(row)===expected;
   const within=set=>isTypedId?row=>set.has(keyOf(row))||set.has(String(row.id)):row=>set.has(valOf(row));
   if(v&&typeof v==='object'&&!Array.isArray(v)){
    const ops=Object.entries(v).map(([op,val])=>{
     if(op==='eq'){onFilterStep?.(1);return equals(norm(val));}
     if(op==='in'){if(!Array.isArray(val))throw new Error('Invalid filter');const set=new Set();for(const item of val){onFilterStep?.(1);set.add(norm(item));}return within(set);}
     throw new Error(`Unsupported filter operator ${op}`);
    });
    return row=>ops.every(fn=>fn(row));
   }
   if(Array.isArray(v)){const set=new Set();for(const item of v){onFilterStep?.(1);set.add(norm(item));}return within(set);}
   onFilterStep?.(1);return equals(norm(v));
  });
  rows=rows.filter(row=>{onFilterStep?.(matchers.length);return matchers.every(fn=>fn(row));});
 }
 const totalCount=rows.length;let start=0,end=rows.length;
 for(const [key,forward] of [['after',true],['before',false]])if(args[key]!=null){const m=/^arrayconnection:(.+)$/.exec(Buffer.from(String(args[key]),'base64').toString());const index=m?rows.findIndex(x=>String(x.cursorId??x.id)===m[1]):-1;if(index<0)throw new Error('Invalid cursor');if(forward)start=index+1;else end=index;}
 const windowStart=start,windowEnd=Math.max(start,end);end=windowEnd;
 for(const key of ['first','last'])if(args[key]!=null&&(!Number.isInteger(args[key])||args[key]<0||args[key]>1000))throw new Error(`${key} must be an integer between 0 and 1000`);
 if(args.first!=null)end=Math.min(end,start+args.first);if(args.last!=null)start=Math.max(start,end-args.last);if(args.first==null&&args.last==null)end=Math.min(end,start+100);
 const page=rows.slice(start,Math.max(start,end)),rowCursor=row=>cursor(row.cursorId??row.id);let mappedNodes;
 const getNodes=()=>(mappedNodes??=page.map(({cursorId,lineKey,...node})=>mapNode(node)));
 return object(`${type}Connection`,{nodes:getNodes,edges:()=>page.map((row,i)=>object(`${type}Edge`,{cursor:rowCursor(row),node:getNodes()[i]})),pageInfo:()=>object('PageInfo',{hasNextPage:end<windowEnd,hasPreviousPage:start>windowStart,startCursor:page.length?rowCursor(page[0]):null,endCursor:page.length?rowCursor(page.at(-1)):null}),totalCount});
}

export function flattenInput(input,type){
 const flat={};
 const visit=(obj,isRoot)=>{
  for(const [key,value] of Object.entries(obj||{})){
   if(value===undefined)continue;
   if(['__proto__','constructor','prototype'].includes(key))fail('Invalid input field');
   const k=snake(key);
   if((k==='address'||k==='billing_address')&&!(isRoot&&type==='Client')){
    if(value&&typeof value==='object'&&!Array.isArray(value))visit(value,false);
    continue;
   }
   flat[key]=value;
  }
 };
 visit(input,true);
 return flat;
}
export function normalizeInput(input,type,existing,allowJsonStrings=false){
 input=flattenInput(input,type);
 const toCents=(v,field)=>{
  if(typeof v==='boolean'||v===null||(typeof v!=='number'&&(typeof v!=='string'||!v.trim()))||!Number.isFinite(Number(v))||Number(v)<0)fail(`Invalid monetary amount for ${field}`);
  const m=/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(v).trim().replace(/^\+/,''));
  if(!m)fail(`Invalid monetary amount for ${field}`);
  const raw=(m[1]+(m[2]||'')).replace(/^0+/,'');if(!raw)return 0;
  const sig=raw.length,scale=(m[2]||'').length-Number(m[3]||0),mag=sig+2-scale;
  if(!Number.isSafeInteger(scale)||mag>17)fail(`Invalid monetary amount for ${field}`);
  if(mag<0)return 0;
  const trimmed=sig>25?raw.slice(0,25)+(/[1-9]/.test(raw.slice(25))?'1':'0'):raw,adjScale=scale-(sig-trimmed.length),digits=BigInt(trimmed);
  const c=adjScale<=2?Number(digits*(10n**BigInt(2-adjScale))):(()=>{const d=10n**BigInt(adjScale-2);return Number((digits+d/2n)/d);})();
  if(!Number.isSafeInteger(c))fail(`Invalid monetary amount for ${field}`);
  return c;
 };
 const out={};for(const [key,value] of Object.entries(input||{})){
  if(value===undefined)continue;
  if(['__proto__','constructor','prototype'].includes(key))fail('Invalid input field');
  let k=snake(key),v=value;
  const aliases={...(type==='WebhookSubscription'?{webhook_url:'target_url',url:'target_url'}:{}),line_items:'items',payment_method:'method',name:type==='Client'?'display_name':'name',message:'client_message',province:'state',note:'notes',label:'category',paid_by_user_id:'user_id',assigned_user_ids:'assigned_user_ids_json',default_unit_cost:'unit_price',internal_unit_cost:'unit_cost',visible:'active',markup:'markup_percent',time_entry_id:'time_sheet_entry_id',work_request_id:'request_id',work_order_id:'job_id',product_or_service_id:'product_service_id',payment_record_id:'payment_id',invoice_net:'payment_terms',issued_at:'issued_date',entry_date:'paid_at',request_status:'status',quote_status:'status',invoice_status:'status',job_status:'status',visit_status:'status',...(type?.endsWith('LineItem')?{service_id:'product_service_id'}:{}),...(type==='Expense'?{title:'item_name',date:'date_incurred'}:{}),...(type==='Invoice'?{title:'subject'}:{})};k=aliases[k]||k;
  if(k==='address'||k==='billing_address'){if(type==='Client')out.billing_address=v==null?null:typeof v==='object'?JSON.stringify(v):v;else if(v&&typeof v==='object')Object.assign(out,normalizeInput(v,undefined,undefined,allowJsonStrings));continue;}
  if(['is_company','is_lead','is_archived'].includes(k))continue;
  if(k==='emails'){if(!Array.isArray(v)||!v.every(x=>x&&typeof x==='object'&&typeof x.address==='string'))fail('Invalid emails');out.email=v[0]?.address||'';continue;}if(k==='phones'){if(!Array.isArray(v)||!v.every(x=>x&&typeof x==='object'&&typeof x.number==='string'))fail('Invalid phones');out.phone=v[0]?.number||'';continue;}
  if(k==='items'){if(!Array.isArray(v)||!v.every(x=>x&&typeof x==='object'&&!Array.isArray(x)))fail('Invalid lineItems');const lineType=type==='Quote'?'QuoteLineItem':type==='Invoice'?'InvoiceLineItem':type==='Job'?'JobLineItem':'LineItem';out.items=v.map(x=>normalizeInput(x,lineType,undefined,allowJsonStrings));continue;}
  if(k==='id'||k.endsWith('_id')){const target={account_id:'Account',client_id:'Client',property_id:'Property',request_id:'Request',quote_id:'Quote',job_id:'Job',visit_id:'Visit',invoice_id:'Invoice',payment_id:'PaymentRecord',payment_record_id:'PaymentRecord',expense_id:'Expense',time_sheet_entry_id:'TimeSheetEntry',time_entry_id:'TimeSheetEntry',task_id:'Task',user_id:'User',assigned_user_id:'User',completed_by_user_id:'User',uploaded_by_user_id:'User',actor_user_id:'User',source_id:'Client',target_id:'Client',product_service_id:'ProductOrService',product_or_service_id:'ProductOrService',service_id:'ProductOrService'}[k]||(['id',snake(type||'')+'_id',snake(entities[type]?.[2]||'')+'_id'].includes(k)?type:null);v=v==null?null:decodeGid(v,target);}
  if(['visit_ids','assigned_user_ids_json'].includes(k)&&v!==undefined&&v!==null){
   if(allowJsonStrings&&typeof v==='string'){
    let parsed;try{parsed=JSON.parse(v);}catch{fail(`Invalid ${key}`);}
    if(!Array.isArray(parsed))fail(`Invalid ${key}`);
    v=parsed.map(x=>decodeGid(x,k==='visit_ids'?'Visit':'User'));
   }else{
    if(!Array.isArray(v))fail(`Invalid ${key}`);
    v=v.map(x=>decodeGid(x,k==='visit_ids'?'Visit':'User'));
   }
  }
  if(['unit_price','unit_cost','amount','total','subtotal','tax_amount','billable_amount','hourly_cost','total_cost'].includes(k)){k=k==='tax_amount'?'tax_cents':k+'_cents';v=toCents(v,key);}
  if(k.endsWith('_cents')&&(!Number.isSafeInteger(v)||v<0))fail(`Invalid monetary amount for ${key}`);
  if(type?.endsWith('LineItem')&&['taxable','is_optional','is_selected'].includes(k)&&![true,false,1,0].includes(v))fail(`Invalid boolean value for ${k}`);
  if(k==='tax_rate'&&v&&typeof v==='object')v=v.tax??v.rate;
  if(['quantity','tax_rate','discount_value','required_deposit_value','markup_percent'].includes(k)&&(typeof v==='boolean'||v===null||(typeof v!=='number'&&(typeof v!=='string'||!v.trim()))||!Number.isFinite(Number(v))))fail(`Invalid numeric value for ${key}`);
  if((['status','job_type','billing_type','method','payment_type','payment_terms','discount_type','required_deposit_type','item_type','source'].includes(k)||(k==='category'&&type==='TimeSheetEntry'))&&typeof v==='string')v=v.toLowerCase();
  if(['quote_number','invoice_number','job_number','request_number'].includes(k)&&v!=null)v=String(v);
  out[k]=v;
 }
 if(type==='WebhookSubscription'){
  const {id,webhook_subscription_id,...fields}=out;
  return {...webhookInput(fields,!existing),...(id!==undefined?{id}:{}),...(webhook_subscription_id!==undefined?{webhook_subscription_id}:{})};
 }
 if(input?.discountValue!=null&&(out.discount_type??existing?.discount_type??existing?._storedOptions?.discount_type)==='fixed')out.discount_value=toCents(input.discountValue,'discountValue');
 if(input?.requiredDepositValue!=null&&(out.required_deposit_type??existing?.required_deposit_type)==='fixed')out.required_deposit_value=toCents(input.requiredDepositValue,'requiredDepositValue');
 if(type==='Client'&&!out.display_name&&('first_name' in out||'last_name' in out||'company_name' in out)){const first='first_name' in out?out.first_name:existing?.first_name,last='last_name' in out?out.last_name:existing?.last_name,comp='company_name' in out?out.company_name:existing?.company_name;out.display_name=[first,last].filter(Boolean).join(' ')||comp||existing?.display_name;}
 if(type==='Client'&&out.status===undefined){
  const hasLead=input?.isLead!==undefined||input?.is_lead!==undefined,leadVal=input?.isLead??input?.is_lead;
  const hasArch=input?.isArchived!==undefined||input?.is_archived!==undefined,archVal=input?.isArchived??input?.is_archived;
  if(hasLead&&hasArch&&leadVal&&archVal)fail('Client cannot be both lead and archived');
  if(hasLead||hasArch){const isArch=hasArch?!!archVal:(!leadVal&&existing?.status==='archived'),isLead=hasLead?!!leadVal:(!archVal&&existing?.status==='lead');out.status=isArch?'archived':isLead?'lead':'active';}
 }
 if(type==='Job'&&['tax_rate','discount_type','discount_value','required_deposit_type','required_deposit_value'].some(k=>k in out)){
  if(out.discount_type!==undefined&&!['percent','fixed'].includes(out.discount_type))fail('Invalid discount_type');
  calculateDocument([],{...(existing?._storedOptions||{}),...out});
 }
 if(type==='Job'&&out.items)for(const l of out.items){
  if(!(Object.keys(l).length===1&&'id' in l)&&(typeof l.name!=='string'||!l.name.trim()))fail('Line item name is required');
  if(l.quantity!==undefined&&(typeof l.quantity==='boolean'||l.quantity===null||(typeof l.quantity!=='number'&&(typeof l.quantity!=='string'||!l.quantity.trim()))||!(Number(l.quantity)>0)))fail('Invalid numeric value for quantity');
  if(l.description!=null&&typeof l.description!=='string')fail('Invalid line item description');
  if(l.unit!=null&&typeof l.unit!=='string')fail('Invalid line item unit');
  for(const k of Object.keys(l))if(!['id','name','description','quantity','unit','unit_cost_cents','markup_percent','unit_price_cents','total_cents','is_optional','is_selected','taxable','sort_order','product_service_id'].includes(k))fail(`Invalid line item field ${k}`);
 }
 if(type==='Job'&&out.items){const calc=calculateDocument(out.items,{...(existing?._storedOptions||{}),...out});for(const k of ['subtotal_cents','tax_cents','total_cents']){if(out[k]!==undefined&&out[k]!==calc[k])fail(`Job ${k} does not match calculated lineItems`);out[k]=calc[k];}out.items=calc.lines.map(l=>({...l,...(l.id?{id:l.id}:{}),description:l.description||'',taxable:l.taxable?1:0}));}
 if(type==='Job'&&!out.items&&existing?._storedLines&&['subtotal_cents','tax_cents','total_cents','tax_rate','discount_type','discount_value','required_deposit_type','required_deposit_value'].some(k=>k in out)){
  const hasCalcOpts=['tax_rate','discount_type','discount_value'].some(k=>k in out),calc=hasCalcOpts?calculateDocument(existing._storedLines,{...(existing._storedOptions||{}),...out}):{subtotal_cents:existing.subtotal_cents,tax_cents:existing.tax_cents,total_cents:existing.total_cents};
  for(const k of ['subtotal_cents','tax_cents','total_cents']){if(out[k]!==undefined&&out[k]!==calc[k])fail(`Job ${k} does not match persisted lineItems`);out[k]=calc[k];}
 }
 if(type==='Job'&&!out.items&&!existing?._storedLines&&(['tax_rate','discount_type','discount_value'].some(k=>k in out)||existing?._storedOptions&&['subtotal_cents','tax_cents','total_cents'].some(k=>k in out))){
  const baseCents=out.subtotal_cents??(existing?(existing.subtotal_cents||existing.total_cents):(out.total_cents||0));
  const manualLines=baseCents>0?[{name:out.title||existing?.title||'Job',quantity:1,unit_price_cents:baseCents,taxable:1}]:[],calc=calculateDocument(manualLines,{...(existing?._storedOptions||{}),...out});
  const checkTotal=out.subtotal_cents!==undefined||Boolean(existing);
  for(const k of ['subtotal_cents','tax_cents','total_cents']){if(out[k]!==undefined&&(k!=='total_cents'||checkTotal)&&out[k]!==calc[k])fail(`Job ${k} does not match calculated options`);out[k]=calc[k];}
 }
 if(type==='Visit'){if(out.start_at!==undefined){out.scheduled_start=out.start_at;delete out.start_at;}if(out.end_at!==undefined){out.scheduled_end=out.end_at;delete out.end_at;}}
 if(type==='Task'){
  const compactTime=(iso,d)=>{const s=String(iso);if(!s.includes('T'))return s;const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00(?:\.000)?Z$/.exec(s);return m&&m[1]===d?m[2]:s;};
  if(out.start_at!==undefined){if(out.start_at===null){if(out.due_date===undefined)out.due_date=null;if(out.start_time===undefined)out.start_time=null;}else{if(!out.due_date)out.due_date=String(out.start_at).slice(0,10);if(!out.start_time&&String(out.start_at).includes('T'))out.start_time=compactTime(out.start_at,out.due_date);}delete out.start_at;}
  if(out.end_at!==undefined){if(out.end_at===null){if(out.end_time===undefined)out.end_time=null;}else{if(!out.due_date&&String(out.end_at).includes('T'))out.due_date=String(out.end_at).slice(0,10);if(!out.end_time&&String(out.end_at).includes('T'))out.end_time=compactTime(out.end_at,out.due_date);}delete out.end_at;}
 }
 return out;
}

// Mutations dispatch to the same authenticated router as REST, not a parallel write path.
const mutations={};
for(const [type,route,verbs] of [['WebhookSubscription','webhooks','Create Edit Delete'],['Client','clients','Create Edit Archive Unarchive Merge'],['Property','properties','Create Edit Delete'],['Request','requests','Create Edit ScheduleAssessment'],['Quote','quotes','Create Edit Send Approve RequestChanges ConvertToJob'],['Job','jobs','Create Edit Complete Invoice'],['Visit','visits','Create Reschedule Complete'],['Invoice','invoices','Create Edit Send ApplyDeposit Credit RecordPayment'],['PaymentRecord','payments','Create'],['Expense','expenses','Create Edit Delete'],['TimeSheetEntry','time-entries','Create'],['ProductOrService','catalog','Create Edit'],['Task','tasks','Create Complete']])for(const verb of verbs.split(' '))mutations[type[0].toLowerCase()+type.slice(1)+verb]={type,route,verb};
Object.assign(mutations,{invoiceCreateFromJob:mutations.jobInvoice,invoiceIssue:mutations.invoiceSend,paymentRefund:{type:'PaymentRecord',route:'payments',verb:'Refund'},timeSheetClockIn:{type:'TimeSheetEntry',route:'team',verb:'ClockIn'},timeSheetClockOut:{type:'TimeSheetEntry',route:'time-entries',verb:'ClockOut'}});

// Selection metadata is independent of resolver values, including null and empty lists.
const selectionTypes={};
const scalars=(type,names)=>selectionTypes[type]=Object.fromEntries(names.split(' ').map(n=>[n,null]));
for(const [type,names] of Object.entries(fieldsByType))scalars(type,'id legacyId '+names);
for(const [type,names] of Object.entries({PageInfo:'hasNextPage hasPreviousPage startCursor endCursor',UserError:'message path',UserName:'full first last',UserEmail:'raw isValid',PhoneNumber:'id raw number primary smsAllowed',Email:'id address primary',Address:'street1 street2 city province postalCode country',TaxRate:'name tax',Assessment:'id legacyId title status isComplete startAt endAt instructions',QuoteAmounts:'subtotal discountAmount taxAmount total depositAmount subtotalCents discountCents taxCents totalCents requiredDepositCents depositPaidCents paidDepositAmount',InvoiceAmounts:'subtotal discountAmount taxAmount total depositAmount subtotalCents discountCents taxCents totalCents amountPaidCents balanceDueCents paymentsTotal invoiceBalance',JobCosting:'revenue_cents labor_cost_cents expense_cost_cents profit_cents margin_percent revenueCents laborCostCents expenseCostCents profitCents marginPercent',Node:'id',ScheduledItem:'id legacyId title status isComplete startAt endAt instructions',__Schema:'description',__Type:'kind name description specifiedByURL isOneOf',__Field:'name description isDeprecated deprecationReason',__Directive:'name description locations isRepeatable',__InputValue:'name description defaultValue isDeprecated deprecationReason',__EnumValue:'name description isDeprecated deprecationReason'}))scalars(type,names);
for(const type of ['QuoteLineItem','InvoiceLineItem','JobLineItem'])scalars(type,'id legacyId name description quantity unitPrice totalPrice unitPriceCents totalCents taxable'+(type==='JobLineItem'?'':' isOptional isSelected'));
for(const type of [...Object.keys(entities),'QuoteLineItem','InvoiceLineItem','JobLineItem','ScheduledItem']){selectionTypes[type+'Connection']={nodes:type,edges:type+'Edge',pageInfo:'PageInfo',totalCount:null};selectionTypes[type+'Edge']={cursor:null,node:type};}
for(const [type,fields] of Object.entries(fieldsByType))for(const target of Object.keys(entities)){const [, ,single,plural]=entities[target];if(fields.split(' ').includes(single))selectionTypes[type][single]=target;if(fields.split(' ').includes(plural))selectionTypes[type][plural]=target+'Connection';}
for(const [type,fields] of Object.entries({User:{name:'UserName',email:'UserEmail',phone:'PhoneNumber'},Client:{emails:'Email',phones:'PhoneNumber',billingAddress:'Address',clientProperties:'PropertyConnection'},Property:{address:'Address',taxRate:'TaxRate'},Request:{assessment:'Assessment'},Quote:{amounts:'QuoteAmounts',lineItems:'QuoteLineItemConnection'},Invoice:{amounts:'InvoiceAmounts',lineItems:'InvoiceLineItemConnection'},Job:{lineItems:'JobLineItemConnection',jobCosting:'JobCosting'},Visit:{assignedUsers:'UserConnection'},Assessment:{assignedUsers:'UserConnection'},Expense:{paidByUser:'User'},Task:{assignedUser:'User'},__Schema:{queryType:'__Type',mutationType:'__Type',subscriptionType:'__Type',types:'__Type',directives:'__Directive'},__Type:{fields:'__Field',interfaces:'__Type',possibleTypes:'__Type',enumValues:'__EnumValue',inputFields:'__InputValue',ofType:'__Type'},__Field:{args:'__InputValue',type:'__Type'},__Directive:{args:'__InputValue'},__InputValue:{type:'__Type'}}))Object.assign(selectionTypes[type],fields);
selectionTypes.Query={account:'Account',currentUser:'User',node:'Node',scheduledItems:'ScheduledItemConnection',__schema:'__Schema',__type:'__Type'};
for(const [type,[,,single,plural]] of Object.entries(entities))Object.assign(selectionTypes.Query,{[single]:type,[plural]:type+'Connection'});
selectionTypes.Mutation={};
for(const [name,{type,verb}] of Object.entries(mutations)){const outputType=verb==='ConvertToJob'?'Job':verb==='Invoice'?'Invoice':verb==='RecordPayment'?'PaymentRecord':type,payload=name[0].toUpperCase()+name.slice(1)+'Payload';selectionTypes.Mutation[name]=payload;selectionTypes[payload]={[entities[outputType][2]]:outputType,userErrors:'UserError',...(verb==='Delete'?{deletedId:null}:{})};}

export async function executeGraphQL({db,user,query,variables={},operationName,version='2025-01-20',authorize,dispatch,method='POST'}){
 const errors=[];let actualQueryCost=0,requestedQueryCost=0,data=null,expand;
 const step=(n=1)=>{for(let i=0;i<n;i++)if(++actualQueryCost>20000)throw Object.assign(new Error('Execution cost exceeded'),{fatal:true});};
 const w=workflows(db,user.organization_id,user.id),r=w.r,roleCache=new Map(),costingCache=new Map(),jobLinesCache=new Map(),hasJobLinesCache=new Map(),quoteActiveCache=new Map();
 const hasStoredJobLines=jobId=>{if(!hasJobLinesCache.has(jobId)){step(1);hasJobLinesCache.set(jobId,Boolean(db.prepare("SELECT 1 FROM preferences WHERE id=(SELECT id FROM preferences WHERE organization_id=? AND name=? ORDER BY id ASC LIMIT 1) AND json_valid(value_json) AND json_type(value_json)='array'").get(user.organization_id,'job_lines:'+jobId)));}return hasJobLinesCache.get(jobId);};
 const hasActiveQuoteJob=quoteId=>{
  if(!quoteActiveCache.has(quoteId)){
   const jobIds=db.prepare('SELECT id FROM jobs WHERE organization_id=? AND quote_id=? ORDER BY id ASC').all(user.organization_id,quoteId);
   step(jobIds.length||1);quoteActiveCache.set(quoteId,jobIds.some(j=>!hasStoredJobLines(j.id)));
  }
  return quoteActiveCache.get(quoteId);
 };
 let lineState=null;const getLineState=()=>(lineState??=syncJobLineState(db,user.organization_id));
 const getRole=id=>{if(!roleCache.has(id))roleCache.set(id,r.get('roles',id).slug);return roleCache.get(id);};
 const check=(type,write=false)=>authorize(db,user,entities[type][1],write);
 const org=()=>db.prepare('SELECT * FROM organizations WHERE id=?').get(user.organization_id);
 function row(type,id){check(type);if(type==='Account')return Number(id)===user.organization_id?org():null;try{return r.get(entities[type][0],decodeGid(id,type));}catch(e){if(e.status===404)return null;throw e;}}
 function list(type,filter={}){check(type);const rows=type==='Account'?[org()]:r.list(entities[type][0],filter);step(rows.length||1);return rows;}
 const parseAssignedIds=raw=>{
  if(typeof raw==='string'&&raw.length>40000)step(Math.ceil(raw.length/2));
  try{const p=typeof raw==='string'?JSON.parse(raw):raw;return Array.isArray(p)?p:[];}catch{return [];}
 };
 function assignedUsersConn(ids,args){check('User');const raw=Array.isArray(ids)?ids:[];step(raw.length||1);const clean=[...new Set(raw.map(Number).filter(Number.isInteger))],rows=clean.map(id=>{step(1);return r.list('users',{id})[0];}).filter(Boolean);return mapConnection('User',rows,args);}
 function getJobLines(job){
  if(jobLinesCache.has(job.id))return jobLinesCache.get(job.id);
  const stored=readJobLines(db,user.organization_id,job.id),quoted=!stored&&job.quote_id?r.list('quote_line_items',{quote_id:job.quote_id}):[];
  const rawCount=stored?(stored.length||1):quoted.length?quoted.length:1;step(rawCount);
  const rows=stored?stored.filter(l=>l&&typeof l==='object'&&!Array.isArray(l)&&(!l.is_optional||l.is_selected)):quoted.length?quoted.filter(l=>!l.is_optional||l.is_selected):[{id:job.id,name:job.title,description:job.instructions||'',quantity:1,unit_price_cents:job.subtotal_cents||job.total_cents,total_cents:job.total_cents,taxable:job.tax_cents>0?1:0}];
  const entry={rows,fromStored:Boolean(stored),fromQuote:!stored&&quoted.length>0};jobLinesCache.set(job.id,entry);return entry;
 }
 function mapped(type,x){step(1);if(!x)return null;const value=object(type,{id:encodeGid(type,x.id),legacyId:x.id});
  for(const f of (fieldsByType[type]||'').split(' '))value[f]=Object.hasOwn(x,snake(f))?x[snake(f)]:null;
  const rel=(field,t,id)=>{value[field]=()=>id?mapped(t,row(t,id)):null;};
  for(const t of ['Client','Property','Request','Quote','Job','Visit','Invoice','User']){const f=t[0].toLowerCase()+t.slice(1);if((fieldsByType[type]||'').split(' ').includes(f))rel(f,t,x[snake(f)+'_id']);}
  const conn=(field,t,filter)=>{value[field]=a=>mapConnection(t,list(t,filter),a);};
  const address=x=>{x=x&&typeof x==='object'?x:{};return object('Address',{street1:x.street1||null,street2:x.street2||null,city:x.city||null,province:x.state||x.province||null,postalCode:x.postal_code||x.postalCode||null,country:x.country||null});};
  if(type==='Account')Object.assign(value,{industry:'Tile & Flooring'});
  if(type==='User'){Object.assign(value,{name:object('UserName',{full:x.name,first:x.name.split(' ')[0]||'',last:x.name.split(' ').slice(1).join(' ')||''}),email:object('UserEmail',{raw:x.email,isValid:true}),phone:object('PhoneNumber',{id:encodeGid('PhoneNumber','user:'+x.id),raw:x.phone||'',number:x.phone||'',primary:true,smsAllowed:true}),status:x.is_active?'ACTIVE':'DEACTIVATED',isAccountOwner:()=>getRole(x.role_id)==='owner',isAdmin:()=>['owner','admin'].includes(getRole(x.role_id)),updatedAt:x.updated_at||x.created_at});}
  if(type==='WebhookSubscription')Object.assign(value,{webhookUrl:x.target_url,url:x.target_url,active:!!x.active});
  if(type==='Client'){let billing={};try{const parsed=JSON.parse(x.billing_address||'{}');billing=parsed&&typeof parsed==='object'?parsed:{};}catch{billing={street1:x.billing_address};}Object.assign(value,{name:x.display_name,isCompany:!!x.company_name,isLead:x.status==='lead',isArchived:x.status==='archived',status:x.status.toUpperCase(),balance:x.balance_cents/100,totalBalance:x.balance_cents/100,emails:x.email?[object('Email',{id:encodeGid('Email',x.id),address:x.email,primary:true})]:[],phones:x.phone?[object('PhoneNumber',{id:encodeGid('PhoneNumber','client:'+x.id),number:x.phone,raw:x.phone,primary:true,smsAllowed:!!x.receives_sms})]:[],billingAddress:address(billing),jobberWebUri:'/clients/'+x.id,clientHubUri:()=>{check('Client',true);return '/hub/'+x.portal_token;}});for(const t of ['Property','Request','Quote','Job','Invoice'])conn(entities[t][3],t,{client_id:x.id});value.clientProperties=value.properties;}
  if(type==='Property'){Object.assign(value,{address:address(x),isPrimary:!!x.is_primary,taxRate:object('TaxRate',{name:org().tax_name,tax:x.tax_rate??org().tax_rate})});for(const t of ['Request','Quote','Job'])conn(entities[t][3],t,{property_id:x.id});}
  if(type==='Request'){Object.assign(value,{requestStatus:x.status.toUpperCase(),contactName:()=>row('Client',x.client_id)?.display_name,email:()=>row('Client',x.client_id)?.email,phone:()=>row('Client',x.client_id)?.phone,assessment:()=>{check('Visit');const a=r.list('appointments',{entity_type:'assessment',entity_id:x.id})[0];return x.assessment_start||a?object('Assessment',{id:encodeGid('Assessment',x.id),legacyId:x.id,title:x.title,status:(a?.status||(x.assessment_start?'scheduled':x.status)).toUpperCase(),isComplete:a?.status==='completed',startAt:x.assessment_start||a?.start_at,endAt:x.assessment_end||a?.end_at,instructions:x.assessment_instructions||x.internal_notes||'',assignedUsers:args=>assignedUsersConn(a?parseAssignedIds(a.assigned_user_ids_json):[x.assigned_user_id],args)}):null;}});for(const t of ['Quote','Job'])conn(entities[t][3],t,{request_id:x.id});}
  if(['Quote','Invoice'].includes(type)){const quote=type==='Quote';Object.assign(value,{[quote?'quoteNumber':'invoiceNumber']:String(x[quote?'quote_number':'invoice_number']||x.id),[quote?'quoteStatus':'invoiceStatus']:x.status.toUpperCase(),message:x.client_message});const amounts={subtotal:x.subtotal_cents/100,discountAmount:x.discount_cents/100,taxAmount:x.tax_cents/100,total:x.total_cents/100,depositAmount:(quote?x.required_deposit_cents:x.deposits_applied_cents)/100};for(const k of ['subtotal_cents','discount_cents','tax_cents','total_cents',...(quote?['required_deposit_cents','deposit_paid_cents']:['amount_paid_cents','balance_due_cents'])])amounts[camel(k)]=x[k];Object.assign(amounts,quote?{paidDepositAmount:x.deposit_paid_cents/100}:{paymentsTotal:x.amount_paid_cents/100,invoiceBalance:x.balance_due_cents/100});value.amounts=object(type+'Amounts',amounts);value.lineItems=a=>{check(type);const table=quote?'quote_line_items':'invoice_line_items';const map=l=>object(type+'LineItem',{id:encodeGid(type+'LineItem',l.id),legacyId:l.id,name:l.name,description:l.description,quantity:l.quantity,unitPrice:l.unit_price_cents/100,totalPrice:l.total_cents/100,unitPriceCents:l.unit_price_cents,totalCents:l.total_cents,taxable:!!l.taxable,isOptional:!!l.is_optional,isSelected:!!l.is_selected});return connection(type+'LineItem',r.list(table,{[quote?'quote_id':'invoice_id']:x.id}),a,map,step);};if(quote){value.issuedAt=x.issued_date;conn('jobs','Job',{quote_id:x.id});}else {value.invoiceNet=x.payment_terms;conn('paymentRecords','PaymentRecord',{invoice_id:x.id});}}
  if(type==='Job'){value.lineItems=a=>{check('Job');const cached=jobLinesCache.has(x.id),{rows,fromStored,fromQuote}=getJobLines(x),prefix=fromStored?'line:':fromQuote?'quote:':'',map=l=>object('JobLineItem',{id:encodeGid('JobLineItem',prefix+l.id),legacyId:l.id,name:l.name,description:l.description,quantity:l.quantity,unitPrice:l.unit_price_cents/100,totalPrice:l.total_cents/100,unitPriceCents:l.unit_price_cents,totalCents:l.total_cents,taxable:!!l.taxable});const lineNs=fromStored?'line:':fromQuote?'quote:':'job:',taggedRows=rows.map(r=>({...r,lineKey:lineNs+r.id}));return connection('JobLineItem',taggedRows,a,map,cached?step:null,step);};Object.assign(value,{jobNumber:String(x.job_number||x.id),jobStatus:x.status.toUpperCase(),jobType:x.job_type.toUpperCase(),billingType:x.billing_type.toUpperCase(),total:x.total_cents/100,subtotal:x.subtotal_cents/100,taxAmount:x.tax_cents/100,jobCosting:()=>{check('TimeSheetEntry');check('Expense');if(!costingCache.has(x.id)){const n=(db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE organization_id=? AND job_id=?').get(user.organization_id,x.id).n||1)+(db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE organization_id=? AND job_id=?').get(user.organization_id,x.id).n||1);step(n);costingCache.set(x.id,object('JobCosting',Object.fromEntries(Object.entries(w.costing(x.id)).flatMap(([k,v])=>[[k,v],[camel(k),v]]))));}else step(1);return costingCache.get(x.id);}});for(const t of ['Visit','Invoice','TimeSheetEntry','Expense'])conn(entities[t][3],t,{job_id:x.id});}
  if(type==='Visit')Object.assign(value,{instructions:x.instructions||'',completionNotes:x.completion_notes||'',status:x.status.toUpperCase(),visitStatus:x.status.toUpperCase(),isComplete:x.status==='completed',invoiced:!!x.invoiced,startAt:x.scheduled_start,endAt:x.scheduled_end,billableAmount:x.billable_amount_cents/100,assignedUsers:a=>assignedUsersConn(parseAssignedIds(x.assigned_user_ids_json),a)});
  if(type==='PaymentRecord')Object.assign(value,{amount:x.amount_cents/100,refundedAmount:x.refunded_cents/100,paymentMethod:x.method.toUpperCase(),paymentType:x.payment_type.toUpperCase(),status:x.status.toUpperCase(),entryDate:x.paid_at});
  if(type==='Expense'){Object.assign(value,{title:x.item_name,amount:x.amount_cents/100,date:x.date_incurred,reimbursable:!!x.reimbursable});rel('paidByUser','User',x.user_id);}
  if(type==='TimeSheetEntry')Object.assign(value,{duration:x.duration_minutes*60,note:x.notes,label:x.category,hourlyCost:x.hourly_cost_cents/100,totalCost:x.total_cost_cents/100});
  if(type==='ProductOrService')Object.assign(value,{defaultUnitCost:x.unit_price_cents/100,internalUnitCost:x.unit_cost_cents/100,markup:x.markup_percent,taxable:!!x.taxable,visible:!!x.active});
  if(type==='Task'){Object.assign(value,{status:x.status.toUpperCase(),isComplete:x.status==='completed',startAt:taskTime(x.due_date,x.start_time)??(x.due_date?`${x.due_date}T00:00:00Z`:null),endAt:taskTime(x.due_date,x.end_time)});rel('assignedUser','User',x.assigned_user_id);}
  return value;
 }
 function mapConnection(type,rows,args){return connection(type,rows,args,x=>mapped(type,x),null,step);}
 async function mutate(name,args,selection){const spec=mutations[name];if(!spec)throw new Error(`Unknown mutation ${name}`);const {type,route,verb}=spec;let outputType=type;if(verb==='ConvertToJob')outputType='Job';if(verb==='Invoice')outputType='Invoice';if(verb==='RecordPayment')outputType='PaymentRecord';const field=entities[outputType][2],payload=object(name[0].toUpperCase()+name.slice(1)+'Payload',{[field]:null,userErrors:[]});
  try{check(type,true);const input={...args,...(args.input||{})};delete input.input;const chargeInput=v=>{step(1);if(Array.isArray(v))for(const x of v)chargeInput(x);else if(v&&typeof v==='object')for(const k of Object.keys(v))chargeInput(v[k]);};chargeInput(input);const rawId=input.id??input[type[0].toLowerCase()+type.slice(1)+'Id']??input[snake(type)+'_id']??input[entities[type][2]+'Id']??input[snake(entities[type][2])+'_id']??(type==='PaymentRecord'?input.paymentId??input.payment_id:type==='ProductOrService'?input.productServiceId??input.product_service_id??input.serviceId??input.service_id:type==='TimeSheetEntry'?input.timeEntryId??input.time_entry_id:type==='Job'?input.workOrderId??input.work_order_id:type==='Request'?input.workRequestId??input.work_request_id:null),existing=verb==='Edit'&&['Quote','Invoice','Client','Job','WebhookSubscription'].includes(type)?r.get(entities[type][0],decodeGid(rawId,type)):null;if(type==='Job'&&existing)hydrateJobState(db,user.organization_id,existing,step);const d=type==='WebhookSubscription'&&verb==='Delete'?{id:decodeGid(rawId,type)}:normalizeInput(input,type,existing),id=d.id||d[snake(type)+'_id']||d[snake(entities[type][2])+'_id']||(type==='PaymentRecord'?d.payment_id:type==='ProductOrService'?d.product_service_id||d.service_id:null);delete d.id;if(Array.isArray(d.items))step(d.items.length);
   const visitJobId=type==='Visit'&&verb==='Create'?d.job_id:null;
   let path=`/api/${route}`,http='POST';if(verb==='Edit'){path+='/'+id;http='PATCH';}else if(verb==='Delete'){path+='/'+id;http='DELETE';}else if(verb==='Merge')path+='/merge';else if(verb==='Create'&&type==='Visit'){path=`/api/jobs/${d.job_id}/visit`;delete d.job_id;}else if(verb==='ClockIn'){path=`/api/team/${d.user_id||user.id}/clock-in`;delete d.user_id;}else if(verb==='RecordPayment'){check('PaymentRecord',true);path='/api/payments';const inv=r.get('invoices',id||d.invoice_id);d.invoice_id=inv.id;d.client_id=inv.client_id;}else if(verb!=='Create'){const action={ScheduleAssessment:'assessment',ConvertToJob:'job',Invoice:'invoice',Send:type==='Invoice'?'issue':'send',RequestChanges:'request-changes',ApplyDeposit:'apply-deposit',ClockOut:'clock-out'}[verb]||verb.toLowerCase();path+=`/${id}/${action}`;}
   if(verb==='ConvertToJob')check('Job',true);if(verb==='Invoice')check('Invoice',true);if(verb==='ScheduleAssessment')check('Visit',true);
   if(verb!=='Create'&&verb!=='RecordPayment')for(const key of [snake(type)+'_id',snake(entities[type][2])+'_id',...(type==='PaymentRecord'?['payment_id']:type==='ProductOrService'?['product_service_id','service_id']:[])])delete d[key];
   const requested=expand(selection||[],payload.__typename).some(s=>s.field===field);if(requested)check(outputType,false);
   if(type==='Job'&&verb==='Invoice'){
    const targetJob=r.get('jobs',id);
    if(Array.isArray(d.visit_ids)&&d.visit_ids.length)step(d.visit_ids.length);
    else {step(db.prepare('SELECT COUNT(*) AS n FROM visits WHERE organization_id=? AND job_id=?').get(user.organization_id,id).n||1);if(targetJob.billing_type!=='visit_based'){step(db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE organization_id=? AND job_id=?').get(user.organization_id,id).n);hydrateJobState(db,user.organization_id,targetJob,step);}}
   }
   if(type==='Job'&&verb==='Complete')step(db.prepare('SELECT COUNT(*) AS n FROM visits WHERE organization_id=? AND job_id=?').get(user.organization_id,id).n||1);
   if(type==='Visit'&&verb==='Complete')step((db.prepare('SELECT COUNT(*) AS n FROM checklists WHERE organization_id=? AND visit_id=?').get(user.organization_id,id).n||0)+(db.prepare('SELECT COUNT(*) AS n FROM checklist_items WHERE organization_id=? AND checklist_id IN (SELECT id FROM checklists WHERE visit_id=? AND organization_id=?)').get(user.organization_id,id,user.organization_id).n||1));
   if(type==='Quote'&&verb==='ConvertToJob')step((db.prepare('SELECT COUNT(*) AS n FROM quote_line_items WHERE organization_id=? AND quote_id=?').get(user.organization_id,id).n||1)+db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE organization_id=? AND quote_id=?').get(user.organization_id,id).n);
   if(verb==='Edit'&&(type==='Quote'||type==='Invoice'))step(db.prepare(`SELECT COUNT(*) AS n FROM ${type==='Quote'?'quote_line_items':'invoice_line_items'} WHERE organization_id=? AND ${type==='Quote'?'quote_id':'invoice_id'}=?`).get(user.organization_id,existing.id).n||1);
   const chargeReconcile=(clientId,paymentId=null)=>{
    if(clientId){
     const invCount=db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE organization_id=? AND client_id=?').get(user.organization_id,clientId).n;
     const allocCount=db.prepare('SELECT COUNT(*) AS n FROM payment_allocations WHERE organization_id=? AND invoice_id IN (SELECT id FROM invoices WHERE organization_id=? AND client_id=?)').get(user.organization_id,user.organization_id,clientId).n;
     const refCount=db.prepare('SELECT COUNT(*) AS n FROM refunds WHERE organization_id=? AND invoice_id IN (SELECT id FROM invoices WHERE organization_id=? AND client_id=?)').get(user.organization_id,user.organization_id,clientId).n;
     step((invCount||1)+allocCount+refCount);
    }
    if(paymentId){
     const pAlloc=db.prepare('SELECT COUNT(*) AS n FROM payment_allocations WHERE organization_id=? AND payment_id=?').get(user.organization_id,paymentId).n;
     const pRef=db.prepare('SELECT COUNT(*) AS n FROM refunds WHERE organization_id=? AND payment_id=?').get(user.organization_id,paymentId).n;
     step(pAlloc+pRef);
    }
   };
   if(type==='PaymentRecord'&&verb==='Create')chargeReconcile(d.client_id||(d.invoice_id?r.get('invoices',d.invoice_id).client_id:d.quote_id?r.get('quotes',d.quote_id).client_id:null));
   if(type==='Invoice'&&verb==='RecordPayment')chargeReconcile(d.client_id);
   if(type==='Invoice'&&['Send','ApplyDeposit','Credit'].includes(verb))chargeReconcile(r.get('invoices',id).client_id,verb==='ApplyDeposit'?d.payment_id:null);
   if(type==='PaymentRecord'&&verb==='Refund')chargeReconcile(r.get('payments',id).client_id,id);
   if(type==='Client'&&verb==='Merge'&&d.source_id){
    for(const [table,fields] of Object.entries(columns))if(fields.includes('client_id'))step(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id=? AND client_id=?`).get(user.organization_id,d.source_id).n);
    for(const table of ['entity_tags','custom_field_values','attachments'])step(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id=? AND entity_type='clients' AND entity_id=?`).get(user.organization_id,d.source_id).n);
   }
   if(verb==='ScheduleAssessment'||(type==='Visit'&&(verb==='Reschedule'||(verb==='Create'&&(d.scheduled_start||d.start_at))))){
    const chargeTeamJson=raw=>{
     if(typeof raw==='string'&&raw.length>40000)step(Math.ceil(raw.length/2));
     let parsed;try{parsed=typeof raw==='string'?JSON.parse(raw):raw;}catch{}
     if(Array.isArray(parsed)){if(parsed.length)step(parsed.length);}
     else if(typeof raw==='string'&&raw.length>2)step(Math.ceil(raw.length/2));
    };
    const appts=db.prepare('SELECT assigned_user_ids_json FROM appointments WHERE organization_id=?').all(user.organization_id);
    step(appts.length||1);
    for(const a of appts)chargeTeamJson(a.assigned_user_ids_json);
    if(type==='Visit'&&!Array.isArray(d.assigned_user_ids_json)){
     chargeTeamJson(verb==='Reschedule'?r.get('visits',id).assigned_user_ids_json:r.get('jobs',visitJobId).assigned_user_ids_json);
    }
   }
   const triggerEvent=(type==='Client'&&verb==='Create')?'client_created':(type==='Request'&&verb==='Create')?'request_submitted':(type==='Quote'&&verb==='Send')?'quote_sent':(type==='Quote'&&verb==='Approve')?'quote_approved':(type==='Visit'&&verb==='Create')?'job_scheduled':(type==='Job'&&verb==='Complete')?'job_completed':(type==='Invoice'&&verb==='Send')?'invoice_issued':((type==='PaymentRecord'&&verb==='Create')||(type==='Invoice'&&verb==='RecordPayment'))?'payment_received':null;
   if(triggerEvent){
    const hooks=db.prepare('SELECT id FROM webhook_subscriptions WHERE organization_id=? AND active=1').all(user.organization_id);
    if(hooks.length)step(hooks.length);
    const rules=db.prepare('SELECT conditions_json FROM automations WHERE organization_id=? AND trigger_event=? AND is_enabled=1').all(user.organization_id,triggerEvent);
    if(rules.length)step(rules.length);
    for(const rule of rules){
     const raw=rule.conditions_json;
     if(typeof raw==='string'&&raw.length>40000)step(Math.ceil(raw.length/2));
     let conds;try{conds=typeof raw==='string'?JSON.parse(raw):raw;}catch{}
     if(conds&&typeof conds==='object'&&Object.keys(conds).length)chargeInput(conds);
     else if(typeof raw==='string'&&raw.length>2)step(Math.ceil(raw.length/2));
    }
   }
   const result=await dispatch(http,path,d);lineState=null;costingCache.clear();roleCache.clear();jobLinesCache.clear();hasJobLinesCache.clear();quoteActiveCache.clear();const targetId=verb==='Merge'?d.target_id||result?.id:outputType===type&&!['Create','Merge','ClockIn'].includes(verb)?id:result?.id;if(verb==='Delete')payload.deletedId=encodeGid(type,id);else if(requested)payload[field]=mapped(outputType,r.get(entities[outputType][0],targetId));
  }catch(e){if(e.fatal||e.status===403)throw e;payload.userErrors=[object('UserError',{message:e.message,path:[]})];}return payload;
 }
 function node(id){
  const raw=String(id).startsWith('gid://')?id:Buffer.from(String(id),'base64').toString(),type=/^gid:\/\/jobber\/([^/]+)\//.exec(raw)?.[1];
  if(!nodeTypes.has(type))throw new Error('Invalid Global ID');const numId=decodeGid(id,type);
  if(entities[type])return mapped(type,row(type,numId));
  const line=l=>l?object(type,{id:encodeGid(type,l.id),legacyId:l.id,name:l.name,description:l.description,quantity:l.quantity,unitPrice:l.unit_price_cents/100,totalPrice:l.total_cents/100,unitPriceCents:l.unit_price_cents,totalCents:l.total_cents,taxable:!!l.taxable,...(type==='JobLineItem'?{}:{isOptional:!!l.is_optional,isSelected:!!l.is_selected})}):null;
  if(type==='QuoteLineItem'||type==='InvoiceLineItem'){const quote=type==='QuoteLineItem';check(quote?'Quote':'Invoice');step(1);return line(r.list(quote?'quote_line_items':'invoice_line_items',{id:numId})[0]);}
  if(type==='JobLineItem'){
   check('Job');const prefix=/\/(quote|line|job):\d+$/.exec(raw)?.[1];
   if(prefix==='quote'){
    step(1);const ql=r.list('quote_line_items',{id:numId})[0];if(!ql||(ql.is_optional&&!ql.is_selected))return null;
    if(!hasActiveQuoteJob(ql.quote_id))return null;
    return {...line(ql),id:encodeGid('JobLineItem','quote:'+ql.id)};
   }
   if(prefix==='line'){
    const hit=getLineState().byLineId.get(numId);step(1);
    if(!hit||!r.list('jobs',{id:hit.jobId})[0])return null;
    const l=hit.line;return !l.is_optional||l.is_selected?{...line(l),id:encodeGid('JobLineItem','line:'+l.id)}:null;
   }
   step(1);const job=r.list('jobs',{id:numId})[0];
   if(job&&!hasStoredJobLines(job.id)&&!(job.quote_id&&db.prepare('SELECT 1 FROM quote_line_items WHERE organization_id=? AND quote_id=? LIMIT 1').get(user.organization_id,job.quote_id))){
    const fallbackLine={id:job.id,name:job.title,description:job.instructions||'',quantity:1,unit_price_cents:job.subtotal_cents||job.total_cents,total_cents:job.total_cents,taxable:job.tax_cents>0?1:0};
    return prefix==='job'?{...line(fallbackLine),id:encodeGid('JobLineItem','job:'+job.id)}:line(fallbackLine);
   }
   if(prefix==='job')return null;
   const hit=getLineState().byLineId.get(numId);
   return hit&&r.list('jobs',{id:hit.jobId})[0]&&(!hit.line.is_optional||hit.line.is_selected)?line(hit.line):null;
  }
  if(type==='Assessment'){check('Visit');const req=r.list('requests',{id:numId})[0],a=r.list('appointments',{entity_type:'assessment',entity_id:numId})[0];step(1);return req?.assessment_start||a?object('Assessment',{id:encodeGid(type,numId),legacyId:numId,title:req?.title||a.title,status:(a?.status||'scheduled').toUpperCase(),isComplete:a?.status==='completed',startAt:req?.assessment_start||a?.start_at,endAt:req?.assessment_end||a?.end_at,instructions:()=>{check('Request');return req?.assessment_instructions||req?.internal_notes||'';},assignedUsers:args=>assignedUsersConn(a?parseAssignedIds(a.assigned_user_ids_json):[req?.assigned_user_id],args)}):null;}
  if(type==='Email'){check('Client');const client=r.list('clients',{id:numId})[0];step(1);return client?.email?object('Email',{id:encodeGid(type,client.id),address:client.email,primary:true}):null;}
  const isUser=raw.includes('/user:');check(isUser?'User':'Client');const contact=r.list(isUser?'users':'clients',{id:numId})[0];step(1);return contact&&(isUser||contact.phone)?object('PhoneNumber',{id:encodeGid(type,(isUser?'user:':'client:')+contact.id),raw:contact.phone||'',number:contact.phone||'',primary:true,smsAllowed:isUser||!!contact.receives_sms}):null;
 }
 const queryFields=['account','currentUser','node','scheduledItems',...Object.values(entities).flatMap(x=>x.slice(2))];
 const typeInfo=name=>{if(!fieldsByType[name]&&!['Query','Mutation','Node'].includes(name))return null;const names=name==='Query'?queryFields:name==='Mutation'?Object.keys(mutations):name==='Node'?['id']:['id','legacyId',...fieldsByType[name].split(' ')];return object('__Type',{kind:name==='Node'?'INTERFACE':'OBJECT',name,description:null,fields:names.map(n=>object('__Field',{name:n,description:null,args:[],type:object('__Type',{kind:'SCALAR',name:n==='id'?'ID':'String',ofType:null}),isDeprecated:false,deprecationReason:null})),interfaces:name==='Query'||name==='Mutation'?[]:[object('__Type',{kind:'INTERFACE',name:'Node'})],possibleTypes:name==='Node'?[...nodeTypes].map(n=>object('__Type',{kind:'OBJECT',name:n})):null,enumValues:null,inputFields:null,ofType:null});};
 async function root(field,args,kind,selection){if(kind==='mutation')return mutate(field,args,selection);if(field==='__schema')return object('__Schema',{queryType:typeInfo('Query'),mutationType:typeInfo('Mutation'),subscriptionType:null,types:['Query','Mutation','Node',...Object.keys(entities)].map(typeInfo),directives:['include','skip'].map(n=>object('__Directive',{name:n,description:null,locations:['FIELD','FRAGMENT_SPREAD','INLINE_FRAGMENT'],args:[],isRepeatable:false}))});if(field==='__type')return typeInfo(args.name);if(field==='account'){check('Account');return mapped('Account',org());}if(field==='currentUser')return mapped('User',user);if(field==='node')return node(args.id);if(field==='scheduledItems'){check('Visit');const items=[...list('Visit').map(v=>({...v,itemType:'Visit',cursorId:'visit:'+v.id})),...r.list('appointments',{entity_type:'assessment'}).map(a=>({...a,id:a.entity_id,itemType:'Assessment',cursorId:'assessment:'+a.entity_id})),...list('Task').map(t=>({...t,itemType:'Task',cursorId:'task:'+t.id}))];return connection('ScheduledItem',items,args,a=>{if(a.itemType!=='Assessment')return mapped(a.itemType,a);step();return object('Assessment',{id:encodeGid('Assessment',a.entity_id),legacyId:a.entity_id,title:a.title,status:(a.status||"scheduled").toUpperCase(),isComplete:a.status==='completed',startAt:a.start_at,endAt:a.end_at,instructions:()=>{check('Request');const req=r.list('requests',{id:a.entity_id})[0];return req?.assessment_instructions||req?.internal_notes||'';},assignedUsers:uArgs=>assignedUsersConn(parseAssignedIds(a.assigned_user_ids_json),uArgs)});},step);}for(const [type,[,,singular,plural]] of Object.entries(entities)){if(field===singular)return mapped(type,row(type,args.id));if(field===plural)return mapConnection(type,list(type),args);}throw new Error(`Unknown query field ${field}`);}
 try{
  const ast=parseGraphQL(query),names=ast.operations.map(x=>x.name).filter(Boolean);if(new Set(names).size!==names.length)throw new Error('Duplicate operation name');if(ast.operations.length>1&&ast.operations.some(x=>!x.name))throw new Error('Anonymous operation must be alone');const op=operationName?ast.operations.find(x=>x.name===operationName):ast.operations.length===1?ast.operations[0]:null;if(!op)throw new Error('Select a valid operationName');if(method==='GET'&&op.kind==='mutation')throw new Error('Mutations require POST');
  let validationSteps=0,validating=true;const validationStep=()=>{if(++validationSteps>20000)throw new Error('Query cost exceeded');};
  function checkVar(val,t,name){
   validationStep();
   if(val==null){if(t.required)throw new Error(`Variable $${name} is required`);return;}
   if(t.list){if(!Array.isArray(val))throw new Error(`Invalid variable $${name}`);for(const item of val)checkVar(item,t.list,name);return;}
   if(t.name==='Int'&&(!Number.isInteger(val)||val<-2147483648||val>2147483647)||t.name==='Float'&&(typeof val!=='number'||!Number.isFinite(val))||t.name==='Boolean'&&typeof val!=='boolean'||t.name==='String'&&typeof val!=='string'||['ID','EncodableId'].includes(t.name)&&!['string','number'].includes(typeof val))throw new Error(`Invalid variable $${name}`);
   if(!['Int','Float','Boolean','String','ID','EncodableId'].includes(t.name)){if(typeof val!=='object'||Array.isArray(val))throw new Error(`Invalid variable $${name}`);for(const k of Object.keys(val))validationStep();}
  }
  const declaredVars=new Set(op.variables.map(v=>v.name)),vars={},valueCache=new WeakMap();const evalValue=v=>evaluate(v,vars,declaredVars,valueCache,validating?validationStep:null);for(const v of op.variables){if(Object.hasOwn(variables||{},v.name))vars[v.name]=variables[v.name];else if(v.default!==undefined)vars[v.name]=evaluate(v.default,{},new Set(),new WeakMap(),validationStep);checkVar(vars[v.name],v.type,v.name);}
  const included=dirs=>(dirs||[]).every(d=>{const value=evalValue(d.args.if);if(typeof value!=='boolean')throw new Error(`@${d.name} requires Boolean if`);return d.name==='skip'?!value:value;});
  const typeMatches=typeCompatible;
  const evalArgs=args=>Object.fromEntries(Object.entries(args).map(([k,v])=>[k,evalValue(v)]));
  const eqCache=new WeakMap(),validated=new WeakMap(),conflictChecked=new WeakMap(),groupedSelections=new WeakMap();
  const getArgs=f=>(f._args??=evalArgs(f.args));
  const listFields=new Set(['nodes','edges','userErrors','emails','phones','types','directives','fields','interfaces','possibleTypes','enumValues','inputFields','args','locations','path']);
  const seen=(cache,selection,type)=>{let types=cache.get(selection);if(types?.has(type))return true;if(!types)cache.set(selection,types=new Set());types.add(type);return false;};
  expand=function expand(selection,type,stack=[]){const out=[];for(const f of selection){if(validating)validationStep();if(!included(f.dirs))continue;if(f.spread){const fragment=ast.fragments[f.spread];if(!fragment)throw new Error(`Unknown fragment ${f.spread}`);if(stack.includes(f.spread))throw new Error('Fragment cycle');if(included(fragment.dirs)&&typeMatches(fragment.type,type))out.push(...expand(fragment.selection,type,[...stack,f.spread]));}else if(!f.field){if(typeMatches(f.type,type))out.push(...expand(f.selection,type,stack));}else out.push(f);}return out;}
  function count(s,depth=0,stack=[]){if(depth>30)throw new Error('Query depth exceeded');let n=0;for(const f of s){if(f.spread){if(stack.includes(f.spread))throw new Error('Fragment cycle');const fragment=ast.fragments[f.spread];if(!fragment)throw new Error(`Unknown fragment ${f.spread}`);n+=count(fragment.selection,depth+1,[...stack,f.spread]);}else {n++;if(f.selection)n+=count(f.selection,depth+1,stack);}if(n>5000)throw new Error('Query cost exceeded');}return n;}
  requestedQueryCost=count(op.selection);
  function validate(selection,type,stack=[],depth=0){
   validationStep();if(seen(validated,selection,`${type}:${depth}`))return;
   const fields=selectionTypes[type];if(!fields)throw new Error(`Unknown type ${type}`);
   for(const f of selection){validationStep();included(f.dirs);if(f.spread){const fragment=ast.fragments[f.spread];if(!fragment)throw new Error(`Unknown fragment ${f.spread}`);if(stack.includes(f.spread))throw new Error('Fragment cycle');if(!selectionTypes[fragment.type])throw new Error(`Unknown type ${fragment.type}`);if(!typeCompatible(fragment.type,type))throw new Error(`Fragment ${f.spread} cannot spread on ${type}`);included(fragment.dirs);validate(fragment.selection,fragment.type,[...stack,f.spread],depth);continue;}if(!f.field){if(f.type&&!selectionTypes[f.type])throw new Error(`Unknown type ${f.type}`);if(!typeCompatible(f.type,type))throw new Error(`Inline fragment on ${f.type} cannot spread on ${type}`);validate(f.selection,f.type||type,stack,depth);continue;}
    if(f.field!=='__typename'&&!Object.hasOwn(fields,f.field))throw new Error(`Unknown field ${type}.${f.field}`);
    const fieldDepth=depth+1,elemDepth=fieldDepth+(listFields.has(f.field)?1:0);if(fieldDepth>40||elemDepth>40)throw new Error('Result depth exceeded');
    getArgs(f);
    const target=f.field==='__typename'?null:fields[f.field];if(target){if(!f.selection?.length)throw new Error(`Object field ${type}.${f.field} requires a selection`);validate(f.selection,target,stack,elemDepth);}else if(f.selection)throw new Error(`Scalar field ${type}.${f.field} cannot have a selection`);
   }
  }
  function getGroupedSelection(selection,targetType,stack=[]){
   let types=groupedSelections.get(selection);if(types?.has(targetType))return types.get(targetType);
   const grouped=new Map(),cloned=new Map();
   for(const f of expand(selection,targetType,stack)){
    if(!validating)step(1);
    const previous=grouped.get(f.alias);
    if(previous){
     if(previous.field!==f.field||!argsEqual(getArgs(previous),getArgs(f),eqCache))throw new Error(`Conflicting fields ${f.alias}`);
     if(f.selection){
      let entry=cloned.get(f.alias);
      if(!entry){
       const list=previous.selection?[...previous.selection]:[];
       const merged={...previous,selection:list};
       entry={merged,seen:new Set(list)};
       cloned.set(f.alias,entry);grouped.set(f.alias,merged);
      }
      for(const child of f.selection)if(!entry.seen.has(child)){entry.seen.add(child);entry.merged.selection.push(child);}
     }
    }else grouped.set(f.alias,f);
   }
   if(!types)groupedSelections.set(selection,types=new Map());types.set(targetType,grouped);return grouped;
  }
  function validateConflicts(selection,type,stack=[]){
   const targets=type==='Node'?[...nodeTypes]:type==='ScheduledItem'?['Visit','Assessment','Task']:[type];
   for(const target of targets){validationStep();if(seen(conflictChecked,selection,target))continue;const grouped=getGroupedSelection(selection,target,stack);
    for(const f of grouped.values()){const child=selectionTypes[target]?.[f.field]||selectionTypes[type]?.[f.field];if(child&&f.selection)validateConflicts(f.selection,child,stack);}
   }
  }
  const rootType=op.kind==='mutation'?'Mutation':'Query';validate(op.selection,rootType);validateConflicts(op.selection,rootType);validating=false;
  async function project(value,selection,path=[],depth=0){if(value==null)return null;if(depth>40)throw Object.assign(new Error('Result depth exceeded'),{fatal:true});if(Array.isArray(value)){const result=[];for(const [i,v] of value.entries())result.push(await project(v,selection,[...path,i],depth+1));return result;}if(!selection){if(typeof value==='object')throw new Error('Object field requires a selection');return value;}
   if(typeof value!=='object')throw new Error('Scalar field cannot have a selection');const result=Object.create(null);const grouped=getGroupedSelection(selection,value.__typename);
   for(const f of grouped.values()){const p=[...path,f.alias];try{step();const a=getArgs(f);let v;if(f.field==='__typename')v=value.__typename;else if(path.length===0)v=await root(f.field,a,op.kind,f.selection);else {if(!Object.hasOwn(value,f.field))throw new Error(`Unknown field ${value.__typename}.${f.field}`);v=typeof value[f.field]==='function'?await value[f.field](a):value[f.field];}result[f.alias]=await project(v,f.selection,p,depth+1);}catch(e){if(e.fatal)throw e;result[f.alias]=null;errors.push({message:e.message,path:p});}}return result;
  }
  data=await project(object(op.kind==='mutation'?'Mutation':'Query',{}),op.selection);
 }catch(e){errors.push({message:e.message});}
 return {data,...(errors.length?{errors}:{}),extensions:{cost:{requestedQueryCost,actualQueryCost,throttleStatus:{maximumAvailable:10000,currentlyAvailable:Math.max(0,10000-actualQueryCost),restoreRate:500}},versioning:{version}}};
}
