# ops/mac — the Mac Mini's own operations scripts

Copies of `~/Projects/gestaltung-company-webpage/live-scripts/`, the folder that
actually runs the live site since hosting moved off Vercel on 2026-11-23.

**The Mac is the source of truth. This folder is a copy.** Nothing here is
executed by the repository, by CI or by a deploy — the scripts on the Mac are
what run, and they reference absolute paths under
`$HOME/Projects/gestaltung-company-webpage` that only exist there. Editing a
file here changes nothing; edit it on the Mac and copy it back. Someone should
eventually wire it the other way round, so the Mac pulls these from a checkout
and this becomes the source of truth. Until then, treat a difference between the
two as the Mac being right and this being stale.

It is tracked for one reason: before this, `update-live.command` — the deploy,
with its staged build and automatic rollback — existed in exactly one place, on
one machine, in no git history. `server.mjs` had the same problem and is now
tracked at the repository root. This folder is the same fix for the rest.

## What is here

| File | What it does |
|---|---|
| `1-build-live-site.command` | First build. Creates `gestaltung-live` as a **git worktree** of `gestaltung` (detached at `origin/main`), copies `.env.local`, applies the patches, `npm ci`, `npm run build`. |
| `2-start-site.command` | Writes the `com.gestaltung.site` launch agent and starts it: `caffeinate -is node server.mjs`, `KeepAlive`, `SITE_HOST=127.0.0.1`, `PORT=3000`, `SITE_ORIGIN=https://gestaltung360.com`. Also passes `VERCEL_GIT_COMMIT_SHA` so the footer still shows the running commit. |
| `3-connect-gestaltung360.command` | Installs `cloudflared`, creates the `gestaltung-mac` tunnel, writes `~/.cloudflared/config.yml` (apex + www → `127.0.0.1:3000`, everything else 404), routes DNS, and runs it as `com.gestaltung.tunnel`. |
| `4-start-health-check.command` | Schedules `mac-health.sh` every 5 minutes as `com.gestaltung.health`. |
| `5-start-voltaat-cron.command` | Writes the `com.gestaltung.cron.voltaat` agent: 24 `StartCalendarInterval` slots, one per hour, each at a fixed-but-different minute between `:20` and `:39`. |
| `stop-site.command` | Boots out health, tunnel and site, in that order. |
| `update-live.command` | **The deploy.** Builds into `.next-build` while the running site keeps serving `.next`, swaps on success, restarts, polls for up to 90 s, and rolls back to the previous build and commit if the new one does not answer. |
| `apply-patches.sh` | Re-applies `patches/*.patch` to the live worktree on every build and deploy. A failed patch aborts the deploy rather than shipping a half-patched tree. |
| `cron-voltaat.sh` | One Voltaat batch: reads `CRON_SECRET`, waits a random 0–59 s, calls the local cron route, redacts the secret from the log. |
| `mac-health.sh` | Probes the public URL through `1.1.1.1` (not the local DNS cache), restarts the site after 3 consecutive failures, restarts the tunnel too if the site answers locally, and e-mails at most once a day. |
| `set-resend-key.command`, `set-resend-key-prompt.command` | How to rotate the Resend key: read it from the clipboard or `/dev/tty`, check it starts `re_`, back up both `.env.local` files, write them `chmod 600`, restart the site, and never echo the key, put it in argv or leave it in shell history. **They contain no key** — they are the procedure, which is worth keeping precisely because the value is not. Run them on the Mac. |
| `CRONS.md` | Which of the six former Vercel crons run here, what each does, and in what order they are worth switching on. |
| `SECURITY.md` | Security posture as of 2026-11-22: no inbound port, firewall and stealth mode on, DNSSEC, Cloudflare rate limit, file modes. |
| `dns-before-cloudflare.txt` | The Squarespace DNS records captured before the nameserver move, including the four `contact.gestaltung360.com` records Cloudflare's scan missed. |

## Deliberately absent

- **`patches/03-self-host-custom-server.patch`.** This created `server.mjs`,
  which is now tracked at the repository root, so the patch is redundant.
  It should be deleted on the Mac **after** the PR that tracks `server.mjs` is
  merged, not before: delete it earlier and the next deploy checks out a `main`
  with no `server.mjs` and restarts the site with nothing to boot.
- **Logs and env files.** `../logs/` and every `.env.local` stay on the Mac.

## The patches, and why they matter

These are changes `origin/main` does not have, re-applied on every deploy.
`apply-patches.sh` says each should be merged upstream or dropped once upstream
has it; none of the seven has been.

| Patch | Touches | Purpose |
|---|---|---|
| `01-cad-cloud-5s-fallback` | `lib/cad/cloud.ts`, its test | CAD falls back to the browser engine after 5 s |
| `02-self-host-next-config` | `next.config.mjs` | `distDir: process.env.NEXT_DIST_DIR \|\| ".next"`, **and** the `www` → apex redirect |
| `04-web-vitals-wiring` | `app/[locale]/layout.tsx`, `lib/analytics.ts` | `web_vitals` event type, mounted in the layout |
| `05-web-vitals-component` | `components/web-vitals.tsx` | the component itself |
| `06-cc-tab-mobile` | `components/home/cad-champions-side-button.tsx` | icon only on phones |
| `07-cc-home-section` | `app/[locale]/page.tsx`, `messages/{en,ar}.json` | EN + AR copy and the home-page mount |
| `08-cc-home-section-component` | `components/home/cad-champions-section.tsx` | the section component |

Two of these deserve attention before anyone tidies up:

**`02` is load-bearing for the deploy.** `update-live.command` builds with
`NEXT_DIST_DIR=.next-build` so the running site is never disturbed, and only
this patch teaches `next.config.mjs` to read that variable. Drop `02` without
upstreaming `distDir` and the next "safe" deploy builds straight into `.next`,
on top of the site that is currently serving. It also carries the `www` → apex
redirect that `vercel.json` used to provide — deliberately in
`next.config.mjs` rather than in middleware, so it also covers `/api`,
`/sitemap.xml`, `/robots.txt` and `/_next`, which the middleware matcher skips.
That redirect is **already handled**; it does not need recreating in Cloudflare.

**`07` is the most fragile.** It is the only patch that edits
`messages/en.json` and `messages/ar.json`, two files that change often
upstream. When it fails, the deploy aborts — safely, but it aborts.

A patch that adds a new file must be its own patch: `git apply` refuses a
combined patch once the file exists, which would abort the whole deploy. That is
why `05` and `08` are separate from `04` and `07`.
