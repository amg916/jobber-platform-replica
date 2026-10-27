# Implementation status — 2026-10-26

## Added in this implementation session

- Optional SQLite bindings normalize undefined to null; invalid numeric bindings fail explicitly.
- Booking validates organization-local business hours, employee availability, service availability, and conflicts before atomic client/request/job/visit creation.
- J S Custom Tile organization, named team, six reference clients, request titles, expense names, and timer notifications in the fresh seed.
- Static workspace assets and standalone demo authentication bootstrap.
- Pipeline grouping and supported conversion transitions, bookkeeping summary/categorization/sandbox sync, account billing metadata, permissions endpoints, draft document line-item editing, invoice credits, and time-entry editing.
- Browser shell and data-backed home, entity lists/builders/details, weekly calendar, timesheets, pipeline, bookkeeping, reports, marketing, receptionist, settings, client portal, and public booking views.
- Regression tests for optional bindings, local business hours/availability, bootstrap/static HTTP assets, document editing, and tenant switching.

## Verification status

The attempted `node --test` execution returned **This command requires approval**. Neither the original nor expanded suite has been run in this session. No syntax, passing-test, browser-render, accessibility, or pixel-fidelity claim is made. Reference JPEG reads produced no visible image content in this session. No external packages were installed. Reference screenshots were not changed.

## Remaining requested scope

This is a partial implementation, not the complete 1:1 replica requested. Outstanding work includes:

- Execute syntax checks and all tests, fix failures, launch the actual browser, and compare every screen with viewable references.
- Reference billing receipt dates/amounts and exact home financial totals (the supplied textual amounts are truncated); subscription payment fixtures remain empty rather than invented.
- Exact seeded invoice/status totals; current fixtures retain previous rich financial scenarios. Several legacy lawn-care catalog names remain.
- Full lifecycle-safe DELETE behavior for documents and related entities, complete job/checklist/recurrence builders, advanced line-item options, self-service role permissions and safe role switching back from restricted users.
- Full calendar navigation, month/day/map views, filters, drag-rescheduling, assessments/tasks, team selectors, and unscheduled management.
- UI controls currently explicitly marked not implemented: previous/next week, generic date filter, subscription change, product updates, language, rewards, and unscheduled drawer.
- Full Client 360 notes/attachments/tags/custom fields editing and duplicate merge; nested generic settings CRUD and permissions-matrix UI.
- Marketing tabs/reviews functionality, SMS thread conversation interface, persistent notification preferences and meaningful unread counts.
- Receptionist booking orchestration, full signature storage, portal PDF download, profile edits, automatic recurring invoicing, timezone-aware recurrence, booking reschedule/cancel flows.
- Complete report-specific queries, aggregation and consistent date filtering rather than reused generic entity tables.
- Dashboard statistics, timesheet tabs and settings previews need full interaction and reference-fidelity work; CSS icons and graphics are approximations.
- Server-side polymorphic reference validation, same-client relationship validation, restricted-user timeline redaction, and expanded malformed-input coverage remain from BACKEND.md.

Existing file-backed databases are not destructively reseeded. The new organization website column is migrated additively; reference fixture changes apply to newly seeded databases only.

## Commands pending approval

```sh
node --check src/server.js
node --check src/public/app.js
node --test
node src/server.js
```
