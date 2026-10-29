import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail, token, verifyPassword, transaction } from '../db/database.js';

const headerToken=req=>req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]?.trim()||(typeof req.headers['x-jobber-token']==='string'?req.headers['x-jobber-token'].trim():'')||null;
const cookieToken=req=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('_jobber_session='))?.slice(16)||null;
export function requestToken(req){return headerToken(req)||cookieToken(req);}
export function sessionCookie(res,value,clear=false){res.setHeader('Set-Cookie',`_jobber_session=${value}; Path=/; HttpOnly; SameSite=Lax${clear?'; Max-Age=0':''}`);}
export function createAuth(db,{oauthClients={}}={}){
 const codes=new Map(),refresh=new Map(),attempts=new Map(),secret=token();
 const throttle=req=>{const now=Date.now(),key=req?.socket?.remoteAddress||req?.socket;for(const [ip,value] of attempts){if(value.until<=now)attempts.delete(ip);else break;}let prev=attempts.get(key);if(!prev||prev.until<=now){if(prev)attempts.delete(key);else if(attempts.size>=10000)attempts.delete(attempts.keys().next().value);prev={n:0,until:now+60000};attempts.set(key,prev);}if(++prev.n>30)fail('Too many login attempts',429);};
 const sweep=map=>{const now=Date.now();for(const [key,value] of map)if(value.expires<=now)map.delete(key);};
 const sessionUser=t=>{const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?').get(t||'',new Date().toISOString());return s?db.prepare('SELECT * FROM users WHERE id=? AND organization_id=? AND is_active=1').get(s.user_id,s.organization_id):null;};
 const credentialUser=d=>{if(!d||typeof d!=='object'||Array.isArray(d))fail('Invalid request',400);for(const key of ['username','email','password'])if(d[key]!=null&&typeof d[key]!=='string')fail('Invalid credentials',400);if(d.organization_id!=null&&d.organization_id!==''&&(typeof d.organization_id==='boolean'||typeof d.organization_id==='object'||!Number.isSafeInteger(Number(d.organization_id))||Number(d.organization_id)<1))fail('Invalid credentials',400);const u=db.prepare('SELECT * FROM users WHERE email=? AND organization_id=? AND is_active=1').get(d.username||d.email||'',Number(d.organization_id)||1);if(!u||!verifyPassword(d.password||'',u.password_hash))fail('Invalid credentials',401);return u;};
 const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
 const client=d=>{const c=oauthClients[d.client_id];if(c?.secret&&!equal(c.secret,d.client_secret))fail('Invalid client credentials',401);return c;};
 return {
  throttle,
  revoke(token){for(const [key,value] of refresh)if(value.access===token)refresh.delete(key);},
  revokeOrg(orgId,exceptAccess=null){sweep(codes);sweep(refresh);const revoked=new Set();for(const [key,value] of refresh)if(value.org===orgId&&value.access!==exceptAccess){revoked.add(value.access);refresh.delete(key);}for(const [key,value] of codes)if(value.org===orgId)codes.delete(key);return revoked;},
  csrf(t){return createHmac('sha256',secret).update(t||'public').digest('hex');},
  verifyOrigin(req){
   if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail('Invalid request origin',403);
   for(const h of [req.headers.origin,req.headers.referer].filter(Boolean)){let u;try{if(h==='null')fail('Invalid request origin',403);u=new URL(h);}catch{fail('Invalid request origin',403);}if(req.headers.host?u.host!==req.headers.host:!['localhost','127.0.0.1'].includes(u.hostname))fail('Invalid request origin',403);}
   if(req.headers['content-type']?.includes('application/x-www-form-urlencoded')&&!equal(req.headers['x-csrf-token']||req.headers['x-xsrf-token'],this.csrf(requestToken(req))))fail('Invalid CSRF token',403);
  },
  verifyCsrf(req){const t=requestToken(req);if(!headerToken(req)&&cookieToken(req)&&!['GET','HEAD','OPTIONS'].includes(req.method)){this.verifyOrigin(req);if(!equal(req.headers['x-csrf-token']||req.headers['x-xsrf-token'],this.csrf(t)))fail('Invalid CSRF token',403);}},
  authorize(req,d){if(!d||typeof d!=='object'||Array.isArray(d))fail('Invalid request',400);sweep(codes);sweep(refresh);if(codes.size>=10000)fail('Too many pending authorizations',429);if(d.response_type!=='code')fail('response_type must be code');if(!d.client_id)fail('client_id is required');if(typeof d.client_id!=='string'||!d.client_id.trim()||d.client_id.length>256)fail('Invalid client_id');if(d.redirect_uri!=null&&(typeof d.redirect_uri!=='string'||d.redirect_uri.length>2048))fail('Invalid redirect_uri');if(d.state!=null&&(typeof d.state!=='string'||d.state.length>1024))fail('Invalid state');const u=sessionUser(requestToken(req));if(!u)fail('Authentication required',401);const c=oauthClients[d.client_id];if(d.redirect_uri){let redirect;try{redirect=new URL(d.redirect_uri);}catch{fail('Invalid redirect_uri');}if(!['http:','https:'].includes(redirect.protocol)||redirect.hash||redirect.username||redirect.password)fail('Invalid redirect_uri');if(!c?.redirectUris?.includes(d.redirect_uri))fail('Unregistered redirect_uri',400);}
   const code=token();codes.set(code,{userId:u.id,org:u.organization_id,clientId:d.client_id,redirect:d.redirect_uri||'',expires:Date.now()+600000});return {code,state:d.state??null,redirect_uri:d.redirect_uri||null};},
  exchange(d,req){if(!d||typeof d!=='object'||Array.isArray(d))fail('Invalid request',400);if(typeof d.grant_type!=='string')fail('Unsupported grant_type',400);for(const key of ['client_secret','code','refresh_token','redirect_uri'])if(d[key]!=null&&typeof d[key]!=='string')fail(`Invalid ${key}`,key==='client_secret'?401:400);if(d.grant_type==='password')throttle(req);sweep(codes);sweep(refresh);if(d.client_id!=null&&(typeof d.client_id!=='string'||!d.client_id.trim()||d.client_id.length>256))fail('Invalid client_id',400);const c=client(d);let u,revokeToken;
   if(d.grant_type==='authorization_code'){const grant=codes.get(d.code);if(!grant||grant.clientId!==d.client_id||grant.redirect!==(d.redirect_uri||''))fail('Invalid authorization code',400);u=db.prepare('SELECT * FROM users WHERE id=? AND organization_id=? AND is_active=1').get(grant.userId,grant.org);if(!u)fail('Invalid grant',400);}
   else if(d.grant_type==='refresh_token'){const grant=refresh.get(d.refresh_token);if(!grant||grant.clientId!==(d.client_id||null))fail('Invalid refresh token',400);const previous=db.prepare('SELECT user_id,organization_id,expires_at FROM sessions WHERE token=?').get(grant.access);u=previous?db.prepare('SELECT * FROM users WHERE id=? AND organization_id=? AND is_active=1').get(previous.user_id,previous.organization_id):null;if(!u||previous.expires_at<=new Date(0).toISOString()){refresh.delete(d.refresh_token);fail('Invalid refresh token',400);}revokeToken=grant.access;}
   else if(d.grant_type==='password')u=credentialUser(d);
   else if(d.grant_type==='client_credentials'){if(!c?.secret||!c.userId||!c.organizationId)fail('Registered client credentials required',401);u=db.prepare('SELECT * FROM users WHERE id=? AND organization_id=? AND is_active=1').get(c.userId,c.organizationId);if(!u)fail('Invalid client user',401);}
   else fail('Unsupported grant_type');
   if(d.grant_type!=='refresh_token'&&refresh.size>=10000){const active=new Set(db.prepare('SELECT s.token FROM sessions s JOIN users u ON u.id=s.user_id AND u.organization_id=s.organization_id WHERE s.expires_at>? AND u.is_active=1').all(new Date(0).toISOString()).map(s=>s.token));for(const [k,v] of refresh)if(!active.has(v.access))refresh.delete(k);if(refresh.size>=10000)fail('Too many pending authorizations',429);}
   const access_token=token(),refresh_token=token();
   transaction(db,()=>{if(revokeToken)db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(0).toISOString(),revokeToken);db.prepare('INSERT INTO sessions(token,user_id,organization_id,expires_at) VALUES(?,?,?,?)').run(access_token,u.id,u.organization_id,new Date(Date.now()+86400000).toISOString());});
   if(d.grant_type==='authorization_code')codes.delete(d.code);if(d.grant_type==='refresh_token')refresh.delete(d.refresh_token);
   refresh.set(refresh_token,{userId:u.id,org:u.organization_id,clientId:d.client_id||null,access:access_token,expires:Date.now()+30*86400000});return {access_token,token_type:'Bearer',expires_in:86400,refresh_token,scope:'read write'};
  }
 };
}

export function railsPath(path){
 if(path==='/graphql'||path.startsWith('/oauth/'))return '/api'+path;
 if(!path.endsWith('.json')||path==='/reference-icons.json'||path.startsWith('/assets/'))return path;
 const parts=path.slice(0,-5).split('/').filter(Boolean);
 if(parts[0]==='api')return path.slice(0,-5);
 parts[0]=({work_requests:'requests',work_orders:'jobs',time_sheet_entries:'time-entries',timesheets:'time-entries',products_and_services:'catalog'})[parts[0]]||parts[0];
 if(['calendar','schedule'].includes(parts[0])&&parts[1]==='events')return '/api/schedule';
 if(parts[2])parts[2]=({send_quote:'send',request_changes:'request-changes',convert_to_job:'job',visits:'visit',generate_invoice:'invoice',send_invoice:'issue',record_payment:'record-payment'})[parts[2]]||parts[2];
 return '/api/'+parts.join('/');
}
