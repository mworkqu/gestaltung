# The Mac Mini worker — runbook

Phase 3 of the 2026-11 consolidation. Vercel keeps the public site, the store, checkout and sign-in. The Mac Mini runs the slow and scheduled work as ONE service, `services/worker`, reached from the internet through a free tunnel.

**Status (2026-11-10): part A only.** The worker exists and can run the eight scheduled jobs. It is OFF: until you finish the steps below and flip the switch (step 11), everything keeps running in Vercel exactly as today. Part B (long AI steps, CAD and grading calls) comes later.

## What changes when the Mac is off

| Keeps working (Vercel) | Pauses (Mac Mini) |
|---|---|
| Public site, store, product pages, cart, checkout, orders | Scheduled jobs run on the Mac once the switch is on. If the Mac is down, Vercel notices within seconds and runs the daily crons itself (step 11), so they are not lost. The two CAD Champions jobs (hourly payments expiry, weekly progress email) are not in Vercel's cron list and wait for the Mac. |
| Sign-in, accounts, dashboard, admin pages | After part B: AI steps (idea chat, circuits, CAD models) and grading |

## 1. Install Docker Desktop

1. On the Mac Mini, download Docker Desktop for Mac (Apple silicon) from <https://www.docker.com/products/docker-desktop/> and install it.
2. Licence: Docker Desktop is free for a business with **fewer than 250 employees AND less than US$10 million annual revenue** (Docker subscription service agreement, section 4.2; <https://www.docker.com/pricing/faq/>). Gestaltung qualifies today. If either number is ever crossed, a paid Docker subscription is required (or switch to a free engine such as Colima). Choose "Personal" when asked; never pick a paid plan.
3. Docker Desktop → Settings → General: tick **Start Docker Desktop when you sign in to your computer**.

## 2. Keep the Mac awake and running

1. System Settings → Energy (or Battery → Options on some versions): turn on **Prevent automatic sleeping when the display is off** and **Start up automatically after a power failure**.
2. System Settings → General → Software Update → Automatic updates: keep security updates on, but turn off "Install macOS updates" automatic restarts if you prefer to restart yourself.
3. After a restart, sign in to the Mac once: Docker Desktop starts with your login and brings the containers back (`restart: unless-stopped`). Automatic login is possible (Users & Groups) but only with FileVault off; your choice.

## 3. Get the code

In Terminal on the Mac:

```bash
cd ~
git clone https://github.com/mworkqu/gestaltung.git
cd gestaltung/services
cp .env.example .env
```

## 4. Make the shared secret

```bash
openssl rand -base64 48
```

Copy the result. It is `WORKER_SECRET`: it goes into `services/.env` (step 5) and into Vercel (step 10). Do not paste it into chats or emails.

## 5. Fill in `services/.env`

Open it with `open -e .env` and type each value yourself. Where each value comes from:

| Name | Where to find it |
|---|---|
| `WORKER_SECRET` | Step 4 |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (the same values as in Vercel) |
| `NEXT_PUBLIC_SITE_URL` | `https://gestaltung360.com` |
| `REVALIDATE_URL` | Leave empty (cache purges go to the site) |
| `WORKER_SCHEDULES` | Leave empty. `off` stops the worker's own timetable. |
| `RESEND_API_KEY`, `RESEND_FROM`, `STORE_LEAD_EMAIL`, `CC_ALERT_EMAIL`, `CC_PAYMENTS_ALERT_EMAIL` | Vercel → Project → Settings → Environment Variables (copy each value; blank ones stay blank) |
| `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET` | Vercel environment variables |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `INTEGRATIONS_ENC_KEY` | Vercel environment variables (YouTube retire job) |
| `ORDER_RATING_SECRET` | Vercel environment variables (rating links in delivered-order emails) |
| `CAD_WORKER_TOKEN`, `GRADER_SECRET`, `GRADER_ALLOWED_URL_PREFIXES` | Part B. Leave empty for now. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Step 8 |

Vercel shows "Sensitive" values only once; if one cannot be read back, make a new one at its source (Supabase, Resend, …) and update Vercel too.

## 6. Start it

```bash
cd ~/gestaltung/services
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
curl http://127.0.0.1:8787/healthz
```

The first build takes a while (the CAD images run their tests while building). `healthz` answers `{"ok":true,"version":"…","uptime":…,"jobs":{…}}`. Logs: `docker compose logs -f worker`.

Log rotation is set in `compose.yaml` (each container keeps at most 5 files of 10 MB).

## 7. Tunnel: move the DNS to Cloudflare (once)

The public address will be `https://worker.gestaltung360.com`. Cloudflare Tunnel needs the domain's DNS on Cloudflare: on the Free plan only a "full setup" (Cloudflare becomes the nameserver) is offered (<https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/>). The domain stays registered at Squarespace; only its nameservers change.

What it involves:

1. Cloudflare dashboard → **Onboard a domain** → `gestaltung360.com` → choose the **Free** plan.
2. Cloudflare scans the existing records. The scan can miss some. Before switching, make sure **every row of the table below** exists in Cloudflare, and compare with **Squarespace → Domains → gestaltung360.com → DNS** (anything there that is not in the table must be copied too).
3. Set the **Proxy status** of the Vercel records (`@` A and `www` CNAME) to **DNS only** (grey cloud). Vercel recommends connecting directly, not through a proxy (<https://vercel.com/kb/guide/cloudflare-with-vercel>): a proxy breaks Vercel's own bot protection, adds a second cache that can serve stale pages after a deploy, and hides visitors' IPs. Mail records are never proxied.
4. If DNSSEC is on at Squarespace, turn it off first (changing nameservers with DNSSEC on can take the domain offline).
5. Squarespace → Domains → gestaltung360.com → DNS → Nameservers → use custom nameservers → paste the two Cloudflare nameservers exactly.
6. Wait (up to 24 hours) until Cloudflare emails that the domain is Active. The site and email keep working during the switch if the records match.
7. Check: <https://gestaltung360.com> opens, Vercel → Domains still shows "Valid Configuration", send yourself an email to info@gestaltung360.com, and place nothing else until both work.

Records found by public lookup on 2026-11-10 (read-only; `nslookup` against 8.8.8.8):

| Type | Name | Value | Proxy status |
|---|---|---|---|
| A | `@` | `76.76.21.21` (Vercel) | DNS only |
| CNAME | `www` | `cname.vercel-dns.com` | DNS only |
| MX | `@` | `smtp.google.com`, priority 1 (Google Workspace mail) | — |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | — |
| TXT | `google._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqh…` (long key: copy it whole from Squarespace) | — |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | — |
| MX | `contact` | `inbound-smtp.ap-northeast-1.amazonaws.com`, priority 20 (Resend, sending domain `contact.gestaltung360.com`) | — |
| TXT | `resend._domainkey.contact` | `p=MIGfMA0GCSqGSIb3…` (Resend DKIM key: copy it whole from Squarespace or Resend → Domains) | — |
| MX | `send.contact` | `feedback-smtp.ap-northeast-1.amazonses.com`, priority 10 | — |
| TXT | `send.contact` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `worker` | created by the tunnel in step 8 | Proxied (tunnel records must be) |

Could NOT be discovered from outside (check them in the Squarespace DNS panel): any record at a name nobody publishes (other subdomains, other DKIM selectors, SRV records), verification TXT records that may have been removed from the apex, CAA records (the Windows lookup tool cannot query CAA), and the TTLs. No AAAA record exists for `@`. `_dmarc.contact` has no record.

Cost: Cloudflare DNS and Tunnel are free (Free plan; the Tunnel docs list it as available on all plans, <https://developers.cloudflare.com/tunnel/>). Nothing here needs a paid plan. If Cloudflare ever asks you to pick a paid plan or add a card for this, stop: it is not needed.

## 8. Tunnel: create it and point it at the worker

1. Cloudflare dashboard → **Networking → Tunnels → Create a tunnel** → name it `mac-mini` → **Create Tunnel**.
2. On the install screen choose **Docker**. Do not run the command it shows; copy only the long token after `--token` into `CLOUDFLARE_TUNNEL_TOKEN` in `services/.env`.
3. On the Mac: `cd ~/gestaltung/services && docker compose --profile tunnel up -d`. The tunnel shows **Healthy** in Cloudflare after a few seconds.
4. In the tunnel: **Routes → Add route → Published application**: subdomain `worker`, domain `gestaltung360.com`, Service URL `http://worker:8787` → **Add route**. Cloudflare creates the `worker` record itself.
5. Check from any computer: `https://worker.gestaltung360.com/healthz` answers `{"ok":true,…}`.

(Reference: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/>.)

**Fallback without moving DNS: Tailscale Funnel.** If you would rather not move the nameservers, install Tailscale on the Mac (free Personal plan), turn on Funnel for the Mac in the Tailscale admin console and run `tailscale funnel --bg 8787`. The worker is then at a stable `https://<mac-name>.<tailnet>.ts.net` address (Funnel only uses your tailnet's `ts.net` name and ports 443/8443/10000; it is still marked beta and has bandwidth limits; <https://tailscale.com/kb/1223/funnel>). Use that address as `WORKER_URL` in step 10 and skip steps 7 and 8. Nothing in the app changes.

## 9. Run the migration

In Supabase → SQL editor, run `supabase/migrations/0111_worker_switch.sql` (after the app commit that ships it is deployed). It only adds `store_settings.worker = {"enabled": false}`; nothing changes yet.

## 10. Vercel environment variables

Vercel → Project → Settings → Environment Variables → Production:

| Name | Value |
|---|---|
| `WORKER_URL` | `https://worker.gestaltung360.com` (or the `ts.net` address) |
| `WORKER_SECRET` | the value from step 4 (mark it Sensitive) |

They take effect with the next production deployment. Without both, the site never contacts the worker, whatever the switch says.

## 11. Switch on, switch off

Supabase → SQL editor:

```sql
-- on: Vercel crons forward to the worker; the worker runs its own timetable
update public.store_settings set value = '{"enabled": true}'::jsonb, updated_at = now() where key = 'worker';

-- off: everything back in Vercel (takes effect within about a minute)
update public.store_settings set value = '{"enabled": false}'::jsonb, updated_at = now() where key = 'worker';
```

While ON:
- The worker runs each job on its own timetable (Qatar time, table below).
- Vercel's crons still fire (they stay in `vercel.json` until the cut-over). Each one checks the worker: healthy → it forwards and the worker answers from the run it just did (no second run within 6 hours; 30 minutes for the hourly job); down (2 failed checks within 60 s) or the worker refuses → Vercel runs the job itself as before. If the worker accepted the run but did not answer in time, Vercel does NOT run it again (it may still be running) and the cron answers 504.
- Manual run of one job on the Mac: `curl -X POST -H "Authorization: Bearer $WORKER_SECRET" http://127.0.0.1:8787/jobs/notifications`.

While OFF (or the row is missing): the worker's timetable skips every run, and Vercel runs everything as today.

## 12. Update the worker

```bash
cd ~/gestaltung && git pull
cd services && GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
curl http://127.0.0.1:8787/healthz   # "version" shows the new commit
```

## 13. After one healthy week (NOT done yet)

- [ ] Remove the six `crons` from `vercel.json` (the worker is then the only scheduler; the Vercel routes stay for manual runs and as a fallback trigger).
- [ ] Part B: move the long AI routes, the heavy admin jobs and the CAD/grading calls to the worker, then remove the old in-Vercel paths.
- [ ] Retire the Cloud Run services (cad-worker, grader) once the Mac serves them.

---

## For developers

**Surface.** `GET /healthz` (no secret) → `{ok, version, uptime, jobs: {name: last run}}`. `POST /jobs/<name>` with `Authorization: Bearer <WORKER_SECRET>` (constant-time) → `{job, run_id, status, body, ms, source, deduped?}`, where `status` + `body` are exactly what the job's Vercel route answers; 401 bad secret, 404 unknown job, 409 already running, 413 body over 16 KiB, 400 bad JSON, 403 Origin other than `https://gestaltung360.com` / `http://localhost:3000`. Logs are one JSON line each; secrets, emails, phone numbers, tokens and briefs are redacted.

**Jobs** (`lib/cron/jobs.ts` is the one definition; the Vercel routes and the worker run the same code):

| Job | Vercel (UTC) | Worker (Asia/Qatar, UTC+3) |
|---|---|---|
| supplier-refresh | `0 2 * * *` | `0 5 * * *` |
| voltaat-sync | `0 3 * * *` | `0 6 * * *` |
| delivery-promises | `0 4 * * *` | `0 7 * * *` |
| notifications | `30 4 * * *` | `30 7 * * *` |
| anonymous-cleanup | `0 5 * * 0` | `0 8 * * 0` |
| youtube-retire | `0 7 * * *` | `0 10 * * *` |
| cc-payments-expire | not scheduled (docs: `0 * * * *`) | `0 * * * *` (hourly) |
| cc-weekly-progress | not scheduled (docs: `0 6 * * 0`) | `0 9 * * 0` |

**Cache purges.** The worker cannot call `revalidateTag`; after a job that changed the storefront it calls `POST /api/internal/revalidate` (Bearer `WORKER_SECRET`, only the storefront tag shapes from `lib/cache/catalog-tags.ts`), so the per-SKU purge of Phase 2 is kept.

**Rules for worker code.** The worker bundles `lib/**` through the `@/` alias (`npm run worker:build`); the build fails if anything resolves to `next/*`, `react` or `server-only`. When a module the worker needs imports one of those, split the pure part into its own file and have the Next wrapper import it (done in part A: `notifications/links-core.ts`, `notifications/drain-core.ts`, `integrations/youtube-retire-core.ts`, `cad-champions/training/data.ts`, `cad-champions/payments/coupon-server.ts`).

**User tokens (part B).** `POST /api/worker-token` (session required, guests allowed; 20/min per user) returns a 10-minute HS256 JWT signed with `WORKER_SECRET`: user id, project id (ownership checked), the project's stored tier, `is_admin`. The worker checks it with `verifyUserToken()` (`services/worker/src/user-token.ts`). The token never carries credits: the worker must check and spend credits in the database at the moment it does the paid work.
