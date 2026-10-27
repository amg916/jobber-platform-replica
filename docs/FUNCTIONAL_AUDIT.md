# Functional audit — Round 5 final fixes

## Execution status

All 13 Astra technical findings have source fixes and individually named regression tests in `test/round5.test.js`. The Coordinator regenerated 5 cropped JPEGs with `docs/crop_round5_assets.py` and confirmed all 15 `.js` files pass `node --check`. The Coordinator executed `npm test` and verified **35/35 automated tests pass (`35 pass, 0 fail`)**. This records the Coordinator's verified result; tests were not rerun in this implementation session. The Astra 6 follow-up removes invoice header overrides and covers notes-only edits after job-total changes, standalone invoice line totals, decimal fixed discounts, explicit deposit removal, preserved invoice payment terms and legacy visit occurrence backfills. The updated browser report records 11/11 Round 5 checks passed. No external final audit was performed in this session.

Latest partial-billing follow-up (Coordinator verified): `invoiceJob` without visit IDs keeps jobs `active` and visible in Active Job when unfinished visits remain; it marks them `completed` only when every visit is completed or cancelled. Astra 11 now asserts explicit A billing followed by automatic B billing at 6500 cents with future C still scheduled and uninvoiced, then automatic C billing at 6500 cents and job completion. After this automatic partial-billing fix and regression extension, the Coordinator ran `node --check` (15/15 `.js` files passed; `ALL_SYNTAX_OK`) and `npm test`, verifying **35/35 automated tests pass (`35 pass, 0 fail`)**, including the latest Astra 11 partial-billing regression assertion. The Coordinator also confirmed the collaboration gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`.

## Astra regression coverage

1. Direct refund POST/PATCH/PUT rejection and unchanged financial records.
2. Document DOM submission preserves metadata and fixed discount/deposit types.
3. Assessment, visit and legacy calendar identifiers dispatch to the correct workflows.
4. Employee-specific time entry DOM submission and HTTP cost calculation.
5. Timeline resource permissions and mapped activity permissions.
6. Out-of-order list/report/collection responses preserve current shared state.
7. Portal form completion avoids workspace rendering; workspace forms still refresh.
8. Allocated versus unallocated refunds, deposit availability and deposit totals.
9. Appointment/checklist cleanup and transaction rollback on a referenced visit.
10. Quoted and standalone job tax accounting and bookkeeping totals.
11. Pipeline status coverage and completed/issued job invoicing; direct and pipeline issuance preserve `net_15`/`upon_receipt` with matching due dates.
12. Stable recurrence identity after rescheduling, idempotent legacy schema backfills from `scheduled_start`, and migrated-visit regeneration without duplicates; null identities are also backfilled by scheduling and generation.
13. Non-team creation forms avoid roles requests.

The updated [Round 5 browser verification](VISUAL_COMPARISON_ROUND_5.md) records **all 11 checks passed**, including navigation helpers, marketplace switching with nine connected rows, Converted quotes, settings controls and fixed Create positioning. After clearing session/local storage and reloading with cache disabled, it recorded zero console errors and zero uncaught page exceptions. The first six Clients Last Activity dates are **Oct 13, Sep 22, Aug 13, Aug 1, Aug 1, and Jul 24**, in that order. Home, Clients, Quotes, Expenses and Timesheets captures were refreshed; the other six captures were retained and their views rechecked. Comparison Sheets 1 and 2 were regenerated; Sheets 3 and 4 are unchanged. These results do not establish pixel parity.

## Round 5 regression fix

`reconcile(repo, clientId)` now updates an invoice only when paid amount, balance due or status changes. It fetches the client and returns it unchanged when the computed balance matches, avoiding an unnecessary `updated_at` write on every 30-second overdue run. Real balance changes still update the client.

`test/round5.test.js` now invokes `workflows(db, 1).overdue()` after seeding and asserts exact dates for clients 1–6: `2026-10-13`, `2026-09-22`, `2026-08-13`, `2026-08-01`, `2026-08-01`, `2026-07-24`. Existing Round 5 tests cover markup, quote fixtures and JPEG GET/HEAD serving. The Coordinator executed `npm test` and verified all 35 automated tests pass (`35 pass, 0 fail`); this implementation session did not independently rerun them. Existing database dates are not repaired by this source change.

## Automated coverage added

`test/frontend-api.test.js` checks fresh fixture counts, first-client lead status, exact quote/job arrays and financial sums, invoice past-due/draft values, expense ownership/date range, billing row count and seed idempotence. The HTTP test checks all eight requested assets with GET and HEAD, missing/unsupported asset responses, merge same-profile rejection, linked request reassignment, duplicate archival and cross-tenant rejection. Existing HTTP tests continue to cover session switching, document editing, pipeline, ledger and logout.

Run:

```sh
python3 docs/crop_round5_assets.py
find . -type f -name '*.js' -not -path './node_modules/*' -not -path './.git/*' -exec sh -c 'for file do node --check "$file" || exit; done' sh {} +
npm test
```

## Manual acceptance matrix

- Home: inspect exact money, dismiss reward, open Schedule, visit Marketing actions.
- Clients: select row/all without opening detail; open detail; create client; merge two test records and verify linked data remains accessible on retained profile.
- Requests/Quotes/Jobs/Invoices: verify single overview labels; exercise create/edit, lifecycle action, detail and document PDF flows.
- Expenses: confirm 15 reviewed rows; search, date filter, open/edit an expense; toggle Needs review.
- Marketing: visit all tabs; create a campaign and template; send through sandbox; inspect performance table.
- Reports: open every link, apply date range, export CSV. Check shared report semantics against limitations.
- Timesheets: move periods; switch Day/Week; expand employees; add time, clock in/out; approve a period and reload; confirm payroll and export entries.
- Settings: edit/save company; toggle address preference; update hub toggles; create a named request form; open booking; inspect four payment receipts.
- Overlays: all five Create actions fit and open editors; notification tabs switch; message search/channel filter work; Dark Mode toggles; demo switch remains reachable.
- Isolation: switch organization and confirm no Org 1 data appears in resource lists or merge choices.

## Outstanding functional boundaries

Receipt forwarding does not ingest email. Named forms share a booking renderer. Timesheet approvals are preferences, not locked payroll records. Hub preferences are saved but not all enforce portal behavior. Several reports share data sources. Provider integrations and subscriptions are simulations. These limitations must not be misrepresented as successful live integration tests.
