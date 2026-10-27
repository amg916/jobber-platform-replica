# Functional audit — Round 5 final fixes

## Astra 6 follow-up coverage (Astra 130) — 2026-10-27

- **Astra 130:** Fallback, stored, and quote-backed job-line connections share a deliberately colliding numeric ID. Both `id` and `jobLineItemId` filters exercise scalar, `eq`, `in`, and array operands with raw/base64 `JobLineItem` IDs (unprefixed and explicit `job:`, `line:`, `quote:`), `QuoteLineItem` IDs, legacy `LineItem` IDs, and numeric/string IDs. Assertions verify counts, nodes, and edge identities without cross-namespace matches. Null/empty filters return no matches; malformed, wrong-type, and invalidly namespaced IDs reject.

One added regression group brings the suite total to **173 tests**.

Coordinator-verified result: **173/173 automated tests pass (`173 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 130` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up coverage (Astra 128–129) — 2026-10-27

- **Astra 127 updated:** Oversized rule rows and condition trees are enabled and assigned the matching event for each mutation under test, including invoiceIssue. Real mutation rejection remains atomic.
- **Astra 128:** Preference writes normalize numeric/string/raw Global ID/base64 catalog references, preserve null/absent references, and reject invalid or foreign references without changing stored preferences. Legacy numeric strings invoice correctly. Catalog deletion detaches all accepted reference formats while preserving unrelated/invalid references and other tenants; detached lines remain invoiceable.
- **Astra 129:** 20,001 disabled matching rules or enabled unrelated-event rules do not consume mutation budgets. A rule with 20,001 condition operands likewise does not block when disabled or unrelated. Enabled matching rows/operands still block before dispatch, and real client mutations succeed or remain unchanged as appropriate. The composite automation index has the expected columns.

Two added regression groups bring the suite total to **172 tests**.

Coordinator-verified result: **172/172 automated tests pass (`172 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 129` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up coverage (Astra 125–127) — 2026-10-27

- **Astra 125:** Nested address/billing-address inputs cannot bypass persisted job-line or manual-option total validation on REST PATCH/PUT or create inconsistent line-item totals. Rejected edits preserve jobs, preferences and sequence state. Nested fixed discounts/deposits retain monetary units; property addresses flatten, root Client billing addresses remain JSON, and dangerous nested keys reject.
- **Astra 126:** Visit, Request assessment, Assessment Node and scheduled Assessment assigned-user reads charge raw duplicate arrays before deduplication and reject oversized JSON before parsing. Small duplicate arrays preserve results with accurate cost deltas; non-array JSON safely yields empty assignments. Astra 44 uses the corrected three-step delta; Astra 123 explicitly checks duplicate-read costs.
- **Astra 127:** Every automation-triggering mutation, including invoiceIssue, exhausts oversized rule-row/condition budgets before dispatch. A real clientCreate request preserves client/execution counts when blocked. Small conditions charge their tree size, unrelated mutations skip automation scans, and foreign-tenant oversized rules do not affect local mutations.

Three added regression groups bring the suite total to **170 tests**.

Coordinator-verified result: **170/170 automated tests pass (`170 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 127` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up coverage (Astra 123–124) — 2026-10-27

- **Astra 123:** Assessment scheduling, visit creation and rescheduling charge persisted appointment assignment arrays, including cancelled appointments, before dispatch. Cumulative arrays and oversized malformed/non-array JSON exhaust the budget; small arrays add their full raw length. Oversized inherited job/visit strings reject before dispatch while explicit arrays bypass inheritance. Assigned-user reads charge duplicates before deduplication; conflict matching preserves cancellation/exclusion semantics with Set membership.
- **Astra 124:** REST job creation/editing accepts JSON-encoded numeric or Global ID assignment arrays and ordinary arrays. Malformed JSON, non-array JSON and wrong-type IDs reject without changing assignments or creating jobs. GraphQL continues rejecting string assignments on create/edit and accepts Global ID arrays. Recursive address/item normalization propagates the REST-only option for assignment and visit ID aliases.

Two added regression groups bring the suite total to **167 tests**.

Coordinator-verified result: **167/167 automated tests pass (`167 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 124` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up coverage (Astra 121–122) — 2026-10-27

- **Astra 121:** Non-null assignment/visit lists and camelCase aliases reject JSON strings and other non-arrays before dispatch; valid Global ID arrays normalize and null/omitted values remain supported. Oversized persisted teams on both visits and jobs exhaust the scheduling budget before dispatch, including explicit-null inheritance. Explicit empty teams bypass inheritance, small inherited teams dispatch, and duplicate team IDs cause only one user lookup per distinct ID. Invalid/inactive members still reject.
- **Astra 122:** Conversion with 20,001 existing quote jobs exhausts the budget before dispatch without changing quote status; small histories remain dispatchable and additional quote lines increase the charged cost. The workflow's existing-job query is tenant-scoped, ordered newest-first and bounded by `LIMIT 1`; conversion returns the newest job without inserting duplicates, and fresh conversion remains idempotent.

Two added regression groups bring the suite total to **165 tests**.

Coordinator-verified result: **165/165 automated tests pass (`165 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 122` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up coverage (Astra 117–120) — 2026-10-27

- **Astra 117:** OAuth rejects oversized, blank and non-string client IDs and oversized/non-string redirect/state values before retaining grants. Exact limits, exchange rejection without code consumption, refresh rotation and replay rejection are covered.
- **Astra 118:** Returned Visit, Assessment and Task IDs round-trip through scalar, `eq`, `in` and array filters in raw/base64 forms without cross-type collisions. Numeric/ScheduledItem IDs preserve shared numeric matching; Assessment legacy IDs use request IDs, not appointment IDs. Invalid types and null equality are covered.
- **Astra 119:** A fixed-price job with 20,001 void invoices exhausts the budget before dispatch. Explicit visits and visit-based billing avoid the unrelated invoice-history charge; small history remains dispatchable. REST rejects active duplicate invoices and permits void-only history.
- **Astra 120:** Repeated quote-backed Node aliases perform one tenant-scoped ordered job-ID scan and cached, charged override probes per request. A subsequent request reflects override removal; 20,001 related jobs exhaust the budget before override probing.

Four added regression groups bring the suite total to **163 tests**.

Coordinator-verified result: **163/163 automated tests pass (`163 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 120` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up coverage (Astra 114–116) — 2026-10-27

- **Astra 114:** Unselected optional lines reject invalid quantities and explicit null prices through calculations, direct job-line storage, preferences and GraphQL job/quote/invoice creation. Rejection preserves records, preferences and durable sequences; omitted and valid fractional quantities remain supported.
- **Astra 115:** Each previously omitted client-linked table and all three polymorphic tables independently exceed the merge execution budget with 20,001 rows, preventing dispatch; a small merge still dispatches.
- **Astra 116:** Instrumented job-line scans require a tenant predicate and matching bound organization. Overlapping line IDs remain tenant-isolated; sequences, canonical ownership and cache refresh after edits/deletions are covered.

Three added regression groups bring the suite total to **159 tests**. Coordinator-verified result: **159/159 automated tests pass (`159 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 116` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up coverage (Astra 112–113) — 2026-10-27

- **Astra 112:** Payment creation (client/invoice/quote), invoice payment/issuance/deposit/credit and refunds charge persisted reconciliation work before dispatch, including userErrors-only selections. Regression coverage exercises 20,001 invoices, allocations, refunds and appointments, client merges, payment-only allocation scans, scheduling and small-input dispatch.
- **Astra 113:** Booleans, null, empty and whitespace numeric values reject for cost, markup, discount, tax and deposit calculations. Preference writes preserve jobs, preferences and durable sequences on rejection; corrupt stored options return null; valid zero and numeric strings remain supported.

Two regression groups bring the suite total to **156 tests**. Coordinator-verified result: **156/156 automated tests pass (`156 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 113` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. No external audit performed. Previous verified results below are historical.

## Astra 6 follow-up coverage (Astra 108–111) — 2026-10-27

- **Astra 108:** Legacy omitted-taxable lines invoice without tax, and cost-plus-markup lines preserve calculated unit prices and totals.
- **Astra 109:** Fixed-job invoice/completion visit scans and visit checklist/appointment work exhaust execution budgets before dispatch; small and explicit-visit inputs remain dispatchable.
- **Astra 110:** Editing the canonical owner before a duplicate preserves ID 7000000 and Node resolution; editing the duplicate allocates above the floor and remains stable.
- **Astra 111:** Boolean scalar, `eq`, `in`, array and string forms match SQLite 1/0, including visibility and derived client/visit aliases.

Four regression groups bring the suite to **154 tests**. Coordinator-verified result: **154/154 automated tests pass (`154 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 111` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. No external audit performed. Previous verified results below are historical.

## Astra 6 follow-up coverage (Astra 104–107) — 2026-10-27

- **Astra 104:** Foreign job IDs, legacy line IDs, preference floors and exhausted durable sequences do not raise another tenant's floor; REST deletion preserves the local durable floor.
- **Astra 105:** Manual GraphQL/REST creation, edits and preference options reconcile discount/tax totals, reject mismatches, and preserve percentage options through invoicing.
- **Astra 106:** First-preference canonical Node ownership survives cache refresh; conflicting legacy IDs are reassigned, repeated input IDs are unique, and repaired IDs remain stable.
- **Astra 107:** Oversized stored/quoted lines, automatic visits, quote conversion and quote/invoice edits exceed budget before dispatch even with userErrors-only selections; a small explicit-visit request still dispatches.

Four regression groups bring the suite to **150 tests**. Coordinator-verified result: **150/150 automated tests pass (`150 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 107` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. No external audit was performed. Previous verified results below are historical.

## Astra 6 follow-up coverage (Astra 102–103) — 2026-10-27

- **Astra 102:** Mixed/null/non-array legacy line preferences can be replaced through REST job PATCH, preference PUT and GraphQL jobEdit. Tests assert valid ID 7000000 reuse, new IDs above that floor, sanitized option hydration, raw-row charges despite filtering, guarded corrupt calculations, and clean mixed-line querying/invoicing with non-object options.
- **Astra 103:** Space/tab/LF/CR-prefixed empty overrides suppress both Job.lineItems and quote/fallback Node aliases consistently. Instrumented oversized-array Node lookups assert zero JSON decoding; direct line-item reads retain execution-cost enforcement.

Two regression groups bring the suite to **146 tests**. Coordinator-verified result: **146/146 automated tests pass (`146 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 103` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. No external audit was run; prior passing counts below are historical.

## Astra 6 follow-up coverage (Astra 99–101) — 2026-10-27

- **Astra 99:** Set the floor to MAX_SAFE_INTEGER − 1 through REST, fail a taxable line write after allocation, assert unchanged job/preferences/durable-floor snapshots, then successfully allocate the final safe ID on retry.
- **Astra 100:** Seed legacy sequence/line preferences on disk, delete via REST in both preference orders or delete the job first, close/reopen the SQLite database, and assert the next allocated ID exceeds the deleted line ID. This also covers lazy migration of legacy floors during deletion.
- **Astra 101:** Instrument JSON parsing and SQL preparation across 100 quote-backed Node aliases with a 20,001-line override: no override decoding, one cached existence probe, and null nodes. Whitespace-prefixed empty overrides still suppress quote nodes; deletion is visible on the next request. Plain fallback aliases against 20,001 quote lines issue no full quote-line reads.

Three regression groups added in `test/graphql-rails-api.test.js`. Coordinator-reported verification: **144/144 automated tests pass (`144 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 101` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. Earlier passing counts below are historical. No external audit was run.

## Astra 6 follow-up coverage (Astra 95–98) — 2026-10-27

- **Astra 95:** Mixed legacy arrays (strings, nulls, numbers, booleans and nested arrays) and non-array JSON do not break unrelated job creation/editing or Node queries. Valid integer IDs still advance allocation, while noncanonical names cannot claim Node ownership.
- **Astra 96:** POST/PATCH/PUT reject leading-zero, plus-prefixed and decimal suffixes without changing preferences or totals. Deletion of these legacy preferences leaves canonical quote-backed job pricing untouched.
- **Astra 97:** Repeated hit/miss Node aliases synchronize once per request without `json_each`, reuse unchanged parsed JSON across requests, and charge bounded per-lookup work even with 20,001 stored lines. Coverage includes changed data, removed IDs, renamed ownership, noncanonical names, deleted preferences, tenant isolation and independent databases.
- **Astra 98:** Corrupted unsafe/fractional sequence values are ignored; direct maximum/unsafe sequence writes are rejected. Multi-line exhaustion leaves snapshots unchanged, including GraphQL job-create rollback; the final safe ID can be allocated and retained, but duplicate/new allocations fail atomically, including REST creation.

Four regression groups added in `test/graphql-rails-api.test.js`. Coordinator-reported verification: **141/141 automated tests pass (`141 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 98` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. Prior 137/137 results are historical. No external audit was run.

## Astra 6 follow-up coverage (Astra 92–94) — 2026-10-27

- **Astra 92:** REST internal preference POST/PATCH/PUT reconcile job lines/options and retain preference row IDs. Invalid JSON, non-array lines, malformed entries, invalid options, missing jobs, internal-key renames and sequence regression are rejected without persistent changes. Line deletion restores quote-derived totals using current options; options deletion leaves totals intact.
- **Astra 93:** Sequence deletion cannot reuse existing line IDs; persisted high IDs and the per-database allocation high-water mark protect subsequent allocation even after line preferences are removed.
- **Astra 94:** Stored, quote-backed and fallback JobLineItem nodes resolve with an unrelated 20,001-line job present. Tests cover bounded query charges, unselected/missing nodes, overridden quote lines, tenant isolation and jobs authorization.

Three named regression groups added. Coordinator-reported verification: **137/137 automated tests pass (`137 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 94` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. Historical passing counts below predate this batch. No external audit was run.

## Astra 6 follow-up coverage (Astra 88–91) — 2026-10-27

- **Astra 88:** Quote-backed JobLineItem GIDs round-trip through raw/base64 Node IDs under jobs-only authorization, remain distinct from fallback IDs with the same numeric ID, reject invalid prefixes and fail when jobs access is denied.
- **Astra 57 follow-up:** REST hydration key checks normalize camelCase to snake_case so `subtotalCents`, `taxCents` and `totalCents` edits reconcile against existing job lines.
- **Astra 89:** Large raw unselected quote rows and stored lines exceed the mutation hydration budget before dispatch. REST PATCH/PUT metadata edits retain 20,001 valid JSON items and assert no preference or quote-line SELECTs. Empty stored/quote arrays each incur a minimum charge.
- **Astra 90:** Both catalog DELETE aliases tolerate null, primitive and nested-array entries in valid JSON, detach only matching references and preserve unrelated values. Fixtures respect SQLite's `json_valid(value_json)` CHECK constraint.
- **Astra 91:** REST/Rails PATCH/PUT reopening clears timestamps; re-completion refreshes them. Action endpoints and GraphQL refresh stale timestamps on open tasks, completed-task retries retain timestamps, and explicit timestamps remain respected.

Four new regression groups bring the suite to **134 tests** (99 API tests). Coordinator-reported verification: **134/134 automated tests pass (`134 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 91` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. No external audit was performed. Historical passing counts below predate this batch.

## Astra 6 follow-up coverage (Astra 84–87) — 2026-10-27

- **Astra 84:** Boolean/integer optional flags with omitted selection normalize to zero; required and explicitly selected items retain their totals. Direct storage, GraphQL projection and subsequent invoices preserve exclusion and exact totals.
- **Astra 85:** Both catalog DELETE aliases ignore lookalike preference prefixes and object/null/number JSON while detaching actual array references without changing snapshot prices.
- **Astra 86:** Large stored and quote-backed unselected lists exceed the execution budget; repeated aliases read stored JSON once, cached accesses remain charged, and search/filter work is charged. Sequential mutation payloads return fresh line names after cache invalidation.
- **Astra 87:** REST, Rails and GraphQL completion retries preserve a fixed original timestamp and the unchanged task row; missing completion timestamps are repaired and retained on retry.

Four regression groups immediately follow Astra 83. Coordinator-reported verification: **130/130 automated tests pass (`130 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. No external audit was performed. Earlier passing counts below are historical.

## Astra 6 follow-up coverage (Astra 79–83) — 2026-10-27

- **Astra 79:** Internal job preferences are hidden from lists and denied on individual reads without jobs read permission. With jobs write=0, POST/PATCH/PUT/DELETE for `job_line_seq`, `job_lines:*` and `job_options:*`, including renaming ordinary preferences to those names, return 403; the full preference snapshot is checked unchanged after every denied mutation. Restoring jobs read/write=1 permits individual reads and PATCH/PUT updates with 200; ordinary preferences remain editable. Generic mutations retain existing preference authorization and no longer unconditionally reject authorized jobs writers, preserving Astra 63's authorized DELETE returning 200.
- **Astra 80:** Both catalog DELETE aliases detach stored job lines while preserving snapshot prices; subsequent invoicing succeeds with null catalog references. Legacy dangling references also invoice successfully.
- **Astra 81:** All-unselected zero-total quotes hydrate empty lines and inherited pricing; both immediate zero invoices and later added taxable job lines preserve tax and discount options.
- **Astra 82:** Invalid strings, nonbinary numbers, null, objects and arrays fail calculation, normalization, storage, REST document creation, REST job edits and GraphQL job edits without persistence. Strict booleans/binary integers are accepted and storage defaults are normalized.
- **Astra 83:** Cursor windows cover forward/backward/combined limits, zero limits, reversed and adjacent boundaries, terminal cursors and the default 100-row cap; flags reflect only window truncation, with stable total counts and null empty-page cursors.

Five regression groups immediately follow Astra 78. Coordinator-reported verification: **126/126 automated tests pass (`126 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. No external audit was performed. Earlier passing counts below are historical.

## Astra 6 follow-up coverage (Astra 76–78) — 2026-10-27

- **Astra 76:** Single and ten-alias 5,000-line mutations must abort at execution cost 20,001 without persisted jobs/lines; normalized-line and hydrated-line charges must stop dispatch independently.
- **Astra 77:** Returned quote/invoice/persisted-job/fallback-job line, assessment, email and user/client phone IDs round trip via Node in raw and base64 form. Regressions cover missing IDs, authorization, tenant isolation, namespace decoding, possibleTypes and abstract alias conflicts.
- **Astra 78:** Job/request edit aliases accept camelCase and snake_case work-order/work-request IDs, preserve inherited fixed-discount normalization, and reject wrong-type IDs without writes.

Three regression groups immediately follow Astra 75. Coordinator-reported verification: **121/121 automated tests pass (`121 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. No external audit was performed. The earlier 118/118 result below is historical.

## Astra 6 follow-up coverage (Astra 72–75) — 2026-10-27

- **Astra 72:** Unchanged stored lines retain independent pricing; matching stored lines inherit quote options even when they differ from quote lines.
- **Astra 73:** Sequential job edits in one operation return fresh costing for each mutation.
- **Astra 74:** Line-free REST/GraphQL creation and REST edits reject invalid calculation options without changing jobs/preferences; direct normalization and option persistence reject invalid input, while valid six-decimal options remain accepted.
- **Astra 75:** Clearing lines persists `[]` and invoicing creates no synthetic invoice lines.

Four regression groups immediately follow Astra 71. Coordinator-reported verification: **118/118 automated tests pass (`118 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this documentation-update session. No external audit was performed. Earlier verified counts below are historical.

## Astra 6 follow-up coverage (Astra 68–71) — 2026-10-27

- **Astra 68:** Costing aliases share one scan per job; an over-budget row count aborts before fetching cost rows.
- **Astra 69:** Duplicate variables fail parsing; large lists, wide input objects and defaults exhaust validation before mutation dispatch; separate operations retain independent variable names.
- **Astra 70:** GraphQL and REST PATCH/PUT edits retain quote tax/fixed discounts; replacement lines retain inherited options; invoices preserve exact mixed-tax totals and line names.
- **Astra 71:** Invalid names, quantities, descriptions, units, columns and missing/cross-tenant catalog IDs fail without changing job rows or preferences; valid catalog lines invoice successfully.

Four groups follow Astra 67. Full validation in `storeJobLines` rejects invalid items before persistence, while `normalizeInput` permits ID-only line items for Astra 33's standalone GID round trip. Coordinator-reported verification: **114/114 automated tests pass (`114 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this implementation session. No external audit was performed. Earlier verified results below are historical.

## Astra 6 follow-up coverage (Astra 62–67) — 2026-10-27

- **Astra 62:** Fixed-discount partial GraphQL edits retain tax; REST PATCH/PUT retain discounts; line replacement retains both options; stored lines remain arrays; deletion removes both preferences.
- **Astra 63:** Mixed taxable/exempt $200 jobs with 10% discount and 10% tax invoice at $189, with $9 tax, both with stored options and via legacy inference.
- **Astra 64:** Projections and invoices omit unselected options while retaining selected/required lines; all-unselected jobs invoice at zero without resurrecting lines.
- **Astra 65:** Repeated extreme negative exponents return zero promptly; long significands retain exact half-up rounding; unsafe amounts/scales are rejected.
- **Astra 66:** Null client IDs match scalar, array, eq and in filters under both camelCase and snake_case keys, excluding linked tasks.
- **Astra 67:** Instrumented Map iteration verifies linear aggregate cleanup work; capacity evicts the oldest entry; attempt 31 fails and expiry resets the window.

Six groups follow Astra 61 and precede Rails JSON adapters. Astra 67 uses explicit `try/finally` restoration of `Date.now` and `Map.prototype[Symbol.iterator]`, preserving test isolation without Symbol-key mock restoration. Coordinator-reported verification: **110/110 automated tests pass (`110 pass, 0 fail`)**, including Astra 1–67, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). Tests and syntax checks were not rerun in this implementation session. The supplied collaboration context is CLEAR. Earlier results and snapshots below are historical. No external audit was requested.

## Astra 6 follow-up coverage (Astra 56–61) — 2026-10-27

- **Astra 56:** A direct GraphQL execution with 25,000 membership operands must return `Execution cost exceeded` at `actualQueryCost: 20001` in under 100 ms. Valid operator/array membership returns matching clients; malformed membership and unsupported operators fail. Source precomputes Sets and charges operand construction, row matching and search scans without changing unfiltered costs.
- **Astra 57:** GraphQL jobEdit and REST PATCH/PUT reject partial total/subtotal inconsistencies without modifying the job or stored lines. Title changes preserve totals and taxRate changes recalculate a persisted taxable $100 line to $110. All job updates normalize against existing stored lines.
- **Astra 58:** An approved quote is converted to a job, its lines replaced, and the completed job invoiced. The generated invoice must contain only the replacement line, not the original quote line, with the matching total.
- **Astra 59:** Job clientId filters accept legacy and typed Global IDs in eq/in operator objects, arrays and scalar operands; wrong-type Global IDs are rejected.
- **Astra 60:** Plain decimal, numeric and scientific-notation forms of 1.0049999 convert to 100 cents; 1.005e0 converts to 101 cents, including fixed discount/deposit paths.
- **Astra 61:** Catalog create/edit preserves `HVAC & Air Conditioning` in responses and storage; timesheet creation with `TRAVEL` persists/projects `travel`. Expense normalization preserves free-text capitalization.

These six regression tests follow Astra 55 and precede Rails JSON adapters. After implementing Astra 56 through Astra 61, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **104/104 automated tests pass (`104 pass, 0 fail`)**, including all 61 Astra regression groups (`Astra 1` through `Astra 61`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests, syntax checks and timing assertions were not rerun in this Read/Edit-only adjustment session. Earlier Coordinator results remain historical. The current supplied collaboration context is CLEAR; prior incomplete snapshots below describe earlier sessions. No external audit was requested.

## Astra 6 follow-up coverage (Astra 52–55) — 2026-10-27

- **Astra 52:** A temporary file-backed SQLite database is closed and reopened after creating a two-line job through HTTP GraphQL; the query asserts both lines, their IDs and exact totals survive. Source changes put REST job creation/editing and preference storage in the same transaction, including GraphQL dispatch; job deletion cleans up its preference in the delete transaction.
- **Astra 53:** Inconsistent supplied subtotal/tax/total cents or dollar totals produce userErrors without creating or modifying jobs; matching totals succeed. Negative, fractional and string direct cent values are rejected.
- **Astra 54:** Separate jobs and fallback lines have distinct global and legacy IDs. Same-job line IDs survive edits; foreign/duplicate IDs receive fresh allocations. Reads preserve the other job, deletion removes stored lines, and later allocations do not reuse deleted line IDs.
- **Astra 55:** String and numeric 1.005 and 16.075 round half-up to 101 and 1608 cents on unit prices, fixed discounts and fixed required deposits; quote mutations assert stored/projected exact cents.

Job line storage now uses organization-scoped `job_lines:<id>` preferences and a persistent sequence read across organizations. Calculation options pass through GraphQL normalization and are stripped by REST before persisting job columns, keeping line writes and totals atomic.

The four new groups follow Astra 51 and precede Rails JSON adapters. After implementing Astra 52 through Astra 55, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **98/98 automated tests pass (`98 pass, 0 fail`)**, including all 55 Astra regression groups (`Astra 1` through `Astra 55`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. Historical Coordinator results below predate these changes. Collaboration remains `INSPECTION_INCOMPLETE` in the injected snapshot; the outer Coordinator owns its resolution and verification. No external audit was requested.

## Astra 6 follow-up coverage (Astra 47–51) — 2026-10-27

- **Astra 47:** Structural argument equality (`argsEqual`) uses memoized reference-pair caching (`WeakMap`), so shared large variables compare in O(1) without JSON serialization (`reads === 0`), while nested conflicting arguments are still detected.
- **Astra 48:** List-element-aware result-depth validation (`listFields`) in `validate()` rejects deeply nested list selections before mutation dispatch (`paymentRecordCreate`), leaving payment records unchanged.
- **Astra 49:** Job line-item calculation and storage work across `jobCreate`, `jobEdit`, `PATCH /api/jobs/:id`, and `Job.lineItems` reads, including clearing with `lineItems: []`. Normalization calculates totals, then strips calculation-only discount/deposit/`taxRate` inputs (`tax_rate`, `discount_type`, `discount_value`, `required_deposit_type`, `required_deposit_value`) before persisting job totals (`subtotal_cents`, `tax_cents`, `total_cents`), without writing nonexistent calculation-input columns.
- **Astra 50:** The `timeEntryId` target ID alias on `timeSheetClockOut` stops the targeted timer, and the `paymentId` target ID alias on `paymentRefund` refunds the targeted payment.
- **Astra 51:** `productOrServiceId` and `serviceId` Global IDs normalize on catalog edits and quote/invoice line items; `workRequestId` / `workOrderId` normalize to relationship IDs. Invoice create/edit normalizes `title` → `subject`, without changing title handling for other entity types.
- **Astra 31 correction:** The shared-input assertion allows at most one property read; identical `$input` references can short-circuit via `Object.is` with zero reads.

The five Astra 47–51 blocks were present near the top of `test/graphql-rails-api.test.js` and have been moved unchanged to immediately after Astra 46, before the Rails JSON adapters test. Astra 1 through Astra 51 now appear in sequential order.

The Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **94/94 automated tests pass (`94 pass, 0 fail`)**, including all 51 Astra regression groups (`Astra 1` through `Astra 51`) in `test/graphql-rails-api.test.js`. The Coordinator confirmed the collaboration gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`. These are Coordinator-reported results; commands and tests were not rerun in this documentation/reordering session. The injected collaboration snapshot still reports `INSPECTION_INCOMPLETE` (unable to open database file); that conflicting snapshot is reported to the Coordinator, not treated as an independent CLEAR inspection. Earlier passing counts are historical. No external audit was requested; existing official-schema parity and functional boundaries remain unchanged.

## Astra 6 follow-up coverage (Astra 43–46) — 2026-10-27

Four additional regression groups in `test/graphql-rails-api.test.js` cover:

- **Astra 43:** Scheduled assessment public fields avoid Request reads; instructions require lazy Request read authorization. Denied instructions return null with a permission error without reading requests; authorized reads return saved instructions or internal-note fallback.
- **Astra 44:** Assignments load only assigned user IDs, deduplicate numeric/string IDs, charge lookup costs including missing users, and enforce team-read permissions. Adding unrelated users does not increase assignment query cost, while full user connections still charge scans. The SQL assertion accepts `id = ?` and `id IS ?`, matching `repository.list("users", { id })`.
- **Astra 45:** Explicit null task/visit timestamps remain null in storage and responses without corrupting dates; omitted fields remain omitted, and explicit task date/time fields override null timestamp inputs.
- **Astra 46:** User and client phone IDs use distinct stable `user:` and `client:` namespaces even when numeric entity IDs match, while client phone fields and repeated query results remain consistent.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **89/89 automated tests pass (`89 pass, 0 fail`)**, including all 46 Astra regression groups (`Astra 1` through `Astra 46`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. Earlier passing counts are historical and predate this batch. No external audit was requested; the existing official-schema parity and functional boundaries remain unchanged.

## Astra 6 follow-up coverage (Astra 38–42) — 2026-10-27

Five additional regression groups in `test/graphql-rails-api.test.js` cover:

- **Astra 38:** Login/bootstrap reject invalid or cross-site origins without creating sessions or setting cookies; cookie-authenticated writes reject cross-site origins even with a CSRF token. Form submissions require CSRF protection, and origin/referrer checks enforce the same origin.
- **Astra 39:** Task timestamps retain seconds, fractional seconds, timezone offsets and overnight end dates in mutation responses and scheduled-item projections; explicit time fields preserve seconds and fractional seconds.
- **Astra 40:** Client lead/archive flags are order independent, including snake-case aliases; conflicting true flags are rejected. Unrelated false flags preserve existing status, explicit status takes precedence, and clearing both flags restores active status.
- **Astra 41:** Quote, invoice and job numbers retain custom strings and numeric inputs as strings, with legacy ID fallback when omitted; numeric request numbers normalize to strings.
- **Astra 42:** Connections charge scanned rows against execution cost, map selected nodes lazily, avoid role reads for unselected fields and cache selected roles. Count/page-info-only schedule queries avoid request reads, and repeated scans terminate at the execution-cost limit.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **85/85 automated tests pass (`85 pass, 0 fail`)**, including all 42 Astra regression groups (`Astra 1` through `Astra 42`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this documentation-update session. Earlier passing counts are historical and predate this batch. No external audit was requested; the existing official-schema parity and functional boundaries remain unchanged.

## Astra 6 follow-up coverage (Astra 31–37) — 2026-10-27

Seven additional regression groups in `test/graphql-rails-api.test.js` cover:

- **Astra 31:** Shared input objects are validated once; wide abstract selections hit the query-cost bound before execution; repeated fragments remain valid.
- **Astra 32:** Entity ID aliases enforce their concrete types, rejecting a wrong-type payment record ID before refund dispatch without changing payments.
- **Astra 33:** Returned quote/invoice line-item IDs survive edit round trips; concrete wrong-type IDs are rejected, while compatible generic and quote-backed job line IDs are accepted. Create inputs supply `title` only for `quoteCreate` and `subject` only for `invoiceCreate`.
- **Astra 34:** Refresh rotation follows the linked session's current user and workspace, rejects replay, and invalidates grants for disabled users.
- **Astra 35:** Task start/end timestamps persist to date/time columns and project through scheduled items, including date-only fallback and explicit date/time overrides.
- **Astra 36:** Assessment instructions persist through scheduling, omitted instructions preserve the saved value, and the alias and scheduled-item projection remain consistent.
- **Astra 37:** User phone fields and declared nested introspection fields project successfully, including nullable metadata and `isOneOf`.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **80/80 automated tests pass (`80 pass, 0 fail`)**, including all 37 Astra regression groups (`Astra 1` through `Astra 37`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. Earlier passing counts are historical and predate this batch. No external audit was requested; the existing official-schema parity and functional boundaries remain unchanged.

## Astra 6 follow-up coverage (Astra 25–30) — 2026-10-27

Six added regression groups cover protected-value searches and camel/snake-case filters (including empty results); malformed contacts/line items without data loss, recursive lists and scalar variable types; natural access expiry versus revocation, missing sessions, disabled users and 30-day grant expiry; disabled-user capacity cleanup while preserving naturally expired access grants; user/service Global ID type enforcement; and `__proto__` mutation/nested aliases surviving HTTP JSON serialization. Source repairs are implemented. After these repairs, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **73/73 automated tests pass (`73 pass, 0 fail`)**, including all 30 Astra regression groups (`Astra 1` through `Astra 30`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this documentation-update session. Earlier passing counts are historical and predate this batch.

## Astra 6 follow-up coverage (Astra 19–24) — 2026-10-27

Six new regression groups cover SQL-null and legacy JSON-null/scalar addresses; invoice-credit IDs distinct from invoice IDs; write-only create/edit/delete payloads, skipped selections and aliased/fragment entity-read checks before writes; impossible and unknown fragment types rejected before earlier mutations execute; refresh revocation, missing/expired sessions, more than 10,000 revoked grants and HTTP logout; and reordered nested input/argument keys with preserved array ordering and single mutation execution. The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **67/67 automated tests pass (`67 pass, 0 fail`)**, including `Astra 1` through `Astra 24` in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. Historical passing totals below predate this batch. No external audit was requested.

Subsequent auth performance repair: per-request sweeps check only in-memory expiration, with no per-grant SQLite queries. Non-refresh exchanges reaching the 10,000-grant limit load active session tokens in one batch query, prune inactive grants using a `Set`, and reject only if capacity remains full. Immediate logout revocation and refresh rotation remain in place. Refresh exchanges delete the submitted grant and return `Invalid refresh token` (400) for inactive/missing users and missing sessions or explicit session revocation (expiry at or before the Unix epoch). Natural access expiry does not revoke the refresh grant; capacity pruning joins active users with non-revoked sessions. The recorded Coordinator result is **67/67 automated tests pass (`67 pass, 0 fail`)**.

## Astra 6 API repair coverage — 2026-10-27

All nine findings have source repairs and named regressions in `test/graphql-rails-api.test.js`. Assertions cover inherited fixed-dollar edits, invalid nested selections before inserts, fatal execution budgets, optional-variable omission, cross-source line IDs, 10,000-entry grant capacity, forced SQLite issuance failure with credential retry/session rollback, ignored-header cookie CSRF, and distinct visit instructions/completion notes. Supported output selections are validated recursively without depending on runtime rows or directive inclusion.

**Coordinator verified:** `npm test` confirms **52/52 automated tests pass (`52 pass, 0 fail`)**, including all nine Astra regression groups (`Astra 1` through `Astra 9`) in `test/graphql-rails-api.test.js`. All `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session. The 43/43 result below predates these changes. No additional Astra audit was requested. Full specification coercion, complete official introspection and persistent OAuth grants remain known boundaries.

## GraphQL / Rails API implementation — 2026-10-27

Added a zero-dependency recursive-descent parser, Relay IDs/connections, domain resolvers, REST-backed mutation dispatch, OAuth grants, session cookies/CSRF, and Rails `.json` normalization. Eight new test groups in `test/graphql-rails-api.test.js` cover OAuth rotation/replay, cookie/CSRF authentication, language features and version echo, exact-cent quote-to-cash/refund reconciliation, RBAC/domain errors, Rails workflow aliases and unchanged SPA navigation. Coverage now includes heterogeneous Visit/Assessment/Task `scheduledItems` with namespaced cursor pagination and `Job.lineItems` selected quote lines/fallback totals. Static `/assets/*.json` no longer rewrites to authenticated API routes; the existing frontend regression covers `/assets/README.json` returning 404.

**Coordinator verified:** `npm test` confirms **43/43 automated tests pass (`43 pass, 0 fail`)**, including all eight groups in `test/graphql-rails-api.test.js` and `/assets/README.json` returning 404 in `test/frontend-api.test.js`. All `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session. The Coordinator retains ownership of the single final audit. The historical 35/35 result below applies only to the previous revision.

Known API completeness boundaries: introspection is limited metadata, not a complete official typed schema; GraphQL validation and variable/input coercion do not yet cover the full specification. Official Jobber schema parity has not been verified. OAuth code/refresh state is process-local; production multi-process deployment requires shared persistent grants and configured client registration. This implementation must not yet be described as production-grade or verified 1:1 parity.

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

## Astra 6 follow-up regression coverage — 2026-10-27

`test/graphql-rails-api.test.js` now includes `Astra 10`–`Astra 18`: unregistered/mismatched OAuth callbacks; alias conflicts without mutation side effects; invalid monetary/numeric inputs; shared login/password-grant limits and window expiry; partial client name edits; property tax overrides including zero; portal URLs across create/edit/archive/unarchive/merge; ScheduledItem fragments across Visit/Assessment/Task; and complete request assessment fields. The Coordinator executed `npm test` and verified **61/61 automated tests pass (`61 pass, 0 fail`)**, including all 18 Astra regression groups (`Astra 1` through `Astra 18`) in `test/graphql-rails-api.test.js`. All 18/18 `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session. The Coordinator retains ownership of the single final external audit; earlier passing counts predate these changes.

## Outstanding functional boundaries

Receipt forwarding does not ingest email. Named forms share a booking renderer. Timesheet approvals are preferences, not locked payroll records. Hub preferences are saved but not all enforce portal behavior. Several reports share data sources. Provider integrations and subscriptions are simulations. These limitations must not be misrepresented as successful live integration tests.
