# Architecture

## Runtime

One Node.js 24 process serves HTTP and a browser SPA. There is no dependency installation, transpilation, bundler, framework or third-party runtime package. `src/server.js` provides routing, JSON parsing, sessions, authorization, static files and the periodic automation worker. It binds loopback by default.

## Layers

- `src/db/schema.js`: strict table declarations and indexes.
- `src/db/database.js`: database construction, repository operations, hashing, validation and transaction/savepoint support.
- `src/db/seed.js`: reproducible initial reference and secondary-organization fixtures.
- `src/services/workflows.js`: entity lifecycle and financial operations.
- `calculations.js`, `recurrence.js`, `availability.js`, `automations.js`, `workspace.js`, `pdf.js`: focused arithmetic, calendar, workflow and output helpers.
- `src/public/index.html`: shell and exact inline brand template.
- `src/public/app.js`: API wrapper, route renderers, event delegation, editors and overlays.
- `styles.css`: base styling; `parity.css`: reference-specific geometry, images and responsive overrides.

## State and error handling

The browser holds session token, active route, fetched clients/team and local tab/filter state. Persisted settings use API writes. Render generation prevents an old asynchronous view replacing a newer route. API errors appear in form errors/toasts. Session tokens are stored in sessionStorage. No merge mutation is performed until server-side tenant checks and the transaction succeed.

The merge endpoint enumerates schema-declared client_id relationships and transfers them within the same organization, plus client-scoped polymorphic references. Source archival preserves the original record. Generic resource writes continue to use repository field validation and protected-field restrictions.

## Assets and delivery

Captured SVG/WebP files remain under docs/round2_live_assets and are served only through constrained asset names. The logo is also embedded in HTML to avoid a fetched header mark. Reference icons are generated from the preserved Round 1 DOM capture. The application is therefore independent of live Jobber CDN availability.

## Deployment boundary

This task edits local source only. No server files, deployment pipeline, commits, pushes or fleet configuration were changed. Development startup enables demo bootstrap; use explicit createApp/startServer options and appropriate deployment authentication before exposing a service. Production hosting and external provider integration are outside this round.
