# Route map

## Browser routes

The server supplies the SPA HTML for browser navigation. `app.js` dispatches `/home`, `/schedule`, `/clients`, `/requests`, `/quotes`, `/jobs`, `/invoices`, `/expenses`, `/payments`, `/timesheets`, `/pipeline`, `/bookkeeping`, `/marketing`, `/reports`, `/custom-reports`, `/report/<encoded title>`, `/receptionist`, `/apps`, `/settings/<section>` and `/account-billing`. `/login`, `/booking` and `/hub/<token>` have dedicated rendering paths.

Settings sections: company/business-profile, client-hub, requests-and-bookings/online-booking, account-billing/account-and-billing, products-and-services, custom-fields, automations, manage-team, emails-and-text-messages, integrations, checklists and preference-backed fallback sections.

## Static resources

`/styles.css`, `/parity.css`, `/app.js`; `/reference-icons.json` reads captured DOM icon definitions. `/assets/<name>.svg` and `/assets/<name>.webp` resolve only simple lowercase alphanumeric/underscore filenames under `docs/round2_live_assets`. Unsupported/missing asset names return JSON 404. GET and HEAD are supported.

## API families

- `/api/auth/bootstrap`, login, me, workspace, logout, switch-user, switch-org.
- `/api/dashboard`, `/api/settings`, `/api/account-billing`, `/api/permissions`.
- Resource CRUD: clients, properties, contacts, tags, entity-tags, custom-fields, custom-values, requests, quotes, jobs, visits, tasks, checklists, checklist-items, invoices, payments, expenses, time-entries, team, roles, catalog, templates, messages, automations, automation-executions, attachments, notifications, integrations, recurrence-rules, bookings, preferences.
- `POST /api/clients/merge`: numeric source_id and target_id, client write permission, tenant-scoped lookups, transaction.
- `/api/<resource>/<id>/<action>`: workflow actions including quote approval/conversion, visit rescheduling, invoice issue/payment/deposit/credit and timer clock-out.
- `/api/team/<id>/clock-in`; `/api/clients/<id>/timeline` and `/portal`; document `/pdf`; supported `/export` and `/import`.
- `/api/schedule`, `/api/pipeline`, `/api/bookkeeping`, `/api/reports/<type>`, `/api/marketing/campaigns`.
- `/api/public/booking/<slug>`, `/api/public/requests/<slug>`, `/api/client-hub/<token>` and scoped portal actions.
- `/api/ai/*`: deterministic local simulations; `/api/health` reports local mode.

Authenticated requests use a Bearer session token. Resource access is mapped to role permissions, then repository operations constrain organization IDs. Public portal requests use a client token instead of a workspace session.
