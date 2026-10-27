# Round 3 implementation plan

## Scope and sequence

1. Read Round 2 comparison, asset manifest, source and schema. Preserve the supplied same-color collaboration clearance; do not run interactive claim commands.
2. Add safe SVG/WebP serving and exact inline emblem; replace three promotional illustrations.
3. Correct reference client statuses/contacts, quote/job/invoice cents, add 15 expenses and four billing rows. Preserve the existing database.
4. Correct status overview markup and Home money/geometry. Add compact client rows and selection controls; place Quotes banner below heading.
5. Rebuild Marketing, Reports, Expenses, Timesheets and settings layouts around the specified hierarchy. Keep existing editors and API-backed workflows accessible.
6. Connect merge, tabs, filters, billing receipts and review controls to actual local behavior.
7. Add fixture, asset and merge tests; write all twelve specification/audit documents and root README.
8. Coordinator runs syntax checks/tests and a fresh-database browser comparison. Only after full local verification should the single final external audit run.

## Acceptance criteria

- Node 24 built-ins only; no dependencies or build tooling added.
- Captured logo/artwork served locally and used by the matching screens.
- Monetary totals match exact cents, with separate past-due and open-balance semantics.
- Every requested report navigates to a table; campaign/template tools remain reachable.
- New interactions save state or produce a meaningful local result; simulated external operations are accurately documented.
- No existing data or peer changes are discarded.
- Verification claims distinguish implemented source, automated test outcomes and browser evidence.

## Pending acceptance work

The implementation session could not execute `node --check` because command approval was required. Test execution, rendered measurements, screenshot comparison and final audit remain Coordinator tasks. Exact 1:1 parity cannot be certified before these steps. See FUNCTIONAL_AUDIT.md and VISUAL_FIDELITY_AUDIT.md for the checklist.
