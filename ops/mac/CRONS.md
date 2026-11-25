# The 6 crons in vercel.json — nothing is scheduled on the Mac yet

Vercel ran these for us and injected the `Authorization: Bearer $CRON_SECRET`
header itself. On the Mac nothing calls them, so **right now none of them run.**
Each route is a plain GET that checks that header, so launchd can call them with:

    curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://gestaltung360.com/api/cron/<name>

Schedules below are as written in vercel.json (UTC). Qatar is UTC+3, so a launchd
`StartCalendarInterval` hour = UTC hour + 3.

| # | Path | vercel.json (UTC) | Qatar time | What it does | Writes DB | Outside calls | Second-run guard |
|---|------|------|------|------|------|------|------|
| 1 | `/api/cron/supplier-refresh` | `0 2 * * *` | 05:00 daily | Refreshes Mouser + DigiKey prices and stock (max 25 parts per supplier per run), then clears the storefront cache for what changed | yes — `supplier_sync_runs`, `supplier_offers` | yes — Mouser (~1000 calls/day cap) and DigiKey | **yes, 20 h** — skips if an `ok` run started in the last 20 h |
| 2 | `/api/cron/voltaat-sync` | (not on Vercel) | hourly, minute :20–:39 | One batch of the Voltaat price and stock sync: **one request** (robots.txt, then one catalogue page per batch). A day's pass is ~8 requests over ~8 hours; clears only the changed storefront tags | yes — `supplier_sync_runs`, `supplier_offers`, `store_settings.voltaat_sync_pass` | yes — the Voltaat site, one request per call | **yes** — skips with no request when the day's pass is done, under 40 min since the last batch, or while waiting out a refusal (45 min → 24 h); also obeys the `voltaat_sync.enabled` switch |
| 3 | `/api/cron/delivery-promises` | `0 4 * * *` | 07:00 daily | Re-dates open orders whose lead time changed, emails the affected customers, then emails you a summary | yes — orders | Resend (email) | none |
| 4 | `/api/cron/notifications` | `30 4 * * *` | 07:30 daily | Drains the `notification_outbox` table and sends the queued emails | yes — outbox rows | Resend (email) | none, but the outbox status makes a repeat harmless |
| 5 | `/api/cron/anonymous-cleanup` | `0 5 * * 0` | 08:00 Sundays | Deletes stale anonymous accounts, emails you only if it deleted any | yes — deletes users | Resend (email) | none; controlled by `enabled` / `dry_run` settings (seeded as dry run) |
| 6 | `/api/cron/youtube-retire` | `0 7 * * *` | 10:00 daily | Deletes outdated videos from YouTube and removes the site links, then clears the whole storefront cache | yes — retire log, links | YouTube Data API (quota) | none |

Two more cron routes exist in the code but are deliberately **not** in vercel.json
(`cc-payments-expire`, hourly, and `cc-weekly-progress`, Sundays). They were driven
by the separate worker service, not by Vercel, so they are out of scope here.

## Recommendation

Start with **#2 Voltaat sync** only. It is the one that actually gets *better* on the
Mac: Voltaat was returning 429 (too many requests) to Vercel's data centre, and the
Mac is on a normal Qatar home/office connection, so the requests look local. Its 20 h
guard means a double run in one day is refused by the code itself, so a missed or
repeated launchd firing cannot do damage.

#1 supplier-refresh also has the 20 h guard and would be safe, but it spends Mouser's
daily API quota, so it is worth turning on deliberately rather than by default.

#3, #4, #5 all send email through Resend — and `RESEND_API_KEY` is currently **not**
in `.env.local`, so they would do their database work and then fail to send silently.
Worth fixing the key first.

#6 clears the entire storefront cache on every run, which means a slow first page load
for everyone afterwards. Low value to run daily from here.

## Voltaat sync since 2026-11-24

Scheduled on this Mac by `5-start-voltaat-cron.command` (launchd, hourly). It was
refused with 429 on 23 and 24 Nov because it made a second request 5 seconds after
the first; Voltaat's store allows roughly one request a minute from us. It now makes
one request per hourly batch. Log: `logs/cron-voltaat.log` — one line per firing,
most of them `"status":"skipped"` once the day's pass is finished.
