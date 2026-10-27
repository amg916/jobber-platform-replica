# Phase 1 backend

## Runtime

Node.js 24 built-in modules only. No dependencies or install step.

```sh
npm test
npm start
```

The default server binds to `127.0.0.1:3000` and creates `jobber.sqlite`. Set `DB_PATH` for a different file. Tests use isolated in-memory databases.

Demo accounts use the password `greenleaf-demo-2026`; set `DEMO_PASSWORD` before the initial database seed to override it. Accounts: `jscustomtilepros@gmail.com`, `dispatcher@greenleaf.example`, `technician@greenleaf.example`, `limited@greenleaf.example`, and owner/dispatcher/technician/limited accounts at `apex.example`. Login requires email, password, and optionally organization_id (defaults to 1).

Send the returned session token as `Authorization: Bearer <token>`. The standalone demo server enables bootstrap and user/organization switching. Servers supplied an explicit database retain the disabled default unless `allowDemoSwitch: true` is supplied. Switching requires settings-write permission. `POST /api/auth/bootstrap` creates a demo owner session; `/login` retains explicit login and logout support.

## Structure

- `src/db/schema.js`: forty entity definitions, strict tables, enum checks, composite tenant foreign keys, indexes.
- `src/db/database.js`: database creation, synchronous savepoint transactions, tenant repository, password hashing.
- `src/db/seed.js`: two organizations and realistic operational fixtures.
- `src/services/calculations.js`: decimal-to-integer calculations, documents, costing and invoice reconciliation.
- `src/services/recurrence.js`: recurring visit materialization, appointments and team conflicts.
- `src/services/automations.js`: durable queued executions, conditions, actions, retry backoff and idempotency.
- `src/services/workflows.js`: business transitions, booking, collections, dispatch and communication.
- `src/services/pdf.js`: paginated PDF generation and CSV parsing/import/export.
- `src/server.js`: HTTP API, authentication, permissions, reports and background processing.
- `test/backend.test.js`: financial, workflow, recurrence, automation, security and HTTP tests.

## Operational semantics

Payments and refunds are local sandbox ledger entries, not processor requests. Outbound messages have `test_mode` status and do not claim delivery. Integration connections are sandbox records. Receptionist, estimator, routing and follow-up endpoints use deterministic local logic rather than external models or APIs.

Money fields are integer cents. Fixed discounts and deposits are expressed in cents; percent values use percentage points. Scheduling currently accepts UTC timestamps. Recurrence dates are materialized at the job's UTC start time. Day-of-month recurrence clamps to the last available day in shorter months.

Transactions must be synchronous. Tenant repositories scope records to an organization, and composite foreign keys reject cross-organization references. Client Hub tokens authorize customer-specific actions rather than staff authentication.

## Verification and remaining scope

The implementation has **not been executed or verified** in the authoring session: the command runner required approval for both the seed smoke test and `npm test`. No passing-test claim is made.

This is not yet a complete Phase 1 delivery. Known remaining work includes:

- Booking business-hours and per-user availability enforcement; timezone-aware recurrence and booking reschedule/cancel flows.
- Automatic recurring invoice creation from completed visits; fuller billing state transitions and credit/adjustment support.
- Document editing/line-item mutation endpoints beyond initial creation and optional quote toggles.
- Permissions-management endpoints and complete per-role dispatch/self-timesheet behavior.
- Full polymorphic-reference validation, same-client relationship validation and field-level API hardening.
- Portal request creation, document downloads, broader profile updates and expanded end-to-end HTTP payment tests.
- Receptionist booking orchestration and persisted editable Labs flags.
- Expanded reporting aggregation and full date-filter consistency.
- CSV export/import schema symmetry, detailed timeline redaction by permission and broad malformed-input tests.
- File-backed persistence/restart, worker concurrency and additional database failure-path tests.

Run the suite after approving command execution, address failures, and finish the remaining scope before treating this backend as production-ready.
