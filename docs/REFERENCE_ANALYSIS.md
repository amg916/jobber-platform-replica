# Reference analysis

## Evidence and target

Round 3 uses `VISUAL_COMPARISON_ROUND_2.md` (2026-10-27), the captured asset manifest and original artwork in `round2_live_assets/`, and the 19 reference JPEGs. The target viewport is 1523 × 832 CSS pixels. Round 2 measured a 60px header, 188px sidebar, workspace beginning at x=189, and 320 × 40 search field. These shell dimensions are retained.

The reference Home screenshot is dated Monday, October 26; later live inspection showed October 27. The replica intentionally retains the screenshot date. Client activity labels Today and 6 minutes ago are presentation fixtures for the two reference records; other activity dates are formatted from storage.

## Brand and assets

The exact emblem path is stored in the HTML brand template and inserted inline into the header. Its 50 × 50 viewBox is rendered at 30 × 30 inside a 56 × 60 container, x=16/y=15, in #032B3A. The server exposes a constrained `/assets/<name>.svg|webp` route with MIME types and HEAD support. Unknown assets return 404.

Home uses `home_keys_to_growth.webp`, `home_truck.webp`, and `home_card_close.svg`; Clients uses `clients_merge.webp`; Requests uses `requests_track_client_request.webp`, `requests_torn_edge.svg`, and `requests_card_close.svg`. These are local captured files, not approximate redrawn illustrations or runtime CDN dependencies.

## Financial evidence

All stored values are integer cents. Quotes total 14,091,500; jobs 23,218,500; invoice totals 14,377,750; invoice open balance 14,265,000. Past due is 13,250,000, distinct from open balance because draft invoices contribute 1,015,000 to open balance. The paid invoice is 112,750 with zero balance. Home displays $232.2k active jobs, $132.5k past due and $10.2k drafts; Business performance displays $132,500.

## Interpretation boundaries

The 15 expense titles are specified fixtures with realistic amounts/dates, not a transcription of all reference receipt values. Font families use existing CSS fallbacks; exact proprietary font files are not included. Report categories reproduce the requested navigation, but several reports share underlying resource tables rather than proprietary report calculations. Pixel-perfect status requires new screenshots and measurement; source changes alone cannot establish it.
