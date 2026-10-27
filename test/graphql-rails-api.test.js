import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, repository, hashPassword } from '../src/db/database.js';
import { seedDatabase } from '../src/db/seed.js';
import { startServer } from '../src/server.js';
import { encodeGid, decodeGid, parseGraphQL, normalizeInput, executeGraphQL, maxJobLineSeq, saveJobLineSeq, readJobOptions, storeJobOptions, storeJobLines, hydrateJobState } from '../src/services/graphql.js';
import { calculateDocument } from '../src/services/calculations.js';
import { createAuth, requestToken } from '../src/services/api-auth.js';

async function fixture(t){
 const db=createDatabase();seedDatabase(db);const r=repository(db,1),owner=r.list('users')[0];db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('test-password-123'),owner.id);
 const server=await startServer({db,seed:false,port:0,oauthClients:{'test-app':{redirectUris:['https://example.test/callback']}}});t.after(async()=>{await server.close();db.close();});
 const call=async(path,{method='GET',data,headers={}}={})=>{const response=await fetch(server.url+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});const text=await response.text();return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('json')?JSON.parse(text):text};};
 const login=await call('/api/auth/login',{method:'POST',data:{email:owner.email,password:'test-password-123'}});assert.equal(login.status,200);const headers={authorization:'Bearer '+login.body.token};
 const gql=async(query,variables={},extra={})=>(await call('/api/graphql',{method:'POST',data:{query,variables,...extra},headers})).body;
 const mutate=async(name,input,field,selection='id legacyId')=>{const result=await gql(`mutation($input: Input!){${name}(input:$input){${field}{${selection}} userErrors{message path}}}`,{input});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data[name].userErrors,[],JSON.stringify(result));return result.data[name][field];};
 return {db,r,owner,call,headers,gql,mutate,login};
}

test('global IDs and bounded GraphQL syntax',()=>{
 assert.equal(encodeGid('Client',1),'Z2lkOi8vam9iYmVyL0NsaWVudC8x');for(const id of [1,'1','gid://jobber/Client/1',encodeGid('Client',1)])assert.equal(decodeGid(id,'Client'),1);
 assert.throws(()=>decodeGid(encodeGid('Job',1),'Client'),/Invalid Global ID for Client/);assert.throws(()=>decodeGid(-1));assert.throws(()=>parseGraphQL('{ clients { } }'));assert.throws(()=>parseGraphQL('{'+ 'x{'.repeat(50)+'id'+'}'.repeat(51)));
});

test('OAuth code exchange, replay protection, refresh rotation and real bearer session',async t=>{
 const {call,headers}=await fixture(t);const params='client_id=test-app&response_type=code&redirect_uri=https%3A%2F%2Fexample.test%2Fcallback&state=opaque';
 assert.equal((await call('/api/oauth/authorize?'+params)).status,401);
 const grant=await call('/api/oauth/authorize?'+params,{headers});assert.equal(grant.status,200);assert.equal(grant.body.state,'opaque');
 const data={grant_type:'authorization_code',code:grant.body.code,client_id:'test-app',redirect_uri:'https://example.test/callback'};
 const exchanged=await call('/oauth/token',{method:'POST',data});assert.equal(exchanged.status,200);assert.equal(exchanged.body.token_type,'Bearer');
 assert.equal((await call('/api/auth/me',{headers:{authorization:'Bearer '+exchanged.body.access_token}})).status,200);
 assert.equal((await call('/api/oauth/token',{method:'POST',data})).status,400);
 const refresh={grant_type:'refresh_token',refresh_token:exchanged.body.refresh_token,client_id:'test-app'};
 const renewed=await call('/api/oauth/token',{method:'POST',data:refresh});assert.equal(renewed.status,200);assert.notEqual(renewed.body.access_token,exchanged.body.access_token);
 assert.equal((await call('/api/oauth/token',{method:'POST',data:refresh})).status,400);
 assert.equal((await call('/api/auth/me',{headers:{authorization:'Bearer '+renewed.body.access_token}})).status,200);
 assert.equal((await call('/oauth/token',{method:'POST',data:{grant_type:'client_credentials',client_id:'unknown'}})).status,401);
});

test('session cookie, CSRF enforcement, header auth and logout',async t=>{
 const {call,login}=await fixture(t);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
 for(const path of ['/api/auth/me','/clients.json','/api/graphql?query=%7BcurrentUser%7Bid%7D%7D'])assert.equal((await call(path,{headers})).status,200);
 assert.equal((await call('/api/graphql',{method:'POST',headers,data:{query:'{account{id}}'}})).status,403);
 headers['x-csrf-token']=(await call('/api/csrf',{headers})).body.csrfToken;
 assert.equal((await call('/api/graphql',{method:'POST',headers,data:{query:'{account{id}}'}})).status,200);
 assert.equal((await call('/api/auth/me',{headers:{'x-jobber-token':login.body.token}})).status,200);
 const logout=await call('/api/auth/logout',{method:'POST',headers,data:{}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await call('/api/auth/me',{headers})).status,401);
});

test('GraphQL projection, fragments, variables, pagination, operation selection and version',async t=>{
 const {gql,call,headers}=await fixture(t);
 const query=`query First($show:Boolean=true){account{id industry} currentUser{name{full} email{raw}} alias:clients(first:2){__typename nodes{...ClientBits ... on Client {legacyId} name @include(if:$show) notes @skip(if:$show)} edges{cursor node{id}} pageInfo{hasNextPage endCursor} totalCount} __schema{queryType{name}}} fragment ClientBits on Client {id __typename}`;
 const result=await gql(query);assert.equal(result.errors,undefined,JSON.stringify(result));assert.equal(result.data.alias.nodes.length,2);assert.equal(result.data.alias.nodes[0].__typename,'Client');assert.equal(result.data.alias.nodes[0].notes,undefined);assert.equal(result.data.alias.pageInfo.hasNextPage,true);assert.equal(result.data.__schema.queryType.name,'Query');
 const next=await gql('query($after:String!){clients(first:2,after:$after){nodes{id}}}',{after:result.data.alias.pageInfo.endCursor});assert.notEqual(next.data.clients.nodes[0].id,result.data.alias.nodes[0].id);
 const node=await gql('query($id:ID!){node(id:$id){__typename ... on Client{id name}}}',{id:result.data.alias.nodes[0].id});assert.equal(node.data.node.id,result.data.alias.nodes[0].id);
 const search=await gql('{clients(searchTerm:"Gary Barbier"){nodes{name} totalCount}}');assert.ok(search.data.clients.totalCount>0);
 assert.ok((await gql('query A{account{id}} query B{currentUser{id}}')).errors);
 const selected=await gql('query A{account{id}} query B{currentUser{id}}',{}, {operationName:'B'});assert.ok(selected.data.currentUser);assert.equal(selected.data.account,undefined);
 const version=await call('/graphql',{method:'POST',headers:{...headers,'x-jobber-graphql-version':'2026-01-01'},data:{query:'{account{id}}'}});assert.equal(version.headers.get('x-jobber-graphql-version'),'2026-01-01');assert.equal(version.body.extensions.versioning.version,'2026-01-01');
 assert.ok((await gql('{...Cycle} fragment Cycle on Query {...Cycle}')).errors);
});

test('GraphQL quote-to-cash workflow reconciles exact cents and dollars',async t=>{
 const {mutate,gql}=await fixture(t);
 const c=await mutate('clientCreate',{name:'GraphQL Customer',email:'graphql@example.test',receivesEmail:true},'client');
 const p=await mutate('propertyCreate',{clientId:c.id,address:{street1:'1 Main',city:'Austin'}},'property');
 const request=await mutate('requestCreate',{clientId:c.id,propertyId:p.id,title:'Tile'},'request');
 const q=await mutate('quoteCreate',{clientId:c.id,propertyId:p.id,requestId:request.id,title:'Tile quote',taxRate:10,lineItems:[{name:'Tile',quantity:2,unitPrice:12.34,taxable:true},{name:'Labor',quantity:1,unit_price_cents:500,taxable:false}]},'quote','id legacyId amounts{total totalCents subtotalCents taxCents}');
 assert.deepEqual(q.amounts,{total:32.15,totalCents:3215,subtotalCents:2968,taxCents:247});
 await mutate('quoteSend',{id:q.id},'quote');await mutate('quoteApprove',{id:q.id},'quote');const j=await mutate('quoteConvertToJob',{id:q.id},'job');
 const v=await mutate('visitCreate',{jobId:j.id},'visit');await mutate('visitComplete',{id:v.id},'visit');await mutate('jobComplete',{id:j.id},'job');
 const i=await mutate('jobInvoice',{id:j.id},'invoice','id amounts{totalCents}');assert.equal(i.amounts.totalCents,3215);await mutate('invoiceSend',{id:i.id},'invoice');
 const payment=await mutate('invoiceRecordPayment',{id:i.id,amount:32.15,paymentMethod:'CASH'},'paymentRecord','id amount amountCents');assert.equal(payment.amountCents,3215);
 let balance=await gql('query($id:ID!){client(id:$id){balanceCents}}',{id:c.id});assert.equal(balance.data.client.balanceCents,0);
 await mutate('paymentRefund',{id:payment.id,amount_cents:100,reason:'Adjustment'},'paymentRecord','id refundedCents');balance=await gql('query($id:ID!){client(id:$id){balanceCents totalBalance}}',{id:c.id});assert.deepEqual(balance.data.client,{balanceCents:100,totalBalance:1});
});

test('Job line items and heterogeneous scheduled items preserve types and pagination',async t=>{
 const {mutate,gql,r,db,owner}=await fixture(t),client=r.list('clients')[0];
 const request=await mutate('requestCreate',{clientId:client.id,title:'Assessment test'},'request');
 await mutate('requestScheduleAssessment',{id:request.id,startAt:'2026-11-02T10:00:00Z',endAt:'2026-11-02T11:00:00Z'},'request');
 const quote=await mutate('quoteCreate',{clientId:client.id,title:'Selected lines',lineItems:[{name:'Required',quantity:2,unitPrice:10},{name:'Selected',quantity:1,unitPrice:5,isOptional:true,isSelected:true},{name:'Excluded',quantity:1,unitPrice:99,isOptional:true,isSelected:false}]},'quote');
 await mutate('quoteSend',{id:quote.id},'quote');await mutate('quoteApprove',{id:quote.id},'quote');
 const job=await mutate('quoteConvertToJob',{id:quote.id},'job');
 const lines=await gql('query($id:ID!){job(id:$id){lineItems{__typename nodes{__typename id name totalCents} edges{node{id}}}}}',{id:job.id});
 assert.equal(lines.errors,undefined,JSON.stringify(lines));assert.equal(lines.data.job.lineItems.__typename,'JobLineItemConnection');
 assert.deepEqual(lines.data.job.lineItems.nodes.map(l=>[l.name,l.totalCents]),[['Required',2000],['Selected',500]]);
 for(const l of lines.data.job.lineItems.nodes){assert.equal(l.__typename,'JobLineItem');assert.ok(decodeGid(l.id,'JobLineItem'));}
 assert.deepEqual(lines.data.job.lineItems.edges.map(e=>e.node.id),lines.data.job.lineItems.nodes.map(l=>l.id));
 const standalone=await mutate('jobCreate',{clientId:client.id,title:'Standalone',instructions:'Work',subtotalCents:1000,totalCents:1100,taxCents:100},'job');
 const fallback=await gql('query($id:ID!){job(id:$id){lineItems{nodes{id name description quantity unitPrice totalPrice unitPriceCents totalCents taxable}}}}',{id:standalone.id});
 assert.equal(fallback.errors,undefined,JSON.stringify(fallback));assert.deepEqual(fallback.data.job.lineItems.nodes,[{id:encodeGid('JobLineItem',standalone.legacyId),name:'Standalone',description:'Work',quantity:1,unitPrice:10,totalPrice:11,unitPriceCents:1000,totalCents:1100,taxable:true}]);
 const visit=await mutate('visitCreate',{jobId:job.id},'visit'),task=await mutate('taskCreate',{title:'Schedule task',dueDate:'2026-11-02'},'task');
 const selection='__typename ... on Visit {id visitStatus} ... on Assessment {id startAt} ... on Task {id dueDate}';
 const all=await gql(`{scheduledItems(first:1000){__typename nodes{${selection}} edges{cursor node{id}} totalCount}}`);
 assert.equal(all.errors,undefined,JSON.stringify(all));const schedule=all.data.scheduledItems;assert.equal(schedule.__typename,'ScheduledItemConnection');
 assert.ok(schedule.nodes.some(n=>n.__typename==='Visit'&&n.id===visit.id&&n.visitStatus));
 assert.ok(schedule.nodes.some(n=>n.__typename==='Assessment'&&n.id===encodeGid('Assessment',request.legacyId)&&n.startAt));
 assert.ok(schedule.nodes.some(n=>n.__typename==='Task'&&n.id===task.id&&n.dueDate==='2026-11-02'));
 assert.equal(new Set(schedule.edges.map(e=>e.cursor)).size,schedule.totalCount);
 const paged=[];let after=null;
 do{const page=await gql(`query($after:String){scheduledItems(first:1,after:$after){nodes{${selection}} pageInfo{endCursor hasNextPage}}}`,{after});assert.equal(page.errors,undefined,JSON.stringify(page));paged.push(...page.data.scheduledItems.nodes);after=page.data.scheduledItems.pageInfo.hasNextPage?page.data.scheduledItems.pageInfo.endCursor:null;}while(after);
 assert.deepEqual(paged,schedule.nodes);
 const previous=await gql('query($before:String!){scheduledItems(last:1,before:$before){nodes{id}}}',{before:schedule.edges.at(-1).cursor});assert.equal(previous.errors,undefined);assert.equal(previous.data.scheduledItems.nodes[0].id,schedule.edges.at(-2).node.id);
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND resource='schedule'").run(owner.role_id);assert.ok((await gql('{scheduledItems{nodes{__typename}}}')).errors);
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND resource='jobs'").run(owner.role_id);assert.ok((await gql('query($id:ID!){job(id:$id){lineItems{nodes{id}}}}',{id:job.id})).errors);
});

test('GraphQL permission denial and domain errors do not mutate data',async t=>{
 const {db,r,owner,gql}=await fixture(t);const before=r.list('clients').length;
 const invalid=await gql('mutation{clientCreate(input:{}){client{id} userErrors{message path}}}');assert.ok(invalid.data.clientCreate.userErrors.length);assert.equal(r.list('clients').length,before);
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND resource='clients'").run(owner.role_id);
 assert.ok((await gql('{clients{nodes{id}}}')).errors);assert.ok((await gql('mutation{clientCreate(input:{name:"Forbidden"}){client{id} userErrors{message}}}')).errors);assert.equal(r.list('clients').length,before);
});

test('Astra 1: partial monetary edits inherit fixed types',async t=>{
 const {mutate,r}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const type of ['quote','invoice']){const doc=await mutate(type+'Create',{clientId,...(type==='quote'?{title:'Fixed',requiredDepositType:'FIXED',requiredDepositValue:2}:{subject:'Fixed'}),discountType:'FIXED',discountValue:1,lineItems:[{name:'Work',unitPrice:100,quantity:1}]},type);
  await mutate(type+'Edit',{id:doc.id,discountValue:3.45,...(type==='quote'?{requiredDepositValue:6.78}:{})},type);
  const stored=r.get(type+'s',doc.legacyId);assert.equal(stored.discount_value,345);assert.equal(stored.discount_cents,345);if(type==='quote'){assert.equal(stored.required_deposit_value,678);assert.equal(stored.required_deposit_cents,678);}
 }
});

test('Astra 2: invalid nested selections fail before any mutation',async t=>{
 const {gql,r}=await fixture(t),before=r.list('clients').length;
 const bad=['doesNotExist','client{doesNotExist}','client','client{id{bad}}','userErrors{doesNotExist}','... on ClientCreatePayload {doesNotExist}','...Bad','client{properties{edges{node{address{bad}}}}}','client{jobs{nodes{jobCosting{bad}}}}','client{quotes{nodes{amounts{bad}}}}','client{invoices{nodes{lineItems{nodes{bad}}}}}','client{phones{bad}}','client{emails{bad}}','client{billingAddress{bad}}','client{properties{pageInfo{bad}}}','client{requests{nodes{assessment{bad}}}}','client{jobs{nodes{visits{nodes{assignedUsers{nodes{name{bad}}}}}}}}'];
 for(const selection of bad){const result=await gql(`mutation{first:clientCreate(input:{name:"Must not insert"}){client{id}} second:clientCreate(input:{name:"Invalid"}){${selection}}} fragment Bad on ClientCreatePayload {doesNotExist}`);assert.ok(result.errors,selection);assert.equal(result.data,null);assert.equal(r.list('clients').length,before);}
 for(const suffix of ['bad','client{id} @skip(if:true) doesNotExist @skip(if:true)']){assert.ok((await gql(`mutation{clientCreate(input:{name:"Skipped invalid"}){${suffix}}}`)).errors);assert.equal(r.list('clients').length,before);}
 for(const query of ['{__schema{types{fields{bad}}}}','{__schema{directives{bad}}}','{__type(name:"Client"){bad}}','{node(id:1){bad}}','{scheduledItems{nodes{bad}}}','{currentUser{email{bad}}}'])assert.ok((await gql(query)).errors,query);
});

test('Astra 3: execution budgets abort traversal immediately',async t=>{
 const {gql,r}=await fixture(t);for(let i=0;i<850;i++)r.insert('clients',{display_name:'Budget '+i});
 const wide=await gql(`{clients(first:1000){nodes{${Array.from({length:25},(_,i)=>`n${i}:name`).join(' ')}}} account{id}}`);
 assert.equal(wide.data,null);assert.deepEqual(wide.errors,[{message:'Execution cost exceeded'}]);assert.equal(wide.extensions.cost.actualQueryCost,20001);
 const client=r.insert('clients',{display_name:'Unique depth probe'});r.insert('jobs',{client_id:client.id,title:'Depth'});
 r.update('clients',client.id,{phone:'555-0100'});
 let selection='phones{raw}';for(let i=0;i<9;i++)selection=`jobs{nodes{client{${selection}}}}`;
 const deep=await gql(`{clients(first:1,searchTerm:"Unique depth probe"){nodes{${selection}}}}`);
 assert.deepEqual(deep.errors,[{message:'Result depth exceeded'}]);assert.equal(deep.data,null);
});

test('Astra 4: omitted optional variables preserve existing data',async t=>{
 const {gql,mutate,r}=await fixture(t);const c=await mutate('clientCreate',{name:'Optional',phones:[{number:'555-1212'}],isArchived:true},'client');
 const query='mutation($id:ID!,$phones:[PhoneInput],$archived:Boolean){clientEdit(input:{id:$id,phones:$phones,isArchived:$archived}){client{id} userErrors{message}}}';
 const result=await gql(query,{id:c.id});assert.equal(result.errors,undefined);assert.deepEqual(result.data.clientEdit.userErrors,[]);assert.equal(r.get('clients',c.legacyId).phone,'555-1212');assert.equal(r.get('clients',c.legacyId).status,'archived');
 const explicit=await gql(query,{id:c.id,phones:[],archived:false});assert.equal(explicit.errors,undefined);assert.equal(r.get('clients',c.legacyId).phone,'');assert.equal(r.get('clients',c.legacyId).status,'active');
 assert.ok((await gql('mutation{clientEdit(input:{id:1,phones:$missing}){client{id}}}')).errors);
});

test('Astra 5: quote-backed and fallback lines have distinct global IDs',async t=>{
 const {gql,r,db}=await fixture(t),client=r.list('clients')[0],lineId=Math.max(0,...r.list('quote_line_items').map(l=>l.id),...r.list('jobs').map(j=>j.id))+100;
 db.prepare('INSERT INTO jobs(id,organization_id,client_id,title) VALUES(?,1,?,?)').run(lineId,client.id,'Fallback');const fallback=r.get('jobs',lineId),quote=r.insert('quotes',{client_id:client.id,title:'Quoted'});
 db.prepare('INSERT INTO quote_line_items(id,organization_id,quote_id,name,quantity) VALUES(?,1,?,?,1)').run(lineId,quote.id,'Quoted line');const backed=r.insert('jobs',{client_id:client.id,quote_id:quote.id,title:'Backed'});
 const result=await gql(`{a:job(id:${fallback.id}){lineItems{nodes{id}}} b:job(id:${backed.id}){lineItems{nodes{id}}}}`);assert.equal(result.errors,undefined);assert.equal(result.data.a.lineItems.nodes[0].id,encodeGid('JobLineItem',fallback.id));assert.equal(result.data.b.lineItems.nodes[0].id,encodeGid('JobLineItem','quote:'+fallback.id));assert.notEqual(result.data.a.lineItems.nodes[0].id,result.data.b.lineItems.nodes[0].id);
});

test('Astra 6: full grant stores permit consumption and refresh rotation',async t=>{
 const {db,owner,headers}=await fixture(t),auth=createAuth(db,{oauthClients:{app:{secret:'test-secret',userId:owner.id,organizationId:1}}}),credentials={grant_type:'client_credentials',client_id:'app',client_secret:'test-secret'};let first;
 for(let i=0;i<10000;i++){const grant=auth.exchange(credentials);first??=grant;}
 const code=auth.authorize({headers},{response_type:'code',client_id:'app'}).code;
 assert.throws(()=>auth.exchange({...credentials,grant_type:'authorization_code',code}),/Too many pending/);
 assert.throws(()=>auth.exchange(credentials),/Too many pending/);
 const rotated=auth.exchange({...credentials,grant_type:'refresh_token',refresh_token:first.refresh_token});assert.ok(rotated.access_token);assert.throws(()=>auth.exchange({...credentials,grant_type:'refresh_token',refresh_token:first.refresh_token}),/Invalid refresh/);
 const codeAuth=createAuth(db);let consumable;for(let i=0;i<10000;i++){const grant=codeAuth.authorize({headers},{response_type:'code',client_id:'test'});consumable??=grant.code;}
 assert.throws(()=>codeAuth.authorize({headers},{response_type:'code',client_id:'test'}),/Too many pending/);
 assert.ok(codeAuth.exchange({grant_type:'authorization_code',client_id:'test',code:consumable}).access_token);
});

test('Astra 7: issuance failures preserve code, refresh and previous session',async t=>{
 const {db,headers}=await fixture(t),auth=createAuth(db),code=auth.authorize({headers},{response_type:'code',client_id:'test'}).code;
 db.exec("CREATE TEMP TABLE issuance_failure(enabled INTEGER); INSERT INTO issuance_failure VALUES(1); CREATE TEMP TRIGGER fail_issuance BEFORE INSERT ON sessions WHEN (SELECT enabled FROM issuance_failure)=1 BEGIN SELECT RAISE(ABORT,'forced issuance failure'); END;");
 const input={grant_type:'authorization_code',client_id:'test',code};assert.throws(()=>auth.exchange(input),/forced issuance failure/);
 db.exec('UPDATE issuance_failure SET enabled=0');const issued=auth.exchange(input),before=db.prepare('SELECT expires_at FROM sessions WHERE token=?').get(issued.access_token).expires_at;
 const refresh={grant_type:'refresh_token',client_id:'test',refresh_token:issued.refresh_token};db.exec('UPDATE issuance_failure SET enabled=1');assert.throws(()=>auth.exchange(refresh),/forced issuance failure/);assert.equal(db.prepare('SELECT expires_at FROM sessions WHERE token=?').get(issued.access_token).expires_at,before);
 db.exec('UPDATE issuance_failure SET enabled=0');assert.ok(auth.exchange(refresh).access_token);assert.equal(db.prepare('SELECT expires_at FROM sessions WHERE token=?').get(issued.access_token).expires_at,new Date(0).toISOString());
});

test('Astra 8: ignored authorization headers cannot bypass cookie CSRF',async t=>{
 const {call,login}=await fixture(t),cookie=login.headers.get('set-cookie').split(';')[0];
 for(const extra of [{authorization:'Basic ignored'},{'x-jobber-token':'   '},{authorization:'Bearer   '}]){const headers={cookie,...extra};assert.equal(requestToken({headers}),login.body.token);assert.equal((await call('/graphql',{method:'POST',headers,data:{query:'{account{id}}'}})).status,403);const csrf=(await call('/api/csrf',{headers})).body.csrfToken;assert.equal((await call('/graphql',{method:'POST',headers:{...headers,'x-csrf-token':csrf},data:{query:'{account{id}}'}})).status,200);}
});

test('Astra 9: visit instructions and completion notes remain distinct',async t=>{
 const {mutate,r}=await fixture(t),job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Job title',instructions:'Job instructions'},'job');
 const inherited=await mutate('visitCreate',{jobId:job.id},'visit','id title instructions completionNotes');assert.equal(inherited.title,'Job title');assert.equal(inherited.instructions,'Job instructions');assert.equal(inherited.completionNotes,'');
 const custom=await mutate('visitCreate',{jobId:job.id,title:'Visit title',instructions:'Visit instructions'},'visit','id title instructions');assert.equal(custom.title,'Visit title');assert.equal(custom.instructions,'Visit instructions');
 const completed=await mutate('visitComplete',{id:custom.id,notes:'Finished work'},'visit','id instructions completionNotes');assert.equal(completed.instructions,'Visit instructions');assert.equal(completed.completionNotes,'Finished work');
 const blank=await mutate('visitCreate',{jobId:job.id,instructions:''},'visit','id instructions');assert.equal(blank.instructions,'');
});

test('Astra 10: redirects require registered clients and exact callback matches',async t=>{
 const {call,headers}=await fixture(t);
 for(const [client,redirect] of [['unknown','https://example.test/callback'],['test-app','https://evil.test/callback']]){const result=await call('/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:client,redirect_uri:redirect}),{headers:{...headers,accept:'text/html'}});assert.equal(result.status,400);assert.equal(result.headers.get('location'),null);assert.match(result.body.error,/Unregistered redirect_uri/);}
});

test('Astra 11: alias conflicts validate before writes, including merged and abstract selections',async t=>{
 const {gql,r}=await fixture(t),before=r.list('clients').length;
 const selections=['client{x:id x:name}','client{...Bits x:name}','client{properties(first:1){nodes{id}} properties(first:2){nodes{id}}}','client{properties{nodes{x:id}} properties{nodes{x:legacyId}}}'];
 for(const selection of selections){const result=await gql(`mutation{first:clientCreate(input:{name:"No write"}){client{id}} second:clientCreate(input:{name:"Invalid"}){${selection}}} fragment Bits on Client{x:id}`);assert.equal(result.data,null);assert.match(result.errors[0].message,/Conflicting fields/);assert.equal(r.list('clients').length,before);}
 for(const query of ['{node(id:1){... on Client{x:id} ... on Client{x:name}}}','{scheduledItems{nodes{... on ScheduledItem{x:id} ... on Visit{x:title}}}}']){const result=await gql(query);assert.equal(result.data,null);assert.match(result.errors[0].message,/Conflicting fields/);}
 const valid=await gql('query($n:Int=1){clients(first:$n){nodes{id}} clients(first:1){nodes{name}}}');assert.equal(valid.errors,undefined);assert.ok(valid.data.clients.nodes[0].id);assert.ok(valid.data.clients.nodes[0].name);
});

test('Astra 12: invalid money and numeric values never become zero',async t=>{
 const money=['unitPrice','unitCost','amount','total','subtotal','taxAmount','billableAmount','hourlyCost','totalCost'],numeric=['quantity','taxRate','discountValue','requiredDepositValue','markup'];
 for(const field of [...money,...numeric])for(const value of [true,false,null,'',' ','bad','Infinity',Infinity,NaN,[],{}])assert.throws(()=>normalizeInput({[field]:value},'Quote'),/Invalid (monetary amount|numeric value)/,field);
 assert.equal(normalizeInput({unitPrice:'12.34'}).unit_price_cents,1234);assert.equal(normalizeInput({discountType:'FIXED',discountValue:'1.23'}).discount_value,123);
 const {gql,r}=await fixture(t),before=r.list('quotes').length;
 const result=await gql('mutation($input:Input!){quoteCreate(input:$input){quote{id} userErrors{message}}}',{input:{clientId:r.list('clients')[0].id,title:'Invalid',lineItems:[{name:'Bad',unitPrice:'bad'}]}});assert.match(result.data.quoteCreate.userErrors[0].message,/Invalid monetary/);assert.equal(r.list('quotes').length,before);
});

test('Astra 13: login and password grants share a thirty-attempt window',async t=>{
 const {call}=await fixture(t);
 for(let i=1;i<30;i++){const oauth=i%2===0;assert.equal((await call(oauth?'/oauth/token':'/api/auth/login',{method:'POST',data:{grant_type:'password',email:'missing@example.test',password:'bad'}})).status,401);}
 for(const path of ['/api/auth/login','/api/oauth/token']){const result=await call(path,{method:'POST',data:{grant_type:'password',email:'missing@example.test',password:'bad'}});assert.equal(result.status,429);assert.match(result.body.error,/Too many login attempts/);}
 const {db}=await fixture(t),auth=createAuth(db),req={socket:{remoteAddress:'test-ip'}},now=Date.now;let clock=now();t.after(()=>{Date.now=now;});Date.now=()=>clock;
 for(let i=0;i<30;i++)auth.throttle(req);assert.throws(()=>auth.throttle(req),/Too many/);auth.throttle({socket:{remoteAddress:'other-ip'}});clock+=60000;assert.doesNotThrow(()=>auth.throttle(req));Date.now=now;
});

test('Astra 14: partial client names preserve unchanged components',async t=>{
 const {mutate}=await fixture(t);let c=await mutate('clientCreate',{firstName:'Jane',lastName:'Doe',companyName:'Company'},'client','id name');assert.equal(c.name,'Jane Doe');
 c=await mutate('clientEdit',{id:c.id,firstName:'Janet'},'client','id name');assert.equal(c.name,'Janet Doe');
 c=await mutate('clientEdit',{id:c.id,lastName:'Smith'},'client','id name');assert.equal(c.name,'Janet Smith');
 c=await mutate('clientEdit',{id:c.id,firstName:'',lastName:''},'client','id name');assert.equal(c.name,'Company');
});

test('Astra 15: property tax overrides round trip, including zero',async t=>{
 const {mutate,gql,r,db}=await fixture(t);db.prepare('UPDATE organizations SET tax_rate=8 WHERE id=1').run();
 const p=await mutate('propertyCreate',{clientId:r.list('clients')[0].id,address:{street1:'Tax test'},taxRate:{tax:3.5}},'property','id taxRate{tax}');assert.equal(p.taxRate.tax,3.5);
 const edited=await mutate('propertyEdit',{id:p.id,taxRate:{rate:0}},'property','id taxRate{tax}');assert.equal(edited.taxRate.tax,0);
 const saved=await gql('query($id:ID!){property(id:$id){taxRate{tax}}}',{id:p.id});assert.equal(saved.data.property.taxRate.tax,0);
});

test('Astra 16: all client mutation payloads retain authoritative portal tokens',async t=>{
 const {mutate,r}=await fixture(t),selection='id legacyId clientHubUri';let c=await mutate('clientCreate',{name:'Portal'},'client',selection);
 const check=c=>assert.equal(c.clientHubUri,'/hub/'+r.get('clients',c.legacyId).portal_token);check(c);assert.ok(r.get('clients',c.legacyId).portal_token);
 for(const name of ['clientEdit','clientArchive','clientUnarchive']){c=await mutate(name,{id:c.id,...(name==='clientEdit'?{name:'Edited'}:{})},'client',selection);check(c);}
 const source=await mutate('clientCreate',{name:'Merge source'},'client');check(await mutate('clientMerge',{sourceId:source.id,targetId:c.id},'client',selection));
});

test('Astra 17: scheduled interface fragments project every supported concrete type',async t=>{
 const {mutate,gql,r}=await fixture(t),clientId=r.list('clients')[0].id;
 const request=await mutate('requestCreate',{clientId,title:'Assessment'},'request');await mutate('requestScheduleAssessment',{id:request.id,startAt:'2026-11-02T10:00:00Z',endAt:'2026-11-02T11:00:00Z'},'request');
 const job=await mutate('jobCreate',{clientId,title:'Job'},'job');await mutate('visitCreate',{jobId:job.id},'visit');await mutate('taskCreate',{title:'Task'},'task');
 const result=await gql('{scheduledItems(first:1000){nodes{__typename ...Shared ... on ScheduledItem {id status}}}} fragment Shared on ScheduledItem {legacyId title isComplete startAt endAt instructions}');assert.equal(result.errors,undefined,JSON.stringify(result));
 for(const type of ['Visit','Assessment','Task']){const node=result.data.scheduledItems.nodes.find(n=>n.__typename===type);assert.ok(node);assert.ok(node.id);assert.ok(node.status);assert.equal(typeof node.isComplete,'boolean');assert.ok(Object.hasOwn(node,'instructions'));}
});

test('Astra 18: request assessment exposes complete validated fields',async t=>{
 const {mutate,gql,r,db}=await fixture(t),request=await mutate('requestCreate',{clientId:r.list('clients')[0].id,title:'Assessment',internalNotes:'Fallback instructions'},'request');await mutate('requestScheduleAssessment',{id:request.id,startAt:'2026-11-02T10:00:00Z',endAt:'2026-11-02T11:00:00Z'},'request');
 const query='query($id:ID!){request(id:$id){assessment{id legacyId title status isComplete startAt endAt instructions}}}';let result=await gql(query,{id:request.id});assert.equal(result.errors,undefined,JSON.stringify(result));assert.equal(result.data.request.assessment.legacyId,request.legacyId);assert.equal(result.data.request.assessment.status,'SCHEDULED');assert.equal(result.data.request.assessment.isComplete,false);assert.equal(result.data.request.assessment.instructions,'Fallback instructions');
 db.prepare("UPDATE appointments SET status='completed' WHERE entity_type='assessment' AND entity_id=?").run(request.legacyId);result=await gql(query,{id:request.id});assert.equal(result.data.request.assessment.status,'COMPLETED');assert.equal(result.data.request.assessment.isComplete,true);
});

test('Astra 19: cleared and legacy null billing addresses remain queryable',async t=>{
 const {mutate,gql,r}=await fixture(t),c=await mutate('clientCreate',{name:'Address',billingAddress:{street1:'Main'}},'client');
 const cleared=await mutate('clientEdit',{id:c.id,billingAddress:null},'client','id billingAddress{street1 city}');assert.deepEqual(cleared.billingAddress,{street1:null,city:null});assert.equal(r.get('clients',c.legacyId).billing_address,null);
 for(const stored of ['null','42','true','"text"']){r.update('clients',c.legacyId,{billing_address:stored});const result=await gql(`{client(id:${c.legacyId}){billingAddress{street1}} clients(first:1000){nodes{id billingAddress{city}}}}`);assert.equal(result.errors,undefined,JSON.stringify(result));assert.equal(result.data.client.billingAddress.street1,null);}
});

test('Astra 20: credits return the credited invoice, not the credit row ID',async t=>{
 const {mutate,r}=await fixture(t),clientId=r.list('clients')[0].id;
 const invoice=await mutate('invoiceCreate',{clientId,subject:'Credit target',taxRate:0,lineItems:[{name:'Work',quantity:1,unitPrice:100}]},'invoice');await mutate('invoiceSend',{id:invoice.id},'invoice');
 const result=await mutate('invoiceCredit',{id:invoice.id,amount:5,reason:'Adjustment'},'invoice','id legacyId subject amounts{balanceDueCents}');
 const credit=r.list('invoice_credits',{invoice_id:invoice.legacyId})[0];assert.notEqual(credit.id,invoice.legacyId);assert.equal(result.id,invoice.id);assert.equal(result.subject,'Credit target');assert.equal(result.amounts.balanceDueCents,9500);assert.equal(result.amounts.balanceDueCents,r.get('invoices',invoice.legacyId).balance_due_cents);
});

test('Astra 21: write-only payloads succeed and selected entities require read before dispatch',async t=>{
 const {db,owner,r,gql,mutate}=await fixture(t),c=await mutate('clientCreate',{firstName:'Write',lastName:'Only'},'client'),p=await mutate('propertyCreate',{clientId:c.id,address:{street1:'Delete'}},'property');
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND action='read' AND resource='clients'").run(owner.role_id);
 for(const selection of ['userErrors{message}','__typename','client @skip(if:true){id} userErrors{message}','...Hidden']){const result=await gql(`mutation{clientEdit(input:{id:${c.legacyId},firstName:"Edited"}){${selection}}} fragment Hidden on ClientEditPayload {client @include(if:false){id} userErrors{message}}`);assert.equal(result.errors,undefined,JSON.stringify(result));assert.equal(r.get('clients',c.legacyId).display_name,'Edited Only');}
 const created=await gql('mutation{clientCreate(input:{name:"Write only"}){userErrors{message}}}');assert.equal(created.errors,undefined);assert.deepEqual(created.data.clientCreate.userErrors,[]);assert.ok(r.list('clients').some(c=>c.display_name==='Write only'));
 for(const selection of ['client{id}','alias:client{id}','...ReadClient']){const result=await gql(`mutation{clientEdit(input:{id:${c.legacyId},firstName:"Denied"}){${selection}}} fragment ReadClient on ClientEditPayload {client{id}}`);assert.match(result.errors[0].message,/Permission denied/);assert.equal(r.get('clients',c.legacyId).first_name,'Edited');}
 const before=r.list('clients').length;assert.ok((await gql('mutation{clientCreate(input:{name:"Denied"}){client{id}}}')).errors);assert.equal(r.list('clients').length,before);
 const deleted=await gql(`mutation{propertyDelete(input:{id:${p.legacyId}}){deletedId userErrors{message}}}`);assert.equal(deleted.errors,undefined);assert.deepEqual(deleted.data.propertyDelete,{deletedId:p.id,userErrors:[]});assert.throws(()=>r.get('properties',p.legacyId));
});

test('Astra 22: impossible and unknown fragments fail before any mutation',async t=>{
 const {gql,r}=await fixture(t),before=r.list('clients').length;
 for(const [selection,fragment] of [['... on Node{id}',''],['...Bad','fragment Bad on Node{id}'],['... on Missing{__typename}',''],['...Bad','fragment Bad on Missing{__typename}'],['client{... on Invoice{id}}',''],['client{...Bad}','fragment Bad on Invoice{id}'],['... on Query{__typename}',''],['... on PageInfo{__typename}','']]){const result=await gql(`mutation{first:clientCreate(input:{name:"No write"}){userErrors{message}} second:clientCreate(input:{name:"Invalid"}){${selection}}} ${fragment}`);assert.equal(result.data,null);assert.match(result.errors[0].message,/cannot spread|Unknown type/);assert.equal(r.list('clients').length,before);}
 const valid=await gql('{clients(first:1){nodes{... on Node{id}}} scheduledItems(first:1000){nodes{... on Node{id} ... on ScheduledItem{__typename}}}}');assert.equal(valid.errors,undefined,JSON.stringify(valid));assert.ok(valid.data.clients.nodes[0].id);
});

test('Astra 23: revoked, missing and expired sessions release refresh capacity',async t=>{
 const {db,owner,call,headers}=await fixture(t),auth=createAuth(db,{oauthClients:{app:{secret:'test-secret',userId:owner.id,organizationId:1}}}),credentials={grant_type:'client_credentials',client_id:'app',client_secret:'test-secret'};
 const revoked=auth.exchange(credentials);auth.revoke(revoked.access_token);assert.throws(()=>auth.exchange({...credentials,grant_type:'refresh_token',refresh_token:revoked.refresh_token}),/Invalid refresh/);
 const missing=auth.exchange(credentials);db.prepare('UPDATE sessions SET token=? WHERE token=?').run('missing-session',missing.access_token);assert.throws(()=>auth.exchange({...credentials,grant_type:'refresh_token',refresh_token:missing.refresh_token}),/Invalid refresh/);
 for(let i=0;i<10001;i++){const grant=auth.exchange(credentials);db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(0).toISOString(),grant.access_token);}assert.ok(auth.exchange(credentials).access_token);
 const code=(await call('/oauth/authorize?response_type=code&client_id=test-app',{headers})).body.code,issued=await call('/oauth/token',{method:'POST',data:{grant_type:'authorization_code',client_id:'test-app',code}});assert.equal(issued.status,200);
 assert.equal((await call('/api/auth/logout',{method:'POST',headers:{authorization:'Bearer '+issued.body.access_token},data:{}})).status,200);
 assert.equal((await call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:'test-app',refresh_token:issued.body.refresh_token}})).status,400);
});

test('Astra 25: search and filters cannot expose protected columns',async t=>{
 const {gql,r,db,owner}=await fixture(t),client=r.list('clients')[0];
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND action='write' AND resource='clients'").run(owner.role_id);
 for(const [field,secret] of [['clients',client.portal_token],['users',owner.password_hash]]){assert.ok(secret);for(const searchTerm of [secret,secret.slice(0,12)]){const result=await gql(`query($term:String!){${field}(searchTerm:$term){totalCount}}`,{term:searchTerm});assert.equal(result.errors,undefined);assert.equal(result.data[field].totalCount,0);}}
 for(const [field,keys] of [['clients',['portalToken','portal_token']],['users',['passwordHash','password_hash']]])for(const key of keys)for(const search of ['',',searchTerm:"no-matching-row-xyz"']){const result=await gql(`{${field}(filter:{${key}:"probe"}${search}){totalCount}}`);assert.match(result.errors[0].message,new RegExp(`Cannot filter on ${key}`));}
 const visible=await gql('query($term:String!){clients(searchTerm:$term){nodes{legacyId}}}',{term:client.display_name});assert.ok(visible.data.clients.nodes.some(x=>x.legacyId===client.id));
});

test('Astra 26: invalid lists and recursive variable types preserve stored values',async t=>{
 const {gql,mutate,r}=await fixture(t),c=await mutate('clientCreate',{name:'List validation',emails:[{address:'keep@example.test'}],phones:[{number:'555-1212'}]},'client');
 for(const [field,entry] of [['emails',{address:'ok'}],['phones',{number:'ok'}]]){
  for(const value of ['bad',{},null,[null],[{}],[42],[entry,{}]]){const result=await gql('mutation($input:Input!){clientEdit(input:$input){client{id} userErrors{message}}}',{input:{id:c.id,[field]:value}});assert.match(result.data.clientEdit.userErrors[0].message,new RegExp(`Invalid ${field}`));assert.equal(r.get('clients',c.legacyId).email,'keep@example.test');assert.equal(r.get('clients',c.legacyId).phone,'555-1212');}
 }
 const q=await mutate('quoteCreate',{clientId:c.id,title:'Keep lines',lineItems:[{name:'Keep',quantity:1,unitPrice:12}]},'quote'),before=r.list('quote_line_items',{quote_id:q.legacyId});
 for(const value of ['bad',{},null,[null],[[]],[42]]){const result=await gql('mutation($input:Input!){quoteEdit(input:$input){quote{id} userErrors{message}}}',{input:{id:q.id,lineItems:value}});assert.match(result.data.quoteEdit.userErrors[0].message,/Invalid lineItems/);assert.deepEqual(r.list('quote_line_items',{quote_id:q.legacyId}),before);}
 const count=r.list('clients').length;
 for(const [type,value] of [['[PhoneInput!]!','bad'],['[PhoneInput!]!',[null]],['[PhoneInput!]!',[42]],['[[Int!]!]!',[[1,null]]],['[[Int!]!]!',[1]],['Int',2147483648],['Float','bad'],['Boolean',1],['String',42],['ID',{}],['EncodableId',false],['Input',[]]]){const result=await gql(`mutation($v:${type}){clientCreate(input:{name:"Must not write"}){client{id}}}`,{v:value});assert.equal(result.data,null);assert.match(result.errors[0].message,/Variable \$v is required|Invalid variable \$v/);assert.equal(r.list('clients').length,count);}
 for(const [type,value] of [['[[Int!]!]!',[[1,2],[]]],['Float',1.5],['ID',1],['EncodableId','1'],['Input',{}],['[PhoneInput]',null]])assert.equal((await gql(`query($v:${type}){account{id}}`,{v:value})).errors,undefined);
 const typed=await gql('mutation($id:ID!,$phones:[PhoneInput!]!){clientEdit(input:{id:$id,phones:$phones}){userErrors{message}}}',{id:c.id,phones:{number:'bad'}});assert.equal(typed.data,null);assert.equal(r.get('clients',c.legacyId).phone,'555-1212');
 await mutate('clientEdit',{id:c.id,emails:[],phones:[]},'client');assert.equal(r.get('clients',c.legacyId).email,'');assert.equal(r.get('clients',c.legacyId).phone,'');assert.deepEqual(normalizeInput({lineItems:[]}).items,[]);
});

test('Astra 27: natural access expiry permits refresh but invalidated grants stay rejected',async t=>{
 const {db,owner,call}=await fixture(t),auth=createAuth(db,{oauthClients:{app:{secret:'test-secret',userId:owner.id,organizationId:1}}}),credentials={grant_type:'client_credentials',client_id:'app',client_secret:'test-secret'},renew=grant=>auth.exchange({...credentials,grant_type:'refresh_token',refresh_token:grant.refresh_token});
 const expired=auth.exchange(credentials);db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(Date.now()-1000).toISOString(),expired.access_token);
 assert.equal((await call('/api/auth/me',{headers:{authorization:'Bearer '+expired.access_token}})).status,401);const rotated=renew(expired);assert.ok(rotated.access_token);assert.throws(()=>renew(expired),/Invalid refresh/);assert.equal((await call('/api/auth/me',{headers:{authorization:'Bearer '+rotated.access_token}})).status,200);
 for(const state of ['revoked','missing','disabled']){const grant=auth.exchange(credentials),session=db.prepare('SELECT expires_at FROM sessions WHERE token=?').get(grant.access_token);
  if(state==='revoked')db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(0).toISOString(),grant.access_token);
  if(state==='missing')db.prepare('UPDATE sessions SET token=? WHERE token=?').run('missing-astra27',grant.access_token);
  if(state==='disabled')db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(owner.id);
  assert.throws(()=>renew(grant),/Invalid refresh/);
  if(state==='disabled')db.prepare('UPDATE users SET is_active=1 WHERE id=?').run(owner.id);
  if(state==='missing')db.prepare('UPDATE sessions SET token=? WHERE token=?').run(grant.access_token,'missing-astra27');
  if(state==='revoked')db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(session.expires_at,grant.access_token);
  assert.throws(()=>renew(grant),/Invalid refresh/);
 }
 const old=auth.exchange(credentials),now=Date.now;t.after(()=>{Date.now=now;});Date.now=()=>now()+31*86400000;try{assert.throws(()=>renew(old),/Invalid refresh/);}finally{Date.now=now;}
});

test('Astra 28: capacity prunes disabled users without discarding naturally expired grants',async t=>{
 const {db,r,owner}=await fixture(t),other=r.list('users').find(u=>u.id!==owner.id&&u.is_active),auth=createAuth(db,{oauthClients:{app:{secret:'test-secret',userId:owner.id,organizationId:1},other:{secret:'test-secret',userId:other.id,organizationId:1}}}),credentials={grant_type:'client_credentials',client_id:'app',client_secret:'test-secret'};
 let first;for(let i=0;i<10000;i++){const grant=auth.exchange(credentials);first??=grant;}
 db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(new Date(Date.now()-1000).toISOString(),owner.id);
 assert.throws(()=>auth.exchange({...credentials,client_id:'other'}),/Too many pending/);
 const renewed=auth.exchange({...credentials,grant_type:'refresh_token',refresh_token:first.refresh_token});assert.ok(renewed.access_token);
 db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(owner.id);assert.ok(auth.exchange({...credentials,client_id:'other'}).access_token);
 db.prepare('UPDATE users SET is_active=1 WHERE id=?').run(owner.id);assert.throws(()=>auth.exchange({...credentials,grant_type:'refresh_token',refresh_token:renewed.refresh_token}),/Invalid refresh/);
});

test('Astra 29: relationship IDs enforce their entity types before writes',async t=>{
 for(const key of ['assignedUserId','completedByUserId','uploadedByUserId','actorUserId','serviceId']){const type=key==='serviceId'?'ProductOrService':'User';assert.throws(()=>normalizeInput({[key]:encodeGid('Client',1)}),new RegExp(`Invalid Global ID for ${type}`));assert.deepEqual(Object.values(normalizeInput({[key]:encodeGid(type,1)})),[1]);}
 const {gql,r,owner,mutate}=await fixture(t),before=r.list('tasks').length,result=await gql('mutation($input:Input!){taskCreate(input:$input){task{id} userErrors{message}}}',{input:{title:'Wrong entity',assignedUserId:encodeGid('Client',owner.id)}});assert.match(result.data.taskCreate.userErrors[0].message,/Invalid Global ID for User/);assert.equal(r.list('tasks').length,before);
 const task=await mutate('taskCreate',{title:'Right entity',assignedUserId:encodeGid('User',owner.id)},'task','id assignedUser{id}');assert.equal(task.assignedUser.id,encodeGid('User',owner.id));
});

test('Astra 30: prototype-named aliases survive mutation and nested JSON projection',async t=>{
 const {gql,r}=await fixture(t),before=r.list('clients').length,result=await gql('mutation{__proto__:clientCreate(input:{name:"Prototype alias"}){__proto__:client{__proto__:id name} userErrors{message}}}');
 assert.equal(result.errors,undefined);assert.ok(Object.hasOwn(result.data,'__proto__'));const payload=result.data.__proto__;assert.deepEqual(payload.userErrors,[]);assert.ok(Object.hasOwn(payload,'__proto__'));assert.ok(Object.hasOwn(payload.__proto__,'__proto__'));assert.equal(payload.__proto__.name,'Prototype alias');assert.equal(r.get('clients',decodeGid(payload.__proto__.__proto__,'Client')).display_name,'Prototype alias');assert.equal(r.list('clients').length,before+1);
 const query=await gql('{__proto__:clients(first:1){nodes{__proto__:id}}}');assert.equal(query.errors,undefined);assert.ok(Object.hasOwn(query.data,'__proto__'));assert.ok(Object.hasOwn(query.data.__proto__.nodes[0],'__proto__'));
});

test('Astra 24: equivalent argument and input key ordering merges without false conflicts',async t=>{
 const {gql,r}=await fixture(t);
 const result=await gql('{clients(first:1,filter:{status:{eq:"active",in:["active","lead"]}}){nodes{id}} clients(filter:{status:{in:["active","lead"],eq:"active"}},first:1){nodes{name}}}');assert.equal(result.errors,undefined,JSON.stringify(result));assert.ok(result.data.clients.nodes[0].id);assert.ok(result.data.clients.nodes[0].name);
 const before=r.list('clients').length,created=await gql('mutation($input:Input!){clientCreate(input:$input){client{id}} clientCreate(input:{billingAddress:{city:"Austin",street1:"Main"},name:"Canonical"}){client{name} userErrors{message}}}',{input:{name:'Canonical',billingAddress:{street1:'Main',city:'Austin'}}});assert.equal(created.errors,undefined,JSON.stringify(created));assert.deepEqual(created.data.clientCreate.userErrors,[]);assert.equal(r.list('clients').length,before+1);assert.ok(created.data.clientCreate.client.id);assert.equal(created.data.clientCreate.client.name,'Canonical');
 const conflict=await gql('{clients(filter:{status:{in:["active","lead"]}}){nodes{id}} clients(filter:{status:{in:["lead","active"]}}){nodes{id}}}');assert.equal(conflict.data,null);assert.match(conflict.errors[0].message,/Conflicting fields/);
});

test('Astra 31: validation memoizes shared inputs and bounds abstract conflict traversal',async t=>{
 const {db,owner,gql,r}=await fixture(t);let reads=0;const shared={get probe(){reads++;return 'x'.repeat(100000);}},input={a:shared,b:[shared]};
 const result=await executeGraphQL({db,user:owner,authorize:()=>{},query:`query($input:Input!){${'currentUser(extra:$input){id} '.repeat(100)}}`,variables:{input}});
 assert.equal(result.errors,undefined,JSON.stringify(result));assert.ok(reads<=1);
 const before=r.list('clients').length,wide=Array.from({length:1600},(_,i)=>`a${i}:id`).join(' ');
 const bounded=await gql(`{node(id:1){${wide}}}`);
 assert.equal(bounded.data,null);assert.match(bounded.errors[0].message,/Query cost exceeded/);assert.equal(bounded.extensions.cost.actualQueryCost,0);assert.equal(r.list('clients').length,before);
 const reused=await gql('{clients(first:1){nodes{...Bits ...Bits}}} fragment Bits on Client {id properties{nodes{id}}}');assert.equal(reused.errors,undefined);
});

test('Astra 32: entity ID aliases reject wrong types before refund dispatch',async t=>{
 for(const [key,type] of Object.entries({accountId:'Account',paymentRecordId:'PaymentRecord',expenseId:'Expense',timeSheetEntryId:'TimeSheetEntry',timeEntryId:'TimeSheetEntry',taskId:'Task',productOrServiceId:'ProductOrService'})){assert.throws(()=>normalizeInput({[key]:encodeGid('Client',1)},type),new RegExp(`Invalid Global ID for ${type}`));assert.equal(Object.values(normalizeInput({[key]:encodeGid(type,1)},type))[0],1);}
 const {gql,r}=await fixture(t),before=r.list('payments');const result=await gql('mutation($input:Input!){paymentRefund(input:$input){userErrors{message}}}',{input:{paymentRecordId:encodeGid('Client',before[0]?.id||1),amount:1}});assert.match(result.data.paymentRefund.userErrors[0].message,/Invalid Global ID for PaymentRecord/);assert.deepEqual(r.list('payments'),before);
});

test('Astra 33: returned line-item IDs round trip with concrete type protection',async t=>{
 const {mutate,r,gql}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const type of ['Quote','Invoice','Job']){const expected=type+'LineItem';for(const compatible of [expected,'LineItem',...(type==='Job'?['QuoteLineItem']:[])])assert.equal(normalizeInput({lineItems:[{id:encodeGid(compatible,1)}]},type).items[0].id,1);for(const wrong of ['Client',...(type==='Invoice'?['QuoteLineItem']:['InvoiceLineItem'])])assert.throws(()=>normalizeInput({lineItems:[{id:encodeGid(wrong,1)}]},type),new RegExp(`Invalid Global ID for ${expected}`));}
 for(const type of ['quote','invoice']){const doc=await mutate(type+'Create',{clientId,...(type==='quote'?{title:'Round trip'}:{subject:'Round trip'}),lineItems:[{name:'Original',quantity:1,unitPrice:10}]},type,'id lineItems{nodes{id name quantity unitPrice}}');const lines=doc.lineItems.nodes.map(l=>({...l,name:'Edited'}));const edited=await mutate(type+'Edit',{id:doc.id,lineItems:lines},type,'id lineItems{nodes{name}}');assert.equal(edited.lineItems.nodes[0].name,'Edited');}
 const q=await mutate('quoteCreate',{clientId,title:'Backed',lineItems:[{name:'Line',quantity:1,unitPrice:10}]},'quote');await mutate('quoteSend',{id:q.id},'quote');await mutate('quoteApprove',{id:q.id},'quote');const job=await mutate('quoteConvertToJob',{id:q.id},'job');const result=await gql('query($id:ID!){job(id:$id){lineItems{nodes{id}}}}',{id:job.id});assert.equal(result.errors,undefined);assert.ok(normalizeInput({lineItems:result.data.job.lineItems.nodes},'Job').items[0].id);
});

test('Astra 34: refresh follows the linked session user and workspace',async t=>{
 const {db,r,owner,headers}=await fixture(t),auth=createAuth(db),issue=()=>auth.exchange({grant_type:'authorization_code',client_id:'test',code:auth.authorize({headers},{response_type:'code',client_id:'test'}).code}),renew=g=>auth.exchange({grant_type:'refresh_token',client_id:'test',refresh_token:g.refresh_token});
 const other=r.list('users').find(u=>u.id!==owner.id&&u.is_active),org={id:Number(db.prepare('INSERT INTO organizations(name,slug) VALUES(?,?)').run('Refresh workspace','refresh-workspace').lastInsertRowid)},role=repository(db,org.id).insert('roles',{name:'Owner',slug:'owner'}),remote=repository(db,org.id).insert('users',{name:'Remote',email:'refresh@example.test',role_id:role.id,password_hash:owner.password_hash,is_active:1});
 for(const target of [other,remote]){const grant=issue();db.prepare('UPDATE sessions SET user_id=?,organization_id=? WHERE token=?').run(target.id,target.organization_id,grant.access_token);const rotated=renew(grant),session=db.prepare('SELECT user_id,organization_id FROM sessions WHERE token=?').get(rotated.access_token);assert.equal(session.user_id,target.id);assert.equal(session.organization_id,target.organization_id);assert.throws(()=>renew(grant),/Invalid refresh/);}
 const invalid=issue();db.prepare('UPDATE sessions SET user_id=?,organization_id=? WHERE token=?').run(remote.id,org.id,invalid.access_token);db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(remote.id);assert.throws(()=>renew(invalid),/Invalid refresh/);db.prepare('UPDATE users SET is_active=1 WHERE id=?').run(remote.id);assert.throws(()=>renew(invalid),/Invalid refresh/);
});

test('Astra 35: task timestamps persist and project through scheduled items',async t=>{
 const {mutate,gql,r}=await fixture(t),startAt='2026-11-03T09:15:00Z',endAt='2026-11-03T10:45:00Z',task=await mutate('taskCreate',{title:'Timed task',startAt,endAt},'task','id legacyId startAt endAt');assert.equal(task.startAt,startAt);assert.equal(task.endAt,endAt);const row=r.get('tasks',task.legacyId);assert.equal(row.due_date,'2026-11-03');assert.equal(row.start_time,'09:15');assert.equal(row.end_time,'10:45');
 const result=await gql('{scheduledItems(first:1000){nodes{id startAt endAt}}}');assert.equal(result.errors,undefined);assert.deepEqual(result.data.scheduledItems.nodes.find(n=>n.id===task.id),{id:task.id,startAt,endAt});
 const dateOnly=await mutate('taskCreate',{title:'Date only',dueDate:'2026-11-04'},'task','startAt endAt');assert.deepEqual(dateOnly,{startAt:'2026-11-04T00:00:00Z',endAt:null});
 assert.deepEqual(normalizeInput({endAt,dueDate:'2026-11-05',endTime:'12:00'},'Task'),{due_date:'2026-11-05',end_time:'12:00'});assert.equal(normalizeInput({endAt},'Task').due_date,'2026-11-03');
});

test('Astra 36: assessment scheduling persists instructions consistently',async t=>{
 const {mutate,gql,r}=await fixture(t),request=await mutate('requestCreate',{clientId:r.list('clients')[0].id,title:'Instructions',internalNotes:'Fallback'},'request');
 for(const input of [{instructions:'Saved instructions'},{},{assessmentInstructions:'Alias instructions'}]){const saved=await mutate('requestScheduleAssessment',{id:request.id,startAt:'2026-11-05T10:00:00Z',endAt:'2026-11-05T11:00:00Z',...input},'request','assessment{instructions}');const expected=input.assessmentInstructions||'Saved instructions';assert.equal(saved.assessment.instructions,expected);assert.equal(r.get('requests',request.legacyId).assessment_instructions,expected);const result=await gql('{scheduledItems(first:1000){nodes{id instructions}}}');assert.equal(result.errors,undefined);assert.equal(result.data.scheduledItems.nodes.find(n=>n.id===encodeGid('Assessment',request.legacyId)).instructions,expected);}
});

test('Astra 37: phone and nested introspection expose all declared fields',async t=>{
 const {gql,owner}=await fixture(t),fields='kind name description specifiedByURL isOneOf fields{name} interfaces{name} possibleTypes{name} enumValues{name} inputFields{name} ofType{name}',result=await gql(`{currentUser{phone{id raw number primary smsAllowed}} __schema{description queryType{${fields}} types{description specifiedByURL isOneOf fields{type{${fields}}} interfaces{${fields}} possibleTypes{${fields}}}} __type(name:"Client"){${fields}}}`);
 assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.currentUser.phone,{id:encodeGid('PhoneNumber','user:'+owner.id),raw:owner.phone||'',number:owner.phone||'',primary:true,smsAllowed:true});assert.equal(result.data.__schema.description,null);assert.equal(result.data.__type.specifiedByURL,null);assert.equal(result.data.__type.isOneOf,false);
});

test('Astra 38: login and cookie writes reject cross-site origins and unprotected forms',async t=>{
 const {call,login,owner,db}=await fixture(t),data={email:owner.email,password:'test-password-123'},before=db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
 for(const headers of [{origin:'https://attacker.test'},{origin:'null'},{origin:'not a URL'},{referer:'https://attacker.test/page'},{'sec-fetch-site':'same-site'},{'sec-fetch-site':'cross-site'}])for(const path of ['/api/auth/login','/api/auth/bootstrap']){const result=await call(path,{method:'POST',data,headers});assert.equal(result.status,403);assert.equal(result.body.error,'Invalid request origin');assert.equal(result.headers.get('set-cookie'),null);}
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,before);
 const headers={cookie:login.headers.get('set-cookie').split(';')[0]};headers['x-csrf-token']=(await call('/api/csrf',{headers})).body.csrfToken;
 assert.equal((await call('/api/graphql',{method:'POST',data:{query:'{account{id}}'},headers:{...headers,origin:'https://attacker.test'}})).status,403);
 const auth=createAuth(db),req={method:'POST',headers:{host:'localhost:8080',origin:'http://localhost:8080',referer:'http://localhost:8080/login','sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'}};
 assert.throws(()=>auth.verifyOrigin(req),/Invalid CSRF token/);req.headers['x-xsrf-token']=auth.csrf(null);assert.doesNotThrow(()=>auth.verifyOrigin(req));req.headers.referer='http://localhost:8081';assert.throws(()=>auth.verifyOrigin(req),/Invalid request origin/);
 assert.equal((await call('/api/auth/login',{method:'POST',data,headers:{'content-type':'application/x-www-form-urlencoded'}})).status,403);
 assert.equal((await call('/api/auth/login',{method:'POST',data,headers:{'sec-fetch-site':'none'}})).status,200);
});

test('Astra 39: task timestamps retain seconds offsets and overnight dates',async t=>{
 const {mutate,gql,r}=await fixture(t);
 for(const [startAt,endAt] of [['2026-11-03T09:15:37.125Z','2026-11-03T10:45:42Z'],['2026-11-03T09:15:00+05:30','2026-11-03T10:45:00+05:30'],['2026-11-03T23:15:00Z','2026-11-04T00:45:00Z']]){
  const task=await mutate('taskCreate',{title:'Precise task',startAt,endAt},'task','id legacyId startAt endAt');assert.equal(task.startAt,startAt);assert.equal(task.endAt,endAt);
  const result=await gql('{scheduledItems(first:1000){nodes{id startAt endAt}}}');assert.equal(result.errors,undefined);assert.deepEqual(result.data.scheduledItems.nodes.find(n=>n.id===task.id),{id:task.id,startAt,endAt});
  assert.equal(r.get('tasks',task.legacyId).end_time,endAt);
 }
 const task=await mutate('taskCreate',{title:'Seconds time',dueDate:'2026-11-03',startTime:'09:15:37',endTime:'10:45:42.125'},'task','startAt endAt');assert.deepEqual(task,{startAt:'2026-11-03T09:15:37Z',endAt:'2026-11-03T10:45:42.125Z'});
});

test('Astra 40: client flags are order independent and preserve unrelated status',async t=>{
 const {mutate,gql}=await fixture(t);
 for(const input of [{isLead:true,isArchived:false},{isArchived:false,isLead:true},{is_lead:true,is_archived:false},{is_archived:false,is_lead:true}])assert.equal((await mutate('clientCreate',{name:'Lead',...input},'client','status')).status,'LEAD');
 for(const input of [{isLead:true,isArchived:true},{isArchived:true,isLead:true}]){const result=await gql('mutation($input:Input!){clientCreate(input:$input){client{id} userErrors{message}}}',{input:{name:'Conflict',...input}});assert.match(result.data.clientCreate.userErrors[0].message,/both lead and archived/);}
 for(const status of ['lead','archived']){const client=await mutate('clientCreate',{name:'Existing',status},'client');const flags=status==='lead'?{isArchived:false}:{isLead:false};assert.equal((await mutate('clientEdit',{id:client.id,...flags},'client','status')).status,status.toUpperCase());}
 for(const input of [{status:'ARCHIVED',isLead:true},{isLead:true,status:'ARCHIVED'}])assert.equal(normalizeInput(input,'Client').status,'archived');
 assert.equal(normalizeInput({isLead:false,isArchived:false},'Client',{status:'archived'}).status,'active');
});

test('Astra 41: document numbers retain custom strings numeric inputs and ID fallback',async t=>{
 const {mutate,gql,r}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const [type,field,table] of [['Quote','quoteNumber','quotes'],['Invoice','invoiceNumber','invoices'],['Job','jobNumber','jobs']]){
  const single=type.toLowerCase();
  for(const number of ['CUSTOM-0042',4207]){const doc=await mutate(single+'Create',{clientId,[type==='Invoice'?'subject':'title']:'Numbered',[field]:number},single,`id legacyId ${field}`);assert.equal(doc[field],String(number));assert.equal(r.get(table,doc.legacyId)[field.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())],String(number));}
  const doc=await mutate(single+'Create',{clientId,[type==='Invoice'?'subject':'title']:'Fallback'},single,`id legacyId ${field}`);const result=await gql(`{${single}(id:"${doc.id}"){${field}}}`);assert.equal(result.data[single][field],String(doc.legacyId));
 }
 assert.equal(normalizeInput({requestNumber:123},'Request').request_number,'123');
});

test('Astra 42: connections charge scans map lazily and cache selected user roles',async t=>{
 const {db,r,owner}=await fixture(t);for(let i=0;i<30;i++)r.insert('users',{name:'Cost user '+i,email:`cost${i}@example.test`,password_hash:owner.password_hash,role_id:owner.role_id});let roleReads=0,requestReads=0;
 const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT .* FROM roles\b/i.test(sql))roleReads++;if(/SELECT .* FROM requests\b/i.test(sql))requestReads++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const run=query=>executeGraphQL({db:measured,user:owner,query,authorize(){},dispatch(){throw new Error('Unexpected mutation');}});
 const count=r.list('users').length,counts=await run('{users{totalCount pageInfo{hasNextPage}}}');assert.equal(counts.errors,undefined);assert.equal(roleReads,0);assert.ok(counts.extensions.cost.actualQueryCost>=count);
 const nodes=await run('{users(first:2){nodes{id}}}'),both=await run('{users(first:2){nodes{id} edges{node{id}}}}');assert.equal(nodes.errors,undefined);assert.equal(both.errors,undefined);assert.equal(roleReads,0);assert.deepEqual(both.data.users.nodes,both.data.users.edges.map(e=>e.node));assert.equal(both.extensions.cost.actualQueryCost-nodes.extensions.cost.actualQueryCost,1+2*Math.min(2,count));
 const roles=await run('{users(first:1000){nodes{isAdmin isAccountOwner} edges{node{isAdmin}}}}');assert.equal(roles.errors,undefined);assert.equal(roleReads,new Set(r.list('users').map(u=>u.role_id)).size);
 const scheduled=await run('{scheduledItems{totalCount pageInfo{endCursor}}}');assert.equal(scheduled.errors,undefined);assert.equal(requestReads,0);
 const scans=await run('{'+Array.from({length:Math.ceil(20001/count)},(_,i)=>`u${i}:users{totalCount}`).join(' ')+'}');assert.match(scans.errors[0].message,/Execution cost exceeded/);assert.equal(scans.extensions.cost.actualQueryCost,20001);
});

test('Astra 43: scheduled assessment notes require lazy Request read authorization',async t=>{
 const {db,owner,mutate,r}=await fixture(t),request=await mutate('requestCreate',{clientId:r.list('clients')[0].id,title:'Private assessment',internalNotes:'Private fallback'},'request');
 await mutate('requestScheduleAssessment',{id:request.id,startAt:'2026-11-05T10:00:00Z',endAt:'2026-11-05T11:00:00Z',instructions:'Private instructions'},'request');let requestReads=0;
 const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT .* FROM requests\b/i.test(sql))requestReads++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const run=(fields,deny=true)=>executeGraphQL({db:measured,user:owner,query:`{scheduledItems(first:1000){nodes{id ... on Assessment{${fields}}}}}`,authorize(db,user,resource){if(deny&&resource==='requests')throw Object.assign(new Error('Permission denied'),{status:403});}}),id=encodeGid('Assessment',request.legacyId);
 const publicResult=await run('legacyId title status isComplete startAt endAt');assert.equal(publicResult.errors,undefined);assert.ok(publicResult.data.scheduledItems.nodes.find(n=>n.id===id).startAt);assert.equal(requestReads,0);
 const denied=await run('instructions');assert.equal(denied.data.scheduledItems.nodes.find(n=>n.id===id).instructions,null);assert.ok(denied.errors.some(e=>/Permission denied/.test(e.message)));assert.equal(requestReads,0);
 const allowed=await run('instructions',false);assert.equal(allowed.errors,undefined);assert.equal(allowed.data.scheduledItems.nodes.find(n=>n.id===id).instructions,'Private instructions');
 db.prepare('UPDATE requests SET assessment_instructions=NULL WHERE id=?').run(request.legacyId);assert.equal((await run('instructions',false)).data.scheduledItems.nodes.find(n=>n.id===id).instructions,'Private fallback');
});

test('Astra 44: assignments load only assigned IDs and charge their lookup costs',async t=>{
 const {db,owner,mutate,r}=await fixture(t),clientId=r.list('clients')[0].id,request=await mutate('requestCreate',{clientId,title:'Assigned assessment'},'request');
 await mutate('requestScheduleAssessment',{id:request.id,startAt:'2026-11-05T10:00:00Z',endAt:'2026-11-05T11:00:00Z'},'request');
 const job=await mutate('jobCreate',{clientId,title:'Assigned job'},'job'),visit=await mutate('visitCreate',{jobId:job.id},'visit'),ids=JSON.stringify([owner.id,String(owner.id),999999]);
 db.prepare('UPDATE visits SET assigned_user_ids_json=? WHERE id=?').run(ids,visit.legacyId);db.prepare("UPDATE appointments SET assigned_user_ids_json=? WHERE entity_type='assessment' AND entity_id=?").run(ids,request.legacyId);
 const userSql=[],measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT .* FROM users\b/i.test(sql))userSql.push(sql);return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}),run=query=>executeGraphQL({db:measured,user:owner,query,authorize(){}});
 const queries=[`{request(id:"${request.id}"){assessment{assignedUsers{totalCount nodes{legacyId}}}}}`,`{visit(id:"${visit.id}"){assignedUsers{totalCount nodes{legacyId}}}}`,'{scheduledItems(first:1000){nodes{... on Assessment{assignedUsers{totalCount nodes{legacyId}}}}}}'];
 const before=[];for(const query of queries){userSql.length=0;const result=await run(query);assert.equal(result.errors,undefined,JSON.stringify(result));assert.ok(userSql.length>=2);assert.ok(userSql.every(sql=>/\bid\s*(?:=|IS)\s*\?/i.test(sql)));assert.ok(JSON.stringify(result.data).includes(`"legacyId":${owner.id}`));before.push(result.extensions.cost.actualQueryCost);}
 for(let i=0;i<40;i++)r.insert('users',{name:'Unassigned '+i,email:`unassigned${i}@example.test`,password_hash:owner.password_hash,role_id:owner.role_id});
 for(const [i,query] of queries.entries())assert.equal((await run(query)).extensions.cost.actualQueryCost,before[i]);
 const count=r.list('users').length,full=await run('{users(first:0){totalCount}}');assert.equal(full.errors,undefined);assert.ok(full.extensions.cost.actualQueryCost>=count);
 db.prepare('UPDATE visits SET assigned_user_ids_json=? WHERE id=?').run(JSON.stringify([owner.id]),visit.legacyId);assert.equal((await run(queries[1])).extensions.cost.actualQueryCost,before[1]-3);
 const denied=await executeGraphQL({db,user:owner,query:queries[1],authorize(db,user,resource){if(resource==='team')throw Object.assign(new Error('Permission denied'),{status:403});}});assert.equal(denied.data.visit.assignedUsers,null);assert.match(denied.errors[0].message,/Permission denied/);
});

test('Astra 45: null task and visit timestamps stay null without corrupting dates',async t=>{
 const {mutate,r}=await fixture(t);
 assert.deepEqual(normalizeInput({startAt:null,endAt:null},'Task'),{due_date:null,start_time:null,end_time:null});assert.deepEqual(normalizeInput({endAt:null},'Task'),{end_time:null});
 assert.deepEqual(normalizeInput({startAt:null,endAt:null,dueDate:'2026-11-05',startTime:'09:00',endTime:'10:00'},'Task'),{due_date:'2026-11-05',start_time:'09:00',end_time:'10:00'});
 assert.deepEqual(normalizeInput({startAt:null,endAt:null},'Visit'),{scheduled_start:null,scheduled_end:null});assert.deepEqual(normalizeInput({},'Task'),{});assert.deepEqual(normalizeInput({},'Visit'),{});
 for(const input of [{startAt:null,endAt:null},{startAt:null},{endAt:null}]){const task=await mutate('taskCreate',{title:'Null timestamps',...input},'task','legacyId startAt endAt'),row=r.get('tasks',task.legacyId);assert.equal(task.startAt,null);assert.equal(task.endAt,null);assert.equal(row.due_date,null);assert.equal(row.start_time,null);assert.equal(row.end_time,null);}
 const job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Null visit'},'job'),visit=await mutate('visitCreate',{jobId:job.id,startAt:null,endAt:null},'visit','legacyId startAt endAt'),row=r.get('visits',visit.legacyId);assert.equal(visit.startAt,null);assert.equal(visit.endAt,null);assert.equal(row.scheduled_start,null);assert.equal(row.scheduled_end,null);
});

test('Astra 46: user and client phone identities have distinct stable namespaces',async t=>{
 const {gql,r,owner,db}=await fixture(t);assert.ok(r.get('clients',owner.id));db.prepare('UPDATE clients SET phone=? WHERE id=?').run('555-0100',owner.id);
 const query=`{currentUser{phone{id}} client(id:${owner.id}){phones{id number raw primary smsAllowed}}}`,result=await gql(query);assert.equal(result.errors,undefined);const userId=result.data.currentUser.phone.id,phone=result.data.client.phones[0];assert.equal(userId,encodeGid('PhoneNumber','user:'+owner.id));assert.equal(phone.id,encodeGid('PhoneNumber','client:'+owner.id));assert.notEqual(userId,phone.id);assert.equal(phone.number,'555-0100');assert.equal(phone.raw,phone.number);assert.equal(phone.primary,true);assert.deepEqual((await gql(query)).data,result.data);
});

test('Astra 47: shared large variables compare structurally without serialization',async t=>{
 const {db,owner}=await fixture(t);let reads=0;const v={};Object.defineProperty(v,'text',{enumerable:true,get(){reads++;return 'x'.repeat(900000);}});
 const result=await executeGraphQL({db,user:owner,query:'query($v:Input!){'+Array.from({length:100},()=> 'account(extra:{nested:[$v]}){id}').join(' ')+'}',variables:{v},authorize:()=>{},dispatch:()=>{throw new Error('Unexpected dispatch');}});
 assert.equal(result.errors,undefined,JSON.stringify(result));assert.ok(result.data.account.id);assert.equal(reads,0,'Shared variable contents must not be serialized or traversed');
 const conflict=await executeGraphQL({db,user:owner,query:'{account(extra:{a:[1,2]}){id} account(extra:{a:[1,3]}){id}}',authorize:()=>{}});assert.match(conflict.errors[0].message,/Conflicting fields/);
});

test('Astra 48: list element depth is rejected before payment dispatch',async t=>{
 const {gql,r}=await fixture(t),client=r.list('clients')[0],before=r.list('payments').length;
 const nested='invoices{nodes{paymentRecords{nodes{client{'.repeat(5)+'emails{address}'+'}}}}}'.repeat(5);
 const result=await gql(`mutation($input:Input!){paymentRecordCreate(input:$input){paymentRecord{client{${nested}}} userErrors{message}}}`,{input:{clientId:client.id,amount:1,paymentMethod:'CASH'}});
 assert.equal(result.data,null);assert.match(result.errors[0].message,/Result depth exceeded/);assert.equal(r.list('payments').length,before);
});

test('Astra 49: job line items retain exact totals across create edit and reads',async t=>{
 const {mutate,gql,r,call,headers}=await fixture(t),client=r.list('clients')[0];
 const selection='id legacyId subtotal taxAmount total lineItems{nodes{name description quantity unitPriceCents totalCents taxable}}';
 const job=await mutate('jobCreate',{clientId:client.id,title:'Itemized job',taxRate:10,lineItems:[{name:'Labor',quantity:2,unitPrice:12.34,taxable:true},{name:'Parts',quantity:1,unitPrice:5}]},'job',selection);
 assert.equal(job.subtotal,29.68);assert.equal(job.taxAmount,2.47);assert.equal(job.total,32.15);assert.deepEqual(job.lineItems.nodes.map(l=>l.totalCents),[2468,500]);assert.equal(r.get('jobs',job.legacyId).total_cents,3215);
 const edited=await mutate('jobEdit',{id:job.id,lineItems:[{name:'Replacement',quantity:3,unitPrice:2}]},'job',selection);assert.equal(edited.total,6);assert.equal(edited.lineItems.nodes[0].name,'Replacement');
 const read=await gql('query($id:ID!){job(id:$id){lineItems{nodes{name totalCents}}}}',{id:job.id});assert.deepEqual(read.data.job.lineItems.nodes,[{name:'Replacement',totalCents:600}]);
 const rest=await call('/api/jobs/'+job.legacyId,{method:'PATCH',headers,data:{items:[{name:'REST item',unit_price_cents:250,quantity:2}]}});assert.equal(rest.status,200);assert.equal(rest.body.total_cents,500);
 const empty=await mutate('jobEdit',{id:job.id,lineItems:[]},'job',selection);assert.deepEqual(empty.lineItems.nodes,[]);assert.equal(empty.total,0);
});

test('Astra 50: timeEntryId stops a timer and paymentId refunds a payment',async t=>{
 const {mutate,r,owner}=await fixture(t);
 const timer=await mutate('timeSheetClockIn',{userId:owner.id},'timeSheetEntry');
 const stopped=await mutate('timeSheetClockOut',{timeEntryId:timer.id},'timeSheetEntry','id endAt');assert.equal(stopped.id,timer.id);assert.ok(stopped.endAt);
 const payment=await mutate('paymentRecordCreate',{clientId:r.list('clients')[0].id,amount:2,paymentMethod:'CASH'},'paymentRecord');
 const refunded=await mutate('paymentRefund',{paymentId:payment.id,amount:1},'paymentRecord','id refundedCents');assert.equal(refunded.refundedCents,100);
});

test('Astra 51: catalog target and relationship aliases normalize before storage',async t=>{
 const {mutate,r}=await fixture(t),client=r.list('clients')[0];
 const product=await mutate('productOrServiceCreate',{name:'Catalog source',defaultUnitCost:4},'productOrService');
 const edited=await mutate('productOrServiceEdit',{productOrServiceId:product.id,name:'Updated source'},'productOrService','id name');assert.equal(edited.name,'Updated source');
 for(const [type,field,table] of [['quote','quote','quote_line_items'],['invoice','invoice','invoice_line_items']]){
  const doc=await mutate(type+'Create',{clientId:client.id,title:'Catalog document',lineItems:[{productOrServiceId:product.id,name:'Catalog line',unitPrice:4},{serviceId:product.id,name:'Service alias',unitPrice:4}]},field);
  const rows=r.list(table,{[type+'_id']:doc.legacyId});assert.equal(rows.length,2);assert.ok(rows.every(l=>l.product_service_id===product.legacyId));
 }
 assert.deepEqual(normalizeInput({workRequestId:encodeGid('Request',1),workOrderId:encodeGid('Job',2)}),{request_id:1,job_id:2});
});

test('Astra 52: job line items persist in SQLite across database reopen',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'jobber-lines-')),dbPath=join(dir,'test.sqlite');let db=createDatabase(dbPath),server;
 t.after(async()=>{if(server)await server.close();db.close();rmSync(dir,{recursive:true,force:true});});seedDatabase(db);
 const owner=repository(db,1).list('users')[0],session='astra52-session';db.prepare('INSERT INTO sessions(token,user_id,organization_id,expires_at) VALUES(?,?,?,?)').run(session,owner.id,1,new Date(Date.now()+86400000).toISOString());
 server=await startServer({db,seed:false,port:0});
 const response=await fetch(server.url+'/api/graphql',{method:'POST',headers:{authorization:'Bearer '+session,'content-type':'application/json'},body:JSON.stringify({query:'mutation($input:Input!){jobCreate(input:$input){job{id totalCents lineItems{nodes{id legacyId name quantity unitPriceCents totalCents}}} userErrors{message}}}',variables:{input:{clientId:repository(db,1).list('clients')[0].id,title:'Persistent lines',lineItems:[{name:'Labor',unitPrice:12.34,quantity:2},{name:'Parts',unitPrice:5,quantity:1}]}}})});
 const created=await response.json();assert.equal(created.errors,undefined);assert.deepEqual(created.data.jobCreate.userErrors,[]);const job=created.data.jobCreate.job;assert.equal(job.totalCents,2968);assert.deepEqual(job.lineItems.nodes.map(l=>l.totalCents),[2468,500]);
 await server.close();server=null;db.close();db=createDatabase(dbPath);
 const read=await executeGraphQL({db,user:owner,authorize:()=>{},query:'query($id:ID!){job(id:$id){id totalCents lineItems{nodes{id legacyId name quantity unitPriceCents totalCents}}}}',variables:{id:job.id}});
 assert.equal(read.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(read.data.job)),job);
});

test('Astra 53: supplied job totals cannot override calculated line item totals',async t=>{
 const {gql,mutate,r}=await fixture(t),clientId=r.list('clients')[0].id,lineItems=[{name:'Actual line',unitPrice:100,quantity:1}],before=r.list('jobs').length;
 const attempt=async(name,input)=>{const result=await gql(`mutation($input:Input!){${name}(input:$input){job{id} userErrors{message}}}`,{input});assert.equal(result.errors,undefined);assert.ok(result.data[name].userErrors.length);assert.equal(result.data[name].job,null);};
 for(const totals of [{subtotalCents:0,totalCents:1},{total:0.01},{taxCents:1},{totalCents:-1},{totalCents:1.5},{totalCents:'10000'}]){await attempt('jobCreate',{clientId,title:'Invalid totals',lineItems,...totals});assert.equal(r.list('jobs').length,before);}
 const selection='id legacyId title totalCents lineItems{nodes{id name totalCents}}',job=await mutate('jobCreate',{clientId,title:'Matching totals',lineItems,subtotalCents:10000,taxCents:0,totalCents:10000},'job',selection),row=r.get('jobs',job.legacyId);
 for(const totals of [{subtotalCents:0,totalCents:1},{total:0.01}]){await attempt('jobEdit',{id:job.id,title:'Must not persist',lineItems,...totals});assert.deepEqual(r.get('jobs',job.legacyId),row);const read=await gql('query($id:ID!){job(id:$id){'+selection+'}}',{id:job.id});assert.deepEqual(read.data.job,job);}
 const edited=await mutate('jobEdit',{id:job.id,lineItems,subtotalCents:10000,taxCents:0,total:100},'job',selection);assert.equal(edited.totalCents,10000);
});

test('Astra 54: separate jobs receive distinct persistent JobLineItem global IDs',async t=>{
 const {mutate,gql,r,db,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,selection='id legacyId lineItems{nodes{id legacyId name totalCents}}',line={name:'Unique line',unitPrice:1,quantity:1};
 const fallback=await mutate('jobCreate',{clientId,title:'Fallback'},'job',selection),a=await mutate('jobCreate',{clientId,title:'Job A',lineItems:[line]},'job',selection),b=await mutate('jobCreate',{clientId,title:'Job B',lineItems:[line]},'job',selection);
 const ids=[fallback,a,b].map(j=>j.lineItems.nodes[0]);assert.equal(new Set(ids.map(l=>l.id)).size,3);assert.equal(new Set(ids.map(l=>l.legacyId)).size,3);
 const own=await mutate('jobEdit',{id:a.id,lineItems:[{...line,id:ids[1].id}]},'job',selection);assert.equal(own.lineItems.nodes[0].id,ids[1].id);
 const foreign=await mutate('jobEdit',{id:a.id,lineItems:[{...line,id:ids[2].id}]},'job',selection);assert.ok(!ids.some(l=>l.id===foreign.lineItems.nodes[0].id));assert.ok(!ids.some(l=>l.legacyId===foreign.lineItems.nodes[0].legacyId));
 const read=await gql('query($id:ID!){job(id:$id){'+selection+'}}',{id:b.id});assert.deepEqual(read.data.job,b);
 const duplicate=await mutate('jobEdit',{id:a.id,lineItems:[{...line,id:foreign.lineItems.nodes[0].id},{...line,id:foreign.lineItems.nodes[0].id}]},'job',selection);assert.equal(duplicate.lineItems.nodes[0].id,foreign.lineItems.nodes[0].id);assert.notEqual(duplicate.lineItems.nodes[0].id,duplicate.lineItems.nodes[1].id);
 assert.equal((await call('/api/jobs/'+a.legacyId,{method:'DELETE',headers})).status,200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM preferences WHERE organization_id=? AND name=?').get(1,`job_lines:${a.legacyId}`).n,0);
 const c=await mutate('jobCreate',{clientId,title:'After delete',lineItems:[line]},'job',selection);assert.ok(c.lineItems.nodes[0].legacyId>duplicate.lineItems.nodes[1].legacyId);
});

test('Astra 55: decimal dollar inputs round half-up to exact cents without float drift',async t=>{
 const {mutate,r}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const [value,expected] of [['1.005',101],[1.005,101],['16.075',1608],[16.075,1608]]){
  assert.equal(normalizeInput({unitPrice:value},'JobLineItem').unit_price_cents,expected);
  assert.equal(normalizeInput({discountType:'FIXED',discountValue:value},'Quote').discount_value,expected);
  assert.equal(normalizeInput({requiredDepositType:'FIXED',requiredDepositValue:value},'Quote').required_deposit_value,expected);
  const quote=await mutate('quoteCreate',{clientId,title:'Exact decimal',discountType:'FIXED',discountValue:value,requiredDepositType:'FIXED',requiredDepositValue:value,lineItems:[{name:'Decimal',unitPrice:value,quantity:1},{name:'Base',unitPrice:100,quantity:1}]},'quote','amounts{discountCents requiredDepositCents totalCents} lineItems{nodes{unitPriceCents}}');
  assert.equal(quote.lineItems.nodes[0].unitPriceCents,expected);assert.equal(quote.amounts.discountCents,expected);assert.equal(quote.amounts.requiredDepositCents,expected);assert.equal(quote.amounts.totalCents,10000);
 }
 for(const value of [-1,'-1',true,null,'',Infinity])assert.throws(()=>normalizeInput({unitPrice:value},'JobLineItem'),/Invalid monetary amount/);
});

test('Astra 56: membership filters precompute Sets and enforce execution budgets',async t=>{
 const {db,owner,r}=await fixture(t),query='query($filter:Input!){clients(filter:$filter){nodes{legacyId} totalCount}}',run=filter=>executeGraphQL({db,user:owner,query,variables:{filter},authorize(){}});
 const filter={status:{in:Array(25000).fill('active')}},start=performance.now(),result=await run(filter),elapsed=performance.now()-start;
 assert.match(result.errors[0].message,/Execution cost exceeded/);assert.equal(result.extensions.cost.actualQueryCost,20001);assert.ok(elapsed<100,`Filter budget took ${elapsed}ms`);
 for(const status of [{in:['ACTIVE']},['ACTIVE']]){const valid=await run({status});assert.equal(valid.errors,undefined);assert.equal(valid.data.clients.totalCount,r.list('clients').filter(c=>c.status==='active').length);assert.ok(valid.data.clients.nodes.length);assert.ok(valid.data.clients.nodes.every(c=>r.get('clients',c.legacyId).status==='active'));}
 for(const filter of [[],{status:{in:'active'}},{status:{ne:'active'}}])assert.ok((await run(filter)).errors);
});

test('Astra 57: partial job total edits cannot make persisted line items inconsistent',async t=>{
 const {mutate,gql,r,call,headers,db}=await fixture(t),job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Persisted totals',lineItems:[{name:'Labor',unitPrice:100,quantity:1,taxable:true}]},'job'),before=r.get('jobs',job.legacyId),lines=()=>db.prepare('SELECT value_json FROM preferences WHERE organization_id=? AND name=?').get(1,`job_lines:${job.legacyId}`).value_json,stored=lines();
 for(const totals of [{totalCents:1},{subtotalCents:0}]){
  const result=await gql('mutation($input:Input!){jobEdit(input:$input){job{id} userErrors{message}}}',{input:{id:job.id,...totals}});assert.equal(result.errors,undefined);assert.match(result.data.jobEdit.userErrors[0].message,/does not match persisted lineItems/);assert.equal(result.data.jobEdit.job,null);assert.deepEqual(r.get('jobs',job.legacyId),before);
  for(const method of ['PATCH','PUT']){const rest=await call('/api/jobs/'+job.legacyId,{method,headers,data:totals});assert.equal(rest.status,400);assert.deepEqual(r.get('jobs',job.legacyId),before);assert.equal(lines(),stored);}
 }
 await mutate('jobEdit',{id:job.id,title:'Renamed'},'job');assert.equal(r.get('jobs',job.legacyId).total_cents,10000);
 const taxed=await mutate('jobEdit',{id:job.id,taxRate:10},'job','totalCents subtotal taxAmount');assert.equal(taxed.totalCents,11000);assert.equal(taxed.subtotal,100);assert.equal(taxed.taxAmount,10);
 const renamed=await call('/api/jobs/'+job.legacyId,{method:'PATCH',headers,data:{title:'REST rename'}});assert.equal(renamed.status,200);assert.equal(renamed.body.total_cents,11000);
 const rest=await call('/api/jobs/'+job.legacyId,{method:'PUT',headers,data:{taxRate:10}});assert.equal(rest.status,200);assert.equal(rest.body.subtotal_cents,10000);assert.equal(rest.body.tax_cents,1000);assert.equal(rest.body.total_cents,11000);assert.equal(lines(),stored);
});

test('Astra 58: invoicing a job consumes persisted replacement job line items',async t=>{
 const {mutate,r}=await fixture(t),quote=await mutate('quoteCreate',{clientId:r.list('clients')[0].id,title:'Replacement invoice',lineItems:[{name:'Original quote line',unitPrice:100,quantity:1}]},'quote');
 await mutate('quoteSend',{id:quote.id},'quote');await mutate('quoteApprove',{id:quote.id},'quote');const job=await mutate('quoteConvertToJob',{id:quote.id},'job');
 await mutate('jobEdit',{id:job.id,lineItems:[{name:'Replacement job line',unitPrice:100,quantity:1}]},'job');await mutate('jobComplete',{id:job.id},'job');
 const invoice=await mutate('jobInvoice',{id:job.id},'invoice','amounts{totalCents} lineItems{nodes{name unitPriceCents}}');assert.deepEqual(invoice.lineItems.nodes,[{name:'Replacement job line',unitPriceCents:10000}]);assert.equal(invoice.amounts.totalCents,10000);
});

test('Astra 59: ID filters support eq and in operator objects with Global IDs and legacy IDs',async t=>{
 const {gql,mutate,r}=await fixture(t),client=r.list('clients')[0],job=await mutate('jobCreate',{clientId:client.id,title:'ID filter'},'job'),query='query($filter:Input!){jobs(first:1000,filter:$filter){nodes{legacyId client{legacyId}}}}';
 for(const clientId of [{eq:client.id},{eq:encodeGid('Client',client.id)},{in:[client.id,encodeGid('Client',client.id)]},[encodeGid('Client',client.id)],client.id]){const result=await gql(query,{filter:{clientId}});assert.equal(result.errors,undefined,JSON.stringify(result));assert.ok(result.data.jobs.nodes.some(j=>j.legacyId===job.legacyId));assert.ok(result.data.jobs.nodes.every(j=>j.client.legacyId===client.id));}
 const wrong=await gql(query,{filter:{clientId:{eq:encodeGid('Job',1)}}});assert.match(wrong.errors[0].message,/Invalid Global ID for Client/);
});

test('Astra 60: scientific-notation monetary strings convert without intermediate double rounding',()=>{
 for(const [value,expected] of [['1.0049999',100],['1.0049999e0',100],[1.0049999,100],['100.49999e-2',100],['1.005e0',101]]){
  assert.equal(normalizeInput({unitPrice:value},'JobLineItem').unit_price_cents,expected);
  assert.equal(normalizeInput({discountType:'FIXED',discountValue:value},'Quote').discount_value,expected);
  assert.equal(normalizeInput({requiredDepositType:'FIXED',requiredDepositValue:value},'Quote').required_deposit_value,expected);
 }
});

test('Astra 61: catalog categories preserve capitalization while timesheet categories normalize',async t=>{
 const {mutate,r,owner}=await fixture(t),category='HVAC & Air Conditioning',product=await mutate('productOrServiceCreate',{name:'Category case',category},'productOrService','id legacyId category');assert.equal(product.category,category);assert.equal(r.get('products_services',product.legacyId).category,category);
 const edited=await mutate('productOrServiceEdit',{id:product.id,category},'productOrService','category');assert.equal(edited.category,category);assert.equal(r.get('products_services',product.legacyId).category,category);
 const entry=await mutate('timeSheetEntryCreate',{userId:owner.id,label:'TRAVEL',startAt:'2026-11-05T10:00:00Z',endAt:'2026-11-05T11:00:00Z'},'timeSheetEntry','legacyId label');assert.equal(entry.label,'travel');assert.equal(r.get('time_entries',entry.legacyId).category,'travel');assert.equal(normalizeInput({category},'Expense').category,category);
});

test('Astra 62: partial job edits preserve stored calculation options and line arrays',async t=>{
 const {mutate,r,db,call,headers}=await fixture(t),job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Options',taxRate:10,discountType:'FIXED',discountValue:10,lineItems:[{name:'Labor',unitPrice:100,taxable:true}]},'job');
 const pref=name=>JSON.parse(db.prepare('SELECT value_json FROM preferences WHERE organization_id=1 AND name=?').get(`${name}:${job.legacyId}`).value_json),lines=pref('job_lines');assert.ok(Array.isArray(lines));
 await mutate('jobEdit',{id:job.id,discountValue:20},'job');assert.equal(r.get('jobs',job.legacyId).total_cents,8800);assert.deepEqual(pref('job_lines'),lines);
 for(const method of ['PATCH','PUT']){const result=await call('/api/jobs/'+job.legacyId,{method,headers,data:{tax_rate:5}});assert.equal(result.status,200);assert.equal(result.body.total_cents,8400);}
 await mutate('jobEdit',{id:job.id,lineItems:[{name:'Replacement',unitPrice:200,taxable:true}]},'job');assert.equal(r.get('jobs',job.legacyId).total_cents,18900);assert.deepEqual(pref('job_options'),{tax_rate:5,discount_type:'fixed',discount_value:2000});
 const removed=await call('/api/jobs/'+job.legacyId,{method:'DELETE',headers});assert.equal(removed.status,200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM preferences WHERE organization_id=1 AND name IN (?,?)').get(`job_lines:${job.legacyId}`,`job_options:${job.legacyId}`).n,0);
});

test('Astra 63: mixed taxable discounted jobs retain invoice totals with and without stored options',async t=>{
 const {mutate,r,call,headers}=await fixture(t);
 for(const legacy of [false,true]){
  const job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Mixed tax',taxRate:10,discountType:'PERCENT',discountValue:10,lineItems:[{name:'Taxable',unitPrice:100,taxable:true},{name:'Exempt',unitPrice:100,taxable:false}]},'job');
  if(legacy){const options=r.list('preferences').find(p=>p.name===`job_options:${job.legacyId}`);const removed=await call('/api/preferences/'+options.id,{method:'DELETE',headers});assert.equal(removed.status,200);}
  await mutate('jobComplete',{id:job.id},'job');const invoice=await mutate('jobInvoice',{id:job.id},'invoice','amounts{subtotalCents discountCents taxCents totalCents}');assert.deepEqual(invoice.amounts,{subtotalCents:20000,discountCents:2000,taxCents:900,totalCents:18900});
 }
});

test('Astra 64: job projections and invoices exclude unselected optional lines',async t=>{
 const {mutate,r,db}=await fixture(t);
 for(const allOptional of [false,true]){
  const lineItems=[...(allOptional?[]:[{name:'Required',unitPrice:100},{name:'Selected',unitPrice:20,isOptional:true,isSelected:true}]),{name:'Unselected',unitPrice:50,isOptional:true,isSelected:false}],job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Optional',lineItems},'job','id legacyId lineItems{nodes{name}}');
  const expected=allOptional?[]:[{name:'Required'},{name:'Selected'}];assert.deepEqual(job.lineItems.nodes,expected);assert.equal(JSON.parse(db.prepare('SELECT value_json FROM preferences WHERE organization_id=1 AND name=?').get(`job_lines:${job.legacyId}`).value_json).length,lineItems.length);
  await mutate('jobComplete',{id:job.id},'job');const invoice=await mutate('jobInvoice',{id:job.id},'invoice','amounts{totalCents} lineItems{nodes{name}}');assert.deepEqual(invoice.lineItems.nodes,expected);assert.equal(invoice.amounts.totalCents,allOptional?0:12000);
 }
});

test('Astra 65: monetary exponent work is bounded and rounding remains exact',()=>{
 const start=performance.now();for(let i=0;i<100;i++)assert.equal(normalizeInput({unitPrice:'1e-10000000'},'JobLineItem').unit_price_cents,0);assert.ok(performance.now()-start<1000);
 for(const [value,expected] of [['0e999999999',0],['0.005',1],['0.004999999999999999999999999999999999',0],['1.005000000000000000000000000000000001',101],['90071992547409.91',Number.MAX_SAFE_INTEGER]])assert.equal(normalizeInput({unitPrice:value},'JobLineItem').unit_price_cents,expected);
 for(const value of ['1e-999999999999999999','90071992547409.92','1e20'])assert.throws(()=>normalizeInput({unitPrice:value},'JobLineItem'),/Invalid monetary amount/);
});

test('Astra 66: camelCase and snake_case filters preserve SQL null across all matchers',async t=>{
 const {gql,r}=await fixture(t),unlinked=r.insert('tasks',{title:'Unlinked',client_id:null}),linked=r.insert('tasks',{title:'Linked',client_id:r.list('clients')[0].id});
 for(const key of ['clientId','client_id'])for(const value of [null,{eq:null},{in:[null]},[null]]){const result=await gql('query($filter:Input!){tasks(first:1000,filter:$filter){nodes{legacyId}}}',{filter:{[key]:value}});assert.equal(result.errors,undefined);const ids=result.data.tasks.nodes.map(x=>x.legacyId);assert.ok(ids.includes(unlinked.id));assert.ok(!ids.includes(linked.id));}
});

test('Astra 67: login throttle evicts incrementally, caps capacity and resets expired windows',()=>{
 let now=100000,steps=0;const realNow=Date.now,iterate=Map.prototype[Symbol.iterator];try{Date.now=()=>now;Map.prototype[Symbol.iterator]=function*(){for(const entry of iterate.call(this)){steps++;yield entry;}};
 const auth=createAuth(null),req=ip=>({socket:{remoteAddress:ip}}),limited=req('oldest');for(let i=0;i<30;i++)auth.throttle(limited);assert.throws(()=>auth.throttle(limited),e=>e.status===429);
 for(let i=0;i<10000;i++)auth.throttle(req('ip-'+i));assert.ok(steps<10100,`Scanned ${steps} entries`);assert.doesNotThrow(()=>auth.throttle(limited));
 const active=req('active');for(let i=0;i<30;i++)auth.throttle(active);assert.throws(()=>auth.throttle(active),e=>e.status===429);now+=60000;assert.doesNotThrow(()=>auth.throttle(active));for(let i=1;i<30;i++)auth.throttle(active);assert.throws(()=>auth.throttle(active),e=>e.status===429);
 }finally{Date.now=realNow;Map.prototype[Symbol.iterator]=iterate;}
});

test('Astra 68: costing charges underlying rows before reading and caches job aliases',async t=>{
 const {db,r,owner}=await fixture(t),job=r.insert('jobs',{client_id:r.list('clients')[0].id,title:'Cost budget',total_cents:10000});let reads=0;
 const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT \* FROM (time_entries|expenses)\b/i.test(sql))reads++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}),run=query=>executeGraphQL({db:measured,user:owner,query,authorize(){}});
 db.prepare('INSERT INTO expenses(organization_id,job_id,item_name,amount_cents) VALUES(1,?,?,?)').run(job.id,'Materials',100);
 const result=await run(`{a:job(id:${job.id}){x:jobCosting{expenseCostCents} y:jobCosting{expenseCostCents}} b:job(id:${job.id}){jobCosting{expenseCostCents}}}`);
 assert.equal(result.errors,undefined);assert.equal(reads,2);assert.equal(result.data.a.x.expenseCostCents,100);assert.deepEqual(result.data.a.x,result.data.b.jobCosting);
 db.prepare('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000) INSERT INTO expenses(organization_id,job_id,item_name,amount_cents) SELECT 1,?,\'Budget\',1 FROM n').run(job.id);
 reads=0;const over=await run(`{job(id:${job.id}){jobCosting{profitCents}}}`);assert.equal(over.data,null);assert.match(over.errors[0].message,/Execution cost exceeded/);assert.equal(reads,0);
});

test('Astra 69: duplicate declarations and variable/default validation are bounded before dispatch',async t=>{
 const {db,owner}=await fixture(t);let dispatched=0;const run=(query,variables={})=>executeGraphQL({db,user:owner,query,variables,authorize(){},dispatch(){dispatched++;}});
 assert.throws(()=>parseGraphQL('query($x:Int,$x:Int){account{id}}'),/Duplicate variable \$x/);
 assert.doesNotThrow(()=>parseGraphQL('query A($x:Int){account{id}} query B($x:Int){account{id}}'));
 for(const [query,variables] of [
  ['mutation($x:[Int]){clientCreate(input:{name:"Never"}){userErrors{message}}}',{x:Array(20001).fill(1)}],
  ['mutation($x:Input){clientCreate(input:{name:"Never"}){userErrors{message}}}',{x:Object.fromEntries(Array.from({length:20001},(_,i)=>['k'+i,1]))}],
  [`mutation($x:[Int]=[${'1 '.repeat(11000)}]){clientCreate(input:{name:"Never"}){userErrors{message}}}`,{}]
 ]){const result=await run(query,variables);assert.equal(result.data,null);assert.match(result.errors[0].message,/Query cost exceeded/);}
 assert.equal(dispatched,0);assert.equal((await run('query($x:[Int]=[1 2]){account{id}}')).errors,undefined);
});

test('Astra 70: quote-backed edits inherit pricing and invoice the edited quote lines',async t=>{
 const {mutate,r,db,call,headers}=await fixture(t);
 for(const mode of ['graphql','PATCH','PUT','replacement']){
  const quote=await mutate('quoteCreate',{clientId:r.list('clients')[0].id,title:'Inherited pricing',taxRate:10,discountType:'FIXED',discountValue:10,lineItems:[{name:'Taxable',unitPrice:100,taxable:true},{name:'Exempt',unitPrice:100,taxable:false}]},'quote');
  await mutate('quoteSend',{id:quote.id},'quote');await mutate('quoteApprove',{id:quote.id},'quote');const job=await mutate('quoteConvertToJob',{id:quote.id},'job');
  if(mode==='graphql')await mutate('jobEdit',{id:job.id,discountValue:20},'job');
  else if(mode==='replacement')await mutate('jobEdit',{id:job.id,lineItems:[{name:'Replacement',unitPrice:200,taxable:true}]},'job');
  else {const result=await call('/api/jobs/'+job.legacyId,{method:mode,headers,data:{discount_value:2000}});assert.equal(result.status,200,JSON.stringify(result.body));}
  const options=JSON.parse(db.prepare('SELECT value_json FROM preferences WHERE organization_id=1 AND name=?').get(`job_options:${job.legacyId}`).value_json);assert.equal(options.discount_type,'fixed');assert.equal(options.tax_rate,10);assert.equal(options.discount_value,mode==='replacement'?1000:2000);
  assert.equal(r.get('jobs',job.legacyId).total_cents,mode==='replacement'?20900:18900);
  await mutate('jobComplete',{id:job.id},'job');const invoice=await mutate('jobInvoice',{id:job.id},'invoice','amounts{totalCents taxCents} lineItems{nodes{name}}');assert.equal(invoice.amounts.totalCents,mode==='replacement'?20900:18900);assert.equal(invoice.amounts.taxCents,mode==='replacement'?1900:900);assert.deepEqual(invoice.lineItems.nodes.map(l=>l.name),mode==='replacement'?['Replacement']:['Taxable','Exempt']);
 }
});

test('Astra 71: invalid job lines fail atomically and valid catalog lines remain invoiceable',async t=>{
 const {mutate,gql,r,db,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,job=await mutate('jobCreate',{clientId,title:'Valid lines',lineItems:[{name:'Original',unitPrice:10}]},'job');
 const before=r.get('jobs',job.legacyId),prefs=()=>db.prepare('SELECT name,value_json FROM preferences WHERE organization_id=1 ORDER BY name').all(),previous=prefs(),count=r.list('jobs').length;
 const foreign=r.list('products_services')[0];db.prepare('INSERT INTO products_services(organization_id,name) VALUES(2,?)').run('Foreign service');const foreignId=db.prepare('SELECT id FROM products_services WHERE organization_id=2 AND name=?').get('Foreign service').id;
 for(const line of [{unitPrice:10},{name:' ',unitPrice:10},{name:12},{name:'Bad',quantity:0},{name:'Bad',quantity:-1},{name:'Bad',description:{}},{name:'Bad',unit:42},{name:'Bad',unexpected:true},{name:'Bad',productOrServiceId:999999999},{name:'Bad',productOrServiceId:foreignId}]){
  const result=await gql('mutation($input:Input!){jobCreate(input:$input){job{id} userErrors{message}}}',{input:{clientId,title:'Rejected',lineItems:[line]}});assert.equal(result.errors,undefined);assert.ok(result.data.jobCreate.userErrors.length);assert.equal(r.list('jobs').length,count);
  for(const method of ['PATCH','PUT']){const edit=await call('/api/jobs/'+job.legacyId,{method,headers,data:{items:[line]}});assert.ok([400,404].includes(edit.status),JSON.stringify(edit));assert.deepEqual(r.get('jobs',job.legacyId),before);assert.deepEqual(prefs(),previous);}
 }
 await mutate('jobEdit',{id:job.id,lineItems:[{name:'Catalog',productOrServiceId:foreign.id,quantity:2,unitPrice:10,description:'Valid',unit:'hour'}]},'job');await mutate('jobComplete',{id:job.id},'job');const invoice=await mutate('jobInvoice',{id:job.id},'invoice','amounts{totalCents} lineItems{nodes{name}}');assert.equal(invoice.amounts.totalCents,2000);assert.deepEqual(invoice.lineItems.nodes,[{name:'Catalog'}]);
});

test('Astra 72: unchanged stored job lines do not inherit mismatched quote pricing',async t=>{
 const {mutate,r,db}=await fixture(t),clientId=r.list('clients')[0].id;
 const quote=await mutate('quoteCreate',{clientId,title:'Quote pricing',taxRate:10,discountType:'PERCENT',discountValue:20,lineItems:[{name:'Quoted',unitPrice:100,taxable:true}]},'quote');
 const job=await mutate('jobCreate',{clientId,quoteId:quote.id,title:'Independent pricing',lineItems:[{name:'Stored',unitPrice:100,taxable:true}]},'job');
 assert.equal(hydrateJobState(db,1,r.get('jobs',job.legacyId))._storedOptions,null);
 await mutate('jobEdit',{id:job.id,lineItems:[{name:'Stored',unitPrice:100,taxable:true}]},'job');
 assert.equal(r.get('jobs',job.legacyId).total_cents,10000);assert.equal(r.get('jobs',job.legacyId).tax_cents,0);
 r.update('jobs',job.legacyId,{subtotal_cents:10000,tax_cents:800,total_cents:8800});
 assert.deepEqual(hydrateJobState(db,1,r.get('jobs',job.legacyId))._storedOptions,{tax_rate:10,discount_type:'percent',discount_value:20});
 // Matching must use stored lines, not the original quote lines.
 const line=JSON.parse(db.prepare('SELECT value_json FROM preferences WHERE name=?').get(`job_lines:${job.legacyId}`).value_json)[0];line.unit_price_cents=20000;line.total_cents=20000;
 db.prepare('UPDATE preferences SET value_json=? WHERE name=?').run(JSON.stringify([line]),`job_lines:${job.legacyId}`);
 r.update('jobs',job.legacyId,{subtotal_cents:20000,tax_cents:1600,total_cents:17600});
 assert.equal(hydrateJobState(db,1,r.get('jobs',job.legacyId))._storedOptions.tax_rate,10);
});

test('Astra 73: sequential mutations refresh job costing after each write',async t=>{
 const {mutate,gql,r}=await fixture(t),job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Cost refresh',totalCents:10000},'job');
 const result=await gql(`mutation{first:jobEdit(input:{id:"${job.id}",totalCents:20000}){job{jobCosting{revenueCents profitCents}} userErrors{message}} second:jobEdit(input:{id:"${job.id}",totalCents:30000}){job{jobCosting{revenueCents profitCents}} userErrors{message}}}`);
 assert.equal(result.errors,undefined);assert.deepEqual(result.data.first.userErrors,[]);assert.deepEqual(result.data.second.userErrors,[]);
 assert.deepEqual(result.data.first.job.jobCosting,{revenueCents:20000,profitCents:20000});assert.deepEqual(result.data.second.job.jobCosting,{revenueCents:30000,profitCents:30000});
});

test('Astra 74: line-free jobs reject invalid calculation options before persistence',async t=>{
 const {mutate,gql,r,db,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,job=await mutate('jobCreate',{clientId,title:'Options only',taxRate:5},'job');
 const before=r.get('jobs',job.legacyId),count=r.list('jobs').length,prefs=()=>db.prepare('SELECT name,value_json FROM preferences WHERE organization_id=1 ORDER BY name').all(),previous=prefs();
 const invalid=[{discount_type:'bogus'},...['tax_rate','discount_value'].flatMap(k=>['invalid',-1,0.1234567].map(v=>({[k]:v}))),{required_deposit_type:'percent',required_deposit_value:-1}];
 for(const options of invalid){
  const created=await call('/api/jobs',{method:'POST',headers,data:{client_id:clientId,title:'Rejected',...options}});assert.equal(created.status,400,JSON.stringify(created.body));
  const result=await gql('mutation($input:Input!){jobCreate(input:$input){job{id} userErrors{message}}}',{input:{clientId,title:'Rejected',...options}});assert.equal(result.errors,undefined);assert.ok(result.data.jobCreate.userErrors.length);
  for(const method of ['PATCH','PUT'])assert.equal((await call('/api/jobs/'+job.legacyId,{method,headers,data:options})).status,400);
  assert.throws(()=>normalizeInput(options,'Job',before),e=>e.status===400);
  if(!('required_deposit_type' in options))assert.throws(()=>storeJobOptions(db,1,job.legacyId,options),e=>e.status===400);
  assert.equal(r.list('jobs').length,count);assert.deepEqual(r.get('jobs',job.legacyId),before);assert.deepEqual(prefs(),previous);
 }
 assert.equal((await call('/api/jobs',{method:'POST',headers,data:{client_id:clientId,title:'Valid options',tax_rate:0.123456,discount_type:'percent',discount_value:5}})).status,201);
});

test('Astra 75: invoicing preserves explicitly cleared job lines',async t=>{
 const {mutate,r,db}=await fixture(t),job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Cleared lines',lineItems:[{name:'Remove me',unitPrice:100}]},'job');
 await mutate('jobEdit',{id:job.id,lineItems:[]},'job');
 assert.equal(db.prepare('SELECT value_json FROM preferences WHERE name=?').get(`job_lines:${job.legacyId}`).value_json,'[]');
 await mutate('jobComplete',{id:job.id},'job');const invoice=await mutate('jobInvoice',{id:job.id},'invoice','legacyId amounts{totalCents} lineItems{nodes{name}}');
 assert.equal(invoice.amounts.totalCents,0);assert.deepEqual(invoice.lineItems.nodes,[]);assert.deepEqual(r.list('invoice_line_items',{invoice_id:invoice.legacyId}),[]);
});

test('Astra 76: mutation input and calculated/stored lines consume execution budgets before dispatch',async t=>{
 const {gql,r,db,owner}=await fixture(t),input={clientId:r.list('clients')[0].id,title:'Budget',lineItems:Array.from({length:5000},()=>({name:'Line',unitPrice:1,quantity:1}))},count=r.list('jobs').length,prefs=()=>db.prepare('SELECT name,value_json FROM preferences WHERE organization_id=1 ORDER BY name').all(),before=prefs();
 for(const aliases of [1,10]){const result=await gql(`mutation($input:Input!){${Array.from({length:aliases},(_,i)=>`a${i}:jobCreate(input:$input){userErrors{message}}`).join(' ')}}`,{input});assert.equal(result.data,null);assert.match(result.errors[0].message,/Execution cost exceeded/);assert.equal(result.extensions.cost.actualQueryCost,20001);assert.equal(r.list('jobs').length,count);assert.deepEqual(prefs(),before);}
 // Three values per line leave traversal below the limit; calculated lines push it over.
 let dispatched=0;const run=(query,input)=>executeGraphQL({db,user:owner,query,variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 const calculated=await run('mutation($input:Input!){jobCreate(input:$input){userErrors{message}}}',{...input,lineItems:input.lineItems.map(({name,unitPrice})=>({name,unitPrice}))});assert.match(calculated.errors[0].message,/Execution cost exceeded/);assert.equal(dispatched,0);
 const job=r.insert('jobs',{client_id:input.clientId,title:'Stored budget'});db.prepare('INSERT INTO preferences(organization_id,name,value_json) VALUES(1,?,?)').run(`job_lines:${job.id}`,JSON.stringify(Array.from({length:20000},()=>({name:'Stored',quantity:1,unit_price_cents:100,total_cents:100}))));
 const stored=await run('mutation($input:Input!){jobEdit(input:$input){userErrors{message}}}',{id:job.id,title:'Never written'});assert.match(stored.errors[0].message,/Execution cost exceeded/);assert.equal(dispatched,0);assert.equal(r.get('jobs',job.id).title,'Stored budget');
});

test('Astra 77: every additional Node type round trips with scoped authorization and conflict validation',async t=>{
 const {mutate,gql,r,db,owner}=await fixture(t),client=await mutate('clientCreate',{name:'Node contacts',email:'node@example.test',phone:'555-0100'},'client','id legacyId emails{id address primary} phones{id raw number primary smsAllowed}');
 const selections={QuoteLineItem:'id legacyId name description quantity unitPrice totalPrice unitPriceCents totalCents taxable isOptional isSelected',InvoiceLineItem:'id legacyId name description quantity unitPrice totalPrice unitPriceCents totalCents taxable isOptional isSelected',JobLineItem:'id legacyId name description quantity unitPrice totalPrice unitPriceCents totalCents taxable',Assessment:'id legacyId title status isComplete startAt endAt instructions assignedUsers{nodes{id}}',Email:'id address primary',PhoneNumber:'id raw number primary smsAllowed'},samples=[];
 for(const type of ['Quote','Invoice','Job']){const field=type.toLowerCase(),lineType=type+'LineItem',doc=await mutate(field+'Create',{clientId:client.id,...(type==='Invoice'?{subject:'Node lines'}:{title:'Node lines'}),lineItems:[{name:'Round trip',quantity:2,unitPrice:10}]},field,`id lineItems{nodes{${selections[lineType]}}}`);samples.push([lineType,doc.lineItems.nodes[0]]);}
 const fallback=await mutate('jobCreate',{clientId:client.id,title:'Fallback',totalCents:100},'job',`lineItems{nodes{${selections.JobLineItem}}}`);samples.push(['JobLineItem',fallback.lineItems.nodes[0]]);
 const request=await mutate('requestCreate',{clientId:client.id,title:'Node assessment'},'request');const scheduled=await mutate('requestScheduleAssessment',{id:request.id,startAt:'2026-11-02T10:00:00Z',endAt:'2026-11-02T11:00:00Z'},'request',`assessment{${selections.Assessment}}`);samples.push(['Assessment',scheduled.assessment],['Email',client.emails[0]],['PhoneNumber',client.phones[0]]);
 const user=await gql(`{currentUser{phone{${selections.PhoneNumber}}}}`);samples.push(['PhoneNumber',user.data.currentUser.phone]);
 for(const [type,expected] of samples){for(const id of [expected.id,Buffer.from(expected.id,'base64').toString()]){const result=await gql(`query($id:ID!){node(id:$id){... on ${type}{${selections[type]}}}}`,{id});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.node,expected);}
  const denied=await executeGraphQL({db,user:owner,query:'query($id:ID!){node(id:$id){id}}',variables:{id:expected.id},authorize(){throw Object.assign(new Error('Denied'),{status:403});}});assert.match(denied.errors[0].message,/Denied/);
 }
 for(const type of Object.keys(selections)){const absent=await gql('query($id:ID!){node(id:$id){id}}',{id:encodeGid(type,999999999)});assert.equal(absent.errors,undefined);assert.equal(absent.data.node,null);}
 for(const prefix of ['', 'client:', 'user:']){assert.equal(decodeGid(encodeGid('Email',prefix+client.legacyId),'Email'),client.legacyId);const phone=await gql(`{node(id:"${encodeGid('PhoneNumber',prefix+(prefix==='user:'?owner.id:client.legacyId))}"){id}}`);assert.equal(phone.errors,undefined);assert.ok(phone.data.node);}
 assert.throws(()=>decodeGid(encodeGid('Job','user:1')),/Invalid Global ID/);
 const info=await gql('{__type(name:"Node"){possibleTypes{name}}}');for(const type of Object.keys(selections))assert.ok(info.data.__type.possibleTypes.some(x=>x.name===type));
 const conflict=await gql(`{node(id:"${client.emails[0].id}"){... on Email{x:id x:address}}}`);assert.equal(conflict.data,null);assert.match(conflict.errors[0].message,/Conflicting fields x/);
 const other={...owner,organization_id:2};for(const [type,value] of samples.filter(([type])=>type!=='JobLineItem')){const isolated=await executeGraphQL({db,user:other,query:'query($id:ID!){node(id:$id){id}}',variables:{id:value.id},authorize(){}});assert.equal(isolated.errors,undefined);assert.equal(isolated.data.node,null,type);}
});

test('Astra 78: work-order and work-request edit aliases preserve typed IDs and existing pricing',async t=>{
 const {mutate,gql,r}=await fixture(t),clientId=r.list('clients')[0].id,job=await mutate('jobCreate',{clientId,title:'Aliases',discountType:'FIXED',discountValue:1,lineItems:[{name:'Line',unitPrice:10}]},'job'),request=await mutate('requestCreate',{clientId,title:'Aliases'},'request');
 for(const key of ['jobId','workOrderId','work_order_id']){const edited=await mutate('jobEdit',{[key]:job.id,title:key,discountValue:2},'job','id title totalCents');assert.deepEqual(edited,{id:job.id,title:key,totalCents:800});}
 for(const key of ['requestId','workRequestId','work_request_id']){const edited=await mutate('requestEdit',{[key]:request.id,title:key},'request','id title');assert.deepEqual(edited,{id:request.id,title:key});}
 for(const [name,key,id] of [['jobEdit','workOrderId',request.id],['jobEdit','work_order_id',request.id],['requestEdit','workRequestId',job.id],['requestEdit','work_request_id',job.id]]){const result=await gql(`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,{input:{[key]:id,title:'Rejected'}});assert.equal(result.errors,undefined);assert.match(result.data[name].userErrors[0].message,/Invalid Global ID/);}
 assert.equal(r.get('jobs',job.legacyId).title,'work_order_id');assert.equal(r.get('requests',request.legacyId).title,'work_request_id');
});

test('Astra 79: internal job preferences enforce jobs read and write permissions',async t=>{
 const {mutate,r,db,owner,call,headers}=await fixture(t),job=await mutate('jobCreate',{clientId:r.list('clients')[0].id,title:'Private lines',taxRate:10,lineItems:[{name:'Private',unitPrice:10}]},'job');
 const names=['job_line_seq',`job_lines:${job.legacyId}`,`job_options:${job.legacyId}`],prefs=names.map(name=>r.list('preferences',{name})[0]),ordinary=r.insert('preferences',{name:'astra79',value_json:'{}'}),snapshot=()=>db.prepare('SELECT * FROM preferences ORDER BY id').all(),before=snapshot();
 db.prepare("UPDATE permissions SET allowed=0 WHERE role_id=? AND resource='jobs'").run(owner.role_id);
 const listed=await call('/api/preferences',{headers});assert.equal(listed.status,200);assert.ok(listed.body.some(p=>p.id===ordinary.id));assert.ok(listed.body.every(p=>!names.includes(p.name)));
 for(const pref of prefs)assert.equal((await call('/api/preferences/'+pref.id,{headers})).status,403);
 const denied=async(path,options)=>{assert.equal((await call(path,{headers,...options})).status,403);assert.deepEqual(snapshot(),before);};
 for(const pref of prefs){
  await denied('/api/preferences',{method:'POST',data:{name:pref.name,value_json:'[]'}});
  for(const method of ['PATCH','PUT']){
   for(const data of [{value_json:'[]'},{name:'ordinary-renamed'}])await denied('/api/preferences/'+pref.id,{method,data});
   await denied('/api/preferences/'+ordinary.id,{method,data:{name:pref.name}});
  }
  await denied('/api/preferences/'+pref.id,{method:'DELETE'});
 }
 db.prepare("UPDATE permissions SET allowed=1 WHERE role_id=? AND resource='jobs' AND action IN ('read','write')").run(owner.role_id);
 for(const pref of prefs){
  assert.equal((await call('/api/preferences/'+pref.id,{headers})).status,200);
  for(const method of ['PATCH','PUT'])assert.equal((await call('/api/preferences/'+pref.id,{method,headers,data:{value_json:pref.value_json}})).status,200);
 }
 assert.equal((await call('/api/preferences/'+ordinary.id,{method:'PATCH',headers,data:{value_json:'{"ok":true}'}})).status,200);
});

test('Astra 80: catalog deletion detaches stored lines and stale references remain invoiceable',async t=>{
 const {mutate,r,db,call,headers}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const route of ['catalog','products_services','legacy']){
  const product=r.insert('products_services',{name:'Disposable '+route,unit_price_cents:1000});
  const job=await mutate('jobCreate',{clientId,title:'Catalog deletion',lineItems:[{name:'Snapshot',productOrServiceId:product.id,unitPrice:10,quantity:2,taxable:true}]},'job');
  if(route==='legacy')db.prepare('DELETE FROM products_services WHERE id=?').run(product.id);
  else {assert.equal((await call(`/api/${route}/${product.id}`,{method:'DELETE',headers})).status,200);const lines=JSON.parse(r.list('preferences',{name:`job_lines:${job.legacyId}`})[0].value_json);assert.equal(lines[0].product_service_id,null);assert.equal(lines[0].unit_price_cents,1000);}
  await mutate('jobComplete',{id:job.id},'job');const invoice=await call(`/api/jobs/${job.legacyId}/invoice`,{method:'POST',headers,data:{}});assert.equal(invoice.status,200,JSON.stringify(invoice.body));assert.equal(invoice.body.total_cents,2000);
  const lines=r.list('invoice_line_items',{invoice_id:invoice.body.id});assert.equal(lines.length,1);assert.equal(lines[0].name,'Snapshot');assert.equal(lines[0].product_service_id,null);
 }
});

test('Astra 81: zero-total converted quotes retain pricing for new job lines and invoices',async t=>{
 const {mutate,r,db}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const addLines of [false,true]){
  const quote=await mutate('quoteCreate',{clientId,title:'Unselected quote',taxRate:10,discountType:'PERCENT',discountValue:20,lineItems:[{name:'Optional',unitPrice:100,taxable:true,isOptional:true,isSelected:false}]},'quote');
  r.update('quotes',quote.legacyId,{status:'approved'});const job=await mutate('quoteConvertToJob',{id:quote.id},'job');
  const state=hydrateJobState(db,1,r.get('jobs',job.legacyId));assert.deepEqual(state._storedLines,[]);assert.deepEqual(state._storedOptions,{tax_rate:10,discount_type:'percent',discount_value:20});
  if(addLines){await mutate('jobEdit',{id:job.id,lineItems:[{name:'Added',unitPrice:100,taxable:true}]},'job');assert.equal(r.get('jobs',job.legacyId).total_cents,8800);}
  await mutate('jobComplete',{id:job.id},'job');const invoice=await mutate('jobInvoice',{id:job.id},'invoice');const row=r.get('invoices',invoice.legacyId);
  assert.equal(row.tax_rate,10);assert.equal(row.discount_type,'percent');assert.equal(row.discount_value,20);assert.equal(row.total_cents,addLines?8800:0);assert.equal(r.list('invoice_line_items',{invoice_id:row.id}).length,addLines?1:0);
 }
});

test('Astra 82: line booleans reject coercion before writes and accept only booleans or binary integers',async t=>{
 const {mutate,gql,r,db,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,job=await mutate('jobCreate',{clientId,title:'Boolean validation',lineItems:[{name:'Original',unitPrice:10}]},'job');
 const snapshot=()=>db.prepare('SELECT * FROM preferences ORDER BY id').all(),before=snapshot(),original=r.get('jobs',job.legacyId);
 for(const k of ['taxable','is_optional','is_selected'])for(const value of ['false','true',2,-1,null,{},[]]){
  const line={name:'Invalid',unit_price_cents:100,[k]:value};
  assert.throws(()=>calculateDocument([line]),new RegExp(`Invalid boolean value for ${k}`));assert.throws(()=>normalizeInput(line,'JobLineItem'),/Invalid boolean value/);assert.throws(()=>storeJobLines(db,1,job.legacyId,[line]),/Invalid boolean value/);
  for(const route of ['quotes','invoices','jobs']){
   const count=r.list(route).length,result=await call('/api/'+route,{method:'POST',headers,data:{client_id:clientId,...(route==='invoices'?{subject:'Invalid'}:{title:'Invalid'}),items:[line]}});assert.equal(result.status,400);assert.equal(r.list(route).length,count);
  }
  for(const method of ['PATCH','PUT'])assert.equal((await call('/api/jobs/'+job.legacyId,{method,headers,data:{items:[line]}})).status,400);
  const result=await gql('mutation($input:Input!){jobEdit(input:$input){userErrors{message}}}',{input:{id:job.id,lineItems:[line]}});assert.equal(result.errors,undefined);assert.match(result.data.jobEdit.userErrors[0].message,/Invalid boolean value/);
  assert.deepEqual(snapshot(),before);assert.deepEqual(r.get('jobs',job.legacyId),original);
 }
 for(const value of [true,false,1,0]){const line={name:'Valid',unit_price_cents:100,taxable:value,is_optional:value,is_selected:value};assert.doesNotThrow(()=>calculateDocument([line]));assert.doesNotThrow(()=>normalizeInput(line,'JobLineItem'));const stored=storeJobLines(db,1,job.legacyId,[line])[0];for(const k of ['taxable','is_optional','is_selected'])assert.equal(stored[k],value?1:0);}
 const defaults=storeJobLines(db,1,job.legacyId,[{name:'Defaults',unit_price_cents:100}])[0];assert.equal(defaults.taxable,1);assert.equal(defaults.is_optional,0);assert.equal(defaults.is_selected,1);
});

test('Astra 83: pagination flags describe truncation inside cursor boundaries',async t=>{
 const {gql,r}=await fixture(t);for(let i=0;i<105;i++)r.insert('clients',{display_name:`Astra83 ${i}`});
 const all=await gql('{clients(first:1000,searchTerm:"Astra83"){edges{cursor node{id}} totalCount}}');assert.equal(all.errors,undefined);const edges=all.data.clients.edges;assert.equal(edges.length,105);
 const check=async(args,expected,next,previous)=>{const result=await gql(`query($after:String,$before:String,$first:Int,$last:Int){clients(searchTerm:"Astra83",after:$after,before:$before,first:$first,last:$last){nodes{id} totalCount pageInfo{hasNextPage hasPreviousPage startCursor endCursor}}}`,args);assert.equal(result.errors,undefined,JSON.stringify(result));const c=result.data.clients;assert.deepEqual(c.nodes,expected.map(e=>e.node));assert.equal(c.totalCount,105);assert.deepEqual(c.pageInfo,{hasNextPage:next,hasPreviousPage:previous,startCursor:expected[0]?.cursor??null,endCursor:expected.at(-1)?.cursor??null});};
 const after=edges[0].cursor,before=edges[5].cursor;
 await check({after,before},edges.slice(1,5),false,false);
 await check({after,before,first:2},edges.slice(1,3),true,false);
 await check({after,before,last:2},edges.slice(3,5),false,true);
 await check({after,before,first:3,last:1},edges.slice(3,4),true,true);
 await check({after,before,first:0},[],true,false);await check({after,before,last:0},[],false,true);
 await check({after:edges[5].cursor,before:edges[0].cursor},[],false,false);
 await check({after:edges[0].cursor,before:edges[1].cursor},[],false,false);
 await check({after:edges.at(-1).cursor},[],false,false);await check({before:edges[0].cursor},[],false,false);
 await check({after,before:edges[104].cursor},edges.slice(1,101),true,false);
});

test('Astra 84: omitted optional selection stays unselected through storage and invoicing',async t=>{
 const {mutate,r,db}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const optional of [true,1]){
  const items=[{name:'Required',unit_price_cents:1000},{name:'Omitted',unit_price_cents:9000,is_optional:optional},{name:'Selected',unit_price_cents:500,is_optional:optional,is_selected:true},{name:'Excluded',unit_price_cents:8000,is_optional:optional,is_selected:false}];
  const calc=calculateDocument(items);assert.equal(calc.total_cents,1500);assert.deepEqual(calc.lines.map(l=>[l.is_optional,l.is_selected,l.total_cents]),[[0,1,1000],[1,0,0],[1,1,500],[1,0,0]]);
  const job=await mutate('jobCreate',{clientId,title:'Optional defaults',lineItems:items},'job','id legacyId totalCents lineItems{nodes{name}}');assert.equal(job.totalCents,1500);assert.deepEqual(job.lineItems.nodes,[{name:'Required'},{name:'Selected'}]);
  const stored=JSON.parse(db.prepare('SELECT value_json FROM preferences WHERE organization_id=1 AND name=?').get(`job_lines:${job.legacyId}`).value_json);assert.equal(stored[1].is_selected,0);
  assert.equal(storeJobLines(db,1,job.legacyId,calc.lines)[1].is_selected,0);assert.equal(storeJobLines(db,1,job.legacyId,items)[1].is_selected,0);
  await mutate('jobComplete',{id:job.id},'job');const invoice=await mutate('jobInvoice',{id:job.id},'invoice','amounts{totalCents} lineItems{nodes{name}}');assert.equal(invoice.amounts.totalCents,1500);assert.deepEqual(invoice.lineItems.nodes,[{name:'Required'},{name:'Selected'}]);
 }
});

test('Astra 85: catalog deletion ignores lookalike keys and non-array preferences',async t=>{
 const {r,db,call,headers}=await fixture(t);
 for(const route of ['catalog','products_services']){
  const product=r.insert('products_services',{name:'Deletion target'}),job=r.insert('jobs',{client_id:r.list('clients')[0].id,title:'Catalog snapshot'});
  storeJobLines(db,1,job.id,[{name:'Snapshot',unit_price_cents:123,product_service_id:product.id}]);
  const prefs=[['jobXlines:custom'+product.id,{product_service_id:product.id}],['jobYlines:custom'+product.id,[{product_service_id:product.id}]],['job_lines:object'+product.id,{}],['job_lines:null'+product.id,null],['job_lines:number'+product.id,7]].map(([name,value])=>r.insert('preferences',{name,value_json:JSON.stringify(value)}));
  const result=await call('/api/'+route+'/'+product.id,{method:'DELETE',headers});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(r.list('products_services',{id:product.id}).length,0);
  for(const pref of prefs)assert.deepEqual(r.get('preferences',pref.id),pref);
  const lines=JSON.parse(db.prepare('SELECT value_json FROM preferences WHERE organization_id=1 AND name=?').get(`job_lines:${job.id}`).value_json);assert.equal(lines[0].product_service_id,null);assert.equal(lines[0].unit_price_cents,123);
 }
});

test('Astra 86: job line scans charge raw rows and cache aliases until mutation',async t=>{
 const {db,r,owner,gql,mutate}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Line budget'});let reads=0;
 const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT value_json FROM preferences/i.test(sql))reads++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}),run=query=>executeGraphQL({db:measured,user:owner,query,authorize(){}});
 const put=items=>storeJobLines(db,1,job.id,items),line={name:'Hidden',unit_price_cents:100,is_optional:true};
 put(Array.from({length:20001},()=>({...line})));reads=0;const over=await run(`{job(id:${job.id}){lineItems{totalCount}}}`);assert.equal(over.data,null);assert.match(over.errors[0].message,/Execution cost exceeded/);assert.equal(over.extensions.cost.actualQueryCost,20001);assert.equal(reads,1);
 put(Array.from({length:100},()=>({...line})));reads=0;const empty=await run(`{job(id:${job.id}){a:lineItems{totalCount} b:lineItems{totalCount}}}`);assert.equal(empty.errors,undefined);assert.equal(empty.data.job.a.totalCount,0);assert.equal(reads,1);assert.ok(empty.extensions.cost.actualQueryCost>=100);
 put(Array.from({length:1000},()=>({name:'Visible',unit_price_cents:100})));reads=0;const aliases=await run(`{job(id:${job.id}){${Array.from({length:21},(_,i)=>`a${i}:lineItems{totalCount}`).join(' ')}}}`);assert.equal(aliases.data,null);assert.match(aliases.errors[0].message,/Execution cost exceeded/);assert.equal(reads,1);
 reads=0;const filtered=await run(`{job(id:${job.id}){a:lineItems(searchTerm:"Visible"){totalCount} b:lineItems(filter:{name:{eq:"Visible"}}){totalCount}}}`);assert.equal(filtered.errors,undefined);assert.equal(filtered.data.job.b.totalCount,1000);assert.equal(reads,1);assert.ok(filtered.extensions.cost.actualQueryCost>=4000);
 const edited=await mutate('jobCreate',{clientId,title:'Cache invalidation',lineItems:[{name:'Original',unitPrice:1}]},'job');
 const changed=await gql(`mutation{a:jobEdit(input:{id:"${edited.id}",lineItems:[{name:"First",unitPrice:2}]}){job{lineItems{nodes{name}}} userErrors{message}} b:jobEdit(input:{id:"${edited.id}",lineItems:[{name:"Second",unitPrice:3}]}){job{lineItems{nodes{name}}} userErrors{message}}}`);assert.equal(changed.errors,undefined);assert.deepEqual(changed.data.a.userErrors,[]);assert.deepEqual(changed.data.b.userErrors,[]);assert.deepEqual(changed.data.a.job.lineItems.nodes,[{name:'First'}]);assert.deepEqual(changed.data.b.job.lineItems.nodes,[{name:'Second'}]);
 const quote=r.insert('quotes',{client_id:clientId,title:'Quoted budget'}),quotedJob=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Quoted lines'});
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO quote_line_items(organization_id,quote_id,name,is_optional,is_selected) SELECT 1,?,'Hidden',1,0 FROM n").run(quote.id);
 const quoted=await run(`{job(id:${quotedJob.id}){lineItems{totalCount}}}`);assert.equal(quoted.data,null);assert.match(quoted.errors[0].message,/Execution cost exceeded/);
});

test('Astra 87: task completion retries preserve timestamps across REST Rails and GraphQL',async t=>{
 const {r,call,headers,mutate}=await fixture(t),task=r.insert('tasks',{title:'Complete once'}),post=async path=>{const result=await call(path,{method:'POST',headers,data:{}});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
 const first=await post(`/api/tasks/${task.id}/complete`);assert.equal(first.status,'completed');assert.ok(Number.isFinite(Date.parse(first.completed_at)));
 const timestamp='2020-01-02T03:04:05.678Z';r.update('tasks',task.id,{completed_at:timestamp});const before=r.get('tasks',task.id);
 for(const path of [`/api/tasks/${task.id}/complete`,`/tasks/${task.id}/complete.json`]){assert.equal((await post(path)).completed_at,timestamp);assert.deepEqual(r.get('tasks',task.id),before);}
 const result=await mutate('taskComplete',{id:task.id},'task','completedAt isComplete');assert.deepEqual(result,{completedAt:timestamp,isComplete:true});assert.deepEqual(r.get('tasks',task.id),before);
 r.update('tasks',task.id,{completed_at:null});const repaired=await post(`/api/tasks/${task.id}/complete`);assert.ok(Number.isFinite(Date.parse(repaired.completed_at)));assert.equal((await post(`/api/tasks/${task.id}/complete`)).completed_at,repaired.completed_at);
});

test('Astra 88: quote-backed job line IDs round trip with jobs permission and distinct namespaces',async t=>{
 const {r,db,owner}=await fixture(t),clientId=r.list('clients')[0].id,quote=r.insert('quotes',{client_id:clientId,title:'Node quote'}),fallback=r.insert('jobs',{client_id:clientId,title:'Fallback'});
 db.prepare('DELETE FROM quote_line_items WHERE id=?').run(fallback.id);
 db.prepare("INSERT INTO quote_line_items(id,organization_id,quote_id,name,unit_price_cents,total_cents) VALUES(?,1,?,'Quoted line',321,321)").run(fallback.id,quote.id);
 const ql=r.get('quote_line_items',fallback.id),job=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Quoted job'}),permissions=[];
 const run=query=>executeGraphQL({db,user:owner,query,authorize(db,user,resource){permissions.push(resource);assert.equal(resource,'jobs');}});
 const result=await run(`{job(id:${job.id}){lineItems{nodes{__typename id legacyId name totalCents}}}}`);assert.equal(result.errors,undefined);const line=result.data.job.lineItems.nodes[0];assert.equal(line.__typename,'JobLineItem');assert.equal(line.id,encodeGid('JobLineItem','quote:'+ql.id));assert.equal(decodeGid(line.id,'JobLineItem'),ql.id);
 for(const id of [line.id,`gid://jobber/JobLineItem/quote:${ql.id}`]){const node=await run(`{node(id:"${id}"){__typename ... on JobLineItem{id legacyId name totalCents}}}`);assert.equal(node.errors,undefined);assert.deepEqual(node.data.node,line);}
 const plain=await run(`{node(id:"${encodeGid('JobLineItem',fallback.id)}"){... on JobLineItem{id name}}}`);assert.equal(plain.data.node.name,'Fallback');assert.notEqual(plain.data.node.id,line.id);assert.ok(permissions.length);
 for(const [type,prefix] of [['QuoteLineItem','quote'],['PhoneNumber','quote'],['JobLineItem','user'],['JobLineItem','client']])assert.throws(()=>decodeGid(encodeGid(type,prefix+':1')),/Invalid Global ID/);
 const denied=await executeGraphQL({db,user:owner,query:`{node(id:"${line.id}"){id}}`,authorize(){throw Object.assign(new Error('Jobs forbidden'),{status:403});}});assert.match(denied.errors[0].message,/Jobs forbidden/);
});

test('Astra 89: job hydration charges raw rows before calculation and metadata edits skip hydration',async t=>{
 const {db,r,owner,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,quote=r.insert('quotes',{client_id:clientId,title:'Hydration budget'}),job=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Before'});
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO quote_line_items(organization_id,quote_id,name,is_optional,is_selected) SELECT 1,?,'Hidden',1,0 FROM n").run(quote.id);
 let dispatched=0;const run=()=>executeGraphQL({db,user:owner,query:`mutation{jobEdit(input:{id:${job.id},title:"After"}){userErrors{message}}}`,authorize(){},dispatch(){dispatched++;}});
 const over=await run();assert.equal(over.data,null);assert.match(over.errors[0].message,/Execution cost exceeded/);assert.equal(over.extensions.cost.actualQueryCost,20001);assert.equal(dispatched,0);assert.equal(r.get('jobs',job.id).title,'Before');
 db.prepare('DELETE FROM quote_line_items WHERE quote_id=?').run(quote.id);
 const pref=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify(Array.from({length:20001},()=>({name:'Stored',unit_price_cents:1})))});
 const stored=await run();assert.match(stored.errors[0].message,/Execution cost exceeded/);assert.equal(dispatched,0);
 const prepare=db.prepare,reads=[];db.prepare=function(sql){if(/SELECT\b[\s\S]*\bFROM\s+(preferences|quote_line_items)\b/i.test(sql))reads.push(sql);return prepare.call(this,sql);};
 try{for(const method of ['PATCH','PUT']){const edited=await call(`/api/jobs/${job.id}`,{method,headers,data:{title:method}});assert.equal(edited.status,200,JSON.stringify(edited.body));assert.equal(edited.body.title,method);assert.deepEqual(reads,[]);}}finally{db.prepare=prepare;}
 r.update('preferences',pref.id,{value_json:'[]'});const charges=[];hydrateJobState(db,1,r.get('jobs',job.id),n=>charges.push(n));assert.deepEqual(charges,[1,1]);
});

test('Astra 90: catalog deletion tolerates null primitive and array preference entries',async t=>{
 const {r,call,headers}=await fixture(t);
 for(const route of ['catalog','products_services']){
  const product=r.insert('products_services',{name:'Nullable reference'}),lines=[null,7,'text',false,['nested'],{product_service_id:product.id,name:'Detach'},{product_service_id:999999,name:'Keep'}],pref=r.insert('preferences',{name:'job_lines:mixed'+product.id,value_json:JSON.stringify(lines)});
  const result=await call(`/api/${route}/${product.id}`,{method:'DELETE',headers});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(r.list('products_services',{id:product.id}).length,0);
  assert.deepEqual(JSON.parse(r.get('preferences',pref.id).value_json),lines.map((l,i)=>i===5?{...l,product_service_id:null}:l));
 }
});

test('Astra 91: reopened tasks clear timestamps and subsequent completion refreshes them',async t=>{
 const {r,call,headers,mutate}=await fixture(t),old='2020-01-02T03:04:05.678Z',task=r.insert('tasks',{title:'Reopen',status:'completed',completed_at:old});
 for(const [method,path] of [['PATCH',`/api/tasks/${task.id}`],['PUT',`/tasks/${task.id}.json`]]){
  r.update('tasks',task.id,{status:'completed',completed_at:old});const reopened=await call(path,{method,headers,data:{status:'open'}});assert.equal(reopened.status,200,JSON.stringify(reopened.body));assert.equal(r.get('tasks',task.id).completed_at,null);
  const completed=await call(path,{method,headers,data:{status:'completed'}});assert.equal(completed.status,200);const stamp=r.get('tasks',task.id).completed_at;assert.ok(Date.parse(stamp)>Date.parse(old));await call(path,{method,headers,data:{status:'completed'}});assert.equal(r.get('tasks',task.id).completed_at,stamp);
 }
 for(const path of [`/api/tasks/${task.id}/complete`,`/tasks/${task.id}/complete.json`]){r.update('tasks',task.id,{status:'open',completed_at:old});const completed=await call(path,{method:'POST',headers,data:{}});assert.equal(completed.status,200);assert.ok(Date.parse(r.get('tasks',task.id).completed_at)>Date.parse(old));}
 r.update('tasks',task.id,{status:'open',completed_at:old});const completed=await mutate('taskComplete',{id:task.id},'task','completedAt');assert.ok(Date.parse(completed.completedAt)>Date.parse(old));
 const explicit=await call(`/api/tasks/${task.id}`,{method:'PATCH',headers,data:{status:'open',completed_at:old}});assert.equal(explicit.status,200);assert.equal(r.get('tasks',task.id).completed_at,old);
});

test('Astra 92: internal preference writes reconcile totals atomically and preserve row IDs',async t=>{
 const {r,db,call,headers,mutate}=await fixture(t),clientId=r.list('clients')[0].id;
 const quote=await mutate('quoteCreate',{clientId,title:'Preference quote',taxRate:10,lineItems:[{name:'Quoted',unitPrice:10,taxable:true}]},'quote');
 r.update('quotes',quote.legacyId,{status:'approved'});const job=await mutate('quoteConvertToJob',{id:quote.id},'job'),name=`job_lines:${job.legacyId}`;
 const write=(method,data,id)=>call('/api/preferences'+(id?'/'+id:''),{method,headers,data});
 const first=await write('POST',{name,value_json:JSON.stringify([{name:'Replacement',unit_price_cents:2000}])});assert.equal(first.status,201);assert.equal(r.get('jobs',job.legacyId).total_cents,2200);
 const prefId=first.body.id,options=r.list('preferences',{name:`job_options:${job.legacyId}`})[0];assert.ok(options);
 const repost=await write('POST',{name,value_json:first.body.value_json});assert.equal(repost.status,201);assert.equal(repost.body.id,prefId);
 for(const method of ['PATCH','PUT']){const result=await write(method,{value_json:[{name:'Replacement',unit_price_cents:3000}]},prefId);assert.equal(result.status,200);assert.equal(result.body.id,prefId);assert.equal(r.get('jobs',job.legacyId).total_cents,3300);}
 const changed=await write('PUT',{value_json:{tax_rate:20,discount_type:'percent',discount_value:10}},options.id);assert.equal(changed.status,200);assert.equal(changed.body.id,options.id);assert.equal(r.get('jobs',job.legacyId).total_cents,3240);
 const ordinary=r.insert('preferences',{name:'ordinary92',value_json:'{}'}),snapshot=()=>({prefs:db.prepare('SELECT * FROM preferences ORDER BY id').all(),job:r.get('jobs',job.legacyId)}),before=snapshot();
 for(const [id,data] of [[prefId,{value_json:'{'}],[prefId,{value_json:{}}],[prefId,{value_json:[null]}],[prefId,{value_json:[[]]}],[prefId,{value_json:[7]}],[prefId,{name:'renamed'}],[ordinary.id,{name}],[options.id,{value_json:[]}],[options.id,{value_json:{unexpected:1}}],[options.id,{value_json:{discount_type:'bogus'}}]]){assert.equal((await write('PATCH',data,id)).status,400);assert.deepEqual(snapshot(),before);}
 for(const badName of ['job_lines:0','job_options:bogus','job_lines:999999']){assert.equal((await write('POST',{name:badName,value_json:'[]'})).status,400);assert.deepEqual(snapshot(),before);}
 const seq=r.list('preferences',{name:'job_line_seq'})[0];for(const value of [0,-1,1.5,'bad',null]){assert.equal((await write('PATCH',{value_json:JSON.stringify(value)},seq.id)).status,400);assert.deepEqual(snapshot(),before);}
 assert.equal((await call('/api/preferences/'+prefId,{method:'DELETE',headers})).status,200);assert.equal(r.get('jobs',job.legacyId).total_cents,1080);
 assert.equal((await call('/api/preferences/'+options.id,{method:'DELETE',headers})).status,200);assert.equal(r.get('jobs',job.legacyId).total_cents,1080);
});

test('Astra 93: deleting sequence preferences never reuses allocated job line IDs',async t=>{
 const {r,db,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Sequence'}),other=r.insert('jobs',{client_id:clientId,title:'Other sequence'});
 const put=id=>storeJobLines(db,1,id,[{name:'Line',unit_price_cents:100}])[0].id;
 const first=put(job.id),seq=r.list('preferences',{name:'job_line_seq'})[0];assert.equal((await call('/api/preferences/'+seq.id,{method:'DELETE',headers})).status,200);
 const second=put(other.id);assert.ok(second>first);
 const lines=r.list('preferences',{name:`job_lines:${other.id}`})[0],high=second+10000;r.update('preferences',lines.id,{value_json:JSON.stringify([{id:high,name:'Persisted high',unit_price_cents:100}])});
 assert.ok(put(job.id)>high);
 const last=put(other.id);for(const pref of r.list('preferences').filter(p=>p.name==='job_line_seq'||p.name===`job_lines:${job.id}`||p.name===`job_lines:${other.id}`))assert.equal((await call('/api/preferences/'+pref.id,{method:'DELETE',headers})).status,200);
 assert.ok(put(job.id)>last);
});

test('Astra 94: individual job line nodes ignore unrelated oversized jobs',async t=>{
 const {db,r,gql,owner}=await fixture(t),clientId=r.list('clients')[0].id,large=r.insert('jobs',{client_id:clientId,title:'Unrelated'});
 storeJobLines(db,1,large.id,Array.from({length:20001},()=>({name:'Hidden',unit_price_cents:1,is_optional:true})));
 const storedJob=r.insert('jobs',{client_id:clientId,title:'Stored'}),stored=storeJobLines(db,1,storedJob.id,[{name:'Target',unit_price_cents:123},{name:'Unselected',is_optional:true,unit_price_cents:1}]);
 const quote=r.insert('quotes',{client_id:clientId,title:'Quote'}),ql=r.insert('quote_line_items',{quote_id:quote.id,name:'Quoted',unit_price_cents:456,total_cents:456}),quotedJob=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Quoted job'}),fallback=r.insert('jobs',{client_id:clientId,title:'Fallback',total_cents:789});
 const lookup=id=>gql('query($id:ID!){node(id:$id){id ... on JobLineItem{name totalCents}}}',{id:encodeGid('JobLineItem',id)});
 for(const [id,name] of [[stored[0].id,'Target'],['quote:'+ql.id,'Quoted'],[fallback.id,'Fallback']]){const result=await lookup(id);assert.equal(result.errors,undefined,JSON.stringify(result));assert.equal(result.data.node.name,name);assert.ok(result.extensions.cost.actualQueryCost<100);}
 for(const id of [stored[1].id,99999999])assert.equal((await lookup(id)).data.node,null);
 storeJobLines(db,1,quotedJob.id,[]);assert.equal((await lookup('quote:'+ql.id)).data.node,null);
 const isolated=await executeGraphQL({db,user:{...owner,organization_id:2},query:`{node(id:"${encodeGid('JobLineItem',stored[0].id)}"){id}}`,authorize(){}});assert.equal(isolated.errors,undefined);assert.equal(isolated.data.node,null);
 const denied=await executeGraphQL({db,user:owner,query:`{node(id:"${encodeGid('JobLineItem',stored[0].id)}"){id}}`,authorize(){throw Object.assign(new Error('Jobs forbidden'),{status:403});}});assert.match(denied.errors[0].message,/Jobs forbidden/);
});

test('Astra 95: mixed legacy JSON cannot break unrelated job writes or Node lookups',async t=>{
 const {db,r,mutate,gql}=await fixture(t),clientId=r.list('clients')[0].id,high=7000000;
 for(const [i,value] of [['mixed',['text',null,7,false,[],['nested'],{id:'9000000'},{id:1.5},{id:high,name:'Legacy'}]],['string','text'],['null',null],['object',{id:9000000}]])r.insert('preferences',{name:'job_lines:legacy'+i,value_json:JSON.stringify(value)});
 const job=await mutate('jobCreate',{clientId,title:'Unrelated',lineItems:[{name:'New',unitPrice:1}]},'job','id legacyId lineItems{nodes{id legacyId name}}'),line=job.lineItems.nodes[0];assert.equal(line.legacyId,high+1);
 await mutate('jobEdit',{id:job.id,title:'Edited',lineItems:[{id:line.id,name:'Edited line',unitPrice:2}]},'job');
 const result=await gql(`{found:node(id:"${line.id}"){... on JobLineItem{name}} legacy:node(id:"${encodeGid('JobLineItem',high)}"){id}}`);assert.equal(result.errors,undefined);assert.equal(result.data.found.name,'Edited line');assert.equal(result.data.legacy,null);
 assert.equal(JSON.parse(r.list('preferences',{name:`job_lines:${job.legacyId}`})[0].value_json)[0].id,line.legacyId);
});

test('Astra 96: noncanonical preference suffixes cannot change pricing or deletion targets',async t=>{
 const {db,r,mutate,call,headers}=await fixture(t),clientId=r.list('clients')[0].id;
 const quote=await mutate('quoteCreate',{clientId,title:'Canonical',lineItems:[{name:'Quote',unitPrice:10}]},'quote');r.update('quotes',quote.legacyId,{status:'approved'});
 const job=await mutate('quoteConvertToJob',{id:quote.id},'job');await mutate('jobEdit',{id:job.id,lineItems:[{name:'Stored',unitPrice:20}]},'job');
 const snapshot=()=>({job:r.get('jobs',job.legacyId),prefs:db.prepare('SELECT * FROM preferences ORDER BY id').all()}),before=snapshot();
 for(const prefix of ['job_lines:','job_options:'])for(const suffix of ['0'+job.legacyId,'+'+job.legacyId,job.legacyId+'.0']){
  const name=prefix+suffix,value_json=prefix==='job_lines:'?'[]':'{"tax_rate":50}';
  const rejected=await call('/api/preferences',{method:'POST',headers,data:{name,value_json}});assert.equal(rejected.status,400);assert.match(JSON.stringify(rejected.body),/Invalid job_(lines|options) preference/);assert.deepEqual(snapshot(),before);
  const legacy=r.insert('preferences',{name,value_json}),withLegacy=snapshot();
  for(const method of ['PATCH','PUT']){assert.equal((await call('/api/preferences/'+legacy.id,{method,headers,data:{value_json}})).status,400);assert.deepEqual(snapshot(),withLegacy);}
  assert.equal((await call('/api/preferences/'+legacy.id,{method:'DELETE',headers})).status,200);assert.deepEqual(snapshot(),before);
 }
});

test('Astra 97: indexed Node lookups scan once per request and refresh changed ownership',async t=>{
 const {db,r,owner}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Indexed'}),other=r.insert('jobs',{client_id:clientId,title:'Moved'});
 const items=Array.from({length:20001},(_,i)=>({id:8000000+i,name:'Indexed',unit_price_cents:1,total_cents:1})),json=JSON.stringify(items),pref=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:json});let scans=0,parses=0;
 const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{assert.doesNotMatch(sql,/json_each/i);if(/SELECT id,organization_id,name,value_json FROM preferences/.test(sql))scans++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const lookup=id=>`node(id:"${encodeGid('JobLineItem',id)}"){... on JobLineItem{name}}`,run=query=>executeGraphQL({db:measured,user:owner,query,authorize(){}}),parse=JSON.parse;
 JSON.parse=function(value,...args){if(value===json)parses++;return parse(value,...args);};
 try{
  const query='{'+Array.from({length:100},(_,i)=>`a${i}:${lookup(i%2?99999999:8000000)}`).join(' ')+'}';
  for(let pass=0;pass<2;pass++){scans=0;const result=await run(query);assert.equal(result.errors,undefined);assert.equal(result.data.a0.name,'Indexed');assert.equal(result.data.a1,null);assert.equal(scans,1);assert.ok(result.extensions.cost.actualQueryCost>=200);assert.ok(result.extensions.cost.actualQueryCost<500);}
  assert.equal(parses,1);
 }finally{JSON.parse=parse;}
 r.update('preferences',pref.id,{value_json:JSON.stringify([{...items[0],name:'Changed'}])});assert.equal((await run('{'+lookup(8000000)+'}')).data.node.name,'Changed');assert.equal((await run('{'+lookup(8000001)+'}')).data.node,null);
 r.update('preferences',pref.id,{name:`job_lines:${other.id}`});db.prepare('DELETE FROM jobs WHERE id=?').run(job.id);assert.equal((await run('{'+lookup(8000000)+'}')).data.node.name,'Changed');
 const isolated=await executeGraphQL({db:measured,user:{...owner,organization_id:2},query:'{'+lookup(8000000)+'}',authorize(){}});assert.equal(isolated.data.node,null);
 r.update('preferences',pref.id,{name:`job_lines:0${other.id}`});assert.equal((await run('{'+lookup(8000000)+'}')).data.node,null);
 r.update('preferences',pref.id,{name:`job_lines:${other.id}`});assert.equal((await run('{'+lookup(8000000)+'}')).data.node.name,'Changed');
 db.prepare('DELETE FROM preferences WHERE id=?').run(pref.id);assert.equal((await run('{'+lookup(8000000)+'}')).data.node,null);
 const independent=createDatabase();seedDatabase(independent);try{const result=await executeGraphQL({db:independent,user:owner,query:'{'+lookup(8000000)+'}',authorize(){}});assert.equal(result.errors,undefined);assert.equal(result.data.node,null);}finally{independent.close();}
});

test('Astra 98: sequence exhaustion rejects atomically and ignores corrupt sequence values',async t=>{
 const {db,r,call,headers,gql}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Sequence boundary'}),max=Number.MAX_SAFE_INTEGER;
 const seq=r.insert('preferences',{name:'job_line_seq',value_json:String(max+1)}),line={name:'Line',unit_price_cents:100};
 const first=storeJobLines(db,1,job.id,[line])[0];assert.ok(first.id<max);
 for(const value of [max+1,1.5]){r.update('preferences',seq.id,{value_json:String(value)});assert.ok(storeJobLines(db,1,job.id,[line])[0].id<max);}
 const snapshot=()=>({jobs:db.prepare('SELECT * FROM jobs ORDER BY id').all(),prefs:db.prepare('SELECT * FROM preferences ORDER BY id').all()});
 for(const value of [max,max+1]){const before=snapshot();assert.equal((await call('/api/preferences/'+seq.id,{method:'PATCH',headers,data:{value_json:String(value)}})).status,400);assert.deepEqual(snapshot(),before);}
 r.update('preferences',seq.id,{value_json:String(max-1)});const before=snapshot();
 assert.throws(()=>storeJobLines(db,1,job.id,[line,line]),/Job line ID sequence exhausted/);assert.deepEqual(snapshot(),before);
 const result=await gql('mutation($input:Input!){jobCreate(input:$input){job{id} userErrors{message}}}',{input:{clientId,title:'Must roll back',lineItems:[line,line]}});assert.equal(result.errors,undefined);assert.match(result.data.jobCreate.userErrors[0].message,/Job line ID sequence exhausted/);assert.deepEqual(snapshot(),before);
 const last=storeJobLines(db,1,job.id,[line])[0];assert.equal(last.id,max);assert.equal(storeJobLines(db,1,job.id,[last])[0].id,max);const exhausted=snapshot();
 assert.throws(()=>storeJobLines(db,1,job.id,[last,last]),/Job line ID sequence exhausted/);assert.deepEqual(snapshot(),exhausted);
 const rejected=await call('/api/jobs',{method:'POST',headers,data:{client_id:clientId,title:'Exhausted',items:[line]}});assert.equal(rejected.status,400);assert.deepEqual(snapshot(),exhausted);
});

test('Astra 99: failed tax reconciliation rolls back durable sequence exhaustion',async t=>{
 const {db,r,call,headers}=await fixture(t),job=r.insert('jobs',{client_id:r.list('clients')[0].id,title:'Rollback allocator'}),max=Number.MAX_SAFE_INTEGER;
 storeJobOptions(db,1,job.id,{tax_rate:100});
 const seq=await call('/api/preferences',{method:'POST',headers,data:{name:'job_line_seq',value_json:String(max-1)}});assert.equal(seq.status,201);
 const snapshot=()=>({job:r.get('jobs',job.id),prefs:db.prepare('SELECT * FROM preferences ORDER BY id').all(),seq:db.prepare('SELECT * FROM _jobber_seq ORDER BY name').all()}),before=snapshot();
 const write=price=>call('/api/preferences',{method:'POST',headers,data:{name:`job_lines:${job.id}`,value_json:[{name:'Taxable',unit_price_cents:price,taxable:true}]}});
 const failed=await write(max);assert.equal(failed.status,400);assert.match(failed.body.error,/integer/);assert.deepEqual(snapshot(),before);
 const retried=await write(100);assert.equal(retried.status,201,JSON.stringify(retried.body));assert.equal(JSON.parse(retried.body.value_json)[0].id,max);assert.equal(r.get('jobs',job.id).total_cents,200);
 assert.equal(db.prepare("SELECT val FROM _jobber_seq WHERE name='job_line_seq:1'").get().val,max);
});

test('Astra 100: REST deletions preserve legacy allocation floors across disk reopen',async()=>{
 for(const mode of ['sequence-first','lines-first','job']){
  const dir=mkdtempSync(join(tmpdir(),'jobber-astra100-')),dbPath=join(dir,'jobber.sqlite');let server;
  try{
   server=await startServer({dbPath,port:0});const db=server.db,r=repository(db,1),clientId=r.list('clients')[0].id,owner=r.list('users')[0],job=r.insert('jobs',{client_id:clientId,title:'Deleted allocation'}),high=9000000;
   db.prepare('INSERT INTO sessions(token,user_id,organization_id,expires_at) VALUES(?,?,?,?)').run('astra100',owner.id,1,new Date(Date.now()+60000).toISOString());
   const seq=r.insert('preferences',{name:'job_line_seq',value_json:String(high-1)}),lines=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([{id:high,name:'Legacy line',unit_price_cents:100}])});
   const paths=mode==='job'?[`/api/jobs/${job.id}`,`/api/preferences/${seq.id}`]:mode==='sequence-first'?[`/api/preferences/${seq.id}`,`/api/preferences/${lines.id}`]:[`/api/preferences/${lines.id}`,`/api/preferences/${seq.id}`];
   for(const path of paths){const response=await fetch(server.url+path,{method:'DELETE',headers:{authorization:'Bearer astra100'}});assert.equal(response.status,200,await response.text());}
   assert.equal(r.list('preferences',{name:'job_line_seq'}).length,0);assert.equal(r.list('preferences',{name:`job_lines:${job.id}`}).length,0);
   await server.close();server=null;
   server=await startServer({dbPath,seed:false,port:0});const reopened=repository(server.db,1),next=reopened.insert('jobs',{client_id:clientId,title:'After restart'}),allocated=storeJobLines(server.db,1,next.id,[{name:'New',unit_price_cents:100}])[0];assert.ok(allocated.id>high,mode);
  }finally{if(server)await server.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('Astra 101: quote-backed Node aliases use cached existence checks without decoding overrides',async t=>{
 const {db,r,owner}=await fixture(t),clientId=r.list('clients')[0].id,quote=r.insert('quotes',{client_id:clientId,title:'Existence budget'}),ql=r.insert('quote_line_items',{quote_id:quote.id,name:'Quoted',unit_price_cents:100,total_cents:100}),job=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Override'});
 const json=JSON.stringify(Array.from({length:20001},(_,i)=>({id:8000000+i,name:'Stored',unit_price_cents:1}))),pref=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:json});let parses=0,checks=0,fullQuoteReads=0;
 const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT 1 FROM preferences/.test(sql))checks++;if(/SELECT \* FROM quote_line_items/.test(sql)&&/\bquote_id\b/.test(sql))fullQuoteReads++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const lookup=id=>`node(id:"${encodeGid('JobLineItem',id)}"){id}`,run=query=>executeGraphQL({db:measured,user:owner,query,authorize(){}}),parse=JSON.parse;
 JSON.parse=function(value,...args){if(value===json)parses++;return parse(value,...args);};
 try{
  const query='{'+Array.from({length:100},(_,i)=>`a${i}:${lookup('quote:'+ql.id)}`).join(' ')+'}',blocked=await run(query);
  assert.equal(blocked.errors,undefined);assert.ok(Object.values(blocked.data).every(v=>v===null));assert.equal(parses,0);assert.equal(checks,1);assert.ok(blocked.extensions.cost.actualQueryCost<500);
  r.update('preferences',pref.id,{value_json:'  []'});checks=0;assert.equal((await run(query)).data.a0,null);assert.equal(checks,1);
  db.prepare('DELETE FROM preferences WHERE id=?').run(pref.id);checks=0;const visible=await run(query);assert.equal(visible.errors,undefined);assert.equal(visible.data.a0.id,encodeGid('JobLineItem','quote:'+ql.id));assert.equal(checks,1);
  db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO quote_line_items(organization_id,quote_id,name) SELECT 1,?,'Extra' FROM n").run(quote.id);
  checks=0;const fallback=await run('{'+Array.from({length:100},(_,i)=>`a${i}:${lookup(job.id)}`).join(' ')+'}');assert.equal(fallback.errors,undefined);assert.ok(Object.values(fallback.data).every(v=>v===null));assert.equal(checks,1);assert.equal(fullQuoteReads,0);assert.equal(parses,0);
 }finally{JSON.parse=parse;}
});

test('Astra 102: legacy job preferences tolerate mixed lines and corrupt options on reads and replacement',async t=>{
 const {db,r,call,headers,gql,mutate}=await fixture(t),clientId=r.list('clients')[0].id;
 const a=r.insert('jobs',{client_id:clientId,title:'Fallback collision'}),b=r.insert('jobs',{client_id:clientId,title:'Legacy owner'});assert.equal(a.id,6);assert.equal(b.id,7);
 const retained={id:a.id,name:'Retained line',quantity:1,unit_price_cents:100,total_cents:100,taxable:0};r.insert('preferences',{name:`job_lines:${b.id}`,value_json:JSON.stringify([retained])});assert.equal(storeJobLines(db,1,b.id,[retained])[0].id,a.id);
 const collision=await gql(`{a:job(id:${a.id}){lineItems{nodes{id legacyId name}}} b:job(id:${b.id}){lineItems{nodes{id legacyId name}}}}`);assert.equal(collision.errors,undefined);
 const fallback={id:encodeGid('JobLineItem',a.id),legacyId:6,name:'Fallback collision'},stored={id:encodeGid('JobLineItem','line:'+a.id),legacyId:6,name:'Retained line'};
 assert.deepEqual(collision.data.a.lineItems.nodes,[fallback]);assert.deepEqual(collision.data.b.lineItems.nodes,[stored]);assert.notEqual(fallback.id,stored.id);
 for(const expected of [...collision.data.a.lineItems.nodes,...collision.data.b.lineItems.nodes,{...fallback,id:encodeGid('JobLineItem','job:'+a.id)}]){
  for(const id of [expected.id,Buffer.from(expected.id,'base64').toString()]){const result=await gql('query($id:ID!){node(id:$id){... on JobLineItem{id legacyId name}}}',{id});assert.equal(result.errors,undefined);assert.deepEqual(result.data.node,expected);}
 }
 const inactive=await gql(`{storedJob:node(id:"${encodeGid('JobLineItem','job:'+b.id)}"){id} missingLine:node(id:"${encodeGid('JobLineItem','line:'+b.id)}"){id}}`);assert.equal(inactive.errors,undefined);assert.deepEqual(inactive.data,{storedJob:null,missingLine:null});
 const created=await call('/api/jobs',{method:'POST',headers,data:{client_id:clientId,title:'Corrupt options invoice',tax_rate:0,items:[{name:'Line',unit_price_cents:100,taxable:0}]}});assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.subtotal_cents,100);assert.equal(created.body.total_cents,100);
 const options=r.list('preferences',{name:`job_options:${created.body.id}`})[0];r.update('preferences',options.id,{value_json:'{"discount_type":"invalid"}'});
 assert.equal((await call(`/api/jobs/${created.body.id}/complete`,{method:'POST',headers,data:{}})).status,200);
 const invoiced=await call(`/api/jobs/${created.body.id}/invoice`,{method:'POST',headers,data:{}});assert.equal(invoiced.status,200,JSON.stringify(invoiced.body));assert.equal(invoiced.body.job_id,created.body.id);assert.equal(invoiced.body.total_cents,100);assert.equal(r.get('invoices',invoiced.body.id).job_id,created.body.id);
 const mixed=[null,'bad',7,['nested'],{id:7000000,name:'Old',unit_price_cents:100}],quote=r.insert('quotes',{client_id:clientId,title:'Legacy quote'});
 for(const legacy of [mixed,{},null])for(const mode of ['patch','preference','graphql']){
  const job=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Legacy replacement'}),pref=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify(legacy)});
  const opts=r.insert('preferences',{name:`job_options:${job.id}`,value_json:'{"tax_rate":"bad","discount_type":"invalid"}'});
  const lines=[{id:7000000,name:'Reused',unit_price_cents:100},{name:'New',unit_price_cents:200}];
  if(mode==='graphql')await mutate('jobEdit',{id:job.id,lineItems:lines},'job');
  else {const result=await call(mode==='patch'?`/api/jobs/${job.id}`:`/api/preferences/${pref.id}`,{method:mode==='patch'?'PATCH':'PUT',headers,data:mode==='patch'?{items:lines}:{value_json:JSON.stringify(lines)}});assert.equal(result.status,200,JSON.stringify(result.body));}
  const stored=JSON.parse(r.get('preferences',pref.id).value_json);if(Array.isArray(legacy))assert.equal(stored[0].id,7000000);else assert.ok(stored[0].id>7000000);assert.ok(stored[1].id>7000000);
  for(const value of [null,[],7,{unknown:true},{discount_type:'invalid'},{tax_rate:'bad'},{discount_value:-1}]){
   r.update('preferences',opts.id,{value_json:JSON.stringify(value)});assert.equal(readJobOptions(db,1,job.id),null);
   assert.deepEqual(hydrateJobState(db,1,r.get('jobs',job.id))._storedOptions,{tax_rate:0,discount_type:'percent',discount_value:0});
  }
  r.update('preferences',opts.id,{value_json:'{}'});assert.deepEqual(readJobOptions(db,1,job.id),{});assert.deepEqual(hydrateJobState(db,1,r.get('jobs',job.id))._storedOptions,{});
  r.update('preferences',opts.id,{value_json:'{"tax_rate":5,"unknown":true}'});assert.deepEqual(hydrateJobState(db,1,r.get('jobs',job.id))._storedOptions,{tax_rate:5});
  db.prepare('DELETE FROM preferences WHERE id=?').run(pref.id);
 }
 for(const value of [null,[],7,{unknown:true},{discount_type:'invalid'},{tax_rate:'bad'},{discount_value:-1}]){
  const job=r.insert('jobs',{client_id:clientId,title:'Legacy invoice',status:'requires_invoicing',subtotal_cents:100,total_cents:100});
  r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify(mixed)});r.insert('preferences',{name:`job_options:${job.id}`,value_json:JSON.stringify(value)});
  assert.equal(readJobOptions(db,1,job.id),null);assert.equal(hydrateJobState(db,1,r.get('jobs',job.id))._storedOptions,null);
  const read=await gql(`{job(id:${job.id}){lineItems{nodes{name}}}}`);assert.equal(read.errors,undefined);assert.deepEqual(read.data.job.lineItems.nodes,[{name:'Old'}]);
  const invoice=await mutate('jobInvoice',{id:job.id},'invoice','lineItems{nodes{name}}');assert.deepEqual(invoice.lineItems.nodes,[{name:'Old'}]);
 }
 for(const taxRate of [0,5]){
  const quoted=await mutate('quoteCreate',{clientId,title:'Reset pricing',taxRate:10,lineItems:[{name:'Preserved quote line',unitPrice:100,taxable:true}]},'quote');
  r.update('quotes',quoted.legacyId,{status:'approved'});const converted=await mutate('quoteConvertToJob',{id:quoted.id},'job'),job=r.get('jobs',converted.legacyId);assert.equal(job.total_cents,11000);
  const reset=await call('/api/preferences',{method:'POST',headers,data:{name:`job_options:${job.id}`,value_json:'{}'}});assert.equal(reset.status,201,JSON.stringify(reset.body));assert.deepEqual(readJobOptions(db,1,job.id),{});
  const state=hydrateJobState(db,1,r.get('jobs',job.id));assert.deepEqual(state._storedOptions,{});assert.deepEqual(state._storedLines.map(l=>l.name),['Preserved quote line']);assert.equal(r.get('jobs',job.id).total_cents,10000);
  if(taxRate){const patched=await call(`/api/jobs/${job.id}`,{method:'PATCH',headers,data:{tax_rate:taxRate}});assert.equal(patched.status,200,JSON.stringify(patched.body));assert.equal(patched.body.total_cents,10500);}
  assert.equal((await call(`/api/jobs/${job.id}/complete`,{method:'POST',headers,data:{}})).status,200);
  const invoice=await call(`/api/jobs/${job.id}/invoice`,{method:'POST',headers,data:{}});assert.equal(invoice.status,200,JSON.stringify(invoice.body));assert.equal(invoice.body.total_cents,taxRate?10500:10000);assert.deepEqual(r.list('invoice_line_items',{invoice_id:invoice.body.id}).map(l=>l.name),['Preserved quote line']);
 }
 const job=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Corrupt calculation'}),pref=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:'[null,{"name":"Invalid","unit_price_cents":"bad"}]'});let charged=0;
 assert.doesNotThrow(()=>hydrateJobState(db,1,job,n=>{charged+=n;}));assert.equal(charged,3);
 for(const value of ['null','{}','7','"text"']){r.update('preferences',pref.id,{value_json:value});assert.doesNotThrow(()=>hydrateJobState(db,1,r.get('jobs',job.id)));}
});

test('Astra 103: every JSON whitespace prefix suppresses quote and fallback nodes without decoding overrides',async t=>{
 const {db,r,owner,gql}=await fixture(t),clientId=r.list('clients')[0].id,quote=r.insert('quotes',{client_id:clientId,title:'Whitespace quote'}),ql=r.insert('quote_line_items',{quote_id:quote.id,name:'Quoted',unit_price_cents:100}),job=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Whitespace override'}),pref=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:'[]'});
 const nodes=`quoted:node(id:"${encodeGid('JobLineItem','quote:'+ql.id)}"){id} fallback:node(id:"${encodeGid('JobLineItem',job.id)}"){id}`;
 for(const json of ['\n\t[]','\r\n [\n]',' \t\r\n[]']){
  r.update('preferences',pref.id,{value_json:json});const result=await gql(`{job(id:${job.id}){lineItems{nodes{id}}} ${nodes}}`);assert.equal(result.errors,undefined);assert.deepEqual(result.data,{job:{lineItems:{nodes:[]}},quoted:null,fallback:null});
 }
 const json='\r\n\t '+JSON.stringify(Array(20001).fill(null));r.update('preferences',pref.id,{value_json:json});const parse=JSON.parse;let parses=0;
 JSON.parse=function(value,...args){if(value===json)parses++;return parse(value,...args);};
 try{const result=await executeGraphQL({db,user:owner,query:`{${nodes}}`,authorize(){}});assert.equal(result.errors,undefined);assert.deepEqual({...result.data},{quoted:null,fallback:null});assert.equal(parses,0);}finally{JSON.parse=parse;}
 const bounded=await gql(`{job(id:${job.id}){lineItems{nodes{id}}}}`);assert.match(bounded.errors[0].message,/Execution cost exceeded/);
 db.prepare("INSERT INTO jobs(id,organization_id,client_id,title,subtotal_cents,total_cents) VALUES(1000000,1,?,'Million fallback',100,100)").run(clientId);
 const fallback=await gql('{job(id:1000000){lineItems{nodes{__typename id name}}}}');assert.equal(fallback.errors,undefined);assert.equal(fallback.data.job.lineItems.nodes.length,1);
 const line=fallback.data.job.lineItems.nodes[0];assert.deepEqual(line,{__typename:'JobLineItem',id:encodeGid('JobLineItem',1000000),name:'Million fallback'});
 const roundTrip=await gql('query($id:ID!){node(id:$id){__typename ... on JobLineItem{id name}}}',{id:line.id});assert.equal(roundTrip.errors,undefined);assert.deepEqual(roundTrip.data.node,line);
});

test('Astra 104: job line allocation and durable floors are tenant scoped',async t=>{
 const {db,r,call,headers}=await fixture(t),clientId=r.list('clients')[0].id;
 const org=Number(db.prepare("INSERT INTO organizations(name,slug) VALUES('Other tenant','other-tenant')").run().lastInsertRowid),other=repository(db,org),client=other.insert('clients',{display_name:'Other client'});
 const job=r.insert('jobs',{client_id:clientId,title:'Local'});
 db.prepare("INSERT INTO jobs(id,organization_id,client_id,title) VALUES(2000000,?,?,'Foreign')").run(org,client.id);
 const foreign=other.get('jobs',2000000),floor=maxJobLineSeq(db,1);
 assert.equal(floor,1000000);
 other.insert('preferences',{name:`job_lines:${foreign.id}`,value_json:JSON.stringify([{id:Number.MAX_SAFE_INTEGER,name:'Legacy'}])});
 other.insert('preferences',{name:'job_line_seq',value_json:String(Number.MAX_SAFE_INTEGER)});saveJobLineSeq(db,Number.MAX_SAFE_INTEGER,org);
 assert.equal(maxJobLineSeq(db,org),Number.MAX_SAFE_INTEGER);assert.equal(maxJobLineSeq(db,1),floor);
 const lines=storeJobLines(db,1,job.id,[{name:'Local line',unit_price_cents:100}]);assert.equal(lines[0].id,floor+1);
 const pref=r.list('preferences',{name:`job_lines:${job.id}`})[0];
 for(const path of [`/api/preferences/${pref.id}`,`/api/jobs/${job.id}`])assert.equal((await call(path,{method:'DELETE',headers})).status,200);
 assert.equal(maxJobLineSeq(db,1),floor+1);assert.equal(db.prepare('SELECT val FROM _jobber_seq WHERE name=?').get('job_line_seq:1').val,floor+1);
 const next=r.insert('jobs',{client_id:clientId,title:'Next'}),nextFloor=maxJobLineSeq(db,1);assert.equal(nextFloor,next.id*1000);assert.equal(storeJobLines(db,1,next.id,[{name:'Next line'}])[0].id,nextFloor+1);
});

test('Astra 105: manual job options recalculate and survive invoicing',async t=>{
 const {r,call,headers,mutate,gql}=await fixture(t),clientId=r.list('clients')[0].id;
 const send=async(path,method,data)=>{const result=await call(path,{method,headers,data});assert.ok(result.status<300,JSON.stringify(result.body));return result.body;};
 for(const mode of ['graphql','rest','preference']){
  const job=mode==='graphql'?await mutate('jobCreate',{clientId,title:'Manual',total:100,discountType:'PERCENT',discountValue:10,taxRate:5},'job'):await send('/api/jobs','POST',{client_id:clientId,title:'Manual',total_cents:10000,...(mode==='rest'?{discount_type:'percent',discount_value:10,tax_rate:5}:{})});
  const id=job.legacyId||job.id;
  if(mode==='preference')await send('/api/preferences','POST',{name:`job_options:${id}`,value_json:JSON.stringify({discount_type:'percent',discount_value:10,tax_rate:5})});
  assert.equal(r.get('jobs',id).subtotal_cents,10000);assert.equal(r.get('jobs',id).tax_cents,450);assert.equal(r.get('jobs',id).total_cents,9450);
  if(mode==='graphql')await mutate('jobEdit',{id,discountValue:20},'job');else await send(`/api/jobs/${id}`,'PATCH',{discount_value:20});
  assert.equal(r.get('jobs',id).total_cents,8400);
  const bad=await gql('mutation($input:Input!){jobEdit(input:$input){userErrors{message}}}',{input:{id,total:1}});assert.match(bad.data.jobEdit.userErrors[0].message,/does not match calculated options/);assert.equal(r.get('jobs',id).total_cents,8400);
  await send(`/api/jobs/${id}`,'PATCH',{subtotal_cents:20000});assert.equal(r.get('jobs',id).total_cents,16800);
  await mutate('jobComplete',{id},'job');const created=await mutate('jobInvoice',{id},'invoice'),invoice=r.get('invoices',created.legacyId);
  assert.equal(invoice.subtotal_cents,20000);assert.equal(invoice.tax_cents,800);assert.equal(invoice.total_cents,16800);assert.equal(invoice.discount_type,'percent');assert.equal(invoice.discount_value,20);assert.equal(invoice.tax_rate,5);
 }
 assert.throws(()=>normalizeInput({subtotal:100,total:100,taxRate:5},'Job'),/does not match calculated options/);
 assert.equal(normalizeInput({total:100,taxRate:5},'Job').total_cents,10500);
 assert.equal(normalizeInput({total:0,taxRate:5},'Job').total_cents,0);
});

test('Astra 106: duplicate legacy line IDs keep canonical ownership and are repaired on write',async t=>{
 const {db,r,gql}=await fixture(t),clientId=r.list('clients')[0].id,a=r.insert('jobs',{client_id:clientId,title:'Canonical'}),b=r.insert('jobs',{client_id:clientId,title:'Duplicate'});
 const original={id:7000000,name:'Canonical line',unit_price_cents:100},duplicate={...original,name:'Duplicate line'};
 const pref=r.insert('preferences',{name:`job_lines:${a.id}`,value_json:JSON.stringify([original])});r.insert('preferences',{name:`job_lines:${b.id}`,value_json:JSON.stringify([duplicate])});
 const query=`{node(id:"${encodeGid('JobLineItem','line:'+original.id)}"){... on JobLineItem{name}}}`;
 assert.equal((await gql(query)).data.node.name,original.name);
 r.update('preferences',pref.id,{value_json:JSON.stringify([{...original,name:'Updated canonical'}])});assert.equal((await gql(query)).data.node.name,'Updated canonical');
 const repaired=storeJobLines(db,1,b.id,[duplicate,duplicate]);assert.ok(repaired.every(l=>l.id>original.id));assert.notEqual(repaired[0].id,repaired[1].id);
 assert.equal((await gql(query)).data.node.name,'Updated canonical');assert.equal(storeJobLines(db,1,a.id,[original])[0].id,original.id);
 assert.deepEqual(storeJobLines(db,1,b.id,repaired).map(l=>l.id),repaired.map(l=>l.id));
});

test('Astra 107: persisted mutation work is charged before dispatch even without entity selections',async t=>{
 const {db,r,owner}=await fixture(t),clientId=r.list('clients')[0].id;
 const quote=r.insert('quotes',{client_id:clientId,title:'Large quote',status:'approved'}),invoice=r.insert('invoices',{client_id:clientId,subject:'Large invoice'});
 for(const [table,key,id] of [['quote_line_items','quote_id',quote.id],['invoice_line_items','invoice_id',invoice.id]])db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO ${table}(organization_id,${key},name) SELECT 1,?,'Line' FROM n`).run(id);
 const job=r.insert('jobs',{client_id:clientId,title:'Stored work',status:'requires_invoicing'});r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify(Array(20001).fill({name:'Line',unit_price_cents:1}))});
 const quoted=r.insert('jobs',{client_id:clientId,title:'Quoted work',quote_id:quote.id,status:'requires_invoicing'}),visited=r.insert('jobs',{client_id:clientId,title:'Visit work',billing_type:'visit_based',status:'requires_invoicing'});
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO visits(organization_id,job_id,client_id,title,status) SELECT 1,?,?,'Visit','completed' FROM n").run(visited.id,clientId);
 let dispatched=0;const run=(name,input)=>executeGraphQL({db,user:owner,query:`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 for(const [name,input] of [['jobInvoice',{id:job.id}],['jobInvoice',{id:quoted.id}],['jobInvoice',{id:visited.id}],['quoteConvertToJob',{id:quote.id}],['quoteEdit',{id:quote.id,title:'Changed'}],['invoiceEdit',{id:invoice.id,subject:'Changed'}]]){
  const result=await run(name,input);assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/,JSON.stringify(result));assert.equal(dispatched,0);
 }
 const small=r.insert('jobs',{client_id:clientId,title:'Small'});const result=await run('jobInvoice',{id:small.id,visitIds:[1,2]});assert.equal(result.errors,undefined);assert.equal(dispatched,1);
 assert.equal(r.get('quotes',quote.id).title,'Large quote');assert.equal(r.get('invoices',invoice.id).subject,'Large invoice');assert.equal(r.list('invoices').filter(i=>i.job_id===job.id).length,0);
});

test('Astra 108: legacy invoice lines preserve calculated prices and omitted taxability',async t=>{
 const {r,mutate}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const [line,total] of [[{name:'Line',unit_price_cents:10000},10000],[{name:'Line',unit_cost_cents:10000,markup_percent:20},12000]]){
  const job=r.insert('jobs',{client_id:clientId,title:'Legacy',status:'requires_invoicing',subtotal_cents:total,total_cents:total});
  r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([line])});r.insert('preferences',{name:`job_options:${job.id}`,value_json:JSON.stringify({tax_rate:10})});
  const created=await mutate('jobInvoice',{id:job.id},'invoice'),invoice=r.get('invoices',created.legacyId),items=r.list('invoice_line_items',{invoice_id:invoice.id});
  assert.equal(invoice.subtotal_cents,total);assert.equal(invoice.tax_cents,0);assert.equal(invoice.total_cents,total);assert.equal(items[0].unit_price_cents,total);assert.equal(items[0].total_cents,total);assert.equal(items[0].taxable,0);
 }
});

test('Astra 109: visit scans and completion work exhaust budgets before dispatch',async t=>{
 const {db,r,owner}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Fixed work',billing_type:'fixed_price',status:'requires_invoicing'});
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO visits(organization_id,job_id,client_id,title,status) SELECT 1,?,?,'Visit','completed' FROM n").run(job.id,clientId);
 const visit=r.insert('visits',{job_id:job.id,client_id:clientId,title:'Checklist work',status:'unscheduled'}),checklist=r.insert('checklists',{visit_id:visit.id,title:'Checklist'});
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO checklist_items(organization_id,checklist_id,label,is_completed) SELECT 1,?,'Item',1 FROM n").run(checklist.id);
 let dispatched=0;const run=(name,input)=>executeGraphQL({db,user:owner,query:`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 for(const [name,id] of [['jobInvoice',job.id],['jobComplete',job.id],['visitComplete',visit.id]]){const result=await run(name,{id});assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/,JSON.stringify(result));assert.equal(dispatched,0);}
 db.prepare('DELETE FROM checklist_items WHERE checklist_id=?').run(checklist.id);
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO checklists(organization_id,visit_id,title) SELECT 1,?,'Checklist' FROM n").run(visit.id);
 assert.match((await run('visitComplete',{id:visit.id})).errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(dispatched,0);
 assert.equal(r.get('visits',visit.id).status,'unscheduled');assert.equal(r.get('jobs',job.id).status,'requires_invoicing');assert.equal(r.list('invoices',{job_id:job.id}).length,0);
 const small=r.insert('jobs',{client_id:clientId,title:'Small'}),smallVisit=r.insert('visits',{job_id:small.id,client_id:clientId,title:'Small visit'});
 for(const [name,input] of [['jobInvoice',{id:job.id,visitIds:[smallVisit.id]}],['jobInvoice',{id:small.id}],['jobComplete',{id:small.id}],['visitComplete',{id:smallVisit.id}]])assert.equal((await run(name,input)).errors,undefined);
 assert.equal(dispatched,4);
});

test('Astra 110: editing the canonical owner first retains its legacy line identity',async t=>{
 const {db,r,gql}=await fixture(t),clientId=r.list('clients')[0].id,a=r.insert('jobs',{client_id:clientId,title:'Canonical'}),b=r.insert('jobs',{client_id:clientId,title:'Duplicate'}),line={id:7000000,name:'Original',unit_price_cents:100};
 for(const job of [a,b])r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([line])});
 const query=`{node(id:"${encodeGid('JobLineItem','line:7000000')}"){... on JobLineItem{name}}}`;
 assert.equal(storeJobLines(db,1,a.id,[{...line,name:'Edited canonical'}])[0].id,line.id);assert.equal((await gql(query)).data.node.name,'Edited canonical');
 const repaired=storeJobLines(db,1,b.id,[{...line,name:'Edited duplicate'}]);assert.ok(repaired[0].id>line.id);assert.equal((await gql(query)).data.node.name,'Edited canonical');assert.equal(storeJobLines(db,1,b.id,repaired)[0].id,repaired[0].id);
});

test('Astra 111: boolean filters normalize scalars, operators, arrays and field aliases',async t=>{
 const {r,gql}=await fixture(t);
 const yes=r.insert('products_services',{name:'Boolean yes',taxable:1,active:1}),no=r.insert('products_services',{name:'Boolean no',taxable:0,active:0});
 for(const field of ['taxable','visible'])for(const [value,id] of [[true,yes.id],[false,no.id]])for(const filter of [value,{eq:value},{in:[value]},[value],String(value),{eq:String(value)},{in:[String(value)]},[String(value)]]){
  const result=await gql('query($filter:Input!){productsAndServices(searchTerm:"Boolean",filter:$filter){nodes{legacyId}}}',{filter:{[field]:filter}});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.productsAndServices.nodes.map(n=>n.legacyId),[id]);
 }
 const company=r.insert('clients',{display_name:'Boolean company',company_name:'Company',status:'lead'}),archived=r.insert('clients',{display_name:'Boolean archived',status:'archived'});
 for(const [field,id] of [['isCompany',company.id],['isLead',company.id],['isArchived',archived.id]]){const result=await gql('query($filter:Input!){clients(searchTerm:"Boolean",filter:$filter){nodes{legacyId}}}',{filter:{[field]:true}});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.clients.nodes.map(n=>n.legacyId),[id]);}
 const job=r.insert('jobs',{client_id:company.id,title:'Boolean job'}),visit=r.insert('visits',{job_id:job.id,client_id:company.id,title:'Boolean done',status:'completed'});r.insert('visits',{job_id:job.id,client_id:company.id,title:'Boolean pending'});
 const result=await gql('{visits(searchTerm:"Boolean",filter:{isComplete:{eq:true}}){nodes{legacyId}}}');assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.visits.nodes.map(n=>n.legacyId),[visit.id]);
});

test('Astra 112: payment, merge and scheduling scans are charged before dispatch',async t=>{
 const {db,r,owner}=await fixture(t),client=r.insert('clients',{display_name:'Budget client'}),small=r.insert('clients',{display_name:'Small client'}),invoice=r.insert('invoices',{client_id:client.id,subject:'Budget'}),quote=r.insert('quotes',{client_id:client.id,title:'Budget'}),payment=r.insert('payments',{client_id:client.id,amount_cents:100}),job=r.insert('jobs',{client_id:client.id,title:'Budget'}),visit=r.insert('visits',{client_id:client.id,job_id:job.id,title:'Budget'}),request=r.insert('requests',{client_id:client.id,title:'Budget'});
 let dispatched=0;const run=(name,input)=>executeGraphQL({db,user:owner,query:`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 const blocked=async(name,input)=>{const before=dispatched,result=await run(name,input);assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/,JSON.stringify(result));assert.equal(dispatched,before);};
 const paymentCases=[['paymentRecordCreate',{clientId:client.id,amount:1}],['paymentRecordCreate',{invoiceId:invoice.id,amount:1}],['paymentRecordCreate',{quoteId:quote.id,amount:1}],['invoiceRecordPayment',{id:invoice.id,amount:1}],['invoiceSend',{id:invoice.id}],['invoiceApplyDeposit',{id:invoice.id,paymentId:payment.id}],['invoiceCredit',{id:invoice.id,amount:1}],['paymentRefund',{id:payment.id,amount:1}]];
 const bulk='WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) ';
 db.prepare(bulk+"INSERT INTO invoices(organization_id,client_id,subject) SELECT 1,?,'Bulk' FROM n").run(client.id);
 for(const [name,input] of paymentCases)await blocked(name,input);
 await blocked('clientMerge',{sourceId:client.id,targetId:small.id});
 db.prepare('DELETE FROM invoices WHERE client_id=? AND id<>?').run(client.id,invoice.id);
 for(const table of ['payment_allocations','refunds']){
  db.prepare(bulk+`INSERT INTO ${table}(organization_id,payment_id,invoice_id${table==='refunds'?',client_id':''}) SELECT 1,?,?${table==='refunds'?',?':''} FROM n`).run(payment.id,invoice.id,...(table==='refunds'?[client.id]:[]));
  for(const [name,input] of paymentCases)await blocked(name,input);
  const smallInvoice=r.insert('invoices',{client_id:small.id,subject:'Payment-only scan'});
  await blocked('invoiceApplyDeposit',{id:smallInvoice.id,paymentId:payment.id});
  db.prepare(`DELETE FROM ${table} WHERE payment_id=?`).run(payment.id);
 }
 db.prepare(bulk+'INSERT INTO appointments(organization_id,entity_id) SELECT 1,x+1000 FROM n').run();
 for(const [name,input] of [['requestScheduleAssessment',{id:request.id}],['visitReschedule',{id:visit.id}],['visitCreate',{jobId:job.id,startAt:'2026-11-01T10:00:00Z'}]])await blocked(name,input);
 for(const [name,input] of [...paymentCases,['clientMerge',{sourceId:client.id,targetId:small.id}],['visitCreate',{jobId:job.id}]]){const before=dispatched,result=await run(name,input);assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data[name].userErrors,[]);assert.equal(dispatched,before+1);}
 db.prepare('DELETE FROM appointments WHERE organization_id=1').run();
 const scheduled=await run('visitReschedule',{id:visit.id});assert.equal(scheduled.errors,undefined);assert.deepEqual(scheduled.data.visitReschedule.userErrors,[]);
 assert.equal(r.get('payments',payment.id).refunded_cents,0);assert.equal(r.get('invoices',invoice.id).status,'draft');
});

test('Astra 113: invalid numeric preferences reject atomically instead of changing totals',async t=>{
 const {db,r,call,headers}=await fixture(t),job=r.insert('jobs',{client_id:r.list('clients')[0].id,title:'Strict numbers'}),line={name:'Taxable',unit_price_cents:10000,taxable:1};
 storeJobLines(db,1,job.id,[line]);storeJobOptions(db,1,job.id,{tax_rate:5,discount_value:10});
 const snapshot=()=>({job:r.get('jobs',job.id),prefs:db.prepare('SELECT * FROM preferences ORDER BY id').all(),seq:db.prepare('SELECT * FROM _jobber_seq ORDER BY name').all()});
 for(const value of [false,true,null,'','   ','\t\n']){
  for(const options of [{tax_rate:value},{discount_value:value},{discount_type:'fixed',discount_value:value},{required_deposit_value:value},{required_deposit_type:'percent',required_deposit_value:value},{required_deposit_type:'fixed',required_deposit_value:value}])assert.throws(()=>calculateDocument([line],options),/Expected nonnegative/);
  for(const key of ['unit_cost_cents','markup_percent'])for(const priced of [true,false])assert.throws(()=>calculateDocument([{name:'Line',...(priced?{unit_price_cents:100}:{}),[key]:value}]),/Expected nonnegative/);
  for(const options of [{tax_rate:value},{discount_value:value},{discount_type:'fixed',discount_value:value}]){
   const before=snapshot();assert.throws(()=>storeJobOptions(db,1,job.id,options),/Expected nonnegative/);assert.deepEqual(snapshot(),before);
   const result=await call('/api/preferences',{method:'POST',headers,data:{name:`job_options:${job.id}`,value_json:JSON.stringify(options)}});assert.equal(result.status,400,JSON.stringify(result.body));assert.deepEqual(snapshot(),before);
  }
  for(const key of ['unit_cost_cents','markup_percent']){
   const before=snapshot(),result=await call('/api/preferences',{method:'POST',headers,data:{name:`job_lines:${job.id}`,value_json:[{...line,[key]:value}]}});assert.equal(result.status,400,JSON.stringify(result.body));assert.deepEqual(snapshot(),before);
  }
 }
 const pref=r.list('preferences',{name:`job_options:${job.id}`})[0];
 for(const value of [false,null,'','   ']){r.update('preferences',pref.id,{value_json:JSON.stringify({tax_rate:value})});assert.equal(readJobOptions(db,1,job.id),null);}
 assert.equal(calculateDocument([line],{tax_rate:0,discount_value:0,required_deposit_value:0}).total_cents,10000);
 assert.equal(calculateDocument([{name:'Cost',unit_cost_cents:100,markup_percent:'20'}],{tax_rate:'0',discount_value:'0'}).total_cents,120);
});

test('Astra 114: unselected lines validate quantities and explicit null prices atomically',async t=>{
 const {db,r,gql,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Quantity validation'}),line={name:'Optional',unit_price_cents:100,is_optional:true,is_selected:false};
 storeJobLines(db,1,job.id,[line]);
 const snapshot=()=>({jobs:r.list('jobs'),quotes:r.list('quotes'),invoices:r.list('invoices'),prefs:r.list('preferences'),seq:db.prepare('SELECT * FROM _jobber_seq ORDER BY name').all()});
 for(const patch of [...[true,false,null,'','  ',0,-1,'garbage','1e2','0.0000001',[],{}].map(quantity=>({quantity})),{unit_price_cents:null}]){
  const item={...line,...patch},before=snapshot();assert.throws(()=>calculateDocument([item]));assert.throws(()=>storeJobLines(db,1,job.id,[item]));assert.deepEqual(snapshot(),before);
  const pref=await call('/api/preferences',{method:'POST',headers,data:{name:`job_lines:${job.id}`,value_json:[item]}});assert.equal(pref.status,400);assert.deepEqual(snapshot(),before);
  for(const type of ['job','quote','invoice']){const result=await gql(`mutation($input:Input!){${type}Create(input:$input){userErrors{message}}}`,{input:{clientId,title:'Invalid',lineItems:[item]}});assert.equal(result.errors,undefined);assert.ok(result.data[type+'Create'].userErrors.length);assert.deepEqual(snapshot(),before);}
 }
 for(const quantity of [undefined,1,'1.5']){const result=calculateDocument([{...line,quantity}]);assert.equal(result.total_cents,0);assert.equal(result.lines[0].quantity,quantity??1);}
 assert.equal(calculateDocument([{...line,is_selected:true,quantity:'1.5'}]).total_cents,150);
});

test('Astra 115: client merge charges previously omitted tables before dispatch',async t=>{
 const {db,r,owner}=await fixture(t),source=r.insert('clients',{display_name:'Merge source'}),target=r.insert('clients',{display_name:'Merge target'}),payment=r.insert('payments',{client_id:source.id}),tag=r.insert('tags',{name:'Merge tag'}),field=r.insert('custom_field_definitions',{entity_type:'clients',field_name:'Merge',field_key:'merge'});
 let dispatched=0;const run=()=>executeGraphQL({db,user:owner,query:'mutation($input:Input!){clientMerge(input:$input){userErrors{message}}}',variables:{input:{sourceId:source.id,targetId:target.id}},authorize(){},dispatch(){dispatched++;return {};}});
 const cases=[['client_contacts','client_id,name',`${source.id},'Contact'`],['properties','client_id',`${source.id}`],['tasks','client_id,title',`${source.id},'Task'`],['messages','client_id',`${source.id}`],['activity_logs','client_id',`${source.id}`],['refunds','client_id,payment_id',`${source.id},${payment.id}`],['online_bookings','client_id,confirmation_code',`${source.id},'merge-'||x`],['ai_receptionist_logs','client_id',`${source.id}`],['entity_tags','entity_type,entity_id,tag_id',`'clients',${source.id},${tag.id}`],['custom_field_values','entity_type,entity_id,field_definition_id',`'clients',${source.id},${field.id}`],['attachments','entity_type,entity_id,file_name',`'clients',${source.id},'file'`]];
 for(const [table,fields,values] of cases){
  db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO ${table}(organization_id,${fields}) SELECT 1,${values} FROM n`);
  const before=dispatched,result=await run();assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/,table);assert.equal(dispatched,before);assert.equal(r.get('clients',source.id).status,'lead');
  db.prepare(`DELETE FROM ${table} WHERE organization_id=1 AND ${fields.startsWith('client_id')?'client_id':'entity_id'}=?`).run(source.id);
 }
 const result=await run();assert.equal(result.errors,undefined);assert.deepEqual(result.data.clientMerge.userErrors,[]);assert.equal(dispatched,1);
});

test('Astra 116: job line indexes query and refresh only the current tenant',async t=>{
 const {db,r,owner}=await fixture(t),org=Number(db.prepare("INSERT INTO organizations(name,slug) VALUES('Other','astra116')").run().lastInsertRowid),other=repository(db,org),client=other.insert('clients',{display_name:'Other'}),a=r.insert('jobs',{client_id:r.list('clients')[0].id,title:'Local'}),b=other.insert('jobs',{client_id:client.id,title:'Foreign'}),line={id:7000000,name:'Local line',unit_price_cents:100};
 const local=r.insert('preferences',{name:`job_lines:${a.id}`,value_json:JSON.stringify([line])}),foreign=other.insert('preferences',{name:`job_lines:${b.id}`,value_json:JSON.stringify([{...line,name:'Foreign line'},{...line,id:9000000}])});
 const prepare=db.prepare.bind(db),scans=[];db.prepare=function(sql){const statement=prepare(sql);if(sql.includes("name GLOB 'job_lines:*'")){const all=statement.all.bind(statement);statement.all=(...args)=>{assert.match(sql,/WHERE organization_id=\?/);assert.equal(args.length,1);const rows=all(...args);assert.ok(rows.every(row=>row.organization_id===args[0]));scans.push(args[0]);return rows;};}return statement;};t.after(()=>{db.prepare=prepare;});
 const lookup=async(tenant,prefix='line:')=>{const result=await executeGraphQL({db,user:{...owner,organization_id:tenant},query:`{node(id:"${encodeGid('JobLineItem',prefix+line.id)}"){... on JobLineItem{name}}}`,authorize(){},dispatch(){throw new Error('Unexpected dispatch');}});assert.equal(result.errors,undefined);return result.data.node;};
 assert.equal((await lookup(1)).name,'Local line');assert.deepEqual(scans,[1]);assert.equal((await lookup(org)).name,'Foreign line');assert.equal((await lookup(1,'')).name,'Local line');
 assert.equal(maxJobLineSeq(db,1),7000000);assert.equal(maxJobLineSeq(db,org),9000000);assert.equal(storeJobLines(db,1,a.id,[{...line,name:'Edited'}])[0].id,line.id);assert.equal((await lookup(1)).name,'Edited');assert.equal((await lookup(org)).name,'Foreign line');
 db.prepare('DELETE FROM preferences WHERE organization_id=1 AND id=?').run(local.id);assert.equal(await lookup(1),null);assert.equal((await lookup(org)).name,'Foreign line');other.update('preferences',foreign.id,{value_json:'[]'});assert.equal(await lookup(org),null);
});

test('Astra 117: OAuth bounds client IDs, redirect URIs and state before retaining grants',async t=>{
 const {db,headers}=await fixture(t),redirect='https://example.test/'+ 'x'.repeat(2027),clientId='c'.repeat(256),auth=createAuth(db,{oauthClients:{[clientId]:{redirectUris:[redirect]}}}),req={headers},base={response_type:'code',client_id:clientId};
 assert.equal(redirect.length,2048);
 const sessions=()=>db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,before=sessions();
 for(const value of [' ', 'c'.repeat(257),1,true,[],{}]){
  assert.throws(()=>auth.authorize(req,{...base,client_id:value}),/Invalid client_id/);
  assert.throws(()=>auth.exchange({grant_type:'authorization_code',client_id:value},req),e=>e.status===400&&/Invalid client_id/.test(e.message));
 }
 for(const [field,values] of [['redirect_uri',[redirect+'x',1,false,[],{}]],['state',['s'.repeat(1025),1,false,[],{}]]])for(const value of values)assert.throws(()=>auth.authorize(req,{...base,[field]:value}),new RegExp('Invalid '+field));
 assert.equal(sessions(),before);
 const grant=auth.authorize(req,{...base,redirect_uri:redirect,state:'s'.repeat(1024)});assert.equal(grant.state.length,1024);
 const input={grant_type:'authorization_code',client_id:clientId,redirect_uri:redirect,code:grant.code};
 assert.throws(()=>auth.exchange({...input,client_id:'c'.repeat(257)},req),/Invalid client_id/);
 const access=auth.exchange(input,req);assert.ok(access.access_token);assert.equal(sessions(),before+1);
 assert.ok(auth.exchange({grant_type:'refresh_token',client_id:clientId,refresh_token:access.refresh_token},req).access_token);
 assert.throws(()=>auth.exchange(input,req),/Invalid authorization code/);
 assert.ok(auth.authorize(req,{...base,redirect_uri:null,state:null}).code);
});

test('Astra 118: scheduled filters round-trip concrete IDs without cross-type collisions',async t=>{
 const {db,r,gql}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Scheduled identity'}),id=900001;
 db.prepare("INSERT INTO visits(id,organization_id,job_id,client_id,title) VALUES(?,1,?,?,'Scheduled identity')").run(id,job.id,clientId);
 db.prepare("INSERT INTO requests(id,organization_id,client_id,title) VALUES(?,1,?,'Scheduled identity')").run(id,clientId);
 db.prepare("INSERT INTO tasks(id,organization_id,title) VALUES(?,1,'Scheduled identity')").run(id);
 const appointment=r.insert('appointments',{entity_type:'assessment',entity_id:id,title:'Scheduled identity'});assert.notEqual(appointment.id,id);
 const run=filter=>gql('query($filter:Input!){scheduledItems(searchTerm:"Scheduled identity",filter:$filter){nodes{__typename id legacyId} totalCount}}',{filter});
 const all=await run({});assert.equal(all.errors,undefined);assert.equal(all.data.scheduledItems.totalCount,3);
 for(const node of all.data.scheduledItems.nodes)for(const value of [node.id,Buffer.from(node.id,'base64').toString()])for(const key of ['id','scheduledItemId'])for(const filter of [value,{eq:value},{in:[value]},[value]]){
  const result=await run({[key]:filter});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.scheduledItems.nodes,[node]);
 }
 for(const value of [id,String(id),encodeGid('ScheduledItem',id),'gid://jobber/ScheduledItem/'+id])for(const filter of [value,{eq:value},{in:[value]},[value]]){const result=await run({id:filter});assert.equal(result.errors,undefined);assert.equal(result.data.scheduledItems.totalCount,3);}
 assert.equal((await run({legacyId:{eq:id}})).data.scheduledItems.totalCount,3);
 for(const value of [encodeGid('Client',id),'garbage',true,'gid://jobber/Visit/0'])assert.match((await run({id:value})).errors?.[0]?.message||'',/Invalid Global ID/);
 assert.equal((await run({id:{eq:null}})).data.scheduledItems.totalCount,0);
 const ids=all.data.scheduledItems.nodes.slice(0,2).map(n=>n.id);assert.deepEqual((await run({id:{in:ids}})).data.scheduledItems.nodes,all.data.scheduledItems.nodes.slice(0,2));
});

test('Astra 119: fixed-job invoice history consumes budget before dispatch',async t=>{
 const {db,r,owner,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Invoice history',billing_type:'fixed_price',status:'requires_invoicing'});
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO invoices(organization_id,client_id,job_id,subject,status) SELECT 1,?,?,'History','void' FROM n").run(clientId,job.id);
 let dispatched=0;const run=input=>executeGraphQL({db,user:owner,query:'mutation($input:Input!){jobInvoice(input:$input){userErrors{message}}}',variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 const blocked=await run({id:job.id});assert.match(blocked.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(dispatched,0);assert.equal(r.get('jobs',job.id).status,'requires_invoicing');
 assert.equal((await run({id:job.id,visitIds:[1]})).errors,undefined);assert.equal(dispatched,1);
 r.update('jobs',job.id,{billing_type:'visit_based'});assert.equal((await run({id:job.id})).errors,undefined);assert.equal(dispatched,2);
 r.update('jobs',job.id,{billing_type:'fixed_price'});db.prepare('DELETE FROM invoices WHERE job_id=?').run(job.id);
 r.insert('invoices',{client_id:clientId,job_id:job.id,subject:'Voided',status:'void'});assert.equal((await run({id:job.id})).errors,undefined);assert.equal(dispatched,3);
 const active=r.insert('invoices',{client_id:clientId,job_id:job.id,subject:'Active'}),post=()=>call(`/api/jobs/${job.id}/invoice`,{method:'POST',headers,data:{}});
 const rejected=await post();assert.equal(rejected.status,409);assert.match(rejected.body.error,/Job already invoiced/);
 r.update('invoices',active.id,{status:'void'});const created=await post();assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.job_id,job.id);
});

test('Astra 120: quote-backed Node aliases cache and charge job scans and override probes',async t=>{
 const {db,r,owner}=await fixture(t),clientId=r.list('clients')[0].id,quote=r.insert('quotes',{client_id:clientId,title:'Cached quote'}),ql=r.insert('quote_line_items',{quote_id:quote.id,name:'Quoted'}),jobs=Array.from({length:3},()=>r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Override'}));
 for(const job of jobs)r.insert('preferences',{name:`job_lines:${job.id}`,value_json:'[]'});
 let scans=0,checks=0;const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT .* FROM jobs WHERE/.test(sql)&&/quote_id/.test(sql)){scans++;assert.match(sql,/SELECT id FROM jobs WHERE organization_id=\? AND quote_id=\? ORDER BY id ASC/);}if(/SELECT 1 FROM preferences/.test(sql))checks++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const id=encodeGid('JobLineItem','quote:'+ql.id),query='{'+Array.from({length:100},(_,i)=>`a${i}:node(id:"${id}"){id}`).join(' ')+'}',run=()=>executeGraphQL({db:measured,user:owner,query,authorize(){}});
 const hidden=await run();assert.equal(hidden.errors,undefined);assert.ok(Object.values(hidden.data).every(v=>v===null));assert.equal(scans,1);assert.equal(checks,3);assert.ok(hidden.extensions.cost.actualQueryCost>=206);assert.ok(hidden.extensions.cost.actualQueryCost<500);
 db.prepare('DELETE FROM preferences WHERE organization_id=1 AND name=?').run('job_lines:'+jobs[2].id);scans=0;checks=0;
 const visible=await run();assert.equal(visible.errors,undefined);assert.ok(Object.values(visible.data).every(v=>v.id===id));assert.equal(scans,1);assert.equal(checks,3);
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO jobs(organization_id,client_id,quote_id,title) SELECT 1,?,?,'Bulk' FROM n").run(clientId,quote.id);
 scans=0;checks=0;const blocked=await run();assert.match(blocked.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(scans,1);assert.equal(checks,0);
});

test('Astra 121: assignment arrays validate and inherited teams consume budget before dispatch',async t=>{
 const {db,r,owner}=await fixture(t),clientId=r.list('clients')[0].id,ids=Array(20001).fill(owner.id),job=r.insert('jobs',{client_id:clientId,title:'Inherited team',assigned_user_ids_json:JSON.stringify(ids)}),visit=r.insert('visits',{job_id:job.id,client_id:clientId,title:'Inherited team',assigned_user_ids_json:JSON.stringify(ids)});
 let dispatched=0;const run=(name,input)=>executeGraphQL({db,user:owner,query:`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 for(const key of ['visit_ids','visitIds','assigned_user_ids_json','assignedUserIds']){
  const target=key.startsWith('visit')?'Visit':'User',normalized=key.startsWith('visit')?'visit_ids':'assigned_user_ids_json';
  for(const value of [JSON.stringify(ids),1,true,{}]){assert.throws(()=>normalizeInput({[key]:value},'Job'),new RegExp('Invalid '+key));const result=await run('jobCreate',{clientId,title:'Rejected', [key]:value});assert.equal(result.errors,undefined);assert.match(result.data.jobCreate.userErrors[0].message,new RegExp('Invalid '+key));}
  assert.deepEqual(normalizeInput({[key]:[encodeGid(target,1)]},'Job')[normalized],[1]);assert.equal(normalizeInput({[key]:null},'Job')[normalized],null);assert.equal(normalizeInput({[key]:undefined},'Job')[normalized],undefined);
 }
 assert.equal(dispatched,0);
 const times={startAt:'2030-01-01T09:00:00Z',endAt:'2030-01-01T10:00:00Z'};
 for(const [name,input] of [['visitCreate',{jobId:job.id,...times}],['visitReschedule',{id:visit.id,...times}]]){
  for(const extra of [{},{assignedUserIds:null}]){const result=await run(name,{...input,...extra});assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(dispatched,0);}
 }
 for(const [name,input] of [['visitCreate',{jobId:job.id,...times}],['visitReschedule',{id:visit.id,...times}]]){const result=await run(name,{...input,assignedUserIds:[]});assert.equal(result.errors,undefined);assert.deepEqual(result.data[name].userErrors,[]);}
 assert.equal(dispatched,2);
 for(const table of ['jobs','visits'])r.update(table,table==='jobs'?job.id:visit.id,{assigned_user_ids_json:JSON.stringify([owner.id])});
 for(const [name,input] of [['visitCreate',{jobId:job.id,...times}],['visitReschedule',{id:visit.id,...times}]]){const result=await run(name,input);assert.equal(result.errors,undefined);assert.deepEqual(result.data[name].userErrors,[]);}
 assert.equal(dispatched,4);
 const {teamIds}=await import('../src/services/recurrence.js');let lookups=0;const repo={get(table,id){assert.equal(table,'users');assert.equal(id,owner.id);lookups++;return {is_active:1};}};
 for(const value of [ids,JSON.stringify(ids)]){lookups=0;assert.deepEqual(teamIds(repo,value),[owner.id]);assert.equal(lookups,1);}
 assert.throws(()=>teamIds(repo,[1.5]),/Inactive team member/);
 assert.throws(()=>teamIds({get(){return {is_active:0};}},[owner.id]),/Inactive team member/);
});

test('Astra 122: quote conversion charges existing jobs and fetches only the newest tenant match',async t=>{
 const {db,r,owner}=await fixture(t),clientId=r.list('clients')[0].id,quote=r.insert('quotes',{client_id:clientId,title:'Conversion budget',status:'approved'});
 let dispatched=0;const run=()=>executeGraphQL({db,user:owner,query:'mutation($input:Input!){quoteConvertToJob(input:$input){userErrors{message}}}',variables:{input:{id:quote.id}},authorize(){},dispatch(){dispatched++;return {};}});
 db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO jobs(organization_id,client_id,quote_id,title) SELECT 1,?,?,'Existing' FROM n").run(clientId,quote.id);
 const blocked=await run();assert.match(blocked.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(dispatched,0);assert.equal(r.get('quotes',quote.id).status,'approved');
 db.prepare('DELETE FROM jobs WHERE organization_id=1 AND quote_id=?').run(quote.id);
 const first=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'First'}),latest=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Latest'});assert.ok(latest.id>first.id);
 const small=await run();assert.equal(small.errors,undefined);assert.deepEqual(small.data.quoteConvertToJob.userErrors,[]);assert.equal(dispatched,1);
 r.insert('quote_line_items',{quote_id:quote.id,name:'Charged line'});r.insert('quote_line_items',{quote_id:quote.id,name:'Second charged line'});
 const withLines=await run();assert.equal(withLines.errors,undefined);assert.equal(withLines.extensions.cost.actualQueryCost,small.extensions.cost.actualQueryCost+1);
 const {workflows}=await import('../src/services/workflows.js');let scans=0;const measured=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT \* FROM jobs WHERE/.test(sql)){scans++;assert.equal(sql,'SELECT * FROM jobs WHERE organization_id=? AND quote_id=? ORDER BY id DESC LIMIT 1');}return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const before=r.list('jobs').length;assert.equal(workflows(measured,1,owner.id).quoteToJob(quote.id).id,latest.id);assert.equal(scans,1);assert.equal(r.list('jobs').length,before);
 const fresh=r.insert('quotes',{client_id:clientId,title:'Fresh conversion',status:'approved'}),w=workflows(db,1,owner.id),created=w.quoteToJob(fresh.id);assert.equal(created.quote_id,fresh.id);assert.equal(w.quoteToJob(fresh.id).id,created.id);
});

test('Astra 123: persisted appointment assignments and assigned-user reads consume bounded work',async t=>{
 const {db,r,owner,gql}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Assignment work'}),visit=r.insert('visits',{job_id:job.id,client_id:clientId,title:'Assignment work'}),request=r.insert('requests',{client_id:clientId,title:'Assignment work'});
 const times={startAt:'2031-01-01T09:00:00Z',endAt:'2031-01-01T10:00:00Z'},inputs=[['requestScheduleAssessment',{id:request.id,...times}],['visitCreate',{jobId:job.id,...times}],['visitReschedule',{id:visit.id,...times}]];
 let dispatched=0;const run=(name,input)=>executeGraphQL({db,user:owner,query:`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 const appointments=Array.from({length:2},(_,i)=>r.insert('appointments',{entity_type:i?"visit":"assessment",entity_id:i?visit.id:request.id,title:'Persisted team '+i,status:'cancelled',assigned_user_ids_json:JSON.stringify(Array(11000).fill(1))}));
 for(const [name,input] of inputs){const result=await run(name,{...input,assignedUserIds:[]});assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/);}
 assert.equal(dispatched,0);
 for(const a of appointments)r.update('appointments',a.id,{assigned_user_ids_json:'[]'});
 const small=await run(...inputs[0]);assert.equal(small.errors,undefined);assert.deepEqual(small.data.requestScheduleAssessment.userErrors,[]);
 r.update('appointments',appointments[0].id,{assigned_user_ids_json:JSON.stringify([owner.id,owner.id,owner.id])});
 const charged=await run(...inputs[0]);assert.equal(charged.errors,undefined);assert.equal(charged.extensions.cost.actualQueryCost,small.extensions.cost.actualQueryCost+3);
 for(const raw of [' '.repeat(40001)+'[]',JSON.stringify('x'.repeat(40001))]){
  r.update('appointments',appointments[0].id,{assigned_user_ids_json:raw});const before=dispatched;
  for(const [name,input] of inputs)assert.match((await run(name,input)).errors?.[0]?.message||'',/Execution cost exceeded/);
  assert.equal(dispatched,before);
 }
 for(const a of appointments)r.update('appointments',a.id,{assigned_user_ids_json:'[]'});
 for(const [table,id,name,input] of [['jobs',job.id,...inputs[1]],['visits',visit.id,...inputs[2]]]){
  r.update(table,id,{assigned_user_ids_json:' '.repeat(40001)+'[]'});const before=dispatched;
  assert.match((await run(name,input)).errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(dispatched,before);
  assert.equal((await run(name,{...input,assignedUserIds:[]})).errors,undefined);r.update(table,id,{assigned_user_ids_json:'[]'});
 }
 const assignedQuery=`{visit(id:"${encodeGid('Visit',visit.id)}"){assignedUsers{totalCount nodes{legacyId}}}}`;
 r.update('visits',visit.id,{assigned_user_ids_json:JSON.stringify([owner.id])});const single=await gql(assignedQuery);assert.equal(single.errors,undefined);
 r.update('visits',visit.id,{assigned_user_ids_json:JSON.stringify([owner.id,owner.id,owner.id])});const duplicate=await gql(assignedQuery);assert.equal(duplicate.errors,undefined);assert.deepEqual(duplicate.data,single.data);assert.equal(duplicate.extensions.cost.actualQueryCost,single.extensions.cost.actualQueryCost+2);
 const {conflicts}=await import('../src/services/recurrence.js'),start=times.startAt,end=times.endAt,rows=[{entity_type:'visit',entity_id:1,status:'scheduled',start_at:start,end_at:end,assigned_user_ids_json:JSON.stringify([owner.id])},{entity_type:'visit',entity_id:2,status:'cancelled',start_at:start,end_at:end,assigned_user_ids_json:JSON.stringify([owner.id])}];
 const repo={get(){return {is_active:1};},list(){return rows;}};assert.deepEqual(conflicts(repo,start,end,[owner.id,owner.id]),[rows[0]]);assert.deepEqual(conflicts(repo,start,end,[owner.id],{entity_type:'visit',entity_id:1}),[]);assert.deepEqual(conflicts(repo,start,end,[]),[]);
});

test('Astra 124: REST job assignment JSON strings remain compatible while GraphQL requires arrays',async t=>{
 const {r,owner,call,headers,gql,mutate}=await fixture(t),clientId=r.list('clients')[0].id;
 for(const key of ['assigned_user_ids_json','assignedUserIds']){
  const created=await call('/api/jobs',{method:'POST',headers,data:{client_id:clientId,title:'REST JSON team', [key]:JSON.stringify([encodeGid('User',owner.id)])}});assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.id;assert.deepEqual(JSON.parse(r.get('jobs',id).assigned_user_ids_json),[owner.id]);
  for(const value of ['[]',JSON.stringify([owner.id]),[owner.id]]){const edited=await call(`/api/jobs/${id}`,{method:'PATCH',headers,data:{[key]:value}});assert.equal(edited.status,200,JSON.stringify(edited.body));assert.deepEqual(JSON.parse(r.get('jobs',id).assigned_user_ids_json),typeof value==='string'?JSON.parse(value):value);}
  for(const value of ['{','{}','null','1','true',JSON.stringify([encodeGid('Client',clientId)])]){
   const before=r.get('jobs',id).assigned_user_ids_json,count=r.list('jobs').length;
   assert.equal((await call('/api/jobs',{method:'POST',headers,data:{client_id:clientId,title:'Invalid JSON team',[key]:value}})).status,400);assert.equal(r.list('jobs').length,count);
   assert.equal((await call(`/api/jobs/${id}`,{method:'PATCH',headers,data:{[key]:value}})).status,400);assert.equal(r.get('jobs',id).assigned_user_ids_json,before);
  }
  for(const [name,input] of [['jobCreate',{clientId,title:'GraphQL JSON team'}],['jobEdit',{id}]]){const result=await gql(`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,{input:{...input,[key]:JSON.stringify([owner.id])}});assert.equal(result.errors,undefined);assert.match(result.data[name].userErrors[0].message,new RegExp('Invalid '+key));}
 }
 const job=await mutate('jobCreate',{clientId,title:'GraphQL array team',assignedUserIds:[encodeGid('User',owner.id)]},'job');assert.deepEqual(JSON.parse(r.get('jobs',job.legacyId).assigned_user_ids_json),[owner.id]);
 for(const [key,target,normalized] of [['visitIds','Visit','visit_ids'],['assignedUserIds','User','assigned_user_ids_json']]){
  const value=JSON.stringify([encodeGid(target,1)]);assert.deepEqual(normalizeInput({[key]:value},'Job',null,true)[normalized],[1]);assert.throws(()=>normalizeInput({[key]:value},'Job'),/Invalid/);
  assert.deepEqual(normalizeInput({address:{[key]:value}},'Property',null,true)[normalized],[1]);assert.throws(()=>normalizeInput({address:{[key]:value}},'Property'),/Invalid/);
  assert.deepEqual(normalizeInput({items:[{[key]:value}]},'Quote',null,true).items[0][normalized],[1]);assert.throws(()=>normalizeInput({items:[{[key]:value}]},'Quote'),/Invalid/);
 }
});

test('Astra 125: nested REST job inputs preserve total validation and fixed monetary units',async t=>{
 const {db,r,call,headers}=await fixture(t),clientId=r.list('clients')[0].id;
 const created=await call('/api/jobs',{method:'POST',headers,data:{clientId,title:'Nested totals',lineItems:[{name:'Work',unitPrice:100}],discountType:'fixed',discountValue:10}});assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.id;
 const snapshot=()=>({job:r.get('jobs',id),prefs:r.list('preferences'),seq:db.prepare('SELECT * FROM _jobber_seq ORDER BY name').all()});
 for(const wrapper of ['address','billing_address','billingAddress'])for(const method of ['PATCH','PUT']){
  const before=snapshot(),result=await call(`/api/jobs/${id}`,{method,headers,data:{[wrapper]:{address:{totalCents:1}}}});assert.equal(result.status,400,JSON.stringify(result.body));assert.match(result.body.error,/persisted lineItems/);assert.deepEqual(snapshot(),before);
 }
 const edited=await call(`/api/jobs/${id}`,{method:'PATCH',headers,data:{address:{billingAddress:{discountValue:5}}}});assert.equal(edited.status,200,JSON.stringify(edited.body));assert.equal(edited.body.total_cents,9500);assert.equal(readJobOptions(db,1,id).discount_value,500);
 const count=r.list('jobs').length,rejected=await call('/api/jobs',{method:'POST',headers,data:{clientId,title:'Bad nested total',address:{lineItems:[{name:'Work',unitPrice:100}],totalCents:1}}});assert.equal(rejected.status,400);assert.equal(r.list('jobs').length,count);
 const manual=await call('/api/jobs',{method:'POST',headers,data:{clientId,title:'Nested manual',address:{subtotal:100,discountType:'fixed',discountValue:5}}});assert.equal(manual.status,201,JSON.stringify(manual.body));assert.equal(manual.body.total_cents,9500);
 assert.equal((await call(`/api/jobs/${manual.body.id}`,{method:'PATCH',headers,data:{billingAddress:{totalCents:1}}})).status,400);assert.equal(r.get('jobs',manual.body.id).total_cents,9500);
 const normalized=normalizeInput({address:{discountType:'fixed',discountValue:5,requiredDepositType:'fixed',requiredDepositValue:2}},'Quote');assert.equal(normalized.discount_value,500);assert.equal(normalized.required_deposit_value,200);
 assert.deepEqual(normalizeInput({address:{province:'TX',billingAddress:{postalCode:'12345'}}},'Property'),{state:'TX',postal_code:'12345'});
 const billing={street1:'Main',address:{city:'Austin'}};assert.equal(normalizeInput({billingAddress:billing},'Client').billing_address,JSON.stringify(billing));
 for(const key of ['__proto__','constructor','prototype'])assert.throws(()=>normalizeInput({address:JSON.parse(`{"${key}":1}`)},'Job'),/Invalid input field/);
});

test('Astra 126: every assigned-user read charges raw duplicates and oversized JSON',async t=>{
 const {r,owner,gql}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Read budget'}),visit=r.insert('visits',{job_id:job.id,client_id:clientId,title:'Read budget'}),request=r.insert('requests',{client_id:clientId,title:'Read budget'}),appointment=r.insert('appointments',{entity_type:'assessment',entity_id:request.id,title:'Read budget'});
 const queries=[`{visit(id:"${encodeGid('Visit',visit.id)}"){assignedUsers{totalCount}}}`,`{request(id:"${encodeGid('Request',request.id)}"){assessment{assignedUsers{totalCount}}}}`,`{node(id:"${encodeGid('Assessment',request.id)}"){... on Assessment{assignedUsers{totalCount}}}}`,`{scheduledItems(filter:{id:"${encodeGid('Assessment',request.id)}"}){nodes{... on Assessment{assignedUsers{totalCount}}}}}`];
 const set=raw=>{r.update('visits',visit.id,{assigned_user_ids_json:raw});r.update('appointments',appointment.id,{assigned_user_ids_json:raw});};
 set(JSON.stringify([owner.id]));const baseline=[];for(const query of queries){const result=await gql(query);assert.equal(result.errors,undefined);baseline.push(result);}
 set(JSON.stringify(Array(1000).fill(owner.id)));for(const [i,query] of queries.entries()){const result=await gql(query);assert.equal(result.errors,undefined);assert.deepEqual(result.data,baseline[i].data);assert.equal(result.extensions.cost.actualQueryCost,baseline[i].extensions.cost.actualQueryCost+999);}
 for(const raw of [JSON.stringify(Array(20001).fill(owner.id)),' '.repeat(40001)+'[]',JSON.stringify('x'.repeat(40001))]){set(raw);for(const query of queries){const result=await gql(query);assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(result.extensions.cost.actualQueryCost,20001);}}
 for(const raw of ['null','{}','1','[]']){set(raw);for(const query of queries){const result=await gql(query);assert.equal(result.errors,undefined,JSON.stringify(result));assert.ok(JSON.stringify(result.data).includes('"totalCount":0'));}}
});

test('Astra 127: automation rows and conditions exhaust mutation budgets before dispatch',async t=>{
 const {db,r,owner,gql}=await fixture(t),clientId=r.list('clients')[0].id,job=r.insert('jobs',{client_id:clientId,title:'Automation budget'}),quote=r.insert('quotes',{client_id:clientId,title:'Automation budget'}),invoice=r.insert('invoices',{client_id:clientId,subject:'Automation budget'});
 const cases=[['clientCreate',{name:'Budget client'}],['requestCreate',{clientId,title:'Budget request'}],['quoteSend',{id:quote.id}],['quoteApprove',{id:quote.id}],['visitCreate',{jobId:job.id}],['jobComplete',{id:job.id}],['invoiceSend',{id:invoice.id}],['invoiceIssue',{id:invoice.id}],['paymentRecordCreate',{clientId,amount:1}],['invoiceRecordPayment',{id:invoice.id,amount:1}]];
 let dispatched=0;const run=(name,input)=>executeGraphQL({db,user:owner,query:`mutation($input:Input!){${name}(input:$input){userErrors{message}}}`,variables:{input},authorize(){},dispatch(){dispatched++;return {};}});
 const events=['client_created','request_submitted','quote_sent','quote_approved','job_scheduled','job_completed','invoice_issued','invoice_issued','payment_received','payment_received'];
 const blocked=async()=>{for(const [i,args] of cases.entries()){db.prepare('UPDATE automations SET trigger_event=?,is_enabled=1 WHERE organization_id=1 AND id>?').run(events[i],firstId);const before=dispatched,result=await run(...args);assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/,JSON.stringify(result));assert.equal(dispatched,before);}db.prepare("UPDATE automations SET trigger_event='client_created' WHERE organization_id=1 AND id>?").run(firstId);};
 const firstId=db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM automations').get().n;
 db.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO automations(organization_id,name,trigger_event,is_enabled) SELECT 1,'Budget rule','client_created',1 FROM n");await blocked();
 const before={clients:r.list('clients').length,executions:r.list('automation_executions').length},real=await gql('mutation{clientCreate(input:{name:"Must not persist"}){userErrors{message}}}');assert.match(real.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(r.list('clients').length,before.clients);assert.equal(r.list('automation_executions').length,before.executions);
 assert.equal((await run('clientEdit',{id:clientId,name:'No event'})).errors,undefined);
 db.prepare('DELETE FROM automations WHERE organization_id=1 AND id>?').run(firstId);
 const rule=r.insert('automations',{name:'Condition budget',trigger_event:'client_created',is_enabled:1,conditions_json:'{}'}),base=await run(...cases[0]);assert.equal(base.errors,undefined);
 r.update('automations',rule.id,{conditions_json:JSON.stringify({status:{in:['lead','active']}})});const small=await run(...cases[0]);assert.equal(small.errors,undefined);assert.equal(small.extensions.cost.actualQueryCost,base.extensions.cost.actualQueryCost+5);
 for(const raw of [JSON.stringify({status:{in:Array(20001).fill('lead')}}),' '.repeat(40001)+'{}',JSON.stringify('x'.repeat(40001))]){r.update('automations',rule.id,{conditions_json:raw});await blocked();}
 const org=Number(db.prepare("INSERT INTO organizations(name,slug) VALUES('Other','astra127')").run().lastInsertRowid);repository(db,org).insert('automations',{name:'Foreign oversized rule',conditions_json:JSON.stringify(Array(20001).fill(1))});
 r.update('automations',rule.id,{conditions_json:'{}'});for(const args of cases){const before=dispatched,result=await run(...args);assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data[args[0]].userErrors,[]);assert.equal(dispatched,before+1);}
});

test('Astra 128: catalog references normalize in preferences and legacy strings detach on deletion',async t=>{
 const {db,r,owner,call,headers}=await fixture(t),clientId=r.list('clients')[0].id,product=r.insert('products_services',{name:'Reference product'}),other=r.insert('products_services',{name:'Keep product'}),job=r.insert('jobs',{client_id:clientId,title:'Catalog references'});
 const refs=[product.id,String(product.id),`gid://jobber/ProductOrService/${product.id}`,encodeGid('ProductOrService',product.id)],line=ref=>({name:'Stored work',quantity:1,unit_price_cents:100,taxable:0,product_service_id:ref});
 const saved=await call('/api/preferences',{method:'POST',headers,data:{name:`job_lines:${job.id}`,value_json:JSON.stringify([...refs.map(line),line(null),{name:'No catalog',unit_price_cents:100}])}});assert.equal(saved.status,201,JSON.stringify(saved.body));
 const pref=r.list('preferences',{name:`job_lines:${job.id}`})[0],stored=JSON.parse(pref.value_json);assert.deepEqual(stored.slice(0,4).map(l=>l.product_service_id),Array(4).fill(product.id));assert.equal(stored[4].product_service_id,null);assert.equal(Object.hasOwn(stored[5],'product_service_id'),false);
 const org=Number(db.prepare("INSERT INTO organizations(name,slug) VALUES('Other','astra128')").run().lastInsertRowid),foreign=repository(db,org).insert('products_services',{name:'Foreign product'});
 for(const ref of [encodeGid('Client',product.id),0,'bad',String(foreign.id)]){const before=r.get('preferences',pref.id).value_json,result=await call(`/api/preferences/${pref.id}`,{method:'PATCH',headers,data:{value_json:JSON.stringify([line(ref)])}});assert.ok([400,404].includes(result.status),JSON.stringify(result.body));assert.equal(r.get('preferences',pref.id).value_json,before);}
 const {workflows}=await import('../src/services/workflows.js'),w=workflows(db,1,owner.id);
 const invoiceJob=r.insert('jobs',{client_id:clientId,title:'Legacy invoice',status:'requires_invoicing',subtotal_cents:100,total_cents:100});r.insert('preferences',{name:`job_lines:${invoiceJob.id}`,value_json:JSON.stringify([line(String(product.id))])});const invoice=w.invoiceJob(invoiceJob.id);assert.equal(r.list('invoice_line_items',{invoice_id:invoice.id})[0].product_service_id,product.id);
 const untouched=[line(other.id),line(encodeGid('Client',product.id)),line('bad'),line(null),null],legacy=[...refs.map(line),...untouched];r.update('preferences',pref.id,{value_json:JSON.stringify(legacy)});
 const foreignPref=repository(db,org).insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([line(String(product.id))])});
 const deleted=await call(`/api/catalog/${product.id}`,{method:'DELETE',headers});assert.equal(deleted.status,200,JSON.stringify(deleted.body));const detached=JSON.parse(r.get('preferences',pref.id).value_json);assert.deepEqual(detached.slice(0,4),refs.map(()=>line(null)));assert.deepEqual(detached.slice(4),untouched);assert.equal(repository(db,org).get('preferences',foreignPref.id).value_json,foreignPref.value_json);
 r.update('preferences',pref.id,{value_json:JSON.stringify(detached.slice(0,4))});r.update('jobs',job.id,{status:'requires_invoicing',subtotal_cents:400,total_cents:400});const after=w.invoiceJob(job.id);assert.ok(r.list('invoice_line_items',{invoice_id:after.id}).every(l=>l.product_service_id===null));
});

test('Astra 129: only enabled matching automation rows and operands consume mutation budgets',async t=>{
 const {db,r,owner,gql}=await fixture(t);db.prepare("DELETE FROM automation_executions WHERE organization_id=1").run();db.prepare("DELETE FROM automations WHERE organization_id=1").run();
 let dispatched=0;const run=()=>executeGraphQL({db,user:owner,query:'mutation{clientCreate(input:{name:"Scoped budget"}){userErrors{message}}}',authorize(){},dispatch(){dispatched++;return {};}}),base=await run();assert.equal(base.errors,undefined);
 const allowed=async()=>{const before=dispatched,result=await run();assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.clientCreate.userErrors,[]);assert.equal(dispatched,before+1);assert.equal(result.extensions.cost.actualQueryCost,base.extensions.cost.actualQueryCost);};
 const blocked=async()=>{const before=dispatched,result=await run();assert.match(result.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(dispatched,before);};
 db.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO automations(organization_id,name,trigger_event,is_enabled) SELECT 1,'Disabled matching','client_created',0 FROM n");await allowed();
 db.exec("UPDATE automations SET trigger_event='request_submitted',is_enabled=1 WHERE organization_id=1");await allowed();
 const count=r.list('clients').length,real=await gql('mutation{clientCreate(input:{name:"Unrelated rules allowed"}){client{legacyId} userErrors{message}}}');assert.equal(real.errors,undefined);assert.deepEqual(real.data.clientCreate.userErrors,[]);assert.equal(r.list('clients').length,count+1);
 db.exec("UPDATE automations SET trigger_event='client_created' WHERE organization_id=1");await blocked();db.prepare('DELETE FROM automations WHERE organization_id=1').run();
 const rule=r.insert('automations',{name:'Oversized operands',trigger_event:'client_created',is_enabled:0,conditions_json:JSON.stringify({status:{in:Array(20001).fill('lead')}})});await allowed();r.update('automations',rule.id,{trigger_event:'request_submitted',is_enabled:1});await allowed();r.update('automations',rule.id,{trigger_event:'client_created'});await blocked();
 const before=r.list('clients').length,rejected=await gql('mutation{clientCreate(input:{name:"Matching rules blocked"}){userErrors{message}}}');assert.match(rejected.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(r.list('clients').length,before);
 assert.deepEqual(db.prepare('PRAGMA index_info(automation_event)').all().map(c=>c.name),['organization_id','trigger_event','is_enabled']);
});

test('Astra 130: job-line ID filters preserve namespaces when numeric identities collide',async t=>{
 const {db,r,gql}=await fixture(t),clientId=r.list('clients')[0].id;
 const n=db.prepare('SELECT MAX(id)+1 AS n FROM (SELECT id FROM jobs UNION ALL SELECT id FROM quote_line_items)').get().n;
 db.prepare("INSERT INTO jobs(id,organization_id,client_id,title) VALUES(?,1,?,'Fallback line')").run(n,clientId);
 const stored=r.insert('jobs',{client_id:clientId,title:'Stored job'}),quote=r.insert('quotes',{client_id:clientId,title:'Quote source'}),quoted=r.insert('jobs',{client_id:clientId,quote_id:quote.id,title:'Quote job'});
 r.insert('preferences',{name:`job_lines:${stored.id}`,value_json:JSON.stringify([{id:n,name:'Stored line',quantity:1,unit_price_cents:100,total_cents:100,taxable:0}])});
 db.prepare("INSERT INTO quote_line_items(id,organization_id,quote_id,name,quantity,unit_price_cents,total_cents) VALUES(?,1,?,'Quote line',1,100,100)").run(n,quote.id);
 const sources=[{job:n,ns:'job',id:encodeGid('JobLineItem',n)},{job:stored.id,ns:'line',id:encodeGid('JobLineItem',`line:${n}`)},{job:quoted.id,ns:'quote',id:encodeGid('JobLineItem',`quote:${n}`)}];
 const query='query($job:ID!,$filter:Input!){job(id:$job){lineItems(filter:$filter){totalCount nodes{id legacyId} edges{node{id}}}}}';
 const check=async(key,value,ns)=>{
  for(const source of sources){
   const result=await gql(query,{job:source.job,filter:{[key]:value}});assert.equal(result.errors,undefined,JSON.stringify(result));
   const lines=result.data.job.lineItems,match=ns===null||ns===source.ns;
   assert.equal(lines.totalCount,match?1:0,JSON.stringify({key,value,source}));assert.deepEqual(lines.nodes,match?[{id:source.id,legacyId:n}]:[]);assert.deepEqual(lines.edges,match?[{node:{id:source.id}}]:[]);
  }
 };
 const typed=[['JobLineItem',String(n),'job'],['JobLineItem',`job:${n}`,'job'],['JobLineItem',`line:${n}`,'line'],['JobLineItem',`quote:${n}`,'quote'],['QuoteLineItem',String(n),'quote'],['LineItem',String(n),null]];
 for(const key of ['id','jobLineItemId']){
  for(const [type,id,ns] of typed)for(const value of [`gid://jobber/${type}/${id}`,encodeGid(type,id)])for(const filter of [value,{eq:value},{in:[value]},[value]])await check(key,filter,ns);
  for(const value of [n,String(n)])for(const filter of [value,{eq:value},{in:[value]},[value]])await check(key,filter,null);
  for(const value of [null,{eq:null},{in:[]},[]])await check(key,value,'none');
  for(const value of ['gid://jobber/Client/'+n,'gid://jobber/LineItem/line:'+n,'gid://jobber/QuoteLineItem/quote:'+n,'gid://jobber/JobLineItem/other:'+n,'bad',0]){
   const result=await gql(query,{job:n,filter:{[key]:value}});assert.match(result.errors?.[0]?.message||'',/Invalid Global ID for JobLineItem/);
  }
 }
});

test('Astra 131: zero-value manual jobs preserve validated pricing options during invoicing',async t=>{
 const {r,mutate}=await fixture(t),clientId=r.list('clients')[0].id;
 const job=r.insert('jobs',{client_id:clientId,title:'Zero manual job',status:'requires_invoicing',subtotal_cents:0,tax_cents:0,total_cents:0});
 r.insert('preferences',{name:`job_options:${job.id}`,value_json:JSON.stringify({tax_rate:10,discount_type:'percent',discount_value:20})});
 assert.equal(r.list('preferences',{name:`job_lines:${job.id}`}).length,0);
 const created=await mutate('jobInvoice',{id:job.id},'invoice'),invoice=r.get('invoices',created.legacyId);
 assert.deepEqual([invoice.subtotal_cents,invoice.tax_cents,invoice.total_cents],[0,0,0]);
 assert.deepEqual([invoice.tax_rate,invoice.discount_type,invoice.discount_value],[10,'percent',20]);
 const lines=r.list('invoice_line_items',{invoice_id:invoice.id});assert.equal(lines.length,1);assert.equal(lines[0].unit_price_cents,0);
});

test('Astra 132: filter aliases resolve catalog columns and validate relationship ID types',async t=>{
 const {r,gql,owner}=await fixture(t),clientId=r.list('clients')[0].id,product=r.insert('products_services',{name:'Filter product'}),other=r.insert('products_services',{name:'Other filter product'});
 const request=r.insert('requests',{client_id:clientId,title:'Alias request'}),job=r.insert('jobs',{client_id:clientId,title:'Alias job'}),quote=r.insert('quotes',{client_id:clientId,request_id:request.id,title:'Alias quote',client_message:'Filter message'});
 const line=r.insert('quote_line_items',{quote_id:quote.id,name:'Matching line',product_service_id:product.id,markup_percent:25});r.insert('quote_line_items',{quote_id:quote.id,name:'Other line',product_service_id:other.id});r.insert('quote_line_items',{quote_id:quote.id,name:'No catalog'});
 const query='query($id:ID!,$filter:Input!){quote(id:$id){lineItems(filter:$filter){totalCount nodes{legacyId}}}}';
 for(const key of ['productServiceId','productOrServiceId','serviceId','product_service_id','product_or_service_id','service_id']){
  for(const id of [product.id,String(product.id),encodeGid('ProductOrService',product.id),`gid://jobber/ProductOrService/${product.id}`])for(const value of [id,{eq:id},{in:[id]},[id]]){
   const result=await gql(query,{id:quote.id,filter:{[key]:value}});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data.quote.lineItems,{totalCount:1,nodes:[{legacyId:line.id}]});
  }
  const invalid=await gql(query,{id:quote.id,filter:{[key]:encodeGid('Client',product.id)}});assert.match(invalid.errors?.[0]?.message||'',/Invalid Global ID for ProductOrService/);
 }
 const marked=await gql(query,{id:quote.id,filter:{markup:25}});assert.equal(marked.errors,undefined);assert.deepEqual(marked.data.quote.lineItems.nodes,[{legacyId:line.id}]);
 const visit=r.insert('visits',{job_id:job.id,client_id:clientId,title:'Alias visit'}),expense=r.insert('expenses',{user_id:owner.id,item_name:'Alias expense'});
 for(const [root,key,type,id,expected,extra] of [['visits','workOrderId','Job',job.id,visit.id,{}],['quotes','workRequestId','Request',request.id,quote.id,{message:'Filter message'}],['expenses','paidByUserId','User',owner.id,expense.id,{id:expense.id}]]){
  for(const alias of [key,key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())]){
   const result=await gql(`query($filter:Input!){${root}(filter:$filter){nodes{legacyId}}}`,{filter:{...extra,[alias]:{eq:encodeGid(type,id)}}});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data[root].nodes,[{legacyId:expected}]);
   const invalid=await gql(`query($filter:Input!){${root}(filter:$filter){totalCount}}`,{filter:{[alias]:encodeGid('Client',id)}});assert.match(invalid.errors?.[0]?.message||'',new RegExp('Invalid Global ID for '+type));
  }
 }
});

test('Astra 133: visit-based invoicing skips oversized unused job-line hydration',async t=>{
 const {r,gql,mutate}=await fixture(t),clientId=r.list('clients')[0].id;
 const job=r.insert('jobs',{client_id:clientId,title:'Visit billing',billing_type:'visit_based',status:'requires_invoicing'});
 const visit=r.insert('visits',{job_id:job.id,client_id:clientId,title:'Completed work',status:'completed',billable_amount_cents:1250});
 const pending=r.insert('visits',{job_id:job.id,client_id:clientId,title:'Unused visit',status:'unscheduled',billable_amount_cents:9000});
 const lines=JSON.stringify(Array.from({length:20001},(_,i)=>({id:i+1,name:'Unused job line',quantity:1,unit_price_cents:100,total_cents:100,taxable:0})));
 r.insert('preferences',{name:`job_lines:${job.id}`,value_json:lines});r.insert('preferences',{name:`job_options:${job.id}`,value_json:JSON.stringify({tax_rate:10,discount_type:'percent',discount_value:20})});
 const created=await mutate('jobInvoice',{id:job.id},'invoice'),invoice=r.get('invoices',created.legacyId),items=r.list('invoice_line_items',{invoice_id:invoice.id});
 assert.equal(invoice.total_cents,1250);assert.equal(items.length,1);assert.equal(items[0].visit_id,visit.id);assert.equal(items[0].name,'Completed work');assert.equal(r.get('visits',visit.id).invoiced,1);assert.equal(r.get('visits',pending.id).invoiced,0);
 assert.equal(r.list('preferences',{name:`job_lines:${job.id}`})[0].value_json,lines);
 const fixed=r.insert('jobs',{client_id:clientId,title:'Fixed billing',billing_type:'fixed_price',status:'requires_invoicing'});r.insert('preferences',{name:`job_lines:${fixed.id}`,value_json:lines});
 const rejected=await gql('mutation($input:Input!){jobInvoice(input:$input){userErrors{message}}}',{input:{id:fixed.id}});assert.match(rejected.errors?.[0]?.message||'',/Execution cost exceeded/);assert.equal(r.list('invoices',{job_id:fixed.id}).length,0);
});

test('Astra 134: public-field filters resolve type-specific storage aliases',async t=>{
 const {r,gql,owner}=await fixture(t),client=r.insert('clients',{display_name:'Public filter client'}),job=r.insert('jobs',{client_id:client.id,title:'Public filter job',status:'active'});
 const request=r.insert('requests',{client_id:client.id,title:'Public filter request'}),quote=r.insert('quotes',{client_id:client.id,title:'Public filter quote',issued_date:'2026-10-27'}),invoice=r.insert('invoices',{client_id:client.id,subject:'Public filter invoice',payment_terms:'net_15'});
 const visit=r.insert('visits',{job_id:job.id,client_id:client.id,title:'Public filter visit',scheduled_start:'2026-10-27T10:00:00',scheduled_end:'2026-10-27T11:00:00'}),expense=r.insert('expenses',{item_name:'Public filter expense',date_incurred:'2026-10-27'}),payment=r.insert('payments',{client_id:client.id,method:'cash',paid_at:'2026-10-27'});
 const time=r.insert('time_entries',{user_id:owner.id,start_at:'2026-10-27T12:00:00',end_at:'2026-10-27T13:00:00'}),product=r.insert('products_services',{name:'Unchanged product name'});
 const cases=[['clients',client,'name',client.display_name],['expenses',expense,'title',expense.item_name],['expenses',expense,'date',expense.date_incurred],['invoices',invoice,'title',invoice.subject],['invoices',invoice,'invoiceNet',invoice.payment_terms],['quotes',quote,'issuedAt',quote.issued_date],['visits',visit,'startAt',visit.scheduled_start],['visits',visit,'endAt',visit.scheduled_end],['paymentRecords',payment,'paymentMethod',payment.method],['paymentRecords',payment,'entryDate',payment.paid_at],['requests',request,'requestStatus',request.status],['quotes',quote,'quoteStatus',quote.status],['invoices',invoice,'invoiceStatus',invoice.status],['jobs',job,'jobStatus',job.status],['visits',visit,'visitStatus',visit.status],['timeSheetEntries',time,'startAt',time.start_at],['timeSheetEntries',time,'endAt',time.end_at],['productsAndServices',product,'name',product.name],['jobs',job,'title',job.title]];
 for(const [root,row,key,value] of cases)for(const alias of new Set([key,key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())])){
  assert.notEqual(value,undefined,key);
  for(const operand of [value,{eq:value},{in:[value]},[value]]){
   const result=await gql(`query($filter:Input!){${root}(filter:$filter){totalCount nodes{legacyId}}}`,{filter:{id:row.id,[alias]:operand}});assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(result.data[root],{totalCount:1,nodes:[{legacyId:row.id}]},alias);
  }
  const miss=await gql(`query($filter:Input!){${root}(filter:$filter){totalCount}}`,{filter:{id:row.id,[alias]:'not-a-matching-value'}});assert.equal(miss.errors,undefined);assert.equal(miss.data[root].totalCount,0,alias);
 }
});

test('Astra 135: duplicate legacy preferences cannot expose stale job-line nodes',async t=>{
 const {db,r,gql,mutate}=await fixture(t),job=r.insert('jobs',{client_id:r.list('clients')[0].id,title:'Duplicate preferences'}),base=maxJobLineSeq(db,1)+100;
 const line=(id,name)=>({id,name,quantity:1,unit_price_cents:100,total_cents:100,taxable:0});
 const first=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([line(base,'Authoritative')])});
 const duplicate=r.insert('preferences',{name:first.name,value_json:JSON.stringify([line(base+100,'Stale duplicate')])});
 const options=r.insert('preferences',{name:`job_options:${job.id}`,value_json:'{"tax_rate":5}'});r.insert('preferences',{name:options.name,value_json:'{"tax_rate":90}'});
 const sequence=r.insert('preferences',{name:'job_line_seq',value_json:String(base)});r.insert('preferences',{name:'job_line_seq',value_json:String(base+200)});
 const node=async id=>{const result=await gql('query($id:ID!){node(id:$id){... on JobLineItem{name}}}',{id:encodeGid('JobLineItem',`line:${id}`)});assert.equal(result.errors,undefined,JSON.stringify(result));return result.data.node;};
 assert.deepEqual(await node(base),{name:'Authoritative'});assert.equal(await node(base+100),null);assert.equal(maxJobLineSeq(db,1),base+200);assert.deepEqual(readJobOptions(db,1,job.id),{tax_rate:5});
 const read=await gql('query($id:ID!){job(id:$id){lineItems{nodes{legacyId name}}}}',{id:job.id});assert.equal(read.errors,undefined);assert.deepEqual(read.data.job.lineItems.nodes,[{legacyId:base,name:'Authoritative'}]);
 db.prepare('UPDATE preferences SET value_json=? WHERE id=?').run(JSON.stringify([line(base+300,'Changed duplicate')]),duplicate.id);assert.equal(await node(base+300),null);assert.equal(maxJobLineSeq(db,1),base+300);
 const replaced=await mutate('jobEdit',{id:job.id,lineItems:[{name:'Replacement',unitPrice:1}]},'job','lineItems{nodes{legacyId name}}'),newId=replaced.lineItems.nodes[0].legacyId;assert.ok(newId>base+300);
 assert.equal(await node(base),null);assert.equal(await node(base+100),null);assert.equal(await node(base+300),null);assert.deepEqual(await node(newId),{name:'Replacement'});
 assert.deepEqual(r.list('preferences',{name:first.name}).map(x=>x.id),[first.id]);assert.deepEqual(r.list('preferences',{name:'job_line_seq'}).map(x=>x.id),[sequence.id]);
 storeJobOptions(db,1,job.id,{discount_type:'percent',discount_value:10});assert.deepEqual(r.list('preferences',{name:options.name}).map(x=>x.id),[options.id]);assert.deepEqual(readJobOptions(db,1,job.id),{tax_rate:5,discount_type:'percent',discount_value:10});
 await mutate('jobEdit',{id:job.id,lineItems:[]},'job');assert.equal(await node(newId),null);assert.ok(maxJobLineSeq(db,1)>=newId);
});

test('Astra 136: deleting duplicate and primary job lines reconciles surviving lines and quote fallbacks',async t=>{
 const {r,call,headers}=await fixture(t),client=r.list('clients')[0],quote=r.insert('quotes',{client_id:client.id,title:'Deletion quote',tax_rate:10});
 r.insert('quote_line_items',{quote_id:quote.id,name:'Quote line',quantity:1,unit_price_cents:10000,total_cents:10000,taxable:1});
 for(const quoted of [true,false])for(const storedOptions of [true,false]){
  const tax=storedOptions?100:quoted?200:0;
  const job=r.insert('jobs',{client_id:client.id,quote_id:quoted?quote.id:null,title:'Deletion job',subtotal_cents:2000,tax_cents:tax,total_cents:2000+tax}),lines=[null,[],{id:900001+job.id,name:'Stored',quantity:2,unit_price_cents:1000,total_cents:2000,taxable:1},{name:'Excluded',quantity:1,unit_price_cents:9000,is_optional:1,is_selected:0}];
  const first=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify(lines)}),duplicate=r.insert('preferences',{name:first.name,value_json:'[]'});
  if(storedOptions){const opts=r.insert('preferences',{name:`job_options:${job.id}`,value_json:'{"tax_rate":5}'});r.insert('preferences',{name:opts.name,value_json:'{"tax_rate":90}'});}
  const remove=async(pref,expected)=>{const result=await call(`/api/preferences/${pref.id}`,{method:'DELETE',headers});assert.equal(result.status,200,JSON.stringify(result.body));const saved=r.get('jobs',job.id);assert.deepEqual([saved.subtotal_cents,saved.tax_cents,saved.total_cents],expected);};
  await remove(duplicate,[2000,tax,2000+tax]);
  const survivor=r.insert('preferences',{name:first.name,value_json:JSON.stringify([{name:'Surviving stored',quantity:1,unit_price_cents:4000,total_cents:4000,taxable:1}])});
  await remove(first,[4000,tax*2,4000+tax*2]);
  if(quoted)await remove(survivor,[10000,storedOptions?500:1000,storedOptions?10500:11000]);
 }
});

test('Astra 137: projected scalar filters match public values across operator forms',async t=>{
 const {r,gql,owner}=await fixture(t),client=r.insert('clients',{display_name:'Projected',balance_cents:1234}),quote=r.insert('quotes',{client_id:client.id,title:'Projected quote'}),invoice=r.insert('invoices',{client_id:client.id,subject:'Projected invoice'}),job=r.insert('jobs',{client_id:client.id,title:'Projected job',subtotal_cents:1234,tax_cents:123,total_cents:1357});
 const visit=r.insert('visits',{client_id:client.id,job_id:job.id,title:'Projected visit',scheduled_start:'2026-10-27T12:00:00Z',scheduled_end:'2026-10-27T13:00:00Z',billable_amount_cents:4567}),task=r.insert('tasks',{title:'Projected task',due_date:'2026-10-27',start_time:'09:30',end_time:'10:45:00'});
 const payment=r.insert('payments',{client_id:client.id,amount_cents:1234,refunded_cents:234}),expense=r.insert('expenses',{item_name:'Projected expense',amount_cents:456}),time=r.insert('time_entries',{user_id:owner.id,start_at:'2026-10-27T12:00:00Z',duration_minutes:75,hourly_cost_cents:2345,total_cost_cents:2931}),product=r.insert('products_services',{name:'Projected product',unit_price_cents:1234,unit_cost_cents:567});
 const cases=[['users',owner,{status:'ACTIVE',updatedAt:owner.updated_at||owner.created_at}],['clients',client,{balance:12.34,totalBalance:12.34,jobberWebUri:'/clients/'+client.id}],['quotes',quote,{quoteNumber:String(quote.quote_number||quote.id)}],['invoices',invoice,{invoiceNumber:String(invoice.invoice_number||invoice.id)}],['jobs',job,{jobNumber:String(job.job_number||job.id),subtotal:12.34,taxAmount:1.23,total:13.57}],['visits',visit,{billableAmount:45.67}],['tasks',task,{startAt:'2026-10-27T09:30:00Z',endAt:'2026-10-27T10:45:00Z'}],['scheduledItems',task,{startAt:'2026-10-27T09:30:00Z',endAt:'2026-10-27T10:45:00Z'},'Task'],['scheduledItems',visit,{startAt:visit.scheduled_start,endAt:visit.scheduled_end},'Visit'],['paymentRecords',payment,{amount:12.34,refundedAmount:2.34}],['expenses',expense,{amount:4.56}],['timeSheetEntries',time,{duration:4500,hourlyCost:23.45,totalCost:29.31}],['productsAndServices',product,{defaultUnitCost:12.34,internalUnitCost:5.67}]];
 const check=async(root,id,fields,selection='legacyId')=>{
  for(const [key,value] of Object.entries(fields))for(const alias of new Set([key,key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())])){
   for(const operand of [value,{eq:value},{in:[value]},[value]]){
    const result=await gql(`query($filter:Input!){${root}(filter:$filter){totalCount nodes{${selection}}}}`,{filter:{id,[alias]:operand}});assert.equal(result.errors,undefined,JSON.stringify(result));assert.equal(result.data[root].totalCount,1,`${root}.${alias}`);
   }
   const miss=await gql(`query($filter:Input!){${root}(filter:$filter){totalCount}}`,{filter:{id,[alias]:'not-matching'}});assert.equal(miss.errors,undefined);assert.equal(miss.data[root].totalCount,0,`${root}.${alias}`);
  }
 };
 for(const [root,row,fields,type] of cases)await check(root,type?encodeGid(type,row.id):row.id,fields);
 const other=r.list('users').find(x=>x.id!==owner.id);r.update('users',other.id,{is_active:0});await check('users',other.id,{status:'DEACTIVATED'});
 r.update('tasks',task.id,{start_time:null,end_time:null});await check('tasks',task.id,{startAt:'2026-10-27T00:00:00Z',endAt:null});
 for(const [table,parent,key,root] of [['quote_line_items',quote,'quote_id','quote'],['invoice_line_items',invoice,'invoice_id','invoice']]){
  r.insert(table,{[key]:parent.id,name:'Projected line',quantity:2,unit_price_cents:1234,total_cents:2468});
  for(const field of ['unitPrice','totalPrice'])for(const operand of [field==='unitPrice'?12.34:24.68,{eq:field==='unitPrice'?12.34:24.68},{in:[field==='unitPrice'?12.34:24.68]},[field==='unitPrice'?12.34:24.68]]){
   const result=await gql(`query($filter:Input!){${root}(id:${parent.id}){lineItems(filter:$filter){totalCount}}}`,{filter:{[field]:operand}});assert.equal(result.errors,undefined);assert.equal(result.data[root].lineItems.totalCount,1);
  }
 }
 r.update('jobs',job.id,{quote_id:quote.id});const result=await gql(`{job(id:${job.id}){lineItems(filter:{unitPrice:12.34,totalPrice:24.68}){totalCount}}}`);assert.equal(result.errors,undefined);assert.equal(result.data.job.lineItems.totalCount,1);
 const request=r.insert('requests',{client_id:client.id,title:'Projected assessment'});r.insert('appointments',{entity_type:'assessment',entity_id:request.id,title:'Projected assessment',start_at:'2026-10-27T14:00:00Z',end_at:'2026-10-27T15:00:00Z',status:null});await check('scheduledItems',encodeGid('Assessment',request.id),{status:'SCHEDULED'});
 await check('accounts',1,{industry:'Tile & Flooring'});
});

test('Astra 138: quote-backed Node round trips inspect only the first valid array preference',async t=>{
 const {r,gql}=await fixture(t),client=r.list('clients')[0],quote=r.insert('quotes',{client_id:client.id,title:'Node quote'}),line=r.insert('quote_line_items',{quote_id:quote.id,name:'Round trip',quantity:1,unit_price_cents:100,total_cents:100}),job=r.insert('jobs',{client_id:client.id,quote_id:quote.id,title:'Node job'});
 const first=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:'{}'});r.insert('preferences',{name:first.name,value_json:'[]'});
 for(const value of ['{}','null','"[not-an-array]"']){
  r.update('preferences',first.id,{value_json:value});const result=await gql(`{job(id:${job.id}){lineItems{nodes{id name}}}}`);assert.equal(result.errors,undefined);const projected=result.data.job.lineItems.nodes[0];assert.equal(projected.name,line.name);
  const node=await gql('query($id:ID!){node(id:$id){... on JobLineItem{id name}}}',{id:projected.id});assert.equal(node.errors,undefined,JSON.stringify(node));assert.deepEqual(node.data.node,projected);
 }
 r.update('preferences',first.id,{value_json:'[]'});const result=await gql('query($id:ID!){node(id:$id){id}}',{id:encodeGid('JobLineItem','quote:'+line.id)});assert.equal(result.errors,undefined);assert.equal(result.data.node,null);
});

test('Astra 139: deleting stale job lines preserves independently priced quote-linked jobs',async t=>{
 const {r,call,headers}=await fixture(t),client=r.list('clients')[0],quote=r.insert('quotes',{client_id:client.id,title:'Taxed quote',tax_rate:10});
 r.insert('quote_line_items',{quote_id:quote.id,name:'Quote line',quantity:1,unit_price_cents:2000,total_cents:2000,taxable:1});
 const job=r.insert('jobs',{client_id:client.id,quote_id:quote.id,title:'Independent price',subtotal_cents:2000,tax_cents:0,total_cents:2000}),line={name:'Independent line',quantity:1,unit_price_cents:2000,total_cents:2000,taxable:1};
 const first=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([line])}),duplicate=r.insert('preferences',{name:first.name,value_json:'[]'});
 const remove=async pref=>{const result=await call(`/api/preferences/${pref.id}`,{method:'DELETE',headers});assert.equal(result.status,200,JSON.stringify(result.body));const saved=r.get('jobs',job.id);assert.deepEqual([saved.subtotal_cents,saved.tax_cents,saved.total_cents],[2000,0,2000]);};
 await remove(duplicate);
 const survivor=r.insert('preferences',{name:first.name,value_json:JSON.stringify([{...line,name:'Replacement line'}])});await remove(first);assert.equal(JSON.parse(r.get('preferences',survivor.id).value_json)[0].name,'Replacement line');
 // A stale deletion must also preserve authoritative totals that differ from stored lines.
 r.update('jobs',job.id,{subtotal_cents:2500,total_cents:2500});const stale=r.insert('preferences',{name:first.name,value_json:'[]'});assert.equal((await call(`/api/preferences/${stale.id}`,{method:'DELETE',headers})).status,200);assert.equal(r.get('jobs',job.id).total_cents,2500);
 r.update('jobs',job.id,{subtotal_cents:0,tax_cents:0,total_cents:0});const zeroStale=r.insert('preferences',{name:first.name,value_json:'[]'});assert.equal((await call(`/api/preferences/${zeroStale.id}`,{method:'DELETE',headers})).status,200);assert.equal(r.get('jobs',job.id).total_cents,0);
 for(const value_json of ['{}','null'])for(const total of [2500,0]){
  r.update('preferences',survivor.id,{value_json});r.update('jobs',job.id,{subtotal_cents:total,tax_cents:0,total_cents:total});
  const duplicate=r.insert('preferences',{name:first.name,value_json:'[]'});const result=await call(`/api/preferences/${duplicate.id}`,{method:'DELETE',headers});assert.equal(result.status,200,JSON.stringify(result.body));
  const saved=r.get('jobs',job.id);assert.deepEqual([saved.subtotal_cents,saved.tax_cents,saved.total_cents],[total,0,total]);
 }
});

test('Astra 140: repeated field expansion is cached across object instances',async t=>{
 const {db,r,owner}=await fixture(t);for(let i=0;i<1000;i++)r.insert('clients',{display_name:`Expansion ${i}`});
 const get=Map.prototype.get;let idLookups=0,result;
 try{Map.prototype.get=function(key){if(key==='id')idLookups++;return get.call(this,key);};result=await executeGraphQL({db,user:owner,authorize(){},query:`{clients(first:1000){nodes{${'id '.repeat(4000)}}}}`});}finally{Map.prototype.get=get;}
 assert.equal(result.errors,undefined,JSON.stringify(result));assert.equal(result.data.clients.nodes.length,1000);assert.ok(result.data.clients.nodes.every(n=>n.id));assert.ok(idLookups<20000,`Repeated grouping performed ${idLookups} id lookups`);assert.ok(result.extensions.cost.actualQueryCost<10000);
 const conflict=await executeGraphQL({db,user:owner,authorize(){},query:'{clients{nodes{x:id x:name}}}'});assert.match(conflict.errors[0].message,/Conflicting fields/);
});

test('Astra 141: malformed OAuth inputs return client errors without creating sessions',async t=>{
 const {db,owner,call}=await fixture(t),auth=createAuth(db),credentials={grant_type:'password',username:owner.email,password:'test-password-123'},before=db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
 let attempt=0;const req=()=>({headers:{},socket:{remoteAddress:`malformed-${attempt++}`}}),reject=(data,status=400)=>assert.throws(()=>auth.exchange(data,req()),e=>e.status===status);
 for(const data of [null,undefined,true,1,'text',[]]){reject(data);assert.throws(()=>auth.authorize(req(),data),e=>e.status===400&&e.message==='Invalid request');}
 for(const value of [undefined,null,true,1,{},[]])reject({...credentials,grant_type:value});
 for(const key of ['username','email','password'])for(const value of [true,false,1,{},[]])reject({...credentials,[key]:value});
 for(const organization_id of [true,false,{},[],[1],0,-1,1.5,'bad','0','1.5',Number.MAX_SAFE_INTEGER+1])reject({...credentials,organization_id});
 for(const key of ['client_secret','code','refresh_token','redirect_uri'])for(const value of [true,1,{},[]])reject({...credentials,[key]:value},key==='client_secret'?401:400);
 for(const username of [true,{},[],123]){const result=await call('/oauth/token',{method:'POST',data:{...credentials,username}});assert.equal(result.status,400);assert.equal(result.body.error,'Invalid credentials');}
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,before);
 for(const organization_id of [undefined,null,'',1,'1'])assert.ok(auth.exchange({...credentials,organization_id},req()).access_token);
});

test('Astra 142: invoicing a job with preserved totals that differ from stale stored lines bills the preserved pricing',async t=>{
 const {r,call,headers,mutate}=await fixture(t),client=r.list('clients')[0];
 for(const graphql of [false,true])for(const options of [false,true])for(const [subtotal,tax,taxable] of [[0,0,1],[2500,0,1],[2500,250,1],[2000,200,0]]){
  const job=r.insert('jobs',{client_id:client.id,title:'Preserved pricing',status:'requires_invoicing',subtotal_cents:subtotal,tax_cents:tax,total_cents:subtotal+tax});
  const first=r.insert('preferences',{name:`job_lines:${job.id}`,value_json:JSON.stringify([{name:'Stale line',quantity:1,unit_price_cents:2000,total_cents:2000,taxable}])});
  const duplicate=r.insert('preferences',{name:first.name,value_json:'[]'});
  if(options){const opts=r.insert('preferences',{name:`job_options:${job.id}`,value_json:JSON.stringify({tax_rate:tax?10:0})});r.insert('preferences',{name:opts.name,value_json:'{"tax_rate":90}'});}
  const removed=await call(`/api/preferences/${duplicate.id}`,{method:'DELETE',headers});assert.equal(removed.status,200,JSON.stringify(removed.body));
  const saved=r.get('jobs',job.id);assert.deepEqual([saved.subtotal_cents,saved.tax_cents,saved.total_cents],[subtotal,tax,subtotal+tax]);
  assert.equal(r.list('preferences',{name:first.name}).length,1);
  let invoice;
  if(graphql){const result=await mutate('jobInvoice',{id:job.id},'invoice');invoice=r.get('invoices',result.legacyId);}
  else {const result=await call(`/api/jobs/${job.id}/invoice`,{method:'POST',headers,data:{}});assert.equal(result.status,200,JSON.stringify(result.body));invoice=result.body;}
  assert.deepEqual([invoice.subtotal_cents,invoice.tax_cents,invoice.total_cents,invoice.balance_due_cents],[subtotal,tax,subtotal+tax,subtotal+tax]);
  assert.equal(r.list('invoice_line_items',{invoice_id:invoice.id}).reduce((sum,line)=>sum+line.total_cents,0),subtotal);
 }
});

test('Astra 143: duplicate object selections merge in linear space without intermediate array cloning',async t=>{
 const {db,owner}=await fixture(t),count=2490,iterator=Array.prototype[Symbol.iterator];let selectionEntries=0,result;
 // Count selection-array iteration, including spread copies, rather than noisy heap deltas.
 try{
  Array.prototype[Symbol.iterator]=function(){if(this[0]?.field==='name')selectionEntries+=this.length;return iterator.call(this);};
  result=await executeGraphQL({db,user:owner,authorize(){},query:`{__schema{${'queryType{name} '.repeat(count)}}}`});
 }finally{Array.prototype[Symbol.iterator]=iterator;}
 assert.equal(result.errors,undefined,JSON.stringify(result));assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{__schema:{queryType:{name:'Query'}}});
 assert.ok(selectionEntries<count*30,`Selection arrays iterated ${selectionEntries} entries for ${count} duplicate fields`);
});

test('Astra 144: expense and entity mutations accept public field aliases on create and edit',async t=>{
 const {r,owner,mutate,gql}=await fixture(t),client=r.list('clients')[0],otherUser=r.list('users').find(u=>u.id!==owner.id);
 const job=r.insert('jobs',{client_id:client.id,title:'Expense job'}),otherJob=r.insert('jobs',{client_id:client.id,title:'Edited expense job'});
 const selection='id legacyId title date amount paidByUser{legacyId} job{legacyId}';
 const expense=await mutate('expenseCreate',{title:'Materials',amount:12.34,date:'2026-10-26',paidByUserId:encodeGid('User',owner.id),workOrderId:encodeGid('Job',job.id)},'expense',selection);
 const checkExpense=(result,title,date,amount,userId,jobId)=>{
  assert.equal(result.title,title);assert.equal(result.date,date);assert.equal(result.amount,amount);assert.equal(result.paidByUser.legacyId,userId);assert.equal(result.job.legacyId,jobId);
  const saved=r.get('expenses',result.legacyId);assert.equal(saved.item_name,title);assert.equal(saved.date_incurred,date);assert.equal(saved.amount_cents,Math.round(amount*100));assert.equal(saved.user_id,userId);assert.equal(saved.job_id,jobId);
 };
 checkExpense(expense,'Materials','2026-10-26',12.34,owner.id,job.id);
 const edited=await mutate('expenseEdit',{id:expense.id,title:'Replacement materials',amount:25.67,date:'2026-10-27',paidByUserId:encodeGid('User',otherUser.id),workOrderId:encodeGid('Job',otherJob.id)},'expense',selection);
 checkExpense(edited,'Replacement materials','2026-10-27',25.67,otherUser.id,otherJob.id);
 assert.deepEqual(normalizeInput({title:'',date:null},'Expense'),{item_name:'',date_incurred:null});
 for(const [field,table,createStatus,editStatus] of [['request','requests','NEW','ARCHIVED'],['job','jobs','ACTIVE','REQUIRES_INVOICING']]){
  const alias=field+'Status';
  const created=await mutate(field+'Create',{clientId:client.id,title:'Public aliases',[alias]:createStatus},field,`id legacyId ${alias}`);
  assert.equal(created[alias],createStatus);assert.equal(r.get(table,created.legacyId).status,createStatus.toLowerCase());
  const updated=await mutate(field+'Edit',{id:created.id,[alias]:editStatus},field,`id legacyId ${alias}`);
  assert.equal(updated[alias],editStatus);assert.equal(r.get(table,created.legacyId).status,editStatus.toLowerCase());
 }
 const quote=await mutate('quoteCreate',{clientId:client.id,title:'Public aliases',quoteStatus:'DRAFT',issuedAt:'2026-10-26'},'quote','id legacyId quoteStatus');
 assert.equal(quote.quoteStatus,'DRAFT');const initialQuote=r.get('quotes',quote.legacyId);assert.equal(initialQuote.status,'draft');assert.equal(initialQuote.issued_date,'2026-10-26');
 await mutate('quoteEdit',{id:quote.id,message:'Updated client message'},'quote');
 assert.equal(r.get('quotes',quote.legacyId).client_message,'Updated client message');
 assert.deepEqual(normalizeInput({quoteStatus:'APPROVED',issuedAt:'2026-10-27'},'Quote'),{status:'approved',issued_date:'2026-10-27'});
 const invoice=await mutate('invoiceCreate',{clientId:client.id,invoiceStatus:'DRAFT',title:'Public aliases',invoiceNet:'NET_15',lineItems:[{name:'Service',unitPrice:10}]},'invoice','id legacyId invoiceStatus');
 assert.equal(invoice.invoiceStatus,'DRAFT');const initialInvoice=r.get('invoices',invoice.legacyId);assert.equal(initialInvoice.status,'draft');assert.equal(initialInvoice.subject,'Public aliases');assert.equal(initialInvoice.payment_terms,'net_15');
 await mutate('invoiceEdit',{id:invoice.id,title:'Edited public aliases',invoiceNet:'NET_60'},'invoice');
 const savedInvoice=r.get('invoices',invoice.legacyId);assert.equal(savedInvoice.subject,'Edited public aliases');assert.equal(savedInvoice.payment_terms,'net_60');
 assert.deepEqual(normalizeInput({invoiceStatus:'PAID',invoiceNet:'NET_30'},'Invoice'),{status:'paid',payment_terms:'net_30'});
 const visit=await mutate('visitCreate',{workOrderId:job.id,visitStatus:'UNSCHEDULED'},'visit','legacyId visitStatus');assert.equal(visit.visitStatus,'UNSCHEDULED');
 assert.deepEqual(normalizeInput({visitStatus:'COMPLETED'},'Visit'),{status:'completed'});
 const entryDate='2026-10-27T12:00:00Z';assert.deepEqual(normalizeInput({entryDate,paymentType:'CLIENT_CREDIT',paymentRecordId:encodeGid('PaymentRecord',1)},'PaymentRecord'),{paid_at:entryDate,payment_type:'client_credit',payment_id:1});
 const payment=await mutate('paymentRecordCreate',{clientId:client.id,amount:1,entryDate,paymentType:'CLIENT_CREDIT'},'paymentRecord','legacyId paymentType entryDate');assert.equal(payment.paymentType,'CLIENT_CREDIT');assert.equal(payment.entryDate,entryDate);assert.equal(r.get('payments',payment.legacyId).paid_at,entryDate);
 await mutate('invoiceSend',{id:invoice.id},'invoice');
 const invoicePayment=await mutate('invoiceRecordPayment',{id:invoice.id,amount:1,entryDate,paymentType:'INVOICE_PAYMENT'},'paymentRecord','legacyId paymentType entryDate');assert.equal(invoicePayment.paymentType,'INVOICE_PAYMENT');assert.equal(invoicePayment.entryDate,entryDate);assert.equal(r.get('payments',invoicePayment.legacyId).paid_at,entryDate);
 for(const input of [{entryDate:'not-a-date'},{entryDate:''},{entryDate:'   '},{entryDate:123},{entryDate:null},{paymentType:'CLIENT_CREDIT'}]){
  const before=r.list('payments').length,balance=r.get('invoices',invoice.legacyId).balance_due_cents;
  const result=await gql('mutation($input: Input!){invoiceRecordPayment(input:$input){paymentRecord{legacyId} userErrors{message path}}}',{input:{id:invoice.id,amount:1,...input}});
  assert.equal(result.errors,undefined,JSON.stringify(result));assert.ok(result.data.invoiceRecordPayment.userErrors.length,JSON.stringify(result));assert.equal(r.list('payments').length,before);assert.equal(r.get('invoices',invoice.legacyId).balance_due_cents,balance);
 }
 for(const [target,paymentType] of [[{invoiceId:invoice.id},'INVOICE_PAYMENT'],[{quoteId:quote.id},'DEPOSIT']]){
  if(target.quoteId)r.update('quotes',quote.legacyId,{required_deposit_cents:100});
  const inferred=await mutate('paymentRecordCreate',{...target,amount:1,entryDate,paymentType},'paymentRecord','legacyId entryDate');const saved=r.get('payments',inferred.legacyId);assert.equal(saved.client_id,client.id);assert.equal(saved.paid_at,entryDate);assert.equal(inferred.entryDate,entryDate);
 }
});

test('Rails JSON adapters preserve workflow handlers and SPA navigation',async t=>{
 const {call,headers}=await fixture(t);const post=async(path,data={})=>{const result=await call(path,{method:'POST',data,headers});assert.ok(result.status<300,JSON.stringify(result.body));return result.body;};
 assert.equal((await call('/clients.json')).status,401);
 const c=await post('/clients.json',{display_name:'Rails Customer',email:'rails@example.test',receives_email:1});const request=await post('/work_requests.json',{client_id:c.id,title:'Rails request'});
 const q=await post('/quotes.json',{client_id:c.id,request_id:request.id,title:'Rails quote',items:[{name:'Tile',unit_price_cents:1000,quantity:1}]});await post(`/quotes/${q.id}/send_quote.json`);await post(`/quotes/${q.id}/approve.json`);const j=await post(`/quotes/${q.id}/convert_to_job.json`);const v=await post(`/jobs/${j.id}/visits.json`);await post(`/visits/${v.id}/complete.json`);await post(`/jobs/${j.id}/complete.json`);const i=await post(`/jobs/${j.id}/generate_invoice.json`);await post(`/invoices/${i.id}/send_invoice.json`);const payment=await post(`/invoices/${i.id}/record_payment.json`,{amount_cents:1000});assert.equal(payment.invoice_id,i.id);
 for(const path of ['/clients.json','/work_requests.json','/calendar/events.json','/work_objects.json','/api/work_objects'])assert.equal((await call(path,{headers})).status,200);
 const search=await call('/work_objects.json?q=Rails',{headers});assert.ok(search.body.quotes.some(x=>x.id===q.id));
 for(const path of ['/clients','/quotes','/work_requests'])assert.match((await call(path)).headers.get('content-type'),/text\/html/);
});
