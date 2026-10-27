import { fail, transaction } from '../db/database.js';
const escapePDF=value=>String(value??'').replace(/[^\x20-\x7e]/g,'?').replace(/[\\()]/g,'\\$&');
export function generatePDF(document,items=[],organization={name:'Greenleaf Home & Lawn Services'}) {
 const money=c=>`$${((c||0)/100).toFixed(2)}`;
 const text=[organization.name,document.subject?'INVOICE':'QUOTE',document.title||document.subject||'',`Number: ${document.quote_number||document.invoice_number||document.id}`,`Status: ${document.status}`,`Issued: ${document.issued_date||''}`, '',...items.map(i=>`${i.name}   ${i.quantity} x ${money(i.unit_price_cents)}   ${money(i.total_cents)}`),'',`Subtotal: ${money(document.subtotal_cents)}`,`Discount: ${money(document.discount_cents)}`,`Tax: ${money(document.tax_cents)}`,`Total: ${money(document.total_cents)}`,`Balance: ${money(document.balance_due_cents??document.total_cents)}`,document.client_message||''];
 const pages=[];for(let i=0;i<text.length;i+=42)pages.push(text.slice(i,i+42));
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const pageIds=[];
 for(const lines of pages){const pageId=objects.length+1,streamId=pageId+1;pageIds.push(pageId);const stream=`BT /F1 12 Tf 48 752 Td 16 TL\n${lines.map((line,i)=>`${i?'T* ':''}(${escapePDF(line)}) Tj`).join('\n')}\nET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}
 objects[1]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
 let output='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(output);
}
export function exportCSV(rows,fields=Object.keys(rows[0]||{})) { const quote=value=>{let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};return [fields,...rows.map(r=>fields.map(f=>r[f]))].map(row=>row.map(quote).join(',')).join('\r\n'); }
export function parseCSV(text) {
 if(typeof text!=='string')fail('CSV text required');text=text.replace(/^﻿/,'');const rows=[];let row=[],field='',quoted=false,afterQuote=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
  if(c==='"'){if(field||afterQuote)fail('Malformed CSV quote');quoted=true;continue;}if(c===','||c==='\n'||c==='\r'){row.push(field);field='';afterQuote=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}continue;}if(afterQuote)fail('Unexpected CSV text after quote');field+=c;
 }
 if(quoted)fail('Unclosed CSV quote');if(field||row.length||afterQuote){row.push(field);rows.push(row);}if(!rows.length)return[];const headers=rows.shift();if(new Set(headers).size!==headers.length||headers.some(h=>!h))fail('Invalid CSV headers');return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==headers.length)fail('CSV column count mismatch');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
export function importCSV(repo,type,text,createClient) {
 const allowed=type==='clients'?['display_name','first_name','last_name','company_name','email','phone','status','notes']:type==='products_services'?['name','item_type','description','unit','unit_cost_cents','unit_price_cents','taxable','active']:null;if(!allowed)fail('Unsupported import');
 return transaction(repo.db,()=>parseCSV(text).map(row=>{if(Object.keys(row).some(k=>!allowed.includes(k)))fail('Unsupported CSV column');for(const k of Object.keys(row))if(k.endsWith('_cents')||['taxable','active'].includes(k)){if(!/^\d+$/.test(row[k]))fail('Invalid numeric CSV field');row[k]=Number(row[k]);}return type==='clients'?createClient(row):repo.insert(type,row);}));
}
