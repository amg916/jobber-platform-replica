import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext,Script} from 'node:vm';
import {createDatabase,repository} from '../src/db/database.js';
import {seedDatabase} from '../src/db/seed.js';
import {workflows} from '../src/services/workflows.js';
import {emit,runPending} from '../src/services/automations.js';
import {startServer} from '../src/server.js';

const source=readFileSync(new URL('../src/public/app.js',import.meta.url),'utf8');
function dom(request){
 const elements=new Map(),counts={},calls=[],listeners={};
 for(const key of ['#overlay','#action-form','#toast','#workspace','#action-form [name="save_assign"]','[data-checklist-preview]'])elements.set(key,{innerHTML:'',style:{},dataset:{},querySelector(){return null;},querySelectorAll(){return [];}});
 const context=createContext({URL,Date,Intl,Blob,console,setTimeout(){},FormData:class{constructor(form){return Object.entries(form.values||{});}},location:{pathname:'/settings/client-hub',search:'',origin:'http://localhost'},history:{pushState(){}},window:{},sessionStorage:{getItem(){return null;}},document:{querySelector:s=>elements.get(s)||null,querySelectorAll:()=>[],addEventListener(name,listener){counts[name]=(counts[name]||0)+1;listeners[name]=listener;}},fetch:async(path,options)=>{calls.push({path,...options});const result=request?await request(path.slice(5),options.method,options.body===undefined?undefined:JSON.parse(options.body)):{status:200,body:path==='/api/team'&&options.method==='POST'?{id:12}:[]};return {ok:result.status<400,json:async()=>result.body};}});
 runInContext(source.slice(0,source.lastIndexOf('init().catch')),context);
 const run=code=>runInContext(code,context);run("const originalRender=render;user={id:1,name:'Owner'};org={id:1,name:'Workspace'};render=async()=>{};");
 return {elements,counts,calls,listeners,run,async submit(values){const form=elements.get('#action-form');form.values=values;await form.onsubmit({target:form,preventDefault(){}});}};
}
async function fixture(t){
 const db=createDatabase();seedDatabase(db);const server=await startServer({db,port:0,allowDemoSwitch:true});
 t.after(async()=>{await server.close();db.close();});
 const boot=async()=>{const res=await fetch(server.url+'/api/auth/bootstrap',{method:'POST'});assert.equal(res.status,200);return res.json();};
 const session=await boot();
 const request=async(path,method='GET',data,token=session.token)=>{const res=await fetch(server.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};};
 return {db,request,boot,session};
}

for(const populated of [false,true])test(`audit parity: ${populated?'populated':'empty'} workspace HTTP and settings DOM`,async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 if(populated){const c=w.createClient({display_name:'Audit Client'});w.createRequest({client_id:c.id,title:'Audit request'});w.createJob({client_id:c.id,title:'Audit job'});r.insert('preferences',{name:'request-form-audit',value_json:JSON.stringify({title:'Audit intake',questions:[]})});}
 const dashboard=await request('dashboard');assert.equal(dashboard.status,200);assert.equal(typeof dashboard.body,'object');assert.ok(Object.keys(dashboard.body).length>0);
 assert.equal((await request('clients')).body.length,populated?1:0);
 const h=dom(request),hub=await h.run("settings('client-hub')");
 assert.equal((hub.match(/class="hub-section"/g)||[]).length,7);
 for(const key of ['Menu visibility','Signatures','Change requests','Appointment times','Request forms','Primary button','Referrals'])assert.ok(hub.includes(`data-preference="hub-${key}"`));
 for(const marker of ['Request form','Booking form','Primary action button','hub-referral','readonly','hub-copy'])assert.ok(hub.includes(marker));
 const forms=await h.run("settings('requests-and-bookings')");assert.match(forms,/<h2>Forms<\/h2>/);assert.match(forms,/Default Form/);if(populated)assert.match(forms,/Audit intake/);
 for(const value of [null,false,0,42,'text',[]]){const old=r.list('preferences',{name:'request-form-null'})[0];if(old)r.update('preferences',old.id,{value_json:JSON.stringify(value)});else r.insert('preferences',{name:'request-form-null',value_json:JSON.stringify(value)});const html=await h.run("settings('requests-and-bookings')");assert.match(html,/<h2>Forms<\/h2>/);assert.match(html,/<h3>request-form-null<\/h3>/);assert.doesNotMatch(html,/<h3><\/h3>/);}
 const initial=await request('account-billing');assert.equal(initial.body.billing_cycle,'Monthly');assert.equal(initial.body.seats,5);
 assert.equal((await request('account-billing','PATCH',{billing_cycle:'Annual',seats:8})).status,200);
 const saved=await request('account-billing');assert.equal(saved.body.billing_cycle,'Annual');assert.equal(saved.body.seats,8);
 for(const seats of [0,-1,501,1.5,'bad',null])assert.equal((await request('account-billing','PATCH',{seats})).status,400);
 for(const billing_cycle of ['Weekly','',null,42])assert.equal((await request('account-billing','PATCH',{billing_cycle})).status,400);
 assert.equal((await request('account-billing')).body.seats,8);
});

test('audit parity: account-and-billing route renders the full billing page',async t=>{
 const {request}=await fixture(t),h=dom(request);h.elements.set('#breadcrumb',{textContent:''});
 h.run('render=originalRender;bindView=()=>{};');
 await h.run("route='account-and-billing';render()");
 const html=h.elements.get('#workspace').innerHTML;
 for(const label of ['Manage Plans','Manage Add-ons','Payment Details','Billing Cycle'])assert.ok(html.includes(label));
 assert.equal(h.elements.get('#breadcrumb').textContent,'Account and billing');
 await h.run("route='account-billing';render()");assert.equal(h.elements.get('#workspace').innerHTML,html);
});

test('audit parity: team and emails aliases retain full settings controls',async t=>{
 const {request}=await fixture(t),h=dom(request),team=await h.run("settings('team')");
 for(const label of ['Users','Crews','Active login sessions','Invite New Member'])assert.ok(team.includes(label));
 assert.equal(team,await h.run("settings('manage-team')"));
 const emails=await h.run("settings('emails')");assert.match(emails,/Emails &amp; Text Messages|Emails & Text Messages/);
 assert.equal((emails.match(/<button[^>]*data-settings-action="event-template:[^"]*"[^>]*>Edit<\/button>/g)||[]).length,18);
 assert.equal(emails,await h.run("settings('emails-and-text-messages')"));
});

test('audit parity: invoices retain status pills and chart issued dates',()=>{
 const h=dom(),html=h.run("rows=[{id:1,issued_date:'2026-10-15',total_cents:25000,status:'paid'}];reportWorkspace('Invoices',rows,'Draft · Paid')");
 for(const view of ['Growth','Cumulative'])assert.ok(html.includes(`data-report-view="${view}"`));
 for(const pill of ['Draft','Paid'])assert.ok(html.includes(`data-report-pill="${pill}"`));
 const chart={innerHTML:'',hidden:true};h.elements.set('#report-chart',chart);
 for(const view of ['Growth','Cumulative']){h.run(`reportState.view='${view}';refreshReport()`);assert.equal(chart.hidden,false);assert.match(chart.innerHTML,/<svg/);assert.match(chart.innerHTML,/2026-10-15: 250\.00/);}
 h.run("reportState.pill='Draft';refreshReport()");assert.doesNotMatch(chart.innerHTML,/<svg/);
 h.run("reportState.pill='Paid';refreshReport()");assert.match(chart.innerHTML,/<svg/);
});

test('audit parity: inline accounting code opens, cancels, validates and persists',async t=>{
 const {request}=await fixture(t),h=dom(request),html=await h.run("settings('expense-tracking')");
 assert.match(html,/<form id="expense-code-inline" class="form-grid" hidden>/);assert.match(html,/data-settings-action="code-cancel"/);
 let focused=false,reset=false,prevented=false;
 const form={id:'expense-code-inline',dataset:{},hidden:true,values:{code:'   '},reset(){reset=true;this.values={};},querySelector(selector){assert.equal(selector,'[name="code"]');return {focus(){focused=true;}};}};
 h.elements.set('#expense-code-inline',form);
 assert.equal(await h.run("settingsAction({dataset:{newExpenseCode:''}})"),true);assert.equal(form.hidden,false);assert.equal(focused,true);assert.equal(h.elements.get('#overlay').innerHTML,'');
 await h.run("settingsAction({dataset:{settingsAction:'code-cancel'}})");assert.equal(form.hidden,true);assert.equal(reset,true);
 const submit=async values=>{form.values=values;await h.listeners.submit({target:form,preventDefault(){prevented=true;}});};
 await submit({code:'   '});assert.equal(prevented,true);assert.equal(h.calls.filter(c=>c.method==='POST'||c.method==='PATCH').length,0);
 await request('preferences','POST',{name:'accounting_codes',value_json:{codes:[{code:'OLD',description:'Existing'}]}});
 h.run('let inlineRenderCount=0;render=async()=>{inlineRenderCount++;};');
 await submit({code:' NEW ',description:'Materials'});await submit({code:'SECOND'});
 const prefs=(await request('preferences')).body,saved=prefs.find(p=>p.name==='accounting_codes');
 assert.deepEqual(JSON.parse(saved.value_json).codes,[{code:'OLD',description:'Existing'},{code:'NEW',description:'Materials'},{code:'SECOND',description:''}]);assert.equal(h.run('inlineRenderCount'),2);
 h.elements.delete('#expense-code-inline');await h.run("settingsAction({dataset:{newExpenseCode:''}})");assert.match(h.elements.get('#overlay').innerHTML,/Accounting Code/);assert.equal(typeof h.elements.get('#action-form').onsubmit,'function');
});

test('audit parity: session inventory, tenant isolation, revocation and current cookie',async t=>{
 const {db,request,boot,session}=await fixture(t),second=await boot();
 db.prepare("INSERT INTO organizations(id,name,slug) VALUES(2,'Other tenant','audit-other')").run();
 const other=repository(db,2),role=other.insert('roles',{name:'Owner',slug:'owner',is_system:1}),member=other.insert('users',{role_id:role.id,name:'Other owner',email:'other@audit.test',password_hash:'x',is_active:1});
 db.prepare('INSERT INTO sessions(token,user_id,organization_id,expires_at) VALUES(?,?,?,?)').run('foreign-session',member.id,2,new Date(Date.now()+86400000).toISOString());
 const foreign=db.prepare('SELECT id,expires_at FROM sessions WHERE token=?').get('foreign-session');
 let list=await request('auth/sessions');assert.equal(list.status,200);assert.equal(list.body.length,2);assert.equal(list.body.filter(s=>s.is_current).length,1);
 for(const s of list.body){assert.ok(!('token' in s));assert.notEqual(s.id,foreign.id);assert.ok(s.user_name);assert.ok(s.user_email);}
 const h=dom(request),html=await h.run("settings('manage-team')");assert.match(html,/Current session/);assert.match(html,/session-revoke-all/);
 assert.equal((await request('auth/sessions/'+foreign.id,'DELETE')).status,404);
 const secondId=db.prepare('SELECT id FROM sessions WHERE token=?').get(second.token).id;
 assert.equal((await request('auth/me','GET',undefined,second.token)).status,200);
 assert.deepEqual((await request('auth/sessions/'+secondId,'DELETE')).body,{revoked:true});
 assert.equal((await request('auth/me','GET',undefined,second.token)).status,401);
 const third=await boot(),fourth=await boot();
 assert.deepEqual((await request('auth/sessions/revoke-all','POST',{})).body,{revoked_count:2});
 for(const token of [third.token,fourth.token])assert.equal((await request('auth/me','GET',undefined,token)).status,401);
 assert.equal((await request('auth/me')).status,200);assert.equal((await request('auth/sessions')).body.length,1);
 assert.equal(db.prepare('SELECT expires_at FROM sessions WHERE id=?').get(foreign.id).expires_at,foreign.expires_at);
 assert.equal((await request('auth/sessions/revoke-all','POST',{})).body.revoked_count,0);
 const current=db.prepare('SELECT id FROM sessions WHERE token=?').get(session.token).id;
 const revoked=await request('auth/sessions/'+current,'DELETE');assert.equal(revoked.status,200);assert.match(revoked.cookie,/Max-Age=0/i);assert.equal((await request('auth/me')).status,401);
});

test('audit parity: classic script, Save and Assign, previews and session action wiring',async()=>{
 assert.doesNotThrow(()=>new Script(source));assert.doesNotMatch(source,/^\s*(import|export)\s/m);
 const h=dom();for(const event of ['click','change','input','submit','keydown'])assert.equal(h.counts[event],1);
 h.run("go=next=>{route=next;};");await h.run('teamMemberEditor()');h.elements.get('#action-form [name="save_assign"]').onclick();
 await h.submit({name:'Audit crew',email:'crew@audit.test',password:'long-password-123',role_id:'1'});assert.equal(h.run('route'),'schedule');assert.ok(h.calls.some(c=>c.path==='/api/team'&&c.method==='POST'));
 h.run("readChecklistSections=()=>[{title:'Sign off',questions:[{label:'Client signature',type:'Signature'}]}]");
 await h.run("settingsPartBAction({dataset:{settingsAction:'checklist-preview'}})");const signature=h.elements.get('[data-checklist-preview]').innerHTML;assert.match(signature,/name="preview_signature"/);assert.match(signature,/aria-label="Signature pad"/);
 h.run("requestFormDraft={title:'Typed preview',questions:['Long answer','Dropdown single choice','Dropdown multiple choice','Checkbox','Yes/No toggle','Date picker','Numerical answer','Upload images','Add assessment'].map(type=>({type,label:type,options:'One\\nTwo',duration:90}))};requestFormPreview(2)");
 const preview=h.elements.get('#overlay').innerHTML;assert.match(preview,/<textarea/);assert.equal((preview.match(/<select/g)||[]).length,2);assert.match(preview,/multiple/);assert.match(preview,/<option value="One">One<\/option>/);assert.equal((preview.match(/type="checkbox"/g)||[]).length,2);for(const type of ['date','time','number','file'])assert.ok(preview.includes(`type="${type}"`));assert.match(preview,/Duration: 90 minutes/);
 await h.run("settingsPartBAction({dataset:{settingsAction:'session-revoke:12'}})");await h.run("settingsPartBAction({dataset:{settingsAction:'session-revoke-all'}})");assert.ok(h.calls.some(c=>c.path==='/api/auth/sessions/12'&&c.method==='DELETE'));assert.ok(h.calls.some(c=>c.path==='/api/auth/sessions/revoke-all'&&c.method==='POST'));
});

function builderHarness(request,opts={}){
 const elements=new Map(),listeners={},calls=[];
 for(const key of ['#overlay','#action-form','#builder','#toast','#workspace','#breadcrumb','#header','#sidebar','#onboarding','#req-items','#billing-fields'])elements.set(key,{innerHTML:'',textContent:'',style:{},dataset:{},hidden:false,querySelector(){return null;},querySelectorAll(){return [];},insertAdjacentHTML(){},addEventListener(){}});
 const loc=opts.location||{pathname:'/home',search:'',origin:'http://localhost'};
 const context=createContext({URL,Date,Intl,Blob,console,setTimeout(){},FormData:class{constructor(form){this.values=form?.values||{};}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}get(k){return this.values[k]??null;}getAll(k){const v=this.values[k];return v==null?[]:Array.isArray(v)?v:[v];}},location:loc,history:{pushState(){},replaceState(){}},window:{btoa:s=>Buffer.from(s,'binary').toString('base64')},sessionStorage:{getItem:()=>opts.token??null,setItem(){},removeItem(){}},document:{activeElement:{tagName:'BODY'},querySelector:s=>elements.get(s)||null,querySelectorAll:s=>elements.get('all:'+s)||[],addEventListener(name,fn){listeners[name]=fn;}},fetch:async(path,options={})=>{if(path==='/reference-icons.json')return {ok:true,json:async()=>[]};calls.push({path,method:options.method||'GET',body:options.body});if(opts.intercept){const intercepted=await opts.intercept(path,options);if(intercepted)return intercepted;}const res=await request(path.slice(5),options.method||'GET',options.body===undefined?undefined:JSON.parse(options.body));return {ok:res.status<400,status:res.status,json:async()=>res.body};}});
 runInContext(source.slice(0,source.lastIndexOf('init().catch')),context);
 const run=code=>runInContext(code,context);
 if(!opts.unauthenticated)run("user={id:1,name:'Owner'};org={id:1,name:'J S Custom Tile',slug:'js-custom-tile'};render=async()=>{};");
 return {elements,listeners,calls,run,async submitBuilder(values,submitter){const form=elements.get('#builder');form.values=values;await form.onsubmit({target:form,currentTarget:form,submitter,preventDefault(){}});},async submitAction(values){const form=elements.get('#action-form');form.values=values;await form.onsubmit({target:form,currentTarget:form,preventDefault(){}});}};
}

test('Astra Remediation #1: client edits preserve custom display_name, billing_address, and update primary property in place',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1);
 const created=(await request('clients','POST',{display_name:'Smith Family',first_name:'Alex',last_name:'Smith',billing_address:'742 Evergreen Terrace',phone:'555-0100',status:'active'})).body;
 const prop=(await request('properties','POST',{client_id:created.id,street1:'100 Main St',city:'Austin',state:'TX',postal_code:'78701',country:'US',is_primary:1,tax_rate:5})).body;
 const h=builderHarness(request);
 await h.run(`builder('clients',${created.id})`);
 const html=h.elements.get('#overlay').innerHTML;
 assert.ok(html.includes('name="display_name" type="text" value="Smith Family"'));
 assert.ok(!/name="billing_same"\s+checked/.test(html));
 assert.ok(html.includes('name="billing_street1" type="text" value="742 Evergreen Terrace"'));
 await h.submitBuilder({first_name:'Alex',last_name:'Smith',display_name:'Smith Family',phone:'555-0199',property_street1:'100 Main St',property_city:'Austin',property_state:'TX',property_postal_code:'78701',property_country:'US',property_tax_rate:'10',billing_street1:'742 Evergreen Terrace',billing_country:''});
 const after=r.get('clients',created.id),props=r.list('properties',{client_id:created.id});
 assert.equal(after.display_name,'Smith Family');
 assert.equal(after.billing_address,'742 Evergreen Terrace');
 assert.equal(after.phone,'555-0199');
 assert.equal(props.length,1);
 assert.equal(props[0].id,prop.id);
 assert.equal(props[0].tax_rate,10);
 const second=(await request('clients','POST',{display_name:'Oak Household',first_name:'Jordan',last_name:'Oak',billing_address:'99 Maple Ave',phone:'555-0200'})).body;
 await h.run(`builder('clients',${second.id})`);
 await h.submitBuilder({first_name:'Jordan',last_name:'Oak',phone:'555-0299',billing_same:'on',property_country:'US'});
 const afterSecond=r.get('clients',second.id);
 assert.equal(afterSecond.display_name,'Oak Household');
 assert.equal(afterSecond.billing_address,'99 Maple Ave');
});

test('Astra Remediation #2: checklist designer preserves existing items and completion state when saving',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1);
 const cl=(await request('checklists','POST',{title:'Pre-grout inspection'})).body;
 const item1=(await request('checklist-items','POST',{checklist_id:cl.id,label:'Verify substrate flat',sort_order:0,is_completed:1,completed_by_user_id:1,completed_at:'2026-10-28T10:00:00.000Z'})).body;
 const item2=(await request('checklist-items','POST',{checklist_id:cl.id,label:'Waterproof membrane cured',sort_order:1})).body;
 const h=builderHarness(request);
 await h.run(`checklistDesigner(${cl.id})`);
 await h.submitAction({title:'Updated inspection'});
 let items=r.list('checklist_items',{checklist_id:cl.id}).sort((a,b)=>a.sort_order-b.sort_order);
 assert.equal(items.length,2);
 assert.equal(items[0].id,item1.id);
 assert.equal(items[0].is_completed,1);
 assert.equal(items[0].completed_at,'2026-10-28T10:00:00.000Z');
 await h.run(`checklistDesigner(${cl.id})`);
 const makeInput=v=>({value:v,checked:Boolean(v)});
 h.elements.get('#action-form').querySelectorAll=sel=>sel==='[data-checklist-section]'?[{querySelector:s=>s==='[name="section_title"]'?makeInput('Main'):null,querySelectorAll:s=>s==='[data-checklist-question]'?[{dataset:{itemId:String(item1.id)},querySelector:k=>({'[name="question_label"]':makeInput('Verify substrate level'),'[name="question_type"]':makeInput('Checkbox'),'[name="question_options"]':makeInput(''),'[name="question_required"]':makeInput(false)})[k]},{dataset:{itemId:''},querySelector:k=>({'[name="question_label"]':makeInput('Clean grout lines'),'[name="question_type"]':makeInput('Checkbox'),'[name="question_options"]':makeInput(''),'[name="question_required"]':makeInput(true)})[k]}]:[]}]:[];
 await h.submitAction({title:'Updated inspection v2'});
 items=r.list('checklist_items',{checklist_id:cl.id}).sort((a,b)=>a.sort_order-b.sort_order);
 assert.equal(items.length,2);
 assert.equal(items[0].id,item1.id);
 assert.equal(items[0].label,'Verify substrate level');
 assert.equal(items[0].is_completed,1);
 assert.equal(items[1].label,'Clean grout lines');
 assert.ok(!items.some(i=>i.id===item2.id));
});

test('Astra Remediation #3: saved automations write executable conditions_json and fire end-to-end',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const client=w.createClient({display_name:'Automation Client',email:'auto@example.test',receives_email:1});
 const h=builderHarness(request);
 await h.run("messageTemplateEditor('Quote follow-up',true)");
 h.elements.get('#action-form').querySelectorAll=sel=>sel==='[name="stage_condition"]'?[{value:'Awaiting response'}]:[];
 await h.submitAction({name:'Follow-up Rule',delay_quantity:'0',delay_unit:'hours',trigger_event:'quote_sent',trigger_timing:'Date passed',pipeline:'Quote pipeline opportunities',automation_action:'Send message',notification_method:'Email',subject:'Checking in',body:'Hello {{client_name}}'});
 const auto=r.list('automations').find(a=>a.name==='Follow-up Rule');
 assert.ok(auto);
 const cond=JSON.parse(auto.conditions_json);
 assert.deepEqual(cond,{status:'awaiting_response'});
 assert.ok(!('timing' in cond)&&!('pipeline' in cond)&&!('stages' in cond));
 const q=w.createQuote({client_id:client.id,title:'Kitchen Tile'},[{name:'Tile',quantity:1,unit_price_cents:25000}]);
 w.sendQuote(q.id);
 const ran=runPending(db);
 assert.ok(ran.some(e=>e.automation_id===auto.id&&e.status==='succeeded'));
 await h.run("messageTemplateEditor('Auto-archive Quotes',true)");
 h.elements.get('#action-form').querySelectorAll=()=>[];
 await h.submitAction({name:'Auto-archive Quotes',delay_quantity:'0',delay_unit:'hours',trigger_event:'quote_sent',trigger_timing:'Date passed',pipeline:'Quote pipeline opportunities',automation_action:'Send message',notification_method:'Email',subject:'Archive',body:'Archive'});
 const q2=w.createQuote({client_id:client.id,title:'Bath Tile'},[{name:'Tile',quantity:1,unit_price_cents:10000}]);
 w.sendQuote(q2.id);
 runPending(db);
 assert.equal(r.get('quotes',q2.id).status,'archived');
});

test('Astra Remediation #4: delayed request saves isolate snapshotted estimate items from concurrent editors',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Race Client'}),reqA=w.createRequest({client_id:c.id,title:'Req A'}),reqB=w.createRequest({client_id:c.id,title:'Req B'});
 let releasePatch;const gate=new Promise(resolve=>{releasePatch=resolve;});
 const h=builderHarness(request,{intercept:async(path,options)=>{if(path===`/api/requests/${reqA.id}`&&options.method==='PATCH'){await gate;const res=await request(`requests/${reqA.id}`,'PATCH',JSON.parse(options.body));return {ok:true,status:res.status,json:async()=>res.body};}}});
 const makeRow=(n,p)=>({querySelector:s=>({'[data-est-name]':{value:n},'[data-est-description]':{value:''},'[data-est-qty]':{value:'2'},'[data-est-price]':{value:String(p)}})[s]});
 await h.run(`builder('requests',${reqA.id})`);
 h.elements.get('#req-items').querySelectorAll=s=>s==='[data-request-item]'?[makeRow('Tile Demo',150)]:[];
 const pendingA=h.submitBuilder({client_id:String(c.id),title:'Req A updated',requested_on:'2030-02-01'});
 await h.run(`builder('requests',${reqB.id})`);
 h.elements.get('#req-items').querySelectorAll=s=>s==='[data-request-item]'?[makeRow('Grout Seal',45)]:[];
 releasePatch();
 await pendingA;
 const savedPref=JSON.parse(r.list('preferences',{name:`request-estimate-${reqA.id}`})[0].value_json);
 assert.equal(savedPref.items.length,1);
 assert.equal(savedPref.items[0].name,'Tile Demo');
 assert.equal(savedPref.items[0].unit_price_cents,15000);
});

test('Astra Remediation #5: save actions do not leak across failed validation or ordinary Save clicks',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Save Leak Client',email:'leak@example.test',receives_email:1});
 let clickHandler;
 const h=builderHarness(request);
 const form=h.elements.get('#builder');
 form.addEventListener=(ev,fn)=>{if(ev==='click')clickHandler=fn;};
 form.querySelector=s=>s==='.actions'?{insertAdjacentHTML(){}}:null;
 form.querySelectorAll=()=>[];
 h.elements.set('all:.line-item',[{dataset:{line:'{}'},querySelector:s=>({'[data-name]':{value:'Backsplash'},'[data-qty]':{value:'1'},'[data-price]':{value:'200'}})[s]}]);
 await h.run("builder('invoices')");
 clickHandler({target:{closest:()=>({getAttribute:()=>'submit',dataset:{docSave:'Save and Mark as Sent'}})}});
 await h.submitBuilder({client_id:String(c.id),subject:'Custom Due Missing',payment_terms:'custom',due_date:'',tax_rate:'0',discount_type:'percent',discount_value:'0'});
 assert.equal(r.list('invoices').length,0);
 clickHandler({target:{closest:()=>({getAttribute:()=>null,dataset:{}})}});
 await h.submitBuilder({client_id:String(c.id),subject:'Draft Only',payment_terms:'upon_receipt',due_date:'',tax_rate:'0',discount_type:'percent',discount_value:'0'});
 const inv=r.list('invoices')[0];
 assert.ok(inv);
 assert.equal(inv.status,'draft');
});

test('Astra Remediation #6: ordinary job edits do not replay visits and conflicting new visits fail pre-flight',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Job Visit Client'});
 const h=builderHarness(request);
 const visitCard=(date,uid)=>({querySelectorAll:()=>[{name:'doc_visit_title',value:'Install'},{name:'doc_visit_date',value:date},{name:'doc_visit_team',value:String(uid)}]});
 const form=h.elements.get('#builder');
 form.querySelector=()=>({insertAdjacentHTML(){}});
 let activeCards=[visitCard('2030-07-10',1)];
 form.querySelectorAll=s=>s.startsWith('[data-editor-visit]')?activeCards:[];
 h.elements.set('all:.line-item',[{dataset:{line:'{}'},querySelector:s=>({'[data-name]':{value:'Floor Tile'},'[data-qty]':{value:'1'},'[data-price]':{value:'500'}})[s]}]);
 await h.run("builder('jobs')");
 form.documentState.changed=true;
 await h.submitBuilder({client_id:String(c.id),title:'Initial Job',job_type:'one_off',start_time:'09:00',end_time:'10:00',billing_type:'upon_completion',value:'500',tax_rate:'0',discount_type:'percent',discount_value:'0'});
 const job=r.list('jobs')[0];
 assert.equal(r.list('visits',{job_id:job.id}).length,1);
 activeCards=[];
 await h.run(`builder('jobs',${job.id})`);
 await h.submitBuilder({client_id:String(c.id),title:'Renamed Job',job_type:'one_off',start_time:'09:00',end_time:'10:00',billing_type:'upon_completion',value:'500',tax_rate:'0',discount_type:'percent',discount_value:'0'});
 assert.equal(r.get('jobs',job.id).title,'Renamed Job');
 assert.equal(r.list('visits',{job_id:job.id}).length,1);
 activeCards=[visitCard('2030-07-10',1)];
 await h.run(`builder('jobs',${job.id})`);
 await h.submitBuilder({client_id:String(c.id),title:'Conflicting Edit Must Not Save',job_type:'one_off',start_time:'09:00',end_time:'10:00',billing_type:'upon_completion',value:'500',tax_rate:'0',discount_type:'percent',discount_value:'0'});
 assert.equal(r.get('jobs',job.id).title,'Renamed Job');
 assert.equal(r.list('visits',{job_id:job.id}).length,1);
});

test('Astra Remediation #7: task appointments normalize to UTC ISO, detect schedule conflicts, update, and complete',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1);
 const created=await request('tasks','POST',{title:'Site measure',due_date:'2030-08-15',start_time:'09:00',end_time:'10:00',assigned_user_id:1});
 assert.equal(created.status,201);
 const appt=r.list('appointments',{entity_type:'task',entity_id:created.body.id})[0];
 assert.ok(appt.start_at.endsWith('Z')&&appt.end_at.endsWith('Z'));
 const found=await request('schedule/conflicts','POST',{start_at:appt.start_at,end_at:appt.end_at,assigned_user_ids_json:[1]});
 assert.equal(found.body.length,1);
 assert.equal((await request('tasks','POST',{title:'Overlap',due_date:'2030-08-15',start_time:'09:30',end_time:'10:30',assigned_user_id:1})).status,409);
 const patched=await request(`tasks/${created.body.id}`,'PATCH',{title:'Moved measure',start_time:'11:00',end_time:'12:00'});
 assert.equal(patched.status,200);
 const updatedAppt=r.list('appointments',{entity_type:'task',entity_id:created.body.id})[0];
 assert.equal(updatedAppt.title,'Moved measure');
 assert.notEqual(updatedAppt.start_at,appt.start_at);
 assert.equal((await request(`tasks/${created.body.id}/complete`,'POST',{})).status,200);
 assert.equal(r.list('appointments',{entity_type:'task',entity_id:created.body.id})[0].status,'completed');
});

test('Astra Remediation #8: revoke-all invalidates live OAuth refresh grants on expired access sessions',async t=>{
 const {db,request}=await fixture(t);
 const authz=await request('oauth/authorize','POST',{response_type:'code',client_id:'audit-app'});
 assert.equal(authz.status,200);
 const exchanged=await request('oauth/token','POST',{grant_type:'authorization_code',client_id:'audit-app',code:authz.body.code});
 assert.equal(exchanged.status,200);
 db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run('2020-01-01T00:00:00.000Z',exchanged.body.access_token);
 const revoked=await request('auth/sessions/revoke-all','POST',{});
 assert.equal(revoked.status,200);
 assert.equal(revoked.body.revoked_count,1);
 const refreshAttempt=await request('oauth/token','POST',{grant_type:'refresh_token',client_id:'audit-app',refresh_token:exchanged.body.refresh_token});
 assert.equal(refreshAttempt.status,400);
});

test('Astra Remediation #9: document Save-and actions execute quote send/convert and invoice issue transitions',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Workflow Doc Client',email:'doc@example.test',receives_email:1});
 const h=builderHarness(request);
 h.elements.get('#builder').querySelector=()=>({insertAdjacentHTML(){}});
 h.elements.get('#builder').querySelectorAll=()=>[];
 h.elements.set('all:.line-item',[{dataset:{line:'{}'},querySelector:s=>({'[data-name]':{value:'Shower Tile'},'[data-qty]':{value:'1'},'[data-price]':{value:'400'}})[s]}]);
 await h.run("builder('quotes')");
 await h.submitBuilder({client_id:String(c.id),title:'Quote Send',tax_rate:'0',discount_type:'percent',discount_value:'0',required_deposit_type:'none',required_deposit_value:'0'},{dataset:{docSave:'Save and Send as Email'}});
 const q1=r.list('quotes').find(q=>q.title==='Quote Send');
 assert.equal(q1.status,'awaiting_response');
 const portal=(await request(`clients/${c.id}/portal`)).body,hub=(await request(`client-hub/${portal.token}`)).body;
 assert.ok(hub.quotes.some(q=>q.id===q1.id));
 await h.run("builder('quotes')");
 await h.submitBuilder({client_id:String(c.id),title:'Quote Convert',tax_rate:'0',discount_type:'percent',discount_value:'0',required_deposit_type:'none',required_deposit_value:'0'},{dataset:{docSave:'Save and Convert to Job'}});
 const q2=r.list('quotes').find(q=>q.title==='Quote Convert');
 assert.equal(q2.status,'converted');
 assert.ok(r.list('jobs').some(j=>j.quote_id===q2.id));
 await h.run("builder('invoices')");
 await h.submitBuilder({client_id:String(c.id),subject:'Inv Send',payment_terms:'upon_receipt',tax_rate:'0',discount_type:'percent',discount_value:'0'},{dataset:{docSave:'Save and Send as Email'}});
 assert.equal(r.list('invoices').find(i=>i.subject==='Inv Send').status,'awaiting_payment');
 await h.run("builder('invoices')");
 await h.submitBuilder({client_id:String(c.id),subject:'Inv Collect',payment_terms:'upon_receipt',tax_rate:'0',discount_type:'percent',discount_value:'0'},{dataset:{docSave:'Save and Collect Payment'}});
 const invCollect=r.list('invoices').find(i=>i.subject==='Inv Collect');
 assert.equal(invCollect.status,'awaiting_payment');
 assert.ok(h.elements.get('#overlay').innerHTML.includes(`name="invoice_${invCollect.id}" checked`));
});

test('Astra Remediation #10: Custom and Net 45 invoice due dates are preserved through issuance',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Terms Client'});
 const h=builderHarness(request);
 h.elements.get('#builder').querySelector=()=>({insertAdjacentHTML(){}});
 h.elements.get('#builder').querySelectorAll=()=>[];
 h.elements.set('all:.line-item',[{dataset:{line:'{}'},querySelector:s=>({'[data-name]':{value:'Mosaic'},'[data-qty]':{value:'1'},'[data-price]':{value:'300'}})[s]}]);
 await h.run("builder('invoices')");
 await h.submitBuilder({client_id:String(c.id),subject:'Custom Due Inv',payment_terms:'custom',due_date:'2030-06-15',tax_rate:'0',discount_type:'percent',discount_value:'0'},{dataset:{docSave:'Save and Mark as Sent'}});
 const customInv=r.list('invoices').find(i=>i.subject==='Custom Due Inv');
 assert.equal(customInv.status,'awaiting_payment');
 assert.equal(customInv.due_date,'2030-06-15');
 await h.run("builder('invoices')");
 await h.submitBuilder({client_id:String(c.id),subject:'Net 45 Inv',payment_terms:'net_45',due_date:'',tax_rate:'0',discount_type:'percent',discount_value:'0'},{dataset:{docSave:'Save and Mark as Sent'}});
 const net45Inv=r.list('invoices').find(i=>i.subject==='Net 45 Inv');
 assert.equal(net45Inv.status,'awaiting_payment');
 const diffDays=Math.round((Date.parse(net45Inv.due_date+'T00:00:00Z')-Date.parse(net45Inv.issued_date+'T00:00:00Z'))/86400000);
 assert.ok(diffDays>=44&&diffDays<=46);
});

test('Astra Remediation #11: Close Invoice, Void Invoice, and Client Record deposit succeed cleanly',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Billing Action Client'});
 const inv1=w.issueInvoice(w.createInvoice({client_id:c.id,subject:'Bad Debt Inv'},[{name:'Work',quantity:1,unit_price_cents:15000}]).id,'net_30');
 const inv2=w.issueInvoice(w.createInvoice({client_id:c.id,subject:'Void Inv'},[{name:'Work',quantity:1,unit_price_cents:22000}]).id,'net_30');
 const h=builderHarness(request);
 await h.run(`recordDetailAction('invoices',{id:${inv1.id},client_id:${c.id}},'Close Invoice')`);
 assert.equal(r.get('invoices',inv1.id).status,'bad_debt');
 await h.run(`recordDetailAction('invoices',{id:${inv2.id},client_id:${c.id}},'Void Invoice')`);
 assert.equal(r.get('invoices',inv2.id).status,'void');
 assert.equal(r.get('invoices',inv2.id).balance_due_cents,0);
 assert.equal(r.get('clients',c.id).balance_cents,0);
 await h.run(`collectRecordPayment('clients',{id:${c.id}},'Record deposit')`);
 await h.submitAction({method:'card',deposit:'125.50'});
 const payments=r.list('payments',{client_id:c.id});
 assert.equal(payments.length,1);
 assert.equal(payments[0].payment_type,'deposit');
 assert.equal(payments[0].amount_cents,12550);
});

test('Astra Remediation #12: report date filters resolve scheduled visits on jobs and assessment_start on requests',async t=>{
 const {db,request}=await fixture(t),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Report Filter Client'});
 const jobMay=w.createJob({client_id:c.id,title:'May Job',job_type:'one_off'});
 w.createVisit(jobMay.id,{title:'May Visit',scheduled_start:'2030-05-10T16:00:00.000Z',scheduled_end:'2030-05-10T17:00:00.000Z',assigned_user_ids_json:[1]});
 const jobJune=w.createJob({client_id:c.id,title:'June Job',job_type:'one_off'});
 w.createVisit(jobJune.id,{title:'June Visit',scheduled_start:'2030-06-20T16:00:00.000Z',scheduled_end:'2030-06-20T17:00:00.000Z',assigned_user_ids_json:[1]});
 const reqMay=w.createRequest({client_id:c.id,title:'May Req'});
 w.scheduleAssessment(reqMay.id,{start_at:'2030-05-12T16:00:00.000Z',end_at:'2030-05-12T17:00:00.000Z',assigned_user_ids_json:[1]});
 const reqJune=w.createRequest({client_id:c.id,title:'June Req'});
 w.scheduleAssessment(reqJune.id,{start_at:'2030-06-18T16:00:00.000Z',end_at:'2030-06-18T17:00:00.000Z',assigned_user_ids_json:[2]});
 const h=builderHarness(request);
 await h.run("reportPage('One-off jobs')");
 h.run("reportState.from='2030-05-01';reportState.to='2030-05-31';");
 assert.deepEqual(h.run('reportFilteredRows().map(r=>r.id)'),[jobMay.id]);
 await h.run("reportPage('Requests')");
 h.run("reportState.filters.basis='Assessment within';reportState.from='2030-05-01';reportState.to='2030-05-31';");
 assert.deepEqual(h.run('reportFilteredRows().map(r=>r.id)'),[reqMay.id]);
});

test('Astra Remediation #13: unauthenticated /book/<slug>?form=... route renders custom request form and submits cleanly',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1);
 await request('preferences','POST',{name:'request-form-tile',value_json:{title:'Tile Estimate Intake',kind:'Request Form',description:'Tell us about your project',questions:[{type:'Short answer',label:'Square footage'}]}});
 const h=builderHarness(request,{unauthenticated:true,location:{pathname:'/book/js-custom-tile',search:'?form=request-form-tile',origin:'http://localhost'}});
 await h.run('init()');
 const html=h.elements.get('#workspace').innerHTML;
 assert.match(html,/Tile Estimate Intake/);
 assert.match(html,/Square footage/);
 assert.doesNotMatch(html,/Log in to Jobber/);
 const bookingForm={id:'booking-form',dataset:{bookingSlug:'js-custom-tile',bookingMode:'request',formTitle:'Tile Estimate Intake'},values:{customer_name:'Taylor Homeowner',customer_email:'taylor@example.test',customer_phone:'555-0300',address:'500 Tile Way',title:'Master shower',service_details:'Porcelain slab',custom_q_0:'180 sq ft'},innerHTML:'',querySelector:s=>s==='[name="custom_q_0"]'?{dataset:{questionLabel:'Square footage'}}:null};
 h.elements.set('#booking-form',bookingForm);
 await h.listeners.submit({target:bookingForm,preventDefault(){}});
 assert.match(bookingForm.innerHTML,/Request submitted/);
 const createdReq=r.list('requests').find(x=>x.title==='Master shower');
 assert.ok(createdReq);
 assert.match(createdReq.service_details,/Square footage: 180 sq ft/);
});


test('Astra Round 2 #1 & #12: Dispatcher role renders /home, /pipeline, /timesheets, /bookkeeping and saves requests without 403 preference crash',async t=>{
 const {db,request}=await fixture(t),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Dispatcher Client'});
 const loginRes=await request('auth/login','POST',{email:'kyle@jscustomtile.com',password:'js-custom-tile-2026'});
 assert.equal(loginRes.status,200);
 const dispReq=(p,m='GET',d)=>request(p,m,d,loginRes.body.token);
 assert.equal((await dispReq('preferences')).status,403);
 const h=builderHarness(dispReq,{token:loginRes.body.token});
 h.run("user={id:2,name:'Kyle Dispatcher'};clients=[{id:"+c.id+",display_name:'Dispatcher Client'}];team=[{id:1,name:'Owner'},{id:2,name:'Kyle Dispatcher'}];");
 const homeHtml=await h.run('home()');
 assert.match(homeHtml,/Today's appointments|Workflow/);
 const pipeHtml=await h.run('pipelineView()');
 assert.match(pipeHtml,/New Lead/);
 const timeHtml=await h.run('timesheets()');
 assert.match(timeHtml,/Timesheets|Approve/);
 const bookHtml=await h.run('bookkeeping()');
 assert.match(bookHtml,/Bookkeeping/);
 await h.run("builder('requests')");
 await h.submitBuilder({client_id:String(c.id),title:'Dispatcher Intake',service_details:'Backsplash',requested_on:'2030-04-10'});
 const saved=repository(db,1).list('requests').find(x=>x.title==='Dispatcher Intake');
 assert.ok(saved);
});

test('Astra Round 2 #2: businessHoursEditor saved format works end-to-end with checkAvailability and online booking',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1);
 const svc=r.insert('products_services',{item_type:'service',name:'Tile Consult',unit_price_cents:15000,active:1});
 const h=builderHarness(request);
 await h.run('businessHoursEditor()');
 const values={};
 for(const day of ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']){values[day+'_start']='09:00';values[day+'_end']='17:00';}
 values.Monday_open='on';
 await h.submitAction(values);
 const w=workflows(db,1,1);
 const monBook=w.book({service_id:svc.id,customer_name:'Mon Guest',customer_email:'mon@example.test',start_at:'2030-05-06T10:00:00-07:00',end_at:'2030-05-06T11:00:00-07:00',assigned_user_ids_json:[1]});
 assert.ok(monBook.id);
 assert.throws(()=>w.book({service_id:svc.id,customer_name:'Sun Guest',customer_email:'sun@example.test',start_at:'2030-05-05T10:00:00-07:00',end_at:'2030-05-05T11:00:00-07:00',assigned_user_ids_json:[1]}),/Outside business hours/);
 assert.throws(()=>w.book({service_id:svc.id,customer_name:'Late Guest',customer_email:'late@example.test',start_at:'2030-05-06T18:00:00-07:00',end_at:'2030-05-06T19:00:00-07:00',assigned_user_ids_json:[1]}),/Outside business hours/);
});

test('Astra Round 2 #3: refunding standalone deposit applied to invoice decrements deposits_applied_cents and allows voidInvoice',async t=>{
 const {db}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Standalone Deposit Client'});
 const dep=w.recordPayment({client_id:c.id,amount_cents:8000,payment_type:'deposit',method:'card'});
 const inv=w.createInvoice({client_id:c.id,subject:'Shower Pan'},[{name:'Pan',quantity:1,unit_price_cents:20000}]);
 w.issueInvoice(inv.id);
 w.applyDeposit(inv.id,dep.id,8000);
 assert.equal(r.get('invoices',inv.id).deposits_applied_cents,8000);
 assert.equal(r.get('invoices',inv.id).balance_due_cents,12000);
 w.refund(dep.id,8000,'Client cancelled',inv.id);
 const after=r.get('invoices',inv.id);
 assert.equal(after.deposits_applied_cents,0);
 assert.equal(after.balance_due_cents,20000);
 const voided=w.voidInvoice(inv.id);
 assert.equal(voided.status,'void');
});

test('Astra Round 2 #4: completing or editing task assigned to deactivated user succeeds while new assignment to inactive user is rejected',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1);
 const created=(await request('tasks','POST',{title:'Follow up call',due_date:'2030-07-10',start_time:'09:00',end_time:'10:00',assigned_user_id:3})).body;
 assert.equal(r.list('appointments',{entity_type:'task',entity_id:created.id}).length,1);
 assert.equal((await request('team/3','PATCH',{is_active:0})).status,200);
 const edited=await request(`tasks/${created.id}`,'PATCH',{instructions:'Updated note'});
 assert.equal(edited.status,200);
 const completed=await request(`tasks/${created.id}/complete`,'POST',{});
 assert.equal(completed.status,200);
 assert.equal(completed.body.status,'completed');
 assert.equal(r.list('appointments',{entity_type:'task',entity_id:created.id})[0].status,'completed');
 const rejected=await request('tasks','POST',{title:'New task for inactive',due_date:'2030-07-11',assigned_user_id:3});
 assert.ok(rejected.status>=400);
});

test('Astra Round 2 #5: pipelineView renders all 6 stages with accurate resource types across Requests and Quotes',async t=>{
 const {db,request}=await fixture(t),w=workflows(db,1,1);
 const lead=w.createClient({display_name:'Pipeline Lead',status:'lead',email:'lead@example.test',receives_email:1});
 const reqRow=w.createRequest({client_id:lead.id,title:'Pipeline Req'});
 const quoteSent=w.createQuote({client_id:lead.id,title:'Sent Quote'},[{name:'Tile',quantity:1,unit_price_cents:5000}]);
 w.sendQuote(quoteSent.id);
 const quoteApproved=w.createQuote({client_id:lead.id,title:'Approved Quote'},[{name:'Stone',quantity:1,unit_price_cents:9000}]);
 w.sendQuote(quoteApproved.id);w.approveQuote(quoteApproved.id,'Lead');
 const activeJob=w.createJob({client_id:lead.id,title:'Pipeline Active Job',total_cents:12000});
 const inv=w.createInvoice({client_id:lead.id,subject:'Pipeline Invoice'},[{name:'Grout',quantity:1,unit_price_cents:7000}]);
 w.issueInvoice(inv.id);
 const h=builderHarness(request);
 const html=await h.run('pipelineView()');
 for(const [resName,id] of [['clients',lead.id],['requests',reqRow.id],['quotes',quoteSent.id],['quotes',quoteApproved.id],['jobs',activeJob.id],['invoices',inv.id]]){
  assert.ok(html.includes(`data-resource="${resName}"`)&&html.includes(`data-detail="${resName}:${id}"`),`missing ${resName}:${id}`);
 }
});

test('Astra Round 2 #6: Team productivity report populates visits, job/general hours, and revenue per hour',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Prod Client'});
 const job=w.createJob({client_id:c.id,title:'Prod Job',subtotal_cents:30000,total_cents:30000});
 const v=w.createVisit(job.id,{title:'Prod Visit',scheduled_start:'2030-08-01T16:00:00.000Z',scheduled_end:'2030-08-01T18:00:00.000Z',assigned_user_ids_json:[1]});
 w.completeVisit(v.id,'Done');
 r.insert('time_entries',{user_id:1,job_id:job.id,category:'job',start_at:'2030-08-01T16:00:00.000Z',end_at:'2030-08-01T18:00:00.000Z',duration_minutes:120,hourly_cost_cents:4000,total_cost_cents:8000});
 r.insert('time_entries',{user_id:1,category:'general',start_at:'2030-08-01T18:00:00.000Z',end_at:'2030-08-01T19:00:00.000Z',duration_minutes:60,hourly_cost_cents:4000,total_cost_cents:4000});
 const h=builderHarness(request);
 const html=await h.run("reportPage('Team productivity')");
 assert.match(html,/2h 0m/);
 assert.match(html,/1h 0m/);
 assert.match(html,/3h 0m/);
 assert.match(html,/67%/);
 assert.match(html,/\$100\.00\/hr/);
});

test('Astra Round 2 #7: report pagination slices rows and navigates Previous/Next cleanly',async t=>{
 const {db,request}=await fixture(t),w=workflows(db,1,1);
 for(let i=1;i<=12;i++)w.createClient({display_name:`Paged Client ${String(i).padStart(2,'0')}`,email:`p${i}@example.test`});
 const h=builderHarness(request);
 h.elements.set('#report-pagination',{innerHTML:''});
 h.elements.set('#report-table',{innerHTML:''});
 h.elements.set('#report-cards',{innerHTML:''});
 h.elements.set('#report-chart',{innerHTML:''});
 await h.run("reportPage('Client contact info')");
 h.run("reportChange({target:{dataset:{reportPageSize:''},value:'10'}})");
 assert.match(h.elements.get('#report-pagination').innerHTML,/Page 1 of 2/);
 assert.match(h.elements.get('#report-table').innerHTML,/Paged Client 01/);
 assert.doesNotMatch(h.elements.get('#report-table').innerHTML,/Paged Client 12/);
 await h.run("reportAction({dataset:{reportPage:'next'}})");
 assert.match(h.elements.get('#report-table').innerHTML,/Paged Client 12/);
 assert.match(h.elements.get('#report-pagination').innerHTML,/Page 2 of 2/);
});

test('Astra Round 2 #8: payrollMember computes accurate labor cost in dollars from cents and member hourly_cost',async t=>{
 const {db,request}=await fixture(t);
 await request('team/2','PATCH',{hourly_cost:40});
 const nowStart=new Date(),nowEnd=new Date(+nowStart+90*60000);
 const created=await request('time-entries','POST',{user_id:2,start_at:nowStart.toISOString(),end_at:nowEnd.toISOString(),notes:'Tile install'});
 assert.equal(created.status,201);
 assert.equal(created.body.total_cost_cents,6000);
 const h=builderHarness(request);
 h.run("team=[{id:2,name:'Kyle Dispatcher',hourly_cost:40}];timeDate=new Date(Date.now()-86400000);timeView='Week';");
 await h.run('payrollMember(2)');
 assert.match(h.elements.get('#overlay').innerHTML,/Labor cost: \$60\.00/);
});

test('Astra Round 2 #9: atomic request+assessment and job+visit creation roll back completely on 409 schedule conflict',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Conflict Client'});
 const baseJob=w.createJob({client_id:c.id,title:'Existing Job'});
 w.createVisit(baseJob.id,{title:'Busy Slot',scheduled_start:'2030-09-10T16:00:00.000Z',scheduled_end:'2030-09-10T17:00:00.000Z',assigned_user_ids_json:[1]});
 const reqConflict=await request('requests','POST',{client_id:c.id,title:'Should Rollback Req',assessment:{start_at:'2030-09-10T16:00:00.000Z',end_at:'2030-09-10T17:00:00.000Z',assigned_user_ids_json:[1]}});
 assert.equal(reqConflict.status,409);
 assert.equal(r.list('requests').filter(x=>x.title==='Should Rollback Req').length,0);
 const jobConflict=await request('jobs','POST',{client_id:c.id,title:'Should Rollback Job',visit:{scheduled_start:'2030-09-10T16:00:00.000Z',scheduled_end:'2030-09-10T17:00:00.000Z',assigned_user_ids_json:[1]}});
 assert.equal(jobConflict.status,409);
 assert.equal(r.list('jobs').filter(x=>x.title==='Should Rollback Job').length,0);
});

test('Astra Round 2 #10 & #11: client communication checkboxes can be unchecked on edit and request edits preserve assessment_instructions',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c=w.createClient({display_name:'Comms Client',first_name:'Casey',last_name:'Stone',receives_email:1,receives_sms:1,receives_marketing:1});
 const h=builderHarness(request);
 await h.run(`builder('clients',${c.id})`);
 assert.match(h.elements.get('#overlay').innerHTML,/name="client_comms_present" value="1"/);
 await h.submitBuilder({first_name:'Casey',last_name:'Stone',display_name:'Comms Client',client_comms_present:'1',billing_same:'on'});
 const updatedClient=r.get('clients',c.id);
 assert.equal(updatedClient.receives_email,0);
 assert.equal(updatedClient.receives_sms,0);
 assert.equal(updatedClient.receives_marketing,0);
 const reqRow=w.createRequest({client_id:c.id,title:'Assess Preserve'});
 w.scheduleAssessment(reqRow.id,{start_at:'2030-10-15T16:00:00.000Z',end_at:'2030-10-15T17:00:00.000Z',instructions:'Side gate code 4821',assigned_user_ids_json:[1]});
 await h.run(`builder('requests',${reqRow.id})`);
 const reqHtml=h.elements.get('#overlay').innerHTML;
 assert.match(reqHtml,/Side gate code 4821/);
 await h.submitBuilder({client_id:String(c.id),title:'Assess Preserve Edited',requested_on:'2030-10-15',assessment_instructions:'Side gate code 4821'});
 assert.equal(r.get('requests',reqRow.id).assessment_instructions,'Side gate code 4821');
});

test('Luna Gate Remediation: /api/notes CRUD + RBAC + cascade, scheduled requests in Pipeline, public intake title, and zero Dispatcher 403 fetches',async t=>{
 const {db,request}=await fixture(t),r=repository(db,1),w=workflows(db,1,1);
 const c1=w.createClient({display_name:'Notes Source Client'}),c2=w.createClient({display_name:'Notes Target Client'});
 const reqSched=w.createRequest({client_id:c1.id,title:'Scheduled Pipeline Req'});
 w.scheduleAssessment(reqSched.id,{start_at:'2030-11-04T16:00:00.000Z',end_at:'2030-11-04T17:00:00.000Z',assigned_user_ids_json:[1]});
 const pipeRes=await request('pipeline');
 assert.equal(pipeRes.status,200);
 assert.ok(pipeRes.body['Request / Assessment'].some(x=>x.id===reqSched.id&&x.status==='assessment_scheduled'));
 const noteRes=await request('notes','POST',{entity_type:'clients',entity_id:c1.id,body:'Prefers porcelain trim'});
 assert.equal(noteRes.status,201);
 assert.equal(noteRes.body.body,'Prefers porcelain trim');
 const pinRes=await request('notes/'+noteRes.body.id,'PATCH',{is_pinned:1});
 assert.equal(pinRes.status,200);
 assert.equal(pinRes.body.is_pinned,1);
 const limLogin=await request('auth/login','POST',{email:'william@jscustomtile.com',password:'js-custom-tile-2026'});
 assert.equal((await request('notes','POST',{entity_type:'clients',entity_id:c1.id,body:'Blocked write'},limLogin.body.token)).status,403);
 await request('clients/merge','POST',{source_id:c1.id,target_id:c2.id});
 assert.equal(r.get('notes',noteRes.body.id).entity_id,c2.id);
 const h=builderHarness(request);
 await h.run(`detail('clients',${c2.id})`);
 assert.match(h.elements.get('#overlay').innerHTML,/Prefers porcelain trim/);
 assert.doesNotMatch(h.elements.get('#overlay').innerHTML,/Unable to load notes\./);
 const tempReq=w.createRequest({client_id:c2.id,title:'Temp Note Req'});
 const reqNote=await request('notes','POST',{entity_type:'requests',entity_id:tempReq.id,body:'Delete cascade note'});
 assert.equal(reqNote.status,201);
 assert.equal((await request('requests/'+tempReq.id,'DELETE')).status,200);
 assert.equal(r.list('notes',{id:reqNote.body.id}).length,0);
 const pubRes=await request('public/requests/js-custom-tile','POST',{name:'Public Caller',email:'pub@example.test',title:'Kitchen Backsplash Quote'});
 assert.equal(pubRes.status,201);
 assert.equal(pubRes.body.title,'Kitchen Backsplash Quote');
 const dispLogin=await request('auth/login','POST',{email:'kyle@jscustomtile.com',password:'js-custom-tile-2026'});
 const dispStatuses=[];
 const dispReq=async(p,m='GET',d)=>{const res=await request(p,m,d,dispLogin.body.token);dispStatuses.push({path:p,status:res.status});return res;};
 const hd=builderHarness(dispReq,{token:dispLogin.body.token,location:{pathname:'/home',search:'',origin:'http://localhost'}});
 hd.elements.set('#brand-mark',{innerHTML:'<svg></svg>'});
 hd.elements.set('#header',{innerHTML:''});
 hd.elements.set('#breadcrumb',{textContent:''});
 hd.elements.set('.global-search',{value:''});
 hd.elements.set('#sidebar',{innerHTML:'',classList:{toggle:()=>false,contains:()=>false}});
 await hd.run('init()');
 await hd.run('timesheets()');
 await hd.run('pipelineView()');
 await hd.run('bookkeeping()');
 assert.deepEqual(dispStatuses.filter(s=>s.status>=400),[]);
 const optOutClient=w.createClient({display_name:'Email Opt-Out Client',email:'optout@example.test',receives_email:0});
 const qOptOut=w.createQuote({client_id:optOutClient.id,title:'In-Person Tile Quote'},[{name:'Floor Tile',quantity:1,unit_price_cents:45000,taxable:1}]);
 assert.equal((await request(`quotes/${qOptOut.id}/send`,'POST',{channel:'email'})).status,400);
 const markAwait=await request(`quotes/${qOptOut.id}/send`,'POST',{channel:'none'});
 assert.equal(markAwait.status,200);
 assert.equal(markAwait.body.status,'awaiting_response');
 assert.equal(r.list('messages',{client_id:optOutClient.id}).length,0);
 const hb=builderHarness(request,{location:{pathname:'/book/js-custom-tile',search:'?form=request-form-default',origin:'http://localhost'}});
 await hb.run('bookingPage()');
 assert.match(hb.elements.get('#workspace').innerHTML,/<button type="submit" class="primary">Submit request<\/button>/);
});
