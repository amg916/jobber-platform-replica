import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext,Script} from 'node:vm';
const source=readFileSync(new URL('../src/public/app.js',import.meta.url),'utf8');
function harness(){
 const calls=[];
 const context=createContext({calls,URL,Intl,Date,console,setTimeout(){},location:{pathname:'/hub/test',search:''},sessionStorage:{getItem(){return null;}},history:{},window:{},document:{querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){}},fetch:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>({id:7})};}});
 runInContext(source.slice(0,source.lastIndexOf('init().catch')),context);
 return {calls,run:code=>runInContext(code,context)};
}
test('document extensions remain a classic script',()=>assert.doesNotThrow(()=>new Script(source)));
test('quote editor renders expandable introduction, payment schedule and view controls',()=>{
 const {run}=harness(),html=run("documentEditorFields('quotes',{})");
 for(const label of ['Quote #','Add Introduction','Introduction title','Payment Schedule','Add Invoice to Payment Schedule','Change client view','PDF Style','Apply to future quotes','Include customer reviews','Attachments'])assert.ok(html.includes(label),label);
});
test('job editor exposes both scheduling configurations',()=>{
 const {run}=harness(),html=run("documentEditorFields('jobs',{})");
 for(const label of ['Create Visits','Select dates','Schedule later','Recurring schedule','Ends after','Ends on','Occurrences','Get paid automatically','Remind me to invoice when I close the job'])assert.ok(html.includes(label),label);
});
test('invoice editor exposes payment and display controls',()=>{
 const {run}=harness(),html=run("documentEditorFields('invoices',{})");
 for(const label of ['Invoice #','Date Sent','net_45','custom','Change display options','Account Balance','Late Stamp','Card payments','Bank payments','Allow partial payments'])assert.ok(html.includes(label),label);
});
test('UI options are extracted without losing document calculation fields',()=>{
 const {run}=harness();run("globalThis.data={client_id:1,tax_rate:7.125,discount_value:10,doc_pdf_style:'modern',items:[{name:'Service',service_date:'2030-01-02',unit_cost_cents:100}]};globalThis.extra=prepareDocumentData('quotes',data,{documentState:{changed:true,row:{}},dataset:{}})");
 assert.equal(run('data.doc_pdf_style'),undefined);assert.equal(run('data.tax_rate'),7.125);assert.equal(run('data.items[0].unit_cost_cents'),100);assert.equal(run('data.items[0].service_date'),undefined);assert.equal(run('extra.options.service_dates[0]'),'2030-01-02');
});
test('new recurring job creates rule then generates visits',async()=>{
 const {run,calls}=harness();await run("saveDocumentExtras('jobs',12,{changed:false,files:[],options:{frequency:'biweekly',end_amount:3,end_unit:'Occurrences'},recurrenceActive:true},{job_type:'recurring',start_date:'2030-01-01'},true,{})");
 assert.equal(calls[0].path,'/api/recurrence-rules');assert.equal(JSON.parse(calls[0].options.body).occurrence_count,3);assert.equal(calls[1].path,'/api/recurrence-rules/7/generate');
});
test('unchanged job editor does not make supplementary requests',async()=>{
 const {run,calls}=harness();await run("saveDocumentExtras('jobs',12,{changed:false,files:[],options:{}},{job_type:'one_off'},true,{})");assert.equal(calls.length,0);
});
test('record detail controls render without fetching',()=>{
 const {run,calls}=harness();for(const [type,labels] of Object.entries({clients:['Merge Client','Customize view','Client schedule','Payment methods'],requests:['Activity','Edit on-site assessment'],quotes:['Introduction','Collect Signature','Create Similar Quote'],jobs:['Add Multiple Visits','Add time entry','Edit Invoice Settings'],invoices:['Send Text Message','Collect Payment','Edit client view']})){
 const html=run(`recordDetailControls('${type}',{id:1,status:'draft'})`);for(const label of labels)assert.ok(html.includes(label),`${type}: ${label}`);
 }assert.equal(calls.length,0);
});
test('invalid recurrence end is rejected before document creation',()=>{
 const {run}=harness();assert.throws(()=>run("prepareDocumentData('jobs',{job_type:'recurring',start_date:'2030-01-02',doc_ends:'on',doc_until_date:'2030-01-01'},{dataset:{}})"),/until date/);
});
