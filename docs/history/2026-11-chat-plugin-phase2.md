# Chat plugin — Phase 2: paid meetings with the engineer (2026-11-22)

Branch `plugin-phases` (cut from `main` at 272c0b6). Nothing pushed, nothing
merged, **migration 0113 not run**. Phase 1 (hand-off) is unchanged; Phase 2
only adds.

## Owner decisions this implements (final)

One hour, QAR 150. Online (Google Meet link sent on WhatsApp) or in person at
the studio, Rafal Tower, Lusail. No free meeting. Until a real calendar is
attached the only times are **Monday and Wednesday, 16:00 and 17:00 Qatar
time**. Invoiced **after** the meeting and **only if the client is happy**.
Free to move or cancel up to 24 hours before; no invoice for a cancelled
meeting. The QAR 150 is deducted from a manufacturing order placed within 30
days. Guests can book.

Every one of those numbers lives in `store_settings.meetings`, and all the copy
is generated from it — the owner can change the price, the days, the hours, the
notice or the windows in one row, with no deploy.

## Database — `supabase/migrations/0113_meetings.sql` (NOT RUN)

- `store_settings.meetings` seeded with `on conflict do nothing`, so an owner
  edit survives a re-run.
- `meeting_bookings`: RLS on, no anon/authenticated privileges, super admin
  select/update, service_role writes. Only the **sha256** of the manage token
  is stored. A **partial unique index on `starts_at` where status not in
  ('cancelled','no_show')** is what actually prevents a double booking — a
  cancelled slot becomes bookable again.
- RPCs: `meeting_settings()`, `meeting_slot_on_grid(ts)`,
  `meeting_free_slots(from, days)` (anon; **start times only**, never a name or
  a phone number; clamps the day count to the horizon), `book_meeting(...)`
  (service_role only; re-checks weekday, time, holiday, horizon, the notice
  window, the mode and a two-future-meetings-per-phone cap; raises `bad_slot`,
  `too_soon`, `slot_taken`, `too_many`), `cancel_meeting(token)` and
  `move_meeting(token, ts)` (anon, token-checked, **return jsonb** so the page
  can render a reason instead of a 500), `set_meeting_status(id, status, note)`
  (super admin, forward only: booked → done|no_show|cancelled, done →
  invoiced, invoiced → paid) and `apply_meeting_credit(meeting, order)` (super
  admin, paid meetings only, once per meeting, order inside the window).
- Holidays come from the same `store_settings.holidays` list the store uses.

Two bugs the tests caught while writing it, both fixed: `generate_series` over
a `date` with an interval step returns `timestamptz` (it broke slot
generation), and out-of-range weekdays in the settings were being clamped into
valid ones, so a stray `9` would have quietly opened Sunday — they are dropped
now.

## Logic — `lib/meetings/` (pure, no Supabase, no React)

`settings.ts` (clamped reader + defaults that mirror the SQL), `slots.ts`
(Qatar grid, no DST, EN/AR labels with **Western digits**), `rules.ts` (the
24-hour window, the forward-only status ladder, the credit window),
`availability.ts` (the `AvailabilityProvider` interface plus today's
settings-based provider — a Google Calendar provider can be added later
**without touching any caller**; it is deliberately not built), `copy.ts` (the
three rule lines, the mode lines and the company line, all derived from the
settings), `email.ts`, `server.ts` (server-only data access), `notify.ts` (the
website booking's lead + e-mails) and `reminders-core.ts`.

`lib/db-test/meetings-parity.test.ts` runs the migration in PGlite and fails if
the SQL and `lib/meetings` ever disagree on slots, holidays, the change window,
the status ladder or the credit window. The SQL stays the authority.

## Surfaces

- **MCP** (`lib/plugin/server/register.ts`): `list_meeting_slots` (read-only,
  read bucket) and `book_meeting` (writes, 10/day per hashed IP, description
  says it is only called after the user explicitly agrees). The server
  `instructions` and the `design_a_product` prompt now offer a meeting after
  `send_project`. A hand-off link is attached only when the host is ours.
- **Website**: `/api/meetings/slots` (GET, no personal data) and
  `/api/meetings/book` (POST, Turnstile gate, guests allowed, the same
  validation and the same RPC as the tool). `components/meetings/booking.tsx`
  is on `/contact` and in the Studio Make step (not in a class project).
- **The client's page**: `/[locale]/meetings/[token]`, dynamic and noindex,
  scope `meetings`. Move (slot picker) and Cancel while the window is open;
  after it, "Too late to change online — message us on WhatsApp" with the
  contact-setting number.
- **Admin**: Dashboard → Sell → Meetings (super admin), upcoming/past tabs,
  nav badge = meetings this week. Per row: time, mode, name, WhatsApp button,
  topic, linked project, status, Meet link, Mark done / No show, **Send
  invoice** (only after `done`) and Mark paid. Funnel rows booked / held /
  invoiced / paid over 30 days. The QAR 150 credit row on an admin order page
  **records** the credit and tells the owner what to deduct — `create_part_order`,
  checkout and every total are untouched.
- **Reminders**: the day before, on the existing daily `notifications` cron —
  one e-mail per client who gave an address and one list to the owner, with
  online meetings that still have no Meet link flagged. No paid WhatsApp API.
  `reminders-core.ts` imports no `next/*`, no `react` and no `server-only`, so
  the Mac Mini worker bundle still builds.

## Degrading before 0113 runs

Every read answers a default or an empty list and every write answers
`not_set_up`; PGRST202 and 42P01 are detected, never a 500. The tools say "not
set up yet", the booking card says "no free times", the manage page shows a
not-found card, the dashboard page says to run 0113, and the nav badge and the
funnel rows are simply absent.

## Checks

`npm run typecheck`, `npm run lint` (0 errors, 303 warnings — the ratchet
holds), `npm test`, `node scripts/check-i18n-parity.mjs`, `npm run build` and
`npm run worker:build` all pass. New tests: the 0113 PGlite suite, the parity
suite, `lib/meetings/{slots,rules,reminders-core}.test.ts`, the two new MCP
tools in `lib/plugin/server/register.test.ts`, and `e2e/meetings.spec.ts`
(EN + AR at 375 and 1366, writes intercepted, the e2e write guard untouched).

## Not verified

- Nothing has run against the real database: 0113 is the owner's to run.
- `RESEND_API_KEY` is **missing** from the Mac's environment, so meeting
  e-mails (and Phase 1's owner e-mail) will not send until it is set in
  `gestaltung/.env.local` — the working copy, which `update-live.command`
  copies over the live one on every deploy.
- The `notifications` cron is **not scheduled** on the Mac (only
  `voltaat-sync` is), so the day-before reminder will not fire until a
  scheduler invokes `/api/cron/notifications`.
- No live booking has been made, so the real Google Meet / WhatsApp loop is
  untested end to end.
