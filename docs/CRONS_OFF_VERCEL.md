# The scheduled jobs without Vercel

Written 2026-11-24, when the owner said the project has left Vercel "for now, at
least a month of today" (so: until about 2026-12-24 at the earliest).

This is not a second worker runbook. `docs/WORKER.md` is the runbook and it is
still correct step by step. This file records only what is **different** when
Vercel is not there at all, because WORKER.md was written for a world where
Vercel stayed as the fallback.

## 1. What stopped the moment Vercel went away

The six daily jobs are scheduled by Vercel, in `vercel.json` -> `crons`, and
Vercel's cron scheduler was the only thing firing them. No Vercel, no schedule:
nothing errors and nothing is logged, the job simply never runs.

**One of the six has since been rescued, and it no longer resembles its Vercel
self.** `voltaat-sync` runs on the Mac from
`~/Library/LaunchAgents/com.gestaltung.cron.voltaat.plist`, which holds 24
`StartCalendarInterval` slots — one per hour, each at a fixed but different
minute between `:20` and `:39` (23, 37, 28, 21, 34, …) — firing
`live-scripts/cron-voltaat.sh`, which since 2026-11-24 also waits a random
0–59 s before its request, because launchd has no `Second` field and every
firing otherwise landed exactly on `:00`.

So it is hourly, not daily, and that is the point: each call makes **at most one
request** to Voltaat, and the route answers "skipped" without contacting Voltaat
at all once the day's pass is done, within 40 minutes of the last batch, or
while it is waiting out a refusal. A day's pass is roughly eight requests spread
over eight hours. It was built this way because Voltaat refused the old
eight-requests-in-forty-seconds version with 429 on both 23 and 24 November;
their store tolerates about one request a minute from us. The `:20`–`:39` window
is not decoration either — it keeps any two firings more than 40 minutes apart,
which is exactly what the route's own guard requires, and the 0–59 s wait leaves
about a minute of margin on that. Widening the wait much further would start
tripping the guard.

So five of the six are unscheduled, not all six.
`ops/mac/CRONS.md` is the authority on that route — it calls each cron route
with the `CRON_SECRET` header and reasons job by job about which are safe to
schedule. Read it before section 2: it and this file describe two different ways
to solve the same problem, and only one of them needs to be chosen. (`ops/mac/`
is a tracked copy of the Mac's `live-scripts/`; the Mac stays the source of
truth. `ops/mac/README.md` says what is there and what was deliberately left
out.)

| Job | Was (UTC) | What silently stops |
|---|---|---|
| `supplier-refresh` | `0 2 * * *` | store prices and stock go stale |
| `voltaat-sync` | `0 3 * * *` | nothing — this one runs on the Mac now (above) |
| `delivery-promises` | `0 4 * * *` | promise dates stop moving |
| `notifications` | `30 4 * * *` | **the whole outbound mail drain** |
| `anonymous-cleanup` | `0 5 * * 0` | guest rows accumulate |
| `youtube-retire` | `0 7 * * *` | retired videos stay published |

`notifications` is the one to care about. It drains `notification_outbox`, so
with it stopped **no order e-mail, no delay e-mail and no meeting reminder goes
out**. Phase 2's day-before meeting reminders ride on this job, so that part of
PR #7 is inert until the job runs somewhere, even after the branch is deployed.

`RESEND_API_KEY` is **not** the second half of this problem, whatever older
notes say. It was set on 2026-11-22, in both `gestaltung/.env.local` (the copy
`update-live.command` deploys from) and `gestaltung-live/.env.local` (what the
running site reads), mode 600, alongside `RESEND_FROM` and
`STORE_LEAD_EMAIL`; `ops/mac/SECURITY.md` records the send-only key and a real
test message accepted for delivery. `ops/mac/CRONS.md` still says the key is
missing and so did this file — both were written before it was set. The schedule
is the only thing stopping the mail.

The two CAD Champions jobs lose nothing here: `cc-payments-expire` and
`cc-weekly-progress` were never in `vercel.json` and have always waited for the
worker.

The other thing `vercel.json` used to provide — the permanent redirect from
`www.gestaltung360.com` to the apex — is **already handled** and needs nothing
done. `ops/mac/patches/02-self-host-next-config.patch` puts it in
`next.config.mjs` instead, deliberately there rather than in middleware so it
also covers `/api`, `/sitemap.xml`, `/robots.txt` and `/_next`, which the
middleware matcher skips. The tunnel passes the original `Host` header through,
so the app sees `www` and answers 308.

## 2. The fix that already exists

`services/worker` schedules all eight jobs itself. This is worth stating
plainly because WORKER.md's step 11 describes the forwarding arrangement and it
is easy to read the worker as a thing Vercel delegates to. It is not. From
`0111_worker_switch.sql`'s own header:

> `true`: each Vercel cron route forwards to the worker when it is healthy
> (falls back to the Vercel path when it is not), and **the worker runs the jobs
> on its own schedule**.

The second half of that sentence is what matters now. The worker keeps its own
timetable in Asia/Qatar time and runs the jobs whether or not anything calls
it, so it is a complete replacement for Vercel's scheduler, not a helper for it.

Worker timetable (from WORKER.md's developer table; `lib/cron/jobs.ts` is the
single definition both sides use):

| Job | Worker (Asia/Qatar, UTC+3) |
|---|---|
| `supplier-refresh` | `0 5 * * *` |
| `voltaat-sync` | `0 6 * * *` |
| `delivery-promises` | `0 7 * * *` |
| `notifications` | `30 7 * * *` |
| `anonymous-cleanup` | `0 8 * * 0` |
| `youtube-retire` | `0 10 * * *` |
| `cc-payments-expire` | `0 * * * *` |
| `cc-weekly-progress` | `0 9 * * 0` |

## 3. The switch is not optional

The worker will do nothing on its own timetable until the switch row says so.
This is in the code, not only in the docs:

- `services/worker/src/main.ts:69` builds each scheduled task with
  `isEnabled: async () => (await readWorkerSettings(createServiceClient())).enabled`.
- `services/worker/src/scheduler.ts:30` skips the run when that is false.

`store_settings.worker` is created by **migration 0111, which has not been
run**. With no row, `readWorkerSettings` reports disabled and every scheduled
run is skipped. So 0111 has to be run and then set to `true` — WORKER.md step 9
and step 11 — or the worker sits there healthy and idle.

## 4. What changes in WORKER.md now that Vercel is gone

Follow WORKER.md as written, with these three differences.

**Step 10 (Vercel environment variables) is moot.** `WORKER_URL` and
`WORKER_SECRET` on Vercel existed so Vercel's cron routes could find the worker
and so the health check could decide whether to forward. With no Vercel there is
nothing to forward from. Skip it.

**There is no fallback any more.** This is the real change, and it is a
reduction in safety that WORKER.md's own table ("If the Mac is down, Vercel
notices within seconds and runs the daily crons itself, so they are not lost")
no longer covers. If the Mac Mini is asleep, offline, or Docker is not running
at the scheduled minute, that run is simply missed — there is no second place
that runs it. WORKER.md step 2 (keep the Mac awake) stops being housekeeping and
becomes the thing the schedule depends on.

**`REVALIDATE_URL` must point at the Mac's own server.** The worker cannot call
`revalidateTag` itself; after a job that changed the storefront it POSTs to
`/api/internal/revalidate` on the Next app. That URL was the Vercel deployment.
The site now runs on the same machine as the worker, so the right value is the
loopback address the server binds — `http://127.0.0.1:3000` — which keeps the
purge off the tunnel entirely. Until it points there, `voltaat-sync` and
`supplier-refresh` will update the database and leave the storefront cache
holding the old values — which, with the 24 h cache expiry, means up to a day of
wrong prices rather than a few minutes. `NEXT_PUBLIC_SITE_URL` is a different
case: it goes into e-mail links, so it stays the public
`https://gestaltung360.com`, never the loopback address.

## 5. Checking it actually works

Nothing here is verifiable from this repository, so verify it on the Mac:

- `GET /healthz` (no secret) answers `{ok, version, uptime, jobs: {name: last
  run}, upstreams: {…}}`. The `jobs` map is the evidence — after a day, every
  daily job should carry a recent timestamp.
- One job by hand, without waiting for its hour:
  `curl -X POST -H "Authorization: Bearer $WORKER_SECRET" http://127.0.0.1:8787/jobs/notifications`
- `notifications` is the one to test first, because it is both the most
  consequential and the easiest to confirm: run it and see whether a queued
  outbox row actually leaves.

## 6. Where the site is served from (answered 2026-11-24)

The owner confirmed it: the **Mac Mini**. Verified from this machine —
`http://localhost:3000` answers exactly as production does (`/` 307 to the
locale, `/api/mobile/summary` 401, `/en/oauth/consent` 404 because that page is
only on `plugin-phases`), and `https://gestaltung360.com/api/mobile/summary`
answers the same 401. That is why Vercel reports no deployment while the live
site serves current code, and why no `x-vercel-id` comes back: Cloudflare is in
front of the Mac, not of Vercel.

The deployment is a **git worktree** of
`/Users/mohmmad/Projects/gestaltung-company-webpage/gestaltung`, checked out
detached at `origin/main` in `…/gestaltung-live` (`ops/mac/1-build-live-site.command`
creates it with `git worktree add --detach`), booted by a hand-written
`server.mjs` bound to `127.0.0.1:3000` behind a Cloudflare Tunnel. `.next` there
was built 2026-11-23 20:56. Its `.git` is a worktree pointer file, not a
directory, which is why reading `.git/HEAD` there appears to fail.

**`server.mjs` was not in this repository** until the commit that added this
file; it was the only file at the root of the deployed copy that this branch did
not have. It was not untracked by accident: it is applied to the live worktree
by `live-scripts/patches/03-self-host-custom-server.patch`, one of eight local
patches that `live-scripts/apply-patches.sh` re-applies on every deploy — and
whose own header says each patch "should either be merged upstream or dropped
once upstream has it". Now that upstream has it, patch 03 should be deleted.
Leaving it is safe (a pure new-file patch whose file already exists with the same
bytes is detected as already applied and skipped), but a byte of drift between
the two copies would fail the patch and abort a deploy. Its header carries the
reasoning for its own existence: `next start
-H 127.0.0.1 -p 3000` makes Next build every request's absolute origin as
`http://localhost:3000` in `attachRequestMeta()`, which then feeds
`middleware.ts`, the Supabase auth callback and the YouTube `redirect_uri`, and
`experimental.trustHostHeader` does not help in a self-hosted server (verified
against 15.5.28). That is hard-won knowledge living in one untracked file on one
machine. It belongs in git.

The same was true of everything around it, so the rest of that folder is now
copied into `ops/mac/` — the deploy script, the launch-agent installers, the
health check, the cron, the other seven patches and the Mac's own notes. Patch
03 is deliberately not among them, since `server.mjs` is tracked at the root
instead. `ops/mac/README.md` explains that the Mac remains the source of truth,
and flags that patch 02 is load-bearing: `update-live.command`'s zero-downtime
build depends on the `distDir: process.env.NEXT_DIST_DIR` line that only that
patch adds, so dropping it without upstreaming `distDir` would make the next
deploy build on top of the running site.

Consequences worth carrying into the other docs:

- Deploying is building on the Mac and restarting `server.mjs`, not a git push.
  The "four minutes" figure from Vercel's build times does not apply.
- `vercel.json` is inert: its crons do not fire. Its `www` to apex redirect is
  already replaced in `next.config.mjs` by patch 02, so that one needs nothing.
- The worker and the site are on the same machine, which is why
  `REVALIDATE_URL` can be loopback (section 4).

Still open: **whether worker part A is actually installed.** `docs/WORKER.md`
says "part A live", while `CLAUDE.md` said the Mac Mini install was postponed on
2026-11-11 and nothing had moved to it. One of those is stale, and which one
decides whether section 3 is a five-minute switch-on or a from-scratch install.
