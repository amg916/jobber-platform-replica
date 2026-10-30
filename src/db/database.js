import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { migrate, columns } from './schema.js';
export function createDatabase(dbPath = ':memory:') {
 const db = new DatabaseSync(dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(dbPath !== ':memory:') db.exec('PRAGMA journal_mode=WAL;');
 migrate(db); initPrefRevTrigger(db); return db;
}
export function bind(value) {
 if(value == null) return null;
 if(typeof value === 'boolean') return Number(value);
 if(typeof value === 'number' && !Number.isFinite(value)) fail('Invalid numeric value');
 if(typeof value === 'object') return JSON.stringify(value);
 if(!['string','number','bigint'].includes(typeof value)) fail('Invalid parameter value');
 return value;
}
let sequence = 0;
const preferenceRevs = new WeakMap(), revSavepoints = new WeakMap();
function snapPrefRevMap(db) {
 const top = revSavepoints.get(db)?.at(-1); if(!top || top.snap) return;
 const m = preferenceRevs.get(db); top.snap = new Map();
 if(m) for(const [k,v] of m) top.snap.set(k,{names:new Set(v.names),sessions:new Map(v.sessions)});
}
function initPrefRevTrigger(db) {
 if(!preferenceRevs.has(db)) preferenceRevs.set(db,new Map());
 try { db.function('__purge_pref_rev',rowId=>{ const map=preferenceRevs.get(db), rk=Number(rowId); if(map?.has(rk)){ snapPrefRevMap(db); map.delete(rk); } return 0; }); db.exec('CREATE TEMP TRIGGER IF NOT EXISTS __pref_rev_delete AFTER DELETE ON preferences BEGIN SELECT __purge_pref_rev(OLD.id); END;'); } catch {}
}
export function transaction(db, fn) {
 const name = `scope_${++sequence}`; let stack = revSavepoints.get(db); if(!stack){ stack=[]; revSavepoints.set(db,stack); } stack.push({snap:null}); db.exec(`SAVEPOINT ${name}`);
 try { const value = fn(); if(value && typeof value.then === 'function') throw new Error('Transactions must be synchronous'); db.exec(`RELEASE ${name}`); const frame = stack.pop(), parent = stack.at(-1); if(parent && frame.snap && !parent.snap) parent.snap = frame.snap; return value; }
 catch(error) { try { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); } catch {} const frame = stack.pop(); if(frame?.snap){ let m = preferenceRevs.get(db); if(!m){ m=new Map(); preferenceRevs.set(db,m); } m.clear(); for(const [k,v] of frame.snap) m.set(k,v); } if(!stack.length) initPrefRevTrigger(db); throw error; }
}
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export const token = () => randomBytes(32).toString('hex');
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password, hash) { try { const [s,h] = hash.split(':'); return timingSafeEqual(scryptSync(password,s,64),Buffer.from(h,'hex')); } catch { return false; } }
export function repository(db, organizationId) {
 if(!Number.isSafeInteger(organizationId) || organizationId < 1) fail('Organization required',403);
 const valid = table => { if(!columns[table]?.includes('organization_id') || table === 'sessions') fail('Unsupported resource'); };
 const syncNote = (table,row) => { if(table==='notes' && row && typeof row==='object'){ const body=row.body??row.content??'', content=row.content??row.body??''; row.body=body; row.content=content; } return row; };
 const get = (table,id) => { valid(table); const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=?`).get(id,organizationId); if(!row) fail('Record not found',404); return syncNote(table,row); };
 const list = (table, filters={}) => { valid(table); const entries=Object.entries(filters); for(const [k] of entries) if(!columns[table].includes(k) || k==='organization_id') fail('Invalid filter'); return db.prepare(`SELECT * FROM ${table} WHERE organization_id=?${entries.map(([k])=>` AND ${k} IS ?`).join('')} ORDER BY id`).all(organizationId,...entries.map(([,v])=>bind(v))).map(row=>syncNote(table,row)); };
 const parsePrefRev = revRaw => { if(typeof revRaw!=='string' || !revRaw.includes(':')) return null; const idx=revRaw.lastIndexOf(':'), session=revRaw.slice(0,idx), attempt=Number(revRaw.slice(idx+1)); return session && Number.isSafeInteger(attempt) && attempt>0 ? {session,attempt} : null; };
 const ensurePrefRevMap = () => { if(!preferenceRevs.has(db)) initPrefRevTrigger(db); return preferenceRevs.get(db); };
 const findPrefRevByName = name => { const m=preferenceRevs.get(db), nk=`${organizationId}:${name}`; if(!m) return null; for(const [rid,e] of m) if(e.names.has(nk)) return rid; return null; };
 const prefRevCheck = (rowId, revRaw) => { if(!rowId) return true; const parsed=parsePrefRev(revRaw); if(!parsed) return true; const entry=preferenceRevs.get(db)?.get(Number(rowId)); if(!entry) return true; return parsed.attempt>=(entry.sessions.get(parsed.session)||0); };
 const prefRevCommit = (rowId, revRaw, names=[]) => { if(!rowId) return; const m=ensurePrefRevMap(), rk=Number(rowId); snapPrefRevMap(db); const parsed=parsePrefRev(revRaw); if(parsed){ let entry=m.get(rk); if(!entry) entry={names:new Set(),sessions:new Map()}; else m.delete(rk); for(const n of names) if(n){ const nk=`${organizationId}:${n}`; for(const [oid,oe] of m) if(oid!==rk) oe.names.delete(nk); entry.names.delete(nk); entry.names.add(nk); if(entry.names.size>16) entry.names.delete(entry.names.values().next().value); } m.set(rk,entry); if(m.size>256) m.delete(m.keys().next().value); const sm=entry.sessions, prev=sm.get(parsed.session)||0; sm.delete(parsed.session); sm.set(parsed.session,Math.max(prev,parsed.attempt)); if(sm.size>64) sm.delete(sm.keys().next().value); } else m.delete(rk); };
 const clean = (table, data) => { valid(table); const result={}; for(const [k,v] of Object.entries(data)) { if(['id','organization_id'].includes(k) || (table==='preferences' && k==='revision')) continue; if(!columns[table].includes(k)) fail(`Unknown field: ${k}`); result[k]=bind(v); } if(table==='notes'&&columns.notes?.includes('body')&&columns.notes?.includes('content')){ if(result.body!==undefined&&result.content===undefined)result.content=result.body; else if(result.content!==undefined&&result.body===undefined)result.body=result.content; } return result; };
 const insert = (table,data) => { if(table==='preferences' && data?.name){ const name=String(data.name), existing=db.prepare('SELECT * FROM preferences WHERE organization_id=? AND name=? ORDER BY id DESC LIMIT 1').get(organizationId,name), checkId=existing?Number(existing.id):findPrefRevByName(name); if(checkId && !prefRevCheck(checkId,data.revision)) return existing || (()=>{ try { return get(table,checkId); } catch { return null; } })(); if(existing && parsePrefRev(data.revision)) return update(table,Number(existing.id),data,true); } const d={...clean(table,data),organization_id:organizationId}; const keys=Object.keys(d); const r=db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(d)); const newId=Number(r.lastInsertRowid); if(table==='preferences' && data?.name) prefRevCommit(newId,data.revision,[String(data.name)]); return get(table,newId); };
 const update = (table,id,data,checkedRev=false) => { const row=get(table,id), rowId=Number(row.id); if(table==='preferences' && !checkedRev && !prefRevCheck(rowId,data?.revision)) return row; const d=clean(table,data); if(columns[table].includes('updated_at')) d.updated_at=new Date().toISOString(); const keys=Object.keys(d); if(keys.length) db.prepare(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=? AND organization_id=?`).run(...Object.values(d),id,organizationId); if(table==='preferences') prefRevCommit(rowId,data?.revision,[row.name,data?.name]); return get(table,id); };
 return { get,list,insert,update,organizationId,db };
}
