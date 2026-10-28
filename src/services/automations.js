import { repository, transaction, fail } from '../db/database.js';
import { createHmac, randomBytes } from 'node:crypto';
export function webhookInput(data,creating=false) {
 if(Object.keys(data).some(key=>!['topic','target_url','webhook_url','url','secret','active'].includes(key)))fail('Invalid webhook field');
 const out={};
 for(const key of ['topic','secret','active'])if(key in data)out[key]=data[key];
 if(['target_url','webhook_url','url'].some(k=>k in data)){for(const k of ['target_url','webhook_url','url'])if(k in data&&data[k]!==undefined&&(typeof data[k]!=='string'||!data[k].trim()))fail('Invalid webhook URL');const target=data.target_url??data.webhook_url??data.url;if(target===undefined)fail('Invalid webhook URL');out.target_url=target.trim();let url;try{url=new URL(out.target_url);}catch{fail('Invalid webhook URL');}if(!['http:','https:'].includes(url.protocol))fail('Invalid webhook URL');}
 if('active' in out){if(![true,false,0,1].includes(out.active))fail('Invalid webhook active flag');out.active=Number(out.active);}
 if('topic' in out&&(typeof out.topic!=='string'||!out.topic.trim()))fail('Webhook topic is required');
 if('secret' in out&&(typeof out.secret!=='string'||!out.secret.trim().length))fail('Invalid webhook secret');
 if(creating){if(!out.topic)fail('Webhook topic is required');if(!out.target_url)fail('Invalid webhook URL');out.active??=1;out.secret||='whsec_'+randomBytes(24).toString('hex');}
 else if(Object.keys(out).length===0)fail('No webhook fields provided');
 return out;
}
const parseKeys=raw=>{try{const p=JSON.parse(raw||'[]');return Array.isArray(p)?p:[];}catch{return [];}};
export function deliverWebhook(repo,sub,payload,now=new Date(),eventKey=null) {
 const payloadJson=JSON.stringify(payload),signature=createHmac('sha256',sub.secret||'jobber-webhook-secret').update(payloadJson).digest('base64');
 const timestamp=now.toISOString(),keys=parseKeys(sub.delivered_keys_json).filter(key=>{if(typeof key!=='string')return true;const match=key.match(/^(overdue|reminder):[^:]+:(.+)$/);return !match||(match[1]==='overdue'?match[2]>=timestamp.slice(0,10):match[2]>timestamp);});
 if(eventKey&&!keys.includes(eventKey))keys.push(eventKey);
 return repo.update('webhook_subscriptions',sub.id,{delivery_count:sub.delivery_count+1,last_delivered_at:now.toISOString(),last_payload_json:payloadJson,last_signature:signature,delivered_keys_json:JSON.stringify(keys)});
}
const normalizedTopic=topic=>String(topic).toLowerCase().replace(/_create$/,'_created').replace(/_update$/,'_updated').replace(/_delete$/,'_deleted');
export function matches(record, conditions={}) {
 return Object.entries(conditions).every(([key,expected])=>{
  if(expected && typeof expected==='object') return Object.entries(expected).every(([op,value])=>op==='eq'?record[key]===value:op==='gte'?record[key]>=value:op==='lte'?record[key]<=value:op==='in'?Array.isArray(value)&&value.includes(record[key]):false);
  return record[key]===expected;
 });
}
export function emit(repo,event,type,id,eventKey,now=new Date()) {
 return transaction(repo.db,()=>{
 const entity=repo.get(type,id),result=[];
 id=entity.id;
 const baseKey=`${event}:${type}:${id}`;
 if(eventKey===undefined||eventKey===null){
  const repeatAction={quote_sent:'sent',job_completed:'completed'}[event];
  const repeatLogs=repeatAction?repo.list('activity_logs',{entity_type:type,entity_id:id,action:repeatAction}):[];
  if(repeatLogs.length>0){
   const candidate=`${baseKey}:${repeatLogs.at(-1).id}`;
   const subs=repo.list('webhook_subscriptions'),runs=repo.list('automation_executions',{entity_type:type,entity_id:id,trigger_event:event});
   const hasSuffixed=subs.some(s=>parseKeys(s.delivered_keys_json).some(k=>typeof k==='string'&&k.startsWith(`${baseKey}:`)))||runs.some(e=>e.idempotency_key.startsWith(`${e.automation_id}:${baseKey}:`));
   const hasBase=subs.some(s=>parseKeys(s.delivered_keys_json).includes(baseKey))||runs.some(e=>e.idempotency_key===`${e.automation_id}:${baseKey}`);
   eventKey=hasSuffixed?candidate:(!hasBase&&repeatLogs.length>1?candidate:baseKey);
  }else eventKey=baseKey;
 }
 else if(typeof eventKey!=='string'||!eventKey.trim())fail('Invalid event key');
 else eventKey=eventKey.trim();
 for(const sub of repo.list('webhook_subscriptions',{active:1})){
  if(sub.topic!=='*'&&normalizedTopic(sub.topic)!==normalizedTopic(event))continue;
  if(eventKey&&parseKeys(sub.delivered_keys_json).includes(eventKey))continue;
  deliverWebhook(repo,sub,{event,entity_type:type,entity_id:id,event_key:eventKey,created_at:now.toISOString()},now,eventKey);
 }
 for(const rule of repo.list('automations',{trigger_event:event,is_enabled:1})) {
  if(!matches(entity,JSON.parse(rule.conditions_json||'{}'))) continue;
  const key=`${rule.id}:${eventKey}`; const existing=repo.list('automation_executions',{idempotency_key:key})[0]; if(existing) {result.push(existing);continue;}
  result.push(repo.insert('automation_executions',{automation_id:rule.id,trigger_event:event,entity_type:type,entity_id:id,idempotency_key:key,status:'queued',max_attempts:3,scheduled_for:new Date(+now+rule.delay_minutes*60000).toISOString()}));
 }
 return result;
 });
}
export function sendMessage(repo,clientId,channel,body,subject='',related={}) {
 const client=repo.get('clients',clientId); if(channel==='sms'&&!client.receives_sms || channel==='email'&&!client.receives_email) fail('Client channel disabled');
 return repo.insert('messages',{client_id:clientId,channel,direction:'outbound',recipient:channel==='sms'?client.mobile_phone||client.phone:client.email,subject,body,...related,status:'test_mode',provider_mode:'sandbox'});
}
function execute(repo,run,rule) {
 const config=JSON.parse(rule.action_config_json||'{}'),entity=repo.get(run.entity_type,run.entity_id),clientId=run.entity_type==='clients'?entity.id:entity.client_id;
 switch(rule.action_type) {
  case 'send_email': case 'send_sms': { const client=repo.get('clients',clientId),name=client.display_name||[client.first_name,client.last_name].filter(Boolean).join(' ')||'Client',fill=s=>String(s??'').replace(/\{\{\s*client_name\s*\}\}/g,()=>name); return sendMessage(repo,clientId,rule.action_type==='send_email'?'email':'sms',fill(config.body||rule.name),fill(config.subject||rule.name)); }
  case 'create_task': case 'schedule_followup': return repo.insert('tasks',{client_id:clientId,job_id:run.entity_type==='jobs'?entity.id:null,title:config.title||rule.name,instructions:config.instructions||'',due_date:config.due_date||new Date().toISOString().slice(0,10),assigned_user_id:config.assigned_user_id||null});
  case 'notify_team_member': return repo.insert('notifications',{user_id:config.user_id||null,title:config.title||rule.name,body:config.body||'',entity_type:run.entity_type,entity_id:entity.id});
  case 'change_status': case 'update_record': {
   const allowed={clients:['status','notes'],requests:['status','internal_notes'],jobs:['status','internal_notes'],tasks:['status','instructions']};
   const patch=rule.action_type==='change_status'?{status:config.status}:config.fields;
   if(!patch || Object.keys(patch).some(k=>!allowed[run.entity_type]?.includes(k))) fail('Automation update not permitted');
   return repo.update(run.entity_type,entity.id,patch);
  }
  default: fail('Unknown automation action');
 }
}
export function runPending(db,now=new Date()) {
 const due=db.prepare("SELECT id,organization_id FROM automation_executions WHERE status='queued' AND scheduled_for<=? ORDER BY scheduled_for,id LIMIT 100").all(now.toISOString());
 const results=[];
 for(const entry of due) {
  const repo=repository(db,entry.organization_id);
  try { results.push(transaction(db,()=>{
   const run=repo.get('automation_executions',entry.id); if(run.status!=='queued') return run;
   const rule=repo.get('automations',run.automation_id),entity=repo.list(run.entity_type,{id:run.entity_id})[0],conditions=JSON.parse(rule.conditions_json||'{}'),delayed=Number(rule.delay_minutes)>0;
   const sentLogs=delayed&&run.trigger_event==='quote_sent'&&conditions.status==='awaiting_response'&&entity?repo.list('activity_logs',{entity_type:'quotes',entity_id:entity.id,action:'sent'}):[];
   const canonicalBase=`${run.automation_id}:quote_sent:quotes:${entity?.id}`,canonicalKeys=new Set([canonicalBase,...sentLogs.map(l=>`${canonicalBase}:${l.id}`)]);
   const staleTrigger=delayed&&sentLogs.length>1&&canonicalKeys.has(run.idempotency_key)&&run.idempotency_key!==`${canonicalBase}:${sentLogs.at(-1).id}`;
   if(!rule.is_enabled||!entity||(delayed&&(staleTrigger||!matches(entity,conditions)))) return repo.update('automation_executions',run.id,{status:'skipped',executed_at:now.toISOString()});
   repo.update('automation_executions',run.id,{status:'running',attempt_count:run.attempt_count+1});
   const result=execute(repo,run,rule);
   repo.update('automations',rule.id,{run_count:rule.run_count+1,last_run_at:now.toISOString()});
   return repo.update('automation_executions',run.id,{status:'succeeded',executed_at:now.toISOString(),result_json:result,error_message:null});
  })); } catch(error) {
   const run=repo.get('automation_executions',entry.id),attempt=run.attempt_count+1;
   results.push(repo.update('automation_executions',run.id,{attempt_count:attempt,status:attempt>=run.max_attempts?'failed':'queued',error_message:error.message,scheduled_for:new Date(+now+60000*2**(attempt-1)).toISOString()}));
  }
 }
 return results;
}
export function retry(repo,id) { const run=repo.get('automation_executions',id); if(run.status!=='failed') fail('Only failed executions can be retried'); return repo.update('automation_executions',id,{status:'queued',attempt_count:0,scheduled_for:new Date().toISOString(),error_message:null}); }
