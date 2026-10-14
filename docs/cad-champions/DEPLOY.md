# CAD Champions: deployment guide (owner)

CAD Champions (CC) deploys with the rest of gestaltung360.com: push to `main`, Vercel builds. Nothing in this file creates an account or a paid service for you; where a paid or optional service is mentioned, you decide.

Do the sections in this order: 1 env vars, 2 Supabase, 3 grader, 4 crons and monitoring, 5 verify on the live domain, 6 (later, at launch) remove noindex.

## 1. Production environment variables

Set in Vercel: Project, Settings, Environment Variables, tick Production (and Preview if you test there). Redeploy after changing any `NEXT_PUBLIC_*` value (they are baked in at build time). Never put a secret in a `NEXT_PUBLIC_*` variable.

Required means: CC does not work, or a part of it is switched off, without it. "Public" means the value reaches the browser.

| # | Variable | Required? | Public? | Where the value comes from | What breaks without it |
|---|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase dashboard, Project Settings, API, Project URL | Nothing works (no sign-in, no data) |
| 2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Same page, publishable (anon) key | Nothing works |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | Yes | No | Same page, service_role (secret) key. Never share it | Server features fail: grading, payments, admin, crons, monitoring |
| 4 | `RESEND_API_KEY` | Yes | No | Resend dashboard, API Keys (already used by the main site) | No emails: payment confirmations, results, alerts, weekly progress. Pages still work |
| 5 | `RESEND_FROM` | Yes | No | Verified sender, e.g. `Gestaltung <noreply@contact.gestaltung360.com>` | Emails go from Resend's shared test sender |
| 6 | `CRON_SECRET` | Yes | No | You make it up: a long random string. Vercel sends it as `Authorization: Bearer ...` to its crons | All `/api/cron/*` routes answer 500 or 401: no payment expiry, no reminders, no alerts |
| 7 | `GRADER_URL` | Yes for auto-grading | No | The URL printed by `gcloud run deploy cad-grader` (section 3), no trailing slash | STEP tasks go to manual review ("Checking manually"); practice upload does a header-only check |
| 8 | `GRADER_SECRET` | Yes for auto-grading | No | The same string stored in Google Secret Manager as `GRADER_SECRET` | Same as above |
| 9 | `ANTHROPIC_API_KEY` | Optional | No | Anthropic console (console.anthropic.com), API keys. Paid per use: you decide | AI drawing check and comment translation off; every drawing goes to trainer review |
| 10 | `ANTHROPIC_MODEL` | Optional | No | Model id; default `claude-sonnet-5-5` | Default is used |
| 11 | `BUNNY_LIBRARY_ID` | For lesson videos | No | Bunny dashboard, Stream, your library, the library id (a number) | Lessons show "Video coming soon" |
| 12 | `BUNNY_TOKEN_KEY` | For lesson videos | No | Bunny dashboard, Stream, library, Security, Embed view token authentication key | Same |
| 13 | `BUNNY_CDN_HOST` | Optional | No | Embed host; default `iframe.mediadelivery.net` | Default is used |
| 14 | `FAWRAN_ALIAS` | Needed before sales | No | Your Fawran alias (falls back to `lib/company.ts`, C.R. 236988) | Students see the fallback details |
| 15 | `FAWRAN_MOBILE` | Optional | No | Mobile number registered for Fawran | Row hidden |
| 16 | `FAWRAN_IBAN` | Needed before sales | No | Your bank (QIIB) | IBAN falls back to `lib/company.ts` |
| 17 | `FAWRAN_ACCOUNT_NAME` | Needed before sales | No | Account holder name as the bank shows it | Falls back to `lib/company.ts` |
| 18 | `FAWRAN_BANK_NAME` | Needed before sales | No | e.g. Qatar International Islamic Bank (QIIB) | Falls back to `lib/company.ts` |
| 19 | `CC_PAYMENTS_ALERT_EMAIL` | Optional | No | Where "new payment proof" alerts go | Goes to `STORE_LEAD_EMAIL` / info@gestaltung360.com |
| 20 | `CC_ALERT_EMAIL` | Optional | No | Where monitoring alerts go (section 4) | Falls back to `CC_PAYMENTS_ALERT_EMAIL`, then `STORE_LEAD_EMAIL` |
| 21 | `STORE_LEAD_EMAIL` | Already set for the main site | No | Owner inbox | Falls back to info@gestaltung360.com |
| 22 | `SKIPCASH_ENABLED` | Leave empty (card payments OFF) | No | Set to `true` only when you decide to switch cards on | Card / Apple Pay button hidden (intended for now) |
| 23 | `SKIPCASH_BASE_URL` | Only with SkipCash | No | `https://skipcashtest.azurewebsites.net` (sandbox) or `https://api.skipcash.app` | Sandbox default |
| 24 | `SKIPCASH_CLIENT_ID` | Only with SkipCash | No | SkipCash merchant portal | Card payments stay off |
| 25 | `SKIPCASH_KEY_ID` | Only with SkipCash | No | SkipCash merchant portal | Same |
| 26 | `SKIPCASH_KEY_SECRET` | Only with SkipCash | No | SkipCash merchant portal | Same |
| 27 | `SKIPCASH_WEBHOOK_KEY` | Only with SkipCash | No | SkipCash merchant portal; webhook URL to register: `https://gestaltung360.com/api/cad-champions/payments/skipcash/webhook` | Webhooks are refused |
| 28 | `CC_RECEIPT_CR_NUMBER` | Optional | No | Your C.R. number | Falls back to `lib/company.ts` (236988) |
| 29 | `CC_RECEIPT_ADDRESS_EN` | Optional | No | Address line printed on receipts | Falls back to `lib/company.ts` |
| 30 | `CC_RECEIPT_ADDRESS_AR` | Optional | No | Same, Arabic | Falls back to `lib/company.ts` |
| 31 | `WHATSAPP_NUMBER` | Recommended | No | Digits only with country code, e.g. `974XXXXXXXX` | Falls back to `NEXT_PUBLIC_WHATSAPP_NUMBER`; if neither is set the WhatsApp row in "Need help?" is hidden |
| 32 | `NEXT_PUBLIC_WHATSAPP_NUMBER` | Already set for the main site | Yes | Same number | See above |
| 33 | `SUPPORT_EMAIL` | Optional | No | Support address shown in "Need help?" | Default info@gestaltung360.com |
| 34 | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Optional | Yes | Cloudflare Turnstile widget (free, in your own Cloudflare account); see `docs/TURNSTILE.md` | Bot check off on sign-in, sign-up and password reset |
| 35 | `TURNSTILE_SECRET_KEY` | Optional | No | Same widget | Same |
| 36 | `CC_REPORT_PDF` | Optional | No | Set to `off` to serve the results report as printable HTML instead of a PDF | PDF renderer is used when available |
| 37 | `CC_DEV_GALLERY` | Leave empty | No | `1` shows the dev UI gallery | Gallery hidden (correct for production) |

That is 37 variables. Of these, 8 are needed for a working launch (1 to 8), 5 for taking Fawran payments properly (14 to 18), 3 for lesson videos and AI (9, 11, 12), and the rest are optional or already set for the main site. Verify the list against `.env.example` (the CC section at the top) before launch.

The grader service (Cloud Run, not Vercel) has its own two variables: `GRADER_SECRET` (from Secret Manager) and optionally `GRADER_ALLOWED_URL_PREFIXES` (set by the deploy command in `grader/README.md`).

## 2. Supabase production project

The site's Supabase project is the production one (`jgwuafubtmpaonsznfyw`). `.env.local` already points at it, so be careful: SQL you run there is live.

### 2.1 Migrations (run by hand in the SQL editor, in this order)

Open Supabase, SQL Editor, paste each file, run. Each file says "RUN AFTER" in its header; they are safe to re-run.

| Order | File | Needs | What it does |
|---|---|---|---|
| 1 | `0077_cc_core.sql` | 0076 | All `cc_` tables, helpers, RLS, seeds |
| 2 | `0078_cc_storage.sql` | 0077 | The private storage buckets and their policies |
| 3 | `0079_cc_help_articles_seed.sql` | 0077, 0078 | Help Center articles (English and Arabic) |
| 4 | `0080_cc_diagnostic_seed.sql` | 0079 | Diagnostic test seed (tasks, aspects); raises `cc-submissions` to 300 MB |
| 5 | `0081_cc_results.sql` | 0080 | Results emails and share link |
| 6 | `0082_cc_drawing_rubric.sql` | 0081 | Drawing check rubric |
| 7 | `0083_cc_training_seed.sql` | 0082 | Training schema additions and seed |
| 8 | `0084_cc_payments.sql` | 0083 | Plans, checkout, payments, enrollment |
| 9 | `0085_cc_admin.sql` | 0084 | Admin panel tables |

If you already ran some of them, run only the ones after the last you ran. Further CC migrations written after this file was made will appear in `supabase/migrations/` with a higher number; read their headers.

### 2.2 Buckets (created by 0078, check them)

Supabase, Storage. These five must exist and show **Private** (not Public):

- `cc-task-files`
- `cc-answer-files`
- `cc-lesson-files`
- `cc-submissions`
- `cc-payment-proofs`

Also check Storage, Settings: the global upload limit must be at least 300 MB, or module-package ZIP uploads fail even though the bucket allows them.

### 2.3 Daily backups

Backups depend on your Supabase plan. Check: Supabase dashboard, Database, Backups.

- If scheduled daily backups are listed (paid plans), confirm yesterday's backup is there and note the retention period.
- If the page says no scheduled backups (the free plan), you have none. Choose: upgrade (your decision, not mine), or take a manual dump before launch and weekly while students are paying (`supabase db dump` from the Supabase CLI, or the dashboard's database export). Keep it somewhere private.
- Database backups do not include the files in Storage buckets (student uploads, payment proofs). Say so to yourself when deciding about retention.

### 2.4 Auth emails and SMTP sender

- Follow `docs/cad-champions/AUTH_EMAILS.md`: paste the three templates from `supabase/auth-templates-cc/` (confirm sign-up, magic link, reset password) and choose option (a) or (b) described there. One template per type is shared with the main site.
- Check the Redirect URLs in Authentication, URL Configuration (the `https://gestaltung360.com/**` forms).
- SMTP sender: see `docs/AUTH_EMAILS.md` (Resend SMTP, sender `noreply@contact.gestaltung360.com`, domain already verified). Without custom SMTP Supabase's built-in sender is rate limited to a few emails per hour and would block a class signing up at once.
- Send yourself a test sign-up from `/cad-champions/ar/sign-up` and confirm the email arrives and the link lands in the CC dashboard.

## 3. Grader on Cloud Run

Full steps are in `grader/README.md` (section "Deploy") and `docs/cad-champions/GRADER.md`. Summary:

1. The production secret: create a long random string, store it in Google Secret Manager as `GRADER_SECRET`, and put the same string in Vercel as `GRADER_SECRET`. Rotate by adding a new secret version, redeploying, then updating Vercel.
2. Deploy command (PowerShell, from the repo root):

```powershell
gcloud run deploy cad-grader --source ./grader --region me-central1 --memory 2Gi --cpu 1 --concurrency 2 --min-instances 0 --max-instances 3 --timeout 120 --allow-unauthenticated --set-secrets GRADER_SECRET=GRADER_SECRET:latest --set-env-vars GRADER_ALLOWED_URL_PREFIXES=https://jgwuafubtmpaonsznfyw.supabase.co/storage/v1/object/sign/
```

3. Copy the printed service URL into Vercel as `GRADER_URL` (no trailing slash), redeploy the site.
4. Check: open `<GRADER_URL>/health`; it must return `{"ok": true, ...}`. Then run one practice upload in Get Ready.

### Minimum instances and cost

`--min-instances 0` (default): the service scales to zero when idle and you pay nothing while idle. The first request after a quiet period waits roughly 10 to 20 seconds while CadQuery loads (a "cold start"). Fine for normal days, not for a scheduled test day when many students submit within minutes.

`--min-instances 1`: one instance stays warm all day, so there is no cold start, but it is billed for every second it exists.

Formula for the warm-instance cost per day (instance-based billing):

```
seconds per day (86,400) x [ vCPU count x price per vCPU-second  +  GiB of memory x price per GiB-second ]
```

With this service's settings that is 1 vCPU and 2 GiB, so: `86,400 x (1 x vCPU price + 2 x GiB price)`. Prices depend on the region (`me-central1`) and on how the service is billed (idle versus active rates, request-based versus instance-based), and Google changes them. Look the two prices up on the Cloud Run pricing page for your region and plug them in. `grader/README.md` gives a rough planning figure of a few US dollars per day; treat it as an estimate and recompute.

Practice:

```powershell
# the day before a scheduled test day (or the morning of)
gcloud run services update cad-grader --region me-central1 --min-instances 1
# the day after
gcloud run services update cad-grader --region me-central1 --min-instances 0
```

Put a reminder in your calendar for the switch back. Forgetting costs the daily figure above for every extra day. In Google Cloud, Billing, Budgets and alerts, you can set a budget alert so a forgotten warm instance emails you (a budget does not stop spending by itself).

## 4. Crons and monitoring

### 4.1 Schedule the CC cron routes

`vercel.json` currently schedules the main-site crons only. The CC routes exist but are **not scheduled anywhere** (checked: `vercel.json` has no `cc-` entry and no other scheduler is configured). Until you add them:

- `cc-payments-expire`: unpaid reservations do not expire, seats are not released, enrollment reminders and the monitoring alerts (4.2) never run.
- `cc-weekly-progress`: the weekly progress email is never sent.

Add these entries to the `crons` array in `vercel.json` (I did not edit the file; do it at deploy):

```json
{ "path": "/api/cron/cc-payments-expire", "schedule": "0 * * * *" },
{ "path": "/api/cron/cc-weekly-progress", "schedule": "0 6 * * 0" }
```

Both routes check `Authorization: Bearer $CRON_SECRET`. Vercel sends that header automatically to its own crons when `CRON_SECRET` is set. Manual test (PowerShell):

```powershell
curl.exe -H "Authorization: Bearer YOUR_CRON_SECRET" https://gestaltung360.com/api/cron/cc-payments-expire
```

The answer is JSON with the payments counts and a `monitoring` block.

**Plan limit.** The hourly schedule above needs a Vercel plan that allows hourly crons. On the Hobby plan, Vercel only runs a cron once per day (and may fire it anywhere inside the scheduled hour); check the current limits in Vercel's cron documentation, since they change. On Hobby use a daily schedule, `"0 2 * * *"`, for `cc-payments-expire`. Consequences: a reservation can live up to about 24 hours past its 48 hours, and the alert email below arrives at most once a day, not within the hour.

**Free fallback for an hourly run on Hobby (your decision).** Call the same URL hourly from a free external scheduler that can send a header. Two options: a scheduled GitHub Actions workflow in your repository (`on: schedule: - cron: '0 * * * *'` running `curl -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://gestaltung360.com/api/cron/cc-payments-expire`, secret stored under the repo's Settings, Secrets), or a free cron service such as cron-job.org with the header set. Scheduled GitHub workflows can run a few minutes late. I have not set up either; signing up is your call.

### 4.2 The alert email (implemented)

`cc-payments-expire` now also runs a monitoring check after the payments work. Code: `lib/cad-champions/monitoring/alerts.ts` (pure rules, tested in `alerts.test.ts`) and `alerts-server.ts` (reads, sends).

- Alert 1: more than 3 failed grading calls (rows in `cc_grading_logs` with an `error`) in the last hour.
- Alert 2: any item in the review queue (`cc_task_results` with status `ai_pending_review` or `error`) older than 48 hours.
- Sent to `CC_ALERT_EMAIL`, else `CC_PAYMENTS_ALERT_EMAIL`, else `STORE_LEAD_EMAIL` / info@gestaltung360.com, through Resend (same sender as the other emails).
- At most one email per alert combination per hour (Resend idempotency key), so an hourly cron does not spam you while a problem persists (it repeats each hour, which is the reminder).
- If the CC tables do not exist yet, or the email key is missing, it quietly does nothing and reports `skipped` in the JSON answer. It never fails the payments run.

### 4.3 Optional: error tracking (Sentry)

Sentry has a free tier. It is optional and not set up; no sign-up was made. If you decide to use it you would need to create the account, then ask for the SDK to be added to the site and (separately) to the grader. Without it, errors are in Vercel, Logs and `gcloud run services logs read cad-grader --region me-central1 --limit 100`.

### 4.4 Optional: uptime checks

Free options: UptimeRobot's free plan or Better Stack's free plan (5-minute or longer intervals), checking `https://gestaltung360.com/cad-champions/en` and `<GRADER_URL>/health`. Both need you to create an account; you decide. Cloud Run also has Cloud Monitoring uptime checks in your own Google Cloud project (check the current free allowance on their pricing page).

## 5. Verify on the live domain

After deploy, in a private window:

1. `https://gestaltung360.com/cad-champions` redirects to `/cad-champions/en` (English is the default; Arabic only if you switched).
2. `/cad-champions/en`, `/cad-champions/ar`, `/cad-champions/en/help`, `/privacy`, `/terms`, `/refunds` load; the Arabic ones are right-to-left.
3. A signed-in page (`/cad-champions/en/dashboard`) redirects to sign-in.
4. View source on the landing: `<link rel="alternate" hreflang="en">`, `hreflang="ar"` and `x-default` point to `/cad-champions/en` and `/cad-champions/ar`.
5. Response header `x-robots-tag: noindex, nofollow` is present (it must be, until launch). `curl.exe -I https://gestaltung360.com/cad-champions/en`.
6. `https://gestaltung360.com/robots.txt` and `/sitemap.xml` load. Today they list no CC pages (see 6).
7. Run the smoke test on your phone (LAUNCH.md).

## 6. Removing noindex at launch (owner decides; not done)

CC pages are noindex in two places. Both must change for Google to index public pages. Do not make private pages indexable.

**1. `middleware.ts`** (CC branch, around lines 120 to 152). The constant `const CC_ROBOTS = "noindex, nofollow";` is sent on three responses with `res.headers.set("X-Robots-Tag", CC_ROBOTS);` (the redirect branch, the sign-in redirect branch, and the main rewrite branch). At launch:

- Keep the header for private paths. Use `isCcProtected(rest)` (already imported in that file; `lib/cad-champions/auth/paths.ts`) and also keep it for auth screens (`CC_AUTH_PAGES`), `/verify` and `/results/share`.
- Skip the header (or set `index, follow`) only for the public pages: landing, `/help`, `/privacy`, `/terms`, `/refunds`, and any other public page you want found (training is signed-in only today).
- Practical change: in the rewrite branch (the last `res.headers.set("X-Robots-Tag", CC_ROBOTS);`, line 152) wrap it: set the header unless the path is one of the public indexable pages. Leave the two redirect branches as they are (redirects are not indexed).

**2. `lib/cad-champions/metadata.ts`**. `export const CC_ROBOTS = { index: false, follow: false }` (line 11) is used by `ccLayoutMetadata` (line 27, `robots: CC_ROBOTS`) which applies to every CC page through the layout. At launch:

- In `ccLayoutMetadata`, remove `robots: CC_ROBOTS` (or set `{ index: true, follow: true }`), then give each private page its own `robots: CC_ROBOTS` in its `generateMetadata` (dashboard, get-ready, test, results, training, admin, onboarding, account, auth screens).
- `results/share/[token]/page.tsx` and `verify/[code]/page.tsx` already set `robots: CC_ROBOTS` themselves; keep them.
- Safer alternative if you want the simplest edit: keep the layout noindex and add an indexable override only on the public pages.

**3. Sitemap and robots** (`app/sitemap.ts`, `lib/seo.ts`). Today `SITEMAP_STATIC_PATHS` has no CC entries and `ROBOTS_DISALLOW` has no CC entries. At launch add the public CC URLs for both locales, in the form `/cad-champions/en`, `/cad-champions/ar`, `/cad-champions/en/help`, `/cad-champions/ar/help`, privacy, terms and refunds. Note: `entryFor(locale, path)` builds the main-site `/{locale}/path` form, so CC needs its own entry builder using `ccPath(locale, path)` from `lib/cad-champions/routes.ts` (never the `/ar/cad-champions` form). Add to `ROBOTS_DISALLOW` the private CC paths (`/cad-champions/en/dashboard`, `/admin`, `/test`, `/results`, `/account` and the Arabic forms) as a second layer.

**4. Check on the live domain after the change.**

- `curl.exe -I` on `/cad-champions/en`: no `x-robots-tag: noindex`. On `/cad-champions/en/dashboard`: still noindex (or a redirect to sign-in).
- View source: no `<meta name="robots" content="noindex">` on public pages; hreflang and canonical still point to `/cad-champions/{en,ar}`.
- `/sitemap.xml` lists the CC pages once each per locale, all returning 200.
- Google Search Console (free, your account): submit the sitemap and use URL Inspection on the landing.
- Re-run Lighthouse SEO (see `QA.md`); expect 90 or more now that the indexing warning is gone.
