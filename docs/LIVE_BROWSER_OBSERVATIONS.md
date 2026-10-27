# Jobber live browser observations

**Observed:** 2026-10-26, signed-in Jobber session in Google Chrome  
**Viewport:** 1523 × 832 CSS pixels  
**Reference app:** `https://secure.getjobber.com`

This specification records the visible structure and styling of the live Jobber account. The 19 screenshot filenames requested for Round 1 were freshly captured as raw, unredacted JPEGs at 1523 × 832 and are linked in `VISUAL_COMPARISON_ROUND_1.md`. This replaces earlier notes that described those target screenshots as redacted. Other supplemental images in the reference folder may come from older captures and are outside that 19-file set.

## Browser and route scope

The active Jobber session was open in Chrome at `/home?nav_label=Home&nav_source=sidebar`. No Jobber page was open in Safari. The inspected routes were:

| Screen | Observed route | Screenshot |
|---|---|---|
| Home | `/home` | [home.jpg](../screenshots/reference/home.jpg) |
| Schedule | `/schedule/week/2026/10/26` (sidebar link `/schedule`) | [schedule.jpg](../screenshots/reference/schedule.jpg) |
| Clients | `/clients` | [clients.jpg](../screenshots/reference/clients.jpg) |
| Requests | `/requests` | [requests.jpg](../screenshots/reference/requests.jpg) |
| Quotes | `/quotes` | [quotes.jpg](../screenshots/reference/quotes.jpg) |
| Jobs | `/jobs` | [jobs.jpg](../screenshots/reference/jobs.jpg) |
| Invoices | `/invoices` | [invoices.jpg](../screenshots/reference/invoices.jpg) |
| Marketing dashboard | `/marketing` | [marketing.jpg](../screenshots/reference/marketing.jpg) |
| Email Campaigns | `/campaigns` (Marketing tab) | [email_campaigns.jpg](../screenshots/reference/email_campaigns.jpg) |
| Reports | `/reports` (Insights submenu) | [reports.jpg](../screenshots/reference/reports.jpg) |
| Expenses | `/expenses` | [expenses.jpg](../screenshots/reference/expenses.jpg) |
| Timesheets | `/timesheets` | [timesheets.jpg](../screenshots/reference/timesheets.jpg) |
| Company settings | `/accounts/edit` | [settings.jpg](../screenshots/reference/settings.jpg) |
| Account and Billing | `/accounts/billing_info/account_and_billing` | [account_billing.jpg](../screenshots/reference/account_billing.jpg) |
| Requests and bookings / online booking setup | `/request_settings` | [online_booking.jpg](../screenshots/reference/online_booking.jpg), [requests_bookings.jpg](../screenshots/reference/requests_bookings.jpg) |
| Client Hub configuration | `/client_hub_settings/edit` | [client_hub.jpg](../screenshots/reference/client_hub.jpg) |
| Quick-create menu | Overlay on Home | [create_menu.jpg](../screenshots/reference/create_menu.jpg) |
| Search | Focused global search on Home | [search.jpg](../screenshots/reference/search.jpg) |
| Settings gear menu | Overlay on Home | [settings_menu.jpg](../screenshots/reference/settings_menu.jpg) |
| Notifications / activity feed | Slide-over on Home | [notifications.jpg](../screenshots/reference/notifications.jpg) |
| Message Center | Slide-over on Home | [message_center.jpg](../screenshots/reference/message_center.jpg) |

Marketing includes dashboard tabs for Dashboard, Performance, Plan, Reviews, Email Campaigns, Website, and More. The Email Campaigns surface is a distinct screen. “Online Booking” and “Client Hub” are reached through Settings → Client Communication rather than separate primary sidebar links.

## Global shell

### Sidebar

- Fixed-width left rail: **188 px** wide (`x=0–188`) beneath the top bar; background **#EEECE7** (`rgb(238, 236, 231)`).
- The sidebar starts with the Jobber mark, then **Create**, **Home**, **Schedule**, a divider, **Clients**, **Requests**, **Quotes**, **Jobs**, **Invoices**, **Payments**, a divider, **Bookkeeping** (with a “New” marker), **Marketing**, **Receptionist**, **Pipeline**, **Insights** (expandable), **Expenses**, and **Timesheets**. A lower collapse control sits at the bottom. The Insights submenu contains **Reports** and **Custom Reports**.
- Active route is a white rounded pill approximately **172 × 40 px**, inset about 8 px from each side, with an **8 px** corner radius. Active text is **#032B3A**, Inter, 14 px, weight 700. Inactive links are transparent against the rail, Inter, 14 px, weight about 600. Icons align in a narrow left column beside labels.
- Thin horizontal separators divide the primary groups; they use a muted gray close to the rail palette.

### Header and global actions

- Top bar: **60 px** high, full viewport width, background **#EEECE7**. The company/workspace label sits beside the brand mark at the left; it is redacted in reference screenshots.
- Global search is near the right side at about **x=975, y=10**, **320 × 40 px**, with a **#DCDAD5** (`rgb(220, 218, 213)`) fill/border, **8 px** radius, and placeholder **“Press / to search”**. The placeholder and focus outline remain visible in `search.jpg`; suggestion content is covered.
- The right-side actions are Jobber AI/sparkles, Message Center, Notifications, Help, and Settings. Their 40 px hit areas begin around x=1299 and continue at roughly 44 px intervals; glyph color is **#032B3A**. Settings and some notification states show a small red update dot.
- Notification panel opens as a right-side drawer with **Mentions** and **Activity** tabs and a **Customize Feed** control. Message Center opens a similar drawer; the empty state says a dedicated phone number is needed and offers **Choose Number**.
- The Settings menu is anchored to the gear. It contains the signed-in profile, **Settings**, **Account and Billing**, **Manage Team**, **Jobber Labs**, **Refer and Earn**, **Product Updates**, **Language**, **Dark Mode**, and **Log Out**. The profile row is redacted in `settings_menu.jpg`.
- The **Create** control opens a horizontal popover with **Client**, **Request**, **Quote**, **Job**, and **Invoice** actions, each with an icon. See `create_menu.jpg`.

### Typography and shared components

- Body copy: **Inter**, with Helvetica/Arial/system sans-serif fallbacks; common body size **14 px**, line height about **21 px**, color **#233D48** (`rgb(35, 61, 72)`).
- Large page titles: **Poppins**, Helvetica/Arial fallbacks, typically **36 px**, very heavy (observed weight 800–900), color **#032B3A** (`rgb(3, 43, 58)`). Some newer and legacy pages use slightly different weight/letter spacing, but the same dark blue-green tone.
- Section headings commonly use 20 px bold; report category headings use approximately 24 px bold. Small uppercase group labels in Settings use compact bold type.
- Main page surface is white **#FFFFFF**. Main content starts around **x=189** with approximately **24 px** left padding (common content edge x=213) and **24 px** top spacing under the shell.
- Standard card: white fill, **1 px #DADFE2** (`rgb(218, 223, 226)`) border, **8 px** radius, and no visible shadow. Filters are soft gray pills, typically **#DCDAD5**, 40 px high, with a 20 px radius.
- Primary action buttons use **#388523** (`rgb(56, 133, 35)`) with white text, a matching 1 px border, and about an 8 px corner radius. Secondary buttons use white fill and a **#DADFE2** outline; text is dark blue-green or green.

## Screen layouts

### Home

The page starts with the current date and a large greeting at upper left and a promotional rewards tile at upper right. A **Workflow** section spans four equal cards for Requests, Quotes, Jobs, and Invoices. Each has a colored top strip and matching icon/accent:

- Requests: **#B36109** (`rgb(179, 97, 9)`)
- Quotes: **#923F4F** (`rgb(146, 63, 79)`)
- Jobs: **#388523** (`rgb(56, 133, 35)`)
- Invoices: **#225C8C** (`rgb(34, 92, 140)`)

Below, **Today’s appointments** is a large card with summary metrics, a **Visit / Employee** toggle, and a **View Schedule** button. A Marketing Suite panel occupies the right column. Home screenshot metrics and personal greeting are redacted.

### Schedule

The primary calendar is a week grid for **Sunday, October 25 through Saturday, October 31, 2026**, with previous/next controls, **Today**, **Find a Time**, and filters for **Type**, **Team**, and **Status**. View controls switch **Month / Week / Day**; adjacent actions include **Unscheduled**, **Toggle Map**, and **More**. The captured week grid was empty.

### Clients

The page title and upper-right actions (**New Client**, **More Actions**) sit above summary cards for new leads, new clients, and total new clients, alongside a merge-duplicates callout. The list area has **Filtered clients**, tag and status filters, a client search field, and sortable columns **Name**, **Address**, **Tags**, **Status**, and **Last Activity**. Client rows are hidden in the reference screenshot; the summary values are also covered.

Observed client status pills are compact rounded badges with dark blue-green text: **Lead** uses **#E2F1FD** (`rgb(226, 241, 253)`); **Active** uses **#E7F0E5** (`rgb(231, 240, 229)`).

### Requests

The upper summary has an **Overview** card with needs-approval, new, assessment-complete, overdue, and unscheduled counts; adjacent cards cover new requests and conversion rate. There is also an instructional request-tracking banner. The list has status/date filters, search, and sortable columns **Client**, **Title**, **Property**, **Contact**, **Requested**, and **Status**. The data rows are covered. Observed status examples: **Converted** on **#E2F1FD** and **Archived** on **#EEF1F2**.

### Quotes

The quotes page has top-level summary cards for **Draft**, **Awaiting response**, **Changes requested**, and **Approved**, plus conversion/sent/converted performance summaries. The list surface includes status/date filters and search. Columns are **Client**, **Quote number**, **Property**, **Created**, **Status**, and **Total**. The captured list had no results.

### Jobs

Summary cards cover **Ending within 30 days**, **Late**, **Requires Invoicing**, **Action Required**, and **Unscheduled**. A recent-visits/visits-scheduled region sits above the list. Table columns are **Client**, **Job number**, **Property**, **Schedule**, **Status**, and **Total**. The captured list had no results.

### Invoices

Summary cards cover **Past due**, **Sent but not due**, and **Draft**, with issued/average-invoice/payment-time metrics. The list has status/date filters and search. Columns are **Client**, **Invoice number**, **Due date**, **Subject**, **Status**, **Total**, and **Balance**. The saved screenshot was captured after the results finished loading; row values and financial figures are covered while status badges remain visible.

Observed invoice badge palette: **Past due** **#FAECEA** (`rgb(250, 236, 234)`); **Draft/Archived** **#EEF1F2** (`rgb(238, 241, 242)`); **Paid/Active** **#E7F0E5** (`rgb(231, 240, 229)`). Badge text is **#233D48**, with an approximately 12 px radius.

### Marketing and Email Campaigns

The Marketing Dashboard uses a horizontal subnav: **Dashboard**, **Performance**, **Plan**, **Reviews**, **Email Campaigns**, **Website**, and **More**. The dashboard has a “Start here / Use your own idea” content carousel and a **Handled this week** automation area.

Email Campaigns adds a **Campaign generator** text area and **Generate Email** button, a right-side **Set up automated Campaigns** panel (re-engage past clients, win back lost leads, quote follow-ups), and an **All Campaigns** table with creator/status/type filters and search. Columns are **Campaign**, **Open Rate**, **Click Rate**, **Job Revenue**, **Status**, **Created by**, **Type**, and **Last Updated**. Campaign row text, creator identity, and dates are hidden in `email_campaigns.jpg`; status and type remain visible.

### Reports

Reports appears under the expanded **Insights** sidebar group and uses a report catalog layout. Category groups observed: **Jobber Payments**, **Financial reports**, **Work reports**, **Expense reports**, **Client reports**, and **Account reports**, each followed by report links. This surface is more catalog-like than the card/table dashboards but retains the global shell palette and typography.

### Expenses

The Expenses view has **Reviewed** and **Needs review** tabs/counts, an email-forwarding instruction banner, and a transaction list. Columns are **Date**, **Name**, **Description**, **Receipt**, **Job**, **Created**, and **Amount**. Transaction rows are covered in the screenshot.

### Timesheets

The Timesheets page has a **Settings** action, tabs for **Timesheets**, **Approve timesheets**, and **Confirm payroll**, plus day/week and date controls and a team filter. Employee entries are expandable rows; the captured mode is **Day**. Employee names and time/approval values are covered.

### Company settings

Company settings opens a second settings navigation rail inside the content area. Groups observed: **Business Management** (Company Settings, Business Profile, Products & Services, Custom Fields, Jobber Payments, Bookkeeping, Expense Tracking, Automations); **Team Organization** (Manage Team, Account Activity, Work Settings, Schedule, Location Services, Checklists); **Client Communication** (Client Hub, Emails & Text Messages, Dedicated Phone Number, Requests and Bookings); and **Connected Apps**. The selected Company Settings view contains a Google Business Profile tip banner, a **Company details** card, regional/tax fields, and a privacy checkbox. Business contact, address, and tax values are redacted.

### Requests and bookings / Online Booking

The **Requests and bookings** settings page has a **Forms** card containing Assessment Booking Form and Default Form entries with booking/request-default toggles. Below are **Checklists**, **Customization**, and **Availability** sections for business hours, service areas, and team member availability. No external booking flow was submitted or configured during inspection.

### Client Hub

The Client Hub settings screen includes a preview column and controls for menu visibility, quotes and invoices, quote approval/signatures, change requests, appointment times, request/booking forms, primary button, and referrals. The page explains the hub’s client-facing functions; this inspection covered configuration only and did not enter a client-facing portal.

### Account and Billing

Account and Billing presents separate cards/sections for **Account overview**, **Billing details**, **Plan subscription**, **Payment history**, **Referral code**, and **Change subscription**, with **Manage Plans**, **Manage Add-ons**, and **Edit** controls. Account, payment, billing, and referral details are covered in the screenshot.

## Interaction observations and side effects

- The global search field showed **“Press / to search”**; it was focused to inspect its presentation without entering a query.
- The quick-create menu and Settings gear menu were opened for inspection; no create flow or account setting was submitted.
- Opening the Activity feed marked its previously unread items as read: the header bell initially showed **59 unread**, and the header then showed **0 unread**. The Activity tab itself displayed its feed count. This is the only observed persistent side effect of the inspection.
- The introductory **“What’s new in Campaigns”** overlay was dismissed to inspect the underlying Campaigns screen; no campaign was generated, edited, duplicated, sent, or configured.
- The browser was returned to the original Jobber Home route after inspection.
