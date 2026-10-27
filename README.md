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

The new workspace contains 95 clients, 3 requests, 3 quotes, 5 late jobs, 4 invoices, 15 expenses and 4 subscription payments. Organization 2 is an isolated HVAC demo. Demo switching is not a production authentication mode.

## Verification

```sh
python3 docs/crop_round5_assets.py # requires Pillow; regenerates the five JPEGs
find . -type f -name '*.js' -not -path './node_modules/*' -not -path './.git/*' -exec sh -c 'for file do node --check "$file" || exit; done' sh {} +
npm test
```

Tests use independent in-memory databases and ephemeral HTTP ports. Coverage includes exact-cent fixtures, asset GET/HEAD responses, merge isolation, and a Round 5 regression asserting clients 1–6 retain `2026-10-13`, `2026-09-22`, `2026-08-13`, `2026-08-01`, `2026-08-01`, `2026-07-24` after `workflows(db, 1).overdue()`. All 13 Astra technical fixes are implemented, with individually named regression tests in `test/round5.test.js` covering workflows, HTTP permissions and mutations, and DOM handlers. The Coordinator regenerated all 5 cropped JPEGs with `docs/crop_round5_assets.py` and confirmed all 15 `.js` files pass `node --check`. The Coordinator executed `npm test` and verified **35/35 automated tests pass (`35 pass, 0 fail`)**. This records the Coordinator's verified result; tests were not rerun in this implementation session. The Astra 6 follow-up fixes cover line-derived invoice totals, decimal number inputs, explicit deposit removal, preservation of invoice payment terms during direct and pipeline issuance, and legacy visit occurrence backfilling during migration, rescheduling and recurrence generation. Astra 11/12 now cover `net_15`/`upon_receipt` due dates and regeneration without duplicate migrated visits. Automatic partial billing keeps jobs active and visible in Active Job while scheduled or unscheduled visits remain; jobs complete only when all visits are completed or cancelled. Astra 11 additionally covers explicit visit A billing followed by automatic B/C billing at 6500 cents each. After this automatic partial-billing fix and latest regression assertion, the Coordinator ran `node --check` (15/15 `.js` files passed; `ALL_SYNTAX_OK`) and `npm test`, verifying **35/35 automated tests pass (`35 pass, 0 fail`)**, including the latest Astra 11 partial-billing regression assertion. The Coordinator also confirmed the collaboration gate is `CLEAR` for session `67f5485c-2be4-4dbc-b946-53007b681475`.

The updated Round 5 browser report records **11/11 checks passed**, with zero console errors and zero uncaught page exceptions after clearing session/local storage and reloading with cache disabled. The first six Clients Last Activity dates are **Oct 13, Sep 22, Aug 13, Aug 1, Aug 1, and Jul 24**, in that order. The reconciliation fix prevents unchanged balances from resetting activity timestamps; it does not repair already-overwritten dates.

## Functionality

Client management and transactional merging; request → quote → job → invoice workflows; scheduling; payments and refunds in a local sandbox; time logging and period approval preferences; expenses; campaign/template management; reports and CSV/PDF output; settings, Client Hub and public booking. External delivery, payment processing and integrations remain simulations.

## Documentation

- [Reference analysis](docs/REFERENCE_ANALYSIS.md), [screen inventory](docs/SCREEN_INVENTORY.md), [feature inventory](docs/FEATURE_INVENTORY.md)
- [Routes](docs/ROUTE_MAP.md), [workflows](docs/WORKFLOW_MAP.md)
- [Database](docs/DATABASE_SCHEMA.md), [architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md), [execution progress](docs/EXECUTION_PROGRESS.md)
- [Visual audit](docs/VISUAL_FIDELITY_AUDIT.md), [functional audit](docs/FUNCTIONAL_AUDIT.md), [known limitations](docs/KNOWN_LIMITATIONS.md)

Round 5 browser evidence is recorded in [the comparison report](docs/VISUAL_COMPARISON_ROUND_5.md) and its four comparison sheets. Reference assets remain in `docs/round2_live_assets/` and `screenshots/reference/`. Home, Clients, Quotes, Expenses and Timesheets captures were refreshed; the other six captures were retained and their views rechecked. Comparison Sheets 1 and 2 were regenerated; Sheets 3 and 4 are unchanged. These checks establish the documented layout/content results, not pixel parity.
