# Database schema

## Storage and declarations

Node's built-in `node:sqlite` stores data in SQLite. `src/db/schema.js` is the authoritative declaration. Tables are STRICT. Declaration suffixes mean `!` required, `$` integer monetary/count field, `#` real numeric field, `?` boolean; `=a|b` defines checked status choices. JSON fields have JSON validity checks. Monetary values use integer cents, not floating dollars.

Tenant tables carry organization_id and a unique (id, organization_id) pair. Foreign keys pair referenced IDs with organization_id where applicable. Repository methods constrain tenant access. Sessions and permissions use their explicit identity relationships.

## Table groups

| Domain | Tables |
|---|---|
| Identity | organizations, roles, permissions, users, sessions |
| Clients | clients, client_contacts, properties, tags, entity_tags |
| Customization | custom_field_definitions, custom_field_values, preferences |
| Catalog | products_services |
| Intake/quotes | requests, quotes, quote_line_items |
| Execution | jobs, recurrence_rules, visits, appointments, tasks, checklists, checklist_items |
| Financial | invoices, invoice_line_items, invoice_credits, payments, payment_allocations, refunds, subscription_payments |
| Costs/time | expenses, time_entries |
| Communication | templates, campaigns, messages, notifications |
| Automation | automations, automation_executions |
| Supporting | attachments, activity_logs, integration_connections, online_bookings, ai_receptionist_logs |

## Important constraints

Unique organization slug, session token, portal token, tenant user email and role slug; permission key; automation execution idempotency key; job/visit scheduled slot; appointment entity; booking confirmation code; one active clock per tenant/user. Tenant indexes are generated. Nonnegative cent fields are checked except intentional signed balances/profit/net fields.

## Round 3 fixtures

Organization 1: 95 clients; first six are Gary Barbier Construction, Steele Design Construction Group Inc., Elly Divino, Andrea Hill, Forrest Means and Jack Surwald. Gary and Jack are leads. Quotes #1/#2/#3 contain 744000/1127500/12220000 cents. Jobs #1–#5 contain 7522000/1127500/1299000/1050000/12220000 cents. Invoices #1–#4 contain 5728000/112750/1015000/7522000 cents; #2 is paid, #3 draft, others past due. Fifteen expenses link to owner user 1 and jobs 1–5. Subscription payments are 49900, 24950, 24950, 24950 cents for October through July 2026.

No schema migration is needed for this round. Approval/payroll states and named form metadata use preferences.value_json. Seeding is idempotent by skipping any database with organizations; it does not retrofit an existing database. Use a fresh DB_PATH to preserve existing work while loading reference fixtures.
