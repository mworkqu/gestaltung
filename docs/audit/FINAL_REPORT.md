# Final report — full code read, security audit and clean-up

Branch `audit/code-and-security-2026-10` (from `origin/main` 88a6473), 2026-10-22.
Nothing was pushed, merged or deployed; no migration was run; the checkout has no
`.env.local`, so nothing touched the production Supabase. Commit list: §9.

## 1. Summary

**What was found.** Four parallel read-only reviews (database/RLS/RPC/storage, API
routes and server actions, AI/CAD routes and credits, web layer) produced 75 findings,
consolidated into `SECURITY_AUDIT.md` (86 rows after two adversarial re-reviews of the
fixes added 15). No Critical. Seven High:

- owners could read the private Studio product model and forge the paid unlock
  through PostgREST (`projects.studio`), and class teachers could read students' models;
- any session could pause every AI feature for everyone with one `log_ai_usage` call;
- stored XSS against the super admin through client-written schematic SVG;
- Fawran payments (including human engineering jobs) were auto-approved from a
  user-supplied screenshot with no reference-code check;
- the paid "Create my CAD" model reaches the browser before payment (`/product/check`);
- the CAD-worker static sandbox is a bypassable denylist (runtime controls are the boundary);
- CAD credits could be turned into QAR 20 store vouchers through a client-callable
  `cad_set_code` (found by the second review of the fixes).

Plus 25 Medium (free wiring on a spend race, order spam that zeroes own stock, supplier
margins readable by anyone, free class delivery for any confirmed user, guests draining a
teacher's credits, no security headers, admin role checks only in layouts, sharp/librsvg
advisory reachable, and more), 38 Low, 16 Info.

The code-quality review found 20 import cycles, 88 duplicated blocks (0.90 %), ~100
hand-written role checks in 5 response shapes, 14 copies of the UUID regex, 48 locale-tag
literals, 12 money formatters, 49 columns missing from the hand-written Supabase types,
functions of 1,000+ lines, a 1,624-line CLAUDE.md that was 85 % history, and a small set
of genuinely dead code (2 components, a committed Word temp file, 34 exports, 90 message keys).

**What was fixed.** 36 findings are fixed in code or in six new migrations (0100–0105,
NOT RUN; 20 of the 36 need them), 10 are partially fixed with notes, and every High has
either a fix or an explicit owner decision (AI-02 needs a product decision; AI-03 is
mitigated and documented as a filter). Every fix has a test that fails without it (PGlite
for SQL, vitest for code); two fresh reviewers tried to break the High fixes and their
gaps were closed in follow-up commits. The refactor applied slices R1–R8, R10, R13, R14 of
`REFACTOR_PLAN.md`: safe deletions, tooling, eleven shared primitives with every caller
pointed at them, zero import cycles, checkout maths and order placement moved into tested
modules, six route handlers thinned into `lib/`, eight oversized files split behind
barrels, types brought level with the migrations, CLAUDE.md turned into a 295-line index,
and 56 new test files (3,246 → 3,855 tests).

**What is left.** 15 owner decisions and 9 recommended items (§6), the slices R9/R11/R12/
R15 (§7), and the two operational facts this branch cannot verify: the Supabase dashboard
CAPTCHA state and the default function privileges (§6). The six migrations are listed with
run order and checks in §5. Push access to `mworkqu/gestaltung` was read-only for both
available GitHub accounts, so the branch is local until the owner grants push or pulls it.

## 2. Security findings

The authoritative table is `docs/audit/SECURITY_AUDIT.md` §2 (86 rows: ID, severity, area,
title, status, commit/migration). Counts at HEAD:

| Severity | Rows | | Status | Rows |
|---|---:|---|---|---:|
| Critical | 0 | | Fixed (code) | 16 |
| High | 7 | | Fixed (migration, NOT RUN) | 11 |
| Medium | 25 | | Fixed (code + migration, NOT RUN) | 9 |
| Low | 38 | | Partially fixed — see note | 10 |
| Info | 16 | | Open — needs owner decision | 15 |
| | | | Open — recommended | 9 |
| | | | Info | 16 |

High findings and where they stand:

| ID | Finding | Status | Where |
|---|---|---|---|
| DB-01 / AI-01 | `projects.studio` private models readable, unlock forgeable | Fixed | 0100 + `lib/studio/server/doc.ts`, product routes; gaps G1.1–G1.4 closed (2141a19, 05ce7c1, 0090118) |
| DB-02 | `log_ai_usage` client-callable, unbounded | Fixed | 0101 + `lib/ai/usage.ts` (79b57da, 4fb95e5) |
| WEB-01 | stored XSS via schematic SVG | Fixed (render side) | 29be530 + render test 59eb979; column revoke left as recommended |
| API-01 / DB-26 | payment auto-approval from a screenshot | Partially fixed | GT code required (37278c4, 00400b9); service-payment and cap decisions are the owner's |
| AI-02 | model reaches the browser before unlock | Open — owner decision | product/pricing decision (§6) |
| AI-03 | cad-worker sandbox bypasses | Partially fixed | match-pattern and file-read names banned (fcc0e12); runtime controls documented as the boundary |
| G-C1 | CAD voucher path via `cad_set_code` | Fixed | 0102 `cad_set_code_for` + four call sites (189c26e) |

Re-check of the 2026-06 review (`docs/audit-history/SECURITY_REVIEW.md`): C1 and H5 hold
(triggers in place); H1, H2, H3, M1, M2 are moot (jobs tables dropped in 0013); H4 fixed;
M3 fixed by 0103; M4 addressed by upgrades (next 15.5.28, next-intl 4.14.5); M5 fixed by
the headers commit (CSP report-only). FINDINGS #8: all auth entry points pass a
`captchaToken`; the dashboard CAPTCHA state is unverified. `docs/cad-champions/
SECURITY_REVIEW.md` does not exist in the repo.

## 3. Code-quality changes — before / after

Same commands as `BASELINE.md`; "after" measured at the branch head.

| Metric | Before | After |
|---|---:|---:|
| Lines: app / components / lib (ts+tsx, tests included) | 26,462 / 47,277 / 89,545 | 26,361 / 47,722 / 99,234 |
| jscpd clones / duplicated lines | 88 / 1,217 (0.90 %) | 64 / 947 (0.68 %) |
| knip unused files | 23 | 1 (`lib/studio/cad-setting.ts`, owner item O9) |
| knip unused exports / types | 382 / 354 | 373 / 378 (new primitives and barrels export more than is consumed yet; see note) |
| madge import cycles | 20 | 0 (`npm run check:cycles`) |
| Real `any` in production code | 7 | 0 (3 in test fixtures) |
| `as unknown as` (production) | 62 | 54 (the rest need a generated `Database` type) |
| Env `!` assertions | 5 | 1 |
| Functions with cyclomatic complexity ≥ 25 | 140 | 124 (eslint ratchet now warns at 25) |
| Vitest files / tests | 232 / 3,246 (1 file failed to load) | 288 / 3,855 |
| Lint | 1 warning | 0 errors, 209 warnings (new ratchet rules: complexity, max-lines, no-console) |
| CLAUDE.md | 1,624 lines / 280 KB | 295 lines (history verbatim in `docs/history/`) |

Largest files (lines):

| File | Before | After |
|---|---:|---:|
| `components/studio/steps/wiring/Wiring3DView.tsx` | 1,402 | 1,401 (R9 not done) |
| `lib/studio/product/solve.ts` | 1,387 | 1,387 (R9 not done) |
| `components/prototyping/workspace.tsx` | 1,370 | 1,372 (Engineer view, owner item O2) |
| `components/projects/project-workspace.tsx` | 1,080 | 135 (+6 card/hook files) |
| `lib/studio/netlist.ts` | 1,008 | 66 barrel (+4 stage files) |
| `lib/studio/schema.ts` | 889 | 23 barrel (+4 files) |
| `components/studio/StudioShell.tsx` | 856 | 397 (+3 hooks, banners) |
| `components/studio/steps/PartsStep.tsx` | 841 | 377 (+4 files) |
| `app/[locale]/dashboard/customers/[id]/page.tsx` | 691 | 184 (+14 sections, shared `lib/admin/customer-data.ts`) |
| `app/[locale]/store/checkout/checkout-client.tsx` | 563 | 297 (maths + placement in `lib/store`, tested) |
| `app/api/store-lead/route.ts` | 393 | 31 (`lib/leads/*`) |
| `app/api/analyse/route.ts` | 236 | 98 (`lib/prototyping/analyse-run.ts`) |

First Load JS (kB) on the main routes, baseline → after (static/ISR flag of every route
unchanged, checked by diffing the two route tables):

| Route | Before | After |
|---|---:|---:|
| `/[locale]` (home) | 148 | 149 |
| `/[locale]/store` | 147 | 148 |
| `/[locale]/store/[sku]` | 209 | 210 |
| `/[locale]/store/cart` | 208 | 209 |
| `/[locale]/store/checkout` | 212 | 213 |
| `/[locale]/design/quote` | 204 | 205 |
| `/[locale]/pricing` | 161 | 161 |
| `/[locale]/projects/[id]` | 226 | 228 |
| `/[locale]/projects/[id]/studio` | 326 | 327 |
| `/[locale]/v2` | 149 | 151 |
| `/[locale]/dashboard/customers/[id]` | 121 | 121 |

The +1 kB on the public routes is the shared `lib/locale` / `lib/format` imports now used
by the client components; shared chunks are unchanged (104 kB).

## 4. Intentional behaviour changes

Everything else is behaviour-preserving (commit bodies say so and list what was
deliberately not switched). The full list with quotes is in `SECURITY_AUDIT.md` §8.

Live as soon as the code deploys:

1. Fawran receipts that do not show the payment's GT code go to manual review
   (`reference_mismatch`) instead of being auto-approved. Arabic-Indic digits are accepted.
2. Admin overview counts shipped-but-undelivered orders as open (its own list omitted
   `shipped`).
3. Cron routes answer 401 `{ error: "unauthorized" }` for missing, wrong and unset secrets
   alike (two used to answer 500).
4. `/api/design-quote`: 10 requests per 10 min per IP (429), storage paths outside the
   uploader's shape are dropped (lead still saved, no signed link), project name read with
   the caller's RLS client. `/api/demand`: 300/10 min for beacons, 10/10 min for requests.
   `/api/project-cad`: 5 per 10 min per user. `/api/brief-chat` and `/api/transcribe`:
   per-user and per-IP limits (429); transcribe has a 60 s `maxDuration` and a 45 s
   upstream timeout. `/api/bom/match` rejects a non-UUID project id with 400 (was 409).
5. Turnstile: when the owner turns the switch on, anonymous guests must pass it on
   design-quote, demand requests, store-lead, brief-chat and transcribe (clients already
   send the token). With the switch off nothing changes.
6. Wiring routes never return a circuit they could not charge for: 402 `no_credits`, or
   503 `unavailable` before the model call when the service key is missing (admins exempt).
   Studio product, CAD, enclosure and unlock routes answer 503 without
   `SUPABASE_SERVICE_ROLE_KEY`.
7. Idea-chat turns are priced from the server-stored tier; the client card can only raise it.
8. Google Sheet import: a sheet over 2 MB fails with `fetch_failed` instead of being
   silently truncated; image fetches refuse SVG, re-check every redirect hop, cap at 15 MB.
9. Security headers on every response (CSP **report-only**, HSTS, nosniff, X-Frame-Options
   SAMEORIGIN, Referrer-Policy, Permissions-Policy, COOP); `X-Powered-By` removed; Supabase
   cookies `Secure` in production.
10. Restock receipts, weights and supplier minimums revalidate the storefront.
11. `auth/callback` accepts only locale-prefixed app paths for `next` (plus
    `/{locale}/reset-password`).
12. Schools invoice emails use the canonical site URL and no longer make an HTTP self-call
    with the teacher's cookies. `/api/store-lead` answers 400 to a non-object body; an
    unknown `source` falls back to `store_callback`.
13. Admin actions redirect an anonymous guest to `/{locale}/projects` (the dashboard layout
    did so already). `/dashboard/contact` requires super_admin (it already gated the save).
14. Engineering uploads: file names with `..`, a leading dot or over 80 characters are
    sanitised differently (extension kept); path shape unchanged.
15. Next.js 15.5.25 → 15.5.28 and sharp 0.35.4 → 0.35.5 (both in-range patches;
    `npm audit --omit=dev` critical and sharp advisories cleared).

Live only after the migration runs (details §5): 0100 — class teachers can read but no
longer write team models; 0103 — order caps (≤ 1,000 units per line, ≤ 100 lines, ≤ 10
orders per hour per phone or email; shown as new checkout messages), inquiry field
limits, class projects cannot be claimed or recovered by link, admin-only `is_test`/
`tenant_id`; 0104 — upload object names over 200 chars refused; 0105 — supplier cost and
margin columns and internal `store_settings` keys invisible to non-admins.

## 5. New migrations the owner must run

All six are **NOT RUN**. Deploy the app first (the code falls back to the old paths until
each migration exists), then run in order. 0098 (also NOT RUN) must precede 0103. Each file
is idempotent and has a ROLLBACK section in its header; each has a PGlite test under `lib/`.

| # | File | What it does | How to check it ran (SQL editor, read-only) |
|---|---|---|---|
| 0098 | `0098_commission_floor.sql` | pre-existing, still NOT RUN; 0103 builds on its `refresh_part_sourcing` | `select value from store_settings where key = 'commission_floor_pct';` |
| 0100 | `0100_studio_private.sql` | `project_studio_private` (service_role only), back-fill and removal of `studio.productPrivate`, guard trigger on `projects.studio`, `studio_product_save()`, strips private models from old job snapshots | `select to_regclass('public.project_studio_private') is not null;` → true |
| 0101 | `0101_ai_usage_server_only.sql` | revokes both `log_ai_usage` overloads from sessions, adds service-only `log_ai_usage_server` with clamps, hides `ai_usage_totals` from anon | `select has_function_privilege('authenticated','public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer,text,numeric)','execute');` → false |
| 0102 | `0102_credits_server_spend.sql` | service-only `spend_credit_for` and `cad_set_code_for`; `spend_credit` and `cad_set_code` revoked from sessions | `select has_function_privilege('authenticated','public.spend_credit(text,uuid)','execute');` → false |
| 0103 | `0103_guards_and_grants.sql` | job refunds per token kind, guest-claim fix, order caps, revokes, admin-only columns, class-project claim/recovery refusal, inquiry limits, own-order payment method, sourcing function caller checks, class-teacher policy to authenticated, recovery-email cap | `select count(*) from pg_trigger where tgname in ('part_order_items_limits','part_orders_rate_limit','projects_guard_admin_columns','inquiries_guard_insert');` → 4 |
| 0104 | `0104_quote_upload_path.sql` | quote-uploads insert policy requires `<uuid>/<name>` | `select with_check from pg_policies where policyname = 'quote_uploads_insert';` contains the path regex |
| 0105 | `0105_parts_cost_private.sql` | column-level SELECT on `parts` without the 7 cost columns, `parts_admin` view, internal `store_settings` keys hidden; raises if cost stays readable | `select has_column_privilege('anon','public.parts','landed_cost_qar','select');` → false |

Before 0101–0103, run once:
`select has_function_privilege('anon','public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer,text,numeric)','execute');`
If it returns true, Supabase's default privileges grant EXECUTE to sessions and the explicit
revokes in these migrations are what close the holes (the new migrations revoke explicitly
either way). After 0105, place one small test order and open Dashboard → Store once to
confirm the admin reads through `parts_admin`.

## 6. Needs owner decision

Full list with recommendations: `SECURITY_AUDIT.md` §5 and `CODE_QUALITY_AUDIT.md` §3.
The ones that matter most:

| # | Decision | Recommendation |
|---|---|---|
| 1 | Auto-approval of `kind = 'service'` payments (an approval opens a paid human job) | Never auto-approve service payments; route them to the review queue. |
| 2 | Cap on auto-approved payments | ≤ 1 per user per 30 days and a QAR ceiling; add a unique index on `lower(transfer_ref)`. |
| 3 | AI-02: the Studio model is public via `/product/check` and `/design` before unlock | Drop `model` from `/check`; serve a reduced preview mesh from `/design`, or price the export rather than the geometry. |
| 4 | DB-03: browser CAD returns SCAD before `cad_deliver` | Block a new generation while one is undelivered; settle stale ones server-side. |
| 5 | DB-04/06: free credits (3+1 per delivered order, 2+1 edu) become QAR 20 vouchers; no per-team cap | Minimum goods value for the order reward; decide whether free credits should be redeemable; cap team spends. |
| 6 | DB-05: any confirmed user can create a class (free delivery, no project cap) | Admin verification (`verified_at`) before class benefits apply. |
| 7 | DB-10: class orders over 100 lines now fail | Raise or exempt the cap for class orders if real classes need it. |
| 8 | Supabase dashboard: Authentication → Attack Protection → CAPTCHA state; and when to turn the `turnstile` switch on | Confirm; the clients are wired. |
| 9 | CSP promotion after one release of report-only | Rename the header to `Content-Security-Policy`. |
| 10 | Google WIF attribute conditions and Cloud Run hardening of the CAD worker | Confirm issuer/audience pinning, `--no-allow-unauthenticated`, `CAD_WORKER_TOKEN`, zero-role SA. |
| 11 | O1: v1 public pages + `site_v2` flag (752 lines; the site silently serves v1 if the flag read fails) | Remove once the rollback is no longer wanted. |
| 12 | O2: Engineer view (`/projects/[id]/prototyping`, 48 files, 11,143 lines, ~750 message keys, admin-only) | Decide whether it stays; if not, remove it and keep the shared lib modules. |
| 13 | O3/O4/O5/O15: legacy `tenants`/`inventory_items` UI and tables, `jobs*` tables, `project_claims`, dead columns | Check the live tables are empty, then one drop migration. |
| 14 | O11: a design mock-up is publicly served from `public/prototypes/` | Remove from the production domain or keep with noindex. |
| 15 | O14: `Gestaltung_Build_Plan.md` is a Word file with a `.md` name; `FIX_ALL_PROMPT.md` unreferenced | Rename or archive. |
| 16 | WEB-07: OpenSCAD engine loaded from public CDNs without integrity | Self-host under `public/`. |
| 17 | API-10: rating links record on GET and never expire; secret falls back to `CRON_SECRET` | Confirm-button POST and a dedicated secret. |

## 7. Recommended next steps (by risk reduction)

1. Deploy the branch, then run 0098 and 0100–0105 in order (§5); verify with the queries.
2. Decide items 1–3 of §6 (payments and the Studio model) — the remaining revenue leaks.
3. Confirm the Supabase CAPTCHA state and turn the Turnstile switch on (clients are ready).
4. Watch CSP reports for one release, then enforce the policy.
5. Generate a `Database` type from the migrations (local Postgres + `supabase gen types`)
   and type the four Supabase factories; this removes the remaining 54 `as unknown as`.
6. Slice R9 (geometry hot spots: `solve.ts`, `wiring3d/layout.ts`, `schematic.ts`,
   `wiring-drawing.ts`, `Wiring3DView.tsx`) behind golden tests; and R11 (hooks out of
   `lib/`, components stop querying Supabase inline).
7. Slice R12: finish the one error-shape convention for the nine bespoke route bodies and
   the action result unions (helpers exist in `lib/http.ts`; `lib/auth/guards.ts`).
8. Decide O1/O2 and delete what the owner no longer wants (≈ 12,000 lines and ~750 keys).
9. Add `loading.tsx`/`error.tsx` for the private areas (none exist today) and a jsdom
   vitest project so component tests can grow beyond the two source-level ones.
10. Planned major upgrades with their own test pass: Next 16, Tailwind 4, ESLint 10,
    three/lucide/@supabase/ssr majors; the 9 remaining `npm audit` items all sit in
    those chains.

## 8. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 209 warnings (ratchet rules) |
| `npm run test` | 288 files, 3,855 tests pass |
| `node scripts/check-i18n-parity.mjs` | en 5,241 / ar 5,241 |
| `node scripts/split-legal-draft.mjs --check` | OK (legal content untouched) |
| `npm run check:cycles` | no circular dependency |
| `npm run build` | passes; static/ISR flags identical to baseline for every route |
| `npm run test:e2e` (no Supabase env, same as baseline) | 221 passed / 62 failed / 53 skipped vs baseline 220 / 64 / 53; **zero tests that passed in the baseline fail now**. The failures are the specs that need a Supabase session or catalog. |
| cad-worker `pytest tests/test_sandbox.py` | 158 passed |
| `npm audit --omit=dev` | 11 (8 high, 3 moderate) → 9 (6 high, 3 moderate); the critical Next advisory set and the sharp advisory are cleared; the rest are transitive dev-chain packages needing majors |

A manual click-through against production data was not possible from this checkout (no
Supabase env by design). The e2e suite covers home, store, product, cart, checkout
(redirect to empty cart), Studio fixtures, dashboard fixture, EN and AR, 375 px and
desktop, within the limits above.

Re-verification after the Next.js 15.5.28 bump (commit 7e90324), same chain: typecheck
clean; lint 0 errors / 209 warnings; 288 files / 3,855 tests pass; build passes with the
route table's static/ISR flags identical to the baseline; e2e 221 passed / 61 failed /
53 skipped with zero tests that passed in the baseline failing now.

## 9. Branch and commits

Branch: `audit/code-and-security-2026-10` (local; push rights were not available).
129 commits (this report commit included) grouped (chronological within groups; full list: `git log --oneline origin/main..HEAD`):

- Phase 0 baseline and hygiene (4): 3491047, c1ec4e1, 2d682b6, 0d8ca77
- Phase 1 findings docs (4): 866c855, 75453f8, 189070b, 7fe67b3
- Phase 2/6 docs (10): 8b4a46a, 268691f, 95f2a94, 6497824, 2ec6b14, a4a22bf, 6604b6c, 5eff169, 20bd46c, 6d57702
- Phase 3 API fixes (8): 974fb8d, 48626b6, 7f6a4d6, 37278c4, a2c5de4, 5b726d1, 3d06ce9, 1d9a88c
- Phase 3 migrations (6): 391f854, 79b57da, 2067917, 47cccf8, 75a6715, bd31e8a
- Phase 3 web (7): 1619d56, 41bc697, 29be530, 38d62b7, f9c82e1, 59eb979, fd943f9
- Phase 3 AI (5): d9603a5, 154af47, ab7d08c, 24d4df1, fcc0e12
- Phase 3 follow-ups (16): af19a4b, af7a1c3, 1a9da3f, 00400b9, 2141a19, 05ce7c1, 4fb95e5, 2e52716, 189c26e, 6a2f9dd, ae11361, 0090118, d33b23d, ce9c2da, 781a510, 7e90324
- Phase 4 R1 (5), R2 (2), R3 (11), R4 (17), R5 (6), R6 (4), R7 (5), R8 (6), R10 (5), R13 (5), R14 (1)

History notes (no content lost, attribution imperfect): the deletions of
`components/account-bar.tsx` and `components/payment/home-trust.tsx` were swept into the
R3 commit 342d047 by a concurrent commit; a follow-up tweak to `lib/prototyping/analyse-run.ts`
landed inside 820fef5 (the R6 admin-overview fix) instead of an R7 commit; one amend
rewrote and then restored an R7 commit (0719c7c → 405ca7e, identical tree).
