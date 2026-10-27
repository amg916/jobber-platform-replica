import { fail, transaction } from '../db/database.js';
export function teamIds(repo, ids=[]) { if(typeof ids==='string') { try { ids=JSON.parse(ids); } catch { fail('Invalid team'); } } if(!Array.isArray(ids)) fail('Expected team array'); for(const id of ids) { if(!Number.isSafeInteger(id)||!repo.get('users',id).is_active) fail('Inactive team member'); } return [...new Set(ids)]; }
export function interval(start,end) { const a=Date.parse(start),b=Date.parse(end); if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a) fail('Invalid schedule interval'); return [new Date(a).toISOString(),new Date(b).toISOString()]; }
export function conflicts(repo,start,end,ids,exclude={}) {
 [start,end]=interval(start,end); ids=teamIds(repo,ids);
 return repo.list('appointments').filter(a=>a.status!=='cancelled' && !(a.entity_type===exclude.entity_type && a.entity_id===exclude.entity_id) && a.start_at<end && a.end_at>start && JSON.parse(a.assigned_user_ids_json||'[]').some(id=>ids.includes(id)));
}
export function scheduleVisit(repo,id,input) { return transaction(repo.db,()=>{
 const visit=repo.get('visits',id); if(['completed','cancelled'].includes(visit.status)) fail('Visit cannot be rescheduled');
 const [start,end]=interval(input.scheduled_start||visit.scheduled_start,input.scheduled_end||visit.scheduled_end);
 const ids=teamIds(repo,input.assigned_user_ids_json??visit.assigned_user_ids_json);
 if(conflicts(repo,start,end,ids,{entity_type:'visit',entity_id:id}).length) fail('Schedule conflict',409);
 const updated=repo.update('visits',id,{scheduled_start:start,scheduled_end:end,assigned_user_ids_json:ids,status:'scheduled'});
 const data={entity_type:'visit',entity_id:id,title:visit.title,start_at:start,end_at:end,assigned_user_ids_json:ids,status:'scheduled',color:'#2f7d50'};
 const existing=repo.list('appointments',{entity_type:'visit',entity_id:id})[0]; if(existing) repo.update('appointments',existing.id,data); else repo.insert('appointments',data);
 return updated;
 }); }
export function generateVisits(repo,ruleId) { return transaction(repo.db,()=>{
 const rule=repo.get('recurrence_rules',ruleId),job=repo.get('jobs',rule.job_id);
 const base=new Date(`${rule.start_date}T00:00:00Z`); if(!Number.isFinite(+base)) fail('Invalid recurrence start');
 const count=rule.occurrence_count||52; if(count>1000||count<1) fail('Occurrence count must be 1–1000');
 const step=rule.interval_count||1; if(step<1) fail('Invalid recurrence interval');
 const days=JSON.parse(rule.days_of_week_json||'[]'); if(!Array.isArray(days)||days.some(d=>!Number.isInteger(d)||d<0||d>6)) fail('Invalid weekdays');
 const result=[]; let matched=0;
 for(let offset=0;offset<36600 && matched<count;offset++) {
  const date=new Date(+base+offset*86400000),dateText=date.toISOString().slice(0,10); if(rule.until_date && dateText>rule.until_date) break;
  let use=false;
  if(rule.frequency==='daily') use=offset%step===0;
  else if(rule.frequency==='monthly') { const months=(date.getUTCFullYear()-base.getUTCFullYear())*12+date.getUTCMonth()-base.getUTCMonth(); const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate(); use=months%step===0 && date.getUTCDate()===Math.min(rule.day_of_month||base.getUTCDate(),last); }
  else { const weeks=rule.frequency==='biweekly'?2:1; use=Math.floor(offset/7)%(weeks*step)===0 && (days.length?days:[base.getUTCDay()]).includes(date.getUTCDay()); }
  if(!use) continue; matched++;
  const start=new Date(`${dateText}T${job.start_time||'09:00'}:00Z`).toISOString();
  const existing=repo.list('visits',{job_id:job.id,scheduled_start:start})[0]; if(existing) { result.push(existing); continue; }
  const visit=repo.insert('visits',{job_id:job.id,client_id:job.client_id,property_id:job.property_id,title:job.title,status:'unscheduled',billable_amount_cents:job.total_cents});
  result.push(scheduleVisit(repo,visit.id,{scheduled_start:start,scheduled_end:new Date(Date.parse(start)+(rule.duration_minutes||60)*60000).toISOString(),assigned_user_ids_json:job.assigned_user_ids_json}));
 }
 return result;
 }); }
