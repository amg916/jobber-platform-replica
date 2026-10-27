import { fail } from '../db/database.js';
import { interval, teamIds, conflicts } from './recurrence.js';
export function checkAvailability(r,input) {
 const [start,end]=interval(input.start_at,input.end_at),ids=teamIds(r,input.assigned_user_ids_json||[]);
 if(!ids.length) fail('Booking needs an assigned team member');
 const org=r.db.prepare('SELECT * FROM organizations WHERE id=?').get(r.organizationId);
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:org.timezone||'UTC',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const local=value=>Object.fromEntries(fmt.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
 const a=local(start),b=local(end),day=a.weekday.toLowerCase(),hours=JSON.parse(org.business_hours_json||'{}')[day];
 const at=`${a.hour}:${a.minute}`,bt=`${b.hour}:${b.minute}`;
 if(!hours||a.year!==b.year||a.month!==b.month||a.day!==b.day||at<hours[0]||bt>hours[1]) fail('Outside business hours');
 for(const id of ids){const availability=JSON.parse(r.get('users',id).availability_json||'{}'),weekday=['sun','mon','tue','wed','thu','fri','sat'].indexOf(day);if(availability.weekdays&&!availability.weekdays.includes(weekday)||availability.start&&at<availability.start||availability.end&&bt>availability.end)fail('Outside team availability');}
 if(conflicts(r,start,end,ids).length)fail('Slot unavailable',409);
 return {start,end,ids};
}
