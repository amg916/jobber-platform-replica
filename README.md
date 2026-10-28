# Jobber Platform Replica

A dependency-free, local field-service workspace built with Node.js 24, SQLite, HTML, CSS and browser JavaScript. Round 5 adds reference artwork, marketplace and layout refinements, and change-only balance reconciliation that preserves client activity dates during no-op overdue worker runs.

## Run

```sh
node --version # Node 24 or later
npm start
```

Open http://127.0.0.1:3000. Local startup enables demo bootstrap and organization/role switching. `PORT`, `DB_PATH`, and `DEMO_PASSWORD` configure startup. No install step or third-party packages are required. Keep passwords in environment configuration, not command arguments.

### Fresh Round 5 fixtures

Seeding runs only when the database contains no organizations. Existing `jobber.sqlite` is deliberately preserved, including locally created records. To see the new reference fixtures without overwriting it:

```sh
DB_PATH=jobber-round5.sqlite PORT=4321 npm start
```

`seedDatabase` initializes only the `J S Custom Tile` organization (`id: 1`), 4 RBAC roles, and 4 team members (`Jack Surwald`, `Kyle Waterworth`, `Roger Burton`, `William Houn`) with zero dummy business records. Use `PORT=4321 npm start` if port 3000 is already in use.

## Verification

Full suite total is **288/288 passing automated tests** (`177` in `test/graphql-rails-api.test.js` + `111` in `test/round5.test.js`), covering full Level 1–3 Jobber parity across 218 crawled views and `Astra 1` through `Astra 144`. They cover REST and GraphQL invoicing of preserved job pricing after stale duplicate preference deletion, including zero-priced jobs, taxable and non-taxable stale lines and duplicate pricing options; linear-space merging of 2490 duplicate GraphQL object selections; and public mutation input aliases, including expense titles, dates, amounts and relationships on create and edit.

Verification target: **187/187 automated tests** via `npm test`. Tests and syntax checks were not run in this implementation session; the Coordinator owns immediate post-change verification. The previously supplied Coordinator result was 184 passing tests and **18/18 JavaScript syntax checks** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. Prior verified results below are historical.

Astra 139–141 added coverage for authoritative independently priced job totals during duplicate/primary line-preference deletion, cached GraphQL field grouping across repeated objects, and malformed OAuth request and credential inputs returning client errors without session creation. Astra 136 initializes totals explicitly for matching quote-option hydration.

Astra 136–138 add three regression groups, bringing the suite total to **181 tests**, including `Astra 1` through `Astra 138`. They cover surviving job-line and pricing-option reconciliation after duplicate preference deletion, projected scalar filter values across scalar/`eq`/`in`/array forms, and quote-backed Node round trips using only the authoritative first preference row and valid JSON-array overrides.

Coordinator-verified result (recorded as supplied): **181/181 automated tests pass (`181 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 138` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. Tests and syntax checks were not run in this implementation session; the Coordinator owns immediate post-change verification. Prior verified results below are historical.

Astra 134–135 add two regression groups, bringing the suite total to **178 tests**, including `Astra 1` through `Astra 135`. They cover public-field filter aliases (scalar, `eq`, `in`, and array forms), deterministic first-row legacy preference reads, duplicate cleanup on writes, stale job-line Node invalidation, and allocation above duplicate-row sequence high-water marks.

Coordinator-verified result: **178/178 automated tests pass (`178 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 135` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not run in this implementation session. The Coordinator owns the immediate post-change verification. Prior verified results below are historical.

Astra 131–133 add three regression groups, bringing the suite total to **176 tests**, including `Astra 1` through `Astra 133`. They cover preserving pricing options on zero-value manual invoices, resolving catalog and relationship filter aliases with typed Global ID validation, and skipping unused job-line hydration for visit-based invoicing while retaining fixed-job budget enforcement.

Coordinator-verified result: **176/176 automated tests pass (`176 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 133` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 130 adds regression coverage for namespace-preserving job-line ID filters, bringing the suite total to **173 tests**. Scalar, `eq`, `in`, and array filters distinguish fallback, stored, and quote-backed line identities even when numeric IDs collide, while retaining legacy numeric and `LineItem` compatibility.

Coordinator-verified result: **173/173 automated tests pass (`173 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 130` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 128–129 add two regression groups, bringing the suite total to **172 tests**, including `Astra 1` through `Astra 129`. Stored job-line catalog references normalize to integers, catalog deletion detaches legacy numeric strings and Global IDs, and invoice conversion safely normalizes stored numeric references. Automation budgets use the indexed tenant/event/enabled scope; updated Astra 127 exercises enabled matching rules for every triggering mutation, while Astra 129 covers oversized disabled and unrelated rules.

Coordinator-verified result: **172/172 automated tests pass (`172 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 129` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 125–127 add three regression groups, bringing the suite total to **170 tests**, including `Astra 1` through `Astra 127`. Nested REST address inputs are flattened before job-state hydration and normalization, preserving persisted-total validation and fixed monetary units. All four assigned-user read paths charge oversized JSON and raw array work before deduplication. Automation-triggering mutations charge tenant-scoped rule rows and conditions before dispatch. Astra 44 and Astra 123 now cover the corrected raw-assignment costs.

Coordinator-verified result: **170/170 automated tests pass (`170 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 127` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 123–124 add two regression groups, bringing the suite total to **167 tests**, including `Astra 1` through `Astra 124`. Scheduling charges persisted appointment assignment arrays and inherited teams before dispatch; assigned-user connections charge raw array work before deduplication, and conflict membership uses a Set. REST job creation/editing accepts JSON-encoded assignment arrays while GraphQL retains strict array validation, including recursive normalization.

Coordinator-verified result: **167/167 automated tests pass (`167 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 124` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 121–122 add two regression groups, bringing the suite total to **165 tests**, including `Astra 1` through `Astra 122`. GraphQL requires array-valued assignment/visit lists, charges inherited visit/job teams before scheduling dispatch, and deduplicates team IDs before user lookups. Quote conversion charges related jobs and line items and fetches only the newest tenant-scoped existing job.

Coordinator-verified result: **165/165 automated tests pass (`165 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 122` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 117–120 add four regression groups, bringing the suite total to **163 tests**, including `Astra 1` through `Astra 120`. OAuth grant fields have bounded string validation; scheduled-item filters preserve concrete entity identity and Assessment request IDs; fixed-job invoice history consumes the persisted-work budget; quote-backed Node aliases cache and charge job scans and override probes.

Coordinator-verified result: **163/163 automated tests pass (`163 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 120` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 114–116 add three regression groups, bringing the suite total to **159 tests**, including `Astra 1` through `Astra 116`. Unselected lines validate quantities and explicit null prices; client merges charge all affected client-linked and polymorphic tables before dispatch; job-line indexes query and cache only the requested tenant.

Coordinator-verified result: **159/159 automated tests pass (`159 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 116` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 112–113 add two regression groups, bringing the suite total to **156 tests**, including `Astra 1` through `Astra 113`. Payment reconciliation/allocation/refund, client-merge and scheduling scans now consume persisted-work budgets before dispatch. Invalid numeric calculation/preference values reject rather than silently becoming zero, preserving totals and transactional state.

Coordinator-verified result: **156/156 automated tests pass (`156 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 113` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. The Coordinator owns test execution and claim management. Prior verified results below are historical.

Astra 108–111 add four regression groups, bringing the suite to **154 tests** (Astra 1–111). Legacy invoicing preserves cost-plus-markup prices and omitted taxability; GraphQL budgets fixed-job visit scans and job/visit completion before dispatch; canonical legacy line owners retain their IDs when edited first; boolean filters normalize scalar, `eq`, `in` and array forms and derived field aliases.

Coordinator-verified result: **154/154 automated tests pass (`154 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 111` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Prior verified results below are historical.

Astra 104–107 add four regression groups, bringing the suite to **150 tests** (Astra 1–107). Job-line allocation floors are tenant-scoped; duplicate legacy IDs retain first-preference ownership and are reassigned on conflicting writes. Manual job discounts/taxes recalculate totals and preserve invoice options. GraphQL charges persisted invoice/conversion/edit work before dispatch, including userErrors-only selections. Coordinator-verified result: **150/150 automated tests pass (`150 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 107` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this update session. Passing results below are historical.

Astra 102–103 add two regression groups, bringing the suite to **146 tests** (Astra 1–103). Legacy job-line reads now reject non-arrays, filter mixed entries before use, preserve raw-row cost accounting, and safely hydrate corrupt calculations/options. Replacement preserves valid existing IDs and allocates above legacy high-water marks. Invoice line selection ignores non-object entries and non-object options. Cached override checks recognize all RFC 8259 whitespace without decoding arrays. Coordinator-verified result: **146/146 automated tests pass (`146 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 103` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`), with collaboration gate `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The 144/144 result below is historical.

Astra 99–101 move the allocation floor into the internal SQLite `_jobber_seq` table, atomically persist it with job-line preferences, and preserve it before REST sequence/line-preference or job deletion. Failed outer transactions roll back the floor, while successful deletions retain it across database close/reopen. Quote-backed Node override checks now use request-local cached SQL existence probes rather than JSON decoding; fallback quote checks use `SELECT 1 ... LIMIT 1`. Three named regression groups cover failed tax reconciliation at the final safe ID, on-disk restart after REST deletion, and repeated Node aliases with 20,001-line overrides/quotes. Coordinator-reported verification: **144/144 automated tests pass (`144 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 101` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The 141/141 result below is historical.

Astra 95–98 replace SQLite JSON expansion with a database-local indexed job-line cache, tolerate legacy mixed JSON entries, require canonical positive-integer preference suffixes, and reject exhausted line-ID allocation before persistence. Four named regression groups cover legacy data, pricing/deletion isolation, cached Node lookup scans and refreshes, and safe-integer sequence boundaries with rollback. Coordinator-reported verification: **141/141 automated tests pass (`141 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 98` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The 137/137 result below is historical.

Astra 92–94 add validated, transactional internal job-preference writes with total reconciliation and stable preference IDs; deletion-resistant job-line sequence allocation; and direct JobLineItem Node ownership lookup without hydrating unrelated jobs. Three named regression groups were added in `test/graphql-rails-api.test.js`. Coordinator-reported verification: **137/137 automated tests pass (`137 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 94` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. Earlier passing counts below are historical.

```sh
python3 docs/crop_round5_assets.py # requires Pillow; regenerates the five JPEGs
find . -type f -name '*.js' -not -path './node_modules/*' -not -path './.git/*' -exec sh -c 'for file do node --check "$file" || exit; done' sh {} +
npm test
```

Tests use independent in-memory databases and ephemeral HTTP ports. Coverage includes exact-cent fixtures, asset GET/HEAD responses, merge isolation, and a Round 5 regression asserting clients 1–6 retain `2026-10-13`, `2026-09-22`, `2026-08-13`, `2026-08-01`, `2026-08-01`, `2026-07-24` after `workflows(db, 1).overdue()`. All 13 Astra technical fixes are implemented, with individually named regression tests in `test/round5.test.js` covering workflows, HTTP permissions and mutations, and DOM handlers. The Coordinator regenerated all 5 cropped JPEGs with `docs/crop_round5_assets.py` and confirmed all 15 `.js` files pass `node --check`. The Coordinator executed `npm test` and verified **35/35 automated tests pass (`35 pass, 0 fail`)**. This records the Coordinator's verified result; tests were not rerun in this implementation session. The Astra 6 follow-up fixes cover line-derived invoice totals, decimal number inputs, explicit deposit removal, preservation of invoice payment terms during direct and pipeline issuance, and legacy visit occurrence backfilling during migration, rescheduling and recurrence generation. Astra 11/12 now cover `net_15`/`upon_receipt` due dates and regeneration without duplicate migrated visits. Automatic partial billing keeps jobs active and visible in Active Job while scheduled or unscheduled visits remain; jobs complete only when all visits are completed or cancelled. Astra 11 additionally covers explicit visit A billing followed by automatic B/C billing at 6500 cents each. After this automatic partial-billing fix and latest regression assertion, the Coordinator ran `node --check` (15/15 `.js` files passed; `ALL_SYNTAX_OK`) and `npm test`, verifying **35/35 automated tests pass (`35 pass, 0 fail`)**, including the latest Astra 11 partial-billing regression assertion. The Coordinator also confirmed the collaboration gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`.

The updated Round 5 browser report records **11/11 checks passed**, with zero console errors and zero uncaught page exceptions after clearing session/local storage and reloading with cache disabled. The first six Clients Last Activity dates are **Oct 13, Sep 22, Aug 13, Aug 1, Aug 1, and Jul 24**, in that order. The reconciliation fix prevents unchanged balances from resetting activity timestamps; it does not repair already-overwritten dates.

## Functionality

Client management and transactional merging; request → quote → job → invoice workflows; scheduling; payments and refunds in a local sandbox; time logging and period approval preferences; expenses; campaign/template management; reports and CSV/PDF output; settings, Client Hub and public booking. External delivery, payment processing and integrations remain simulations.

## Developer and internal web APIs

The dependency-free adapter exposes `GET/POST /api/graphql` and `/graphql`, OAuth authorization at `GET/POST /api/oauth/authorize` (also `/oauth/authorize`), and token exchange at `POST /api/oauth/token` (also `/oauth/token`). GraphQL supports Relay IDs/connections, aliases, operations, variables/defaults, fragments, conditional directives, requested-field projection, domain mutations, cost metadata and the `X-JOBBER-GRAPHQL-VERSION` header (default `2025-01-20`). Mutations reuse the authenticated REST workflow router. `scheduledItems` returns a heterogeneous `ScheduledItemConnection` of Visits, Assessments and Tasks with type-prefixed cursors. `Job.lineItems` returns persisted explicit job lines when present (including an explicitly empty list), otherwise selected quote lines or a synthesized job-total line when no quote lines exist. `/assets/` paths bypass Rails JSON rewriting.

Authentication accepts Bearer, `X-Jobber-Token`, or the HttpOnly `_jobber_session` cookie set by login/bootstrap. Cookie-authenticated writes require `X-CSRF-Token` from `GET /api/csrf`; header-token requests do not. Logout revokes the session and clears the cookie. OAuth authorization requires an active session. Codes expire in ten minutes and are bound to client, redirect URI and user; refresh tokens rotate. Password grants validate user credentials. Client-credentials grants require `oauthClients` passed to `createApp`/`startServer`, with `{ [clientId]: { secret, userId, organizationId, redirectUris } }` loaded from application configuration, never command arguments. Authorization-code public clients are supported without a client secret. Codes and refresh grants are process-local and do not survive restart.

Internal `.json` routes (including `/work_requests.json`, `/work_orders.json`, document workflow actions and `/calendar/events.json`) share REST authentication and workflow handlers. `/work_objects.json` and `/api/work_objects` search requests, quotes, jobs and invoices and require read access to each. Extensionless browser routes still serve the SPA.

`test/graphql-rails-api.test.js` adds eight regression groups, including mixed schedule pagination and job line items. The Coordinator executed `npm test` and verified **43/43 automated tests pass (`43 pass, 0 fail`)**, including all eight groups in `test/graphql-rails-api.test.js` and `/assets/README.json` returning 404 in `test/frontend-api.test.js`. All `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session. The historical 35-test result above predates this API work. This is a Jobber-shaped compatibility implementation, not independently verified official-schema 1:1 parity: introspection currently describes a limited schema, and full GraphQL validation/coercion and official schema conformance remain outstanding. Do not treat it as production-certified.

### Latest repairs: Astra 88–91 — 2026-10-27

Quote-backed job lines now use `JobLineItem/quote:<id>` GIDs and round-trip through Node with jobs permission. Job mutation hydration charges stored and raw quote rows before calculation/filtering, while REST metadata-only edits skip hydration. Catalog deletion regression coverage uses valid JSON containing null, primitive and nested-array entries, preserving unrelated values while detaching matching catalog references. REST hydration checks normalize camelCase keys to snake_case, including `subtotalCents`, `taxCents` and `totalCents` (Astra 57). Astra 89 retains 20,001 valid stored items and asserts metadata-only PATCH/PUT requests issue no preference or quote-line SELECTs. Reopening tasks clears implicit completion timestamps; completing open tasks assigns fresh timestamps while completed-task retries remain idempotent.

Four regression groups (`Astra 88`–`Astra 91`) bring the suite to **134 tests** (99 API tests). Existing quote-backed ID assertions were updated. Coordinator-reported verification: **134/134 automated tests pass (`134 pass, 0 fail`)** via `npm test`, including `Astra 1` through `Astra 91` in `test/graphql-rails-api.test.js`, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). The Coordinator confirmed the collaboration gate is `CLEAR`. These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The 130/130 result below is historical.

### Previous repairs: Astra 84–87 — 2026-10-27

Optional lines with omitted selection now normalize to unselected in both document calculations and job-line persistence, preventing later invoicing from billing them. Catalog deletion matches the literal `job_lines:` preference prefix and ignores non-array JSON. Job-line resolution caches rows per request, charges raw rows before optional-line filtering, charges cached connection accesses and search/filter work, and invalidates the cache after mutations. Repeated task completion preserves the original completion timestamp and repairs missing timestamps.

Four regression groups (`Astra 84`–`Astra 87`) immediately follow Astra 83 in `test/graphql-rails-api.test.js`. Coordinator-reported verification: **130/130 automated tests pass (`130 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The 126/126 result below is historical. The supplied collaboration snapshot is CLEAR; fleet decision logging remains outstanding.

### Previous repairs: Astra 79–83 — 2026-10-27

Internal job preferences require jobs read permission for reads and jobs write permission for generic preference mutations, in addition to existing preference authorization. Astra 79 checks POST/PATCH/PUT/DELETE and renames return 403 without changing preferences when jobs write is denied, then reads and updates return 200 after jobs read/write are restored. Authorized deletion remains supported for Astra 63's legacy-options fallback. Catalog deletion detaches stored job-line references transactionally, and invoice generation independently drops missing or cross-tenant catalog references. Zero-total converted quotes retain inherited tax/discount options. Line-item booleans accept only `true`, `false`, `1` or `0`. Connection pagination flags now describe truncation within the cursor-bounded window.

Five regression groups (`Astra 79`–`Astra 83`) immediately follow Astra 78 in `test/graphql-rails-api.test.js`. Coordinator-reported verification: **126/126 automated tests pass (`126 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The prior 121/121 result below is historical. The supplied collaboration snapshot for this authorization correction is `CLEAR`; collaboration claims remain with the Coordinator.

### Previous repairs: Astra 76–78 — 2026-10-27

Mutation execution now charges recursive input traversal, hydrated job lines and normalized items before dispatch. Node lookups resolve line items, assessments, email and namespaced user/client phones with tenant scoping and authorization; Node introspection and conflict validation include every supported concrete type. Job/request edits accept camelCase and snake_case work-order/work-request ID aliases. Three regression groups immediately follow Astra 75, bringing the suite total to 121 tests. Coordinator-reported verification: **121/121 automated tests pass (`121 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The earlier 118/118 result below is historical.

### Previous repairs: Astra 72–75 — 2026-10-27

Fixed quote-option hydration to require matching active-line totals, invalidated costing/role caches after mutation writes, validated job calculation options without line items before persistence, and preserved explicitly empty job lines during invoicing. Four regression groups (`Astra 72` through `Astra 75`) immediately follow Astra 71. Coordinator-reported verification: **118/118 automated tests pass (`118 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this documentation-update session. The earlier 114-test verification below is historical.

### Previous repairs: Astra 68–71 — 2026-10-27

Added costing scan budgets and request-local alias caching, duplicate-variable rejection and bounded input/default validation, quote-backed job pricing hydration through edits and invoicing, and atomic job-line validation including tenant-scoped catalog references. Four regression groups follow Astra 67 in `test/graphql-rails-api.test.js`. Full validation runs in `storeJobLines` before persistence; `normalizeInput` permits ID-only line items for Astra 33's standalone GID round trip. Coordinator-reported verification: **114/114 automated tests pass (`114 pass, 0 fail`)** and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). These results are recorded as supplied for this update; tests and syntax checks were not rerun in this implementation session. Earlier verified counts below are historical.

### Astra 6 API repairs — 2026-10-27

All nine reported defects have source fixes and nine named regression groups: inherited fixed monetary types on edits; recursive selection-shape validation before execution; fatal execution budgets; omitted optional variables; distinct quote/fallback line IDs; grant-capacity rotation; transactional token issuance; cookie CSRF with ignored headers; and separate visit instructions/completion notes. Array projection is sequential so a fatal budget error stops remaining work. The earlier 43-test result predates these repairs. The Coordinator executed `npm test` and verified **52/52 automated tests pass (`52 pass, 0 fail`)**, including all nine Astra regression groups (`Astra 1` through `Astra 9`) in `test/graphql-rails-api.test.js`. All `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session. Official-schema parity and full GraphQL coercion remain outside this repair's verified scope.

### Astra 6 follow-up API repairs — 2026-10-27

Nine additional fixes and regression groups (`Astra 10`–`Astra 18`) cover registered OAuth redirect allowlists, pre-execution alias conflicts (including merged and abstract selections), strict monetary/numeric inputs, shared login/password-grant throttling (30 attempts per IP per minute), partial client names, property tax overrides, authoritative client portal URLs, schedule interface fragments, and complete assessment fields. Redirecting public clients must configure `redirectUris` even without a client secret. The Coordinator executed `npm test` and verified **61/61 automated tests pass (`61 pass, 0 fail`)**, including all 18 Astra regression groups (`Astra 1` through `Astra 18`) in `test/graphql-rails-api.test.js`. All 18/18 `.js` files pass `node --check` (`ALL_SYNTAX_OK`). This records the Coordinator's verified result; tests were not rerun in this documentation-update session.

### Astra 6 follow-up repairs (Astra 19–24) — 2026-10-27

Six additional repairs cover null/legacy billing addresses, authoritative invoice-credit payloads, write-only mutation selections with pre-dispatch entity-read authorization, compatible fragment validation before writes, refresh-grant cleanup for revoked/missing/expired sessions (including immediate logout revocation), and order-independent argument comparison. Six named regression groups were added. The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **67/67 automated tests pass (`67 pass, 0 fail`)**, including `Astra 1` through `Astra 24` in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session.

The subsequent auth sweep optimization checks only in-memory expiration on each request. Non-refresh exchanges at the 10,000-grant limit prune inactive session grants using one batch session query and a `Set` before enforcing capacity, removing the per-grant SQLite query loop. Refresh exchanges delete the submitted refresh grant and return `Invalid refresh token` (400) when the user is inactive or missing, the linked session is missing, or it is explicitly revoked (expiry at or before the Unix epoch). Natural access-token expiry does not invalidate the 30-day refresh grant. Capacity pruning joins active users and non-revoked sessions in one batch query. The recorded Coordinator result of **67/67 automated tests pass (`67 pass, 0 fail`)** predates the following repairs.

### Astra 6 follow-up repairs (Astra 25–30) — 2026-10-27

Implemented allowlisted search and protected-column filter rejection, recursive variable/list validation and strict contact/line-item input shapes, refresh after natural access expiry, disabled-user grant pruning, typed relationship IDs, and prototype-safe response aliases. Added six named regression groups (`Astra 25`–`Astra 30`). After these repairs, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **73/73 automated tests pass (`73 pass, 0 fail`)**, including all 30 Astra regression groups (`Astra 1` through `Astra 30`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this documentation-update session.

### Astra 6 follow-up repairs (Astra 31–37) — 2026-10-27

Seven additional regression groups in `test/graphql-rails-api.test.js` cover shared-input validation memoization and bounded abstract conflict traversal (Astra 31), typed entity ID aliases before refund dispatch (Astra 32), concrete line-item ID round trips (Astra 33), refresh identity following the linked session user/workspace (Astra 34), task timestamp persistence and scheduled-item projection (Astra 35), persistent assessment instructions (Astra 36), and phone fields plus nested introspection (Astra 37). The Astra 33 create input now supplies `title` only to `quoteCreate` and `subject` only to `invoiceCreate`.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **80/80 automated tests pass (`80 pass, 0 fail`)**, including all 37 Astra regression groups (`Astra 1` through `Astra 37`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. Earlier passing counts are historical and predate this batch.

### Astra 6 follow-up repairs (Astra 38–42) — 2026-10-27

Five additional regression groups in `test/graphql-rails-api.test.js` cover origin and CSRF checks for login/bootstrap and cookie-authenticated writes (Astra 38), task timestamps preserving seconds, fractional seconds, offsets and overnight dates (Astra 39), order-independent client lead/archive flags with unrelated status preservation (Astra 40), custom string and numeric document numbers with ID fallback (Astra 41), and connection scan-cost accounting, lazy mapping and selected user-role caching (Astra 42).

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **85/85 automated tests pass (`85 pass, 0 fail`)**, including all 42 Astra regression groups (`Astra 1` through `Astra 42`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this documentation-update session. Earlier passing counts are historical and predate this batch.

### Astra 6 follow-up repairs (Astra 43–46) — 2026-10-27

Four additional regression groups in `test/graphql-rails-api.test.js` cover lazy Request read authorization for scheduled assessment instructions and fallback notes (Astra 43), assigned-user ID lookups and lookup-cost accounting independent of unrelated users (Astra 44), null task/visit timestamps without corrupted dates (Astra 45), and distinct stable user/client phone ID namespaces (Astra 46). Astra 44's SQL assertion accepts both `id = ?` and `id IS ?`, matching the latter generated by `repository.list("users", { id })`.

The Coordinator executed `node --check` on all 18 `.js` files (`ALL_SYNTAX_OK`) and `npm test`, verifying **89/89 automated tests pass (`89 pass, 0 fail`)**, including all 46 Astra regression groups (`Astra 1` through `Astra 46`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests were not rerun in this implementation session. Earlier passing counts are historical and predate this batch.

### Astra 6 follow-up repairs (Astra 47–51) — 2026-10-27

Five additional regression groups in `test/graphql-rails-api.test.js` cover:

- **Astra 47:** structural argument equality (`argsEqual`) with memoized reference-pair caching (`WeakMap`), so shared large variables compare in O(1) without JSON serialization (`reads === 0`), while nested conflicting arguments are still detected.
- **Astra 48:** list-element-aware result-depth validation (`listFields`) in `validate()`, rejecting deeply nested list selections before mutation dispatch (`paymentRecordCreate`).
- **Astra 49:** Job line-item calculation and storage across `jobCreate`, `jobEdit`, `PATCH /api/jobs/:id`, and `Job.lineItems` reads, including clearing with `lineItems: []`. Totals are calculated before stripping calculation-only discount/deposit/`taxRate` inputs (`tax_rate`, `discount_type`, `discount_value`, `required_deposit_type`, `required_deposit_value`); jobs persist `subtotal_cents`, `tax_cents` and `total_cents`, not those inputs.
- **Astra 50:** the `timeEntryId` target ID alias on `timeSheetClockOut` and the `paymentId` target ID alias on `paymentRefund`.
- **Astra 51:** `productOrServiceId` and `serviceId` Global ID normalization on catalog edits and quote/invoice line items, `workRequestId` / `workOrderId` normalization, and Invoice `title` → `subject` normalization.

Astra 47–51 have been moved unchanged from the top of the test file to immediately after Astra 46 and before the Rails JSON adapters test, keeping Astra 1 through Astra 51 in sequential order. Astra 31 now permits at most one shared-input property read, including zero when `Object.is` short-circuits identical `$input` references.

The Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **94/94 automated tests pass (`94 pass, 0 fail`)**, including all 51 Astra regression groups (`Astra 1` through `Astra 51`) in `test/graphql-rails-api.test.js`. The Coordinator confirmed the collaboration gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`. These are Coordinator-reported results; commands and tests were not rerun in this documentation/reordering session. The injected collaboration snapshot still reports `INSPECTION_INCOMPLETE` (unable to open database file); that conflicting snapshot is reported to the Coordinator, not treated as an independent CLEAR inspection. Earlier counts remain historical.

### Astra 6 follow-up repairs (Astra 52–55) — 2026-10-27

- **Astra 52:** Job line items persist in SQLite `preferences` across database close/reopen, retaining IDs and totals. Job creation/editing and line storage share a transaction; deleting a job removes its stored lines.
- **Astra 53:** Supplied job subtotals, tax and totals must match calculated line items. Direct cent inputs must be nonnegative safe integers; rejected creates/edits leave jobs unchanged.
- **Astra 54:** A persistent cross-organization sequence allocates distinct job line IDs above existing fallback IDs. Edits preserve only the same job's own IDs, allocating fresh IDs for foreign or duplicate inputs and retaining the sequence after deletion.
- **Astra 55:** BigInt decimal half-up conversion rounds string and numeric `1.005` / `16.075` to 101 / 1608 cents for unit prices, fixed discounts and fixed deposits.

GraphQL sends normalized job items and calculation options through the REST router; calculation-only fields are stripped there before writing job columns, keeping totals and line storage atomic. These four new regression groups were added after Astra 51 and before the Rails JSON adapters test. After implementing Astra 52 through Astra 55, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **98/98 automated tests pass (`98 pass, 0 fail`)**, including all 55 Astra regression groups (`Astra 1` through `Astra 55`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests and syntax checks were not rerun in this Read/Edit-only documentation-update session. The prior 94-test Coordinator result is historical.

### Astra 6 follow-up repairs (Astra 56–61) — 2026-10-27

- **Astra 56:** Membership filters precompute Sets once, charging each operand and row match to the execution budget; search scans are charged too. The regression requires a 25,000-operand filter to stop at cost 20,001 in under 100 ms, and checks valid membership results. Unfiltered query costs are unchanged.
- **Astra 57:** Partial GraphQL and REST job edits reconcile supplied totals and calculation options against persisted lines. Inconsistent totals fail before writes; title edits preserve totals and tax-rate edits recalculate them. PATCH/PUT line replacements remain transactional.
- **Astra 58:** Job invoicing consumes persisted replacement lines ahead of quote fallback, deriving tax from taxable stored lines when no discount applies.
- **Astra 59:** ID filters decode typed Global IDs and legacy IDs after identifying scalar, array, `eq` or `in` operands; wrong-type IDs and unsupported operators are rejected.
- **Astra 60:** Decimal and scientific-notation monetary inputs use direct BigInt digit/scale conversion without intermediate floating-point rounding.
- **Astra 61:** Catalog and expense free-text categories preserve capitalization; timesheet categories still normalize to lowercase.

Six regression tests were added immediately after Astra 55. After implementing Astra 56 through Astra 61, the Coordinator executed `node --check` across all 18 `.js` files (`ALL_SYNTAX_OK`) and executed `npm test`, verifying **104/104 automated tests pass (`104 pass, 0 fail`)**, including all 61 Astra regression groups (`Astra 1` through `Astra 61`) in `test/graphql-rails-api.test.js`. This records the Coordinator's verified result; tests and syntax checks were not rerun in this Read/Edit-only adjustment session. The prior 98-test Coordinator result is historical.

### Astra 6 follow-up repairs (Astra 62–67) — 2026-10-27

- **Astra 62:** Job calculation options persist separately from the unchanged line-array format and merge across partial GraphQL/REST edits; job deletion removes both preferences.
- **Astra 63:** Invoices reuse matching stored options, with pro-rata taxable discounts for legacy jobs without options.
- **Astra 64:** Job line projections and invoices exclude unselected optional items, including jobs with only unselected items.
- **Astra 65:** Monetary conversion bounds BigInt work for extreme exponents and long significands while retaining half-up rounding.
- **Astra 66:** CamelCase and snake_case filters preserve SQL null for scalar, array, eq and in matching.
- **Astra 67:** Login throttling stops expiry scans at the first live entry and caps the map at 10,000 entries.

Six regression groups now follow Astra 61, before Rails JSON adapters. Astra 67 explicitly restores `Date.now` and `Map.prototype[Symbol.iterator]` in `finally`, avoiding Symbol-key mock-restoration corruption in subsequent tests. Coordinator-reported verification: **110/110 automated tests pass (`110 pass, 0 fail`)**, including Astra 1–67, and **18/18 JavaScript syntax checks pass** (`node --check`, `ALL_SYNTAX_OK`). Tests and syntax checks were not rerun in this implementation session. The previous 104/104 result above is historical.

## Documentation

- [Reference analysis](docs/REFERENCE_ANALYSIS.md), [screen inventory](docs/SCREEN_INVENTORY.md), [feature inventory](docs/FEATURE_INVENTORY.md)
- [Routes](docs/ROUTE_MAP.md), [workflows](docs/WORKFLOW_MAP.md)
- [Database](docs/DATABASE_SCHEMA.md), [architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md), [execution progress](docs/EXECUTION_PROGRESS.md)
- [Visual audit](docs/VISUAL_FIDELITY_AUDIT.md), [functional audit](docs/FUNCTIONAL_AUDIT.md), [known limitations](docs/KNOWN_LIMITATIONS.md)

Round 5 browser evidence is recorded in [the comparison report](docs/VISUAL_COMPARISON_ROUND_5.md) and its four comparison sheets. Reference assets remain in `docs/round2_live_assets/` and `screenshots/reference/`. Home, Clients, Quotes, Expenses and Timesheets captures were refreshed; the other six captures were retained and their views rechecked. Comparison Sheets 1 and 2 were regenerated; Sheets 3 and 4 are unchanged. These checks establish the documented layout/content results, not pixel parity.
