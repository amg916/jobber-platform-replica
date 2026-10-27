# Round 4 Browser Verification and Visual Comparison

Date: 2026-10-27  
Replica: `http://127.0.0.1:4321`  
Reference viewport: 1523 × 832  
Replica captures: `screenshots/replica/`  
Comparison sheets: `docs/VISUAL_COMPARISON_ROUND_4_SHEET_1.jpg` through `SHEET_4.jpg`

## Result

The 19 requested replica views were captured as JPEGs at exactly 1523 × 832. The four contact sheets pair the requested replica captures with the closest matching reference image. The reference folder contains **22** JPEGs, all 1523 × 832, rather than 19. Seventeen requested views have an obvious matching reference. There is no `apps.jpg` reference and no New Task modal reference, so screens 12 and 19 cannot be compared for parity. Five reference files are outside the requested capture list: `email_campaigns.jpg`, `message_center.jpg`, `requests_bookings.jpg`, `search.jpg`, and `settings_menu.jpg`.

**1:1 visual parity is not confirmed.** The matched screens show visible differences in illustration assets, content density, spacing, and some seeded values. Several list screens are structurally close, and the new task flow works, but the captured images are not pixel-identical. The current source also does not expose `window.go` or `window.openOverlay`; canonical routes and the live header/sidebar controls were used instead. `window.openNewTaskModal` is available in the page's main execution context.

A full-frame RGB comparison of the 17 matched pairs produced mean absolute channel differences from 8.20/255 to 19.69/255. JPEG encoding and cursor placement contribute some noise, but the visible layout and artwork changes in the sheets also account for substantial differences.

## Browser and functional checks

- Enabled cache bypass through Chrome DevTools Protocol and reloaded the app at 1523 × 832 CSS pixels with device scale factor 1 for the captures. The first reload showed the app's handled “Authentication required” message because the tab held a stale local demo session token. Clearing that local token let the app's demo bootstrap create a fresh local session; Home then rendered with the J S Custom Tile seed data. No production credentials or data were used.
- After the fresh load and through the route/overlay run, there were **0 console error entries and 0 uncaught page exceptions**.
- Verified header company title `J S Custom Tile`, Assistant, Message center, Notifications, Help, and Settings controls, plus the floating `New on your plan` pill.
- Opened the Assistant, Message Center, Notifications, Help, and Settings panels; the global search field also opened its search popover.
- Verified the Community sidebar item navigates to `/community`. The collapse control adds the sidebar's collapsed state and restores it on a second click.
- Verified live table headings:
  - Clients: Name, Address, Tags, Status, Last Activity.
  - Requests: Client, Title, Property, Contact, Requested, Status.
  - Quotes: Client, Quote number, Property, Created, Status, Total.
  - Jobs: Client, Job number, Property, Schedule, Status, Total.
  - Invoices: Client, Invoice number, Due date, Subject, Status, Total, Balance.
  - Expenses: Date, Name, Description, Receipt, Job, Created, Amount.
  - Timesheets, after selecting Confirm payroll: Employee, Hours, Approval.
  - Reports, after opening Projected income: Id, Client Id, Property Id, Job Id, Quote Id, Invoice Number, Subject.
- On Schedule, `More` → `New Task` opened the New Task dialog. Saving `Round 4 verification task` closed the dialog and showed “Saved successfully”; a read-only API check confirmed task id 1 was created with status `open`. The direct modal close button also cleared the dialog cleanly. This is a local demo record left in the workspace as the result of the requested creation check.
- `window.go` and `window.openOverlay` were not defined on `window`, and `#createBtn` was absent. Main route captures therefore used direct local route navigation; Create used `[data-create-menu]`; the Activity/Notifications drawer used the visible Notifications control. Client Hub and Online Booking were captured at the app's canonical settings routes `/settings/client-hub` and `/settings/online-booking`. These routes render the requested settings screens; the short names do not work as exposed window helpers in this build.

## Screen-by-screen comparison

| # | Replica capture | Reference | Comparison |
|---:|---|---|---|
| 01 | [01_home.jpg](../screenshots/replica/01_home.jpg) | `home.jpg` | Company title, workflow cards, core figures, and floating plan pill are present. The reference's giveaway banner uses different artwork; the replica uses a line-art truck. The reference opens Insights with Reports and Custom Reports visible, while the replica starts with Insights collapsed. Lower Business Performance and Marketing content are arranged differently. |
| 02 | [02_schedule.jpg](../screenshots/replica/02_schedule.jpg) | `schedule.jpg` | The October 2026 week view, date controls, seven day columns, and hour grid align closely. Toolbar spacing, selected controls, grid contrast, cell sizing, and the calendar's vertical density differ. |
| 03 | [03_clients.jpg](../screenshots/replica/03_clients.jpg) | `clients.jpg` | The 95-client list, summary cards, merge promotion, and five table columns are present. Activity dates and some row details differ from the reference; KPI/card widths, table start position, and row baselines also vary. |
| 04 | [04_requests.jpg](../screenshots/replica/04_requests.jpg) | `requests.jpg` | The overview, request promotion, filters, and three request rows are present. Promotion placement and summary/table spacing differ, with some row text and status/date details not matching exactly. |
| 05 | [05_quotes.jpg](../screenshots/replica/05_quotes.jpg) | `quotes.jpg` | The Deep Lawn banner, quote summaries, and six-column list are present. The banner artwork treatment, card proportions, and vertical spacing differ; row alignment and some content remain short of 1:1. |
| 06 | [06_jobs.jpg](../screenshots/replica/06_jobs.jpg) | `jobs.jpg` | Five seeded jobs, the six table columns, summary cards, and visible job amounts are present. The overall structure is close, but card/table spacing, column widths, and text baselines differ. |
| 07 | [07_invoices.jpg](../screenshots/replica/07_invoices.jpg) | `invoices.jpg` | Four invoices and the seven reference-style columns (including Due date, Subject, and Balance) are present. The layout is close, though overview card widths, row heights, status placement, and some amounts/status details differ. |
| 08 | [08_marketing.jpg](../screenshots/replica/08_marketing.jpg) | `marketing.jpg` | Dashboard tabs, review setup card, and weekly activity area match the broad hierarchy. The reference uses a photographic review illustration; the replica uses a simplified phone graphic. Card size, image crop, margins, and whitespace differ. |
| 09 | [09_reports.jpg](../screenshots/replica/09_reports.jpg) | `reports.jpg` | Payments, Financial, Work, and Client report groups are present in three columns. The reference packs more content above the fold; card gutters, line wrapping, row spacing, and the lower category positions differ. |
| 10 | [10_expenses.jpg](../screenshots/replica/10_expenses.jpg) | `expenses.jpg` | The seven table columns, 15 reviewed expenses, and receipt-forwarding card are present. This is structurally close; the forwarding card's size/placement and the table's vertical density and spacing differ. |
| 11 | [11_timesheets.jpg](../screenshots/replica/11_timesheets.jpg) | `timesheets.jpg` | The title, tabs, date controls, and employee rows are present. The reference banner shows layered mobile/timekeeping imagery, while the replica uses a dark timer tile; local employee totals are 0:00. The banner, control positions, row styling, and totals make this a substantial visual difference. |
| 12 | [12_apps.jpg](../screenshots/replica/12_apps.jpg) | **No `apps.jpg`** | The Connected Apps view renders with nine connected sandbox integrations and its table. No matching reference screenshot exists, so visual parity cannot be assessed. |
| 13 | [13_settings.jpg](../screenshots/replica/13_settings.jpg) | `settings.jpg` | Company settings and the Google Business Profile callout are present. The reference's compact, mostly single-column form differs from the replica's taller fields and broader/multi-column address layout; side navigation width and lower content placement also vary. |
| 14 | [14_client_hub_settings.jpg](../screenshots/replica/14_client_hub_settings.jpg) | `client_hub.jpg` | Client Hub toggles and preview content are present. The reference uses a narrower, integrated preview composition; the replica places a simplified preview in a large right-hand card. Content proportions, toggle rows, and spacing differ. |
| 15 | [15_online_booking.jpg](../screenshots/replica/15_online_booking.jpg) | `online_booking.jpg` | Requests and bookings shows the forms, checklists, customization, and availability sequence. The first viewport is broadly similar, but card widths, controls, copy, section spacing, and below-fold positions differ. |
| 16 | [16_overlay_create_menu.jpg](../screenshots/replica/16_overlay_create_menu.jpg) | `create_menu.jpg` | Both show the five quick-create choices over Home. Action labels and placement are close; icon scale/weight, popup geometry, and small vertical offsets differ. |
| 17 | [17_overlay_search_activity_notifications_help_settings.jpg](../screenshots/replica/17_overlay_search_activity_notifications_help_settings.jpg) | `notifications.jpg` | The Notifications drawer shows Mentions and Activity with the seeded timer feed. Drawer width, activity row spacing/icons, and visible feed density differ. The capture is the Activity/Notifications panel only; Search, Help, and Settings are separate controls, not a combined overlay in this build. |
| 18 | [18_account_and_billing.jpg](../screenshots/replica/18_account_and_billing.jpg) | `account_billing.jpg` | Account overview, plan/billing details, payment history, and referral sections are present. Card sizing, payment row spacing, and alignment differ; the screen is close in structure but not 1:1. |
| 19 | [19_overlay_new_task_modal.jpg](../screenshots/replica/19_overlay_new_task_modal.jpg) | **No New Task modal reference** | The New Task dialog is captured over Home with Title, Instructions, Due date, Assigned to, and Save controls. The modal opens, closes, and saves a task successfully, but there is no corresponding reference image for visual comparison. |

## Comparison sheets

- [Sheet 1 — screens 01–05](VISUAL_COMPARISON_ROUND_4_SHEET_1.jpg)
- [Sheet 2 — screens 06–10](VISUAL_COMPARISON_ROUND_4_SHEET_2.jpg)
- [Sheet 3 — screens 11–15](VISUAL_COMPARISON_ROUND_4_SHEET_3.jpg)
- [Sheet 4 — screens 16–19](VISUAL_COMPARISON_ROUND_4_SHEET_4.jpg)

The left side of screens 12 and 19 is explicitly marked as missing because no corresponding reference file exists. The contact sheets are side-by-side visual aids; they do not establish pixel parity.
