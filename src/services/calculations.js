import { fail } from '../db/database.js';
function decimal(value) {
 const text=String(value ?? 0); if(!/^\d+(\.\d{1,6})?$/.test(text)) fail('Expected nonnegative decimal with up to six decimal places');
 const [whole,fraction='']=text.split('.'); return [BigInt(whole+fraction),10n**BigInt(fraction.length)];
}
function rounded(n,d) { const result=Number((n+d/2n)/d); if(!Number.isSafeInteger(result)) fail('Amount exceeds safe integer range'); return result; }
export function cents(value) { if(!Number.isSafeInteger(value)||value<0) fail('Expected nonnegative integer cents'); return value; }
export function multiply(amount,value) { cents(amount); const [n,d]=decimal(value); return rounded(BigInt(amount)*n,d); }
export function percent(amount,value) { cents(amount); const [n,d]=decimal(value); return rounded(BigInt(amount)*n,d*100n); }
export function calculateDocument(items, options={}) {
 const lines=items.map(item=>{ const price=item.unit_price_cents == null ? cents(item.unit_cost_cents||0)+percent(item.unit_cost_cents||0,item.markup_percent||0) : cents(item.unit_price_cents); const selected=!item.is_optional || !!item.is_selected; return {...item,quantity:item.quantity??1,unit_price_cents:price,total_cents:selected?multiply(price,item.quantity??1):0}; });
 const subtotal_cents=lines.reduce((s,l)=>s+l.total_cents,0); cents(subtotal_cents);
 const discount_cents=Math.min(subtotal_cents,options.discount_type==='fixed'?cents(options.discount_value||0):percent(subtotal_cents,options.discount_value||0));
 const taxable=lines.filter(l=>l.taxable).reduce((s,l)=>s+l.total_cents,0);
 const taxableDiscount=subtotal_cents?rounded(BigInt(discount_cents)*BigInt(taxable),BigInt(subtotal_cents)):0;
 const tax_cents=percent(taxable-taxableDiscount,options.tax_rate||0);
 const total_cents=subtotal_cents-discount_cents+tax_cents; cents(total_cents);
 const required_deposit_cents=options.required_deposit_type==='fixed'?Math.min(total_cents,cents(options.required_deposit_value||0)):options.required_deposit_type==='percent'?Math.min(total_cents,percent(total_cents,options.required_deposit_value||0)):0;
 return {lines,subtotal_cents,discount_cents,tax_cents,total_cents,required_deposit_cents};
}
export function jobCosting(revenue,labor,expenses) { [revenue,labor,expenses].forEach(cents); const profit_cents=revenue-labor-expenses; return {revenue_cents:revenue,labor_cost_cents:labor,expense_cost_cents:expenses,profit_cents,margin_percent:revenue?Math.round(profit_cents/revenue*10000)/100:0}; }
export function reconcile(repo,clientId) {
 for(const invoice of repo.list('invoices',{client_id:clientId})) {
  const allocations=repo.list('payment_allocations',{invoice_id:invoice.id}).reduce((s,a)=>s+a.amount_cents,0);
  const refunds=repo.list('refunds',{invoice_id:invoice.id}).reduce((s,r)=>s+r.amount_cents,0);
  const amount_paid_cents=allocations-refunds;
  const balance_due_cents=Math.max(0,invoice.total_cents-amount_paid_cents);
  const status=['draft','void','bad_debt'].includes(invoice.status)?invoice.status:balance_due_cents===0?'paid':amount_paid_cents>0?'partial':invoice.due_date && invoice.due_date<new Date().toISOString().slice(0,10)?'past_due':'awaiting_payment';
  if(invoice.amount_paid_cents!==amount_paid_cents||invoice.balance_due_cents!==balance_due_cents||invoice.status!==status) repo.update('invoices',invoice.id,{amount_paid_cents,balance_due_cents,status,paid_at:status==='paid'?invoice.paid_at||new Date().toISOString():null});
 }
 const balance=repo.list('invoices',{client_id:clientId}).filter(i=>!['draft','void','bad_debt'].includes(i.status)).reduce((s,i)=>s+i.balance_due_cents,0);
 const client=repo.get('clients',clientId);
 return client.balance_cents!==balance?repo.update('clients',clientId,{balance_cents:balance}):client;
}
