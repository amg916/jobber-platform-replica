import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext, runInContext } from 'node:vm';
import { pipeline, movePipeline, bookkeeping, editDocument } from '../src/services/workspace.js';
import { migrate } from '../src/db/schema.js';
import { createDatabase, repository } from '../src/db/database.js';
import { seedDatabase } from '../src/db/seed.js';
import { workflows } from '../src/services/workflows.js';
import { startServer } from '../src/server.js';

const appSource=readFileSync(new URL('../src/public/app.js',import.meta.url),'utf8');
function domHarness(){
 const elements=new Map(),listeners={},calls=[];
 const element=()=>({innerHTML:'',textContent:'',style:{},dataset:{},classList:{remove(){},toggle(){}},setAttribute(){},querySelector(){return null;}});
 for(const key of ['#overlay','#toast','#action-form','#builder','#workspace'])elements.set(key,element());
 const context=createContext({calls,console,Intl,Date,URL,Blob,setTimeout(){},sessionStorage:{getItem(){return null;}},location:{pathname:'/hub/test'},history:{pushState(){}},window:{},document:{querySelector:s=>elements.get(s)||null,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn},FormData:class{constructor(form){return Object.entries(form.values||{});}},fetch:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>[]};}});
 runInContext(appSource.slice(0,appSource.lastIndexOf('init().catch')),context);
 return {context,elements,listeners,calls,run:code=>runInContext(code,context),click:dataset=>{const target={dataset,tagName:'BUTTON',hasAttribute:()=>false,closest:()=>null};return listeners.click({target:{closest:s=>s==='button,a,[data-slot],tr[data-id]'?target:null,matches:()=>false},preventDefault(){}});}};
}
function fixture(t){const db=createDatabase();seedDatabase(db);t.after(()=>db.close());return workflows(db,1,1);}
async function httpFixture(t){const db=createDatabase();seedDatabase(db);const server=await startServer({db,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});const session=await (await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json();return {db,w:workflows(db,1,1),request:async(path,method='GET',data)=>{const res=await fetch(server.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,body:await res.json()};}};}

const artwork=['quotes_deep_lawn','marketing_reviews_art','timesheets_banner_art','expenses_forwarding_art','onboarding_avatar'];
test('Astra 1: refund writes require the reconciliation workflow',async t=>{
 const {w,request}=await httpFixture(t),p=w.recordPayment({client_id:1,amount_cents:1000}),refund=w.refund(p.id,100);
 for(const [path,method,data] of [['refunds','POST',{payment_id:p.id,client_id:1,amount_cents:100}],['refunds/'+refund.id,'PATCH',{amount_cents:200}],['refunds/'+refund.id,'PUT',{reason:'changed'}]]){const result=await request(path,method,data);assert.equal(result.status,400);assert.match(result.body.error,/workflow/);}
 assert.equal(w.r.get('payments',p.id).refunded_cents,100);assert.equal(w.r.get('refunds',refund.id).amount_cents,100);
});
test('Astra 2: document DOM round trip preserves line metadata and fixed types',async t=>{
 const h=domHarness(),line={name:'Optional & special',quantity:2,unit_price_cents:1200,is_optional:1,is_selected:0,taxable:0,unit_cost_cents:500,markup_percent:20,unit:'hour',description:'Keep me',product_service_id:1};
 h.context.doc={id:9,title:'Draft',items:[line],discount_type:'fixed',discount_value:100,required_deposit_type:'fixed',required_deposit_value:200};h.context.line=line;
 h.run("fetch=async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/api/quotes/9'&&!options.body?doc:[]};};render=async()=>{};");
 await h.run("builder('quotes',9)");assert.match(h.elements.get('#overlay').innerHTML,/data-line=".*&quot;is_optional&quot;/);
 h.context.document.querySelectorAll=()=>[{dataset:{line:JSON.stringify(line)},querySelector:s=>({value:s==='[data-name]'?line.name:s==='[data-qty]'?'2':'12'})}];
 assert.match(h.elements.get('#overlay').innerHTML,/name="discount_value"[^>]*value="1"/);assert.match(h.elements.get('#overlay').innerHTML,/name="required_deposit_value"[^>]*value="2"/);
 const numberInputs=h.elements.get('#overlay').innerHTML.match(/<input\b[^>]*type="number"[^>]*>/g);assert.ok(numberInputs.length);for(const input of numberInputs)assert.match(input,/step="(?:any|\.01)"/);
 const w=fixture(t),quote=w.createQuote({client_id:1,title:'Draft'},[line]);
 for(const types of [{discount_type:'fixed',required_deposit_type:'fixed'},{}]){
  await h.run("builder('quotes',9)");h.calls.length=0;
  await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{title:'Edited',discount_value:'1',required_deposit_value:'2',...types}}});
  const sent=JSON.parse(h.calls.find(x=>x.options.method==='PATCH').options.body);assert.deepEqual(sent.items[0],line);assert.equal(sent.discount_type,'fixed');assert.equal(sent.discount_value,100);assert.equal(sent.required_deposit_type,'fixed');assert.equal(sent.required_deposit_value,200);
  const edited=editDocument(w,'quotes',quote.id,sent);assert.equal(edited.discount_value,100);assert.equal(edited.required_deposit_value,200);
 }
 h.context.document.querySelectorAll=()=>[{dataset:{},querySelector:s=>({value:s==='[data-name]'?'Work':s==='[data-qty]'?'1':'100'})}];
 await h.run("builder('quotes')");h.calls.length=0;
 await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{client_id:'1',title:'Deposit',discount_type:'percent',discount_value:'0',required_deposit_type:'percent',required_deposit_value:'25'}}});
 const sent=JSON.parse(h.calls.find(x=>x.options.method==='POST').options.body),{items,...fields}=sent;assert.equal(sent.required_deposit_type,'percent');assert.equal(sent.required_deposit_value,25);
 const created=w.createQuote(fields,items);assert.equal(created.required_deposit_cents,2500);assert.equal(editDocument(w,'quotes',created.id,{internal_notes:'Notes only'}).required_deposit_cents,2500);
 h.context.doc={...created,items};await h.run("builder('quotes',9)");h.calls.length=0;
 await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{title:'No deposit',discount_type:'fixed',discount_value:'10.50',required_deposit_type:'none',required_deposit_value:'25'}}});
 const cleared=JSON.parse(h.calls.find(x=>x.options.method==='PATCH').options.body);assert.equal(cleared.discount_value,1050);assert.equal(cleared.required_deposit_type,'none');assert.equal(cleared.required_deposit_value,25);
 const noDeposit=editDocument(w,'quotes',created.id,cleared);assert.equal(noDeposit.discount_value,1050);assert.equal(noDeposit.required_deposit_type,'none');assert.equal(noDeposit.required_deposit_cents,0);
});
test('Astra 3: assessment and visit DOM clicks use separate entity namespaces',async()=>{
 const h=domHarness();h.run('globalThis.actions=[];workflow=async(...args)=>actions.push(args)');
 for(const appointment of ['assessment:7','visit:7','7','task:7'])await h.click({appointment});
 assert.equal(JSON.stringify(h.run('actions')),JSON.stringify([['requests',7,'assessment'],['visits',7,'reschedule'],['visits',7,'reschedule']]));
 assert.match(appSource,/data-appointment="\$\{a.entity_type\}:\$\{a.entity_id\}"/);
});
test('Astra 4: employee Add Time DOM action credits that employee over HTTP',async t=>{
 const {request,w}=await httpFixture(t),h=domHarness();h.run('user={id:1};team=[{id:1,name:"Owner"},{id:3,name:"Employee"}]');
 h.context.fetch=async(path,options)=>{h.calls.push({path,options});return {ok:true,json:async()=>[]};};
 await h.click({action:'add-time:3'});await h.elements.get('#action-form').onsubmit({preventDefault(){},target:{values:{start_at:'2026-10-26T09:00',end_at:'2026-10-26T10:00',notes:'Employee work'}}});
 const data=JSON.parse(h.calls[0].options.body);assert.equal(data.user_id,3);const result=await request('time-entries','POST',data);assert.equal(result.status,201);assert.equal(result.body.user_id,3);assert.equal(result.body.duration_minutes,60);assert.equal(result.body.hourly_cost_cents,Math.round(w.r.get('users',3).hourly_cost*100));
 assert.match(appSource,/btn\('\+ Add Time','add-time:'\+t.id\)/);
});
test('Astra 5: timeline filters each resource and activity by read permission',async t=>{
 const {request,w,db}=await httpFixture(t),role=w.r.get('users',1).role_id;
 for(const entity_type of ['clients','quotes','refunds','visits'])w.r.insert('activity_logs',{client_id:1,entity_type,summary:entity_type});
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND resource IN ('requests','quotes','jobs','invoices','payments','messages','schedule') AND action='read'").run(role);
 const result=await request('clients/1/timeline');assert.equal(result.status,200);for(const key of ['requests','quotes','jobs','invoices','payments','messages'])assert.deepEqual(result.body[key],[]);
 assert.ok(result.body.activity.some(a=>a.entity_type==='clients'));assert.ok(result.body.activity.every(a=>!a.entity_type||a.entity_type==='clients'));
 db.prepare("UPDATE permissions SET allowed=1 WHERE role_id=? AND resource='quotes' AND action='read'").run(role);assert.ok((await request('clients/1/timeline')).body.activity.some(a=>a.entity_type==='quotes'));
});
test('Astra 6: delayed list, report and collection responses cannot overwrite current state',async()=>{
 for(const call of ["listPage('clients')","reportPage('Clients')","collection('catalog','Catalog')"]){const h=domHarness();h.run("globalThis.resolveFetch=null;fetch=()=>new Promise(resolve=>resolveFetch=resolve);viewVersion=1;resource='old';rows=[]");const pending=h.run(call);h.run("viewVersion=2;resource='invoices';rows=[{id:99}];resolveFetch({ok:true,json:async()=>[{id:1}]})");assert.equal(await pending,'');assert.equal(h.run('resource'),'invoices');assert.equal(h.run('rows[0].id'),99);}
});
test('Astra 7: action forms preserve portal and booking content, but refresh workspace',async()=>{
 for(const workspace of [false,true]){const h=domHarness();if(workspace)h.elements.set('#breadcrumb',{});h.run("globalThis.renders=0;render=async()=>{renders++};globalThis.submitted=false");await h.run("actionForm('Request','',async()=>{submitted=true;document.querySelector('#workspace').innerHTML='Portal refreshed'})");await h.elements.get('#action-form').onsubmit({preventDefault(){},target:{values:{}}});assert.equal(h.run('submitted'),true);assert.equal(h.run('renders'),workspace?1:0);assert.equal(h.elements.get('#workspace').innerHTML,'Portal refreshed');}
});
test('Astra 8: allocated refunds do not consume unallocated deposit twice',t=>{
 const w=fixture(t),q=w.createQuote({client_id:1,title:'Deposit',required_deposit_type:'fixed',required_deposit_value:10000},[{name:'Work',quantity:1,unit_price_cents:20000}]);
 const p=w.recordPayment({client_id:1,quote_id:q.id,amount_cents:10000}),i=w.createInvoice({client_id:1,subject:'Work'},[{name:'Work',quantity:1,unit_price_cents:20000}]);w.issueInvoice(i.id);w.applyDeposit(i.id,p.id,6000);w.refund(p.id,2000,'Allocated',i.id);assert.equal(w.r.get('invoices',i.id).deposits_applied_cents,4000);
 w.refund(p.id,1000,'Unallocated');w.applyDeposit(i.id,p.id,3000);assert.equal(w.r.get('invoices',i.id).deposits_applied_cents,7000);assert.equal(w.r.get('invoices',i.id).amount_paid_cents,7000);assert.throws(()=>w.applyDeposit(i.id,p.id,1),/available balance/);
});
test('Astra 9: deleting scheduled entities cleans appointments and visit checklists atomically',async t=>{
 const {w,request}=await httpFixture(t),job=w.createJob({client_id:1,title:'Cleanup'}),v=w.createVisit(job.id,{scheduled_start:'2035-01-01T09:00Z',scheduled_end:'2035-01-01T10:00Z',assigned_user_ids_json:[]}),c=w.r.insert('checklists',{visit_id:v.id,title:'List'});w.r.insert('checklist_items',{checklist_id:c.id,label:'Item'});
 const req=w.createRequest({client_id:1,title:'Assessment'});w.scheduleAssessment(req.id,{start_at:'2035-01-02T09:00Z',end_at:'2035-01-02T10:00Z'});const task=w.r.insert('tasks',{title:'Task'});w.r.insert('appointments',{entity_type:'task',entity_id:task.id});
 for(const [resource,id,type] of [['visits',v.id,'visit'],['requests',req.id,'assessment'],['tasks',task.id,'task']]){assert.equal((await request(resource+'/'+id,'DELETE')).status,200);assert.equal(w.r.list('appointments',{entity_type:type,entity_id:id}).length,0);}
 assert.equal(w.r.list('checklists',{visit_id:v.id}).length,0);assert.equal(w.r.list('checklist_items',{checklist_id:c.id}).length,0);
 const blocked=w.createVisit(job.id,{scheduled_start:'2035-01-03T09:00Z',scheduled_end:'2035-01-03T10:00Z'});w.r.insert('time_entries',{user_id:1,visit_id:blocked.id,start_at:'2035-01-03T09:00Z'});assert.equal((await request('visits/'+blocked.id,'DELETE')).status,400);assert.equal(w.r.list('appointments',{entity_type:'visit',entity_id:blocked.id}).length,1);
});
test('Astra 10: job invoices preserve subtotal, tax and bookkeeping totals',t=>{
 const w=fixture(t);for(const quoted of [false,true]){const q=quoted?w.createQuote({client_id:1,title:'Tax',tax_rate:8.25},[{name:'Work',quantity:1,unit_price_cents:10000,taxable:1}]):null;
 const j=w.createJob({client_id:1,title:'Tax job',quote_id:q?.id,subtotal_cents:10000,tax_cents:825,total_cents:10825});w.completeJob(j.id);const i=w.invoiceJob(j.id);assert.deepEqual([i.subtotal_cents,i.tax_cents,i.total_cents,i.balance_due_cents],[10000,825,10825,10825]);assert.equal(i.tax_rate,8.25);const line=w.r.list('invoice_line_items',{invoice_id:i.id})[0];assert.equal(line.taxable,1);assert.equal(line.unit_price_cents,10000);const before=bookkeeping(w.r).tax_cents;w.issueInvoice(i.id);assert.equal(bookkeeping(w.r).tax_cents,before+825);}
 const q=w.createQuote({client_id:1,title:'Discounted',discount_type:'fixed',discount_value:1000,tax_rate:10},[{name:'Work',description:'Preserved',quantity:1,unit_price_cents:10000,taxable:1,unit:'hour'}]);w.sendQuote(q.id);w.approveQuote(q.id,'Test');const job=w.quoteToJob(q.id);w.completeJob(job.id);const inv=w.invoiceJob(job.id);
 for(const invoice of [inv,editDocument(w,'invoices',inv.id,{internal_notes:'Notes only'})])assert.deepEqual([invoice.subtotal_cents,invoice.discount_cents,invoice.tax_cents,invoice.total_cents,invoice.balance_due_cents],[10000,1000,900,9900,9900]);
 const line=w.r.list('invoice_line_items',{invoice_id:inv.id})[0];assert.equal(line.description,'Preserved');assert.equal(line.unit,'hour');
 const changedQuote=w.createQuote({client_id:1,title:'Changed job',tax_rate:8.25},[{name:'Work',quantity:1,unit_price_cents:10000,taxable:1}]);w.sendQuote(changedQuote.id);w.approveQuote(changedQuote.id,'Test');const changedJob=w.quoteToJob(changedQuote.id);w.r.update('jobs',changedJob.id,{total_cents:12000});w.completeJob(changedJob.id);const changedInvoice=w.invoiceJob(changedJob.id);
 for(const invoice of [changedInvoice,editDocument(w,'invoices',changedInvoice.id,{internal_notes:'Notes only'})])assert.deepEqual([invoice.total_cents,invoice.balance_due_cents],[12000,12000]);
 const totalOnly=w.createJob({client_id:1,title:'Standalone',total_cents:6500});w.completeJob(totalOnly.id);const totalOnlyInvoice=w.invoiceJob(totalOnly.id),totalOnlyLine=w.r.list('invoice_line_items',{invoice_id:totalOnlyInvoice.id})[0];assert.deepEqual([totalOnlyInvoice.subtotal_cents,totalOnlyInvoice.total_cents,totalOnlyLine.total_cents],[6500,6500,6500]);
 const standalone=w.createJob({client_id:1,title:'Standalone discount',subtotal_cents:10000,tax_cents:900,total_cents:9900});w.completeJob(standalone.id);const standaloneInvoice=w.invoiceJob(standalone.id),edited=editDocument(w,'invoices',standaloneInvoice.id,{internal_notes:'Notes only'});assert.deepEqual([edited.subtotal_cents,edited.discount_cents,edited.tax_cents,edited.total_cents],[10000,1000,900,9900]);
});
test('Astra 11: pipeline retains active and invoiced statuses and issues moved jobs',async t=>{
 const {w,db,request}=await httpFixture(t),role=w.r.get('users',1).role_id;
 const job=w.createJob({client_id:1,title:'Schedule permission',status:'active',total_cents:1000}),visit=w.createVisit(job.id),move={resource:'jobs',id:job.id,stage:'Invoiced'};
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND resource='schedule' AND action='write'").run(role);
 assert.equal((await request('pipeline','POST',move)).status,403);assert.equal(w.r.get('visits',visit.id).status,visit.status);assert.equal(w.r.get('jobs',job.id).status,'active');assert.equal(w.r.list('invoices',{job_id:job.id}).length,0);
 const ready=w.createJob({client_id:1,title:'Invoice completed visit only',billing_type:'visit_based',total_cents:6500}),completed=w.createVisit(ready.id);w.completeVisit(completed.id);w.completeJob(ready.id);
 const future=w.createVisit(ready.id,{scheduled_start:'2035-01-01T09:00Z',scheduled_end:'2035-01-01T10:00Z'});assert.equal(w.r.get('jobs',ready.id).status,'requires_invoicing');assert.equal(future.status,'scheduled');
 const readyInvoice=await request('pipeline','POST',{resource:'jobs',id:ready.id,stage:'Invoiced'});assert.equal(readyInvoice.status,200);assert.equal(readyInvoice.body.status,'awaiting_payment');assert.equal(readyInvoice.body.total_cents,6500);
 const readyLines=w.r.list('invoice_line_items',{invoice_id:readyInvoice.body.id});assert.equal(readyLines.length,1);assert.equal(readyLines[0].visit_id,completed.id);assert.equal(readyLines[0].total_cents,6500);assert.equal(w.r.get('visits',completed.id).invoiced,1);assert.equal(w.r.get('visits',completed.id).invoice_id,readyInvoice.body.id);assert.deepEqual(w.r.get('visits',future.id),future);
 db.prepare("UPDATE permissions SET allowed=1 WHERE role_id=? AND resource='schedule' AND action='write'").run(role);
 const allowed=await request('pipeline','POST',move);assert.equal(allowed.status,200);assert.equal(allowed.body.status,'awaiting_payment');assert.equal(w.r.get('visits',visit.id).status,'completed');
 for(const status of ['active','requires_invoicing','late']){const j=w.createJob({client_id:1,title:status,status,total_cents:1000});assert.ok(pipeline(w)['Active Job'].some(x=>x.id===j.id));if(status==='active')w.createVisit(j.id);const inv=movePipeline(w,{resource:'jobs',id:j.id,stage:'Invoiced'});assert.equal(inv.status,'awaiting_payment');assert.ok(pipeline(w).Invoiced.some(x=>x.id===inv.id));}
 for(const status of ['draft','awaiting_payment','partial','past_due']){const i=w.r.insert('invoices',{client_id:1,subject:status,status,total_cents:1000,balance_due_cents:1000});assert.ok(pipeline(w).Invoiced.some(x=>x.id===i.id));const moved=movePipeline(w,{resource:'invoices',id:i.id,stage:'Invoiced'});assert.equal(moved.status,status==='draft'?'awaiting_payment':status);assert.equal(w.r.get('invoices',i.id).status,moved.status);}
 const partial=w.createJob({client_id:1,title:'Automatic partial billing',billing_type:'visit_based',total_cents:6500}),v1=w.createVisit(partial.id),v2=w.createVisit(partial.id);
 w.completeVisit(v1.id);const first=w.invoiceJob(partial.id,[v1.id]);assert.equal(first.total_cents,6500);w.completeVisit(v2.id);w.completeJob(partial.id);
 const v3=w.createVisit(partial.id,{scheduled_start:'2035-01-03T09:00Z',scheduled_end:'2035-01-03T10:00Z'}),second=w.invoiceJob(partial.id),secondLines=w.r.list('invoice_line_items',{invoice_id:second.id});
 assert.equal(second.total_cents,6500);assert.deepEqual(secondLines.map(l=>l.visit_id),[v2.id]);assert.equal(w.r.get('visits',v1.id).invoice_id,first.id);assert.equal(w.r.get('visits',v2.id).invoiced,1);assert.equal(w.r.get('visits',v2.id).invoice_id,second.id);assert.equal(w.r.get('jobs',partial.id).status,'active');assert.ok(pipeline(w)['Active Job'].some(x=>x.id===partial.id));assert.equal(w.r.get('visits',v3.id).status,'scheduled');assert.equal(w.r.get('visits',v3.id).invoiced,0);
 w.completeVisit(v3.id);w.completeJob(partial.id);const final=w.invoiceJob(partial.id);assert.equal(final.total_cents,6500);assert.deepEqual(w.r.list('invoice_line_items',{invoice_id:final.id}).map(l=>l.visit_id),[v3.id]);assert.equal(w.r.get('visits',v3.id).invoiced,1);assert.equal(w.r.get('visits',v3.id).invoice_id,final.id);assert.equal(w.r.get('jobs',partial.id).status,'completed');assert.ok(!pipeline(w)['Active Job'].some(x=>x.id===partial.id));
 const recurring=w.createJob({client_id:1,title:'Visit-based recurring',job_type:'recurring',status:'active',total_cents:6500,billing_type:'visit_based'}),rule=w.r.insert('recurrence_rules',{job_id:recurring.id,start_date:'2035-01-01',frequency:'daily',occurrence_count:3}),visits=w.generateVisits(rule.id);
 assert.equal(visits.length,3);for(const visit of visits)assert.equal(visit.billable_amount_cents,6500);
 const recurringInvoice=movePipeline(w,{resource:'jobs',id:recurring.id,stage:'Invoiced'}),lines=w.r.list('invoice_line_items',{invoice_id:recurringInvoice.id});
 assert.equal(recurringInvoice.status,'awaiting_payment');assert.equal(recurringInvoice.total_cents,19500);assert.equal(lines.length,3);assert.deepEqual(lines.map(l=>l.visit_id).sort((a,b)=>a-b),visits.map(v=>v.id).sort((a,b)=>a-b));for(const line of lines)assert.equal(line.total_cents,6500);
 for(const visit of visits){const completed=w.r.get('visits',visit.id);assert.equal(completed.status,'completed');assert.equal(completed.invoiced,1);assert.equal(completed.invoice_id,recurringInvoice.id);}assert.equal(w.r.get('jobs',recurring.id).status,'completed');
 const client=w.createClient({display_name:'Pipeline balance'}),draft=w.createInvoice({client_id:client.id,subject:'Issue via pipeline'},[{name:'Work',quantity:1,unit_price_cents:10000}]);assert.equal(w.r.get('clients',client.id).balance_cents,0);
 const issued=movePipeline(w,{resource:'invoices',id:draft.id,stage:'Invoiced'});assert.equal(issued.status,'awaiting_payment');assert.ok(issued.issued_date);assert.ok(issued.due_date);assert.equal(w.r.get('clients',client.id).balance_cents,10000);
 for(const payment_terms of ['net_15','upon_receipt'])for(const viaPipeline of [false,true]){const draft=w.createInvoice({client_id:client.id,subject:'Preserve terms',payment_terms},[{name:'Work',quantity:1,unit_price_cents:1000}]);const issued=viaPipeline?movePipeline(w,{resource:'invoices',id:draft.id,stage:'Invoiced'}):w.issueInvoice(draft.id);assert.equal(issued.payment_terms,payment_terms);assert.equal(issued.status,'awaiting_payment');assert.equal(issued.due_date,new Date(Date.parse(issued.issued_date)+(payment_terms==='net_15'?15:0)*86400000).toISOString().slice(0,10));}
 for(const status of ['active','requires_invoicing','late']){const j=w.createJob({client_id:1,title:'Preserve',status});assert.equal(movePipeline(w,{resource:'jobs',id:j.id,stage:'Active Job'}).status,status);assert.equal(w.r.get('jobs',j.id).status,status);}
 const q=w.createQuote({client_id:1,title:'Pipeline quote'},[]);assert.throws(()=>movePipeline(w,{resource:'quotes',id:q.id,stage:'Quote Approved'}),/document workflow/);assert.equal(movePipeline(w,{resource:'quotes',id:q.id,stage:'Quote Sent'}).status,'awaiting_response');const approved=movePipeline(w,{resource:'quotes',id:q.id,stage:'Quote Approved'});assert.equal(approved.status,'approved');assert.equal(approved.approved_by_name,'Pipeline');assert.throws(()=>movePipeline(w,{resource:'quotes',id:q.id,stage:'Quote Sent'}),/document workflow/);
});
test('Astra 12: recurrence identity survives rescheduling and schema upgrades',t=>{
 const w=fixture(t),j=w.createJob({client_id:1,title:'Recurring',job_type:'recurring'}),rule=w.r.insert('recurrence_rules',{job_id:j.id,start_date:'2035-01-01',frequency:'daily',occurrence_count:2});const visits=w.generateVisits(rule.id);w.reschedule(visits[0].id,{scheduled_start:'2035-02-01T09:00Z',scheduled_end:'2035-02-01T10:00Z'});assert.deepEqual(w.generateVisits(rule.id).map(v=>v.id),visits.map(v=>v.id));assert.equal(w.r.list('visits',{job_id:j.id}).length,2);
 const list=w.r.list;let visitReads=0;w.r.list=(table,...args)=>{if(table==='visits')visitReads++;return list.call(w.r,table,...args);};
 try{assert.deepEqual(w.generateVisits(rule.id).map(v=>v.id),visits.map(v=>v.id));assert.equal(visitReads,1,'regenerating a rule reads visits only once');}finally{w.r.list=list;}
 w.reschedule(visits[0].id,{scheduled_start:visits[0].scheduled_start,scheduled_end:visits[0].scheduled_end});
 w.r.db.exec('ALTER TABLE visits DROP COLUMN occurrence_start');migrate(w.r.db);migrate(w.r.db);assert.ok(w.r.db.prepare('PRAGMA table_info(visits)').all().some(c=>c.name==='occurrence_start'));
 for(const visit of w.r.list('visits',{job_id:j.id}))assert.equal(visit.occurrence_start,visit.scheduled_start);
 const moved=w.reschedule(visits[1].id,{scheduled_start:'2035-02-02T09:00Z',scheduled_end:'2035-02-02T10:00Z'});assert.equal(moved.occurrence_start,visits[1].scheduled_start);assert.deepEqual(w.generateVisits(rule.id).map(v=>v.id),visits.map(v=>v.id));assert.equal(w.r.list('visits',{job_id:j.id}).length,2);
 w.r.update('visits',visits[0].id,{occurrence_start:null});assert.equal(w.generateVisits(rule.id)[0].occurrence_start,visits[0].scheduled_start);
 w.r.update('visits',visits[0].id,{occurrence_start:null});const legacyMoved=w.reschedule(visits[0].id,{scheduled_start:'2035-02-03T09:00Z',scheduled_end:'2035-02-03T10:00Z'});assert.equal(legacyMoved.occurrence_start,visits[0].scheduled_start);assert.deepEqual(w.generateVisits(rule.id).map(v=>v.id),visits.map(v=>v.id));assert.equal(w.r.list('visits',{job_id:j.id}).length,2);
});
test('Astra 13: non-team creation forms never request roles',async()=>{
 for(const resource of ['catalog','custom-fields','automations','templates','checklists','team']){const h=domHarness();h.run('resource='+JSON.stringify(resource));await h.run('genericBuilder()');assert.equal(h.calls.filter(c=>c.path==='/api/roles').length,resource==='team'?1:0);assert.match(h.elements.get('#overlay').innerHTML,/action-form/);}
});

test('round five navigation, marketplace, and artwork markup',()=>{
 const source=readFileSync(new URL('../src/public/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../src/public/index.html',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new Script(source));
 for(const name of artwork)assert.ok((source+html).includes('/assets/'+name+'.jpg'));
 for(const marker of ['window.go=go','window.openOverlay=openOverlay','id="createBtn"','id="insights-sub"','data-apps-tab','Connected Apps','ServiceTitan'])assert.ok(source.includes(marker),marker);
});
test('round five reference client activities and converted quotes',t=>{
 const db=createDatabase();t.after(()=>db.close());seedDatabase(db);const r=repository(db,1);
 assert.deepEqual([1,2,3,4,5,6].map(id=>r.get('clients',id).updated_at),['2026-10-13','2026-09-22','2026-08-13','2026-08-01','2026-08-01','2026-07-24']);
 workflows(db,1).overdue();
 assert.deepEqual([1,2,3,4,5,6].map(id=>r.get('clients',id).updated_at),['2026-10-13','2026-09-22','2026-08-13','2026-08-01','2026-08-01','2026-07-24']);
 assert.deepEqual([1,2,3].map(id=>{const q=r.get('quotes',id);return [q.status,q.created_at,q.total_cents];}),[['converted','2026-07-15',744000],['converted','2026-07-24',1127500],['converted','2026-08-01',12220000]]);
});
test('round five artwork is served as JPEG with HEAD support',async t=>{
 const db=createDatabase();const server=await startServer({db,seed:false,port:0});t.after(async()=>{await server.close();db.close();});
 for(const name of artwork){
  const url=server.url+'/assets/'+name+'.jpg';
  const response=await fetch(url);assert.equal(response.status,200,name);assert.equal(response.headers.get('content-type'),'image/jpeg');
  const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual([...bytes.slice(0,2)],[255,216]);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 }
 for(const [name,type] of [['home_truck.webp','image/webp'],['logo_jobber_bug.svg','image/svg+xml']]){
  const response=await fetch(server.url+'/assets/'+name);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type);await response.arrayBuffer();
 }
 assert.equal((await fetch(server.url+'/assets/missing.jpg')).status,404);
});
