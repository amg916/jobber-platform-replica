import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createDatabase, repository } from '../src/db/database.js';
import { seedDatabase } from '../src/db/seed.js';
import { workflows } from '../src/services/workflows.js';
import { startServer } from '../src/server.js';

const artwork=['quotes_deep_lawn','marketing_reviews_art','timesheets_banner_art','expenses_forwarding_art','onboarding_avatar'];
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
