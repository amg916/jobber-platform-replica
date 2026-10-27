import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { migrate, columns } from './schema.js';
export function createDatabase(dbPath = ':memory:') {
 const db = new DatabaseSync(dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(dbPath !== ':memory:') db.exec('PRAGMA journal_mode=WAL;');
 migrate(db); return db;
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
export function transaction(db, fn) {
 const name = `scope_${++sequence}`; db.exec(`SAVEPOINT ${name}`);
 try { const value = fn(); if(value && typeof value.then === 'function') throw new Error('Transactions must be synchronous'); db.exec(`RELEASE ${name}`); return value; }
 catch(error) { try { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); } catch {} throw error; }
}
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export const token = () => randomBytes(32).toString('hex');
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password, hash) { try { const [s,h] = hash.split(':'); return timingSafeEqual(scryptSync(password,s,64),Buffer.from(h,'hex')); } catch { return false; } }
export function repository(db, organizationId) {
 if(!Number.isSafeInteger(organizationId) || organizationId < 1) fail('Organization required',403);
 const valid = table => { if(!columns[table]?.includes('organization_id') || table === 'sessions') fail('Unsupported resource'); };
 const get = (table,id) => { valid(table); const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=?`).get(id,organizationId); if(!row) fail('Record not found',404); return row; };
 const list = (table, filters={}) => { valid(table); const entries=Object.entries(filters); for(const [k] of entries) if(!columns[table].includes(k) || k==='organization_id') fail('Invalid filter'); return db.prepare(`SELECT * FROM ${table} WHERE organization_id=?${entries.map(([k])=>` AND ${k} IS ?`).join('')} ORDER BY id`).all(organizationId,...entries.map(([,v])=>bind(v))); };
 const clean = (table, data) => { valid(table); const result={}; for(const [k,v] of Object.entries(data)) { if(['id','organization_id'].includes(k)) continue; if(!columns[table].includes(k)) fail(`Unknown field: ${k}`); result[k]=bind(v); } return result; };
 const insert = (table,data) => { const d={...clean(table,data),organization_id:organizationId}; const keys=Object.keys(d); const r=db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(d)); return get(table,Number(r.lastInsertRowid)); };
 const update = (table,id,data) => { get(table,id); const d=clean(table,data); if(columns[table].includes('updated_at')) d.updated_at=new Date().toISOString(); const keys=Object.keys(d); if(keys.length) db.prepare(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=? AND organization_id=?`).run(...Object.values(d),id,organizationId); return get(table,id); };
 return { get,list,insert,update,organizationId,db };
}
