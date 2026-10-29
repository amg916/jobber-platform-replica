import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext, Script} from 'node:vm';
import {createDatabase, repository} from '../src/db/database.js';
import {seedDatabase} from '../src/db/seed.js';
import {startServer} from '../src/server.js';
const source=readFileSync(new URL('../src/public/app.js',import.meta.url),'utf8');
function harness(){
 const context=createContext({URL,Intl,Date,console,setTimeout(){},location:{pathname:'/hub/test',search:''},sessionStorage:{getItem(){return null;}},history:{},window:{},document:{querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){}},fetch:async()=>({ok:true,json:async()=>[]})});
 runInContext(source.slice(0,source.lastIndexOf('init().catch')),context);
 return code=>runInContext(code,context);
}
function editorHarness(fetcher){
 const elements=new Map(),listeners={},calls=[];
 for(const key of ['#overlay','#toast','#builder','#workspace','#action-form'])elements.set(key,{innerHTML:'',style:{},dataset:{},querySelector(){return null;}});
 const context=createContext({URL,Intl,Date,console,setTimeout(){},location:{pathname:'/hub/test',search:''},sessionStorage:{getItem(){return null;}},history:{},window:{},document:{querySelector:s=>elements.get(s)||null,querySelectorAll(){return [];},addEventListener:(key,fn)=>listeners[key]=fn},FormData:class{constructor(form){this.values=form.values||{};}*[Symbol.iterator](){yield* Object.entries(this.values);}get(key){return this.values[key]??null;}getAll(key){const v=this.values[key];return v==null?[]:Array.isArray(v)?v:[v];}},fetch:async(path,options)=>{calls.push({path,options});return fetcher?fetcher(path,options):{ok:true,json:async()=>options.method==='GET'?[]:{id:1}};}});
 runInContext(source.slice(0,source.lastIndexOf('init().catch')),context);
 const run=code=>runInContext(code,context);run('render=async()=>{}');
 return {elements,calls,run,submit:async values=>{const form=elements.get('#builder');form.values=values;await form.onsubmit({preventDefault(){},target:form});}};
}
async function httpFixture(t){
 const db=createDatabase();seedDatabase(db);const server=await startServer({db,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});
 const session=await (await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json();
 const transport=(path,options={})=>fetch(server.url+path,{...options,headers:{...options.headers,Authorization:'Bearer '+session.token}});
 const request=async(path,data)=>{const response=await transport('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,body:await response.json()};};return {db,transport,request};
}

test('Client builder posts strict fields and persists contact and property extras over HTTP',async t=>{
 const {db,transport}=await httpFixture(t),h=editorHarness(transport);await h.run("builder('clients')");
 await h.submit({first_name:'Pat',last_name:'Example',title:'Mx.',company_primary:'',billing_same:'on',property_street1:'10 Main St',property_tax_rate:'5',contact_0_first_name:'Alex',contact_0_last_name:'Example',contact_0_role:'Manager',contact_0_billing:'on',extra_phone_0:'5551234'});
 const r=repository(db,1),client=r.list('clients')[0];assert.ok(client);assert.equal(client.display_name,'Pat Example');assert.equal(r.list('properties')[0].tax_rate,5);assert.equal(r.list('client_contacts')[0].name,'Alex Example');assert.equal(r.list('client_contacts')[0].role_title,'Manager');
 const payload=JSON.parse(h.calls.find(c=>c.path==='/api/clients'&&c.options.method==='POST').options.body);assert.equal(payload.title,undefined);assert.equal(payload.property_street1,undefined);
});
test('Request builder validates before HTTP creation and schedules assessment using start_at',async t=>{
 const {db,transport,request}=await httpFixture(t),client=(await request('clients',{display_name:'Request client'})).body,h=editorHarness(transport);await h.run("builder('requests')");
 const values={client_id:String(client.id),property_id:'',title:'Assessment',requested_on:'2030-01-01',salesperson_id:'1',assessment_enabled:'on',assessment_start_date:'2030-01-02',assessment_end_date:'2030-01-02',assessment_start_time:'09:00',assessment_end_time:'08:00'};
 await h.submit(values);assert.equal(repository(db,1).list('requests').length,0);
 await h.submit({...values,assessment_end_time:'10:00'});const saved=repository(db,1).list('requests')[0];assert.ok(saved);assert.equal(saved.preferred_date,'2030-01-01');assert.equal(repository(db,1).list('appointments')[0].entity_type,'assessment');
 const payload=JSON.parse(h.calls.find(c=>c.path.endsWith('/assessment')).options.body);assert.ok(payload.start_at);assert.equal(payload.scheduled_start,undefined);
});
test('Event composer posts a task and the HTTP endpoint creates its appointment',async t=>{
 const {db,transport}=await httpFixture(t),h=editorHarness(transport),form={values:{item_type:'Event',title:'Planning',date:'2030-01-04',duration:'60',client_id:'',assigned:'1'},querySelector(){return null;}},slots={querySelectorAll(){return [];}};
 h.elements.set('#find-time-form',form);h.elements.set('#available-slots',slots);await h.run('findTimeComposer()');slots.onclick({target:{closest:()=>({dataset:{timeHour:'8'}})}});await form.onsubmit({preventDefault(){}});
 const task=repository(db,1).list('tasks')[0];assert.ok(task);assert.equal(task.instructions,'Calendar event');const appointment=repository(db,1).list('appointments')[0];assert.equal(appointment.entity_id,task.id);assert.equal(appointment.start_at,new Date('2030-01-04T08:00:00').toISOString());assert.equal(appointment.end_at,new Date('2030-01-04T09:00:00').toISOString());assert.deepEqual(JSON.parse(appointment.assigned_user_ids_json),[1]);
});
test('Payment headers sort rows in both directions',()=>{
 const h=editorHarness();h.run(`resource='payments';rows=[{client_id:2,paid_at:'2030-02-01',status:'succeeded',method:'cash'},{client_id:1,paid_at:'2030-01-01',status:'pending',method:'ach'}];globalThis.headers=listColumns.payments.slice(0,5).map(([textContent])=>({textContent,setAttribute(){}}));document.querySelectorAll=()=>headers;bindListSorting(()=>{});`);
 for(let i=0;i<5;i++){h.run(`headers[${i}].onclick()`);assert.equal(h.run('rows[0].client_id'),1);h.run(`headers[${i}].onclick()`);assert.equal(h.run('rows[0].client_id'),2);}
});
test('Batch invoice selection creates invoices through HTTP',async t=>{
 const {db,transport,request}=await httpFixture(t),client=(await request('clients',{display_name:'Batch client'})).body;
 const job=(await request('jobs',{client_id:client.id,title:'Batch job',status:'requires_invoicing',items:[{name:'Service',quantity:1,unit_price_cents:5000}]})).body;assert.ok(job.id);
 const h=editorHarness(transport);await h.run('batchInvoices(true)');const form=h.elements.get('#action-form');form.values={['selected_'+job.id]:'on'};await form.onsubmit({preventDefault(){},target:form});assert.equal(repository(db,1).list('invoices').length,1);assert.deepEqual(JSON.parse(h.calls.find(c=>c.path==='/api/invoices/batch').options.body),{job_ids:[job.id]});
});

test('Batch 2A remains a classic script',()=>{assert.doesNotThrow(()=>new Script(source));assert.doesNotMatch(source,/^\s*(import|export)\s/m);});
test('Available slots use half-open intervals and team conflicts',()=>{
 const run=harness();
 run(`const appointments=[{start_at:'2026-10-28T08:00:00',end_at:'2026-10-28T10:00:00',assigned_user_ids_json:'[1]'}];`);
 assert.equal(run("availableScheduleSlots(appointments,'2026-10-28',60,[1])[0].busy"),true);
 assert.equal(run("availableScheduleSlots(appointments,'2026-10-28',60,[1])[1].busy"),false);
 assert.equal(run("availableScheduleSlots(appointments,'2026-10-28',60,[2])[0].busy"),false);
 assert.equal(run("availableScheduleSlots(appointments,'2026-10-28',60,[]).length"),4);
});
test('Cancelled appointments do not block slots',()=>{
 const run=harness();assert.equal(run("availableScheduleSlots([{status:'cancelled',start_at:'2026-10-28T08:00:00',end_at:'2026-10-28T12:00:00'}],'2026-10-28',60)[0].busy"),false);
});
test('Preferences tolerate only forbidden responses',async()=>{
 const run=harness();run("fetch=async()=>({ok:false,status:403,json:async()=>({error:'Forbidden'})})");
 assert.equal(await run('safePrefs().then(p=>p.length)'),0);
 run("fetch=async()=>({ok:false,status:500,json:async()=>({error:'Failure'})})");
 await assert.rejects(run('safePrefs()'));
});
test('Client editor exposes real communication and billing controls',()=>{
 const run=harness(),html=run('clientEditorFields({})');
 for(const name of ['billing_same','receives_email','receives_sms','receives_marketing','lead_source','property_street1','billing_street1'])assert.ok(html.includes(`name="${name}"`),name);
 assert.match(html,/data-client-add="contact"/);assert.match(html,/data-client-add="property"/);
});
test('Request editor retains structured assessment fields',()=>{
 const run=harness(),html=run('requestEditorFields({})');
 for(const name of ['requested_on','salesperson_id','assessment_enabled','assessment_start_date','assessment_end_date','schedule_later'])assert.ok(html.includes(`name="${name}"`),name);
});
test('Find-time and merge discard stale loads before drawing',async()=>{
 const run=harness();run('let resolveLoad; fetch=()=>new Promise(resolve=>{resolveLoad=resolve;});let drawn=0;modal=()=>{drawn++;};');
 const pending=run('findTimeComposer()');run('++panelVersion;resolveLoad({ok:true,json:async()=>({appointments:[]})});');await pending;assert.equal(run('drawn'),0);
 const merge=run('mergeClientsWizard()');run('++panelVersion;resolveLoad({ok:true,json:async()=>[]});');await merge;assert.equal(run('drawn'),0);
});
