# Known limitations

## Live data and minimal seed

- `seedDatabase` seeds only the `J S Custom Tile` organization (`id: 1`), 4 RBAC roles (`owner`, `dispatcher`, `technician`, `limited`), 120 role permissions, and 4 team members (`Jack Surwald`, `Kyle Waterworth`, `Roger Burton`, `William Houn`). Zero dummy clients, requests, quotes, jobs, invoices, payments, expenses, subscription payments, appointments, time entries, campaigns, notifications, or messages are seeded.
- All business screens, Home workflow cards, today's appointment metrics (evaluated in the organization's configured timezone), receivables, upcoming jobs, list statistics, client tags/properties, campaigns, and automation execution counts are 100% live-wired to the SQLite database via REST and GraphQL (`2025-01-20`).
- Date defaults and time-of-day greetings (`Good morning`, `Good afternoon`, `Good evening`) use the current runtime clock.
- Quotes expose salesperson assignment/filtering; expenses expose review status (`reviewed` / `pending`) and accounting codes; Requests, Quotes, Jobs, and Invoices support explicit property selection (`property_id`) with automatic fallback to the client's primary property; Company Settings persists both `address` (`Street 1`) and `address_line2` (`Street 2`).

## Metric semantics

- All `"Past 30 days"` KPI cards (Clients `New leads` / `New clients`, Requests `New requests`, Quotes `Conversion rate` / `Sent` / `Converted`, Jobs `Recent visits`, Invoices `Issued` / `Average invoice` / `Invoice payment time`, and Payments `Net Volume` / `Payouts` / `Deposits` / `Refunds`) filter records to the trailing 30-day window and compute period-over-period percentage deltas against the prior 30-day window (`daysAgoIso(60)` to `daysAgoIso(30)`).
- Jobs `"Next 30 days"` cards (`Ending within 30 days` and `Visits scheduled`) filter to the upcoming 30-day window (`todayIso()` through `daysAgoIso(-30)`).
- Marketing Dashboard `"HANDLED THIS WEEK"` filters `automation-executions` to records within the trailing 7-day window (`daysAgoIso(7)`).
- Campaign `Job ↕` (`jobs_count`) is computed on the server from jobs created at or after `sent_at` for campaign recipients (or preserves an explicit numeric `jobs_count` when supplied).

## Local product boundaries

- External provider integrations (QuickBooks Online, Stripe/Jobber Payments, Twilio SMS, SendGrid Email, Google Calendar, CompanyCam, Mailchimp, Zapier, OpenAI Receptionist, ServiceTitan) operate in deterministic local sandbox mode rather than calling live third-party network endpoints.
- Receipt forwarding displays workspace instructions; there is no inbound SMTP server.
- Sorting, search, and filters on list pages operate on the organization's loaded dataset.

## Verification and delivery

- Syntax checks (`node --check`) and the full automated test suite (`npm test`) pass across backend, frontend, GraphQL, security, and customer parity suites.
