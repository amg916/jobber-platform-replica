# Execution progress — Round 5 final fixes

Date: 2026-10-27.

## Astra 6 follow-up repairs (Astra 130)

Job-line connections now tag rows with their fallback (`job:`), stored (`line:`), or quote-backed (`quote:`) identity namespace. ID filters preserve typed namespaces for scalar, `eq`, `in`, and array operands; numeric and legacy `LineItem` IDs remain namespace-independent. Internal `lineKey` metadata is stripped before node mapping. Added Astra 130 covering colliding numeric identities, raw/base64 Global IDs, both ID filter field names, legacy compatibility, empty/null filters, and invalid IDs. Suite total: **173 tests**.

Coordinator-verified result: **173/173 automated tests pass (`173 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 130` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Only Read/Edit tools were used. The supplied collaboration context is `CLEAR`; the Coordinator owns test execution and claim management. The referenced global server-rules file and repository CLAUDE.md were unavailable. No commit, push, deployment or external audit performed.

## Astra 6 follow-up repairs (Astra 128–129)

Stored job-line catalog references now validate typed Global IDs and persist integer IDs or null. Catalog deletion detaches matching legacy numeric strings and raw/base64 Global IDs without changing unrelated references or other tenants. Stored-line invoice conversion normalizes numeric references before lookup/insert. Automation pre-dispatch budgets now select only enabled rules matching the mutation's event and organization, backed by `automation_event(organization_id,trigger_event,is_enabled)`. Updated Astra 127 to exercise enabled matching rules for each mutation; added Astra 128–129 for reference normalization/deletion/invoicing and oversized irrelevant versus matching automation rules. Suite total: **172 tests**.

Coordinator-verified result: **172/172 automated tests pass (`172 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 129` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Only Read/Edit tools were used. The supplied collaboration context is `CLEAR`; the Coordinator owns test execution and claim management. The referenced global server-rules file and repository CLAUDE.md were unavailable. No commit, push, deployment or external audit performed.

## Astra 6 follow-up repairs (Astra 125–127)

Implemented shared `flattenInput` before normalization and REST job hydration checks, so nested address/billing-address inputs retain job-total validation, typed normalization and fixed monetary units. Assigned-user reads parse oversized persisted JSON with budget charging outside the parse catch and charge raw array lengths before deduplication across all four resolvers. Automation-triggering mutations charge tenant-scoped rule rows and condition trees before dispatch. Updated Astra 44's cost delta and Astra 123's duplicate-read assertions; added three regression groups for nested REST validation/atomicity, assigned-user read limits, and automation pre-dispatch budgets and tenant isolation. Suite total: **170 tests**.

Coordinator-verified result: **170/170 automated tests pass (`170 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 127` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Only Read/Edit tools were used. The supplied collaboration context is `CLEAR`; the Coordinator owns test execution and claim management. The referenced global server-rules file and repository CLAUDE.md were unavailable. No commit, push, deployment or external audit performed.

## Astra 6 follow-up repairs (Astra 123–124)

Implemented tenant-scoped appointment-row and persisted assignment-array budget charging before scheduling dispatch, bounded raw-JSON charging for oversized/malformed persisted teams, inherited visit/job assignment charging, raw assigned-user connection charging, and Set-based conflict membership. REST job create/edit opts into JSON-string array normalization; recursive normalization preserves that option while GraphQL remains array-only. Two named regression groups cover all three scheduling paths, cumulative assignment work, inherited oversized strings and overrides, duplicate assigned-user reads, conflict semantics, REST create/edit compatibility and invalid-write preservation, GraphQL rejection, Global IDs, and recursive normalization. Suite total: **167 tests**.

Coordinator-verified result: **167/167 automated tests pass (`167 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 124` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Only Read/Edit tools were used. The supplied collaboration context is `CLEAR`; the Coordinator owns test execution and claim management. The referenced global server-rules file and repository CLAUDE.md were unavailable. No commit, push, deployment or external audit performed.

## Astra 6 follow-up repairs (Astra 121–122)

Implemented array validation for non-null assignment/visit lists and aliases, inherited-team budget charging before visit creation/rescheduling, and team deduplication before SQLite user lookups. Visit creation retains its job ID before route normalization removes it; parsing catches do not swallow execution-budget failures. Quote conversion charges both related line items and jobs and uses a tenant-scoped descending-ID `LIMIT 1` lookup. Two named regression groups cover invalid strings, nullable inputs, inherited-budget exhaustion, explicit overrides, small teams, deduplicated lookups, conversion budgets and newest-job/idempotent conversion. Suite total: **165 tests**.

Coordinator-verified result: **165/165 automated tests pass (`165 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 122` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Only Read/Edit tools were used. The supplied collaboration context is `CLEAR`; the Coordinator owns test execution and claim management. The referenced global server-rules file and repository CLAUDE.md were unavailable. No commit, push, deployment or external audit performed.

## Astra 6 follow-up repairs (Astra 117–120)

Implemented bounded OAuth client IDs, redirect URIs and state; concrete-type-aware scheduled-item ID filters and Assessment request-ID normalization; pre-dispatch invoice-history charging with a bounded active-invoice existence query; and request-local quote-activity caching with charged job scans/override probes and mutation invalidation. Four named regression groups cover input boundaries, concrete ID collisions and filter forms, invoice-history exhaustion before dispatch, and repeated quote-backed Node aliases. Suite total: **163 tests**.

Coordinator-verified result: **163/163 automated tests pass (`163 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 120` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Only Read/Edit tools were used. The supplied collaboration context is `CLEAR`; the Coordinator owns test execution and claim management. The referenced global server-rules file remains unavailable. No commit, push, deployment or external audit performed.

## Astra 6 follow-up repairs (Astra 114–116)

Implemented strict quantity validation before optional-line selection, rejection of explicit null unit prices, complete schema-driven client-merge budget charging (including polymorphic links), and tenant-scoped job-line queries and caches. Added three named regression groups covering rejected-write atomicity, all previously omitted merge tables, tenant isolation, sequence independence, canonical IDs and cache refresh after edits/deletions. Suite total: **159 tests**.

Coordinator-verified result: **159/159 automated tests pass (`159 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 116` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

## Astra 6 follow-up repairs (Astra 112–113)

Added pre-dispatch persisted-row charging for payment reconciliation/allocation/refund checks, client merges and appointment conflict scans. Decimal calculations reject booleans, null and blank strings; explicitly supplied cost, markup, discount, tax and deposit values validate even when otherwise unused. Two named regression groups cover oversized scans, small dispatchable inputs, strict numeric validation and preference-write rollback, for **156 tests** total.

Coordinator-verified result: **156/156 automated tests pass (`156 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 113` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Astra 112's appointment fixture uses distinct `x+1000` entity IDs to satisfy the uniqueness constraint. Astra 112–113 immediately follow Astra 111, before the Rails JSON adapters test. Test execution and claim management remain with the Coordinator. No commit, push, deployment or external audit performed; the referenced global server-rules file remains unavailable.

## Astra 6 follow-up repairs (Astra 108–111)

Normalized legacy invoice prices and taxability, charged persisted visit/completion work before dispatch, retained IDs using canonical line ownership, and normalized boolean filters and derived aliases. Added four named regression groups for **154 tests** total, covering both legacy invoice examples, oversized fixed-job/checklist/appointment work, canonical-first edits, and true/false filter forms.

Coordinator-verified result: **154/154 automated tests pass (`154 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 111` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Astra 109's fixture uses `billing_type:'fixed_price'` to satisfy the billing-type CHECK constraint. The Coordinator retains test execution and claim management. No commit, push, deployment or external audit performed. The referenced global server-rules file is unavailable. Previous results below are historical.

## Astra 6 follow-up repairs (Astra 104–107)

Scoped durable and cached line-ID floors to the organization, preserved first-preference canonical ownership, and reallocated conflicting legacy IDs transactionally. Manual-job pricing now reconciles options through GraphQL, REST and preference writes and preserves matching options when invoicing. Persisted lines/visits are charged before GraphQL dispatch for invoicing, quote conversion and document edits.

Added four regression groups, bringing the suite to **150 tests**. Updated Astra 99's durable-key assertion and isolated Astra 102's replacement fixtures to avoid unrelated duplicate IDs. Coordinator-verified result: **150/150 automated tests pass (`150 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 107` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. The Coordinator retains claim management. No commit, push, deployment or external audit performed. The global server-rules file remains unavailable. Results below are historical.

## Astra 6 follow-up repairs (Astra 102–103)

Sanitized legacy line/option reads, guarded hydration calculations, filtered mixed stored lines before ID reuse/querying/invoicing, and retained raw-array execution charges. SQL override presence checks now trim space, tab, LF and CR without JSON decoding. Added two regression groups covering all three replacement paths, valid legacy ID reuse and allocation, corrupt option handling, mixed-line reads/invoices, whitespace-prefixed empty overrides and oversized-array Node checks.

The suite now contains **146 tests**. Coordinator-verified result: **146/146 automated tests pass (`146 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 103` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The Coordinator retains claim management. No commit, push, deployment or external audit performed. The referenced global server-rules file remains unavailable. Prior passing counts below are historical.

## Astra 6 follow-up repairs (Astra 99–101)

Replaced the in-memory allocation high-water mark with `_jobber_seq`, a lazily created internal SQLite table. Sequence/preference writes share transaction scope, so failed tax reconciliation restores the allocation floor. REST deletion of sequence/line preferences and jobs saves the current floor before removing preferences, including legacy IDs not yet in the internal table. The existing derived line-ownership index remains separate and synchronizes against database contents.

Quote-backed Node lookups use cached SQL array-presence checks without parsing override JSON. Fallback lookups use the same presence cache and a bounded quote-line existence query. Mutation dispatch clears the new request-local cache.

Added Astra 99–101 regressions for final-ID rollback/retry, both preference deletion orders and job deletion followed by disk reopen, and 100 Node aliases against 20,001-line data with parse/query instrumentation. Updated README and functional coverage. Coordinator-reported verification: **144/144 automated tests pass (`144 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 101` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; only Read/Edit tools were used, and no shell commands, tests, syntax checks or external audit were run in this documentation-update session. The global server-rules file was unavailable. No commit, push or deployment performed. Prior passing counts below are historical.

## Astra 6 follow-up repairs (Astra 95–98)

Replaced `json_each` in sequence discovery and stored JobLineItem Node resolution with a per-database WeakMap index. Synchronization reuses unchanged parsed preferences, rebuilds ownership on changed/deleted rows, ignores non-object and invalid-ID entries, and includes valid IDs from noncanonical names only in the sequence high-water calculation. Each execution synchronizes lazily once, with post-dispatch invalidation; indexed hits charge one step and retain tenant/job existence/optional-selection checks.

Preference writes require canonical positive-integer suffixes; deleting legacy noncanonical line preferences no longer recalculates another job's totals. Sequence discovery ignores corrupted non-safe-integer sequence values, direct sequence writes reject MAX_SAFE_INTEGER, and new allocations check exhaustion before any persistence.

Added regression groups Astra 95–98 and updated README/functional coverage. Coordinator-reported verification: **141/141 automated tests pass (`141 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 98` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; only Read/Edit tools were used, and no shell commands, tests, syntax checks or external audit were run in this documentation-update session. The referenced global server-rules file was unavailable. Earlier 137/137 results are historical. No commit, push or deployment performed.

## Astra 6 follow-up repairs (Astra 92–94)

Implemented in-place preference upserts, internal preference validation and transactional job-total reconciliation for REST POST/PATCH/PUT, plus quote-total restoration when deleting stored job lines. Deleting options still preserves totals for legacy inference. Job-line allocation now considers persisted line IDs and a database-local WeakMap high-water mark. Individual JobLineItem Node queries resolve stored, quote-backed and fallback ownership directly, retaining jobs authorization and target-line budget charging.

Added three regression groups in `test/graphql-rails-api.test.js` for stable preference IDs, invalid-write atomicity, pricing reconciliation, sequence deletion, persisted high IDs, unrelated oversized jobs, optional filtering and tenant/permission isolation. Coordinator-reported verification: **137/137 automated tests pass (`137 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 94` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; only Read/Edit tools were used, and no shell commands, tests or syntax checks were run in this documentation-update session. Prior 134/134 results below predate these changes. No commit, push, deployment or external audit was performed. The imported global server-rules file was unavailable at its referenced path.

## Astra 6 follow-up repairs (Astra 88–91)

Implemented namespaced quote-backed JobLineItem Node round trips with jobs authorization; pre-calculation raw-row hydration charging and metadata-only REST hydration avoidance; null-safe catalog-reference cleanup with malformed JSON guards; and fresh task completion timestamps after reopening, preserving completed-task retry timestamps. Added four regression groups and updated two older quote-backed ID assertions.

The interrupted-run fixes normalize REST hydration keys to snake_case (Astra 57), retain 20,001 valid JSON items while asserting metadata-only PATCH/PUT performs no preference or quote-line SELECTs (Astra 89), and replace invalid-JSON fixtures with null/primitive/nested-array entries (Astra 90).

The suite now contains **134 tests**, including **99 API tests**. Coordinator-reported verification: **134/134 automated tests pass (`134 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 91` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`, consistent with the supplied collaboration snapshot; the earlier incomplete snapshot is historical. These results are recorded as supplied; only Read/Edit tools were used, and no shell commands, tests or syntax checks were run in this documentation-update session. No commit, push, deployment or external audit was performed.

## Astra 6 follow-up repairs (Astra 84–87)

Implemented optional selection defaults in calculation/storage, literal job-line preference matching with array guards during catalog deletion, request-local job-line caching and raw-row execution charging before filtering (also reused by JobLineItem Node lookup), post-mutation cache invalidation, and idempotent task completion timestamps. Added four regression groups immediately after Astra 83 and updated README and functional coverage documentation.

Coordinator-reported verification: **130/130 automated tests pass (`130 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied; only Read/Edit tools were used, and no shell commands, tests or syntax checks were run in this documentation-update session. Prior 126/126 verification is historical and predates this batch. The supplied collaboration snapshot is CLEAR. No commit, push, deployment, external audit or remote decision-log write was performed; collaboration claims and fleet decision logging remain with the outer Coordinator.

## Astra 6 follow-up repairs (Astra 79–83)

Implemented job-scoped preference reads and jobs write authorization for generic writes/renames/deletes of internal job keys. Removed the unconditional rejection after authorization, preserving authorized Astra 63 preference deletion. Astra 79 now checks every denied mutation leaves the preference snapshot unchanged with jobs write=0, then checks reads and PATCH/PUT succeed with 200 after jobs read/write=1. Also implemented transactional catalog-reference detachment plus invoice-time tenant-scoped reference checks; empty-quote pricing inheritance; strict boolean validation in calculation, normalization and job-line storage; and cursor-window pagination flags. Added five named regression groups immediately after Astra 78 and updated README and functional coverage documentation.

Coordinator-reported verification: **126/126 automated tests pass (`126 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied; only Read/Edit tools were used, and no shell commands, tests or syntax checks were run in this documentation-update session. Earlier 121/121 verification is historical. The supplied collaboration snapshot for this authorization correction is `CLEAR`; the earlier incomplete snapshot is historical. No commit, push, deployment, external audit or remote decision-log write was performed; collaboration claims and fleet decision logging remain with the outer Coordinator.

## Astra 6 follow-up repairs (Astra 76–78)

Implemented recursive mutation-input execution charging, hydrated/normalized line charges before dispatch, Node lookup support for all declared Node types (including namespaced phones), complete Node possibleTypes/conflict traversal, and work-order/work-request edit ID aliases. Added three regression groups immediately after Astra 75. Coordinator-reported verification: **121/121 automated tests pass (`121 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. No shell commands, commit, push, deployment, external audit or remote decision-log write were performed. The supplied collaboration snapshot is CLEAR; claims and fleet decision logging remain with the outer Coordinator. The prior verified 118/118 result is preserved below as historical.

## Astra 6 follow-up repairs (Astra 72–75)

Implemented active-line total matching before quote-option inheritance, post-dispatch costing/role cache invalidation, line-free job option validation in REST/GraphQL and before preference writes, and empty-array preservation during invoicing. Added four regression groups immediately after Astra 71. Coordinator-reported verification: **118/118 automated tests pass (`118 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this documentation-update session. The supplied collaboration snapshot is CLEAR. No commit, push, deployment, external audit or remote decision-log write was performed; claims and fleet logging remain with the Coordinator. Prior verification and collaboration notes below describe earlier sessions.

## Astra 6 follow-up repairs (Astra 68–71)

Implemented costing budgets/cache, bounded variable and AST validation, quote-derived job pricing hydration and invoice option preservation, and full job-line validation before persistence. `storeJobLines` unconditionally validates names, quantities, descriptions, units, allowed keys and tenant-scoped catalog references; `normalizeInput` permits ID-only line items for Astra 33's standalone GID round trip. Four regression groups immediately follow Astra 67. Coordinator-reported verification: **114/114 automated tests pass (`114 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this implementation session. The injected collaboration snapshot reports `INSPECTION_INCOMPLETE` (unable to open database file); this is reported to the Coordinator, not treated as CLEAR. No commit, push, deployment, remote decision-log write or external audit was performed; fleet logging and claims remain with the Coordinator.

## Astra 6 follow-up repairs (Astra 62–67)

Implemented separate merged job options, mixed-tax discounted invoice calculations, optional-line filtering, bounded monetary conversion, null-preserving filters, and incremental/capped login throttling. Added six sequential regression tests after Astra 61 and before Rails JSON adapters, bringing the expected suite count to **110 tests**.

Astra 67 now saves and explicitly restores `Date.now` and `Map.prototype[Symbol.iterator]` using `try/finally`, preventing Symbol-key mock restoration from corrupting later tests. Coordinator-reported verification: **110/110 automated tests pass (`110 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). Tests and syntax checks were not rerun in this implementation session. The supplied collaboration context is CLEAR. No commit, push, deployment, remote decision-log write or external audit was performed. Fleet logging and collaboration claims remain with the outer Coordinator. Earlier verification results and collaboration snapshots below are historical.

## Astra 6 follow-up repairs (Astra 56–61)

Implemented all six requested technical findings using Read/Edit only, preserving existing changes:

- **Astra 56:** Precompiled membership Sets, per-operand/per-row filter budget charges, search scan charges, and a regression asserting a 25,000-item filter aborts at cost 20,001 in under 100 ms.
- **Astra 57:** Existing job lines participate in partial total/calculation normalization for GraphQL edits and every REST PATCH/PUT; invalid totals cannot mutate the job, while title and tax-rate edits remain supported. Replacement lines are stored transactionally.
- **Astra 58:** Invoice generation prefers persisted replacement job lines to quote lines, with taxable stored-line tax-base calculation.
- **Astra 59:** Typed Global ID and legacy ID operands work in scalar, array, `eq` and `in` filters; invalid operator shapes and wrong entity types fail.
- **Astra 60:** Direct BigInt decimal/scientific-notation conversion avoids intermediate double rounding for unit prices, fixed discounts and fixed deposits.
- **Astra 61:** Catalog/expense free-text category capitalization is preserved; timesheet labels normalize to lowercase.

Added six sequential regression tests after Astra 55 and before Rails JSON adapters. After implementing Astra 56 through Astra 61, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **104/104 automated tests pass (`104 pass, 0 fail`)**, including all 61 Astra regression groups (`Astra 1` through `Astra 61`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; no shell commands, tests, timing checks or syntax checks were run in this Read/Edit-only adjustment session. The supplied collaboration context for this session is CLEAR; earlier incomplete snapshots below are historical. No commit, push, deployment, remote decision-log write or external audit was performed. Fleet logging and verification remain with the outer Coordinator.

## Astra 6 follow-up repairs (Astra 52–55)

Implemented the four technical findings with Read/Edit only, preserving existing work:

- **Astra 52:** SQLite-backed job line storage survives close/reopen with IDs and totals intact. REST job create/edit stores the job and lines in one transaction; delete removes the associated preference inside its transaction.
- **Astra 53:** Reject inconsistent supplied job totals and invalid direct cent values before mutation dispatch; regression coverage checks rejected creates and edits leave stored data unchanged and matching totals succeed.
- **Astra 54:** Persistent sequence allocation distinguishes separate jobs and fallback lines, preserves same-job IDs, replaces foreign/duplicate IDs, and retains the sequence after job deletion.
- **Astra 55:** BigInt half-up dollar conversion covers string/numeric 1.005 and 16.075 for unit prices, fixed discounts and fixed required deposits.

GraphQL now dispatches job items through the transactional REST path rather than storing them after dispatch. Calculation options remain available through normalization and are removed at the REST persistence boundary, so tax/discount totals survive the second normalization without writing nonexistent job columns.

Added four regression groups after Astra 51 and before Rails JSON adapters. After implementing Astra 52 through Astra 55, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **98/98 automated tests pass (`98 pass, 0 fail`)**, including all 55 Astra regression groups (`Astra 1` through `Astra 55`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; no tests, syntax checks or shell commands were run in this Read/Edit-only documentation-update session. The supplied collaboration inspection remains `INSPECTION_INCOMPLETE` and is reported to the Coordinator. No commit, push, deployment, remote decision-log write or external audit was performed; fleet logging and verification remain with the outer Coordinator.

## Astra 6 follow-up repairs (Astra 47–51)

Moved the five existing Astra 47–51 test blocks unchanged from the top of `test/graphql-rails-api.test.js` to immediately after Astra 46, before the Rails JSON adapters test. Astra 1 through Astra 51 now appear in sequential order. Removed the stale missing-group notes and documented all five groups in README and functional audit, preserving existing changes.

- **Astra 47:** structural argument equality (`argsEqual`) with memoized reference-pair caching (`WeakMap`), so shared large variables compare in O(1) without JSON serialization (`reads === 0`), while nested conflicting arguments are still detected.
- **Astra 48:** list-element-aware result-depth validation (`listFields`) in `validate()`, rejecting deeply nested list selections before mutation dispatch (`paymentRecordCreate`).
- **Astra 49:** Job line-item calculation and storage across `jobCreate`, `jobEdit`, `PATCH /api/jobs/:id`, and `Job.lineItems` reads, including clearing with `lineItems: []`. Calculation-only discount/deposit/`taxRate` inputs (`tax_rate`, `discount_type`, `discount_value`, `required_deposit_type`, `required_deposit_value`) are stripped after calculation and before persisting job totals (`subtotal_cents`, `tax_cents`, `total_cents`).
- **Astra 50:** the `timeEntryId` target ID alias on `timeSheetClockOut` and the `paymentId` target ID alias on `paymentRefund`.
- **Astra 51:** `productOrServiceId` and `serviceId` Global ID normalization on catalog edits and quote/invoice line items, `workRequestId` / `workOrderId` normalization, and Invoice `title` → `subject` normalization.

The prior Astra 31 adjustment permits `reads <= 1`, including zero for the `Object.is` identity shortcut.

The Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **94/94 automated tests pass (`94 pass, 0 fail`)**, including all 51 Astra regression groups (`Astra 1` through `Astra 51`) in `test/graphql-rails-api.test.js`. The Coordinator confirmed the collaboration gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`. These are Coordinator-reported results; commands and tests were not rerun in this documentation/reordering session. Earlier counts are historical.

The injected collaboration snapshot still reports `INSPECTION_INCOMPLETE` (unable to open database file), conflicting with the supplied Coordinator CLEAR result. This discrepancy is reported to the outer Coordinator; no independent gate inspection is claimed. No commit, push, deployment, remote decision-log write or external audit was performed.

## Astra 6 follow-up repairs (Astra 43–46)

Four additional regression groups document lazy Request read authorization for scheduled assessment instructions and fallback notes (Astra 43), assigned-user ID lookups and lookup-cost accounting independent of unrelated users (Astra 44), null task/visit timestamps without corrupted dates (Astra 45), and distinct stable user/client phone ID namespaces (Astra 46). Updated Astra 44's SQL regex from `/\bid\s*=\s*\?/i` to `/\bid\s*(?:=|IS)\s*\?/i` because `repository.list("users", { id })` generates `AND id IS ?`. Updated README and functional audit while preserving existing work.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **89/89 automated tests pass (`89 pass, 0 fail`)**, including all 46 Astra regression groups (`Astra 1` through `Astra 46`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. Earlier passing counts, including 85/85, are historical and predate this batch. No commit, push, deployment, remote decision-log write or external audit was performed. The supplied collaboration inspection is `INSPECTION_INCOMPLETE` (unable to open database file); the outer Coordinator retains ownership of resolving that inspection, claims and release checks.

## Astra 6 follow-up repairs (Astra 38–42)

Five additional regression groups document origin and CSRF checks for login/bootstrap and cookie-authenticated writes (Astra 38), precise task timestamps including offsets and overnight dates (Astra 39), order-independent client lead/archive flags and preservation of unrelated status (Astra 40), custom string/numeric document numbers and ID fallback (Astra 41), and connection scan-cost accounting, lazy mapping and selected user-role caching (Astra 42). Updated README and functional audit while preserving existing work.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **85/85 automated tests pass (`85 pass, 0 fail`)**, including all 42 Astra regression groups (`Astra 1` through `Astra 42`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this documentation-update session. Earlier passing counts, including 80/80, are historical and predate this batch. No commit, push, deployment, remote decision-log write or external audit was performed.

## Astra 6 follow-up repairs (Astra 31–37)

Seven additional regression groups document shared-input memoization and bounded abstract conflict traversal (Astra 31), typed entity ID aliases before refunds (Astra 32), concrete line-item ID round trips (Astra 33), linked-session refresh user/workspace identity (Astra 34), persisted task timestamps in scheduled items (Astra 35), saved assessment instructions (Astra 36), and phone/nested introspection fields (Astra 37). Corrected Astra 33's create input to conditionally supply `title` for `quoteCreate` or `subject` for `invoiceCreate`, preserving the shared client and line items. Updated README and functional audit while preserving existing work.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **80/80 automated tests pass (`80 pass, 0 fail`)**, including all 37 Astra regression groups (`Astra 1` through `Astra 37`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. The historical 73-test result predates this batch. No commit, push, deployment, remote decision-log write or external audit was performed.

## Astra 6 follow-up repairs (Astra 25–30)

Implemented all six findings: protected search/filter columns; recursive variable and list-input validation; refresh grants surviving natural access expiry; disabled-user capacity pruning; typed user/service relationship IDs; and null-prototype response projection. Added six named regression groups covering rejection without data loss, refresh rotation/revocation/30-day expiry, 10,000-grant capacity, wrong-entity IDs and JSON alias preservation. Updated README and functional audit. After these repairs, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **73/73 automated tests pass (`73 pass, 0 fail`)**, including all 30 Astra regression groups (`Astra 1` through `Astra 30`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this documentation-update session. The historical 67-test result predates these changes. No commit, push, deployment, remote decision-log write or external audit was performed.

## Astra 6 follow-up repairs (Astra 19–24)

Implemented all six requested findings across GraphQL, auth and logout, preserving existing changes. Added six regression groups for cleared/legacy addresses, credited invoice identity, write-only selections and pre-write read checks, impossible/unknown fragments, revoked refresh capacity and logout, and canonical argument ordering. Clock-in retains its newly created result ID; other same-entity actions reload their target ID. `git diff --check` passed. The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **67/67 automated tests pass (`67 pass, 0 fail`)**, including `Astra 1` through `Astra 24` in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. No commit, push, deployment, remote decision-log write or external audit was performed.

Subsequent auth optimization: `sweep` now checks only in-memory expiration. Non-refresh exchanges at 10,000 refresh grants use one batch query of active session tokens and a `Set` to prune inactive grants before checking capacity. The per-grant SQLite query loop and unused prepared statement were removed. Refresh exchanges now delete the submitted grant and return `Invalid refresh token` (400) for inactive/missing users and missing or explicitly revoked sessions, comparing session expiry against the Unix epoch. Natural access expiry remains refreshable until the grant expires; capacity pruning now joins active users with non-revoked sessions. The recorded Coordinator result is **67/67 automated tests pass (`67 pass, 0 fail`)**.

## Astra 6 API repairs — 2026-10-27

- Implemented all nine requested fixes across GraphQL, authentication and visit creation, preserving existing adapter changes.
- Added nine named regression groups for fixed-value partial edits, pre-execution nested/fragment selection validation, fatal cost/depth termination, omitted variables, line-ID collisions, full grant stores, issuance rollback/retry, ignored-header CSRF and visit instructions/completion notes.
- Added static selection metadata for supported entities, payloads, connections, edges, nested objects, interfaces and introspection. Runtime array traversal now stops serially on fatal limits.
- Coordinator verification: `npm test` confirms **52/52 automated tests pass (`52 pass, 0 fail`)**, including all nine Astra regression groups (`Astra 1` through `Astra 9`) in `test/graphql-rails-api.test.js`. All `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session. No build, external audit, commit, push, deployment or remote decision-log write was performed in this repair session. The 43/43 result below is historical and predates these repairs.

## GraphQL / OAuth / Rails adapter — 2026-10-27

- Added `src/services/graphql.js`: bounded parser, language selection/projection, Relay IDs/pagination, domain mapping, permission-aware relations, REST-backed mutation routing, introspection and cost/version envelopes.
- Added `src/services/api-auth.js`: cookie/header extraction, CSRF HMACs, expiring single-use authorization codes, rotating refresh grants, password/configured-client credentials, and Rails path normalization.
- Updated server route ordering to preserve extensionless SPA navigation, existing REST handlers and reference-icon JSON; added GraphQL, OAuth, work-object search and invoice-bound payment endpoints.
- Added eight regression groups in `test/graphql-rails-api.test.js`, including heterogeneous Visit/Assessment/Task `scheduledItems`, collision-free cursor pagination and `Job.lineItems` (selected quote lines or a synthesized fallback). `/assets/` paths now bypass Rails JSON rewriting. Updated README, route map and functional audit.
- Coordinator verification: `npm test` confirms **43/43 automated tests pass (`43 pass, 0 fail`)**, including all eight groups in `test/graphql-rails-api.test.js` and `/assets/README.json` returning 404 in `test/frontend-api.test.js`. All `.js` files pass `node --check` (`ALL_SYNTAX_OK`). Tests were not rerun in this documentation-update session. Coordinator owns test execution and final audit. No commit, push, deployment, remote decision-log write or external audit is claimed.
- Scope remains incomplete against the production-grade 1:1 requirement: complete official schema/introspection and full pre-execution GraphQL validation/coercion need further implementation and verification. See FUNCTIONAL_AUDIT.md. No third-party packages or downloads were added.

## Astra technical repair — 2026-10-27

Implemented all 13 requested findings across server routes, document/calendar/timesheet/form handlers, deposit reconciliation, job tax invoicing, pipeline movement, and recurrence schema/generation. Added 13 individually named regression tests to `test/round5.test.js`, with in-memory workflow tests, HTTP checks and a lightweight DOM/VM harness executing the actual frontend handlers.

The Coordinator regenerated all 5 cropped JPEGs, passed `node --check` for all 15 `.js` files, and executed `npm test`, verifying **35/35 automated tests pass (`35 pass, 0 fail`)**. This records the Coordinator's verified result; tests were not rerun in this implementation session. The Astra 6 follow-up fixes invoice/header consistency, decimal number inputs, explicit deposit removal, invoice payment-term preservation, and legacy visit occurrence backfilling. Astra 11 now checks direct and pipeline issuance with `net_15`/`upon_receipt` and matching due dates. Astra 12 checks idempotent migration backfills and rescheduling/regeneration without duplicate visits, including null-identity fallbacks. The updated Round 5 browser report records **11/11 checks passed**. No external audit was requested.

Latest Astra 6 follow-up: automatic invoicing now returns jobs to `active` while unfinished visits remain, preserving Active Job visibility, and marks them `completed` only when all visits are completed or cancelled. Astra 11 covers explicit visit A billing, automatic visit B billing with scheduled/uninvoiced C remaining, and final C billing (6500 cents each). After this automatic partial-billing fix and latest Astra 11 regression assertion, the Coordinator ran `node --check` (15/15 `.js` files passed; `ALL_SYNTAX_OK`) and `npm test`, verifying **35/35 automated tests pass (`35 pass, 0 fail`)**, including the latest Astra 11 partial-billing regression assertion. The Coordinator confirmed the collaboration gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`.

## Source implementation

- Made invoice reconciliation conditional on changes to paid amount, balance due or status.
- Made client reconciliation return the fetched client unchanged when its balance is unchanged, preventing the overdue worker from resetting Last Activity timestamps on no-op runs.
- Added a regression assertion after `workflows(db, 1).overdue()` for all six exact historical client dates.
- Made the crop script rerunnable and updated the Quotes, Timesheets, Expenses and avatar rectangles to the requested coordinates; retained the Marketing rectangle.
- Added root ignore rules for SQLite databases and sidecars, `.DS_Store`, and `node_modules/`.
- Corrected the job-invoice assertion's expected array to include `balance_due_cents` as the fourth value.
- Updated README, visual audit, functional audit and this progress report to match the updated Round 5 browser report and Coordinator execution results, with test execution attributed to the Coordinator.

## Recorded Round 5 browser evidence

`VISUAL_COMPARISON_ROUND_5.md` records **all 11 Round 5 checks passed** at 1523 × 832. After clearing session/local storage and reloading with cache disabled, it reports zero console errors and zero uncaught page exceptions. Navigation, artwork loading, Converted quotes, marketplace tabs, settings controls, booking tabs, collapsed timesheets and fixed Create placement passed.

The first six Clients rows show Last Activity dates **Oct 13, Sep 22, Aug 13, Aug 1, Aug 1, and Jul 24**, in that order. Home, Clients, Quotes, Expenses and Timesheets captures were refreshed; the other six captures were retained and their views rechecked. Comparison Sheets 1 and 2 were regenerated; Sheets 3 and 4 are unchanged. These results establish the documented layout/content checks, not pixel parity. The reconciliation fix prevents no-op timestamp writes but does not restore dates already overwritten in an existing database.

## Final-fix execution status

- `python3 docs/crop_round5_assets.py`: Coordinator regenerated all 5 cropped JPEGs.
- `node --check`: Coordinator reported all 15 `.js` files passed.
- `npm test`: Coordinator executed and verified **35/35 automated tests pass (`35 pass, 0 fail`)**.
- Browser checks: 11/11 passed in the updated `VISUAL_COMPARISON_ROUND_5.md`.
- The Astra 6 follow-up used Read/Edit exact-string replacements to preserve existing changes. No tests were run in this implementation session; the passing result above is the Coordinator's reported verification.

## Preserved state and coordination

This documentation-update session did not change the existing SQLite database or screenshots; the browser report separately records the refreshed captures described above. No dependencies were added, no commit or push was made, and no remote server was changed. The Coordinator has resolved the earlier incomplete collaboration inspection and confirmed the gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`. The outer Coordinator owns claims, peer coordination and release checks. No remote decisions-log update or final external audit was performed.

## Astra 6 follow-up API repairs — 2026-10-27

Implemented all nine follow-up findings in the auth service, GraphQL adapter and server router; added `Astra 10`–`Astra 18` regression groups. Changes enforce registered redirects, shared 30-attempt authentication throttling, alias-conflict validation before writes, strict numeric inputs, preserved client names and portal URLs, saved property tax rates, schedule fragments and assessment fields. Existing staged work was preserved. The Coordinator executed `npm test` and verified **61/61 automated tests pass (`61 pass, 0 fail`)**, including all 18 Astra regression groups (`Astra 1` through `Astra 18`) in `test/graphql-rails-api.test.js`. All 18/18 `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session. No commit, deployment, remote decision-log update or external audit was performed.

## Remaining verification

- The Coordinator retains ownership of the single final external audit and any fleet decision logging if deployment is later requested.
