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

Authenticated requests accept Bearer, `X-Jobber-Token`, or `_jobber_session` cookie tokens. Cookie writes require `X-CSRF-Token` obtained from `GET /api/csrf`. Login/bootstrap set HttpOnly/SameSite=Lax cookies; logout clears them. Resource access is mapped to role permissions, then repository operations constrain organization IDs. Public portal requests use a client token instead of a workspace session.

## Gap controls and developer webhooks

- Account controls persist `product-updates`, `workspace-language`, `account-plan`, and `rewards-claimed` via `POST /api/preferences` (upsert by name). Billing merges the selected plan, price in cents, and add-ons while retaining payment history.
- Schedule Type/Team/Status pills filter appointments locally. Map uses `POST /api/ai/route-optimizer`; its SVG is a coordinate schematic with an ordered stop table and approximate straight-line segment distances, not road directions.
- Client tag filtering uses `/api/tags` and `/api/entity-tags`. Drawers expose tags, `/api/custom-fields`, `/api/custom-field-values` (alias of custom-values), checklist completion, and text attachments.
- `GET /api/jobs/:id` hydrates stored job lines/options, selected quote lines, or a fallback total line. Job builders submit line items and tax/discount options to the existing calculation pipeline.
- `/api/webhooks` supports GET/POST; `/api/webhooks/:id` supports GET/PATCH/PUT/DELETE, with organization scoping and automations permissions. URL aliases: `target_url`, `webhook_url`, `url`. Active defaults to 1; omitted secrets are generated with a `whsec_` prefix.
- `POST /api/webhooks/:id/test` records a signed sandbox delivery. Event emission matches `*`, exact topics, or normalized aliases such as `CLIENT_CREATE` / `client_created`. Delivery records contain the exact JSON payload and its Base64 HMAC-SHA256 signature, count and timestamp. Like the existing messaging integrations, this implementation records local deliveries; it does not issue outbound HTTP requests.
- GraphQL: `webhookSubscription`, `webhookSubscriptions`, `webhookSubscriptionCreate`, `webhookSubscriptionEdit`, `webhookSubscriptionDelete`. URL input/output aliases: `targetUrl`, `webhookUrl`, `url`; `active` returns a boolean. Global IDs and automations permission checks apply.

## Developer GraphQL and OAuth

- `GET/POST /api/graphql`, `GET/POST /graphql`: authenticated query execution; mutations require POST. Version header `X-JOBBER-GRAPHQL-VERSION` is echoed, defaulting to `2025-01-20`.
- GraphQL `scheduledItems`: `ScheduledItemConnection` combining Visit, Assessment and Task nodes, with type-prefixed pagination cursors and schedule read permission. `Job.lineItems`: `JobLineItemConnection` using selected quote lines or a synthesized job-total line, requiring Job read permission.
- `GET/POST /api/oauth/authorize`, `/oauth/authorize`: authenticated code issuance; `client_id`, `response_type=code`, optional redirect URI/state. HTML-preferred requests redirect; other requests receive JSON.
- `POST /api/oauth/token`, `/oauth/token`: JSON or form-encoded authorization_code, refresh_token, password, client_credentials grants. Client credentials require application-configured clients; code/refresh exchanges bind the client ID. Codes last ten minutes; session access tokens last one day; refresh grants last thirty days and rotate.
- `GET /api/csrf`: session-bound token, or a public token when no session is supplied.

## Rails JSON normalization

All routes below are authenticated and use the same REST handlers. Resource item routes retain their IDs; standard POST/PATCH/PUT/DELETE semantics remain unchanged.

| Rails path family | REST destination |
| --- | --- |
| clients, properties, requests, quotes, jobs, visits, invoices, payments, expenses, tasks `.json` | matching `/api/<resource>` |
| work_requests | requests |
| work_orders | jobs |
| time_sheet_entries, timesheets | time-entries |
| products_and_services | catalog |
| quotes/:id/send_quote or send | quotes/:id/send |
| quotes/:id/approve | quotes/:id/approve |
| quotes/:id/request_changes | quotes/:id/request-changes |
| quotes/:id/convert_to_job | quotes/:id/job |
| jobs/:id/visits | jobs/:id/visit |
| jobs/:id/complete | jobs/:id/complete |
| jobs/:id/generate_invoice or invoice | jobs/:id/invoice |
| visits/:id/complete or reschedule | matching workflow action |
| invoices/:id/send_invoice or issue | invoices/:id/issue |
| invoices/:id/record_payment | invoice-bound payment workflow; client derived from invoice |
| payments/:id/refund | payments/:id/refund |
| calendar/events, schedule/events | schedule |
| work_objects | work_objects; requests/quotes/jobs/invoices, optional `q` |

`/api/work_objects` is also available. `/reference-icons.json` and `/assets/` paths retain static behavior without Rails rewriting; `/assets/README.json` returns 404 rather than an API authentication error. Extensionless `/clients`, `/quotes`, `/work_requests` and other browser navigation paths still return HTML.
