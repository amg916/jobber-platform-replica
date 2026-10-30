import { fail, transaction } from '../db/database.js';
import { calculateDocument, reconcile } from './calculations.js';
const validIsoDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s))&&(()=>{const ms=Date.parse(String(s)+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===String(s);})();
const escapePDF=value=>String(value??'').replace(/[^\x20-\x7e]/g,'?').replace(/[\\()]/g,'\\$&');
export function generatePDF(document,items=[],organization={name:'J S Custom Tile'},signature=null) {
 const money=c=>`$${((c||0)/100).toFixed(2)}`;
 const text=[organization.name,document.subject?'INVOICE':'QUOTE',document.title||document.subject||'',`Number: ${document.quote_number||document.invoice_number||document.id}`,`Status: ${document.status}`,`Issued: ${document.issued_date||''}`, '',...items.map(i=>`${i.name}   ${i.quantity} x ${money(i.unit_price_cents)}   ${money(i.total_cents)}`),'',`Subtotal: ${money(document.subtotal_cents)}`,`Discount: ${money(document.discount_cents)}`,`Tax: ${money(document.tax_cents)}`,`Total: ${money(document.total_cents)}`,`Balance: ${money(document.balance_due_cents??document.total_cents)}`,document.client_message||''];
 if(signature?.name||signature?.signature||document.approved_by_name)text.push(`Signed by: ${signature?.name||document.approved_by_name||'Client'}${signature?.signature?' ('+signature.signature+')':''}`);
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
export function importCSV(repo,type,text,wOrCreateClient) {
 const handlers=typeof wOrCreateClient==='function'?{createClient:wOrCreateClient}:(wOrCreateClient||{});
 const fields={clients:'display_name first_name last_name company_name email phone mobile_phone status lead_source billing_address notes',products_services:'name item_type description category unit unit_cost_cents markup_percent unit_price_cents taxable active',requests:'client_id property_id title service_details status source preferred_date preferred_time internal_notes',quotes:'client_id property_id title status subtotal_cents tax_rate total_cents client_message disclaimer_notes internal_notes',jobs:'client_id property_id title instructions status job_type billing_type start_date end_date subtotal_cents tax_cents total_cents internal_notes',invoices:'client_id property_id job_id subject title status payment_terms issued_date due_date subtotal_cents tax_rate total_cents client_message disclaimer_notes internal_notes',expenses:'job_id user_id item_name status accounting_code description date_incurred amount_cents reimbursable billable'};
 const allowed=fields[type]?.split(' ');if(!allowed)fail('Unsupported import');
 return transaction(repo.db,()=>{const reconcileClients=new Set();const imported=parseCSV(text).map(row=>{
  if(Object.keys(row).some(k=>!allowed.includes(k)))fail('Unsupported CSV column');
  for(const k of Object.keys(row)){const id=['client_id','property_id','job_id','user_id'].includes(k),cents=k.endsWith('_cents'),bool=['taxable','active','reimbursable','billable'].includes(k),float=['tax_rate','markup_percent'].includes(k);if(!id&&!cents&&!bool&&!float)continue;if(row[k]===''){delete row[k];continue;}const raw=String(row[k]).trim(),n=Number(raw);if(!(float?/^\d+(\.\d{1,6})?$/.test(raw)&&Number.isFinite(n)&&n>=0&&(k!=='tax_rate'||n<=100):(id?/^[1-9]\d*$/:bool?/^[01]$/:/^\d+$/).test(raw)&&Number.isSafeInteger(n)))fail('Invalid numeric CSV field');row[k]=n;}
  for(const k of ['issued_date','due_date','start_date','end_date','date_incurred','preferred_date']){if(row[k]==='')delete row[k];else if(row[k]!==undefined&&!validIsoDate(row[k]))fail('Invalid CSV date');}
  if(row.start_date&&row.end_date&&row.start_date>row.end_date)fail('Invalid CSV date');
  const enums={clients:{status:'lead|active|archived'},products_services:{item_type:'service|product'},requests:{status:'new|assessment_scheduled|converted|archived|unscheduled',source:'manual|online_booking|client_hub|website_form|ai_receptionist'},quotes:{status:'draft|awaiting_response|changes_requested|approved|converted|archived'},jobs:{status:'active|requires_invoicing|action_required|late|on_hold|completed|archived|unscheduled',job_type:'one_off|recurring',billing_type:'upon_completion|visit_based|fixed_price|monthly'},invoices:{status:'draft|awaiting_payment',payment_terms:'upon_receipt|net_15|net_30|net_45|net_60|custom'},expenses:{status:'reviewed|pending'}}[type]||{};
  for(const [k,opts] of Object.entries(enums)){if(row[k]==='')delete row[k];else if(row[k]!==undefined&&!opts.split('|').includes(row[k]))fail(k==='payment_terms'?'Invalid payment terms':k==='status'&&type==='invoices'?'Imported invoices must be draft or awaiting_payment':`Invalid ${k}`);}
  if(type==='clients')return (handlers.createClient||(row=>repo.insert('clients',row)))(row);
  if(type==='invoices'){if(!row.subject&&row.title)row.subject=row.title;delete row.title;}
  const name=type==='products_services'?'name':type==='expenses'?'item_name':type==='invoices'?'subject':'title';if(!String(row[name]||'').trim())fail('Missing '+name);
  if(['requests','quotes','jobs','invoices'].includes(type)){if(!row.client_id)fail('Missing client_id');repo.get('clients',row.client_id);if(row.property_id&&repo.get('properties',row.property_id).client_id!==row.client_id)fail('Property belongs to another client');if(row.job_id&&repo.get('jobs',row.job_id).client_id!==row.client_id)fail('Job belongs to another client');}
  if(type==='expenses'){if(row.job_id)repo.get('jobs',row.job_id);if(row.user_id)repo.get('users',row.user_id);}
  if(type==='products_services'){const [calcLine]=calculateDocument([{name:row.name,quantity:1,unit_cost_cents:row.unit_cost_cents??0,markup_percent:row.markup_percent??0,taxable:row.taxable??1}]).lines;if(row.unit_price_cents!==undefined)calculateDocument([{name:row.name,quantity:1,unit_price_cents:row.unit_price_cents,taxable:row.taxable??1}]);else if(row.unit_cost_cents!==undefined||row.markup_percent!==undefined)row.unit_price_cents=calcLine.unit_price_cents;}
  if(type==='jobs'){const hasSub=row.subtotal_cents!==undefined,hasTax=row.tax_cents!==undefined,hasTot=row.total_cents!==undefined;if(hasSub||hasTax||hasTot){const tax=row.tax_cents??0,sub=hasSub?row.subtotal_cents:hasTot?row.total_cents-tax:-1,tot=hasTot?row.total_cents:hasSub?sub+tax:-1;if(sub<0||tot<0||sub+tax!==tot||(tax>0&&(sub<=0||tax>sub||calculateDocument([{name:row.title,quantity:1,unit_price_cents:sub,taxable:1}],{tax_rate:Number(((tax*100)/sub).toFixed(6))}).tax_cents!==tax)))fail('CSV job amounts do not match');row.subtotal_cents=sub;row.tax_cents=tax;row.total_cents=tot;}}
  const handler=handlers[{requests:'createRequest',quotes:'createQuote',jobs:'createJob',invoices:'createInvoice'}[type]];
  if(handler&&['quotes','invoices'].includes(type)){
   const data={...row},line=(amount,taxable)=>({name:row[name],quantity:1,unit_price_cents:amount,taxable});let items=[];
   if(row.subtotal_cents!==undefined){
    const taxable=row.tax_rate?1:0;items=[line(row.subtotal_cents,taxable)];const fullTotal=calculateDocument(items,{tax_rate:row.tax_rate}).total_cents;
    if(row.total_cents!==undefined&&fullTotal!==row.total_cents){
     if(row.subtotal_cents===row.total_cents)items=[line(row.subtotal_cents,0)];
     else if(row.tax_rate>0&&row.total_cents>row.subtotal_cents&&row.total_cents<fullTotal){
      const taxDiff=row.total_cents-row.subtotal_cents,lo=Math.max(1,Math.ceil(((taxDiff-0.5)*100)/row.tax_rate)-1),hi=Math.min(row.subtotal_cents-1,Math.floor(((taxDiff+0.5)*100)/row.tax_rate)+1),mid=Math.min(hi,Math.max(lo,Math.round(taxDiff*100/row.tax_rate)));
      const c=lo<=hi?[mid,lo,lo+1,mid-1,mid+1,hi-1,hi].find(v=>Number.isSafeInteger(v)&&v>=lo&&v<=hi&&v>0&&v<row.subtotal_cents&&calculateDocument([line(v,1),line(row.subtotal_cents-v,0)],{tax_rate:row.tax_rate}).total_cents===row.total_cents):undefined;
      if(c===undefined)fail('CSV subtotal_cents and total_cents do not match tax_rate');
      items=[line(c,1),line(row.subtotal_cents-c,0)];
     }else fail('CSV subtotal_cents and total_cents do not match tax_rate');
    }
   }else if(row.total_cents!==undefined){
    const cand=Math.round(row.total_cents/(1+(row.tax_rate||0)/100));
    const pretax=row.tax_rate?[cand-1,cand,cand+1].filter(c=>c>=0).find(c=>calculateDocument([line(c,1)],{tax_rate:row.tax_rate}).total_cents===row.total_cents):undefined;
    items=[line(pretax??row.total_cents,pretax===undefined?0:1)];
   }
   delete data.subtotal_cents;delete data.total_cents;const rawTerms=row.payment_terms;if(type==='invoices'){data.status='draft';if(['net_45','custom'].includes(rawTerms)){data.payment_terms='upon_receipt';if(rawTerms==='net_45'&&!data.due_date)data.due_date=new Date(Date.parse((data.issued_date||new Date().toISOString().slice(0,10))+'T00:00:00Z')+45*86400000).toISOString().slice(0,10);}}const created=handler(data,items);if(type==='invoices'&&row.status==='awaiting_payment'&&handlers.issueInvoice){const issued=handlers.issueInvoice(created.id,rawTerms,row.due_date,row.issued_date,true);reconcileClients.add(created.client_id);return issued;}return created;
  }
  return handler?handler(row):repo.insert(type,row);
 });
 for(const cid of reconcileClients)reconcile(repo,cid);
 return reconcileClients.size?imported.map(r=>repo.get('invoices',r.id)):imported;
 });
}
