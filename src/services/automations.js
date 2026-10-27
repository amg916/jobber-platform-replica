import { repository, transaction, fail } from '../db/database.js';
export function matches(record, conditions={}) {
 return Object.entries(conditions).every(([key,expected])=>{
  if(expected && typeof expected==='object') return Object.entries(expected).every(([op,value])=>op==='eq'?record[key]===value:op==='gte'?record[key]>=value:op==='lte'?record[key]<=value:op==='in'?Array.isArray(value)&&value.includes(record[key]):false);
  return record[key]===expected;
 });
}
export function emit(repo,event,type,id,eventKey=`${event}:${type}:${id}`,now=new Date()) {
 const entity=repo.get(type,id),result=[];
 for(const rule of repo.list('automations',{trigger_event:event,is_enabled:1})) {
  if(!matches(entity,JSON.parse(rule.conditions_json||'{}'))) continue;
  const key=`${rule.id}:${eventKey}`; const existing=repo.list('automation_executions',{idempotency_key:key})[0]; if(existing) {result.push(existing);continue;}
  result.push(repo.insert('automation_executions',{automation_id:rule.id,trigger_event:event,entity_type:type,entity_id:id,idempotency_key:key,status:'queued',max_attempts:3,scheduled_for:new Date(+now+rule.delay_minutes*60000).toISOString()}));
 }
 return result;
}
export function sendMessage(repo,clientId,channel,body,subject='',related={}) {
 const client=repo.get('clients',clientId); if(channel==='sms'&&!client.receives_sms || channel==='email'&&!client.receives_email) fail('Client channel disabled');
 return repo.insert('messages',{client_id:clientId,channel,direction:'outbound',recipient:channel==='sms'?client.mobile_phone||client.phone:client.email,subject,body,...related,status:'test_mode',provider_mode:'sandbox'});
}
function execute(repo,run,rule) {
 const config=JSON.parse(rule.action_config_json||'{}'),entity=repo.get(run.entity_type,run.entity_id),clientId=run.entity_type==='clients'?entity.id:entity.client_id;
 switch(rule.action_type) {
  case 'send_email': case 'send_sms': return sendMessage(repo,clientId,rule.action_type==='send_email'?'email':'sms',config.body||rule.name,config.subject||rule.name);
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
   const rule=repo.get('automations',run.automation_id);
   if(!rule.is_enabled) return repo.update('automation_executions',run.id,{status:'skipped',executed_at:now.toISOString()});
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
