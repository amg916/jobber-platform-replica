# Feature inventory

## Persisted workspace features

- Organization-scoped clients, contacts, properties, tags and custom fields; create/edit/search and detail timeline.
- Merge Duplicate Clients selects a retained profile and duplicate. A transaction reassigns client-linked records and polymorphic metadata, combines balances and notes, fills missing contact data, and archives the duplicate. Same-profile and archived-profile merges are rejected; no hard delete occurs.
- Requests, quotes, jobs, visits and invoices use existing service workflows. Document editors support line items, tax and discounts; quotes/invoices export PDF.
- Sandbox payments, refunds, allocations, deposits and invoice credits retain local accounting records.
- Expenses support create/edit, text search and date filtering; 15 initial reviewed records are supplied.
- Time entries support manual creation, clock in/out, employee accordions and day/week period navigation. Approval and payroll confirmation are saved as organization preferences keyed by period/user, not payroll-provider submissions.
- Campaigns can be created and sent through the local sandbox. Templates and review automations remain accessible from Marketing.
- Settings persist company data and toggle preferences. Named request forms persist metadata; booking uses the shared public form.
- Billing history and receipt dialogs use seeded subscription payment records.

## Navigation and presentation

Captured logo and promotion assets, dismissible cards, single-label status summaries, compact monetary values, client selection controls, report navigation, marketing tabs, notification tabs, message channel filtering and theme toggle are implemented in the browser.

## Reports

Every listed report opens a table with date filtering and CSV export. Financial reports include projected income, transactions, invoices, taxation, aged receivables, bad debt and client balance summary. Work includes visits, job types, requests, checklists, quotes, catalog, waypoints, time tracking, productivity and salesperson performance. Client, expense, payments and legacy categories are also exposed. Shared data sources and approximations are documented in KNOWN_LIMITATIONS.md.

## Simulated / limited

External payment processors, messaging, accounting sync and AI features are local demonstrations. Receipt email ingestion, real subscriptions, website publishing and provider-specific report semantics are not implemented. A preference toggle is not enforcement of all corresponding Client Hub behaviors. Do not infer operational integration from the presence of a matching screen.
