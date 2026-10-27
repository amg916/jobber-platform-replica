# Visual Comparison — Round 2

Date: 2026-10-27  
Replica: `http://127.0.0.1:4321`  
Live reference: `https://secure.getjobber.com`  
Reference viewport: 1523 × 832 CSS px, DPR 2

## Capture and inspection record

All 19 requested replica views were freshly captured as JPEGs in `screenshots/replica/`. The 19 matching files in `screenshots/reference/` were paired and visually reviewed. Both sets contain the requested names, and all 38 files are 1523 × 832 pixels. The replica images represent the page or overlay named by each file.

The live Home, Quotes, Jobs, Invoices, Clients and Requests views were inspected in the existing signed-in Chrome session. The logo and promotion source DOM were inspected in the live tab’s attached DevTools. Chrome owns the listener on `127.0.0.1:9222`; its standard HTTP JSON discovery paths returned HTTP 404, so I used the attached live-tab DevTools session for page inspection. The local DOM measurements below were taken at the same viewport. The reference styles file from Round 1 supplied the reference element measurements.

The live Home tab showed Tuesday, October 27; the screenshot references and the replica’s dated content show Monday, October 26. This is a time-sensitive content difference, not a viewport shift.

## Shared shell and measured DOM

The replica shell is now close to the reference geometry: header is x=0, y=0, 1523 × 60; sidebar is x=0, y=60, 188 × 772; global search is x=975, y=9.5, 320 × 40; and Create is x=8, y=60, 172 × 40. Reference measurements are header 1523 × 60, sidebar width 188, search x=975/y=10 at 320 × 40 and Create x=8/y=60 at 172 × 40. The replica workspace begins at x=189 and is 1334 px wide; reference is x=189 and 1333 px wide. Shell background, search fill, radius, sidebar width, and main content left edge visually align closely. A few header/navigation glyph silhouettes and stroke weights still differ from the reference even where their boxes align.

Home-specific replica measurements: `.home-head` x=213/y=85, 1286 × 123; title x=213/y=152, 327.5 × 38.9, Jobber Pro/Poppins 36 px, weight 900, rgb(3,43,58); reward card x=1093/y=109, 406 × 105; workflow x=213/y=274, 1286 × 181; lower columns x=213/y=479, 1286 px wide with a 24 px gap. The reference title starts near y=143; its promotion card is x=1157/y=85, 341 × 123; workflow begins around y=300 and its lower content starts materially farther down. The replica title is about 9 px low, the reward is 65 px wider and shifted up-left, and workflow/lower content arrives too early. The local appointments and Marketing Suite split is about 841/421 px; the reference is approximately 917/321 px, with more space between columns.

The top-left live brand mark is not an inline SVG in the header. It is a CSS mask on the Jobber logo element; the mask URL is `https://cdn.jobber.com/yr/logos/v1/logo_jobber_bug.svg`. The exact SVG source and path are preserved in [`round2_live_assets/logo_jobber_bug.svg`](round2_live_assets/logo_jobber_bug.svg). Its viewBox is `0 0 50 50`; the single path has `fill="currentColor"` and `fill-rule="evenodd"`. The live element box is 56 × 60 at x=0/y=0, with the visible emblem near x=16/y=17. The replica still displays a square checkmark logo where the live Jobber emblem belongs.

Live promotional artwork is image-based in two of the three requested cards. Home’s F-150 card uses `/assets_remix/truck-outline-beige-BlCeOD9E.webp` at x=1327/y=99, 194 × 88, plus a 60 × 35 embedded WebP Keys to Growth mark. Clients’ Merge Clients card uses `/assets_remix/clientMergeCard-DThn2WLm.webp` at approximately x=1298/y=157, 149 × 149. Requests’ Track every client request card uses `/assets_remix/FTU%20Image-BL8SxJhc.webp` at 160 × 191, with an inline torn-edge SVG about 11,462 characters long and a close-button SVG. Exact image assets and raw SVG outerHTML are in [`round2_live_assets/`](round2_live_assets/README.json). The F-150 and Merge Clients illustrations are WebP, not SVG. The replica’s truck is a simplified outline and lacks the live giveaway logo; the replica lacks the Merge Clients and Track every client request illustrations.

## Live monetary values

Values below were read from the live page or calculated from the visible live rows. Calculated sums are marked as such.

| Surface | Exact visible values |
| --- | --- |
| Home | Active jobs: 5, `$232.2k` displayed; receivables: `$132,500` exact in the Business Performance card, shown as `$132.5k` in workflow; draft invoices: 1, `$10.2k`; past-due invoices: 2, `$132.5k`. Today’s appointments show `$0` for Total, Active, Completed, Overdue and Remaining. |
| Quotes | Visible quote rows: `$122,200.00`, `$11,275.00`, `$7,440.00`; visible-row sum: `$140,915.00`. Past-30-day Sent and Converted cards each show `$0`; conversion rate is `0%`. |
| Jobs | Visible job rows: `$75,220.00`, `$12,990.00`, `$10,500.00`, `$122,200.00`, `$11,275.00`; visible-row sum: `$232,185.00`, matching Home’s rounded `$232.2k`. Recent visits and visits scheduled each show `$0`. |
| Invoices | Status summaries: Past due `$132.5k`, Sent but not due `$0`, Draft `$10.2k`. Visible invoice totals/balances: `$75,220.00 / $75,220.00`, `$57,280.00 / $57,280.00`, `$10,150.00 / $10,150.00`, `$1,127.50 / $0.00`; visible-row total: `$143,777.50`; visible-row open balance: `$142,650.00`. |

## Screen-by-screen comparison

### 1. Home — `home.jpg`

**Round 2 improvements:** Header and sidebar geometry, search placement, typography, workflow segmentation and status color bars now track the reference. The workflow cards expose Requests, Quotes, Jobs and Invoices; the appointments and Marketing Suite panels are present.

**Remaining differences:** Replace the checkmark with the exact logo asset. Use the live F-150 and Keys to Growth images. The replica’s reward card is too wide and left-shifted; the title and workflow are vertically misaligned; workflow is shorter; appointments start too high; and the main/right column proportions differ. Add the live job and invoice amount callouts inside their workflow cards. Marketing Suite needs the same content depth and panel proportions as the reference. Home financial figures are also different in the replica’s seeded data.

### 2. Schedule — `schedule.jpg`

**Round 2 improvements:** Day, Week and Month controls now sit on one toolbar with filters, map and more actions. The schedule has visible time rows and calendar navigation.

**Remaining differences:** The week grid starts about 23 px above the reference. Column shading, grid contrast, row heights, date header placement and calendar density differ. Align the active-view treatment and toolbar spacing to the reference. The global logo discrepancy remains.

### 3. Clients — `clients.jpg`

**Round 2 improvements:** The duplicate-client Merge card is present, along with Filter by tag and client status controls. The search/table structure and summary area are in place.

**Remaining differences:** Add the live Merge Clients image; the current promotion is largely text. Table header selection/sort affordances are missing or too faint, and local rows are about 70 px tall versus roughly 59 px in the reference. The local table starts higher. Summary counts and client data differ; the same first client is Lead in the reference but Active in the replica. Match status colors, column widths, row density and text baselines.

### 4. Requests — `requests.jpg`

**Round 2 improvements:** The Track every client request heading, copy and action are present, with request summary cards and a filterable table.

**Remaining differences:** Add the live card illustration and torn-edge treatment. Replica stat cards are about 157 px tall versus roughly 192 px in the reference, so the table starts about 60 px too early. Align labels and percentage/period layout in the summary cards. Request names, statuses and dates differ from the reference data.

### 5. Quotes — `quotes.jpg`

**Round 2 improvements:** The overview has five cards including the AI card, a salesperson filter, and quote status summaries.

**Remaining differences:** The reference has a DocuSign promotion below the page heading; the replica shows a Deep Lawn integration strip above the heading and shifts content down. Summary card height, spacing and table start do not align. Quote rows and values differ; the replica shows small demo amounts where the live rows include `$122,200.00`, `$11,275.00` and `$7,440.00`. Match the reference card labels, row typography, spacing and live-like values.

### 6. Jobs — `jobs.jpg`

**Round 2 improvements:** Status overview, recent visits, visits scheduled, AI promotion and Job Type filter are present. The overall panel organization is close to the reference.

**Remaining differences:** The five job amounts differ from the live rows and Home’s active jobs total. Some overview labels repeat (“Late Late”). Correct the labels and exact totals, then match row height, summary separators and amount alignment.

### 7. Invoices — `invoices.jpg`

**Round 2 improvements:** Invoice status groups and metric panels are present, with an invoice table and status controls.

**Remaining differences:** Add exact amounts beside Past due, Sent and Draft summaries; these lines are currently amount-free. The table begins about 70 px above the reference because the overview cards are shorter. Invoice rows and totals differ substantially from the live values. Match the panel heights, table start, row values, amount alignment and number formatting.

### 8. Marketing — `marketing.jpg`

**Round 2 improvements:** The page includes a marketing upgrade hero plus Campaigns, Reviews, Referrals and campaign/template content.

**Remaining differences:** This screen remains a different product layout. The live reference is a Marketing Dashboard with tabs for Dashboard, Performance, Plan, Reviews, Email Campaigns, Website and More; it has a review prompt area on the left and “Handled this week” on the right. Replace the full-width pale-green hero and card stack with the reference dashboard, matching the tab bar, card sizes, headings and right-side panel.

### 9. Reports — `reports.jpg`

**Round 2 improvements:** Insights is expanded and Reports is active. The replica now has grouped report categories and a denser report collection.

**Remaining differences:** Reference includes Jobber Payments and Legacy Reports and a broader set of Financial, Work, Client and Account reports. Replica omits many entries, including Visits, One-off jobs, Recurring jobs, Requests, Checklists, Quotes, Team productivity and Salesperson performance. Match category ordering, card arrangement, visible item count and link descriptions.

### 10. Expenses — `expenses.jpg`

**Round 2 improvements:** The Expenses route and page frame are present.

**Remaining differences:** Replica shows an empty state because local data has no expenses; reference shows 15 reviewed items. Add the email-forwarding card, Reviewed and Needs review tabs/counts, Entered by and Receipt columns, and reference-like rows. Align the toolbar and table placement.

### 11. Timesheets — `timesheets.jpg`

**Round 2 improvements:** Log time, Approve and Payroll tabs and a timer card are available.

**Remaining differences:** The reference shows a Timesheets promotion, Timesheets/Approve/Confirm tabs, date navigation with Day/Week controls, and employee accordions. The replica shows “My hours for Today” with a timer-focused sidebar and no promotion/date toolbar. Rebuild the first viewport hierarchy around the reference layout, then align the employee rows and date controls.

### 12. Settings — `settings.jpg`

**Round 2 improvements:** Company settings have a secondary settings rail and editable business fields. Shared shell alignment carries through.

**Remaining differences:** The local secondary rail is too wide. Reference content starts around x=385 and uses a narrower, vertically stacked form card. Replica uses a wider two-column form and omits the blue Google Business Profile banner and privacy checkbox. Match section spacing, field width, labels and card proportions.

### 13. Client Hub — `client_hub.jpg`

**Round 2 improvements:** Client Hub includes menu, quote approval, signatures, change requests, reminders and appointment-time controls, plus a live preview.

**Remaining differences:** The local rail is too wide and preview proportions differ. The reference places an embedded menu preview within the settings area and includes explanatory text beside the options; local preview is a separate prominent panel. Align descriptions, toggle row heights, separators and preview placement to the reference.

### 14. Requests / Bookings — `requests_bookings.jpg`

**Round 2 improvements:** Shareable request form, embeddable request form and online booking cards are represented, with a clear route and settings hierarchy.

**Remaining differences:** Reference begins with an introduction and Add New Form, then two form defaults, Checklists, Customization and Availability sections. Replica adds a green promotion hero and focuses the first viewport on request and online booking cards. Match the reference order, copy, section spacing and first-viewport content.

### 15. Account and Billing — `account_billing.jpg`

**Round 2 improvements:** Current plan, billing details and payment history areas are present.

**Remaining differences:** Reference shows Account overview, plan/add-on controls, Visa ending 1821, payment history rows (October `$499`, September/August/July `$249.50`), referral code and subscription controls. Replica has a reduced plan/billing surface and an empty payment table. Add the missing sections and match the card order and row density. Values in the live reference should be populated exactly for this workspace.

### 16. Create menu — `create_menu.jpg`

**Round 2 improvements:** The menu opens from Create and provides Client, Request, Quote, Job and Invoice actions in a compact row, closely matching the reference menu.

**Remaining differences:** Icon shapes/weights and popup x/y offset need final pixel alignment. The logo discrepancy remains visible behind the menu.

### 17. Notifications — `notifications.jpg`

**Round 2 improvements:** The Notifications drawer opens from the header and shows a scrollable activity list with a count; the overlay and close control work.

**Remaining differences:** Reference has Mentions and Activity tabs plus Customize Feed. Replica labels its content Recent and Settings and places Activity (62) in a pill. Match tab names, drawer width, top padding, activity row icon/date spacing and reference feed content.

### 18. Message Center — `message_center.jpg`

**Round 2 improvements:** The dedicated phone onboarding state, search field, Choose Number action and View Live Conversations (3) are implemented. Live Conversations toggles to a populated message view and toggles back to onboarding.

**Remaining differences:** Reference has a client/phone search field with a filter control, and its empty-state text and centered prompt use different copy and spacing. Replica adds an outlined button for Live Conversations where the reference initially presents the phone onboarding state. Match search width/filter icon, prompt typography, button styling and drawer padding.

### 19. Settings menu — `settings_menu.jpg`

**Round 2 improvements:** The header gear opens a profile menu with Settings, Account and Billing, Manage Team, referral/updates, language, theme and log-out entries.

**Remaining differences:** The replica includes a demo workspace/role switcher and Client Hub Preview at the bottom; those are absent from the reference menu. Live menu shows a product updates badge and Dark Mode option, which the replica does not match. Align menu x/y position, width, row heights, separators, profile treatment and available rows.

## Interaction checks

- Create menu opened and displayed all five create types. New Client opened, accepted the test record `Round 2 Browser Capture Check`, and showed a saved confirmation. This local development record remains in the replica database.
- A second Create → Request form opened and was cancelled; the modal closed without saving.
- Notifications opened from the header and its drawer was captured.
- Message Center opened; Live Conversations was switched on to show three SMS and two email items, then switched off to return to the onboarding state.
- Settings gear menu opened and was captured.
- Schedule Day, Week and Month views were selected; each displayed its corresponding one-day, seven-day or month-grid view.
- A client row opened Client Detail. Quote, Job and Invoice rows each opened their detail drawer with row content and actions.
- Insights was expanded and Reports was selected; the replica navigated to `/reports` with Reports active.

## Round 3 priority order

1. Replace the global mark and all three promotional illustrations with the captured live assets; restore exact logo mask behavior.
2. Correct Home geometry and the Quotes, Jobs and Invoices amounts and summary labels.
3. Rebuild Marketing, Expenses, Timesheets, Requests/Bookings and Account/Billing around the reference first viewport.
4. Tune list and settings density, card/table vertical placement, and side-rail width across Clients, Requests, Reports, Settings and Client Hub.
5. Finish overlay alignment and icon details for Create, Notifications, Message Center and Settings.
