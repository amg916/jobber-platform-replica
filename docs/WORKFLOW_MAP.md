# Workflow map

## Work lifecycle

1. Create a client from Create or Clients; optionally add properties and contact details.
2. Create a request; schedule an assessment or convert it to a quote/job.
3. Build a quote with line items, tax, discount and deposit; send through the sandbox, approve or request changes, then convert to a job.
4. Assign a job and create visits. Use Schedule day/week/month navigation or drag a visit to reschedule it.
5. Complete work and generate an invoice. Issue it, apply deposits, record payments or create credits. PDF output and detail drawers expose the record.

The service layer, not browser arithmetic, governs document amounts and accounting changes.

## Duplicate client workflow

Clients → Merge Clients → select retained profile and duplicate → Save. The endpoint checks both records in the active organization, rejects identical/archived profiles, transfers relationships in one SQLite transaction, combines balances/notes and archives the source. It does not remove records. The browser reloads clients and the current list after success. There is no built-in merge undo; source notes retain the destination ID.

## Time and payroll

Timesheets → choose period and Day/Week → expand employee → Add Time or start/stop Timer. Approve timesheets presents employee totals and persisted approval switches. Confirm payroll presents hours/approval states, a period confirmation preference and CSV export. These are local review controls; confirmation is not a bank or payroll provider operation.

## Marketing

Dashboard actions open campaign creation, review automation or referrals. Email Campaigns exposes the existing manager and template navigation. Performance renders stored campaign counts. Sending a campaign invokes the sandbox workflow, not external email transport.

## Settings and communication

Company Edit enables the main fields; Save writes settings. Client Hub toggles write preferences. Requests and Bookings can save a named form and open/copy the shared booking surface. Account history Receipt opens persisted billing details. Notifications switches Mentions/Activity; message center can reveal conversations and filter by client/phone plus channel.

## Reports and exports

Select a report → fetch mapped resource/report endpoint → inspect table → optionally filter dates → export CSV. Report mapping is intentionally explicit in app.js; shared endpoints are documented as limitations rather than claiming live-provider semantics.
