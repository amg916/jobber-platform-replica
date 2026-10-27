# Functional audit — Round 5 final fixes

## Execution status

Final-fix crop regeneration, repository-wide JavaScript syntax checks and `npm test` were attempted but blocked by command approval. No passing automated result or 100% pass rate is claimed. No external final audit has run.

The recorded [Round 5 browser verification](VISUAL_COMPARISON_ROUND_5.md) confirmed navigation helpers, marketplace switching with nine connected rows, Converted quotes, settings controls and fixed Create positioning. It recorded zero console errors and zero uncaught page exceptions after stale-token cleanup, but failed client Last Activity dates in the existing database.

## Round 5 regression fix

`reconcile(repo, clientId)` now updates an invoice only when paid amount, balance due or status changes. It fetches the client and returns it unchanged when the computed balance matches, avoiding an unnecessary `updated_at` write on every 30-second overdue run. Real balance changes still update the client.

`test/round5.test.js` now invokes `workflows(db, 1).overdue()` after seeding and asserts exact dates for clients 1–6: `2026-10-13`, `2026-09-22`, `2026-08-13`, `2026-08-01`, `2026-08-01`, `2026-07-24`. Existing Round 5 tests cover markup, quote fixtures and JPEG GET/HEAD serving. These assertions remain unexecuted in this final-fix session. Existing database dates are not repaired by this source change.

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
