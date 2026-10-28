# Known limitations

## Live data and minimal seed

- The seed contract supplied for this update is that `seedDatabase` seeds only the J S Custom Tile organization, RBAC roles/permissions, and four team members. Dummy clients, transactions, campaigns, notifications, and other business fixtures have been removed from the seed. The seed implementation was not independently inspected in this change: the permitted scope was only `src/public/app.js` and this document.
- Seed changes apply to newly initialized databases. Existing SQLite records are not removed by this frontend change; no database reset or cleanup was performed.
- Business screens use the local API backed by SQLite. Home workflow values, appointment amounts, receivables, upcoming jobs, list statistics, client tags/properties, campaigns, and automation counts now use API records rather than reference-account totals. Empty records produce empty states or zero values, not synthetic business activity.
- Date defaults use the current clock instead of October 2026 fixtures. The ISO date helpers format local calendar dates from the current runtime clock.
- Quotes expose salesperson assignment/filtering; expenses expose review status and accounting codes. Record deletion, client property/contact creation, Settings collection editing, company/billing edits, and marketplace connection/sync controls call API mutation endpoints. Server authorization, validation, audit logging, and supported fields remain authoritative.

## Metric semantics

- The requested Sent/Converted quote totals and Issued invoice totals are computed from loaded rows, although the cards retain their requested “Past 30 days” labels. They are not independently restricted to that period.
- The requested recent-visit predicate includes every completed visit as well as visits scheduled within the past 30 days. Scheduled visits include all scheduled/in-progress visits, not only the next 30 days.
- “Handled this week” displays the number of returned automation executions, without a separate frontend week filter.
- Payout/deposit/refund cards summarize local payment records; they are not bank settlement statements. Average payment time uses paid invoices with payment and issue/creation dates.
- Trend percentages are not shown without real comparison-period data. No synthetic percentage change is substituted.
- Lookup requests that are unavailable fall back to empty collections. This preserves page rendering but can leave related names or metrics unavailable.

## Local product boundaries

- Messaging, payments, accounting sync, integration connections, and AI operations remain sandbox/deterministic implementations, not verified live provider integrations. Connect and Sync controls operate on local integration records.
- Campaign generation creates a deterministic draft locally, not a live AI-generated response. Automated setup saves event-triggered rules, not a historical audience backfill. Campaign job attribution depends on fields supplied by the API.
- Receipt forwarding remains informational; there is no email ingestion service or forwarded receipt storage.
- Named request forms persist names but reuse the public booking page; a full field-by-field designer is not provided.
- Approval/payroll switches persist preferences but do not lock time entries, enforce an approval state machine, or submit payroll.
- Client Hub uses the returned organization name and honors returned menu visibility, quote approval, change-request, and request-form settings. Other preferences are not guaranteed to affect portal behavior. With no clients, the hub renders an explicitly non-transactional preview.
- Merging archives the source and moves relationships, but has no undo flow. Source portal tokens do not automatically redirect to the retained client.
- Sorting, search, and filters operate on loaded records rather than server-side pagination.
- Reports use local tables. Mileage shares expenses, payouts shares payments, and salesperson performance uses quote conversion rather than a full salesperson reporting engine.
- Subscription/rewards/product-update controls do not perform live subscription or promotional enrollment operations. Dark mode is not a fully audited theme system.

## Verification and delivery

- Only `src/public/app.js` and this document were read or edited for this task. Backend routes, schema, and seed contents were outside the authorized inspection scope.
- `node --check src/public/app.js` was attempted but blocked because command approval was required. Syntax execution, automated tests, browser interaction checks, and fresh screenshots remain pending; frontend/backend contract compatibility is not certified.
- Exact 1:1 visual parity is not certified. Existing screenshots are not evidence for this update.
- No commits, pushes, deployment, database reset, or external audit were performed.
