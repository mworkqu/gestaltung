# Fix report — audit merge, live-site QA findings, password reset rebuild

Branch: `fix/review-2026-10`, cut from `origin/main` 88a6473.
Nothing is pushed, nothing is merged, nothing is deployed, no migration has been run.

> **Status: IN PROGRESS.** This file is written as the work lands. Sections marked
> *(pending)* are not finished yet. Do not read a blank row as "nothing to do".

## 1. Summary

Three pieces of work on one branch:

- **Phase A — bring in the 2026-10 code audit.** The audit ran with read-only GitHub
  access, so its 129 commits only ever existed as two diffs. `all-changes.diff` is now
  applied as one commit, the docs it could not carry are restored, the lockfile matches
  `package.json`, and the riskiest things it did were re-reviewed with fresh eyes.
- **Phase B — fix the live-site QA findings** F-001…F-054 from `review/qa/REPORT.md`.
- **Phase C — rebuild password reset and email confirmation** so a link a corporate mail
  scanner has already fetched, or one opened on a different device, still works.

## 2. Findings → status

### Phase A re-reviews

| Item | What was asked | Result |
|---|---|---|
| `0102_credits_server_spend.sql` | `spend_credit_for` is a hand copy of the live `spend_credit` (0096 v4) — diff it line by line | **Clean, no change needed.** Byte-for-byte identical to 0096 lines 319–385 apart from the three lines the on-behalf-of signature requires: the `spend_credit_for(p_user, …)` signature, `v_uid := p_user` instead of `auth.uid()`, and `ai_role_of(p_user)` instead of `ai_role()`. Locking (`for update`, the `credits:` advisory lock), check order, free-vs-paid precedence, ledger columns, the 30-day window, payer-vs-actor (`user_id` = teacher, `created_by` = actor), the `cad_regens_remaining` branch, all four return shapes and both raise paths are unchanged. `ai_role_of(null)` returns `anonymous`, so the `sign_in` path survives. Grants correct: revoked from `public, anon, authenticated`, granted only to `service_role`. |
| `0100_studio_private.sql` | the strip of `engineering_jobs.snapshot` is irreversible — add a backup table written first | **Fixed.** A new step 2b runs before the destructive `update`, same migration, same transaction: `engineering_jobs_snapshot_backup_2026_10` (job_id pk, project_id, user_id, created_at, snapshot, backed_up_at) is created and filled with the whole pre-change snapshot of every job the strip touches. Column types taken from 0091. Idempotent (`create table if not exists` + `on conflict (job_id) do nothing`). Locked down like the repo's other service-role-only tables: RLS on, revoked from `public, anon, authenticated`, granted to `service_role`, plus an in-migration `has_table_privilege` assert that fails the run if a customer can still read it. The header rollback note now gives the restore `update`, and says the table is kept deliberately and you may drop it when satisfied. Its PGlite test `lib/studio/db/studio-private.test.ts` was extended and passes 11/11: the backup holds the whole original snapshot, exactly one row (so only the affected job is copied and a re-run does not double-write), the table is denied to the job owner and to anon, and the header's rollback `update` really restores `productPrivate`. |
| Service-role dependency | one clear startup warning naming the env var | **Fixed.** `lib/supabase/service.ts` — the one place that reads the key, server-only, not imported by any client component — warns once per server instance: `[supabase] SUPABASE_SERVICE_ROLE_KEY is not set: server-only API routes that need it will answer 503. Set it in the Vercel project environment variables for Production, Preview and Development.` It never logs the key, its prefix or its length, never throws, and is skipped during `next build`. Test: `lib/supabase/service.test.ts`. **→ §7: you must confirm this variable is set in all three Vercel environments.** |
| `0103_guards_and_grants.sql` | diff seven copied function bodies; prove no non-admin path calls `refresh_part_sourcing` / `offer_landed_cost_qar`; raise the order-line cap to 300 and exempt class orders | *(pending)* |
| `0105_parts_cost_private.sql` | find every `select('*')`, `parts(*)` embed and `insert().select()` on `parts`; add a grep test | *(pending)* |
| 90 deleted message keys | restore any key still built at runtime | *(pending)* |
| `callbackNextPath()` | confirm the live templates and the forgot-password form still produce `/{locale}/reset-password` | *(pending)* |

### Phase B — QA findings F-001…F-054

| F-id | Status | Note |
|---|---|---|
| F-001 Terms "through partners" / "free planning tool" | **Fixed** | `LEGAL_PAGES_DRAFT.md`, EN + AR: §3(b) now reads "in our Lusail studio; larger CNC or sheet-metal jobs are quoted case by case"; §3(d) now "a planning tool (the parts list is free; wiring diagrams and 3D models cost credits)"; §7 Arabic "فوري" → "فوران" (also fixed in Delivery & Returns §5, the only other occurrence); §13 Arabic credit-expiry sentence replaced with the clearer wording from the report's Arabic table; Terms "Last updated" → 24 October 2026, Western digits in Arabic. `content/legal/**` regenerated with `scripts/split-legal-draft.mjs`; `--check` passes. No other legal wording touched (D8). |

| F-013 Delivery-time filter | **Fixed** | `leadClassesFor()` in `lib/store/catalog.ts` now keeps a lead class when the **computed arrival date** — the one the card prints — falls in the option's range, instead of matching the supplier's lead class. The date depends only on the lead class, today and the shipping settings, so it still resolves to a short list of classes the database can match: filtering, `total` and paging stay in the query and the page stays static/ISR. `?stock=` option names and values are unchanged. **See §3.3 for a side effect you need to decide on.** |
| F-014 Two delivery tiers cost the same | **Fixed** | `displayedTiers()` in `lib/store/checkout-totals.ts` groups tiers by price and keeps only the fastest in each group, so Standard disappears while it costs the same QAR 50 as Express. `selectableTier()` moves the selection onto a visible tier, so a hidden tier cannot be submitted from the page. Applied at checkout, on the product page "Arrives by" line and in the cart. The data model, `create_part_order` and the order/email rendering are untouched, so an order already placed on a now-hidden tier still displays correctly. |
| F-026 Missing `Studio.cat_logic` | **Fixed** | See the F-001/F-026 commit above. |

*(the remaining F-ids follow as they land)*

## 3. Intentional behaviour changes

Everything the audit itself changes is listed in `docs/audit/FINAL_REPORT.md` §4; that list
still applies and is not repeated here. What **this** branch changes on top:

1. `0100` now keeps a backup table of the pre-migration `engineering_jobs.snapshot` rows.
   It holds customer design data, it is service-role only, and you may drop it once you are
   satisfied nothing needs restoring.
2. A missing `SUPABASE_SERVICE_ROLE_KEY` now logs one startup warning. The 503s it causes
   are unchanged — only the silence is fixed.
3. Terms §3(b), §3(d) and two Arabic wordings now say what is actually true (F-001).
4. The four Supabase auth email templates no longer use `{{ .ConfirmationURL }}`; they link
   into our own site with a token hash and also print a 6-digit code (Phase C, §5).
5. At checkout, a delivery tier that costs the same as a faster one is no longer shown
   (F-014). Nothing about the stored order changed.
6. **The delivery-time filter now means what it says, and that changes what it returns
   (F-013).** This one deserves your attention — see §3.3.

### 3.3 The delivery filter now returns fewer things, and "3–5 days" may be empty

The finding was that "3–5 days" listed products whose card said "Arrives by 2 November",
eleven days out. That happened because the filter matched the supplier's lead class while
the card showed the full computed date — lead time **plus** handling, transit and buffer.

Filtering on the real date fixes the lie, but it exposes an uncomfortable fact: with the
live shipping settings (handling 1 day, buffer 3 days, standard transit 2 days) even an
**in-stock** product arrives in about 8 days. So:

- "3–5 days" matches **nothing** — no product in the catalogue can arrive that fast.
- In-stock products now appear under "1–2 weeks", which is where they actually land.
- I made the slowest option open-ended, so a `2_4_weeks` product (about 34 days once
  handling and buffer are added, past its own 28-day bound) is still reachable from a
  filter instead of only from "All". A unit test pins that no product can fall outside
  every option, however slow the settings get.

I did not rename the options, because that is customer-facing copy and your decision.
**You have three choices:**

1. **Relabel the options** to the windows that are real — e.g. "About a week", "1–2 weeks",
   "2–4 weeks or more". Honest, and the filter becomes useful again. *My recommendation.*
2. **Lower handling and buffer** in Dashboard → Store → Suppliers until an in-stock item
   really does arrive in 3–5 days. Only do this if the dates are genuinely achievable —
   the whole point of the buffer is that you keep the promise.
3. **Ship it as it is.** Honest, but one filter option is permanently empty, which looks
   broken to a customer.

Until you choose, option 1's wording is not written anywhere — nothing is renamed.

## 4. Migrations to run, in order

**Nothing here has been run.** Run them in this order, only when you are ready, and check
each one before moving on. 0100 and 0105 need the app commit **deployed** first.

| # | File | Check it ran (read-only, SQL editor) |
|---|---|---|
| 0098 | `0098_commission_floor.sql` (pre-existing, still NOT RUN — 0103 builds on it) | `select value from store_settings where key = 'commission_floor_pct';` |
| 0100 | `0100_studio_private.sql` (deploy the app first) | `select to_regclass('public.project_studio_private') is not null;` → true; then `select count(*) from public.engineering_jobs_snapshot_backup_2026_10;` |
| 0101 | `0101_ai_usage_server_only.sql` | `select has_function_privilege('authenticated','public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer,text,numeric)','execute');` → false |
| 0102 | `0102_credits_server_spend.sql` | `select has_function_privilege('authenticated','public.spend_credit(text,uuid)','execute');` → false |
| 0103 | `0103_guards_and_grants.sql` (needs 0098 first) | `select count(*) from pg_trigger where tgname in ('part_order_items_limits','part_orders_rate_limit','projects_guard_admin_columns','inquiries_guard_insert');` → 4 |
| 0104 | `0104_quote_upload_path.sql` | `select with_check from pg_policies where policyname = 'quote_uploads_insert';` contains the path regex |
| 0105 | `0105_parts_cost_private.sql` (deploy the app first) | `select has_column_privilege('anon','public.parts','landed_cost_qar','select');` → false |
| 0106+ | *(pending — any migration this branch adds)* | |

Smoke test after each: open the site and the dashboard once. After **0105** specifically,
place one small test order and open Dashboard → Store, to confirm the admin still reads
prices through `parts_admin`.

**A conflict you need to settle before running anything.** The pre-audit `CLAUDE.md`
records 0096 and 0097 as **RUN ✔ 2026-10-21, verified by live probe**, while the main
checkout's working copy of `CLAUDE.md` lists them as NOT RUN. `docs/MIGRATIONS.md` follows
the verified-by-probe record. Please confirm in Supabase first, because 0097 replaces
`create_part_order` and refuses to apply unless exactly one copy of it is left.

## 5. Supabase dashboard checklist — auth emails

The full version, with the reasoning and a 7-step test, is in `docs/AUTH_EMAILS.md`. Short form:

1. **Authentication → Emails** — paste the four templates from `supabase/auth-templates/`
   and set their subjects:
   - `reset-password.html` — "Reset your password · إعادة تعيين كلمة المرور — Gestaltung"
   - `confirm-signup.html` — "Confirm your email · تأكيد بريدك الإلكتروني — Gestaltung"
   - `change-email.html` — "Confirm your new email · تأكيد بريدك الجديد — Gestaltung"
   - `magic-link.html` — "Your sign-in link · رابط تسجيل الدخول — Gestaltung"
2. **Authentication → URL Configuration** — Site URL stays `https://gestaltung360.com`.
   Add `/en/reset-password`, `/ar/reset-password`, `/en/confirm-email`, `/ar/confirm-email`
   on each of `https://gestaltung360.com`, `https://www.gestaltung360.com` and
   `http://localhost:3000` (12 URLs). **Keep** the existing `/api/auth/callback` entries —
   social sign-in still uses them.
3. **Authentication → Email** — set OTP expiration to **3 hours (10800 s)**. Why: university
   and corporate mail gateways can delay external mail by many minutes, and the old 1-hour
   window plus a delayed delivery is most of the "already expired" complaint.
4. **Custom SMTP** — confirm it is Resend: host `smtp.resend.com`, port `465`, user
   `resend`, password = the Resend API key already set in Vercel, sender
   `noreply@contact.gestaltung360.com`. Confirm the Supabase email rate limit is ≥ 30/hour.
5. **Authentication → Attack Protection** — record the current CAPTCHA state (on/off and
   which provider). This change does not alter it, but you need to know it.

**Reading the delivery latency in Resend:** Resend → Emails, filter by the recipient (or by
`qu.edu.qa`), open the message and compare its *Sent/Queued* timestamp with *Delivered*. A
large gap there is the recipient's gateway holding the mail, not us — which is exactly why
the link is no longer single-use and why a 6-digit code is printed beside it.

**Deploy the app before pasting the templates.** They point at `/{locale}/reset-password`
and `/{locale}/confirm-email`; until those pages are live the links lead nowhere.

## 6. Needs owner decision

Carried from the audit (`docs/audit/FINAL_REPORT.md` §6, `SECURITY_AUDIT.md` §5,
`CODE_QUALITY_AUDIT.md` §3) with the auditor's recommendation and my own one-line view.
**Nothing in this list was acted on**, exactly as you asked.

| # | Decision | Auditor's recommendation | My view |
|---|---|---|---|
| 1 | Auto-approval of `kind = 'service'` payments (an approval opens a paid human job) | Never auto-approve service payments; route them to the review queue | **Agree, do this first.** An auto-approved service payment spends your engineer's hours, not just credits — the one irreversible thing in the payment path. |
| 2 | Cap on auto-approved payments | ≤ 1 per user per 30 days and a QAR ceiling; unique index on `lower(transfer_ref)` | **Agree.** The unique index is the cheap half and stops the same Fawran receipt being used twice; do it even if you defer the cap. |
| 3 | AI-02: the Studio model is public via `/product/check` and `/design` before unlock | Drop `model` from `/check`; serve a reduced preview mesh, or price the export rather than the geometry | **Price the export.** Hiding geometry you have already rendered is a losing game; what the customer actually pays for is the printable file, so gate that. |
| 4 | DB-03: browser CAD returns SCAD before `cad_deliver` | Block a new generation while one is undelivered; settle stale ones server-side | **Agree, low risk.** It is a 24-hour-cap loophole, not a live leak. |
| 5 | DB-04/06: free credits become QAR 20 vouchers; no per-team cap | Minimum goods value for the order reward; decide whether free credits should be redeemable; cap team spends | **Make earned credits non-redeemable.** A credit earned by ordering should buy AI, not discount the next order — otherwise a delivered order mints currency. |
| 6 | DB-05: any confirmed user can create a class (free delivery, no project cap) | Admin verification (`verified_at`) before class benefits apply | **Agree.** Free Economy delivery on a class order is a real cost, and "I am a teacher" is currently self-declared. |
| 7 | DB-10: class orders over 100 lines fail | Raise or exempt the cap for class orders | **Settled by you:** 300 lines, class orders exempt. Done in 0103. |
| 8 | Supabase CAPTCHA state, and when to turn the `turnstile` switch on | Confirm; the clients are wired | **Turn it on after this branch is live.** The order in `docs/TURNSTILE.md` matters: keys, then switch, then Supabase — never Supabase first. |
| 9 | CSP promotion after one release of report-only | Rename the header to `Content-Security-Policy` | **Wait one release and read the reports.** Enforcing early breaks the Studio's workers and the CDN-loaded OpenSCAD engine. |
| 10 | Google WIF attribute conditions and Cloud Run hardening of the CAD worker | Confirm issuer/audience pinning, `--no-allow-unauthenticated`, `CAD_WORKER_TOKEN`, zero-role SA | **Agree.** Worth an hour: an unauthenticated Cloud Run worker is a free compute endpoint for anyone who finds it. |
| 11 | O1: v1 public pages + `site_v2` flag (752 lines; the site silently serves v1 if the flag read fails) | Remove once the rollback is no longer wanted | **Remove it.** The flag has been ON since 2026-10-09; the silent-fallback behaviour is now a liability, not a safety net. |
| 12 | O2: Engineer view (48 files, 11,143 lines, ~750 message keys, admin-only) | Decide whether it stays; if not, remove it and keep the shared lib modules | **Your call — it is a product question, not a code one.** If you still open it to debug a customer's project, keep it; if you have not opened it in a month, delete it and reclaim ~750 keys of translation debt. |
| 13 | O3/O4/O5/O15: legacy `tenants`/`inventory_items` UI and tables, `jobs*` tables, `project_claims`, dead columns | Check the live tables are empty, then one drop migration | **Check first, then drop in one migration.** Do it as its own release so a mistake is easy to find. |
| 14 | O11: a design mock-up is publicly served from `public/prototypes/` | Remove from the production domain or keep with noindex | **Remove it.** It is an old mock-up on your real domain. |
| 15 | O14: `Gestaltung_Build_Plan.md` is a Word file with a `.md` name | Rename or archive | **Rename to `.docx`.** Trivial, and it stops the next tool from trying to parse it. |
| 16 | WEB-07: OpenSCAD engine loaded from public CDNs without integrity | Self-host under `public/` | **Add SRI rather than self-hosting.** Self-hosting puts the WASM back into your Vercel data transfer, which you deliberately moved off. |
| 17 | API-10: rating links record on GET and never expire; secret falls back to `CRON_SECRET` | Confirm-button POST and a dedicated secret | **Give it its own secret at least.** Sharing `CRON_SECRET` means a leaked rating link is a cron key. |

Already settled by you in this round, recorded here so it is not re-opened:

Already settled by you in this round, recorded here so it is not re-opened:

- **DB-10c** order-line cap raised from 100 to 300, and class orders (`class_id is not null`)
  exempt from it.
- **F-002** CAD credit price: the published price is the contract (Qatar consumer
  protection) — charge exactly what `/pricing` says.
- **F-008 / F-023** ideation tokens: keep them, but explain them in three places and never
  deduct them optimistically.

New, found while doing this work:

- Privacy §4 still says "Partners: when a job needs a partner, they receive only the files
  and details needed to make your part" (EN + AR). You wrote that line deliberately on
  2026-10-09 and it is conditional rather than a promise, so I left it. It now sits beside a
  Terms section that says the work is done in the Lusail studio. Your call whether the two
  should be aligned. *My view: leave it — it is a data-protection statement about a
  possibility, not a capability claim, and softening it would weaken the privacy page.*

## 7. What you must do afterwards

- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in **all three** Vercel environments
  (Production, Preview, Development). Many routes answer 503 without it, and the new startup
  warning is the only thing that will tell you.
- *(pending — clean descriptions, the Arabic translate step, test-data cleanup)*

## 8. Test data to delete (one pass, at the end)

From `review/qa/REPORT.md` §11 — the QA run's rows. **I did not touch the database.**
Logged here and in `docs/TEST_DATA_CLEANUP.md`; delete them all in one go when the review
is done:

| Type | Identifier | Note |
|---|---|---|
| Order | `3a939b38-a527-4dc3-901b-c3f89806179f` "TEST QA — please cancel" | COD, Lusail, QAR 56.00 — cancel it |
| Project | `719b2ec2-a300-4f6f-a7b8-ebcff6412d18` "TEST QA — Balcony Plant Waterer" | used 1 wiring + 2 CAD credits |
| Get-it-made request | on project `719b2ec2…` | notes "TEST — please ignore" |
| Guest project | `6cc3bf2f-98dd-48c6-9b3e-dca2e6829ce3` "Auto Desk Lamp" | |
| Drawing request | `bc67437f-d774-47d8-a142-fab7ca944a4b` | sketch `test-sketch.png`, tier simple |
| Quote request | no reference shown; file `test-bracket.stl`, name "TEST QA — please ignore" | 22 Oct |
| Contact message | "TEST QA — please ignore" | 22 Oct |

## 9. Next steps

*(pending)*
