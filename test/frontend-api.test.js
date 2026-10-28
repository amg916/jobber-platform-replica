import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createDatabase, repository } from '../src/db/database.js';
import { seedDatabase } from '../src/db/seed.js';
import { workflows } from '../src/services/workflows.js';
import { startServer } from '../src/server.js';

test('round four frontend parses and exposes task creation and reference table columns',()=>{
 const source=readFileSync(new URL('../src/public/app.js',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new Script(source));
 assert.match(source,/window\.openNewTaskModal=/);
 assert.match(source,/btn\('New Task','new-task'\)/);
 assert.match(source,/\['Due date',/);assert.match(source,/\['Subject',/);
 assert.match(source,/Marketing Dashboard/);assert.match(source,/data-live-conversations/);
});
test('seedDatabase initializes J S Custom Tile team with zero dummy business records and is idempotent',t=>{
 const db=createDatabase();t.after(()=>db.close());const r=repository(db,1);
 const checkSeed=()=>{
  assert.equal(db.prepare('SELECT count(*) n FROM organizations').get().n,1);
  assert.equal(db.prepare('SELECT name FROM organizations WHERE id=1').get().name,'J S Custom Tile');
  assert.equal(r.list('roles').length,4);assert.equal(r.list('users').length,4);
  assert.deepEqual(r.list('users').map(u=>u.name).sort(),['Jack Surwald','Kyle Waterworth','Roger Burton','William Houn']);
  for(const table of ['clients','properties','products_services','requests','quotes','jobs','visits','appointments','tasks','invoices','payments','expenses','subscription_payments','campaigns','notifications','messages'])assert.equal(r.list(table).length,0,table);
 };
 seedDatabase(db);checkSeed();
 const organizations=db.prepare('SELECT * FROM organizations ORDER BY id').all(),roles=r.list('roles'),users=r.list('users');
 seedDatabase(db);checkSeed();
 assert.deepEqual(db.prepare('SELECT * FROM organizations ORDER BY id').all(),organizations);
 assert.deepEqual(r.list('roles'),roles);assert.deepEqual(r.list('users'),users);
});
test('undefined optional values bind as null and malformed numbers are rejected',t=>{
 const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const r=repository(db,1);
 const client=r.insert('clients',{display_name:'Optional fields',phone:undefined});assert.equal(client.phone,null);
 assert.equal(r.update('clients',client.id,{email:undefined}).email,null);
 assert.ok(r.list('clients',{phone:undefined}).some(c=>c.id===client.id));
 assert.throws(()=>r.update('clients',client.id,{balance_cents:NaN}),/numeric/);
});
test('booking observes local business hours, weekends, user availability and atomic rollback',t=>{
 const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const w=workflows(db,1),r=w.r,count=r.list('clients').length;
 const svc=r.insert('products_services',{name:'Tile Service',item_type:'service',unit_price_cents:10000,active:1});
 const data={service_id:svc.id,customer_name:'Hours test',customer_email:'hours@example.com',assigned_user_ids_json:[3]};
 assert.throws(()=>w.book({...data,start_at:'2035-06-01T10:00:00Z',end_at:'2035-06-01T11:00:00Z'}),/business hours/);
 assert.throws(()=>w.book({...data,start_at:'2035-06-02T17:00:00Z',end_at:'2035-06-02T18:00:00Z'}),/business hours/);
 assert.equal(r.list('clients').length,count);
 r.update('users',3,{availability_json:{weekdays:[1],start:'08:00',end:'17:00'}});
 assert.throws(()=>w.book({...data,start_at:'2035-06-01T17:00:00Z',end_at:'2035-06-01T18:00:00Z'}),/team availability/);
 assert.equal(r.list('clients').length,count);
});
test('HTTP workspace bootstrap, static assets, document edits, pipeline, ledger and tenant switching',async t=>{
 const db=createDatabase();seedDatabase(db);const server=await startServer({db,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});
 for(const [path,type] of [['/','text/html'],['/clients','text/html'],['/styles.css','text/css'],['/app.js','text/javascript']]){const response=await fetch(server.url+path);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(type));assert.ok((await response.text()).length>100);}
 for(const name of ['logo_jobber_bug.svg','home_truck.webp','home_keys_to_growth.webp','clients_merge.webp','requests_track_client_request.webp','requests_torn_edge.svg','home_card_close.svg','requests_card_close.svg']){const response=await fetch(server.url+'/assets/'+name);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),name.endsWith('.svg')?'image/svg+xml':'image/webp');assert.ok((await response.arrayBuffer()).byteLength>0);const head=await fetch(server.url+'/assets/'+name,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.text()).length,0);}
 assert.equal((await fetch(server.url+'/assets/missing.svg')).status,404);
 assert.equal((await fetch(server.url+'/assets/README.json')).status,404);
 const boot=await fetch(server.url+'/api/auth/bootstrap',{method:'POST'}),session=await boot.json();assert.equal(session.user.name,'Jack Surwald');
 const request=async(path,method='GET',body)=>{const response=await fetch(server.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
 const c1=(await request('clients','POST',{display_name:'Primary Client',email:'primary@example.com'})).value;
 await request('requests','POST',{client_id:c1.id,title:'Initial Request'});
 const settings=(await request('settings')).value;
 assert.equal(settings.name,'J S Custom Tile');assert.equal(settings.phone,'9167518715');assert.equal(settings.website,'jscustomtile.com');assert.equal(settings.address,'11281 Pyrites Way');assert.equal(settings.city,'Gold River');assert.equal(settings.postal_code,'95670');
 const task=await request('tasks','POST',{title:'Round four task',due_date:'2026-10-26',assigned_user_id:1,status:'open'});
 assert.equal(task.status,201);assert.equal(task.value.title,'Round four task');
 assert.ok((await request('schedule')).value.tasks.some(x=>x.id===task.value.id));
 const quote=(await request('quotes','POST',{client_id:1,title:'Editable',items:[{name:'Tile',quantity:1,unit_price_cents:1000}]})).value;
 const updated=await request('quotes/'+quote.id,'PATCH',{items:[{name:'Tile',quantity:2,unit_price_cents:2500}]});assert.equal(updated.status,200);assert.equal(updated.value.total_cents,5000);
 assert.equal((await request('quotes/'+quote.id)).value.items.length,1);
 assert.ok((await request('pipeline')).value['New Lead'].length);
 assert.ok(Array.isArray((await request('bookkeeping')).value.ledger));
 assert.equal((await request('account-billing')).value.card_last4,'1821');
 assert.ok((await request('clients/1/portal')).value.token);
 const duplicate=(await request('clients','POST',{display_name:'Duplicate fixture',email:'duplicate@example.com'})).value;
 const linked=(await request('requests','POST',{client_id:duplicate.id,title:'Merge relationship test'})).value;
 assert.equal((await request('clients/merge','POST',{source_id:duplicate.id,target_id:duplicate.id})).status,400);
 assert.equal((await request('clients/merge','POST',{source_id:duplicate.id,target_id:1})).status,200);
 assert.equal((await request('clients/'+duplicate.id)).value.status,'archived');
 assert.equal((await request('requests/'+linked.id)).value.client_id,1);
 db.prepare("INSERT INTO organizations(id,name,slug) VALUES(2,'Second Org','second-org')").run();
 const r2=repository(db,2),role2=r2.insert('roles',{name:'Owner',slug:'owner',is_system:1});
 db.prepare('INSERT INTO permissions(role_id,resource,action,allowed) VALUES(?,?,?,1)').run(role2.id,'clients','read');
 db.prepare('INSERT INTO permissions(role_id,resource,action,allowed) VALUES(?,?,?,1)').run(role2.id,'clients','write');
 r2.insert('users',{role_id:role2.id,name:'Org2 Admin',email:'admin@org2.test',password_hash:'x',is_active:1});
 assert.equal((await request('auth/switch-org','POST',{organization_id:2})).status,200);
 assert.equal((await request('clients/merge','POST',{source_id:1,target_id:2})).status,404);
 assert.equal((await request('clients/1')).status,404);
 assert.equal((await request('auth/logout','POST',{})).status,200);
 assert.equal((await request('clients')).status,401);
});
