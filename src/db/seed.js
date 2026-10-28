import { hashPassword, repository, transaction } from './database.js';
export function seedDatabase(db,{password='js-custom-tile-2026'}={}) {
 if(db.prepare('SELECT count(*) AS n FROM organizations').get().n>0)return;
 return transaction(db,()=>{
  const passwordHash=hashPassword(password);
  db.prepare('INSERT INTO organizations(id,name,slug,email,phone,website,address,city,state,postal_code,country,timezone,currency,tax_name,tax_rate,business_hours_json,branding_color) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(1,'J S Custom Tile','js-custom-tile','jscustomtilepros@gmail.com','9167518715','jscustomtile.com','11281 Pyrites Way','Gold River','California','95670','United States','America/Los_Angeles','USD','Sales Tax',8.25,JSON.stringify({mon:['08:00','17:00'],tue:['08:00','17:00'],wed:['08:00','17:00'],thu:['08:00','17:00'],fri:['08:00','17:00']}),'#388523');
  const r=repository(db,1);
  const resources=['clients','requests','quotes','jobs','schedule','invoices','payments','team','marketing','messages','automations','reports','catalog','settings','ai'];
  const team=[['Jack Surwald','jscustomtilepros@gmail.com','9167518715'],['Kyle Waterworth','kyle@jscustomtile.com',null],['Roger Burton','roger@jscustomtile.com',null],['William Houn','william@jscustomtile.com',null]];
  for(const [index,[roleName,roleSlug]] of [['Owner','owner'],['Dispatcher','dispatcher'],['Field Technician','technician'],['Limited Worker','limited']].entries()){
   const role=r.insert('roles',{name:roleName,slug:roleSlug,is_system:1});
   for(const resource of resources)for(const action of ['read','write']){const allowed=roleSlug==='owner'||roleSlug==='dispatcher'&&resource!=='settings'&&resource!=='team'||['technician','limited'].includes(roleSlug)&&['jobs','schedule','clients'].includes(resource)&&action==='read'||roleSlug==='technician'&&resource==='schedule';db.prepare('INSERT INTO permissions(role_id,resource,action,allowed) VALUES(?,?,?,?)').run(role.id,resource,action,Number(allowed));}
   const [name,email,phone]=team[index];
   r.insert('users',{role_id:role.id,name,email,phone,password_hash:passwordHash,is_active:1});
  }
 });
}
