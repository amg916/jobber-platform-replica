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

Tests use independent in-memory databases and ephemeral HTTP ports. Coverage includes exact-cent fixtures, asset GET/HEAD responses, merge isolation, and a Round 5 regression asserting clients 1–6 retain `2026-10-13`, `2026-09-22`, `2026-08-13`, `2026-08-01`, `2026-08-01`, `2026-07-24` after `workflows(db, 1).overdue()`. Final-fix crop regeneration, syntax checks and `npm test` were blocked by command approval; no passing suite is claimed.

The recorded Round 5 browser run captured eleven views with zero console errors and zero uncaught page exceptions after clearing a stale session token, but failed Last Activity verification in the existing database. The reconciliation fix prevents unchanged balances from resetting activity timestamps; it does not repair already-overwritten dates. Fresh-database browser verification and regenerated-crop captures remain pending.

## Functionality

Client management and transactional merging; request → quote → job → invoice workflows; scheduling; payments and refunds in a local sandbox; time logging and period approval preferences; expenses; campaign/template management; reports and CSV/PDF output; settings, Client Hub and public booking. External delivery, payment processing and integrations remain simulations.

## Documentation

- [Reference analysis](docs/REFERENCE_ANALYSIS.md), [screen inventory](docs/SCREEN_INVENTORY.md), [feature inventory](docs/FEATURE_INVENTORY.md)
- [Routes](docs/ROUTE_MAP.md), [workflows](docs/WORKFLOW_MAP.md)
- [Database](docs/DATABASE_SCHEMA.md), [architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md), [execution progress](docs/EXECUTION_PROGRESS.md)
- [Visual audit](docs/VISUAL_FIDELITY_AUDIT.md), [functional audit](docs/FUNCTIONAL_AUDIT.md), [known limitations](docs/KNOWN_LIMITATIONS.md)

Round 5 browser evidence is recorded in [the comparison report](docs/VISUAL_COMPARISON_ROUND_5.md) and its four comparison sheets. Reference assets remain in `docs/round2_live_assets/` and `screenshots/reference/`. The eleven Round 5 captures in `screenshots/replica/` predate these final reconciliation and crop fixes and do not verify them.
