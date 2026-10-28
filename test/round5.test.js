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
import { deliverWebhook, emit, runPending } from '../src/services/automations.js';
import { generatePDF } from '../src/services/pdf.js';

const appSource=readFileSync(new URL('../src/public/app.js',import.meta.url),'utf8');
function domHarness(){
 const elements=new Map(),listeners={},calls=[];
 const element=()=>({innerHTML:'',textContent:'',style:{},dataset:{},classList:{remove(){},toggle(){}},setAttribute(){},querySelector(){return null;}});
 for(const key of ['#overlay','#toast','#action-form','#builder','#workspace'])elements.set(key,element());
 const context=createContext({calls,console,Intl,Date,URL,Blob,setTimeout(){},sessionStorage:{getItem(){return null;}},location:{pathname:'/hub/test'},history:{pushState(){}},window:{},document:{querySelector:s=>elements.get(s)||null,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn},FormData:class{constructor(form){return Object.entries(form.values||{});}},fetch:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>[]};}});
 runInContext(appSource.slice(0,appSource.lastIndexOf('init().catch')),context);
 return {context,elements,listeners,calls,run:code=>runInContext(code,context),click:dataset=>{const target={dataset,tagName:'BUTTON',hasAttribute:()=>false,closest:()=>null};return listeners.click({target:{closest:s=>s==='button,a,[data-slot],tr[data-id]'?target:null,matches:()=>false},preventDefault(){}});}};
}
function seedRound5TestFixtures(db){
 const r=repository(db,1),w=workflows(db,1,1);
 if(r.list('clients').length>0)return;
 for(let i=1;i<=6;i++){
  const c=w.createClient({first_name:'Client',last_name:String(i),display_name:`Client ${i}`,email:`c${i}@example.com`,phone:`916555010${i}`,billing_address:`${i}00 Main St, Gold River, CA 95670`,receives_email:1,receives_sms:1,receives_marketing:1,status:i===1?'lead':'active'});
  r.insert('properties',{client_id:c.id,street1:`${i}00 Main St`,city:'Gold River',state:'CA',postal_code:'95670',country:'United States',tax_rate:8.25,is_primary:1});
 }
 const s1=r.insert('products_services',{item_type:'service',name:'Custom Shower Tile Installation',category:'Tile & Remodel Services',unit:'job',unit_cost_cents:5000,markup_percent:100,unit_price_cents:10000,taxable:1,active:1});
 w.createRequest({client_id:1,property_id:1,title:'Tile Request'});
 const q1=w.createQuote({client_id:1,property_id:1,title:'Tile Quote'},[{product_service_id:s1.id,name:'Custom Shower Tile Installation',quantity:1,unit_price_cents:10000,taxable:1}]);
 for(let i=1;i<=5;i++)w.createJob({client_id:1,property_id:1,quote_id:q1.id,title:i===5?'':`Tile Job ${i}`,status:'late',subtotal_cents:i===5?12220000:10000,total_cents:i===5?12220000:10000});
 const inv=w.createInvoice({client_id:1,property_id:1,job_id:1,subject:'Tile Invoice'},[{product_service_id:s1.id,name:'Custom Shower Tile Installation',quantity:1,unit_price_cents:10000,taxable:1}]);
 w.issueInvoice(inv.id);
 w.recordPayment({client_id:1,invoice_id:inv.id,amount_cents:1000});
 r.insert('notifications',{title:'Initial notification',is_read:0});
 if(!db.prepare('SELECT id FROM organizations WHERE id=2').get()){
  db.prepare("INSERT INTO organizations(id,name,slug) VALUES(2,'Second Tenant','second-tenant')").run();
  const r2=repository(db,2),role2=r2.insert('roles',{name:'Owner',slug:'owner',is_system:1});
  r2.insert('users',{role_id:role2.id,name:'Tenant 2 Owner',email:'owner@tenant2.test',password_hash:'x',is_active:1});
  r2.insert('clients',{display_name:'Foreign Client'});
 }
}
function fixture(t){const db=createDatabase();seedDatabase(db);seedRound5TestFixtures(db);t.after(()=>db.close());return workflows(db,1,1);}
async function httpFixture(t){const db=createDatabase();seedDatabase(db);seedRound5TestFixtures(db);const server=await startServer({db,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});const session=await (await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json();return {db,session,reauth:async()=>{const fresh=await (await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json();session.token=fresh.token;},w:workflows(db,1,1),request:async(path,method='GET',data)=>{const res=await fetch(server.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,body:await res.json()};}};}

test('Customer parity: fresh seed contains only the customer organization, roles and users',t=>{
 const db=createDatabase();t.after(()=>db.close());seedDatabase(db);
 assert.deepEqual(db.prepare('SELECT id,name FROM organizations ORDER BY id').all().map(x=>({...x})),[{id:1,name:'J S Custom Tile'}]);
 for(const table of ['roles','users']){
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,4,table);
  assert.equal(repository(db,1).list(table).length,4,table);
 }
 for(const table of ['clients','requests','quotes','jobs','invoices','expenses','subscription_payments','appointments','time_entries','campaigns','notifications','messages'])assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,0,table);
 assert.match(generatePDF({id:1}).toString(),/J S Custom Tile/);
});

test('Customer parity: mark-read is scoped, idempotent and allowed with client read access',async t=>{
 const {db,request}=await httpFixture(t);const other=repository(db,2).insert('notifications',{title:'Other organization',is_read:0});
 repository(db,1).insert('notifications',{title:'Unread 1',is_read:0});
 assert.equal((await request('auth/workspace')).body.unread_notifications,2);
 assert.equal((await request('auth/switch-user','POST',{user_id:4})).status,200);
 assert.deepEqual((await request('notifications/mark-read','POST',{})).body,{marked_read:true,unread_notifications:0});
 assert.equal((await request('auth/workspace')).body.unread_notifications,0);
 assert.equal((await request('notifications/mark-read','POST',{})).status,200);
 assert.equal(repository(db,2).get('notifications',other.id).is_read,0);
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=4 AND resource='clients' AND action='read'").run();
 assert.equal((await request('notifications/mark-read','POST',{})).status,403);
});

test('Astra 6: notification drawer marks only fetched unread IDs and rejects invalid IDs',async t=>{
 const {db,request}=await httpFixture(t),r=repository(db,1),h=domHarness();
 const alreadyRead=r.insert('notifications',{title:'Already read',is_read:1}),other=repository(db,2).insert('notifications',{title:'Other organization',is_read:0});
 let feed,arrived,marked;
 h.context.fetch=async(path,options)=>{
  if(path==='/api/notifications'){
   const result=await request('notifications');feed=result.body;
   arrived=r.insert('notifications',{title:'Arrived after GET',is_read:0});
   return {ok:true,json:async()=>feed};
  }
  assert.equal(path,'/api/notifications/mark-read');assert.equal(options.method,'POST');
  const data=JSON.parse(options.body);assert.deepEqual(data.ids,feed.filter(n=>!n.is_read).map(n=>n.id));assert.ok(!data.ids.includes(alreadyRead.id));
  marked=request('notifications/mark-read','POST',data);const result=await marked;
  return {ok:result.status===200,json:async()=>result.body};
 };
 await h.run("globalPanel('notifications')");assert.ok(marked);
 assert.deepEqual((await marked).body,{marked_read:true,unread_notifications:1});
 for(const n of feed)assert.equal(r.get('notifications',n.id).is_read,1);
 assert.equal(r.get('notifications',arrived.id).is_read,0);
 assert.equal((await request('notifications/mark-read','POST',{ids:[other.id]})).body.unread_notifications,1);
 assert.equal(repository(db,2).get('notifications',other.id).is_read,0);
 assert.equal((await request('notifications/mark-read','POST',{ids:[]})).body.unread_notifications,1);
 for(const ids of [null,{},'1',[0],[-1],[1.5],[Number.MAX_SAFE_INTEGER+1],['1'],[true],[null],[arrived.id,'invalid']]){
  const result=await request('notifications/mark-read','POST',{ids});assert.equal(result.status,400);assert.match(JSON.stringify(result.body),/Invalid notification IDs/);
 }
 assert.equal(r.get('notifications',arrived.id).is_read,0);
});

test('Customer parity: notification drawer renders before mark-read completes',async()=>{
 const h=domHarness();let removed=false;h.elements.set('#notification-badge',{remove(){removed=true;}});
 h.context.fetch=async path=>{h.calls.push(path);if(path.endsWith('mark-read'))return new Promise(()=>{});return {ok:true,json:async()=>Array.from({length:59},(_,i)=>({id:i,title:'Reminder to clock out',body:'Reminder',is_read:0,created_at:'2026-10-17'}))};};
 await h.run("globalPanel('notifications')");assert.equal(removed,true);assert.equal(h.run('unreadNotifications'),0);assert.match(h.elements.get('#overlay').innerHTML,/Activity <span class="tab-count">59/);assert.ok(h.calls.includes('/api/notifications/mark-read'));
});

test('Astra 6 P2: mark-read reconciles new unread notifications and restores failed reads',async()=>{
 for(const fails of [false,true])for(const nativeInsert of [false,true]){
  const h=domHarness(),markup='<span id="notification-badge" class="badge"></span>',header={innerHTML:`<button data-global="notifications">${markup}</button>`};
  h.elements.set('#header',header);
  const addBadge=()=>h.elements.set('#notification-badge',{remove(){h.elements.delete('#notification-badge');header.innerHTML=header.innerHTML.replace(markup,'');}});addBadge();
  if(nativeInsert)h.elements.set('[data-global="notifications"]',{insertAdjacentHTML(position,html){assert.equal(position,'beforeend');header.innerHTML=header.innerHTML.replace('</button>',html+'</button>');addBadge();}});
  let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  h.context.fetch=async path=>path.endsWith('mark-read')?pending:{ok:true,json:async()=>[{id:1,title:'Unread',is_read:0,created_at:'2026-10-17'},{id:2,title:'Unread too',is_read:0,created_at:'2026-10-17'},{id:3,title:'Read',is_read:1,created_at:'2026-10-17'}]};
  await h.run("globalPanel('notifications')");assert.equal(h.run('unreadNotifications'),0);assert.doesNotMatch(header.innerHTML,/notification-badge/);
  h.run("modal('New editor','Unsaved content')");const overlay=h.elements.get('#overlay').innerHTML;
  if(fails)reject(Error('Offline'));else resolve({ok:true,json:async()=>({unread_notifications:1})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.run('unreadNotifications'),fails?2:1);assert.equal((header.innerHTML.match(/id="notification-badge"/g)||[]).length,1);
  h.run('setNotificationBadge(unreadNotifications)');assert.equal((header.innerHTML.match(/id="notification-badge"/g)||[]).length,1);assert.equal(h.elements.get('#overlay').innerHTML,overlay);
 }
});

test('Astra 6 P2: stale mark-read success or failure cannot restore a newer cleared badge',async()=>{
 for(const fails of [false,true])for(const newerUnread of [false,true]){
  const h=domHarness(),pending=[];let opens=0;
  h.elements.set('#notification-badge',{remove(){h.elements.delete('#notification-badge');}});
  h.elements.set('[data-global="notifications"]',{insertAdjacentHTML(){h.elements.set('#notification-badge',{});}});
  h.context.fetch=async(path,options)=>{
   if(path==='/api/notifications'){const is_read=opens++===0||newerUnread?0:1;return {ok:true,json:async()=>[{id:1,title:'Notification',is_read,created_at:'2026-10-17'}]};}
   assert.equal(path,'/api/notifications/mark-read');assert.equal(options.method,'POST');
   return new Promise((resolve,reject)=>pending.push({resolve,reject}));
  };
  await h.run("globalPanel('notifications')");await h.run("globalPanel('notifications')");
  assert.equal(pending.length,newerUnread?2:1);
  if(newerUnread){pending[1].resolve({ok:true,json:async()=>({unread_notifications:0})});await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(h.run('unreadNotifications'),0);assert.equal(h.elements.has('#notification-badge'),false);
  if(fails)pending[0].reject(Error('Offline'));else pending[0].resolve({ok:true,json:async()=>({unread_notifications:1})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.run('unreadNotifications'),0);assert.equal(h.elements.has('#notification-badge'),false);
 }
});

test('Astra 6 P2: campaign migration backfills historical timestamps idempotently',t=>{
 const db=createDatabase();t.after(()=>db.close());
 db.exec('ALTER TABLE campaigns DROP COLUMN updated_at');
 db.exec("INSERT INTO organizations (id,name,slug) VALUES (1,'Test','test'); INSERT INTO campaigns (organization_id,name,created_at,sent_at) VALUES (1,'Draft','2020-01-01',NULL),(1,'Sent','2020-01-01','2020-02-01')");
 migrate(db);assert.deepEqual(db.prepare('SELECT updated_at FROM campaigns ORDER BY id').all().map(c=>c.updated_at),['2020-01-01','2020-02-01']);
 db.exec("UPDATE campaigns SET updated_at='2020-03-01' WHERE id=1");migrate(db);assert.equal(db.prepare('SELECT updated_at FROM campaigns WHERE id=1').get().updated_at,'2020-03-01');
});

test('Astra 6 P2: campaign edits and sends refresh displayed and sorted Last Updated',async t=>{
 const {db,request}=await httpFixture(t),r=repository(db,1),h=domHarness();
 for(const action of ['edit','send']){
  const old=r.insert('campaigns',{name:'Older '+action,created_at:'2020-01-01',updated_at:'2020-01-01',subject:'Offer',body:'Hello'}),newer=r.insert('campaigns',{name:'Newer '+action,created_at:'2021-01-01',updated_at:'2021-01-01'});
  h.context.campaigns=[old,newer];assert.equal(h.run("campaignSort={key:'created_at',direction:-1};sortCampaignList(campaigns)[0].id"),newer.id);
  const before=Date.now(),result=await request('marketing/campaigns/'+old.id+(action==='send'?'/send':''),action==='send'?'POST':'PATCH',action==='send'?{}:{name:'Edited campaign'});assert.equal(result.status,200);
  const updated=r.get('campaigns',old.id);assert.ok(Date.parse(updated.updated_at)>=before);assert.equal(updated.created_at,old.created_at);
  h.context.campaigns=[updated,newer];assert.equal(h.run('sortCampaignList(campaigns)[0].id'),old.id);assert.equal(h.run('campaignColumns[7][1](campaigns[0])'),h.run('esc(monthDay(campaigns[0].updated_at))'));
 }
 h.context.campaigns=[{id:1,created_at:'2020-01-01',sent_at:'2022-01-01'},{id:2,created_at:'2021-01-01'}];assert.equal(h.run('sortCampaignList(campaigns)[0].id'),1);assert.equal(h.run('campaignColumns[7][1](campaigns[0])'),h.run('esc(monthDay(campaigns[0].sent_at))'));
});

test('Astra 6 P2: campaign job display and sorting never use revenue cents',()=>{
 const h=domHarness();h.context.campaigns=[{id:1,jobs_count:'2',revenue_attributed_cents:0},{id:2,revenue_attributed_cents:90000},{id:3,jobs_count:null,revenue_attributed_cents:80000},{id:4,jobs_count:'invalid',revenue_attributed_cents:70000},{id:5,jobs_count:0,revenue_attributed_cents:60000}];
 assert.equal(h.run('campaigns.map(c=>campaignColumns[3][1](c)).join()'),'2,0,0,0,0');
 assert.equal(h.run("campaignSort={key:'jobs_count',direction:1};sortCampaignList(campaigns).map(c=>c.id).join()"),'2,3,4,5,1');
 assert.equal(h.run("campaignSort.direction=-1;sortCampaignList(campaigns).map(c=>c.id).join()"),'1,2,3,4,5');
});

test('Customer parity: expense report category and all client hub sections render',async()=>{
 const h=domHarness();h.run("clients=[{id:1}]");const reports=h.run('reports()');assert.equal((reports.match(/<section class="card">/g)||[]).length,6);assert.match(reports,/Expense reports/);assert.equal(h.run("reportTypes.Mileage"),'mileage');assert.equal(h.run("reportTypes['Delete log']"),'delete_log');
 const hub=await h.run("settings('client-hub')");for(const key of ['Menu visibility','Signatures','Change requests','Appointment times','Request forms','Primary button','Referrals'])assert.ok(hub.includes(`data-preference="hub-${key}"`));assert.equal((hub.match(/class="hub-section"/g)||[]).length,7);
});

test('Customer parity: campaign layout, filters, sorting, generation and automation setup',async t=>{
 const h=domHarness();h.run("org={name:'J S Custom Tile'};marketingTab='Email Campaigns'");
 h.context.fetch=async()=>({ok:true,json:async()=>[{id:1,name:'Shower',subject:'Tile',status:'draft',created_at:'2026-10-01',opened_count:10},{id:2,name:'Bath',subject:'Tile',status:'sent',created_at:'2026-10-02',opened_count:2}]});
 const html=await h.run('marketing()');for(const text of ['AI Campaign Generator','Set up automated Campaigns','Re-engage past clients','Win back lost leads','Quote follow-ups','All Campaigns','Jack Surwald','One-off'])assert.ok(html.includes(text));assert.match(html,/send-campaign:1/);assert.doesNotMatch(html,/send-campaign:2/);
 for(const id of ['search','creator-filter','status-filter','type-filter','table','count'])h.elements.set('#campaign-'+id,{value:'',innerHTML:'',textContent:''});
 const headers=Array.from({length:8},()=>({setAttribute(){}}));h.context.document.querySelectorAll=s=>s==='#campaign-table th'?headers:[];h.run('bindCampaigns()');headers[1].onclick();assert.ok(h.elements.get('#campaign-table').innerHTML.indexOf('Bath')<h.elements.get('#campaign-table').innerHTML.indexOf('Shower'));
 h.elements.get('#campaign-status-filter').value='draft';h.elements.get('#campaign-status-filter').onchange();assert.equal(h.elements.get('#campaign-count').textContent,'(1 results)');
 h.elements.get('#campaign-search').value='missing';h.elements.get('#campaign-search').oninput();assert.equal(h.elements.get('#campaign-count').textContent,'(0 results)');
 h.elements.set('#campaign-prompt',{value:'Custom tile offer'});h.run('render=async()=>{}');h.context.fetch=async(path,options)=>{h.calls.push({path,options});return {ok:true,json:async()=>({id:3})};};await h.click({action:'generate-email'});const call=h.calls.find(c=>c.path==='/api/marketing/campaigns');assert.equal(JSON.parse(call.options.body).status,'draft');
 for(const option of ['reengage','lost-leads','quote-followups']){await h.click({action:'setup-auto-campaign:'+option});await h.elements.get('#action-form').onsubmit({preventDefault(){},target:{values:{name:option,subject:'Tile',body:'J S Custom Tile',delay_minutes:'10'}}});}
 const w=fixture(t),r=w.r,generated=JSON.parse(call.options.body);assert.ok(generated.body.includes('Hi {{client_name}},'));
 const dollarClient=r.update('clients',1,{display_name:'Tile $& Stone',status:'active',receives_marketing:1,receives_email:1});
 const campaign=r.insert('campaigns',generated),before=new Set(r.list('messages').map(m=>m.id)),sent=w.sendCampaign(campaign.id),messages=r.list('messages').filter(m=>!before.has(m.id));
 assert.ok(messages.length>1);assert.equal(messages.length,sent.recipients_count);
 for(const message of messages){const client=r.get('clients',message.client_id);assert.ok(message.body.includes(`Hi ${client.display_name},`));assert.ok(!message.body.includes('{{client_name}}'));assert.ok(!message.subject.includes('{{client_name}}'));}
 assert.ok(messages.find(m=>m.client_id===dollarClient.id).body.includes('Hi Tile $& Stone,'));
 const rule=r.insert('automations',{name:'Literal client name',trigger_event:'client_created',delay_minutes:0,conditions_json:{},action_type:'send_email',action_config_json:{subject:'Hi {{client_name}},',body:'Hi {{client_name}},'},is_enabled:1});
 const run=emit(r,'client_created','clients',dollarClient.id).find(run=>run.automation_id===rule.id);
 runPending(r.db,new Date(run.scheduled_for));assert.equal(r.get('automation_executions',run.id).status,'succeeded');
 const message=r.list('messages',{client_id:dollarClient.id,subject:'Hi Tile $& Stone,'})[0];assert.ok(message);assert.equal(message.body,'Hi Tile $& Stone,');assert.equal(message.subject,'Hi Tile $& Stone,');
 const automations=h.calls.filter(c=>c.path==='/api/automations').map(c=>JSON.parse(c.options.body));assert.equal(automations.length,3);
 assert.deepEqual(automations.map(a=>a.conditions_json),[{status:{in:['requires_invoicing','completed']}},{status:'lead'},{status:'awaiting_response'}]);
});

test('Astra 6 P2: delayed quote follow-ups skip approved and superseded sends',t=>{
 const w=fixture(t),r=w.r,rule=r.insert('automations',{name:'Quote follow-ups',trigger_event:'quote_sent',delay_minutes:4320,conditions_json:{status:'awaiting_response'},action_type:'send_email',action_config_json:{subject:'Delayed quote follow-up',body:'Still interested?'},is_enabled:1});
 const quote=()=>w.createQuote({client_id:1,title:'Delayed follow-up'},[{name:'Tile',quantity:1,unit_price_cents:1000}]);
 const approved=quote(),resent=quote(),waiting=quote();
 const taskRule=r.insert('automations',{name:'Record sent quote',trigger_event:'quote_sent',conditions_json:{},delay_minutes:0,action_type:'create_task',action_config_json:{title:'Record sent quote'},is_enabled:1});
 for(const q of [approved,resent,waiting])w.sendQuote(q.id);
 const initial=r.list('automation_executions',{automation_id:rule.id});assert.equal(initial.length,3);
 w.approveQuote(approved.id,'Client');w.requestChanges(resent.id,'Please revise');w.sendQuote(resent.id);
 const runs=r.list('automation_executions',{automation_id:rule.id});assert.equal(runs.length,4);
 const due=new Date(Math.max(...runs.map(run=>Date.parse(run.scheduled_for))));
 runPending(r.db,new Date(Math.min(...runs.map(run=>Date.parse(run.scheduled_for)))-1));
 assert.ok(r.list('automation_executions',{automation_id:rule.id}).every(run=>run.status==='queued'));
 assert.equal(r.list('messages',{subject:'Delayed quote follow-up'}).length,0);
 runPending(r.db,due);
 assert.equal(r.list('automation_executions',{automation_id:taskRule.id,entity_id:approved.id})[0].status,'succeeded');
 assert.equal(r.list('automation_executions',{automation_id:rule.id,entity_id:approved.id})[0].status,'skipped');
 for(const run of initial){const saved=r.get('automation_executions',run.id);assert.equal(saved.status,run.entity_id===waiting.id?'succeeded':'skipped');assert.equal(saved.executed_at,due.toISOString());if(saved.status==='skipped')assert.equal(saved.attempt_count,0);}
 assert.equal(r.get('automation_executions',runs.at(-1).id).status,'succeeded');
 assert.equal(r.list('messages',{subject:'Delayed quote follow-up'}).length,2);
 runPending(r.db,due);assert.equal(r.list('messages',{subject:'Delayed quote follow-up'}).length,2);
 const custom=emit(r,'quote_sent','quotes',resent.id,'external-event-123')[0];
 runPending(r.db,new Date(Date.parse(custom.scheduled_for)+1));
 assert.equal(r.get('automation_executions',custom.id).status,'succeeded');
});

test('Astra 6 P2: delayed lost-lead campaigns recheck client conditions',t=>{
 const w=fixture(t),r=w.r,rule=r.insert('automations',{name:'Win back lost leads',trigger_event:'client_created',delay_minutes:10080,conditions_json:{status:'lead'},action_type:'send_email',action_config_json:{subject:'Delayed lost-lead follow-up',body:'Ready to start?'},is_enabled:1});
 const converted=w.createClient({display_name:'Converted lead',status:'lead',email:'converted@example.test',receives_email:1}),lead=w.createClient({display_name:'Still a lead',status:'lead',email:'lead@example.test',receives_email:1});
 r.update('clients',converted.id,{status:'active'});
 const runs=r.list('automation_executions',{automation_id:rule.id});assert.equal(runs.length,2);
 runPending(r.db,new Date(Math.max(...runs.map(run=>Date.parse(run.scheduled_for)))));
 for(const run of runs)assert.equal(r.get('automation_executions',run.id).status,run.entity_id===converted.id?'skipped':'succeeded');
 const messages=r.list('messages',{subject:'Delayed lost-lead follow-up'});assert.equal(messages.length,1);assert.equal(messages[0].client_id,lead.id);
 for(const reverse of [false,true]){
  const w=fixture(t),r=w.r,actions=[{action_type:'change_status',action_config_json:{status:'active'}},{action_type:'create_task',action_config_json:{title:'Lead onboarding'}}];
  if(reverse)actions.reverse();
  const rules=actions.map(action=>r.insert('automations',{name:action.action_type,trigger_event:'client_created',delay_minutes:0,conditions_json:{status:'lead'},is_enabled:1,...action}));
  const client=w.createClient({display_name:'Immediate onboarding',status:'lead'}),runs=r.list('automation_executions',{entity_type:'clients',entity_id:client.id}).filter(run=>rules.some(rule=>rule.id===run.automation_id));
  assert.equal(runs.length,2);assert.ok(runs.every(run=>run.status==='queued'));
  runPending(r.db,new Date(Math.max(...runs.map(run=>Date.parse(run.scheduled_for)))));
  for(const run of runs)assert.equal(r.get('automation_executions',run.id).status,'succeeded');
  assert.equal(r.get('clients',client.id).status,'active');assert.equal(r.list('tasks',{client_id:client.id,title:'Lead onboarding'}).length,1);
 }
});

test('Astra 6: marketing re-renders preserve campaign order matching aria-sort',async()=>{
 const h=domHarness();h.run("marketingTab='Email Campaigns'");
 const campaigns=[{id:1,name:'Zulu',status:'draft',opened_count:9,jobs_count:5,revenue_attributed_cents:5,created_at:'2026-10-01',updated_at:'2026-10-03'},{id:2,name:'Alpha',status:'draft',opened_count:2,jobs_count:0,revenue_attributed_cents:99,created_at:'2026-10-02'}];
 h.context.fetch=async()=>({ok:true,json:async()=>campaigns});
 for(const id of ['search','creator-filter','status-filter','type-filter','table','count'])h.elements.set('#campaign-'+id,{value:'',innerHTML:'',textContent:''});
 const headers=Array.from({length:8},()=>({setAttribute(key,value){this[key]=value;}}));h.context.document.querySelectorAll=s=>s==='#campaign-table th'?headers:[];
 await h.run('marketing()');h.run('bindCampaigns()');
 for(const column of [0,1,3,7])for(const direction of ['ascending','descending']){
  headers[column].onclick();assert.equal(headers[column]['aria-sort'],direction);
  const expected=h.elements.get('#campaign-table').innerHTML;
  assert.ok(expected.indexOf(direction==='ascending'?'Alpha':'Zulu')<expected.indexOf(direction==='ascending'?'Zulu':'Alpha'));
  await h.run("marketingTab='Dashboard';marketing()");h.run("marketingTab='Email Campaigns'");
  const html=await h.run('marketing()');h.run('bindCampaigns()');
  assert.ok(html.includes(`<div id="campaign-table">${expected}</div>`));assert.equal(headers[column]['aria-sort'],direction);
  assert.deepEqual(campaigns.map(c=>c.name),['Zulu','Alpha']);
 }
});

test('Customer parity: stale marketing responses cannot overwrite campaigns after navigation',async()=>{
 const h=domHarness(),pending=[];h.elements.set('#breadcrumb',{textContent:''});
 h.context.fetch=()=>new Promise(resolve=>pending.push(data=>resolve({ok:true,json:async()=>data})));
 h.run("route='campaigns'");const stale=h.run('render()');
 await h.run("route='reports';render()");
 const reportHTML=h.elements.get('#workspace').innerHTML;
 pending.shift()([{id:1,name:'Stale',status:'draft'}]);await stale;
 assert.equal(h.run('campaignRows.length'),0);assert.equal(h.elements.get('#workspace').innerHTML,reportHTML);
 h.run("route='campaigns'");const older=h.run('render()'),newer=h.run('render()');
 pending[1]([{id:3,name:'Newest',status:'draft',created_at:'2026-10-28'}]);await newer;
 const campaignHTML=h.elements.get('#workspace').innerHTML;
 pending[0]([{id:2,name:'Older',status:'draft',created_at:'2026-10-27'}]);await older;
 assert.equal(h.run('campaignRows[0].id'),3);assert.equal(h.elements.get('#workspace').innerHTML,campaignHTML);
});

test('Customer parity: all list resources sort numerically and retain active search/status filters',()=>{
 for(const [type,label,key,low,high] of [['clients','Name ↕','display_name','Alpha','Zulu'],['requests','Requested','created_at','2026-01-01','2026-10-01'],['quotes','Total','total_cents',2,10],['jobs','Job number','job_number',2,10],['invoices','Balance','balance_due_cents',2,10],['expenses','Amount','amount_cents',2,10],['payments','Amount','amount_cents',2,10]]){
  const h=domHarness(),th={textContent:label,setAttribute(){}};h.context.document.querySelectorAll=s=>s==='#data-table th'?[th]:[];
  for(const [id,value] of [['table-search','keep'],['status-filter','active']])h.elements.set('#'+id,{value});for(const id of ['data-table','result-count'])h.elements.set('#'+id,{innerHTML:'',textContent:''});
  h.context.inputRows=[{id:1,status:'active',title:'keep',display_name:'keep',created_at:'2026-10-01',updated_at:'2026-10-01',date_incurred:'2026-10-01',[key]:high},{id:2,status:'active',title:'keep',display_name:'keep',created_at:'2026-10-01',updated_at:'2026-10-01',date_incurred:'2026-10-01',[key]:low},{id:3,status:'draft',title:'keep',[key]:low},{id:4,status:'active',title:'excluded',[key]:high}];
  h.run(`resource='${type}';rows=inputRows;bindView()`);th.onclick();let html=h.elements.get('#data-table').innerHTML;assert.ok(html.indexOf('data-id="2"')<html.indexOf('data-id="1"'));assert.doesNotMatch(html,/data-id="[34]"/);assert.equal(h.elements.get('#result-count').textContent,'(2 results)');th.onclick();html=h.elements.get('#data-table').innerHTML;assert.ok(html.indexOf('data-id="1"')<html.indexOf('data-id="2"'));assert.equal(h.elements.get('#table-search').value,'keep');
 }
});

test('Astra 6 P2: OAuth refresh transfers revision ownership and logout clears it',async t=>{
 const {w,request,session}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'OAuth revision',field_key:'oauth_revision',field_type:'text'});
 const authenticate=async()=>{const grant=await request('oauth/authorize','POST',{response_type:'code',client_id:'revision-test'});assert.equal(grant.status,200);const result=await request('oauth/token','POST',{grant_type:'authorization_code',client_id:'revision-test',code:grant.body.code});assert.equal(result.status,200);return result.body;},initial=session.token;
 const save=(revision,value_text)=>request('custom-field-values','POST',{field_definition_id:field.id,entity_type:'jobs',entity_id:1,rev_scope:'oauth-refresh',revision,value_text});
 const a=await authenticate();session.token=a.access_token;
 const first=await save(5,'A5');assert.equal(first.status,201);assert.equal(first.body.value_text,'A5');
 const refreshed=await request('oauth/token','POST',{grant_type:'refresh_token',client_id:'revision-test',refresh_token:a.refresh_token});assert.equal(refreshed.status,200);session.token=refreshed.body.access_token;
 const stale=await save(1,'Stale B');assert.equal(stale.status,200);assert.equal(stale.body.value_text,'A5');
 const second=await save(6,'B6');assert.equal(second.status,200);assert.equal(second.body.value_text,'B6');
 assert.equal((await request('auth/logout','POST',{})).status,200);
 session.token=initial;const c=await authenticate();session.token=c.access_token;
 const fresh=await save(1,'C1');assert.equal(fresh.status,200);assert.equal(fresh.body.value_text,'C1');assert.equal(w.r.get('custom_field_values',first.body.id).value_text,'C1');
});

test('Astra 6 P2: visit deletion preserves unrelated custom automation keys',async t=>{
 const {w,request}=await httpFixture(t),visit=w.createVisit(1),client=w.createClient({display_name:'Unrelated automation client'}),rule=w.r.insert('automations',{name:'Visit cleanup',trigger_event:'visit_approaching',action_type:'create_task',is_enabled:1}),rule2=w.r.insert('automations',{name:'Visit cleanup 2',trigger_event:'visit_approaching',action_type:'create_task',is_enabled:1});
 const add=(entity_type,entity_id,key,rId=rule.id)=>w.r.insert('automation_executions',{automation_id:rId,trigger_event:'visit_approaching',entity_type,entity_id,idempotency_key:`${rId}:${key}`,status:'queued',scheduled_for:'2099-01-01T00:00:00.000Z'});
 const keep=[add('clients',client.id,`external:visit:${visit.id}`),add('clients',client.id,`visit:${visit.id}`),add('jobs',visit.job_id,`external:visit:${visit.id}`,rule2.id)];
 const remove=[add('jobs',visit.job_id,`visit:${visit.id}`,rule2.id),add('jobs',visit.job_id,`reminder:${visit.id}:2099-01-01`),add('visits',visit.id,`reminder:${visit.id}:2099-01-02`)];
 const retainedKeys=[`external:visit:${visit.id}`,`visit:${visit.id}:custom`,`reminder:${visit.id}`,`reminder:${visit.id}:`],sub=w.r.insert('webhook_subscriptions',{topic:'*',target_url:'https://example.test/hook',secret:'test',active:1,delivered_keys_json:JSON.stringify([...retainedKeys,`visit:${visit.id}`,`reminder:${visit.id}:2099-01-01`,`visit_completed:visits:${visit.id}:99`])});
 assert.equal((await request('visits/'+visit.id,'DELETE')).status,200);
 const ids=new Set(w.r.list('automation_executions').map(row=>row.id));for(const row of keep)assert.ok(ids.has(row.id));for(const row of remove)assert.ok(!ids.has(row.id));
 assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),retainedKeys);
});

test('Astra 6 P2: newer search and settings panels supersede pending responses',async()=>{
 for(const query of ['', 'tile']){
  const h=domHarness();h.elements.set('.global-search',{value:query});
  h.run("user={name:'Test User'};org={email:'test@example.test'};activeDetailKey='clients:1'");
  let resolvePreferences;
  h.context.fetch=async path=>({ok:true,json:()=>path==='/api/preferences'?new Promise(resolve=>{resolvePreferences=resolve;}):[]});
  const pending=h.run("globalPanel('settings')");
  await Promise.resolve();await Promise.resolve();
  await h.run('globalSearch()');
  const html=h.elements.get('#overlay').innerHTML;
  assert.match(html,query?/Search results/:/Search your workspace/);
  assert.equal(h.run('activeDetailKey'),'');
  resolvePreferences([]);await pending;
  assert.equal(h.elements.get('#overlay').innerHTML,html);
 }
 const h=domHarness();h.elements.set('.global-search',{value:'tile'});
 h.context.document.body={classList:{contains:()=>false}};
 h.run("user={name:'Test User'};org={email:'test@example.test'}");
 const pendingResults=[];
 h.context.fetch=async path=>({ok:true,json:()=>path==='/api/preferences'?[]:new Promise(resolve=>pendingResults.push(resolve))});
 const pending=h.run('globalSearch()');
 await h.run("globalPanel('settings')");
 const html=h.elements.get('#overlay').innerHTML;assert.match(html,/settings-menu/);
 for(const resolve of pendingResults)resolve([]);
 await pending;assert.equal(h.elements.get('#overlay').innerHTML,html);
});

test('Astra 6 P2: null event keys generate deduplicated deliveries and invalid keys fail',async t=>{
 const {w,request}=await httpFixture(t),client=w.createClient({display_name:'Null key client'});
 const sub=w.r.insert('webhook_subscriptions',{topic:'invoice_overdue',target_url:'https://example.test/hook',secret:'test',active:1});
 const rule=w.r.insert('automations',{name:'Null key rule',trigger_event:'invoice_overdue',action_type:'create_task',is_enabled:1});
 const data={event:'invoice_overdue',entity_type:'clients',entity_id:client.id,event_key:null};
 const first=await request('automations/run','POST',data),second=await request('automations/run','POST',data);
 assert.equal(first.status,200);assert.equal(second.status,200);assert.deepEqual(second.body,first.body);
 const key=`invoice_overdue:clients:${client.id}`,saved=w.r.get('webhook_subscriptions',sub.id);
 assert.equal(saved.delivery_count,1);assert.deepEqual(JSON.parse(saved.delivered_keys_json),[key]);
 assert.ok(first.body.some(r=>r.idempotency_key===`${rule.id}:${key}`));
 for(const event_key of ['', ' \t ', 0, 42, false, true, [], {}]){
  const result=await request('automations/run','POST',{...data,event_key});
  assert.equal(result.status,400);assert.equal(result.body.error,'Invalid event key');
 }
 assert.equal(w.r.get('webhook_subscriptions',sub.id).delivery_count,1);
 for(const event_key of ['  explicit-key  ','explicit-key'])assert.equal((await request('automations/run','POST',{...data,event_key})).status,200);
 assert.equal(w.r.get('webhook_subscriptions',sub.id).delivery_count,2);
 assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),[key,'explicit-key']);
});

test('Astra 6 P3: billing normalizes accepted null, primitive and malformed preference fields',async t=>{
 const {request}=await httpFixture(t);
 const cases=[...['null','false','42','"plan"','[]'].map(value_json=>[value_json,'Plus Monthly',59900,[]]),
  [JSON.stringify({plan:42,price_cents:-1,addons:'Marketing'}),'Plus Monthly',59900,[]],
  [JSON.stringify({plan:' ',price_cents:'3900',addons:{}}),'Plus Monthly',59900,[]],
  [JSON.stringify({plan:'Core',price_cents:null,addons:null}),'Core',59900,[]],
  [JSON.stringify({plan:'Core',price_cents:3900.6,addons:['Marketing',null,1,{}]}),'Core',3901,['Marketing']],
  [JSON.stringify({plan:'Core',price_cents:0,addons:[]}),'Core',0,[]]];
 for(const [value_json,plan,price_cents,addons] of cases){
  const saved=await request('preferences','POST',{name:'account-plan',value_json});assert.ok([200,201].includes(saved.status));
  const billing=await request('account-billing');assert.equal(billing.status,200);
  assert.equal(billing.body.plan,plan);assert.equal(billing.body.price_cents,price_cents);assert.deepEqual(billing.body.addons,addons);
  const h=domHarness();h.context.fetch=async()=>({ok:true,json:async()=>billing.body});
  await h.run("gapAction('subscription')");assert.match(h.elements.get('#overlay').innerHTML,/Manage Plan/);
  assert.match(await h.run("settings('account-billing')"),/Account and billing/);
 }
});

test('Astra 6 P2: UI preference readers tolerate saved null and primitive values',async t=>{
 const {request}=await httpFixture(t);
 for(const value_json of ['null','false','0','42','"text"','[]']){
  for(const name of ['workspace-language','product-updates','rewards-claimed','request-form-null']){
   const saved=await request('preferences','POST',{name,value_json});assert.ok([200,201].includes(saved.status));
  }
  const prefs=await request('preferences'),h=domHarness();
  h.context.document.body={classList:{contains:()=>false}};
  h.run("user={name:'Test User'};org={email:'test@example.test'}");
  h.context.fetch=async path=>({ok:true,json:async()=>path==='/api/preferences'?prefs.body:[]});
  await h.run("globalPanel('settings')");assert.match(h.elements.get('#overlay').innerHTML,/English \(US\)/);
  for(const action of ['updates','language','rewards'])await h.run(`gapAction('${action}')`);
  assert.match(await h.run("settings('requests-and-bookings')"),/Forms/);
 }
});

test('Astra 6 P2: failed client deletion preserves custom field revision protection',async t=>{
 const {w,request}=await httpFixture(t),client=w.createClient({display_name:'Protected client'});
 w.createQuote({client_id:client.id,title:'Dependent quote'});
 const field=w.r.insert('custom_field_definitions',{entity_type:'clients',field_name:'Access',field_key:'delete_guard',field_type:'text'});
 const save=(revision,value_text)=>request('custom-field-values','POST',{field_definition_id:field.id,entity_type:'clients',entity_id:client.id,rev_scope:'failed-delete',revision,value_text});
 const saved=await save(2,'Latest');assert.equal(saved.status,201);
 const deleted=await request(`clients/${client.id}`,'DELETE');assert.equal(deleted.status,400);assert.match(deleted.body.error,/FOREIGN KEY/i);
 assert.equal(w.r.get('clients',client.id).id,client.id);assert.equal(w.r.get('custom_field_values',saved.body.id).value_text,'Latest');
 const delayed=await save(1,'Stale');assert.equal(delayed.status,200);assert.equal(delayed.body.value_text,'Latest');
 assert.equal(w.r.get('custom_field_values',saved.body.id).value_text,'Latest');
});

test('Astra 6 P2: failed custom field reads cannot expose defaults or save over persisted values',async t=>{
 const {w,request}=await httpFixture(t),client=w.createClient({display_name:'Read failure client'});
 const field=w.r.insert('custom_field_definitions',{entity_type:'clients',field_name:'Access',field_key:'read_guard',field_type:'text',default_value:'Unsafe fallback'});
 const saved=w.r.insert('custom_field_values',{field_definition_id:field.id,entity_type:'clients',entity_id:client.id,value_text:'Persisted access'});
 for(const endpoint of ['custom-field-values','custom-fields']){
  const h=domHarness();let writes=0;
  h.context.fetch=async(path,options={})=>{
   if(options.method&&options.method!=='GET')writes++;
   if(path==='/api/'+endpoint)return {ok:false,status:500,json:async()=>({error:'Read failed'})};
   const result=await request(path.slice(5),options.method||'GET',options.body?JSON.parse(options.body):undefined);
   return {ok:result.status<400,status:result.status,json:async()=>result.body};
  };
  await h.run(`detail('clients',${client.id})`);
  const html=h.elements.get('#overlay').innerHTML;
  assert.match(html,/<h3>Custom Fields<\/h3><p>Unable to load custom fields\.<\/p>/);
  assert.doesNotMatch(html,/id="custom-|save-custom-field:|Unsafe fallback/);
  await assert.rejects(h.run(`gapAction('save-custom-field:${field.id}:clients:${client.id}')`),/Custom field unavailable/);
  h.elements.set('#custom-'+field.id,{value:'Unsafe fallback',disabled:true});
  await assert.rejects(h.run(`gapAction('save-custom-field:${field.id}:clients:${client.id}')`),/Custom field unavailable/);
  assert.equal(writes,0);assert.equal(w.r.get('custom_field_values',saved.id).value_text,'Persisted access');
 }
});

test('Astra 6 P2: supplementary read failures render unavailable sections without controls',async()=>{
 for(const [endpoint,section,control] of [['tags','tags','add-entity-tag'],['entity-tags','tags','add-entity-tag'],['checklists','checklists','add-checklist-item'],['checklist-items','checklists','add-checklist-item'],['attachments','attachments','add-attachment']]){
  const h=domHarness();h.context.fetch=async path=>({ok:path!=='/api/'+endpoint,status:path==='/api/'+endpoint?500:200,json:async()=>path==='/api/'+endpoint?{error:'Read failed'}:[]});
  const html=await h.run("entitySections('jobs',1)");
  assert.ok(html.includes(`<p>Unable to load ${section}.</p>`));assert.ok(!html.includes(control));
 }
});

test('Final audit: deleted clients and jobs do not transfer polymorphic metadata to reused IDs',async t=>{
 const {w,request}=await httpFixture(t);
 for(const entity_type of ['clients','jobs']){
  const create=()=>entity_type==='clients'?w.createClient({display_name:'Metadata owner'}):w.createJob({client_id:1,title:'Metadata owner'});
  const row=create(),entity_id=row.id,tag=w.r.insert('tags',{name:'Old metadata'}),field=w.r.insert('custom_field_definitions',{entity_type,field_name:'Old metadata',field_key:'old_'+entity_type,field_type:'text'});
  w.r.insert('entity_tags',{entity_type,entity_id,tag_id:tag.id});w.r.insert('attachments',{entity_type,entity_id,file_name:'old.txt',content_text:'Old attachment'});
  const save=(revision,value_text)=>request('custom-field-values','POST',{field_definition_id:field.id,entity_type,entity_id,rev_scope:'reuse',revision,value_text});
  assert.equal((await save(10,'Old value')).status,201);
  const activity=w.r.insert('activity_logs',{entity_type,entity_id,action:'metadata'}),message=w.r.insert('messages',{related_entity_type:entity_type,related_entity_id:entity_id,body:'Old message'}),notification=w.r.insert('notifications',{entity_type,entity_id,title:'Old notification'});
  assert.equal((await request(`${entity_type}/${entity_id}`,'DELETE')).status,200);
  assert.equal(create().id,entity_id);
  for(const table of ['entity_tags','custom_field_values','attachments'])assert.deepEqual(w.r.list(table,{entity_type,entity_id}),[]);
  assert.equal(w.r.get('activity_logs',activity.id).entity_id,null);assert.equal(w.r.get('messages',message.id).related_entity_id,null);assert.equal(w.r.get('notifications',notification.id).entity_id,null);
  assert.equal((await save(1,'Replacement')).status,201);assert.equal((await save(2,'Updated replacement')).body.value_text,'Updated replacement');
 }
});
test('Final audit: moved and recreated custom values reset revision guards',async t=>{
 const {db,w,request}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'clients',field_name:'Moved value',field_key:'moved_value',field_type:'text'});
 for(const method of ['PATCH','PUT','recreate']){
  const source=w.createClient({display_name:'Source'}),destination=w.createClient({display_name:'Destination'});
  const save=(entity_id,revision,value_text)=>request('custom-field-values','POST',{field_definition_id:field.id,entity_type:'clients',entity_id,rev_scope:'move',revision,value_text});
  const original=await save(source.id,10,'Original');assert.equal(original.status,201);
  if(method==='recreate')db.prepare('DELETE FROM custom_field_values WHERE id=?').run(original.body.id);
  else {
   const prior=await save(destination.id,20,'Destination');assert.equal(prior.status,201);
   // Leave a stale destination guard to verify that moving clears both keys.
   db.prepare('DELETE FROM custom_field_values WHERE id=?').run(prior.body.id);
   assert.equal((await request(`custom-field-values/${original.body.id}`,method,{entity_id:destination.id})).status,200);
   assert.equal((await save(destination.id,1,'Moved update')).body.value_text,'Moved update');
  }
  assert.equal((await save(source.id,1,'Recreated')).status,201);
  const updated=await save(source.id,2,'Revision two');assert.equal(updated.status,200);assert.equal(updated.body.value_text,'Revision two');
  assert.equal(w.r.get('custom_field_values',updated.body.id).value_text,'Revision two');
 }
});
test('Final audit: completed uninvoiced jobs can complete and move to Invoiced',async t=>{
 const {w,request}=await httpFixture(t);
 for(const explicitCompletion of [true,false]){
  const job=w.createJob({client_id:1,title:'Completed uninvoiced',status:'completed',subtotal_cents:1000,total_cents:1000});
  assert.deepEqual(w.r.list('invoices',{job_id:job.id}),[]);
  if(explicitCompletion){const completed=await request(`jobs/${job.id}/complete`,'POST',{});assert.equal(completed.status,200);assert.equal(completed.body.status,'requires_invoicing');}
  const moved=await request('pipeline','POST',{resource:'jobs',id:job.id,stage:'Invoiced'});
  assert.equal(moved.status,200);assert.equal(moved.body.job_id,job.id);assert.equal(moved.body.status,'awaiting_payment');assert.equal(moved.body.total_cents,1000);
  assert.equal(w.r.get('jobs',job.id).status,'completed');assert.equal(w.r.list('invoices',{job_id:job.id}).length,1);
  const retry=await request(`jobs/${job.id}/complete`,'POST',{});assert.equal(retry.status,200);assert.equal(retry.body.status,'completed');
 }
});

test('Final audit: typing while either checklist endpoint loads survives drawer refresh',async()=>{
 for(const endpoint of ['checklists','checklist-items']){
  const h=domHarness(),input={value:'Before loading'};let release,reached;
  const gate=new Promise(resolve=>release=resolve),loading=new Promise(resolve=>reached=resolve);
  h.elements.set('#custom-4',input);h.run("modal('Job','',true,false,'jobs:9')");
  h.context.fetch=async path=>({ok:true,json:async()=>{
   if(path==='/api/'+endpoint){reached();await gate;}
   if(path==='/api/custom-fields')return [{id:4,entity_type:'jobs',field_name:'Access'}];
   if(path==='/api/jobs/9')return {id:9,title:'Job',status:'active'};
   return [];
  }});
  const refresh=h.run("detail('jobs',9,panelVersion)");await loading;
  // Let all other supplementary requests settle before typing.
  await new Promise(resolve=>setImmediate(resolve));input.value='Typed during checklist loading';release();await refresh;
  assert.match(h.elements.get('#overlay').innerHTML,/value="Typed during checklist loading"/);
 }
});
test('Final audit: overlapping loads use the rendered record as the draft owner',async()=>{
 const h=domHarness(),input={value:'Record A draft'};let release,reached;
 const gate=new Promise(resolve=>release=resolve),loading=new Promise(resolve=>reached=resolve);
 h.elements.set('#custom-4',input);h.run("modal('A','',true,false,'jobs:9')");
 let pending=true;
 h.context.fetch=async path=>({ok:true,json:async()=>{
  if(path==='/api/jobs/10'&&pending){pending=false;reached();await gate;}
  if(/^\/api\/jobs\/\d+$/.test(path))return {id:Number(path.split('/').at(-1)),title:'Job',status:'active'};
  if(path==='/api/custom-fields')return [{id:4,entity_type:'jobs',field_name:'Access',default_value:'Record B persisted'}];
  return [];
 }});
 const first=h.run("detail('jobs',10)");await loading;
 assert.equal(h.run('activeDetailKey'),'jobs:9');
 await h.run("detail('jobs',10)");release();await first;
 assert.match(h.elements.get('#overlay').innerHTML,/value="Record B persisted"/);assert.doesNotMatch(h.elements.get('#overlay').innerHTML,/Record A draft/);
 assert.equal(h.run('activeDetailKey'),'jobs:10');h.run("modal('Other','')");assert.equal(h.run('activeDetailKey'),'');
});
test('Final audit: equal and lower revisions retain shared guards until both sessions logout',async t=>{
 const {w,request,reauth,session}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Shared retries',field_key:'shared_retries',field_type:'text'});
 const save=(rev_scope,revision,value_text)=>request('custom-field-values','POST',{field_definition_id:field.id,entity_type:'jobs',entity_id:1,rev_scope,revision,value_text});
 const first=session.token;for(const scope of ['equal','lower'])await save(scope,5,'Latest');
 await reauth();const second=session.token;
 assert.equal((await save('equal',5,'Replay')).body.value_text,'Latest');assert.equal((await save('lower',4,'Stale')).body.value_text,'Latest');
 session.token=first;await request('auth/logout','POST',{});session.token=second;
 for(const scope of ['equal','lower'])assert.equal((await save(scope,3,'Must not overwrite')).body.value_text,'Latest');
 await request('auth/logout','POST',{});await reauth();
 for(const scope of ['equal','lower'])assert.equal((await save(scope,1,'Released')).body.value_text,'Released');
});
test('Final audit: pre-upgrade transitions without logs get new keys and idempotent retries',t=>{
 const w=fixture(t);
 for(const type of ['quotes','jobs'])for(const evidence of ['base','suffix','execution',...(type==='quotes'?['status','notes']:[])]){
  const event=type==='quotes'?'quote_sent':'job_completed',action=type==='quotes'?'sent':'completed';
  const row=type==='quotes'?w.createQuote({client_id:1,title:'Pre-upgrade',...(evidence==='status'?{status:'changes_requested'}:evidence==='notes'?{change_request_notes:'Revise'}:{})}):w.createJob({client_id:1,title:'Pre-upgrade'}),base=`${event}:${type}:${row.id}`;
  const rule=w.r.insert('automations',{name:'Pre-upgrade',trigger_event:event,action_type:'create_task',is_enabled:1});
  const sub=w.r.insert('webhook_subscriptions',{topic:event,target_url:'https://example.test/hook',secret:'test',active:1,delivered_keys_json:JSON.stringify(evidence==='base'?[base]:evidence==='suffix'?[`${base}:old`]:[])});
  if(evidence==='execution')w.r.insert('automation_executions',{automation_id:rule.id,trigger_event:event,entity_type:type,entity_id:row.id,idempotency_key:`${rule.id}:${base}`,status:'succeeded',scheduled_for:new Date().toISOString()});
  if(type==='quotes')w.sendQuote(row.id);else w.completeJob(row.id);
  const logs=w.r.list('activity_logs',{entity_type:type,entity_id:row.id,action}),key=`${base}:${logs.at(-1).id}`,saved=w.r.get('webhook_subscriptions',sub.id),runs=w.r.list('automation_executions',{entity_type:type,entity_id:row.id});
  assert.equal(logs.length,2);assert.equal(JSON.parse(saved.last_payload_json).event_key,key);assert.ok(runs.some(run=>run.idempotency_key===`${rule.id}:${key}`));
  // A migrated record may retain only its latest activity log.
  w.r.db.prepare('DELETE FROM activity_logs WHERE id=?').run(logs[0].id);
  emit(w.r,event,type,row.id);emit(w.r,event,type,row.id);
  assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);assert.deepEqual(w.r.list('automation_executions',{entity_type:type,entity_id:row.id}),runs);
 }
});

test('Astra 6 P2: logout preserves other sessions revision scopes, including shared scopes',async t=>{
 const {w,request,reauth,session}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Session guard',field_key:'session_guard',field_type:'text'}),first=session.token;
 const save=(rev_scope,revision,value_text)=>request('custom-field-values','POST',{field_definition_id:field.id,entity_type:'jobs',entity_id:1,rev_scope,revision,value_text});
 await save('shared',1,'first');await save('first-only',2,'first only');
 await reauth();const second=session.token;
 await save('shared',3,'shared latest');await save('second-only',3,'second latest');
 session.token=first;assert.equal((await request('auth/logout','POST',{})).status,200);session.token=second;
 for(const scope of ['shared','second-only'])assert.equal((await save(scope,2,'stale')).body.value_text,'second latest');
 assert.equal((await save('first-only',1,'released')).body.value_text,'released');
 await request('auth/logout','POST',{});await reauth();assert.equal((await save('shared',1,'reset')).body.value_text,'reset');
});
test('Astra 6 P2: checklist actions use rendered intent rather than another viewers state',async()=>{
 for(const [suffix,markup,expected,reads] of [
  [':1','',true,0],[':0','',false,0],[':false','',false,0],
  ['', '<button data-action="toggle-checklist-item:4:jobs:9">☐</button>',true,0],
  ['', '<button data-action="toggle-checklist-item:4:jobs:9">☑</button>',false,0],
  ['', '<button data-action="toggle-checklist-item:4:jobs:9:0">☐</button>',false,0],
  ['', '',false,1]
 ]){
  const h=domHarness();h.run('detail=async()=>{}');h.elements.get('#overlay').innerHTML=markup;
  h.context.fetch=async(path,options)=>{h.calls.push({path,options});return {ok:true,json:async()=>({is_completed:1})};};
  await h.run(`gapAction('toggle-checklist-item:4:jobs:9${suffix}')`);
  assert.equal(h.calls.filter(c=>c.options.method==='GET').length,reads);
  assert.equal(JSON.parse(h.calls.find(c=>c.options.method==='POST').options.body).completed,expected);
 }
});
test('Astra 6 P2: drawer refreshes preserve drafts without leaking to other entities or reopened drawers',async()=>{
 const h=domHarness(),input={value:'Unsaved draft'};
 h.context.fetch=async(path,options)=>{h.calls.push({path,options});return {ok:true,json:async()=>path==='/api/custom-fields'?[{id:4,entity_type:'jobs',field_name:'Access',field_type:'text',default_value:'Default'}]:path==='/api/custom-field-values'?[{field_definition_id:4,entity_type:'jobs',entity_id:9,value_text:'Saved'}]:path==='/api/checklists'?[{id:2,job_id:9,title:'Work'}]:path==='/api/checklist-items'?[{id:4,checklist_id:2,label:'Done',is_completed:0}]:/^\/api\/jobs\/\d+$/.test(path)?{id:Number(path.split('/').at(-1)),title:'Job',status:'active'}:[]};};
 await h.run("detail('jobs',9)");assert.match(h.elements.get('#overlay').innerHTML,/value="Saved"/);assert.match(h.elements.get('#overlay').innerHTML,/toggle-checklist-item:4:jobs:9:1/);
 h.elements.set('#custom-4',input);
 for(const action of ['remove-entity-tag:1:jobs:9','toggle-checklist-item:4:jobs:9:1']){await h.run(`gapAction('${action}')`);assert.match(h.elements.get('#overlay').innerHTML,/value="Unsaved draft"/);}
 input.value='';await h.run("detail('jobs',9)");assert.match(h.elements.get('#overlay').innerHTML,/id="custom-4" value=""/);
 input.value='Do not leak';await h.run("detail('jobs',10)");assert.match(h.elements.get('#overlay').innerHTML,/value="Default"/);assert.doesNotMatch(h.elements.get('#overlay').innerHTML,/Do not leak/);
 await h.run("close();detail('jobs',9)");assert.match(h.elements.get('#overlay').innerHTML,/value="Saved"/);
});
test('Astra 6 P3: webhook URL aliases reject nonstrings and blanks atomically and trim valid URLs',async t=>{
 const {request,w}=await httpFixture(t);
 for(const key of ['target_url','webhook_url','url']){
  const created=await request('webhooks','POST',{topic:'*',[key]:'  https://example.test/hook  '});assert.equal(created.status,201);assert.equal(created.body.target_url,'https://example.test/hook');
  const before=w.r.get('webhook_subscriptions',created.body.id),count=w.r.list('webhook_subscriptions').length;
  for(const value of [['https://example.test/hook'],{},null,42,true,'','   ','ftp://example.test/hook']){
   const data={topic:'*',[key]:value};assert.equal((await request('webhooks','POST',data)).status,400);
   assert.equal((await request('webhooks/'+created.body.id,'PATCH',data)).status,400);
   assert.deepEqual(w.r.get('webhook_subscriptions',created.body.id),before);assert.equal(w.r.list('webhook_subscriptions').length,count);
  }
 }
 assert.equal((await request('webhooks','POST',{topic:'*',target_url:'https://example.test/valid',url:['https://example.test/invalid']})).status,400);
});

test('Astra 6 P2: clearing an existing job line name preserves both charges',async t=>{
 const {request}=await httpFixture(t),created=await request('jobs','POST',{client_id:1,title:'Two-line job',items:[{name:'Labor',quantity:1,unit_price_cents:10000},{name:'Materials',quantity:1,unit_price_cents:20000}]});
 assert.equal(created.status,201);
 const before=(await request('jobs/'+created.body.id)).body;assert.equal(before.total_cents,30000);assert.equal(before.items.length,2);
 const h=domHarness();h.context.doc=before;h.run("render=async()=>{};fetch=async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/api/jobs/'+doc.id&&!options.body?doc:[]};}");
 await h.run(`builder('jobs',${before.id})`);
 const lines=before.items.map(line=>{const inputs={'[data-name]':{value:line.name},'[data-qty]':{value:String(line.quantity)},'[data-price]':{value:String(line.unit_price_cents/100)}};return {dataset:{line:JSON.stringify(line)},querySelector:s=>inputs[s]};});
 h.context.document.querySelectorAll=s=>s==='.line-item'?lines:[];
 lines[0].querySelector('[data-name]').value='';
 await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{title:before.title,value:'300',tax_rate:String(before.tax_rate),discount_type:before.discount_type,discount_value:String(before.discount_value)}}});
 const sent=JSON.parse(h.calls.find(c=>c.options.method==='PATCH').options.body),saved=await request('jobs/'+before.id,'PATCH',sent);assert.equal(saved.status,200);
 const after=(await request('jobs/'+before.id)).body;
 assert.deepEqual(after.items.map(line=>[line.name,line.quantity,line.unit_price_cents]),[['Labor',1,10000],['Materials',1,20000]]);
 assert.equal(after.subtotal_cents,30000);assert.equal(after.total_cents,30000);
});

test('Astra 6 P2: unnamed priced jobs retain value through pricing edits',async t=>{
 const {w,request}=await httpFixture(t),seeded=(await request('jobs/5')).body;
 assert.equal(seeded.title,'');assert.equal(seeded.total_cents,12220000);assert.equal(seeded.items[0].name,'Job');
 const taxed=await submitJobBuilder(request,seeded,{tax_rate:'10'});assert.equal(taxed.job.subtotal_cents,12220000);assert.equal(taxed.job.tax_cents,1222000);
 const discounted=await submitJobBuilder(request,taxed.job,{discount_value:'10'});assert.equal(discounted.job.total_cents,12097800);
 for(const title of ['', '   ']){
  const created=w.createJob({client_id:1,title,subtotal_cents:10000,total_cents:10000});w.r.insert('preferences',{name:`job_lines:${created.id}`,value_json:JSON.stringify([{name:'   ',quantity:1,unit_price_cents:10000,taxable:1}])});
  const before=(await request('jobs/'+created.id)).body;assert.equal(before.items[0].name,'Job');
  const legacy={...before,items:before.items.map(l=>({...l,name:'   '}))};const edited=await submitJobBuilder(request,legacy,{tax_rate:'10'});assert.equal(edited.sent.items[0].name,'Job');assert.equal(edited.job.total_cents,11000);
 }
 const fallback=w.createJob({client_id:1,title:' ',subtotal_cents:10000,total_cents:20000});assert.equal((await request('jobs/'+fallback.id)).body.items[0].name,'Job');
});
test('Astra 6 P2: legacy repeat logs retry base keys but new transitions get fresh keys',t=>{
 const w=fixture(t);
 for(const type of ['quotes','jobs'])for(const mode of ['webhook','automation','both']){
  const event=type==='quotes'?'quote_sent':'job_completed',action=type==='quotes'?'sent':'completed',row=type==='quotes'?w.createQuote({client_id:1,title:'Legacy retry'}):w.createJob({client_id:1,title:'Legacy retry'}),base=`${event}:${type}:${row.id}`;
  const sub=mode!=='automation'?w.r.insert('webhook_subscriptions',{topic:event,target_url:'https://example.test/hook',secret:'test',active:1}):null;
  const rule=mode!=='webhook'?w.r.insert('automations',{name:'Legacy retry',trigger_event:event,action_type:'create_task',is_enabled:1}):null;
  emit(w.r,event,type,row.id,base);
  for(let i=0;i<2;i++)w.r.insert('activity_logs',{entity_type:type,entity_id:row.id,action,summary:'Legacy transition'});
  const count=()=>[sub?w.r.get('webhook_subscriptions',sub.id).delivery_count:0,w.r.list('automation_executions',{entity_type:type,entity_id:row.id,trigger_event:event}).length];const before=count();
  emit(w.r,event,type,row.id);emit(w.r,event,type,row.id);assert.deepEqual(count(),before);
  if(type==='quotes')w.sendQuote(row.id);else w.completeJob(row.id);
  const after=count();if(sub)assert.equal(after[0],before[0]+1);if(rule)assert.ok(after[1]>before[1]);
  const latest=w.r.list('activity_logs',{entity_type:type,entity_id:row.id,action}).at(-1),key=`${base}:${latest.id}`;
  if(sub)assert.ok(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json).includes(key));
  if(rule)assert.ok(w.r.list('automation_executions',{automation_id:rule.id}).some(e=>e.idempotency_key===`${rule.id}:${key}`));
  emit(w.r,event,type,row.id);emit(w.r,event,type,row.id,base);assert.deepEqual(count(),after);
 }
});
test('Astra 6 P2: revision scopes and fields evict oldest entries and logout clears owned state',async t=>{
 const {w,request,reauth}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Bounded',field_key:'bounded',field_type:'text'});
 const save=(entity_id,rev_scope,revision,value_text)=>request('custom-field-values','POST',{field_definition_id:field.id,entity_type:'jobs',entity_id,rev_scope,revision,value_text});
 for(let i=0;i<8;i++)assert.ok((await save(1,'scope'+i,2,'initial')).status<300);
 await save(1,'scope0',3,'refreshed');await save(1,'scope8',2,'new scope');
 assert.equal((await save(1,'scope0',2,'stale')).body.value_text,'new scope');
 assert.equal((await save(1,'scope1',1,'evicted scope')).body.value_text,'evicted scope');
 for(let i=2;i<=256;i++)await save(i,'page',2,'initial');
 await save(1,'scope0',4,'refreshed field');await save(257,'page',2,'new field');
 assert.equal((await save(1,'scope0',3,'stale')).body.value_text,'refreshed field');
 assert.equal((await save(2,'page',1,'evicted field')).body.value_text,'evicted field');
 assert.equal((await request('auth/logout','POST',{})).status,200);
 await reauth();
 const reset=await save(1,'scope0',1,'after logout');assert.ok(reset.status<300,JSON.stringify(reset.body));assert.equal(reset.body.value_text,'after logout');
});

test('Gap controls: preferences and job line items round trip over HTTP',async t=>{
 const {request}=await httpFixture(t);
 const initial=(await request('account-billing')).body;assert.equal(initial.plan,'Plus Monthly');assert.equal(initial.price_cents,59900);
 for(const plan of ['Core','Grow'])assert.ok((await request('preferences','POST',{name:'account-plan',value_json:{plan,price_cents:19900,addons:['AI Receptionist']}})).status<300);
 const billing=(await request('account-billing')).body;assert.equal(billing.plan,'Grow');assert.deepEqual(billing.addons,['AI Receptionist']);assert.equal(billing.card_last4,'1821');
 assert.equal((await request('preferences')).body.filter(p=>p.name==='account-plan').length,1);
 const created=await request('jobs','POST',{client_id:1,title:'Line builder',items:[{name:'Service',quantity:2,unit_price_cents:1000,taxable:1}],tax_rate:10,discount_type:'fixed',discount_value:100});assert.equal(created.status,201,JSON.stringify(created.body));
 const job=(await request('jobs/'+created.body.id)).body;assert.equal(job.items[0].name,'Service');assert.equal(job.tax_rate,10);assert.equal(job.discount_value,100);assert.equal(job.total_cents,2090);
});
test('Gap controls: rich modals and schedule selectors dispatch without navigation',async()=>{
 const h=domHarness();h.run('render=async()=>{}');
 await h.click({action:'updates'});assert.match(h.elements.get('#overlay').innerHTML,/Product Updates &amp; Release Notes/);assert.match(h.elements.get('#overlay').innerHTML,/mark-updates-read/);
 await h.click({action:'language'});assert.match(h.elements.get('#overlay').innerHTML,/Français/);
 await h.click({action:'set-sched-filter:status:completed'});assert.equal(h.run('schedFilter.status'),'completed');
 await h.click({action:'set-tag-filter:3'});assert.equal(h.run('clientTagFilter'),'3');
 await h.run("builder('jobs')");assert.match(h.elements.get('#overlay').innerHTML,/Products & services/);assert.match(h.elements.get('#overlay').innerHTML,/name="billing_type"/);
 for(const action of ['remove-entity-tag','save-custom-field','toggle-checklist-item','add-attachment'])assert.ok(appSource.includes(action+':'));
});

test('Astra 6 audit: browser initialization bootstraps with POST and stores its token',async()=>{
 const h=domHarness();h.context.location.pathname='/';const stored=[];h.context.sessionStorage.setItem=(...args)=>stored.push(args);h.run('shell=()=>{};render=async()=>{}');
 h.context.fetch=async(path,options)=>{h.calls.push({path,options});return {ok:true,json:async()=>path==='/api/auth/bootstrap'?{token:'fresh-browser-token'}:path==='/api/auth/me'?{user:{id:1}}:path==='/api/auth/workspace'?{organization:{id:1},team:[]}:[]};};
 await h.run('init()');const call=h.calls.find(c=>c.path==='/api/auth/bootstrap');assert.equal(call.options.method,'POST');assert.equal(call.options.body,'{}');assert.deepEqual(stored,[['token','fresh-browser-token']]);
});
test('Astra 6 audit: detail drawers tolerate forbidden supplementary endpoints',async()=>{
 for(const type of ['clients','requests','quotes','invoices','jobs']){
  const h=domHarness();h.context.fetch=async(path)=>({ok:path===`/api/${type}/7`||path==='/api/clients/7/timeline',status:403,json:async()=>path===`/api/${type}/7`?{id:7,title:'Visible detail',display_name:'Visible detail',status:'active'}:path.endsWith('/timeline')?{}:{error:'Permission denied'}});
  await h.run(`detail('${type}',7)`);assert.match(h.elements.get('#overlay').innerHTML,/Visible detail/);assert.match(h.elements.get('#overlay').innerHTML,/Attachments/);
 }
});
test('Astra 6 audit: settings and preference modals survive forbidden preferences',async()=>{
 const h=domHarness();h.context.document.body={classList:{contains:()=>false}};h.run("user={name:'Employee'};org={email:'employee@example.test'}");
 h.context.fetch=async(path)=>({ok:path!=='/api/preferences',status:path==='/api/preferences'?403:200,json:async()=>path==='/api/preferences'?{error:'Permission denied'}:[]});
 await h.run("globalPanel('settings')");assert.match(h.elements.get('#overlay').innerHTML,/Dark Mode/);assert.match(h.elements.get('#overlay').innerHTML,/data-action="logout"/);
 for(const [action,text] of [['updates',/Release Notes/],['language',/Français/],['rewards',/Bonus Entries/]]){await h.run(`gapAction('${action}')`);assert.match(h.elements.get('#overlay').innerHTML,text);}
 await h.run("savePreference('workspace-language',{language:'Français'})");assert.match(h.elements.get('#toast').textContent,/cannot save/);
 h.context.fetch=async()=>({ok:false,status:500,json:async()=>({error:'Server failed'})});await assert.rejects(h.run("savePreference('workspace-language',{})"),/Server failed/);
});
test('Astra 6 audit: empty job editor sends items array only when editing',async t=>{
 const {request}=await httpFixture(t),created=await request('jobs','POST',{client_id:1,title:'Clear lines',items:[{name:'Work',quantity:1,unit_price_cents:10000}]});
 const h=domHarness();h.context.doc=(await request('jobs/'+created.body.id)).body;h.run("render=async()=>{};fetch=async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/api/jobs/'+doc.id&&!options.body?doc:[]};}");
 for(const edit of [true,false]){await h.run(edit?`builder('jobs',${created.body.id})`:"builder('jobs')");h.calls.length=0;await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{title:'Clear lines',client_id:'1',value:'100'}}});const sent=JSON.parse(h.calls.find(c=>c.options.method===(edit?'PATCH':'POST')).options.body);
  if(edit){assert.deepEqual(sent.items,[]);assert.ok(!('total_cents' in sent));assert.equal((await request('jobs/'+created.body.id,'PATCH',sent)).status,200);const job=(await request('jobs/'+created.body.id)).body;assert.deepEqual(job.items,[]);assert.equal(job.total_cents,0);assert.equal(job.tax_cents,0);}else{assert.ok(!('items' in sent));assert.equal(sent.total_cents,10000);}
 }
});

test('Astra 6 regression: overlapping custom field clicks POST their click-time values without a GET',async()=>{
 const h=domHarness(),input={value:'First click'},pendingResponses=[];h.elements.set('#custom-4',input);
 h.context.fetch=(path,options)=>{h.calls.push({path,options});return new Promise(resolve=>pendingResponses.push(resolve));};
 const first=h.run("gapAction('save-custom-field:4:jobs:9')");input.value='Second click';
 const second=h.run("gapAction('save-custom-field:4:jobs:9')");h.elements.delete('#custom-4');
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls.map(c=>JSON.parse(c.options.body).value_text),['First click','Second click']);assert.deepEqual(h.calls.map(c=>JSON.parse(c.options.body).revision),[1,2]);
 const scope=JSON.parse(h.calls[0].options.body).rev_scope;assert.ok(scope);assert.equal(JSON.parse(h.calls[1].options.body).rev_scope,scope);assert.notEqual(domHarness().run('customFieldScope'),scope);
 for(const call of h.calls){assert.equal(call.path,'/api/custom-field-values');assert.equal(call.options.method,'POST');}
 for(const resolve of pendingResponses.reverse())resolve({ok:true,json:async()=>({})});await Promise.all([first,second]);
});
test('Astra 6 regression: job line rendering preserves required text and optional names',async()=>{
 const h=domHarness(),line={name:'Work',description:'Permit required before work',quantity:1,unit_price_cents:10000};h.context.doc={id:9,title:'Permit',items:[line]};
 h.run("fetch=async()=>({ok:true,json:async()=>doc});render=async()=>{}");
 for(const type of ['jobs','quotes','invoices']){
  await h.run(`builder('${type}',9)`);const html=h.elements.get('#overlay').innerHTML;
  const metadata=html.match(/data-line="([^"]*)"/)[1].replaceAll('&quot;','"').replaceAll('&amp;','&');assert.deepEqual(JSON.parse(metadata),line);
  const input=html.match(/<input data-name[^>]*>/)[0];assert.equal(/ required(?:>|\s)/.test(input),type!=='jobs');
  if(type==='jobs')h.elements.set('#builder [name="job_type"]',{});else h.elements.delete('#builder [name="job_type"]');
  let added;h.elements.set('#items',{insertAdjacentHTML:(position,html)=>{added=html;}});
  const target={dataset:{},hasAttribute:name=>name==='data-add-line'};
  await h.listeners.click({target:{closest:s=>s==='button,a,[data-slot],tr[data-id]'?target:null,matches:()=>false}});
  assert.equal(/ required(?:>|\s)/.test(added),type!=='jobs');
 }
});
async function submitJobBuilder(request,job,values,items=job.items){
 const h=domHarness();h.context.doc=job;h.run("render=async()=>{};fetch=async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/api/jobs/'+doc.id&&!options.body?doc:[]};}");
 await h.run(`builder('jobs',${job.id})`);
 h.context.document.querySelectorAll=()=>items.map(line=>({dataset:{line:JSON.stringify(line)},querySelector:s=>({value:s==='[data-name]'?line.name:s==='[data-qty]'?String(line.quantity):String(line.unit_price_cents/100)})}));
 await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{title:job.title,value:String(job.total_cents/100),tax_rate:String(job.tax_rate),discount_type:job.discount_type,discount_value:String(job.discount_type==='fixed'?job.discount_value/100:job.discount_value),...values}}});
 const sent=JSON.parse(h.calls.find(c=>c.options.method==='PATCH').options.body),saved=await request('jobs/'+job.id,'PATCH',sent);assert.equal(saved.status,200,JSON.stringify(saved.body));return {sent,job:(await request('jobs/'+job.id)).body};
}
test('Astra 6 regression: legacy 7.125 percent job survives unchanged builder round trip',async t=>{
 const {w,request}=await httpFixture(t),legacy=w.createJob({client_id:1,title:'Legacy precision',subtotal_cents:100000,tax_cents:7125,total_cents:107125});
 const before=(await request('jobs/'+legacy.id)).body;assert.equal(before.tax_rate,7.125);
 const {job}=await submitJobBuilder(request,before,{});assert.deepEqual([job.subtotal_cents,job.tax_cents,job.total_cents],[100000,7125,107125]);assert.equal(job.tax_rate,7.125);
});
test('Astra 6 regression: manual job value edits override unchanged lines but not edited lines',async t=>{
 const {w,request}=await httpFixture(t);
 for(const empty of [false,true]){
  const manual=w.createJob({client_id:1,title:'Manual job',total_cents:10000}),before=(await request('jobs/'+manual.id)).body;
  const {sent,job}=await submitJobBuilder(request,before,{value:'250'},empty?[]:before.items);assert.ok(!('total_cents' in sent));assert.equal(sent.items.length,1);assert.equal(sent.items[0].unit_price_cents,25000);assert.equal(sent.items[0].taxable,1);assert.equal(sent.tax_rate,0);assert.equal(sent.discount_value,0);assert.equal(job.total_cents,25000);
  const taxed=await submitJobBuilder(request,job,{tax_rate:'10'});assert.equal(taxed.job.tax_cents,2500);assert.equal(taxed.job.total_cents,27500);
  const edited=await submitJobBuilder(request,job,{value:'300'},[{...job.items[0],unit_price_cents:40000}]);assert.equal(edited.job.total_cents,40000);
 }
});
test('Astra 6 regression: 1001 overdue invoices are delivered only once across unchanged scans',t=>{
 const w=fixture(t);w.r.db.exec("UPDATE invoices SET status='void'");
 for(let i=0;i<1001;i++)w.r.insert('invoices',{client_id:1,subject:'Overdue '+i,status:'awaiting_payment',due_date:'2000-01-01',total_cents:100,balance_due_cents:100});
 const sub=w.r.insert('webhook_subscriptions',{topic:'invoice_overdue',target_url:'https://example.test/webhook',secret:'test',active:1});
 assert.equal(w.overdue().length,1001);const first=w.r.get('webhook_subscriptions',sub.id);assert.equal(first.delivery_count,1001);assert.equal(JSON.parse(first.delivered_keys_json).length,1001);
 assert.equal(w.overdue().length,1001);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),first);
});
test('Astra 6 regression: webhook keys prune expired windows only and tolerate malformed JSON',t=>{
 const w=fixture(t),now=new Date('2035-01-02T12:00:00.000Z'),sub=w.r.insert('webhook_subscriptions',{topic:'*',target_url:'https://example.test/webhook',secret:'test',active:1});
 const keep=['client_created:clients:1','overdue:2:2035-01-02',...Array.from({length:1001},(_,i)=>`reminder:${i}:2035-01-03T12:00:00.000Z`)];
 const initial=w.r.update('webhook_subscriptions',sub.id,{delivered_keys_json:JSON.stringify([...keep,'overdue:1:2035-01-01','reminder:1:2035-01-02T11:00:00.000Z','reminder:2:2035-01-02T12:00:00.000Z'])});
 const saved=deliverWebhook(w.r,initial,{},now,'new:event');assert.deepEqual(JSON.parse(saved.delivered_keys_json),[...keep,'new:event']);
 for(const key of keep.filter(k=>k.startsWith('reminder:')))emit(w.r,'visit_approaching','clients',1,key,now);
 assert.equal(w.r.get('webhook_subscriptions',sub.id).delivery_count,1);
 for(const raw of ['{}','null']){w.r.update('webhook_subscriptions',sub.id,{delivered_keys_json:raw});emit(w.r,'client_created','clients',1,'safe:event',now);assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),['safe:event']);}
 deliverWebhook(w.r,{...w.r.get('webhook_subscriptions',sub.id),delivered_keys_json:'{broken'},{},now,'safe:event');assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),['safe:event']);
});

test('Astra 6 regression: partial job options preserve default percent discounts on unchanged saves',async t=>{
 const {request}=await httpFixture(t);
 const created=await request('jobs','POST',{client_id:1,title:'Default discount',total_cents:10000,discount_value:10});assert.equal(created.status,201);
 const before=(await request('jobs/'+created.body.id)).body;
 assert.equal(before.discount_type,'percent');assert.equal(before.discount_value,10);assert.equal(before.tax_rate,0);
 const {job}=await submitJobBuilder(request,before,{});assert.equal(job.total_cents,before.total_cents);assert.equal(job.discount_value,10);
});
test('Astra 6 regression: fully discounted manual jobs retain taxable fallback lines',async t=>{
 const {request}=await httpFixture(t);
 const created=await request('jobs','POST',{client_id:1,title:'Fully discounted',total_cents:10000,tax_rate:10,discount_type:'percent',discount_value:100});assert.equal(created.status,201);
 const before=(await request('jobs/'+created.body.id)).body;assert.equal(before.total_cents,0);assert.equal(before.items[0].taxable,1);
 const {job}=await submitJobBuilder(request,before,{discount_value:'50'});assert.equal(job.subtotal_cents,10000);assert.equal(job.tax_cents,500);assert.equal(job.total_cents,5500);
});
test('Astra 6 regression: manual value override selects an optional unselected first line',async t=>{
 const {request}=await httpFixture(t);
 const created=await request('jobs','POST',{client_id:1,title:'Optional first',items:[{name:'Optional',quantity:1,unit_price_cents:10000,is_optional:1,is_selected:0}]});assert.equal(created.status,201);
 const before=(await request('jobs/'+created.body.id)).body;
 const {sent,job}=await submitJobBuilder(request,before,{value:'250'});assert.equal(sent.items[0].is_optional,0);assert.equal(sent.items[0].is_selected,1);assert.equal(job.total_cents,25000);
});
test('Astra 6 regression: job builder persists client changes but other documents omit them',async t=>{
 const {w,request}=await httpFixture(t),client=w.createClient({display_name:'Replacement client'}),created=w.createJob({client_id:1,title:'Reassign',total_cents:10000});
 const before=(await request('jobs/'+created.id)).body,{sent,job}=await submitJobBuilder(request,before,{client_id:String(client.id)});assert.equal(sent.client_id,client.id);assert.equal(job.client_id,client.id);
 for(const type of ['quotes','invoices']){const h=domHarness();h.run('render=async()=>{}');await h.run(`builder('${type}',9)`);await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{client_id:String(client.id)}}});const patch=h.calls.find(c=>c.options.method==='PATCH');assert.ok(!('client_id' in JSON.parse(patch.options.body)));}
});
test('Astra 6 regression: custom field POST aliases reconcile legacy duplicates and displayed values',async t=>{
 const {request,w}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Access',field_key:'access',field_type:'text'}),data={field_definition_id:field.id,entity_type:'jobs',entity_id:1};
 const results=await Promise.all(['custom-field-values','custom-values'].map((path,i)=>request(path,'POST',{...data,value_text:'Value '+i})));for(const result of results)assert.ok(result.status<300,JSON.stringify(result.body));assert.equal(results[0].body.id,results[1].body.id);
 const h=domHarness();h.context.defs=[field];h.run("fetch=async(path)=>({ok:true,json:async()=>path==='/api/custom-fields'?defs:path==='/api/custom-field-values'?values:[]})");
 for(const path of ['custom-values','custom-field-values']){
  w.r.insert('custom_field_values',{...data,value_text:'Legacy duplicate'});h.context.values=w.r.list('custom_field_values',data);
  const before=await h.run("entitySections('jobs',1)");assert.ok(before.includes(`value="${h.context.values[0].value_text}"`));assert.doesNotMatch(before,/value="Legacy duplicate"/);
  const latest=await request(path,'POST',{...data,value_text:'Latest'});assert.equal(latest.status,200);assert.equal(latest.body.id,results[0].body.id);
  const values=w.r.list('custom_field_values',data);assert.equal(values.length,1);assert.equal(values[0].value_text,'Latest');assert.equal(values.at(-1).value_text,'Latest');h.context.values=values;
  const html=await h.run("entitySections('jobs',1)");assert.match(html,/value="Latest"/);assert.doesNotMatch(html,/value="Legacy duplicate"/);
 }
});
test('Astra 6 regression: quote resends deliver new webhooks and preserve every retry key',t=>{
 const w=fixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'quote_sent',target_url:'https://example.test/webhook',secret:'test',active:1}),q=w.createQuote({client_id:1,title:'Resend'},[{name:'Work',quantity:1,unit_price_cents:1000}]);
 const other='quote_sent:quotes:99999:1';w.r.update('webhook_subscriptions',sub.id,{delivered_keys_json:JSON.stringify([other,'client_created:clients:1'])});
 let previous,firstKey;
 for(let i=1;i<=3;i++){if(i>1)w.requestChanges(q.id,'Please revise');w.sendQuote(q.id);const saved=w.r.get('webhook_subscriptions',sub.id),keys=JSON.parse(saved.delivered_keys_json),key=JSON.parse(saved.last_payload_json).event_key;assert.equal(saved.delivery_count,i);assert.notEqual(key,previous);assert.equal(keys.filter(k=>k===`quote_sent:quotes:${q.id}`||k.startsWith(`quote_sent:quotes:${q.id}:`)).length,i);firstKey??=key;emit(w.r,'quote_sent','quotes',q.id,firstKey);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);assert.ok(keys.includes(other));assert.ok(keys.includes('client_created:clients:1'));emit(w.r,'quote_sent','quotes',q.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);previous=key;}
});

test('Astra 6 regression: unchanged pricing omits pricing fields and preserves manually repriced jobs',async t=>{
 const {w,request}=await httpFixture(t);
 const legacy=w.createJob({client_id:1,title:'Repriced',subtotal_cents:10000,tax_cents:825,total_cents:12000});
 const before=(await request('jobs/'+legacy.id)).body;assert.equal(before.items.length,1);assert.equal(before.items[0].unit_price_cents,12000);assert.equal(before.items[0].taxable,0);assert.equal(before.tax_rate,0);assert.equal(before.discount_value,0);
 const {sent,job}=await submitJobBuilder(request,before,{title:'Notes-only edit'});
 for(const key of ['items','total_cents','tax_rate','discount_type','discount_value'])assert.ok(!(key in sent),key);
 assert.equal(job.title,'Notes-only edit');assert.deepEqual([job.subtotal_cents,job.tax_cents,job.total_cents],[10000,825,12000]);
 const created=await request('jobs','POST',{client_id:1,title:'Fixed discount',items:[{name:'Work',quantity:1,unit_price_cents:10000,taxable:1}],tax_rate:10,discount_type:'fixed',discount_value:1000});assert.equal(created.status,201);
 const fixed=(await request('jobs/'+created.body.id)).body,unchanged=await submitJobBuilder(request,fixed,{});
 for(const key of ['items','total_cents','tax_rate','discount_type','discount_value'])assert.ok(!(key in unchanged.sent),key);
 const override=await submitJobBuilder(request,fixed,{value:'250'});assert.equal(override.sent.discount_type,'percent');assert.equal(override.sent.discount_value,0);assert.equal(override.sent.tax_rate,0);assert.equal(override.job.total_cents,25000);
 for(const values of [{tax_rate:'20'},{discount_type:'percent'},{discount_value:'20'}]){const changed=await submitJobBuilder(request,fixed,values);assert.ok('items' in changed.sent);assert.ok('tax_rate' in changed.sent);assert.ok('discount_type' in changed.sent);assert.ok('discount_value' in changed.sent);}
});
test('Astra 6 regression: mixed taxable and exempt legacy job lines infer tax after discount',async t=>{
 const {w,request}=await httpFixture(t);
 for(const discount of [0,2000]){
  const tax=discount?900:1000,legacy=w.createJob({client_id:1,title:'Mixed legacy',subtotal_cents:20000,tax_cents:tax,total_cents:20000-discount+tax});
  w.r.insert('preferences',{name:`job_lines:${legacy.id}`,value_json:JSON.stringify([{name:'Taxable',quantity:1,unit_price_cents:10000,taxable:1},{name:'Exempt',quantity:1,unit_price_cents:10000,taxable:0},{name:'Unselected',quantity:1,unit_price_cents:5000,taxable:1,is_optional:1,is_selected:0}])});
  const before=(await request('jobs/'+legacy.id)).body;assert.equal(before.tax_rate,10);assert.equal(before.discount_value,discount);assert.equal(before.items.length,3);
  const {job}=await submitJobBuilder(request,before,{});assert.equal(job.total_cents,legacy.total_cents);
  const saved=await request('jobs/'+legacy.id,'PATCH',{items:before.items,tax_rate:before.tax_rate,discount_type:before.discount_type,discount_value:before.discount_value});assert.equal(saved.status,200);assert.equal(saved.body.total_cents,legacy.total_cents);
 }
});
test('Astra 6 regression: sending another quote cannot change retry webhook or automation keys',t=>{
 const w=fixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'quote_sent',target_url:'https://example.test/webhook',secret:'test',active:1});
 const rule=w.r.insert('automations',{name:'Quote retry regression',trigger_event:'quote_sent',action_type:'send_email',action_config_json:'{}',is_enabled:1});
 for(const legacy of [false,true]){
  const quotes=['A','B'].map(title=>w.createQuote({client_id:1,title,client_message:legacy?'':'Identical message'},[{name:'Work',quantity:1,unit_price_cents:1000}]));
  w.sendQuote(quotes[0].id);
  const msg=w.r.list('messages',{subject:'Your quote'}).at(-1);assert.equal(msg.related_entity_type,'quotes');assert.equal(msg.related_entity_id,quotes[0].id);
  if(legacy)w.r.update('messages',msg.id,{related_entity_type:null,related_entity_id:null});
  w.sendQuote(quotes[1].id);
  const before=w.r.get('webhook_subscriptions',sub.id),executions=w.r.list('automation_executions',{automation_id:rule.id});
  emit(w.r,'quote_sent','quotes',quotes[0].id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),before);assert.deepEqual(w.r.list('automation_executions',{automation_id:rule.id}),executions);
  w.requestChanges(quotes[0].id,'Resend');w.sendQuote(quotes[0].id);assert.equal(w.r.get('webhook_subscriptions',sub.id).delivery_count,before.delivery_count+1);assert.equal(w.r.list('automation_executions',{automation_id:rule.id}).length,executions.length+1);
 }
});

test('Astra 6 regression: title-only job edits preserve multiline instructions',async t=>{
 const {w,request}=await httpFixture(t),instructions='Unlock side gate\n\nProtect the floor\nLock up when finished',created=w.createJob({client_id:1,title:'Before edit',instructions});
 const h=domHarness();h.context.doc=(await request('jobs/'+created.id)).body;h.run("render=async()=>{};fetch=async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/api/jobs/'+doc.id&&!options.body?doc:[]};}");
 await h.run(`builder('jobs',${created.id})`);
 const textarea=h.elements.get('#overlay').innerHTML.match(/<textarea name="instructions">([\s\S]*?)<\/textarea>/);assert.ok(textarea,'Instructions must render as a textarea');assert.equal(textarea[1],instructions);
 await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{title:'After edit',instructions:textarea[1]}}});
 const sent=JSON.parse(h.calls.find(c=>c.options.method==='PATCH').options.body);assert.equal(sent.instructions,instructions);assert.equal((await request('jobs/'+created.id,'PATCH',sent)).status,200);
 const saved=(await request('jobs/'+created.id)).body;assert.equal(saved.title,'After edit');assert.equal(saved.instructions,instructions);
});
test('Astra 6 regression: string and numeric quote retry IDs share executions and webhook keys',async t=>{
 const {w,request}=await httpFixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'quote_sent',target_url:'https://example.test/webhook',secret:'test',active:1}),rule=w.r.insert('automations',{name:'Canonical quote ID',trigger_event:'quote_sent',action_type:'send_email',action_config_json:'{}',is_enabled:1});
 const q=w.createQuote({client_id:1,title:'Canonical retry'},[{name:'Work',quantity:1,unit_price_cents:1000}]);
 for(const resend of [false,true]){
  if(resend)w.requestChanges(q.id,'Revise');w.sendQuote(q.id);
  const before=w.r.get('webhook_subscriptions',sub.id),executions=w.r.list('automation_executions',{automation_id:rule.id});assert.equal(before.delivery_count,resend?2:1);assert.equal(executions.length,resend?2:1);
  for(const entity_id of [String(q.id),q.id]){const response=await request('automations/run','POST',{event:'quote_sent',entity_type:'quotes',entity_id});assert.equal(response.status,200);assert.equal(response.body.find(e=>e.automation_id===rule.id).entity_id,q.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),before);assert.deepEqual(w.r.list('automation_executions',{automation_id:rule.id}),executions);}
 }
});
test('Astra 6 regression: historical base quote keys remain idempotent across resends',t=>{
 const w=fixture(t),rule=w.r.insert('automations',{name:'Historical quote',trigger_event:'quote_sent',action_type:'send_email',action_config_json:'{}',is_enabled:1});
 const historical=w.createQuote({client_id:1,title:'Historical'},[{name:'Work',quantity:1,unit_price_cents:1000}]),key=`quote_sent:quotes:${historical.id}`;
 w.r.update('quotes',historical.id,{status:'awaiting_response'});
 w.r.insert('activity_logs',{entity_type:'quotes',entity_id:historical.id,action:'sent',summary:'Historical send'});
 w.r.insert('messages',{client_id:historical.client_id,channel:'email',direction:'outbound',subject:'Your quote',body:`Quote ${historical.id}: ${historical.title}`,status:'test_mode'});
 const execution=w.r.insert('automation_executions',{automation_id:rule.id,trigger_event:'quote_sent',entity_type:'quotes',entity_id:historical.id,idempotency_key:`${rule.id}:${key}`,status:'succeeded',scheduled_for:new Date().toISOString()});
 const sub=w.r.insert('webhook_subscriptions',{topic:'quote_sent',target_url:'https://example.test/webhook',secret:'test',active:1,delivery_count:1,delivered_keys_json:JSON.stringify([key])});
 for(let i=0;i<2;i++){emit(w.r,'quote_sent','quotes',historical.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),sub);assert.deepEqual(w.r.list('automation_executions',{automation_id:rule.id}),[execution]);}
 w.requestChanges(historical.id,'Please revise');w.sendQuote(historical.id);
 const saved=w.r.get('webhook_subscriptions',sub.id),sentLog=w.r.list('activity_logs',{entity_type:'quotes',entity_id:historical.id,action:'sent'}).at(-1),resendKey=`${key}:${sentLog.id}`;
 assert.equal(saved.delivery_count,2);assert.deepEqual(JSON.parse(saved.delivered_keys_json),[key,resendKey]);emit(w.r,'quote_sent','quotes',historical.id,key);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);
 const executions=w.r.list('automation_executions',{automation_id:rule.id});assert.equal(executions.length,2);assert.ok(executions.some(e=>e.idempotency_key===`${rule.id}:${resendKey}`));
 emit(w.r,'quote_sent','quotes',historical.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);assert.deepEqual(w.r.list('automation_executions',{automation_id:rule.id}),executions);
});

test('Astra 6 P2: delayed custom field revisions cannot overwrite newer saves',async t=>{
 const {w,request}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Revision',field_key:'revision',field_type:'text'}),data={field_definition_id:field.id,entity_type:'jobs',entity_id:1};
 const newest=await request('custom-field-values','POST',{...data,value_text:'Second',rev_scope:'page-one',revision:2});assert.equal(newest.status,201);
 w.r.insert('custom_field_values',{...data,value_text:'Duplicate'});
 const delayed=await request('custom-values','POST',{...data,value_text:'First',rev_scope:'page-one',revision:1});assert.equal(delayed.status,200);assert.equal(delayed.body.value_text,'Second');assert.equal(delayed.body.id,newest.body.id);assert.equal(w.r.list('custom_field_values',data).length,1);
 const reload=await request('custom-field-values','POST',{...data,value_text:'Reloaded page',rev_scope:'page-two',revision:1});assert.equal(reload.body.value_text,'Reloaded page');
 const plain=await request('custom-values','POST',{...data,value_text:'API save',revision:0});assert.equal(plain.body.value_text,'API save');
 const reset=await request('custom-field-values','POST',{...data,value_text:'New sequence',revision:1});assert.equal(reset.body.value_text,'New sequence');
 const other=await request('custom-field-values','POST',{...data,entity_id:2,value_text:'Independent',revision:0});assert.equal(other.status,201);assert.equal(other.body.value_text,'Independent');
});
test('Astra 6 P2: deleting quote messages cannot suppress resends or duplicate retries',async t=>{
 const {w,request}=await httpFixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'quote_sent',target_url:'https://example.test/webhook',secret:'test',active:1}),rule=w.r.insert('automations',{name:'Durable send',trigger_event:'quote_sent',action_type:'send_email',action_config_json:'{}',is_enabled:1}),q=w.createQuote({client_id:1,title:'Durable resend'},[{name:'Work',quantity:1,unit_price_cents:1000}]);
 for(let i=1;i<=3;i++){
  if(i>1)w.requestChanges(q.id,'Revise');w.sendQuote(q.id);
  const saved=w.r.get('webhook_subscriptions',sub.id),logs=w.r.list('activity_logs',{entity_type:'quotes',entity_id:q.id,action:'sent'});assert.equal(saved.delivery_count,i);assert.equal(logs.length,i);assert.equal(JSON.parse(saved.last_payload_json).event_key,i===1?`quote_sent:quotes:${q.id}`:`quote_sent:quotes:${q.id}:${logs.at(-1).id}`);
  for(const message of w.r.list('messages',{related_entity_type:'quotes',related_entity_id:q.id}))assert.equal((await request('messages/'+message.id,'DELETE')).status,200);
  emit(w.r,'quote_sent','quotes',q.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);assert.equal(w.r.list('automation_executions',{automation_id:rule.id}).length,i);
 }
});
test('Astra 6 P2: invalid legacy job lines return a safe total fallback',async t=>{
 const {w,request}=await httpFixture(t),job=w.createJob({client_id:1,title:'Corrupt legacy',subtotal_cents:10000,tax_cents:825,total_cents:10825});
 w.r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([{name:'Invalid',quantity:1,unit_price_cents:'bad',taxable:1}])});
 const result=await request('jobs/'+job.id);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.total_cents,10825);assert.equal(result.body.items.length,1);assert.equal(result.body.items[0].unit_price_cents,10825);assert.equal(result.body.items[0].taxable,0);assert.equal(result.body.tax_rate,0);assert.equal(result.body.discount_value,0);
});
test('Astra 6 P2: plan saves reconcile duplicate preferences and use the first row',async t=>{
 const {w,request}=await httpFixture(t),first=w.r.insert('preferences',{name:'account-plan',value_json:JSON.stringify({plan:'Core'})});
 w.r.insert('preferences',{name:'account-plan',value_json:JSON.stringify({plan:'Stale'})});assert.equal((await request('account-billing')).body.plan,'Core');
 const saved=await request('preferences','POST',{name:'account-plan',value_json:{plan:'Grow',price_cents:19900,addons:['AI Receptionist']}});assert.equal(saved.status,200);assert.equal(saved.body.id,first.id);assert.equal(w.r.list('preferences',{name:'account-plan'}).length,1);
 const billing=(await request('account-billing')).body;assert.equal(billing.plan,'Grow');assert.equal(billing.price_cents,19900);assert.deepEqual(billing.addons,['AI Receptionist']);
});
test('Astra 6 P2: delayed global panels cannot replace a newer panel or reopen a closed overlay',async()=>{
 for(const name of ['settings','notifications','messages'])for(const next of ['close()',"modal('New panel','Current content')",'createMenu()',"globalPanel('help')"]){
  const h=domHarness();h.elements.set('.create',{classList:{contains:()=>false,add(){},remove(){}},setAttribute(){}});let resolve;
  h.context.fetch=()=>new Promise(done=>{resolve=done;});const pending=h.run(`globalPanel('${name}')`);await h.run(next);const expected=h.elements.get('#overlay').innerHTML;
  resolve({ok:true,json:async()=>[]});await pending;assert.equal(h.elements.get('#overlay').innerHTML,expected,`${name} after ${next}`);
 }
 const h=domHarness(),responses=[];h.context.fetch=()=>new Promise(resolve=>responses.push(resolve));const first=h.run("globalPanel('settings')"),second=h.run("globalPanel('notifications')");
 responses[1]({ok:true,json:async()=>[]});await second;const expected=h.elements.get('#overlay').innerHTML;assert.match(expected,/Notifications/);responses[0]({ok:true,json:async()=>[]});await first;assert.equal(h.elements.get('#overlay').innerHTML,expected);
});

test('Astra 6 regression: every delayed editor and panel respects newer overlay state',async()=>{
 const starts=[...['updates','language','subscription','rewards','sched-type','sched-team','sched-status','tag-filter','add-entity-tag:jobs:1','add-checklist-item:1','schedule-map'].map(a=>h=>h.run(`gapAction('${a}')`)),h=>h.run("detail('payments',1)"),h=>h.run("detail('clients',1)"),h=>h.run("builder('jobs',1)"),h=>h.run("resource='team';genericBuilder()"),...['unscheduled','billing-payments','find-time'].map(action=>h=>h.click({action})),h=>h.click({appProvider:'test'}),h=>h.click({receipt:'1'}),h=>h.click({slot:'2026-10-26T09:00'})];
 for(const start of starts)for(const next of ['close()',"modal('New panel','Current content')"]){
  const h=domHarness();let release;const gate=new Promise(resolve=>{release=resolve;});h.context.fetch=async path=>{await gate;return {ok:true,json:async()=>path==='/api/account-billing'?{addons:[],payments:[{id:1}]}:path==='/api/schedule'?{appointments:[],unscheduled:[]}:path==='/api/ai/route-optimizer'?{stops:[]}:path==='/api/clients/1'||path==='/api/payments/1'?{id:1}:[]};};
  const pending=start(h);await h.run(next);const expected=h.elements.get('#overlay').innerHTML;release();await pending;assert.equal(h.elements.get('#overlay').innerHTML,expected);assert.equal(h.elements.get('#toast').textContent,'');
 }
});
test('Astra 6 regression: manual jobs apply new tax and preserve simultaneous value and option edits',async t=>{
 const {w,request}=await httpFixture(t);
 {
  const row=w.createJob({client_id:1,title:'Manual tax',total_cents:10000});
  const before=(await request('jobs/'+row.id)).body;assert.equal(before.tax_cents,0);assert.equal(before.total_cents,10000);assert.equal(before.items[0].taxable,1);
  const taxed=await submitJobBuilder(request,before,{tax_rate:'10'});assert.equal(taxed.job.tax_cents,1000);assert.equal(taxed.job.total_cents,11000);
  const combined=await submitJobBuilder(request,taxed.job,{value:'200',tax_rate:'20',discount_type:'fixed',discount_value:'10'});assert.equal(combined.sent.tax_rate,20);assert.equal(combined.sent.discount_type,'fixed');assert.equal(combined.sent.discount_value,1000);assert.equal(combined.job.tax_cents,3800);assert.equal(combined.job.total_cents,22800);
 }
});
test('Astra 6 regression: exempt stored lines remain exempt when the tax rate changes',async t=>{
 const {request}=await httpFixture(t),created=await request('jobs','POST',{client_id:1,title:'Exempt job',items:[{name:'Exempt',quantity:1,unit_price_cents:10000,taxable:0}],tax_rate:10});assert.equal(created.status,201);
 const before=(await request('jobs/'+created.body.id)).body,{sent,job}=await submitJobBuilder(request,before,{tax_rate:'15'});assert.equal(sent.items[0].taxable,0);assert.equal(job.items[0].taxable,0);assert.equal(job.tax_rate,15);assert.equal(job.tax_cents,0);assert.equal(job.total_cents,10000);
});
test('Astra 6 regression: lifecycle emissions retain base keys and retry once',t=>{
 const w=fixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'*',target_url:'https://example.test/hook',secret:'test',active:1});
 const check=(event,type,row,action)=>{const saved=w.r.get('webhook_subscriptions',sub.id),log=w.r.list('activity_logs',{entity_type:type,entity_id:row.id,action}).at(-1);assert.ok(log);assert.equal(JSON.parse(saved.last_payload_json).event_key,`${event}:${type}:${row.id}`);emit(w.r,event,type,row.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);};
 const client=w.createClient({display_name:'Lifecycle',email:'test@example.test',receives_email:1});check('client_created','clients',client,'created');
 check('request_submitted','requests',w.createRequest({client_id:client.id,title:'Request'}),'created');
 const quote=w.createQuote({client_id:client.id,title:'Quote'},[]);check('quote_sent','quotes',w.sendQuote(quote.id),'sent');check('quote_approved','quotes',w.approveQuote(quote.id,'Test'),'approved');
 const job=w.createJob({client_id:client.id,title:'Job'});check('job_completed','jobs',w.completeJob(job.id),'completed');
 const invoice=w.createInvoice({client_id:client.id,subject:'Invoice'},[{name:'Work',quantity:1,unit_price_cents:1000}]);check('invoice_issued','invoices',w.issueInvoice(invoice.id),'issued');check('payment_received','payments',w.recordPayment({invoice_id:invoice.id,amount_cents:1000}),'received');
});
test('Astra 6 regression: deletion clears base keys and executions before entity ID reuse',async t=>{
 const {w,request}=await httpFixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'*',target_url:'https://example.test/hook',secret:'test',active:1});
 for(const type of ['clients','requests','jobs']){
  const event={clients:'client_created',requests:'request_submitted',jobs:'job_completed'}[type],create=()=>type==='clients'?w.createClient({display_name:'Reused'}):type==='requests'?w.createRequest({client_id:1,title:'Reused'}):w.completeJob(w.createJob({client_id:1,title:'Reused'}).id);
  const rule=w.r.insert('automations',{name:'Reuse '+type,trigger_event:event,action_type:'create_task',is_enabled:1}),row=create(),base=`${event}:${type}:${row.id}`;
  emit(w.r,event,type,row.id,base);const saved=w.r.get('webhook_subscriptions',sub.id),keys=JSON.parse(saved.delivered_keys_json);assert.ok(keys.includes(base));assert.ok(w.r.list('automation_executions',{entity_type:type,entity_id:row.id}).length);
  assert.equal((await request(type+'/'+row.id,'DELETE')).status,200);assert.equal(w.r.list('automation_executions',{entity_type:type,entity_id:row.id}).length,0);assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),keys.filter(k=>k!==base));
  const replacement=create();assert.equal(replacement.id,row.id);assert.equal(w.r.get('webhook_subscriptions',sub.id).delivery_count,saved.delivery_count+1);const executions=w.r.list('automation_executions',{automation_id:rule.id});assert.equal(executions.length,1);emit(w.r,event,type,replacement.id);assert.equal(w.r.get('webhook_subscriptions',sub.id).delivery_count,saved.delivery_count+1);
 }
});

test('Astra 6 P2: repeated job completion preserves status, logs and automation work',t=>{
 const w=fixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'job_completed',target_url:'https://example.test/hook',secret:'test',active:1}),rule=w.r.insert('automations',{name:'Complete once',trigger_event:'job_completed',action_type:'create_task',is_enabled:1}),job=w.createJob({client_id:1,title:'Complete once'});
 w.completeJob(job.id);const logs=w.r.list('activity_logs',{entity_type:'jobs',entity_id:job.id,action:'completed'}),runs=w.r.list('automation_executions',{automation_id:rule.id}),hook=w.r.get('webhook_subscriptions',sub.id);assert.equal(logs.length,1);assert.equal(runs.length,1);assert.equal(hook.delivery_count,1);
 const unchanged=()=>{assert.deepEqual(w.r.list('activity_logs',{entity_type:'jobs',entity_id:job.id,action:'completed'}),logs);assert.deepEqual(w.r.list('automation_executions',{automation_id:rule.id}),runs);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),hook);};
 assert.equal(w.completeJob(job.id).status,'requires_invoicing');unchanged();
 w.r.update('jobs',job.id,{status:'completed'});assert.equal(w.completeJob(job.id).status,'requires_invoicing');assert.equal(w.r.get('jobs',job.id).status,'requires_invoicing');unchanged();
 w.invoiceJob(job.id);assert.equal(w.r.get('jobs',job.id).status,'completed');assert.equal(w.completeJob(job.id).status,'completed');unchanged();
});
test('Astra 6 P2: legacy lifecycle base keys suppress retries even with activity logs',t=>{
 const w=fixture(t);
 for(const [event,type,action] of [['client_created','clients','created'],['request_submitted','requests','created'],['quote_sent','quotes','sent'],['quote_approved','quotes','approved'],['job_completed','jobs','completed'],['invoice_issued','invoices','issued'],['payment_received','payments','received']]){
  const row=w.r.list(type)[0];assert.ok(row,type);const key=`${event}:${type}:${row.id}`,rule=w.r.insert('automations',{name:event,trigger_event:event,action_type:'create_task',is_enabled:1});
  if(event==='quote_sent')w.r.db.prepare("UPDATE activity_logs SET entity_id=NULL WHERE entity_type='quotes' AND entity_id=? AND action='sent'").run(row.id);
  w.r.insert('activity_logs',{entity_type:type,entity_id:row.id,action,summary:'Before upgrade'});
  const sub=w.r.insert('webhook_subscriptions',{topic:event,target_url:'https://example.test/hook',secret:'test',active:1,delivery_count:1,delivered_keys_json:JSON.stringify([key])}),run=w.r.insert('automation_executions',{automation_id:rule.id,trigger_event:event,entity_type:type,entity_id:row.id,idempotency_key:`${rule.id}:${key}`,status:'succeeded',scheduled_for:new Date().toISOString()});
  emit(w.r,event,type,row.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),sub);assert.deepEqual(w.r.list('automation_executions',{automation_id:rule.id}),[run]);
 }
});
test('Astra 6 P2: interleaved revision scopes and deleted values retain real save results',async t=>{
 const {w,request,db}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Interleaved',field_key:'interleaved',field_type:'text'}),data={field_definition_id:field.id,entity_type:'jobs',entity_id:1};
 const save=(scope,revision,value)=>request('custom-field-values','POST',{...data,rev_scope:scope,revision,value_text:value});
 await save('A',2,'A2');await save('B',1,'B1');assert.equal((await save('A',1,'A1')).body.value_text,'B1');assert.equal((await save('A',3,'A3')).body.value_text,'A3');assert.equal((await save('B',0,'B0')).body.value_text,'A3');
 for(const viaApi of [true,false]){
  const saved=await save('A',10,'Before deletion');
  if(viaApi)assert.equal((await request('custom-values/'+saved.body.id,'DELETE')).status,200);else db.prepare('DELETE FROM custom_field_values WHERE id=?').run(saved.body.id);
  const recreated=await save('A',1,'Recreated');assert.equal(recreated.status,201);assert.ok(recreated.body.id);assert.equal(recreated.body.value_text,'Recreated');assert.equal(w.r.list('custom_field_values',data).length,1);
  if(viaApi)assert.equal((await save('A',2,'After reset')).body.value_text,'After reset');
 }
 await request('custom-values','POST',{...data,value_text:'Unscoped'});assert.equal((await save('A',0,'Reset')).body.value_text,'Reset');
});
test('Astra 6 P2: visit deletion clears visit and reminder keys before ID reuse',async t=>{
 const {w,request}=await httpFixture(t),job=w.createJob({client_id:1,title:'Visits'}),sub=w.r.insert('webhook_subscriptions',{topic:'*',target_url:'https://example.test/hook',secret:'test',active:1});
 const scheduled=w.r.insert('automations',{name:'Visit scheduled',trigger_event:'job_scheduled',action_type:'create_task',is_enabled:1}),reminder=w.r.insert('automations',{name:'Visit reminder',trigger_event:'visit_approaching',action_type:'create_task',is_enabled:1}),visit=w.createVisit(job.id),key=`reminder:${visit.id}:2099-01-01T00:00:00.000Z`;
 emit(w.r,'visit_approaching','jobs',job.id,key);emit(w.r,'visit_completed','visits',visit.id,`visit_completed:visits:${visit.id}:99`);
 const before=w.r.get('webhook_subscriptions',sub.id),keep=`visit:${visit.id+1}`;w.r.update('webhook_subscriptions',sub.id,{delivered_keys_json:JSON.stringify([...JSON.parse(before.delivered_keys_json),keep])});
 assert.equal((await request('visits/'+visit.id,'DELETE')).status,200);assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),[keep]);for(const rule of [scheduled,reminder])assert.equal(w.r.list('automation_executions',{automation_id:rule.id}).length,0);
 const replacement=w.createVisit(job.id);assert.equal(replacement.id,visit.id);emit(w.r,'visit_approaching','jobs',job.id,key);assert.equal(w.r.get('webhook_subscriptions',sub.id).delivery_count,before.delivery_count+2);for(const rule of [scheduled,reminder])assert.equal(w.r.list('automation_executions',{automation_id:rule.id}).length,1);
});
test('Astra 6 P2: deleted quote logs are preserved but detached before ID reuse',async t=>{
 const {w,request}=await httpFixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'quote_sent',target_url:'https://example.test/hook',secret:'test',active:1}),q=w.createQuote({client_id:1,title:'Old quote'},[]);
 w.sendQuote(q.id);w.requestChanges(q.id,'Again');w.sendQuote(q.id);const logs=w.r.list('activity_logs',{entity_type:'quotes',entity_id:q.id});assert.equal((await request('quotes/'+q.id,'DELETE')).status,200);
 for(const log of logs)assert.equal(w.r.get('activity_logs',log.id).entity_id,null);assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),[]);
 const replacement=w.createQuote({client_id:1,title:'New quote'},[]);assert.equal(replacement.id,q.id);w.sendQuote(replacement.id);const hook=w.r.get('webhook_subscriptions',sub.id);assert.equal(hook.delivery_count,3);assert.equal(JSON.parse(hook.last_payload_json).event_key,`quote_sent:quotes:${q.id}`);assert.equal(w.r.list('activity_logs',{entity_type:'quotes',entity_id:q.id,action:'sent'}).length,1);
});
test('Astra 6 P2: delayed writes and subsequent reads cannot replace overlay state',async()=>{
 for(const action of ['claim-rewards','new-tag','remove-entity-tag:1:payments:1','toggle-checklist-item:1:payments:1'])for(const pause of [0,1,2])for(const next of ['close()',"modal('New panel','Current content')"]){
  const h=domHarness();h.elements.set('#new-tag-form',{});h.context.FormData=class{get(){return 'New tag';}};
  if(action==='new-tag')await h.run("gapAction('tag-filter')");else h.run("modal('Original','Old content')");
  let release,reached;const blocked=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;});let count=0;
  h.context.fetch=async(path,options)=>{h.calls.push({path,options});if(count++===pause){reached();await gate;}return {ok:true,json:async()=>path==='/api/payments/1'?{id:1}:path==='/api/checklist-items/1'?{id:1,is_completed:0}:[]};};
  const pending=action==='new-tag'?h.elements.get('#new-tag-form').onsubmit({preventDefault(){},target:{}}):h.run(`gapAction('${action}')`);
  const state=await Promise.race([blocked.then(()=>true),pending.then(()=>false)]);if(!state)continue;
  await h.run(next);const expected=h.elements.get('#overlay').innerHTML;release();await pending;assert.equal(h.elements.get('#overlay').innerHTML,expected,`${action} pause ${pause} after ${next}`);
 }
});

test('Astra 6 P2: subsequent visit-based billing reopens completed jobs without rebilling visits',t=>{
 const w=fixture(t),job=w.createJob({client_id:1,title:'Recurring billing',billing_type:'visit_based',total_cents:2500});
 const first=w.createVisit(job.id);w.completeVisit(first.id);w.completeJob(job.id);const invoice=w.invoiceJob(job.id);assert.equal(invoice.total_cents,2500);assert.equal(w.r.get('jobs',job.id).status,'completed');
 const second=w.createVisit(job.id);
 for(const status of ['completed','requires_invoicing']){w.r.update('jobs',job.id,{status});assert.throws(()=>w.completeJob(job.id),/open visits/);assert.equal(w.r.get('jobs',job.id).status,status);}
 w.r.update('jobs',job.id,{status:'completed'});w.completeVisit(second.id);assert.equal(w.completeJob(job.id).status,'requires_invoicing');const next=w.invoiceJob(job.id);assert.notEqual(next.id,invoice.id);assert.equal(next.total_cents,2500);assert.deepEqual(w.r.list('invoice_line_items',{invoice_id:next.id}).map(l=>l.visit_id),[second.id]);assert.equal(w.r.get('visits',first.id).invoice_id,invoice.id);
 const logs=w.r.list('activity_logs',{entity_type:'jobs',entity_id:job.id,action:'completed'});assert.equal(w.completeJob(job.id).status,'completed');assert.deepEqual(w.r.list('activity_logs',{entity_type:'jobs',entity_id:job.id,action:'completed'}),logs);
});
test('Astra 6 P2: failed custom field writes neither advance nor clear revision tracking',async t=>{
 const {w,request,db}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Failed revision',field_key:'failed_revision',field_type:'text'}),data={field_definition_id:field.id,entity_type:'jobs',entity_id:1};
 db.exec("CREATE TRIGGER reject_custom_update BEFORE UPDATE ON custom_field_values WHEN NEW.value_text='Reject' BEGIN INSERT INTO organizations(id,name,slug) VALUES (1,'dup','dup'); END; CREATE TRIGGER reject_custom_insert BEFORE INSERT ON custom_field_values WHEN NEW.value_text='Reject' BEGIN INSERT INTO organizations(id,name,slug) VALUES (1,'dup','dup'); END;");
 const save=(value_text,extra={})=>request('custom-field-values','POST',{...data,value_text,...extra});
 assert.equal((await save('Initial',{rev_scope:'A',revision:2})).status,201);
 assert.ok((await save('Reject',{rev_scope:'A',revision:100})).status>=400);
 assert.equal((await save('Next',{rev_scope:'A',revision:3})).body.value_text,'Next');
 assert.ok((await save('Reject')).status>=400);
 assert.equal((await save('Stale',{rev_scope:'A',revision:1})).body.value_text,'Next');
 assert.equal(w.r.list('custom_field_values',data)[0].value_text,'Next');
 assert.equal((await save('Unversioned',{rev_scope:'A'})).body.value_text,'Unversioned');
 assert.equal((await save('Reset',{rev_scope:'A',revision:0})).body.value_text,'Reset');
 data.entity_id=2;assert.ok((await save('Reject',{rev_scope:'A',revision:100})).status>=400);
 assert.equal((await save('Inserted',{rev_scope:'A',revision:1})).status,201);
 assert.equal((await save('After insert',{rev_scope:'A',revision:2})).body.value_text,'After insert');
});
test('Astra 6 P2: invalid custom field revisions and scopes reject without mutating state',async t=>{
 const {w,request}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Invalid revision',field_key:'invalid_revision',field_type:'text'}),data={field_definition_id:field.id,entity_type:'jobs',entity_id:1};
 const save=(value_text,extra={})=>request('custom-field-values','POST',{...data,value_text,rev_scope:'A',...extra});
 assert.equal((await save('Initial',{revision:2})).status,201);const initial=w.r.list('custom_field_values',data);
 assert.equal((await save('Invalid',{revision:'invalid'})).status,400);assert.deepEqual(w.r.list('custom_field_values',data),initial);
 assert.equal((await save('Next',{revision:3})).body.value_text,'Next');
 assert.equal((await save('Stale',{revision:1})).body.value_text,'Next');const saved=w.r.list('custom_field_values',data);
 for(const extra of [...['',-1,1.5,null,true,{}].map(revision=>({revision})),...['','   ',null,123].map(rev_scope=>({rev_scope,revision:100}))]){
  assert.equal((await save('Invalid',extra)).status,400);assert.deepEqual(w.r.list('custom_field_values',data),saved);
  assert.equal((await save('Stale',{revision:1})).body.value_text,'Next');assert.deepEqual(w.r.list('custom_field_values',data),saved);
 }
 assert.equal((await save('Later',{revision:4})).body.value_text,'Later');
});
test('Astra 6 P2: concurrent checklist clicks persist both toggles after the panel changes',async()=>{
 const h=domHarness();let release;const gate=new Promise(resolve=>{release=resolve;});
 h.context.fetch=async(path,options)=>{h.calls.push({path,options});if(path==='/api/checklist-items/1')await gate;return {ok:true,json:async()=>({id:path.endsWith('/1')?1:2,is_completed:0})};};
 h.run("detail=async()=>{modal('Refreshed drawer','Saved')}");
 const first=h.run("gapAction('toggle-checklist-item:1:jobs:9')");await h.run("gapAction('toggle-checklist-item:2:jobs:9')");
 h.run("modal('Unrelated editor','Unsaved content')");const expected=h.elements.get('#overlay').innerHTML;release();await first;
 const writes=h.calls.filter(c=>c.options.method==='POST');assert.deepEqual(writes.map(c=>c.path).sort(),['/api/checklist-items/1/complete','/api/checklist-items/2/complete']);for(const call of writes)assert.deepEqual(JSON.parse(call.options.body),{completed:true});assert.equal(h.elements.get('#overlay').innerHTML,expected);
});
test('Astra 6 P2: delayed mark-read removes badges without closing a newer editor',async()=>{
 for(const next of [null,'close()',"modal('Unrelated editor','Unsaved content')"]){
  const h=domHarness();let release;const gate=new Promise(resolve=>{release=resolve;});let dots=0,badges=0;
  h.elements.set('#updatesBtn .badge-dot',{remove(){dots++;}});h.context.document.querySelectorAll=s=>s==='.updates-badge'?[{remove(){badges++;}}]:[];
  h.context.fetch=async(path,options)=>{h.calls.push({path,options});await gate;return {ok:true,json:async()=>({})};};
  h.run("modal('Updates','Mark read')");const pending=h.run("gapAction('mark-updates-read')");if(next)h.run(next);const expected=h.elements.get('#overlay').innerHTML;release();await pending;
  assert.equal(dots,1);assert.equal(badges,1);assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'POST');
  if(next){assert.equal(h.elements.get('#overlay').innerHTML,expected);assert.equal(h.elements.get('#toast').textContent,'');}else{assert.equal(h.elements.get('#overlay').innerHTML,'');assert.equal(h.elements.get('#toast').textContent,'All updates marked as read');}
 }
});

test('Astra 6 P2: equal revision retries preserve a newer save from another scope',async t=>{
 const {w,request}=await httpFixture(t),field=w.r.insert('custom_field_definitions',{entity_type:'jobs',field_name:'Replay',field_key:'replay',field_type:'text'}),data={field_definition_id:field.id,entity_type:'jobs',entity_id:1};
 const save=(path,rev_scope,revision,value_text)=>request(path,'POST',{...data,rev_scope,revision,value_text});
 const first=await save('custom-field-values','A',1,'A1');assert.equal(first.status,201);
 assert.equal((await save('custom-values','B',1,'B1')).body.value_text,'B1');
 for(const path of ['custom-field-values','custom-values']){const retry=await save(path,'A',1,'A1');assert.equal(retry.status,200);assert.equal(retry.body.id,first.body.id);assert.equal(retry.body.value_text,'B1');}
 assert.equal(w.r.list('custom_field_values',data)[0].value_text,'B1');assert.equal((await save('custom-values','A',2,'A2')).body.value_text,'A2');
});
test('Astra 6 P2: concurrent checklist saves refresh the same drawer after each completion',async()=>{
 const h=domHarness(),completed=new Set();let release;const gate=new Promise(resolve=>{release=resolve;});
 h.run("modal('Checklist','Initial')");const version=h.run('panelVersion');
 h.context.fetch=async(path,options)=>{if(path==='/api/checklist-items/1/complete')await gate;if(options.method==='POST')completed.add(path.split('/')[3]);return {ok:true,json:async()=>path==='/api/jobs/9'?{id:9,title:'Checklist'}:path.includes('/checklist-items/')?{is_completed:0}:[]};};
 h.context.completed=completed;h.run("entitySections=async()=>[...completed].sort().join(',')");
 const first=h.run("gapAction('toggle-checklist-item:1:jobs:9')");await h.run("gapAction('toggle-checklist-item:2:jobs:9')");assert.equal(h.run('panelVersion'),version);
 release();await first;assert.match(h.elements.get('#overlay').innerHTML,/1,2/);assert.equal(h.run('panelVersion'),version);
});
test('Astra 6 P2: older detail responses cannot overwrite the latest in-place refresh',async()=>{
 for(const pause of ['record','sections']){
  const h=domHarness();h.run("modal('Checklist','Initial')");let release,reached;const gate=new Promise(resolve=>{release=resolve;}),blocked=new Promise(resolve=>{reached=resolve;});let records=0,sections=0;
  h.context.fetch=async path=>{if(path==='/api/jobs/9'){const n=++records;if(pause==='record'&&n===1){reached();await gate;}return {ok:true,json:async()=>({id:9,title:n===1?'Old snapshot':'Latest snapshot'})};}return {ok:true,json:async()=>[]};};
  h.context.sections=async()=>{if(pause==='sections'&&++sections===1){reached();await gate;}return '';};h.run('entitySections=sections');
  const first=h.run("detail('jobs',9,panelVersion)");await blocked;await h.run("detail('jobs',9,panelVersion)");const expected=h.elements.get('#overlay').innerHTML;assert.match(expected,/Latest snapshot/);release();await first;assert.equal(h.elements.get('#overlay').innerHTML,expected);
 }
});
test('Astra 6 P2: rewards and tag-filter refreshes preserve their panel version',async()=>{
 for(const action of ['rewards','tag-filter']){const h=domHarness();h.elements.set('#new-tag-form',{});await h.run(`gapAction('${action}')`);const version=h.run('panelVersion');await h.run(`gapAction('${action}',panelVersion)`);assert.equal(h.run('panelVersion'),version);await h.run(`gapAction('${action}')`);assert.ok(h.run('panelVersion')>version);}
});
test('Astra 6 P2: webhook deliveries roll back when automation emission fails',async t=>{
 const {w,request}=await httpFixture(t),sub=w.r.insert('webhook_subscriptions',{topic:'client_created',target_url:'https://example.test/hook',secret:'test',active:1});
 w.r.insert('automations',{name:'Invalid conditions',trigger_event:'client_created',action_type:'create_task',is_enabled:1,conditions_json:'null'});
 const originalError=console.error;console.error=()=>{};
 try{assert.ok((await request('automations/run','POST',{event:'client_created',entity_type:'clients',entity_id:1})).status>=500);}finally{console.error=originalError;}
 const saved=w.r.get('webhook_subscriptions',sub.id);assert.equal(saved.delivery_count,0);assert.equal(saved.delivered_keys_json,'[]');
});
test('Astra 6 P2: delayed actionForm and builder saves do not close or overwrite a newer editor',async()=>{
 for(const form of ['action-form','builder'])for(const pause of (form==='builder'?[0,1]:[0])){
  const h=domHarness();h.run('render=async()=>{throw Error("Unexpected render")}');
  if(form==='action-form')await h.run("gapAction('language')");else await h.run("builder('clients')");
  let release,reached,count=0;const gate=new Promise(resolve=>{release=resolve;}),blocked=new Promise(resolve=>{reached=resolve;});
  h.context.fetch=async(path,options)=>{h.calls.push({path,options});if(count++===pause){reached();await gate;}return {ok:true,json:async()=>[]};};
  const pending=h.elements.get('#'+form).onsubmit({preventDefault(){},target:{values:form==='action-form'?{language:'Français'}:{display_name:'Saved client'}}});
  await blocked;h.run("modal('Newer editor','Unsaved input')");const expected=h.elements.get('#overlay').innerHTML;release();await pending;
  assert.match(h.elements.get('#overlay').innerHTML,/Newer editor/);assert.match(h.elements.get('#overlay').innerHTML,/Unsaved input/);assert.equal(h.elements.get('#overlay').innerHTML,expected);assert.equal(h.elements.get('#toast').textContent,'');
 }
});
test('Astra 6 P2: recurring completions emit distinct events while retries remain idempotent',t=>{
 const w=fixture(t),job=w.createJob({client_id:1,title:'Recurring events',billing_type:'visit_based',total_cents:2500}),sub=w.r.insert('webhook_subscriptions',{topic:'job_completed',target_url:'https://example.test/hook',secret:'test',active:1}),rule=w.r.insert('automations',{name:'Each completion',trigger_event:'job_completed',action_type:'create_task',is_enabled:1}),keys=[];
 for(let i=1;i<=3;i++){
  const visit=w.createVisit(job.id);w.completeVisit(visit.id);w.completeJob(job.id);
  const saved=w.r.get('webhook_subscriptions',sub.id),logs=w.r.list('activity_logs',{entity_type:'jobs',entity_id:job.id,action:'completed'}),key=JSON.parse(saved.last_payload_json).event_key;assert.equal(saved.delivery_count,i);assert.equal(logs.length,i);assert.equal(key,i===1?`job_completed:jobs:${job.id}`:`job_completed:jobs:${job.id}:${logs.at(-1).id}`);assert.ok(!keys.includes(key));keys.push(key);
  const runs=w.r.list('automation_executions',{automation_id:rule.id});assert.equal(runs.length,i);assert.deepEqual(JSON.parse(saved.delivered_keys_json),keys);
  emit(w.r,'job_completed','jobs',String(job.id));for(const oldKey of keys)emit(w.r,'job_completed','jobs',job.id,oldKey);w.completeJob(job.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);assert.deepEqual(w.r.list('automation_executions',{automation_id:rule.id}),runs);w.invoiceJob(job.id);
 }
});
test('Astra 6 P2: deleted job logs are detached before a reused ID emits its base key',async t=>{
 const {w,request}=await httpFixture(t),job=w.createJob({client_id:1,title:'Old job'}),sub=w.r.insert('webhook_subscriptions',{topic:'job_completed',target_url:'https://example.test/hook',secret:'test',active:1});w.completeJob(job.id);
 const logs=w.r.list('activity_logs',{entity_type:'jobs',entity_id:job.id});assert.ok(logs.length);assert.equal((await request('jobs/'+job.id,'DELETE')).status,200);for(const log of logs)assert.equal(w.r.get('activity_logs',log.id).entity_id,null);
 assert.deepEqual(JSON.parse(w.r.get('webhook_subscriptions',sub.id).delivered_keys_json),[]);const replacement=w.createJob({client_id:1,title:'Replacement'});assert.equal(replacement.id,job.id);w.completeJob(replacement.id);
 const saved=w.r.get('webhook_subscriptions',sub.id);assert.equal(saved.delivery_count,2);assert.equal(JSON.parse(saved.last_payload_json).event_key,`job_completed:jobs:${job.id}`);assert.equal(w.r.list('activity_logs',{entity_type:'jobs',entity_id:job.id,action:'completed'}).length,1);emit(w.r,'job_completed','jobs',job.id);assert.deepEqual(w.r.get('webhook_subscriptions',sub.id),saved);
});

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
test('round five live wiring for dashboard metrics, reports, campaign delete, and account billing',async t=>{
 const {db,request}=await httpFixture(t),r=repository(db,1);
 const dashboard=await request('dashboard');assert.equal(dashboard.status,200);
 for(const key of ['appointment_metrics','upcoming_jobs_count','receivables_cents'])assert.ok(Object.hasOwn(dashboard.body,key),key);
 assert.ok(Object.hasOwn(dashboard.body.summary.quotes,'status_values_cents'));
 const billing={billing_name:'Round Five Billing',billing_address:'500 Main St, Gold River, CA 95670'};
 const updated=await request('account-billing','PATCH',billing);assert.equal(updated.status,200);
 const persisted=await request('account-billing');assert.equal(persisted.status,200);
 for(const [key,value] of Object.entries(billing)){assert.equal(updated.body[key],value);assert.equal(persisted.body[key],value);}
 const campaign=await request('marketing/campaigns','POST',{name:'Round Five Campaign',subject:'Tile update',body:'Your tile project update',channel:'email',campaign_type:'One-off'});
 assert.equal(campaign.status,201);assert.ok(campaign.body.id);
 const savedCampaign=r.get('campaigns',campaign.body.id);assert.equal(savedCampaign.created_by,'Jack Surwald');assert.equal(savedCampaign.campaign_type,'One-off');
 assert.equal((await request('marketing/campaigns/'+campaign.body.id,'DELETE')).status,200);
 assert.throws(()=>r.get('campaigns',campaign.body.id),/not found/);
 const expense=await request('expenses','POST',{item_name:'Round Five Mileage Expense',description:'Mileage trip',accounting_code:'Mileage',amount_cents:1200,date_incurred:'2026-10-28'});
 assert.equal(expense.status,201);assert.ok(expense.body.id);
 for(const report of ['expenses','mileage']){
  const result=await request('reports/'+report);assert.equal(result.status,200);
  assert.ok(JSON.stringify(result.body).includes('Round Five Mileage Expense'),report);
 }
 assert.equal((await request('expenses/'+expense.body.id,'DELETE')).status,200);
 assert.throws(()=>r.get('expenses',expense.body.id),/not found/);
 const deleted=await request('reports/delete_log');assert.equal(deleted.status,200);
 assert.ok(JSON.stringify(deleted.body).includes('deleted'));
 assert.ok(JSON.stringify(deleted.body).includes('Round Five Mileage Expense'));
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
test('tightening loop: address_line2 persistence, builder property_id, 30-day/7-day KPI windowing, dynamic greeting, and campaign job attribution',async t=>{
 const {db,w,request}=await httpFixture(t),r=repository(db,1);
 db.exec('ALTER TABLE organizations DROP COLUMN address_line2');migrate(db);migrate(db);
 assert.ok(db.prepare('PRAGMA table_info(organizations)').all().some(c=>c.name==='address_line2'));
 assert.equal((await request('settings','PATCH',{address:'100 Main St',address_line2:'Suite 200'})).status,200);
 assert.equal((await request('settings')).body.address_line2,'Suite 200');
 const ab=(await request('account-billing')).body;
 assert.equal(ab.status,'Active');assert.match(ab.billing_address,/Suite 200/);
 const portal=(await request('clients/1/portal')).body;
 assert.equal((await request('client-hub/'+portal.token)).body.organization.address_line2,'Suite 200');
 const p2=r.insert('properties',{client_id:1,street1:'250 Second Ave',street2:'Unit B',city:'Gold River',state:'CA',postal_code:'95670',country:'United States',is_primary:0});
 const h=domHarness();h.run(`user={id:1,name:'Jack Surwald'};org={name:'J S Custom Tile',address:'100 Main St',address_line2:'Suite 200'};clients=[{id:1,display_name:'Client 1'}];cache.properties=[{id:1,client_id:1,street1:'100 Main St',city:'Gold River',state:'CA'},{id:${p2.id},client_id:1,street1:'250 Second Ave',street2:'Unit B',city:'Gold River',state:'CA'}];render=async()=>{};`);
 assert.match(h.run(`propertyAddress({client_id:1,property_id:${p2.id}})`),/250 Second Ave, Unit B, Gold River, CA/);
 await h.click({addClientProperty:'1'});assert.match(h.elements.get('#overlay').innerHTML,/name="street2"/);
 const companyHtml=await h.run("settings('company')");
 assert.match(companyHtml,/name="address_line2"[^>]*>Suite 200<\/textarea>/);
 for(const type of ['requests','quotes','jobs','invoices']){
  h.run("fetch=async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/api/clients'?[{id:1,display_name:'Client 1'}]:({id:9,client_id:1,property_id:"+p2.id+",title:'Doc',subject:'Doc',items:[]})};}");
  await h.run(`builder('${type}')`);
  assert.match(h.elements.get('#overlay').innerHTML,/name="property_id"/);
  assert.match(h.elements.get('#overlay').innerHTML,/250 Second Ave/);
  h.calls.length=0;
  await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{client_id:'1',property_id:String(p2.id),title:'Doc',subject:'Doc'}}});
  const createdBody=JSON.parse(h.calls.find(c=>c.options.method==='POST').options.body);
  assert.equal(createdBody.property_id,p2.id);
  await h.run(`builder('${type}',9)`);
  h.calls.length=0;
  await h.elements.get('#builder').onsubmit({preventDefault(){},target:{values:{client_id:'1',property_id:'',title:'Doc',subject:'Doc'}}});
  const clearedBody=JSON.parse(h.calls.find(c=>c.options.method==='PATCH').options.body);
  assert.equal(clearedBody.property_id,null);
 }
 const homeHtml=await h.run("fetch=async path=>({ok:true,json:async()=>path==='/api/dashboard'?{summary:{requests:{statuses:{}},quotes:{statuses:{}},jobs:{statuses:{}},invoices:{statuses:{}}},appointment_metrics:{}}:[]});home()");
 assert.match(homeHtml,/<h1>Good (?:morning|afternoon|evening), Jack<\/h1>/);
 const recentIso=h.run('daysAgoIso(5)'),prevIso=h.run('daysAgoIso(45)'),oldIso=h.run('daysAgoIso(90)'),futureIso=h.run('daysAgoIso(-10)'),farFutureIso=h.run('daysAgoIso(-60)');
 h.run(`cache.visits=[{id:1,status:'completed',completed_at:'${recentIso}',billable_amount_cents:5000},{id:2,status:'completed',completed_at:'${prevIso}',billable_amount_cents:5000},{id:3,status:'scheduled',scheduled_start:'${futureIso}T09:00:00Z',billable_amount_cents:7000},{id:4,status:'scheduled',scheduled_start:'${farFutureIso}T09:00:00Z',billable_amount_cents:9000}];`);
 const quotesHtml=await h.run(`fetch=async path=>({ok:true,json:async()=>path==='/api/quotes'?[{id:1,status:'sent',issued_date:'${recentIso}',total_cents:10000,created_at:'${recentIso}'},{id:2,status:'approved',issued_date:'${recentIso}',approved_at:'${recentIso}',total_cents:20000,created_at:'${recentIso}'},{id:3,status:'sent',issued_date:'${prevIso}',total_cents:50000,created_at:'${prevIso}'},{id:4,status:'sent',issued_date:'${oldIso}',total_cents:90000,created_at:'${oldIso}'}]:[]});listPage('quotes')`);
 assert.match(quotesHtml,/<h3>Sent<\/h3><small>Past 30 days · \+100%<\/small><div class="number"><strong>2<\/strong><\/div><small>\$300\.00<\/small>/);
 assert.match(quotesHtml,/<h3>Converted<\/h3><small>Past 30 days · \+100%<\/small><div class="number"><strong>1<\/strong><\/div><small>\$200\.00<\/small>/);
 const jobsHtml=await h.run(`fetch=async path=>({ok:true,json:async()=>path==='/api/jobs'?[{id:1,status:'active',end_date:'${futureIso}',created_at:'${recentIso}'}]:path==='/api/visits'?cache.visits:[]});listPage('jobs')`);
 assert.match(jobsHtml,/<h3>Recent visits<\/h3><small>Past 30 days<\/small><div class="number"><strong>1<\/strong><\/div><small>\$50\.00<\/small>/);
 assert.match(jobsHtml,/<h3>Visits scheduled<\/h3><small>Next 30 days<\/small><div class="number"><strong>1<\/strong><\/div><small>\$70\.00<\/small>/);
 const mktHtml=await h.run(`marketingTab='Dashboard';fetch=async path=>({ok:true,json:async()=>path==='/api/automation-executions'?[{id:1,executed_at:'${recentIso}'},{id:2,executed_at:'${prevIso}'}]:[]});marketing()`);
 assert.match(mktHtml,/1 automation executions/);
 const camp=await request('marketing/campaigns','POST',{name:'Job Attribution Campaign',subject:'Promo',body:'Hi {{client_name}}',channel:'email'});
 assert.equal(camp.status,201);assert.equal(camp.body.jobs_count,0);
 const sentCamp=await request(`marketing/campaigns/${camp.body.id}/send`,'POST',{});
 assert.equal(sentCamp.status,200);
 w.createJob({client_id:2,title:'Post-campaign tile job',total_cents:25000});
 const listed=(await request('marketing/campaigns')).body.find(c=>c.id===camp.body.id);
 assert.ok(listed.jobs_count>=1);
});
test('live Chrome 1:1 page parity: insights, custom-reports, refer-and-earn, community, jobber-capital, bookkeeping, receptionist, and settings views',async()=>{
 const h=domHarness();
 h.run("user={id:1,name:'Jack Surwald'};org={name:'J S Custom Tile',phone:'9167518715',website:'jscustomtile.com'};clients=[{id:1,display_name:'Client 1',status:'lead'}];");
 const insightsHtml=await h.run("fetch=async path=>({ok:true,json:async()=>path==='/api/dashboard'?{receivables_cents:10000}:[]});insights()");
 for(const text of ['Insights','Overview','New leads','New requests','Converted quotes','New one-off jobs','Invoiced value','Revenue','Profit and loss','Cashflow','Lead conversion','Receivables'])assert.match(insightsHtml,new RegExp(text));
 const customHtml=h.run('customReports()');
 for(const text of ['Custom Reports','Revenue by Visit Type','Profit and Loss Trend','Recurring Income by Lead','Your data, the way you need to see it','Create your first Report'])assert.match(customHtml,new RegExp(text));
 const referHtml=await h.run('referAndEarn()');
 for(const text of ['Refer and get rewarded','Milestone Rewards','\\$100 prepaid card','Jobber mystery box','\\$1,000 vacation voucher','Your stats','You have not sent any referrals yet\\.'])assert.match(referHtml,new RegExp(text));
 const commHtml=h.run('communityPage()');
 for(const text of ['Jobber Now','Find answers in The Home Service Community Forum','Support your business with Jobber Grants','Listen to the Masters of Home Service podcast'])assert.match(commHtml,new RegExp(text));
 const capHtml=h.run('jobberCapital()');
 for(const text of ['Jobber Capital','Financing tailored to your business','One fixed fee','No personal guarantees required','Build your eligibility for Jobber Capital'])assert.match(capHtml,new RegExp(text));
 const bkHtml=await h.run("fetch=async()=>({ok:true,json:async()=>({income_cents:0,expense_cents:0,tax_cents:0,ledger:[]})});bookkeeping()");
 for(const text of ['Numbers you can actually use','Dedicated bookkeeping','Automatic syncing with no double entry','Reconciliation'])assert.match(bkHtml,new RegExp(text));
 const recHtml=await h.run("fetch=async()=>({ok:true,json:async()=>[]});receptionist()");
 for(const text of ['Test Receptionist','A dedicated phone number is required','Time Saved','Workflows Created','Call history & Conversations'])assert.match(recHtml,new RegExp(text));
 const mktQuiet=await h.run("marketingTab='Dashboard';fetch=async()=>({ok:true,json:async()=>[]});marketing()");
 for(const text of ['GOOGLE BUSINESS PROFILE','REFERRALS','CREATE WEBSITE','All quiet this week — your automations are standing by\\.'])assert.match(mktQuiet,new RegExp(text));
 for(const [page,expected] of [['business-profile','Essential information'],['work-settings','Payment terms'],['schedule','Appointment layout'],['location-services','Location timers'],['dedicated-phone-number','Dedicated Phone Number'],['expense-tracking','Accounting codes'],['account-connections','Google Business Profile'],['jobber-payments','Tap to Pay on iPhone'],['manage-team','4/5 seats assigned'],['emails-and-text-messages','Automations Settings'],['products-and-services','Import products & services'],['custom-fields','Client custom fields']]){
  const sHtml=await h.run(`settings('${page}')`);
  assert.match(sHtml,new RegExp(expected));
 }
 assert.match(h.run('paymentDisputes()'),/Payment disputes/);
 assert.match(await h.run("paymentTab='Payouts';listPage('payments')"),/You have not received a bank payout yet/);
 assert.match(await h.run("receptionistTab='Manage';receptionist()"),/Get started with Receptionist/);
 assert.match(await h.run("marketingTab='Website';marketing()"),/If you have a minute, we have your website/);
 assert.match(await h.run("marketingTab='Performance';marketing()"),/Your marketing performance/);
 assert.match(await h.run("appsTab='Featured';apps()"),/The Home Depot[\s\S]*Claude Connector[\s\S]*SendJim/);
 assert.match(await h.run("reportPage('Projected income')"),/View Aged Receivables Report/);
 assert.match(await h.run("settings('automations')"),/Auto-archive Quotes/);
 await h.run("builder('clients')");assert.match(h.elements.get('#overlay').innerHTML,/Lead source/);
 await h.run("builder('quotes')");assert.match(h.elements.get('#overlay').innerHTML,/Contract \/ Disclaimer/);
 await h.run("detail('clients',1)");assert.match(h.elements.get('#overlay').innerHTML,/Work overview[\s\S]*Requests \(0\)[\s\S]*All your client files in one place/);
 await h.run("detail('jobs',1)");assert.match(h.elements.get('#overlay').innerHTML,/<h3>Billing<\/h3>/);
 const profHtml=await h.run("fetch=async p=>({ok:true,json:async()=>p==='/api/jobs'?[{id:7,client_id:1,job_number:7,total_cents:50000}]:p==='/api/reports/profitability'?[{id:7,labor_cost_cents:12000,expense_cost_cents:8000,profit_cents:30000,margin_percent:60}]:[]});insights()");
 assert.match(profHtml,/\$120\.00[\s\S]*\$80\.00[\s\S]*\$300\.00[\s\S]*60%/);
 h.elements.set("#report-table",{innerHTML:""});h.run("rows=[{id:1,status:\"past_due\",total_cents:9900},{id:2,status:\"paid\",total_cents:1000}];");
 await h.click({reportPill:"Late"});
 assert.match(h.elements.get("#report-table").innerHTML,/\$99\.00/);
 assert.doesNotMatch(h.elements.get("#report-table").innerHTML,/\$10\.00/);
});
