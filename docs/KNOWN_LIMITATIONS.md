# Known limitations

## Verification and fidelity

- Syntax/test execution was blocked by command approval; the Coordinator must run the documented checks. Fresh browser captures and direct pixel measurements are pending.
- Exact 1:1 visual parity is not certified. Font fallbacks, promotional cropping, banner copy, toolbar geometry and overlay icon weights may still differ.
- Existing screenshots/replica files are Round 2; do not use them as Round 3 proof.
- Seed changes only apply to a new database. Existing jobber.sqlite is intentionally untouched.

## Reference data

- First six client identities/addresses and financial amounts match the requested fixtures. Remaining client names are synthetic.
- Expense titles are requested fixtures; amounts, job assignments and dates are realistic generated values rather than exact reference transcription.
- Today/6 minutes ago are special presentation labels for two reference records dated 2026-10-26, not a general relative-time engine. Home uses the screenshot's fixed date.
- Initial current schedule and time-entry tables are empty. Marketing weekly summary starts at zero.

## Local product boundaries

- Messaging, payments, accounting sync and AI operations are sandbox/deterministic implementations, not live provider integrations.
- Receipt forwarding has an informational card but no email ingestion service or actual forwarded receipt storage.
- Named request forms persist names but reuse the public booking page; a full field-by-field form designer is not provided.
- Approval/payroll switches persist preferences but do not lock time entries, enforce an approval state machine or submit payroll.
- Client Hub switches save settings; not all options are reflected in portal behavior.
- Merging archives the source and moves relationships atomically, but has no undo flow. Source portal tokens do not automatically redirect to the retained client. Merge should be exercised on disposable fixture records during testing.
- Clients supports Name/Last Activity sorting; other list columns do not have a general sorting engine.
- Reports open real local tables. Job-type and bad-debt reports filter their source data; taxation projects invoice tax fields. Payouts still shares payments and salesperson performance uses quote conversion without salesperson attribution. These are not full specialized reporting engines.
- Existing subscription/rewards/product-update controls do not perform live subscription or promotional enrollment operations. Dark mode is a local visual toggle, not a fully audited dark-theme design system.

## Delivery

No commits, pushes, deployment, server edits, database reset or final external audit occurred. Coordinator owns test execution, final visual acceptance, collaboration release and any later fleet logging/delivery.
