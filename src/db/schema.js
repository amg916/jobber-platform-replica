// Compact declarations are expanded into strict SQLite tables and tenant-aware foreign keys.
export const definitions = {
 webhook_subscriptions: 'organization_id! topic! target_url! secret active? delivery_count$ last_delivered_at last_payload_json last_signature delivered_keys_json created_at',
 invoice_credits: 'organization_id! invoice_id! amount_cents$ reason created_at',
 preferences: 'organization_id! name! value_json',
 subscription_payments: 'organization_id! date! description! amount_cents$ receipt_number!',
 organizations: 'name! slug! email phone website address address_line2 city state postal_code country timezone currency tax_name tax_rate# business_hours_json branding_color logo_url created_at',
 roles: 'organization_id! name! slug! is_system?',
 permissions: 'role_id! resource! action! allowed?',
 users: 'organization_id! role_id! name! email! password_hash! phone avatar_color hourly_cost# is_active? availability_json notification_prefs_json created_at',
 sessions: 'token! user_id! organization_id! expires_at! created_at',
 clients: 'organization_id! first_name last_name company_name display_name! email phone mobile_phone status=lead|active|archived lead_source billing_address balance_cents$ portal_token receives_sms? receives_email? receives_marketing? notes created_at updated_at',
 client_contacts: 'organization_id! client_id! name! role_title email phone is_primary?',
 properties: 'organization_id! client_id! street1 street2 city state postal_code country lat# lng# tax_rate# routing_notes is_primary? created_at',
 tags: 'organization_id! name! color',
 entity_tags: 'organization_id! tag_id! entity_type! entity_id!',
 custom_field_definitions: 'organization_id! entity_type! field_name! field_key! field_type=text|number|boolean|date|select options_json default_value transferable?',
 custom_field_values: 'organization_id! field_definition_id! entity_type! entity_id! value_text',
 products_services: 'organization_id! item_type=service|product name! description category unit unit_cost_cents$ markup_percent# unit_price_cents$ taxable? is_optional_default? active? created_at',
 requests: 'organization_id! client_id! property_id request_number title! service_details status=new|assessment_scheduled|converted|archived|unscheduled source=manual|online_booking|client_hub|website_form|ai_receptionist preferred_date preferred_time assigned_user_id assessment_start assessment_end assessment_instructions internal_notes created_at updated_at',
 quotes: 'organization_id! client_id! property_id request_id salesperson_id quote_number title! status=draft|awaiting_response|changes_requested|approved|converted|archived subtotal_cents$ discount_type=percent|fixed discount_value# discount_cents$ tax_rate# tax_cents$ total_cents$ required_deposit_type=none|percent|fixed required_deposit_value# required_deposit_cents$ deposit_paid_cents$ client_message disclaimer_notes internal_notes issued_date expiry_date approved_at approved_by_name change_request_notes template_name created_at updated_at',
 quote_line_items: 'organization_id! quote_id! product_service_id name! description quantity# unit unit_cost_cents$ markup_percent# unit_price_cents$ total_cents$ is_optional? is_selected? taxable? sort_order$',
 jobs: 'organization_id! client_id! property_id quote_id request_id job_number title! instructions status=active|requires_invoicing|action_required|late|on_hold|completed|archived|unscheduled job_type=one_off|recurring billing_type=upon_completion|visit_based|fixed_price|monthly start_date end_date start_time end_time assigned_user_ids_json subtotal_cents$ tax_cents$ total_cents$ labor_cost_cents$ expense_cost_cents$ profit_cents$ internal_notes created_at updated_at',
 recurrence_rules: 'organization_id! job_id! frequency=daily|weekly|biweekly|monthly interval_count$ days_of_week_json day_of_month$ start_date! until_date occurrence_count$ duration_minutes$ auto_invoice?',
 visits: 'organization_id! job_id! client_id! property_id title! instructions status=scheduled|unscheduled|in_progress|completed|late|cancelled scheduled_start scheduled_end occurrence_start anytime? assigned_user_ids_json completed_at completed_by_user_id completion_notes billable_amount_cents$ invoiced? invoice_id created_at',
 appointments: 'organization_id! entity_type=visit|assessment|task entity_id! title start_at end_at assigned_user_ids_json color status',
 tasks: 'organization_id! client_id job_id title! instructions due_date start_time end_time assigned_user_id status=open|completed completed_at created_at',
 checklists: 'organization_id! job_id visit_id title!',
 checklist_items: 'organization_id! checklist_id! label! is_completed? completed_by_user_id completed_at sort_order$',
 invoices: 'organization_id! client_id! property_id job_id quote_id invoice_number subject! status=draft|awaiting_payment|partial|paid|past_due|bad_debt|void issued_date due_date payment_terms=upon_receipt|net_15|net_30|net_60 subtotal_cents$ discount_type=percent|fixed discount_value# discount_cents$ tax_rate# tax_cents$ total_cents$ amount_paid_cents$ balance_due_cents$ deposits_applied_cents$ client_message disclaimer_notes internal_notes sent_at paid_at created_at updated_at',
 invoice_line_items: 'organization_id! invoice_id! product_service_id visit_id name! description quantity# unit unit_price_cents$ total_cents$ taxable? sort_order$',
 payments: 'organization_id! client_id! invoice_id quote_id payment_type=invoice_payment|deposit|client_credit method=card|ach|cash|check|other processor_ref status=succeeded|pending|refunded|partially_refunded|failed amount_cents$ refunded_cents$ tip_cents$ fee_cents$ net_cents$ card_brand card_last4 notes paid_at created_at',
 payment_allocations: 'organization_id! payment_id! invoice_id! amount_cents$ created_at',
 refunds: 'organization_id! payment_id! invoice_id client_id! amount_cents$ reason processor_ref created_at',
 time_entries: 'organization_id! user_id! job_id visit_id category=general|job|travel|break start_at! end_at duration_minutes# hourly_cost_cents$ total_cost_cents$ notes billable? created_at',
 expenses: 'organization_id! job_id user_id item_name! status=reviewed|pending accounting_code description date_incurred amount_cents$ reimbursable? billable? invoiced? receipt_url created_at',
 templates: 'organization_id! template_type=email|sms|quote|invoice|job_checklist name! subject body variables_json is_default? created_at',
 campaigns: 'organization_id! name! created_by campaign_type channel=email|sms segment_filter_json template_id subject body status=draft|scheduled|sent recipients_count$ delivered_count$ opened_count$ clicked_count$ revenue_attributed_cents$ sent_at created_at updated_at',
 messages: 'organization_id! client_id channel=email|sms|portal|in_app direction=outbound|inbound recipient subject body related_entity_type related_entity_id status=delivered|test_mode|queued|failed provider_mode=sandbox|configured created_at',
 notifications: 'organization_id! user_id title! body entity_type entity_id is_read? created_at',
 automations: 'organization_id! name! description trigger_event=client_created|request_submitted|quote_sent|quote_approved|job_scheduled|visit_approaching|job_completed|invoice_issued|invoice_overdue|payment_received conditions_json delay_minutes$ action_type=send_email|send_sms|create_task|change_status|notify_team_member|schedule_followup|update_record action_config_json is_enabled? run_count$ last_run_at created_at',
 automation_executions: 'organization_id! automation_id! trigger_event entity_type entity_id idempotency_key! status=queued|running|succeeded|failed|skipped attempt_count$ max_attempts$ scheduled_for! executed_at result_json error_message created_at',
 attachments: 'organization_id! entity_type! entity_id! file_name! file_type file_size_bytes$ content_text uploaded_by_user_id created_at',
 notes: 'organization_id! entity_type! entity_id! body content is_pinned? author_user_id created_at updated_at',
 activity_logs: 'organization_id! actor_user_id actor_name client_id entity_type entity_id action summary metadata_json created_at',
 integration_connections: 'organization_id! provider=quickbooks_online|stripe_payments|twilio_sms|sendgrid_email|google_calendar|companycam|mailchimp|zapier|openai_receptionist|servicetitan|home_depot|chatgpt|claude|gusto|nicejob|wisr_ai|voicepro|rilla|wrenchers|hover|fraction|linear_feet|my_service_area|responsibid|sendjim|thumbtack|accuinsight|accuprice|adcritter|ada_ai|adaptlocal|adhesion|agnostic_rhythm|aircall|angi|applause|arcsite|asset_minder|attachment_download|azuga|birdeye|bluevine|bonusup|broadly|byteline_sync display_name category status=connected_sandbox|connected_live|disconnected config_json last_sync_at created_at',
 online_bookings: 'organization_id! client_id! request_id job_id service_id service_name customer_name customer_email customer_phone address requested_date requested_slot assigned_user_id status=confirmed|rescheduled|cancelled confirmation_code! created_at',
 ai_receptionist_logs: 'organization_id! caller_name caller_phone client_id request_id transcript intent summary action_taken status=handled|escalated|voicemail duration_seconds$ created_at'
};
export const columns = Object.fromEntries(Object.entries(definitions).map(([t, d]) => [t, ['id', ...d.split(' ').map(x => x.split('=')[0].replace(/[!#$?]/g, ''))]]));
const references = { organization_id:'organizations', role_id:'roles', user_id:'users', actor_user_id:'users', author_user_id:'users', assigned_user_id:'users', salesperson_id:'users', completed_by_user_id:'users', uploaded_by_user_id:'users', client_id:'clients', property_id:'properties', tag_id:'tags', field_definition_id:'custom_field_definitions', product_service_id:'products_services', service_id:'products_services', request_id:'requests', quote_id:'quotes', job_id:'jobs', visit_id:'visits', checklist_id:'checklists', invoice_id:'invoices', payment_id:'payments', template_id:'templates', automation_id:'automations' };
export function migrate(db) {
 const tableDefs={};
 for (const [table, declaration] of Object.entries(definitions)) {
  const parts = ['id INTEGER PRIMARY KEY'];
  for (const token of declaration.split(' ')) {
   const [raw, choices] = token.split('='); const name = raw.replace(/[!#$?]/g, '');
   const type = name.endsWith('_id') || /[$?]/.test(raw) ? 'INTEGER' : raw.includes('#') ? 'REAL' : 'TEXT';
   let sql = `${name} ${type}`;
   if (raw.includes('!')) sql += ' NOT NULL';
   if (choices) sql += ` NOT NULL DEFAULT '${choices.split('|')[0]}' CHECK (${name} IN (${choices.split('|').map(v=>`'${v}'`).join(',')}))`;
   else if (/[$?#]/.test(raw)) sql += ` NOT NULL DEFAULT ${name === 'quantity' || name === 'interval_count' ? 1 : 0}`;
   else if (name.endsWith('_json')) sql += ` DEFAULT '${name.includes('ids') || name.includes('week') || name==='delivered_keys_json' ? '[]' : '{}'}' CHECK(json_valid(${name}))`;
   else if (name === 'created_at' || name === 'updated_at') sql += " NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
   if (raw.includes('?')) sql += ` CHECK (${name} IN (0,1))`;
   if (name.endsWith('_cents') && !['balance_cents','profit_cents','net_cents'].includes(name)) sql += ` CHECK (${name} >= 0)`;
   parts.push(sql);
  }
  if (columns[table].includes('organization_id')) parts.push('UNIQUE (id, organization_id)');
  for (const name of columns[table]) {
   const ref = references[name]; if (!ref) continue;
   if (name === 'organization_id' || !columns[table].includes('organization_id')) parts.push(`FOREIGN KEY (${name}) REFERENCES ${ref}(id)`);
   else parts.push(`FOREIGN KEY (${name}, organization_id) REFERENCES ${ref}(id, organization_id)`);
  }
  tableDefs[table]=parts.join(',');
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${parts.join(',')}) STRICT`);
 }
 const atomic=(check,sql)=>{if(!check())return;const sp=db.isTransaction;db.exec(sp?'SAVEPOINT mig':'BEGIN IMMEDIATE');try{if(check())db.exec(sql);db.exec(sp?'RELEASE mig':'COMMIT');}catch(e){try{db.exec(sp?'ROLLBACK TO mig;RELEASE mig':'ROLLBACK');}catch{}throw e;}};
 atomic(()=>!db.prepare('PRAGMA table_info(webhook_subscriptions)').all().some(c=>c.name==='delivered_keys_json'),"ALTER TABLE webhook_subscriptions ADD COLUMN delivered_keys_json TEXT DEFAULT '[]'");
 atomic(()=>!db.prepare('PRAGMA table_info(visits)').all().some(c=>c.name==='occurrence_start'),"ALTER TABLE visits ADD COLUMN occurrence_start TEXT");
 db.exec('UPDATE visits SET occurrence_start=scheduled_start WHERE occurrence_start IS NULL AND scheduled_start IS NOT NULL');
 atomic(()=>!db.prepare('PRAGMA table_info(quotes)').all().some(c=>c.name==='salesperson_id'),"ALTER TABLE quotes ADD COLUMN salesperson_id INTEGER");
 if(!db.isTransaction&&!db.prepare('PRAGMA foreign_key_list(quotes)').all().some(f=>f.from==='salesperson_id')){try{db.exec('PRAGMA foreign_keys=OFF');atomic(()=>!db.prepare('PRAGMA foreign_key_list(quotes)').all().some(f=>f.from==='salesperson_id'),"DROP TRIGGER IF EXISTS quotes_salesperson_fk_del;DROP TRIGGER IF EXISTS quotes_salesperson_fk_ins;DROP TRIGGER IF EXISTS quotes_salesperson_fk_upd;CREATE TABLE quotes_new ("+tableDefs.quotes+") STRICT;INSERT INTO quotes_new ("+columns.quotes.join(',')+") SELECT "+columns.quotes.join(',')+" FROM quotes;DROP TABLE quotes;ALTER TABLE quotes_new RENAME TO quotes;");}finally{db.exec('PRAGMA foreign_keys=ON');}}
 db.exec("CREATE TRIGGER IF NOT EXISTS quotes_salesperson_fk_ins BEFORE INSERT ON quotes WHEN NEW.salesperson_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.salesperson_id AND organization_id=NEW.organization_id) BEGIN SELECT RAISE(ABORT,'FOREIGN KEY constraint failed'); END;CREATE TRIGGER IF NOT EXISTS quotes_salesperson_fk_upd BEFORE UPDATE ON quotes WHEN NEW.salesperson_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.salesperson_id AND organization_id=NEW.organization_id) BEGIN SELECT RAISE(ABORT,'FOREIGN KEY constraint failed'); END;CREATE TRIGGER IF NOT EXISTS quotes_salesperson_fk_del BEFORE DELETE ON users WHEN EXISTS (SELECT 1 FROM quotes WHERE salesperson_id=OLD.id AND organization_id=OLD.organization_id) BEGIN SELECT RAISE(ABORT,'FOREIGN KEY constraint failed'); END;");
 atomic(()=>!(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='integration_connections'").get()?.sql||'').includes('byteline_sync'),"CREATE TABLE integration_connections_new ("+tableDefs.integration_connections+") STRICT;INSERT INTO integration_connections_new ("+columns.integration_connections.join(',')+") SELECT "+columns.integration_connections.join(',')+" FROM integration_connections;DROP TABLE integration_connections;ALTER TABLE integration_connections_new RENAME TO integration_connections;");
 atomic(()=>!db.prepare('PRAGMA table_info(expenses)').all().some(c=>c.name==='status'),"ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'reviewed'");
 db.exec("UPDATE expenses SET status='reviewed' WHERE status IS NULL");atomic(()=>!(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='expenses'").get()?.sql||'').includes("'pending'"),"UPDATE expenses SET status='reviewed' WHERE status IS NULL;CREATE TABLE expenses_new ("+tableDefs.expenses+") STRICT;INSERT INTO expenses_new ("+columns.expenses.join(',')+") SELECT "+columns.expenses.join(',')+" FROM expenses;DROP TABLE expenses;ALTER TABLE expenses_new RENAME TO expenses;");
 atomic(()=>!db.prepare('PRAGMA table_info(campaigns)').all().some(c=>c.name==='created_by'),"ALTER TABLE campaigns ADD COLUMN created_by TEXT");
 atomic(()=>!db.prepare('PRAGMA table_info(campaigns)').all().some(c=>c.name==='campaign_type'),"ALTER TABLE campaigns ADD COLUMN campaign_type TEXT;UPDATE campaigns SET campaign_type=CASE WHEN json_valid(segment_filter_json) AND json_extract(segment_filter_json,'$.automated') THEN 'Automated' ELSE 'One-off' END WHERE campaign_type IS NULL;");db.exec("UPDATE campaigns SET campaign_type=CASE WHEN json_valid(segment_filter_json) AND json_extract(segment_filter_json,'$.automated') THEN 'Automated' ELSE 'One-off' END WHERE campaign_type IS NULL");
 atomic(()=>!db.prepare('PRAGMA table_info(campaigns)').all().some(c=>c.name==='updated_at'),"ALTER TABLE campaigns ADD COLUMN updated_at TEXT");
 db.exec('UPDATE campaigns SET updated_at=COALESCE(sent_at,created_at) WHERE updated_at IS NULL');
 atomic(()=>!db.prepare('PRAGMA table_info(organizations)').all().some(c=>c.name==='website'),"ALTER TABLE organizations ADD COLUMN website TEXT");
 atomic(()=>!db.prepare('PRAGMA table_info(organizations)').all().some(c=>c.name==='address_line2'),"ALTER TABLE organizations ADD COLUMN address_line2 TEXT");atomic(()=>!db.prepare('PRAGMA table_info(invoices)').all().some(c=>c.name==='disclaimer_notes'),"ALTER TABLE invoices ADD COLUMN disclaimer_notes TEXT");
 atomic(()=>{const cols=db.prepare('PRAGMA table_info(notes)').all().map(c=>c.name);return cols.includes('body')&&cols.includes('content')&&Boolean(db.prepare('SELECT 1 FROM notes WHERE body IS NULL OR content IS NULL LIMIT 1').get());},"UPDATE notes SET body = COALESCE(body, content, ''), content = COALESCE(content, body, '') WHERE body IS NULL OR content IS NULL");
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS org_slug ON organizations(slug);
 CREATE UNIQUE INDEX IF NOT EXISTS session_token ON sessions(token);
 CREATE UNIQUE INDEX IF NOT EXISTS portal_token ON clients(portal_token) WHERE portal_token IS NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS user_email ON users(organization_id,email);
 CREATE UNIQUE INDEX IF NOT EXISTS role_slug ON roles(organization_id,slug);
 CREATE UNIQUE INDEX IF NOT EXISTS permission_key ON permissions(role_id,resource,action);
 CREATE UNIQUE INDEX IF NOT EXISTS execution_key ON automation_executions(organization_id,idempotency_key);
 CREATE UNIQUE INDEX IF NOT EXISTS visit_slot ON visits(organization_id,job_id,scheduled_start) WHERE scheduled_start IS NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS appointment_entity ON appointments(organization_id,entity_type,entity_id);
 CREATE UNIQUE INDEX IF NOT EXISTS booking_code ON online_bookings(confirmation_code);
 CREATE UNIQUE INDEX IF NOT EXISTS active_clock ON time_entries(organization_id,user_id) WHERE end_at IS NULL;
 CREATE INDEX IF NOT EXISTS automation_event ON automations(organization_id,trigger_event,is_enabled);
 CREATE INDEX IF NOT EXISTS preferences_org_name ON preferences(organization_id,name);
 CREATE INDEX IF NOT EXISTS execution_queue ON automation_executions(status,scheduled_for);`);
 for (const [t, c] of Object.entries(columns)) if(c.includes('organization_id')) db.exec(`CREATE INDEX IF NOT EXISTS ${t}_tenant ON ${t}(organization_id)`);
}
