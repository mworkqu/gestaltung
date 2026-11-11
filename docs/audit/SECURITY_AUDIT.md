# Gestaltung security audit (consolidated)

> **2026-10-26 UPDATE — every migration this report proposes (0100-0105) has since been
> run, together with 0098 and 0106. The report below is left exactly as written, as the
> record of what was found and why; it is no longer a to-do list. Current status lives in
> [../MIGRATIONS.md](../MIGRATIONS.md).**

Date: 2026-10-22. Repo: `/Users/salman.mik.us/Developer/gestaltung`, branch `audit/code-and-security-2026-10` (base origin/main 88a6473). Status snapshot: HEAD bab42fd, 125 commits ahead of origin/main.
Sources: `docs/audit/findings/sec-database-rls-rpc.md` (DB-01..31), `sec-api-routes-and-actions.md` (API-01..15), `sec-ai-routes-and-credits.md` (AI-01..16), `sec-web-layer.md` (WEB-01..13), plus `docs/audit-history/SECURITY_REVIEW.md` (Stage 8A, 2026-06) and `docs/audit-history/FINDINGS.md` (both were in the repo root until audit slice R13). Two later independent reviews (of the five High fixes, and of migrations 0100/0102/0103/0105 with the DB-01/DB-02 gap fixes) added the gaps in section 3.5. Fix status is read from `git log origin/main..HEAD` as of HEAD bab42fd; re-run `git log --oneline origin/main..HEAD` for later commits.

## 0. Scope, method, limits

- Scope: all 86 migrations (0001..0099, final state), 62 API routes, 26 server-action files, AI/CAD routes and the cad-worker, middleware, cookies, headers, page gates, XSS sinks, public env, storage buckets, dependencies.
- Method: 4 parallel read-only reviews: (1) database / RLS / RPC / storage, (2) API routes + server actions, (3) AI/CAD routes + credits, (4) web layer / headers / middleware. Raw outputs are the four files above; sections 1-3.4 consolidate them and add no findings; section 3.5 adds what the two post-fix reviews found.
- There is no `.env.local` in this checkout and nothing was executed against Supabase, Vercel, Google or any AI provider. Every statement about production state (applied migrations, grants, dashboard settings, Cloud Run flags) is code-derived and marked unverified where it could not be proven. Two local no-network Python proofs were run for AI-03 (sandbox bypasses).
- No migration has been run anywhere. Any "migration" fix below is a file in `supabase/migrations/` that the owner must apply. Six are committed and all are NOT RUN: `0100_studio_private.sql` (DB-01), `0101_ai_usage_server_only.sql` (DB-02), `0102_credits_server_spend.sql` (DB-04/06, G-C1), `0103_guards_and_grants.sql` (DB-07/08/10/11/12/13/16/17/18/19/22, API-02), `0104_quote_upload_path.sql` (DB-15), `0105_parts_cost_private.sql` (DB-09). 0100, 0102, 0103 and 0105 were amended in place after review because none had been run. Order and prerequisites: section 7. Migration numbers proposed inside the raw reviews (0100..0113) were suggestions; the real file names are what is in `supabase/migrations/`.
- Severity scale (this codebase's threat model: public store + paid AI + guest sessions):
  - Critical: unauthenticated or any-user full compromise (RCE, admin takeover, mass data loss). None found.
  - High: any signed-in or guest user can bypass a paywall, forge payment, steal admin session or pause the whole product.
  - Medium: bounded money / abuse / integrity impact, or exploitable with a precondition.
  - Low: hardening, small abuse, admin-only exposure, or conditional on config.
  - Info: checked-and-safe notes, design remarks, unverified edge cases.
  - Where a reviewer gave a range (e.g. "Low/Medium") the counts below use the higher band.
- Roles: anon = no JWT; guest = Supabase anonymous user (role `authenticated`, `is_anonymous=true`); client = confirmed account; admin = `profiles.role='super_admin'`; svc = service_role.
- Duplicates merged into one row: AI-01 = DB-01; API-01 ~ DB-26; WEB-06 ~ DB-15; API-03 / AI-09 overlap (same missing CAPTCHA/rate-limit class, different routes).
- Status convention (one of): "Fixed (code)", "Fixed (migration 01nn, NOT RUN)", "Fixed (code + migration 01nn, NOT RUN)", "Partially fixed — see note", "Open — needs owner decision", "Open — recommended", "Info". A fix counts only when a commit names the ID (or the review gap) and a test file proves it. "NOT RUN" means the file is committed but not applied; the exposure remains until the owner runs it. Merged rows take the status of the larger open remainder. Rows with a letter suffix (DB-10b, API-02b, ...) are the remainder a reviewer left open on a fixed finding.

## 1. Summary table

Counts: see section 9 (end of file).

| ID | Severity | Area | One-line title | Status | Fix commit / migration |
|---|---|---|---|---|---|
| AI-01 = DB-01 | High | DB / Studio | Owner can read private Studio models and forge the paid "unlock" via PostgREST (`projects.studio`) | Fixed (code + migration 0100, NOT RUN) | 391f854, 2141a19, 05ce7c1, 0090118 + `supabase/migrations/0100_studio_private.sql` |
| DB-02 | High | DB / AI quota | `log_ai_usage` client-callable, unbounded: one RPC pauses all AI features | Fixed (code + migration 0101, NOT RUN) | 79b57da, 4fb95e5 + `0101_ai_usage_server_only.sql` |
| API-01 ~ DB-26 | High | Billing | Fawran/token/pass/service payments auto-approved from an AI-read screenshot | Partially fixed — see note | 37278c4, 00400b9. GT-code check only; the real controls are owner decisions 5.1, 5.2, 5.22 |
| AI-02 | High | AI / Studio | Paid "Create my CAD" model returned by `/product/check` and `/product/design` before payment | Open — needs owner decision | - |
| AI-03 | High | cad-worker | Static sandbox is a denylist with confirmed bypasses over the real `cadquery` namespace | Partially fixed — see note | fcc0e12, af19a4b. Proven bypasses closed; static check is a filter, runtime controls are the boundary |
| WEB-01 | High | Web / XSS | Stored XSS against super_admin via `project_schematic_revisions.svg` | Fixed (code) | 29be530, 59eb979 (render side only; column revoke / redraw not done) |
| G-C1 | High | DB / credits / CAD | `cad_set_code` session-callable: fake CAD code + `cad_deliver` mints a QAR 20 voucher with no model call (DB-04 via CAD) | Fixed (code + migration 0102, NOT RUN) | 189c26e + `0102` (`cad_set_code_for`, `cad_set_code` revoked) |
| DB-03 | Medium | DB / CAD | Browser CAD path returns SCAD before payment; skipping `cad_deliver` is free | Open — needs owner decision | - |
| DB-04 | Medium | DB / credits | `spend_credit` mints QAR 20 store vouchers with no AI use | Partially fixed — see note | 2067917, 189c26e + `0102_credits_server_spend.sql` (NOT RUN). Reward rules: owner decision 5.6 |
| DB-05 | Medium | DB / schools | Any confirmed user can be a "teacher": free delivery + project cap bypass | Open — needs owner decision | - |
| DB-06 | Medium | DB / schools | Class join code lets anyone (guests too) drain the teacher's credits | Partially fixed — see note | 2067917 + `0102` (NOT RUN): draining now needs real model calls. Per-team cap: DB-06b |
| DB-07 | Medium | DB / engineering | Cancelling a job refunds Maker Pass tokens as permanent tokens | Fixed (migration 0103, NOT RUN) | 47cccf8 + `0103_guards_and_grants.sql`. Pass cap: DB-07b |
| DB-08 | Medium | DB / auth | `claim_guest_work` aborts on duplicate `idea_welcome` rows | Fixed (migration 0103, NOT RUN) | 47cccf8 + `0103`. Negative balance: DB-08b |
| DB-09 | Medium | DB / store | Supplier cost and margin readable by anon (parts columns, store_settings) | Fixed (code + migration 0105, NOT RUN) | bd31e8a, 2e52716, ce9c2da + `0105_parts_cost_private.sql` |
| DB-10 | Medium | DB / orders | Anonymous orders can zero `own_stock` and spam orders | Fixed (code + migration 0103, NOT RUN) | 47cccf8, ae11361, 781a510 + `0103`. Remainders: DB-10b, DB-10c |
| DB-11 | Medium | DB / RPC | `log_project_event` callable by anyone: fake events in any timeline | Fixed (migration 0103, NOT RUN) | 47cccf8 + `0103` |
| DB-12 | Medium | DB / projects | Owners can set `projects.is_test`, hiding AI usage from quotas/charges | Fixed (migration 0103, NOT RUN) | 47cccf8 + `0103` |
| DB-14 | Medium | DB / store | Kit discount on arbitrary lines via a self-made kit (conditional on `kit_discount_pct > 0`) | Open — needs owner decision | - |
| DB-15 ~ WEB-06 | Medium | Storage | `quote-uploads`: anonymous 50 MB uploads, any path, any MIME | Partially fixed — see note | 75a6715 + `0104_quote_upload_path.sql` (NOT RUN): path shape only; size / MIME limits are an owner decision |
| API-02 | Medium | API / email | Guest/anon-triggered emails to arbitrary addresses with attacker text | Partially fixed — see note | 47cccf8 + `0103` (NOT RUN): 3 emails / address / 24 h. Turnstile on checkout / recovery-email not done; index: API-02b |
| API-03 / AI-09 | Medium | API / AI | Lead, demand, brief-chat, transcribe: no CAPTCHA/rate limit; store-lead CAPTCHA bypassed by any session | Fixed (code) | 5b726d1, a2c5de4, ab7d08c, 1d9a88c, 1a9da3f. Enforced only when the Turnstile switch is on (section 7) |
| AI-04 | Medium | AI / CAD | `/api/cad` forwarded the client's `x-vercel-oidc-token` as the WIF subject token | Fixed (code) | d9603a5, af7a1c3 |
| AI-05 | Medium | AI / credits | Wiring charge is check-then-spend after the circuit is returned | Fixed (code) | d33b23d |
| AI-06 | Medium | AI / tokens | Ideation-token cost derived from client-supplied `current`/`spec` | Fixed (code + migration 0100, NOT RUN) | 154af47 (spec route); the `regens` half rides on 0100 (2141a19) |
| WEB-02 | Medium | Web / authz | Admin role checks only in layouts; service-role pages renderable without them | Fixed (code) | 1619d56, fd943f9 |
| WEB-03 | Medium | Web / headers | No security headers (SECURITY_REVIEW M5) | Partially fixed — see note | 38d62b7. Headers enforced; CSP is report-only until the owner renames it |
| WEB-05 | Medium | Web / deps | sharp 0.35.4 (librsvg advisory) reachable via supplier/Drive image import | Fixed (code) | 41bc697 (sharp 0.35.5), 3d06ce9 (no SVG, byte cap, hop re-check) |
| G1.1 | Medium | DB / Studio | DB-01 gap: `studio = null` / non-object PATCH resets `product.regens` (free regenerations) | Fixed (migration 0100, NOT RUN) | 2141a19 + `0100` |
| G1.2 | Medium | DB / Studio | DB-01 gap: owner reads private models from `engineering_jobs.snapshot` and cancels for a refund | Fixed (code) | 05ce7c1 |
| G1.2 data clean-up | Medium | DB / Studio | DB-01 gap: snapshots of jobs submitted before the branch already hold every model | Fixed (migration 0100, NOT RUN) | 0090118 + `0100` |
| G1.3 | Medium | DB / Studio / schools | DB-01 regression: class teacher can write a student's product designs through the service client | Fixed (code + migration 0100, NOT RUN) | 2141a19 + `0100` |
| DB-22 regression | Medium | DB / schools | 0103 revoke made every anon `select` on `projects` raise a permission error | Fixed (migration 0103, NOT RUN) | 6a2f9dd + `0103` |
| DB-13 | Low | DB / projects | Teachers and owners can read `recovery_token`; teacher can take over a guest project | Partially fixed — see note | 47cccf8, ae11361 + `0103` (NOT RUN): class projects cannot be claimed or recovered. `recovery_token` still SELECTable by teachers |
| DB-16 | Low | DB / inquiries | `inquiries` anon insert unbounded; anon sets `status`/`is_test` (M3) | Fixed (code + migration 0103, NOT RUN) | 47cccf8 + `0103` (CHECK is NOT VALID), 24d4df1 |
| DB-17 | Low | DB / orders | `set_order_payment_method` has no ownership check | Fixed (migration 0103, NOT RUN) | 47cccf8 + `0103`. Sessionless orders: DB-17b |
| DB-18 | Low | DB / sourcing | `refresh_part_sourcing` callable by every authenticated user | Fixed (migration 0103, NOT RUN) | 47cccf8 + `0103` |
| DB-19 | Low | DB / sourcing | `offer_landed_cost_qar` returns supplier cost to any caller | Fixed (migration 0103, NOT RUN) | 47cccf8 + `0103` |
| DB-20 | Low | DB / pricing | `price_experiment_quote` is an anon oracle for cohort codes | Open — needs owner decision | - |
| DB-21 | Low | DB / privacy | `co_purchased` has no minimum-count threshold | Open — needs owner decision | - |
| DB-22 | Low | DB / schools | `class_teacher_of_project` & co. granted to anon (leak teacher uuid) | Fixed (migration 0103, NOT RUN) | 47cccf8, 6a2f9dd + `0103` (anon regression: see DB-22 regression) |
| DB-25 | Low | Storage | Public buckets listable by anon; `product-images` has no size/MIME limit | Open — needs owner decision | - |
| DB-27 | Low | DB / CAD | Class CAD billing inconsistent (`cad_begin` checks the student, `spend_credit` bills the teacher) | Open — recommended | - |
| DB-28 | Low | DB / credits | Edu-grant regex accepts any `*.edu`, `*.edu.xx`, `*.ac.xx` | Open — needs owner decision | - |
| DB-29 | Low | DB / tokens | Every guest session gets 5 welcome ideation tokens | Open — needs owner decision | - |
| DB-30 | Low | DB / orders | Free shipping decided before credit redemption | Open — needs owner decision | - |
| API-04 | Low | API | `/api/design-quote`: unauthenticated service-role signing of any path, project-name read | Fixed (code) | a2c5de4 |
| API-05 | Low | API / cron | 4 of 6 crons compare CRON_SECRET with `!==`; mixed 401/500 | Fixed (code) | 974fb8d |
| API-06 | Low | API / CSRF | No Origin/Content-Type check on cookie-authenticated JSON POSTs | Open — recommended | - |
| API-07 | Low | API / middleware | site_v2 preview gate is a constant, forgeable cookie | Open — needs owner decision | - |
| API-08 | Low | API / SSRF | Outbound fetch: redirects past host allow-list, whole body buffered | Fixed (code) | 3d06ce9 |
| API-09 | Low | API / schools | Invoice action forwards cookies to a Host-derived origin | Fixed (code) | 405ca7e |
| API-10 | Low | API / orders | Rating: GET records a score, tokens never expire, secret falls back to CRON_SECRET | Open — needs owner decision | - |
| API-11 | Low | API / auth | `auth/callback` used a weaker `next` sanitiser | Fixed (code) | 48626b6 |
| API-12 | Low | API / cache | Store writes without `revalidateStorefront()` | Fixed (code) | 7f6a4d6 |
| AI-07 | Low | AI / pricing | CAD credit cost (tier) derived from user-controlled input | Open — needs owner decision | - |
| AI-08 | Low | AI / Studio | Guest design limit non-atomic and fails open; signed-in users uncapped | Open — recommended | - |
| AI-10 | Low | AI / validation | Several AI routes read the body without zod | Partially fixed — see note | ab7d08c (brief-chat), 24d4df1 (project-cad, bom/match). `/api/netlist`, `/api/bom/electronics` bodies still uncast-checked |
| AI-11 | Low | AI / CAD | `/api/project-cad` has no rate limit and emails the owner per call | Fixed (code) | 24d4df1 |
| WEB-04 | Low | Web / cookies | Supabase auth cookies JS-readable and lack `Secure` | Partially fixed — see note | f9c82e1 (Secure in production). `httpOnly` stays off: owner decision |
| WEB-07 | Low | Web / supply chain | OpenSCAD engine loaded from public CDNs without integrity check | Open — needs owner decision | - |
| WEB-08 | Low | Web / authz | `/dashboard/contact` reachable by any signed-in client/workshop | Fixed (code) | 1619d56 |
| G1.4 | Low | DB / Studio | DB-01 gap: pre-0100 fallback matched any "does not exist" and rewrote `productPrivate` into `projects.studio` | Fixed (code + migration 0100, NOT RUN) | 2141a19 + `0100` (notify pgrst) |
| G2.1 | Low | AI / usage | DB-02 gap: second Auth round trip per request; failed lookup dropped every usage row | Fixed (code) | 4fb95e5 |
| DB-06b | Low | DB / schools | No per-team or per-day credit cap on a class team (code holders can still loop real wiring calls) | Open — recommended | - (`class_teams.credit_cap`) |
| DB-07b | Low | DB / engineering | A pass-paid job refund can push `idea_pass` above the cap `payment_apply_internal` enforces (reviewer: Info) | Open — recommended | - |
| DB-08b | Low | DB / auth | After `claim_guest_work` the account's idea balance can go below 0 (welcome row dropped, spend rows moved; reviewer: Info) | Open — recommended | - |
| DB-10b | Low | DB / orders | No per-session (`auth.uid()`) order cap; victim phone / email can be locked out for an hour; concurrent inserts can pass 10; direct DB sessions not exempt | Open — recommended | - |
| DB-10c | Low | DB / orders / schools | The 100-line order limit fails a teacher's class order with more than 100 lines (teams x parts) | Open — needs owner decision | - |
| DB-17b | Low | DB / orders | `set_order_payment_method`: orders with a null `profile_id` (anon `create_part_order`) can be set by any sessionless holder of the order id within 1 h | Open — recommended | - |
| API-02b | Low | DB / email | No index on `projects(contact_email)`: the new 3-per-address cap does a sequential scan per call (reviewer: Info) | Open — recommended | - |
| DB-23 | Info | DB | "`auth.uid() is null` => trusted" trigger pattern | Info | - |
| DB-24 | Info | DB | 8 SD functions pinned to `public`, not `''` | Info | - |
| DB-31 | Info | DB / AI | Owner can pre-seed the `/api/analyse` reuse cache | Info | - |
| API-13 | Info | API | Admin server actions trust TypeScript types at runtime | Info | - |
| API-14 | Info | API | Error-detail leakage (admin/cron only) | Info | - |
| API-15 | Info | API | Items checked and found sound | Info | - |
| AI-12 | Info | AI | Studio usage logging fails CHECK before 0068/0088 | Info | - |
| AI-13 | Info | AI | `analysis_runs` rows client-insertable | Info | - |
| AI-14 | Info | AI | `/api/transcribe` has no `maxDuration` | Info | - |
| AI-15 | Info | AI / XSS | SVG via `dangerouslySetInnerHTML` is rule-generated (checked, safe) | Info | - |
| AI-16 | Info | AI | Provider keys server-only, no `NEXT_PUBLIC_` leak (checked, safe) | Info | - |
| WEB-09 | Info | Web | "dashboard prerendered" build-table marker is a display quirk | Info | - |
| WEB-10 | Info | Web | Locale-param redirects on dotted paths (unverified, likely safe) | Info | - |
| WEB-11 | Info | Web | Legal/case-study link filter admits `//host` | Info | - |
| WEB-12 | Info | Web | Turnstile response not bound to hostname/action | Info | - |
| WEB-13 | Info | Web | Raw PostgREST error objects logged in ~6 places | Info | - |

Non-finding commits on the branch: c1ec4e1 (pin `@electric-sql/pglite` devDependency so typecheck/vitest run), 0d8ca77 (e2e skip without Supabase URL), 2d682b6 (lint), the docs commits for the raw findings, and the Phase 2 refactor slices (R1-R15: dead code, shared primitives in `lib/`, file splits, cycle breaks). The refactor commits carry no finding ID; the few that change behaviour are listed in section 8.

## 2. Critical

None found.

## 3. Findings by severity

### 3.1 High

#### AI-01 = DB-01 - High - `projects.studio` readable/writable by the owner: private models and forged unlock
Status at HEAD: Fixed (code + migration 0100, NOT RUN). Commits: 391f854 (main fix); 2141a19 (review gaps G1.1 null / non-object `studio`, G1.3 owner-only writes, G1.4 narrow fallback); 05ce7c1 (G1.2: job snapshot stored without the models); 0090118 (G1.2: old snapshots cleaned inside 0100). Tests: `lib/studio/db/studio-private.test.ts`, `lib/studio/server/product-routes.test.ts`, `lib/engineering/snapshot.test.ts` (mock fixed in 520cbb4). Deploy: code first (it falls back to `studio.productPrivate` until 0100 runs), then 0100. Still open: AI-02, and the route-only 256 KB cap / `StudioDocSchema` on a direct PATCH of the rest of `studio` (reviewer G1.5, Info).
- Evidence: `0068_design_studio.sql:23-25` (`add column if not exists studio jsonb`); `0015_projects.sql:147-151` (`projects_update ... using (user_id = auth.uid() ...)`) with table-wide update grant (0015:130); no guard trigger on `studio` (0042's `projects_guard_credit_columns` covers only credit columns). `app/api/studio/product/model/route.ts:30` `const unlocked = cur.owned.product.unlockedId === q.data.designId;`. `lib/studio/server/doc.ts:66-68` reads `productPrivate:studio->productPrivate` with the user client. `lib/studio/product/private.ts:1-11` / `:83-86` claim "a page can't erase, forge or unlock anything" - true only on the `saveDoc`/`mergeServerOwned` path.
- Scenario: (a) `GET /rest/v1/projects?id=eq.<own>&select=studio->productPrivate` returns every `designs[].model` / `best.model` before "Create my CAD". (b) `PATCH` with `studio.product.unlockedId=<designId>` then `GET /api/studio/product/model` returns the model; STLs build without a credit. `regens` can be reset to 0 so `/product/design` regenerations stay free (feeds AI-06). The 256 KB cap and `StudioDocSchema` are route-only, so a direct PATCH stores arbitrary JSON. Class teachers can do (a) on students' projects (0096:247-249).
- Fix applied (391f854): migration `0100_studio_private.sql` creates `public.project_studio_private` (service_role only, RLS on, no policies), back-filled from `projects.studio->'productPrivate'`, then removes the key from `projects.studio` (updated_at preserved); trigger `projects_guard_studio_server_keys` stops anon/authenticated writes from storing `productPrivate` or changing `studio.product` (`unlockedId` pinned to the stored value, removed on insert; `studio_version` untouched so the `/api/studio/doc` optimistic check is unchanged); `studio_product_save(project, version, studio, private)` (service_role only) writes doc + private models in one transaction. App: `lib/studio/server/doc.ts` reads models and writes product changes with `createServiceClient()` after the RLS ownership read; no service key -> 503 `{ error: "service_unavailable" }`. The engineering-job snapshot no longer carries `productPrivate` (05ce7c1); the admin download adds the models from `project_studio_private` at read time. Review fixes (2141a19): `studio = null` or a non-object is coerced to `{}` with the stored `product` restored; `studio_product_save` takes the user and raises `not_owner`; the five product write routes use `studioRequest({ owner: true })` (404 for anyone but the owner or a super_admin, before any AI call or charge); the pre-0100 fallback matches only the specific error codes and object names; 0100 ends with `notify pgrst, 'reload schema'`. Class teachers keep read access (model, engineer views). Shared PGlite helper `lib/db-test/pglite.ts` mirrors Supabase default privileges. RLS cannot hide a jsonb sub-key from SELECT, so a trigger alone would not have closed the read side.
- Not covered (unchanged by the review fixes): the 256 KB cap / `StudioDocSchema` shape on direct PATCH of the rest of `studio` (route-only); AI-02 (models still returned by `/check` and `/design`).
- Test: `lib/studio/db/studio-private.test.ts` (PGlite, migration applied twice, hole shown before and closed after); `lib/studio/server/product-routes.test.ts` updated (pre-0100 fallback and 503 cases).

#### DB-02 - High - `log_ai_usage` is client-callable and unbounded (global AI quota kill-switch)
Status at HEAD: Fixed (code + migration 0101, NOT RUN). Commits: 79b57da (both overloads revoked from sessions, `log_ai_usage_server`, per-row clamps, `ai_usage_totals` revoked from anon), 4fb95e5 (G2.1: the route's verified user id is passed in; a failed lookup is not cached). Tests: `lib/ai/db/ai-usage-lockdown.test.ts` (2e9-token insert by a session shown before, denied after), `lib/ai/usage.test.ts`. Until 0101 runs the app uses the old client RPC and the kill-switch stays open. Without `SUPABASE_SERVICE_ROLE_KEY` usage rows are skipped, so the daily guard counts nothing (fails open); `quota()` also fails open on an RPC error (unchanged). Reviewer G2.2 (Info): authenticated users can still read the per-provider totals.
- Evidence: `0088_ideation_tokens.sql:194-219` inserts `p_total_tokens`, `p_outcome`, `p_provider` verbatim, `grant ... to authenticated`, only `revoke ... from public`; the 13-arg overload (`0031:105-132`) is also live. `ai_usage_totals` (`0031:134-142`) sums every non-test row per provider. `lib/ai/usage.ts:86-112` `paused: share >= guardThreshold()`.
- Scenario: a guest runs `rpc('log_ai_usage', {p_provider:'<provider>', p_feature:'analyse', p_total_tokens:2000000000, p_outcome:'ok', ...})`; every AI feature reports `paused` for all users until the provider day resets. `p_cost_usd` up to 100 per row also pollutes admin cost dashboards.
- Fix proposed: revoke both overloads from anon/authenticated and log through service_role with explicit `p_user`; short term require `auth.uid()`, clamp token values (`least(greatest(...),1000000)`), rate-limit 30/min/user, cap per-user contribution in `ai_usage_totals` or count only server-written rows (`logged_by_server`).
- Test: `lib/ai/db/ai-usage-quota.test.ts`: anon EXECUTE denied; authenticated 2e9-token insert is clamped and `ai_usage_totals` stays under the limit.

#### API-01 ~ DB-26 - High - Payments auto-approved from a user-supplied screenshot
Status at HEAD: Partially fixed — see note. Commits: 37278c4 (the payment's GT code must appear in the receipt note or transfer reference, else `needs_review` with reason `reference_mismatch`), 00400b9 (Arabic-Indic and Persian digits folded, so a genuine payer is not sent to review; honest doc comment on `checkReceipt`). Test: `lib/billing/billing.test.ts`. What the check does: it stops reuse of a genuine receipt that lacks this payment's code (an old transfer, someone else's screenshot) and lazy forgeries. What it does not do: stop a forged or edited screenshot that includes the payer's own code, because checkout shows the payer that code. The real controls are the owner decisions (5.1 no auto-approval for `kind='service'`, 5.2 per-user / per-amount caps, 5.22 unique `lower(transfer_ref)`) plus the existing refusal of a reused image hash or transfer ref (`0089:264-273`). Until those land, auto-approval is a convenience for honest payers, not a payment check.
- Evidence: `lib/billing/server.ts:110-113` `const { data: status, error: settleError } = await service.rpc("payment_settle", {` / `p_payment: payment.id,` / `p_status: verdict.ok ? "approved" : "needs_review",`. `lib/billing/verify.ts:99-110`: only checks receipt-ness, confidence >= 0.7, currency, amount, recipient string (public strings in `lib/billing/config.ts:53`: `["CR-236988", "236988", "GESTALTUNG", ...]`), plausible date and any non-empty transferRef; the payment's own `reference_code` (GT-XXXXXX) was never compared with `receipt.note`. `0089_payments_maker_pass.sql:264-273` downgrades only on a reused image hash / transfer ref, then `payment_apply_internal`. `0092_engineer_services.sql` (`elsif p.kind = 'service'` -> `insert into public.engineering_jobs`): an approved service payment opens a paid engineer job. DB-26 adds: duplicate guard is exact `proof_hash` or `transfer_ref` (`0089:264-273`); re-encoding defeats the hash.
- Scenario: edited image of any Fawran confirmation (recipient "Gestaltung", exact amount, today's date, made-up reference) -> tokens / pass / human engineering job with no money received.
- Fix applied (37278c4, 00400b9), what it really is: `checkReceipt()` requires the payment's `reference_code` in the receipt note or transfer reference (compared after `fold()`: case, spaces, dashes and digit script ignored); otherwise `needs_review` with reason `reference_mismatch` (EN + AR message). This stops reuse of a genuine receipt that lacks this payment's code. It does not stop a forged screenshot that includes the payer's own code: checkout displays that code to the payer, and the model reading the image cannot tell edited text from real text. Behaviour change: genuine payers who forget the note wait for manual approval. Files: `lib/billing/{server,verify}.ts`, `messages/{en,ar}.json`.
- Still open (these, not the code check, are the real controls): never auto-approve `kind='service'`; cap auto-approvals per user/period and amount; unique index on `lower(transfer_ref)` for approved/verifying/needs_review rows (DB-26 proposal). Existing control: a reused image hash or transfer ref is already downgraded to review (`0089:264-273`).
- Test: `lib/billing/billing.test.ts` (extended in 37278c4). Proposed extra: route-level `submitProof` on a `kind:"service"` row with a perfect receipt ends `needs_review`; a second payment with the same transfer_ref goes to `needs_review`.

#### AI-02 - High - Paid "Create my CAD" model reaches the browser before payment
Status at HEAD: Open — needs owner decision. No commit. 0100 does not change it (`/product/check` and `/product/design` still return `model`).
- Evidence: `app/api/studio/product/design/route.ts:89` maps `model: d.model` for every design. `app/api/studio/product/check/route.ts:43,61,87` returns `{model}` on `skipped:"no_key"`, `skipped:"quota"` and on success `model: changed ? after.model : model`. `lib/studio/product/private.ts:117` `finalModel = (d) => d.best?.model ?? d.model`. `unlock/route.ts` spends the CAD credit; `model/route.ts:31` is the only gated reader.
- Scenario: call `/product/check` (consent only, no credit) with three minimal valid PNGs for any designId and read `model`; STL/STEP are built client-side from it, so the unlock buys nothing extra.
- Fix proposed: owner decision because previews are rendered client-side from the geometry. Options: render previews server-side; ship a reduced/obfuscated preview mesh; or accept the model as public and price the export server-side. Either way drop `model` from `/check` and, once a server preview exists, from `/design`.
- Test: route test that `/check` and `/design` response bodies contain no `model` key.

#### AI-03 - High - cad-worker static sandbox is a denylist with confirmed bypasses
Status at HEAD: Partially fixed — see note. Commits: fcc0e12 (the AST check now applies the attribute rules to `match` class-pattern keyword names and mapping keys, bans `parse_file` / `parseFile` and file / path / numpy read-write attribute names; README says the static check is a filter and the runtime controls are the boundary), af19a4b (`stripPython` string regex excluded the letter `n` instead of a newline, a denylist bypass). Tests: `services/cad-worker/tests/test_sandbox.py` (158 passed per the commit), `lib/cad/validate.test.ts`. Not done: an allowlist or stub facade for the `cadquery` surface; the Cloud Run controls (section 5.21) remain the real boundary and are unverified.
- Evidence: `services/cad-worker/app/sandbox.py:149-168` AST walk checks `ast.Name`, `ast.Attribute`, import aliases, arg names, keyword args, capture names but not `ast.MatchClass` keyword-pattern attribute names (`kwd_attrs`). `services/cad-worker/app/runner.py:198` `make_namespace({"cadquery": cq, "math": math, "cadhelpers": cadhelpers}, log)` hands the model the real `cadquery` module. `sandbox.py:40-50` `BANNED_ATTRIBUTES`/`BANNED_ATTRIBUTE_PREFIXES` fixed denylist. `lib/cad/validate.ts:91-96` TS pre-check is regex denylist only.
- Proven locally (pure Python, no network; payloads not recorded): `sandbox.validate()` accepts a `match`/`case` class pattern whose keyword-pattern attribute name is a dunder (runtime binds a dunder attribute, re-opening introspection); pyparsing 3.x `ParserElement.parse_file(path)` reads an arbitrary file into the exception's `.pstr`, reachable through the exposed `cadquery` object.
- Impact: with child process, rlimits, `block_network`, scrubbed env, 45 s kill, Cloud Run gVisor, zero-role SA and `--no-allow-unauthenticated` + `CAD_WORKER_TOKEN` intact, a bypass yields in-sandbox file read/introspection, not host compromise. Deployment flags are not verifiable from the repo (unverified).
- Fix proposed: treat `sandbox.py` as a filter, not a boundary (update the README wording); reject `ast.Match` or inspect `kwd_attrs`/`MatchMapping.keys`; allowlist the cadquery surface or run against a stub facade.
- Test: sandbox unit tests rejecting `match` dunder patterns and `parse_file`-style chains; worker test that a file-read attempt returns `ok:false` with no content in `error`/`log`.

#### WEB-01 - High - Stored XSS against super_admin via schematic revision SVG
Status at HEAD: Fixed (code), render side. Commits: 29be530 (inert `<img>` data URI), 59eb979 (render test). Tests: `lib/prototyping/svg-data-uri.test.ts`, `lib/prototyping/schematics-stage.render.test.ts` (hostile stored revision: no `onerror=`, no `foreignObject`, no live `<image>`, exactly one `data:image/svg+xml` `<img>`). Not done: column revoke / redraw from stored inputs (defence in depth); the "download SVG" button still saves the stored markup as a file.
- Evidence: `components/prototyping/schematics-stage.tsx:130-136` `await supabase.from("project_schematic_revisions").insert({` ... `svg,` (browser writes the markup). `0020_prototyping.sql:229-231` `create policy project_schematic_revisions_insert ... with check (public.owns_schematic(schematic_id));` (owner or super_admin; guests are `authenticated`). `workspace.tsx:343-346` reads it back; `schematics-stage.tsx:317-320` `// Generated locally by lib/prototyping/schematic.ts ... no user HTML reaches this.` / `dangerouslySetInnerHTML={{ __html: shown.svg ?? "" }}`. Viewer: `/projects/[id]/prototyping` is super_admin-only (`prototyping/page.tsx:52-55`) and `owns_schematic` lets the admin read every project's revisions.
- Scenario: client or guest creates a project and POSTs to `/rest/v1/project_schematic_revisions` `{schematic_id:<theirs>, rev:99, status:"ready", svg:"<img src=x onerror=...>"}`. When the admin opens that Engineer workspace the handler runs in the admin session on the app origin; Supabase cookies are JS-readable (WEB-04) so access + refresh tokens can be stolen -> full super_admin. No CSP (WEB-03).
- Fix proposed: (a) redraw from stored inputs at display time (`drawSchematic({code,rev,kind,title,material,quantity,features})`), or (b) render stored SVG in an inert `<img src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)}>` as `workspace.tsx:1018` already does, or (c) DOMPurify `USE_PROFILES:{svg:true}`. Defence in depth: new migration revoking client INSERT/UPDATE on `svg` or an SD RPC rendering server-side.
- Fix applied (29be530): `components/prototyping/schematics-stage.tsx` renders `<img src={svgDataUri(svg)} alt="<code> <title>">` (same sizing, nothing when no SVG); data-URI builder moved to `lib/prototyping/svg-data-uri.ts` and shared with `workspace.tsx`. Inside `<img>` an SVG cannot run scripts or handlers. The other `dangerouslySetInnerHTML` sites (`svg-frame.tsx`, `SchematicFrame.tsx`) were re-checked: locally generated SVG only. The "download SVG" button still saves the stored markup as a file (not rendered).
- Test: `lib/prototyping/svg-data-uri.test.ts` (prefix, decodes back to input, no raw quote/bracket/#/% in payload); `lib/prototyping/schematics-stage.render.test.ts` (59eb979) renders the real component with a hostile revision. The PGlite column-revoke test is not written (the column revoke is not done).

### 3.2 Medium

#### DB-03 - Medium - Browser CAD path returns SCAD before payment
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `app/api/cad/route.ts:185-193` returns `scad` once `cad_set_code` succeeds. Charge happens only when the browser calls `cad_deliver` (`components/credits/cad-card.tsx:269`); the browser may call `cad_fail` instead (`cad-card.tsx:263`; RPC `0043:185-199`, granted to authenticated).
- Scenario: a client with >= 1 CAD credit (to pass `cad_begin`) calls `/api/cad`, keeps `scad`, never delivers. Only limit: `too_many_failed` (`0090:86-90`, 5 undelivered per 24 h) = 5 free LLM CAD generations per day per account.
- Fix proposed: charge at code-store time, refund only on server-verified failure; or `cad_begin` raises `pending_delivery` while a pending row with `scad` exists (>2 min), `cad_settle_stale()` (service_role) delivers stale ones after 30 min, and `cad_fail` from a JWT caller allowed only while `scad is null`.
- Test: `lib/cad/db/cad-settle.test.ts`: begin -> set_code -> `cad_fail` as owner rejected once scad is set; `cad_settle_stale` charges 1 credit.

#### DB-04 - Medium - `spend_credit` mints QAR 20 vouchers without AI use
Status at HEAD: Partially fixed — see note. Commits: 2067917 (`spend_credit_for` for service_role; `spend_credit` revoked from sessions), 189c26e (G-C1: `cad_set_code` server-only, so CAD cannot mint a spend row either). Migration: 0102, NOT RUN; before it runs the code falls back to the session `spend_credit` / `cad_set_code`. Tests: `lib/credits/db/credits-server-spend.test.ts` (PGlite on the real 0096, applied twice, hole shown before), `lib/credits/credits.test.ts`. Closed: a session can no longer create a redeemable `spend:` row without a real model call. Open: the reward rules (3 wiring + 1 CAD credit per delivered order of any value, edu grants, QAR 20 vouchers) are an owner decision (5.6).
- Evidence: `0096:319-385` granted to authenticated, inserts `'spend:'...`, `redeemable_until`. `redeem_credits` (`0042:533-590`) turns each such row into QAR 20 off. Free sources: purchase reward 3 wiring + 1 cad (+2 idea) per delivered order of any value (`0090:156-181`, `0090:169-172`), edu 2+1 (`0075:29-31`), print reward, admin grants.
- Scenario: after any delivered order call `rpc('spend_credit',{p_step:'wiring',p_project})` x3 and `('cad')` x1 = QAR 80 off the next order within 30 days; that order grants 4 more: perpetual ~QAR 80 per order, plus QAR 60 per edu address.
- Fix proposed: revoke `spend_credit` from authenticated; add `spend_credit_for(p_user, p_step, p_project)` for service_role called by AI routes only after the provider call (or set `redeemable_until` only under a server GUC `app.ai_spend='on'`); consider a minimum goods value in `grant_credits_for_order_internal`.
- Test: `lib/credits/db/voucher.test.ts`: direct `spend_credit` denied (or creates no redeemable row); `redeem_credits` then applies 0.

#### DB-05 - Medium - Any confirmed user can be a "teacher"
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `create_school_class` requires only `ai_role() in ('user','admin')` (`0096:470`). `create_part_order` makes economy shipping free when `v_class` is the caller's class (`0097:142-144`, `257-259`) whatever the contents. `projects_enforce_limit` skips class projects (`0096:409-417`).
- Scenario: create a class, pass `p_class_id` at checkout with economy tier: shipping 0 (QAR 50 saved per order); join your own class repeatedly for up to 20 x 40 projects past the 3-project cap.
- Fix proposed: `school_classes.verified_at` (admin sets); free class delivery and the cap exemption only when verified and >= 2 teams; or limit free delivery to lines whose `project_id` is a team project of that class.
- Test: `lib/schools/db/class-order.test.ts`: unverified class order is charged shipping; verified is free.

#### DB-06 - Medium - Class join code lets anyone drain the teacher's credits
Status at HEAD: Partially fixed — see note. Commits: 2067917 + 0102 (NOT RUN). Test: `lib/credits/db/credits-server-spend.test.ts`. Closed: looping `spend_credit` on a team project no longer works as a session; each charge now follows a real model call through a route. Open: no per-team / per-day cap and no join throttle (DB-06b; reviewer G-C4, Info).
- Evidence: `join_class_team` accepts any uid, guests included (`0096:501`), and creates a project the caller owns. `spend_credit` bills the teacher for class projects (`0096:336-342`) with only a project-owner check (`0096:350-354`). No per-team cap, no code-attempt limit; 29^6 codes from `random()` (`new_join_code`, `0096:432`).
- Scenario: anyone with the 6-char code joins and loops `spend_credit('wiring', <team project>)`, emptying a paid pack (15 credits / QAR 199) with no AI use.
- Fix proposed: `class_teams.credit_cap` (default 3) / `credits_used`, `team_cap` exception, teacher approval before spending, throttle `join_class_team` (<= 5 joins/hour/uid); combine with DB-04.
- Test: extend `lib/schools/db/schools-migration.test.ts`: fourth spend on a team raises `team_cap`; unapproved team cannot spend.

#### DB-07 - Medium - Job cancel converts expiring Maker Pass tokens into permanent tokens
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 47cccf8. Test: `lib/db-test/guards-and-grants.test.ts` (BEFORE hole, AFTER fix, applied twice). Remainder: DB-07b.
- Evidence: submit charges `idea_pass` first (`0091:127-131`); refund always credits `'idea'` (`0091:153-155` `values (j.user_id, 'idea', j.tokens, 'job_refund:'...)`); user can cancel while queued (`0091:161-172`).
- Scenario: before the pass ends, submit a pass-paid job and cancel; tokens return as non-expiring. Repeat monthly.
- Fix proposed: refund per original kind from the ledger (`insert ... select user_id, kind, -delta, 'job_refund:'||id ... where reason='job:'||p_job and delta < 0`).
- Test: `lib/engineering/db/job-refund.test.ts`: pass-paid cancelled job returns `idea_pass`.

#### DB-08 - Medium (functional) - `claim_guest_work` aborts on duplicate welcome rows
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 47cccf8. Test: `lib/db-test/guards-and-grants.test.ts`. Remainder: DB-08b.
- Evidence: unique index `credits_ledger_idea_welcome_once on (user_id) where kind='idea' and reason='idea_welcome'` (`0088:31-33`). `claim_guest_work` moves every ledger row except duplicate `purchase:%` (`0071:209-218`), never updated after 0088. `idea_token_status` grants the welcome row to every session (`0089:396-398`).
- Scenario: a guest who opened the Studio signs in to an account that already has the welcome row; the update violates the index, the whole claim rolls back, and the guest's projects, cart and orders stay on the orphaned guest.
- Fix proposed: delete the guest's `idea_welcome` row first when the target already has one.
- Test: `lib/auth/db/claim-guest-work.test.ts`: both users hold a welcome row, claim returns ok, account keeps exactly one.

#### DB-09 - Medium - Supplier cost and margin readable by anon
Status at HEAD: Fixed (code + migration 0105, NOT RUN). Commits: bd31e8a (column grants, `parts_admin` view, `store_settings_select` hides internal keys, public reads name columns via `lib/store/part-columns.ts`), 2e52716 (Engineer-view embed names columns: the last prerequisite), ce9c2da (`security_barrier` view, post-condition asserts that fail the migration if cost is still readable, re-run warning). Tests: `lib/store/db/parts-cost-private.test.ts`, `lib/db-test/parts-cost-asserts.test.ts`. Deploy: code first, then 0105. Unverified: admin `insert(...).select("id, sku")` on `parts` needs PostgREST to RETURN only the selected columns (confirm once on staging after 0105).
- Evidence: `0011:55` `grant select on public.parts to anon, authenticated`; `0011:58-61` row filter only; cost columns `0028:107-115` (`landed_cost_qar, expected_income_qar, income_pct, below_floor, pricing_mode, pinned_offer_id, preferred_offer_id, is_test`). `store_settings_select` exposes `margin_floor_pct`, `commission_floor_pct`, `fx_to_qar`, `rewards`, `studio_quote_rule`, `school_pricing`, `anonymous_cleanup`, `backup_search` (`0060:128-131`).
- Scenario: `GET /rest/v1/parts?select=sku,unit_price,landed_cost_qar,expected_income_qar,income_pct` with the anon key returns the catalogue's margins.
- Fix proposed: move cost columns to admin-only `part_economics (part_id pk)` (column grants alone would also hide them from admins, who share the `authenticated` role); restrict `store_settings_select` to an allowlist of public keys.
- Test: `lib/store/db/parts-columns.test.ts`: anon selecting `landed_cost_qar` errors; admin reads `part_economics`.

#### DB-10 - Medium - Anonymous orders zero `own_stock` and spam orders
Status at HEAD: Fixed (code + migration 0103, NOT RUN). Commits: 47cccf8 (caps), ae11361 (phone cap on the last 8 digits; checkout error mapping, EN + AR), 781a510 (the three messages reach the page). Tests: `lib/db-test/guards-and-grants.test.ts`, `lib/store/checkout.test.ts`, `lib/store/place-order.test.ts`. Remainders: DB-10b, DB-10c. Cart quantity is still not clamped at 1000 client-side (a larger value now shows the cap message).
- Evidence: `part_order_items_own_stock` decrements on every inserted line (`0069:141-161`), never restored on cancel. `create_part_order` granted to anon (`0097:274`), status defaults to `confirmed`, qty has no upper bound (`0097:190`; `greatest(1, qty)`, huge -> numeric overflow).
- Scenario: anon RPC with `quantity: 99999` per own-stock SKU sets stock to 0 and flips `in_own_stock`; each call is also an admin-visible fake order.
- Fix proposed: cap qty <= 1000 and lines <= 100; per-`customer_phone` limit (5/hour); move the decrement to a `paid`/`sourcing` status trigger and restore on `cancelled`.
- Test: `lib/store/db/order-limits.test.ts`: qty 99999 raises; cancel restores `own_stock`.

#### DB-11 - Medium (Low/Medium) - `log_project_event` callable by anyone
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 47cccf8. Test: `lib/db-test/guards-and-grants.test.ts`. Every in-database caller is SECURITY DEFINER; no app code calls the RPC.
- Evidence: `0033:46-53` SECURITY DEFINER with only `revoke all ... from public` (`0033:53`); no ownership check; inserts arbitrary `type`/`detail` for any project id.
- Fix proposed: `revoke all on function public.log_project_event(uuid,text,jsonb) from anon, authenticated;` internal callers are SD and keep working. Same sweep for `offer_landed_cost_qar` (DB-19), `ai_usage_totals` (anon), `class_teacher_of_project`/`is_class_project` (DB-22).
- Test: `lib/security/db/function-grants.test.ts` asserting `has_function_privilege` false for anon/authenticated on every "internal" SD function (list generated from `pg_proc where prosecdef`).

#### DB-12 - Medium (Low/Medium) - Owners can set `projects.is_test`
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 47cccf8. Test: `lib/db-test/guards-and-grants.test.ts`.
- Evidence: `projects_update` lets owners write every column (`0015:147-151`); `propagate_project_is_test` copies the flag onto `ai_usage` (`0031:66-82`); `ai_usage_totals`, `ai_usage_daily`, `project_ai_charges` exclude `is_test` (`0031:141`, `0042:736`, `0038:39`).
- Fix proposed: BEFORE UPDATE trigger `if current_user in ('anon','authenticated') and not public.is_super_admin() then new.is_test := old.is_test; end if;` (same for `tenant_id`).
- Test: owner PATCH `is_test=true` leaves the value unchanged.

#### DB-14 - Medium (conditional on `kit_discount_pct > 0`) - Kit discount on arbitrary lines
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `project_kits_insert ... with check (user_id = auth.uid() and public.owns_project(project_id))` (`0025:99-101`); checkout only checks the kit is the caller's and unordered (`0097:205-208`, `250`). `kit_discount_pct` is admin-editable (`dashboard/store/attributes/actions.ts:101`); seed value 0; live value unverified.
- Fix proposed: revoke INSERT on `project_kits`; SD `create_project_kit(p_project)` snapshotting BOM-matched part ids into `part_ids uuid[]`; count a line toward `v_kit_sum` only if `v_part.id = any(kit.part_ids)`.
- Test: kit with part A applied to a part B line gives no discount.

#### DB-15 ~ WEB-06 - Medium (DB: Low/Medium, WEB: Low) - `quote-uploads` anonymous unlimited uploads
Status at HEAD: Partially fixed — see note. Commit: 75a6715 (migration 0104, NOT RUN, run after 0103): the `quote-uploads` INSERT policy also requires `name ~* '^<uuid>/[a-z0-9._-]{1,200}$'`, no `..`, matching what `components/design/quote-request.tsx` writes and `lib/design/quote-paths.ts` signs. The 50 MB limit and the absence of a MIME restriction are unchanged (owner decision). Test: `lib/design/db/quote-upload-policy.test.ts`.
- Evidence: `0012_quote_uploads.sql:17-25` `create policy quote_uploads_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'quote-uploads');` bucket 50 MB, no `allowed_mime_types`. Client path `${uuid}/${sanitize(name)}` (`quote-request.tsx:182-187`). Select/delete admin-only; no UPDATE policy so overwrite is impossible.
- Scenario: anyone with the anon key stores unlimited 50 MB objects of any type (cost/quota exhaustion). Not readable by others, not an XSS vector.
- Fix proposed: set `file_size_limit` 26214400 and `allowed_mime_types` (stl, octet-stream, step, dxf, pdf, png, jpeg); policy `and name ~ '^[0-9a-f-]{36}/[^/]{1,200}$'`; better, have `/api/design-quote` (after `checkTurnstile`) issue `createSignedUploadUrl` and drop the anon insert policy; clean orphans after N days.
- Test: insert with path `a/b/c.html` rejected (storage schema stub); as `anon` insert into `quote-uploads` denied after the migration.

#### API-02 - Medium - Emails to arbitrary addresses with attacker-controlled text
Status at HEAD: Partially fixed — see note. Commits: 47cccf8 + 0103 (NOT RUN): `project_recovery_begin` sends at most 3 emails per contact address per 24 h; ae11361: it also refuses class team projects (no mail for a link that can never be claimed). Test: `lib/db-test/guards-and-grants.test.ts`. Open: Turnstile on checkout / recovery-email, address-level limits on order-confirmation mail, plus API-02b (index); plus-addressing is not folded.
- Evidence: `0097_class_order.sql:273` `grant execute on function public.create_part_order(...) to anon, authenticated;` (no rate limit in the body). `app/api/orders/confirmation/route.ts:24-26,55`: any caller with the fresh order id sends `confirmationEmail` to `order.customer_email`; mail opens `Hi ${e(o.customer_name)}` (`lib/store/order-email.ts:165`) and carries the IBAN / Fawran alias. `app/api/projects/recovery-email/route.ts:37,48-50` + `0045_project_recovery_link.sql:166-171`: cap 3/day per auth user id; anon sessions are free to mint; project name in the mail (`lib/projects/link-email.ts:43`).
- Scenario: script anon sign-in -> `create_part_order` / create project -> POST confirmation / recovery-email with a victim address and a name like "Your account is locked, call +974...". Sent from the brand's Resend domain: spam/phishing, reputation damage. HTML is escaped but plain-text URLs auto-link.
- Fix proposed: Turnstile (`lib/turnstile-server.ts`) on checkout and the recovery form; per-email / per-IP limits in SQL (<= 3 confirmations per address per day); reject URLs/phone numbers in names used in outbound mail.
- Test: second recovery email to the same address from a new anonymous user within 24 h refused once an address-level cap exists.

#### API-03 / AI-09 - Medium (AI-09: Low) - No CAPTCHA or rate limit on public lead/demand/AI-chat endpoints
Status at HEAD: Fixed (code). Commits: 5b726d1 (`/api/demand`), a2c5de4 (`/api/design-quote`), ab7d08c (brief-chat, transcribe), 1d9a88c (store-lead: only a signed-in non-anonymous account skips Turnstile; pure `leadAllowedFor()`), 1a9da3f (brief-chat and dictation clients send the token). Tests: `lib/store/demand-route.test.ts`, `lib/prototyping/ai-route-guard.test.ts`, `lib/lead-gate.test.ts`; 1a9da3f and the design-quote route have no test. All Turnstile checks are a no-op while the `store_settings` switch is off (section 7). The in-memory limiters are per instance. Remaining dependency: Supabase Auth CAPTCHA state (5.18).
- Evidence: `app/api/store-lead/route.ts:108-116` `if (token && (await checkTurnstile(request, token)).ok) return true;` ... `return !!user;` (any Supabase session, incl. anonymous, skips Turnstile; safe only if Supabase Auth CAPTCHA is ON, FINDINGS #8, dashboard state unverified). `app/api/demand/route.ts:32-58` and `app/api/design-quote/route.ts` had no Turnstile or limit; demand `kind:"request"` emails the owner with `replyTo: email` (attacker-chosen). `lib/rate-limit.ts` limiter was used only by `/api/store/search`. AI-09: `app/api/brief-chat/route.ts:28-51` (session + global `quota` only), `app/api/transcribe/route.ts:27-53` (session + Groq `quota` only); `/api/analyse` gates guests with Turnstile (`analyse` route 69-72) and `bomRate`.
- Scenario: flood the owner inbox and `inquiries` (SECURITY_REVIEW M3), spoof reply-to; an anonymous session burns the shared free Gemini/Groq allowance so the guard pauses the feature for everyone.
- Fix applied: `/api/demand` (5b726d1): Turnstile on kind `request` (token from `x-turnstile-token` or `body.turnstileToken`, 403 `{error:"captcha_failed"}`; no-op while the store_settings switch is off), per-IP limiters (beacons 300 / 10 min, request 10 / 10 min, 429 + `Retry-After`), client `request-item-button.tsx` asks the Turnstile dialog for a token. `/api/design-quote` (a2c5de4): Turnstile (signed-in non-anonymous accounts exempt when enforced; guests not), 10 requests / 10 min / IP, 429 `rate_limited`; `quote-request.tsx` waits up to 10 s for a fresh widget token.
- Fix applied (ab7d08c, AI-09): anonymous sessions must pass `checkTurnstile()` on brief-chat and transcribe (403 `{error:"captcha_failed"}`; no-op while the store_settings switch is off); every caller is rate-limited per user id and guests also per IP via `lib/prototyping/ai-route-guard.ts` + `lib/rate-limit.ts` (in memory, per instance; 429 `{error:"rate_limited"}` with Retry-After). `bomRate()` deliberately not reused because it shares the daily counter with `/api/analyse` (guests 5/day). The brief-chat and dictation clients now send the token (1a9da3f).
- Fix applied (1d9a88c): store-lead exempts only a signed-in non-anonymous account (`leadAllowedFor()`); guests need a token. The in-workspace callers (BOM quote request, Studio get-it-made and print request, drawing request) and the brief-chat and dictation clients (1a9da3f) now ask the page's challenge dialog for a token via `guestCaptchaToken()`; the schools invoice stays exempt (teacher session, now in-process, 405ca7e).
- Test: `lib/store/demand-route.test.ts` (5b726d1); `lib/prototyping/ai-route-guard.test.ts` (ab7d08c). `lib/lead-gate.test.ts` (1d9a88c). `/api/design-quote` has no route-level test (needs cookies()/Supabase mocks).

#### AI-04 - Medium - `/api/cad` forwarded the client's `x-vercel-oidc-token` as the WIF subject token
Status at HEAD: Fixed (code). Commits: d9603a5, af7a1c3 (dead `oidcToken` field removed; the regression tests still pass a stale token to prove it stays inert). Test: `lib/cad/cloud.test.ts`. Ops check on the WIF provider conditions remains (5.20).
- Evidence (before the fix): `app/api/cad/route.ts:116` `oidcToken: request.headers.get("x-vercel-oidc-token")`; `lib/cad/cloud-flow.ts:228,257`; `lib/cad/cloud.ts:106-108` `vercelOidcToken(passed)` returned `passed.trim()` ahead of the Vercel request context and `process.env.VERCEL_OIDC_TOKEN`; `cloud.ts:165-174` became `subjectToken` in the Google STS exchange. Not logged.
- Scenario: a client-supplied token overrides the server's own; harmless only if the WIF provider accepts solely Vercel-issued tokens for this deployment (unverified); otherwise a client could mint SA credentials.
- Fix applied (d9603a5): route no longer forwards the header; `vercelOidcToken()` takes no argument; `BuildOpts.oidcToken` kept (deprecated, ignored) so `lib/cad/cloud-flow.ts` compiles unchanged.
- Test: `lib/cad/cloud.test.ts`: caller-supplied token never reaches STS; request-context value wins over env; caller token alone does not enable the cloud path.

#### AI-05 - Medium - Wiring charge is check-then-spend after the result is returned
Status at HEAD: Fixed (code). Commit: d33b23d. Test: `lib/credits/wiring-charge.test.ts`. For every non-admin caller `/api/netlist`, `/api/bom/electronics` and `/api/studio/wiring` now answer 503 `unavailable` before the model call when the service key is missing, and return no circuit (401 / 402 / 404 / 503, the saved bom and netlist rolled back) when the charge fails. This also closes reviewer G-C2 (free wiring without the key after 0102). The PGlite concurrency test proposed below was not written; the rollback covers the race at route level.
- Evidence: `app/api/netlist/route.ts:47-59` `canUse("wiring")` -> `buildElectronics` -> `spend(...)`, returns `charged: paid.ok ? paid.charged : false` regardless. Same shape in `app/api/studio/wiring/route.ts:57-83` and `app/api/bom/electronics/route.ts:51-62`. `lib/credits/server.ts:43-62` `spend` swallows a missing-RPC error as `{ok:true,charged:false}`. Contrast `cad_deliver` (`0043:141`, `0090:103`) which spends atomically under `for update`.
- Scenario: `canUse` checks `balance >= 1` (`0096:308`) without locking; two concurrent calls on a 1-credit project both pass, both build; `spend_credit` serialises so one raises `no_credits`, but the route already produced and saved the circuit and returns it. Any `spend` error path also returns the circuit with `charged:false`.
- Fix applied (d33b23d): see Status at HEAD. Original proposal, not implemented: a `wiring_deliver`-style SD RPC that re-checks and spends in one call under `for update` before returning; at minimum treat a `spend` failure other than admin/`none` as a hard error.
- Test: PGlite concurrency test (two parallel `spend_credit('wiring', p)` on 1 credit: exactly one `charged:true`, ledger -1); route test that a spend error does not return a netlist.

#### AI-06 - Medium - Ideation-token cost derived from client-supplied `current`/`spec`
Status at HEAD: Fixed (code + migration 0100, NOT RUN). Commit: 154af47 (server-stored tier is a floor, `chargeTier()`). The `regens` half is closed by 0100, including its G1.1 amendment (2141a19). Test: `lib/studio/tiers.test.ts`.
- Evidence: `app/api/studio/spec/route.ts:33-39` `current = body.current`; `cost = turnCost({ started, editTurnsSoFar, current })`. `lib/studio/tiers.ts:101-111`, `125-128` multiply by `tierOf(current)/tierOf(spec).multiplier`. `app/api/studio/product/design/route.ts:50-54` `cost = regenCost(regensSoFar, doc.spec)` (spec server-loaded) but `regensSoFar = cur.owned.product?.regens` is client-writable (AI-01).
- Scenario: send a low-tier `current` to pay the explorer multiplier while the saved card is higher; a direct PATCH setting `regens` to 0 keeps regenerations in the free band. SQL `idea_token_charge` clamps 0..20 but trusts the route's amount.
- Fix applied (154af47): `turnCost` takes the server-written `idea_sessions.tier` (from `idea_token_status`) as a floor via `chargeTier()`; the client card can only raise the tier. With no stored tier (new idea) the floor is the base tier, so honest clients pay what they paid before. The tier stored for the next turn is the tier of the card the model produced, else the tier this turn was priced at, never the client card alone. Files: `app/api/studio/spec/route.ts`, `lib/studio/tiers.ts`.
- Test: `lib/studio/tiers.test.ts` (extended).

#### WEB-02 - Medium - Admin role checks live only in layouts
Status at HEAD: Fixed (code). Commits: 1619d56, fd943f9 (every-page guard test; reviewer G5.1). Tests: `lib/auth/guards.test.ts`, `lib/auth/admin-pages-guard.test.ts` (each `page.tsx` under `dashboard` calls `requireSuperAdmin(` unless on a two-entry allow-list; each `route.ts` has a super_admin check). 12ae731 moves admin actions to the same cached helpers (failure shapes unchanged).
- Evidence: `app/[locale]/dashboard/customers/layout.tsx:18-20` held the only check; `customers/[id]/page.tsx:102-106` `const service = createServiceClient();` ... `await service.auth.admin.getUserById(id);` rendered even when RLS returned nothing (`:117`, email at `:119,141`). Same in `customers/page.tsx:107-111` (`auth.admin.listUsers`) and `projects/page.tsx:77-82`. Next 15.5.25 `node_modules/next/dist/server/app-render/walk-tree-with-flight-router-state.js:41-45` `const renderComponentsOnThisLevel = !flightRouterState || !matchSegment(actualSegment, flightRouterState[0]) || parallelRoutesKeys.length === 0 || flightRouterState[3] === 'refetch';` - layouts the client claims to have (header `Next-Router-State-Tree`) are not executed.
- Scenario (source-confirmed, not executed end-to-end): cookie-less `curl -H 'RSC: 1' -H 'Next-Router-State-Tree: <tree>' https://host/en/dashboard/customers/<uuid>`; if the page renders, the RSC payload contains the user's email, sign-up/last-sign-in dates, provider, anonymous flag. Needs the target UUID. RLS-only pages leak nothing this way; server actions have their own checks.
- Fix applied (1619d56): `lib/auth/guards.ts` with React `cache()` wrappers around `getAuthUser`/`getSessionContext` and `requireSignedIn`/`requireSuperAdmin(locale)`; `requireSuperAdmin` at the top of every admin page (ai-costs, credits, customers, engineering-jobs, notifications, payments, projects, studio-library, usage, all 21 pages under store/**; leads and reviews switched to the helper); layout checks kept as defence in depth at no extra round trip. `engineering-jobs/[id]/snapshot/route.ts` unchanged (already 403s and uses the RLS client).
- Test: `lib/auth/guards.test.ts` (null / guest / client / workshop / admin; `customers/[id]/page.tsx` with client or signed-out session throws the redirect before `createClient`/`createServiceClient`; verified to fail with the guard removed). `vitest.config.mts` now compiles JSX.

#### WEB-03 - Medium - No security headers (SECURITY_REVIEW M5)
Status at HEAD: Partially fixed — see note. Commit: 38d62b7 (`poweredByHeader: false`; HSTS, nosniff, `X-Frame-Options: SAMEORIGIN`, Referrer-Policy, Permissions-Policy and COOP enforced; `Content-Security-Policy-Report-Only`). Test: `lib/security/headers.test.ts`. Open: watch CSP reports for one release (Studio, Drive Picker, Turnstile, GA), then rename the header to `Content-Security-Policy` (owner step, section 7). Until then the CSP blocks nothing.
- Evidence: `next.config.mjs` has `rewrites()`, `redirects()`, `webpack()` but no `headers()`; `vercel.json` only a host redirect + crons; no CSP / X-Frame-Options / frame-ancestors / Permissions-Policy / nosniff anywhere (only per-response `Referrer-Policy: no-referrer` on rating and unsubscribe HTML). `X-Powered-By: Next.js` still sent.
- Impact: nothing blunts WEB-01-class bugs or limits exfiltration; same-site framing and logged-out flows (quote form, guest checkout) unprotected. Clickjacking of signed-in actions largely mitigated by SameSite=Lax cookies.
- Fix applied (38d62b7): `next.config.mjs` `headers()` for `/:path*` from `lib/security/headers.mjs`, `poweredByHeader: false`, CSP as report-only (the Supabase origin comes from `NEXT_PUBLIC_SUPABASE_URL`, `vercel.live` only on preview). Original proposal: `headers()` block + `poweredByHeader:false`; CSP first as `Content-Security-Policy-Report-Only` for one release (Studio WASM/workers, Drive Picker, Turnstile, GA), then enforce. Reviewed policy: `default-src 'self'`; `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` + googletagmanager, challenges.cloudflare.com, cdn.jsdelivr.net, unpkg.com, apis.google.com, accounts.google.com (`'unsafe-eval'` dev only; inline needed because ~50 RSC inline scripts per static page and nonces would force dynamic rendering, which public pages must avoid); `img-src 'self' data: blob: https:`; `connect-src` Supabase (https+wss), GA, Turnstile, jsDelivr/unpkg, googleapis; `frame-src` Turnstile + Google Picker origins; `worker-src 'self' blob:`; `frame-ancestors 'self'`; `object-src 'none'`. Plus `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), microphone=(self)` (dictation uses the mic), `Cross-Origin-Opener-Policy: same-origin-allow-popups`. Full snippet: `docs/audit/findings/sec-web-layer.md` lines 275-347. `vercel.live` for preview deployments unverified.
- Test: vitest importing `next.config.mjs` asserting `await config.headers()` contains the headers for `/:path*`; Playwright smoke with no CSP console violations on `/en`, `/en/store`, `/en/projects/new`, `/e2e-fixtures/studio`, `/en/design/quote` with Turnstile on.

#### WEB-05 - Medium - sharp 0.35.4 (librsvg advisory) reachable via image import
Status at HEAD: Fixed (code). Commits: 41bc697 (sharp 0.35.5), 3d06ce9. Tests: `lib/store/store-image.test.ts`, `lib/net/safe-fetch.test.ts`.
- Evidence: `lib/store/store-image.ts:47-50` `const res = await fetch(u, { signal: AbortSignal.timeout(15000), cache: "no-store" })` / `if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;` / `return Buffer.from(await res.arrayBuffer());` -> `store-image.ts:19` `sharp(buf, { failOn: "none" })`; `app/api/admin/drive-import/route.ts:47,51` same `startsWith("image/")` -> `sharp(buf, ...)`. Advisory: sharp < 0.35.5, librsvg (CVE-2026-96889, GHSA-wq5f-xc86-pv6w, as reported by npm audit; details not fetched).
- Scenario: an SVG served as `image/svg+xml` on an allowed supplier CDN or in an admin-picked Drive folder is decoded by librsvg in the function; host allow-list checked on the first URL only, redirects followed, whole body buffered. All triggers are super_admin actions. `/_next/image` has no remote patterns and `dangerouslyAllowSVG` is off.
- Fix applied: 41bc697 `npm update sharp` -> 0.35.5 (lockfile only; also @img/sharp-libvips 1.3.3 -> 1.3.4); `npm audit --omit=dev` 11 vulnerabilities (3 moderate, 8 high) -> 10 (3 moderate, 7 high), sharp gone from the list. 3d06ce9: `fetchImage` accepts only `image/jpeg|png|webp|gif|avif` plus a magic-byte check, 15 MB cap, hop-by-hop host re-check; `storeImage` checks magic bytes and `metadata().format` and opens with `{ failOn: "error", limitInputPixels: 40e6 }`; `drive-import` goes through `storeImage` with the same 25 MB cap and a raster content-type allow-list.
- Test: `lib/store/store-image.test.ts` (good JPEG -> buffer, SVG -> null, SVG bytes labelled image/jpeg -> null, redirect to foreign host -> null, 20 MB -> null; `storeImage` refuses SVG, still processes JPEG and AVIF on 0.35.5); `lib/net/safe-fetch.test.ts`.

### 3.3 Low

#### DB-13 - Low - Teachers and owners can read `recovery_token`
Status at HEAD: Partially fixed — see note. Commits: 47cccf8 (`claim_project` returns `invalid` for class team projects), ae11361 (`project_recovery_begin` does the same). Tests: `lib/db-test/guards-and-grants.test.ts`. Migration 0103, NOT RUN. Open: teachers and owners can still SELECT `recovery_token` (hide via a private table or an SD RPC).
- Evidence: `projects_select_class_teacher` (`0096:247-249`) exposes all columns; `claim_project` hands the project to any caller holding the token when the current owner is a guest (`0045:209-233`); `projects_guard_recovery_columns` (`0045:102`) guards writes only.
- Scenario: a teacher takes over a guest student's project.
- Fix proposed: `claim_project` refuses when `public.is_class_project(p_project)`; hide `recovery_token` from SELECT (private table, or an SD RPC returning safe columns for teachers).
- Test: teacher calling `claim_project` on a team project returns `invalid`.

#### DB-16 - Low - `inquiries` anon insert unbounded (SECURITY_REVIEW M3 still open)
Status at HEAD: Fixed (code + migration 0103, NOT RUN). Commits: 47cccf8 (length CHECK `NOT VALID` + insert trigger forcing `status='new'`, `is_test=false`), 24d4df1 (`/api/project-cad` caps the lead's name and email). Test: `lib/db-test/guards-and-grants.test.ts`. Ops follow-up: because the CHECK is NOT VALID, an UPDATE of an old over-long row (for example an admin status change) still fails; count such rows, then `validate constraint`.
- Evidence: `0002_inquiries.sql:29-36` `with check (true)` for anon; only quote columns got guards (`0073:79-89`, `inquiries_guard_quote` `0073:97`); `status`, `is_test`, sizes unguarded.
- Fix proposed: length CHECKs (name <= 120, phone <= 40, email <= 160, message <= 8000) `not valid` then validate; extend the guard so INSERT forces `status='new'`, `is_test=false` for anon/authenticated.
- Test: anon insert with a 1 MB message fails; inserted `status='closed'` is stored as `new`.

#### DB-17 - Low - `set_order_payment_method` has no ownership check
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 47cccf8. Test: `lib/db-test/guards-and-grants.test.ts`. Remainder: DB-17b.
- Evidence: `0044:509-513` `where id = p_order and payment_method is null and created_at > now() - interval '1 hour'`, granted to anon (`0044:519`).
- Fix proposed: add `and (profile_id is not distinct from auth.uid())`. Test: another user's call returns false.

#### DB-18 - Low - `refresh_part_sourcing` callable by every authenticated user
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 47cccf8 (caller check, `search_path ''`). Test: `lib/db-test/guards-and-grants.test.ts`.
- Evidence: `0098:186-187` grant to authenticated; body has no caller check; rewrites `parts` price/cost columns and bumps `updated_at` (write amplification, ISR/sitemap churn). Results deterministic: no price manipulation.
- Fix proposed: `if not public.is_super_admin() and coalesce(auth.role(),'') <> 'service_role' and pg_trigger_depth() = 0 then raise exception 'not allowed'; end if;`. Test: client call raises; trigger path still recomputes.

#### DB-19 - Low - `offer_landed_cost_qar` returns supplier cost to any caller
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 47cccf8. Test: `lib/db-test/guards-and-grants.test.ts`.
- Evidence: `0028:136-153`, `grant execute ... to authenticated` (`0028:267`), never revoked from anon; used only by the admin edit page and internal SQL.
- Fix proposed: admin check or revoke.

#### DB-20 - Low - `price_experiment_quote` is an anon oracle for cohort codes
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `0060:173-237` granted to anon; codes match `^[A-Z0-9-]{3,32}$`; `claim_price_cohort` (`0060:240`) grants the cohort.
- Fix proposed: require `auth.uid()` plus per-user attempt throttling, or codes >= 10 random characters.

#### DB-21 - Low - `co_purchased` has no minimum-count threshold
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `0057:84-94`. Fix proposed: `having count(distinct x.order_id) >= 3` (changes what the storefront shows).

#### DB-22 - Low - `class_teacher_of_project`, `is_class_project`, `is_class_teacher_of_project` granted to anon
Status at HEAD: Fixed (migration 0103, NOT RUN). Commits: 47cccf8 (revoke from anon), 6a2f9dd (anon regression, see section 3.5). Test: `lib/db-test/guards-and-grants.test.ts`.
- Evidence: `0096:102-116, 244-245`; leaks the teacher's user id and class membership for any project id. Fix proposed: revoke from anon.

#### DB-25 - Low - Public buckets listable by anon; `product-images` unbounded
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `0029:42-48` (`product-images` anon+auth list, exposes unpublished product images), `0049:33-34`, `0070:111-113`; `product-images` has no size/MIME limit. Public URLs do not need a SELECT policy.
- Fix proposed: drop the anon SELECT policies and set limits on `product-images`, after confirming no client code lists those buckets (unverified).

#### DB-27 - Low (bug) - Class CAD billing inconsistent
Status at HEAD: Open — recommended. No commit.
- Evidence: `cad_begin` checks the student's cad balance when cost='credit' (`0090:79-82`) while `spend_credit` bills the teacher; `cad_deliver` charges the complexity extra to the student (`0090:131-136`). Students with 0 credits cannot start CAD on class projects.
- Fix proposed: use the payer `coalesce(class_teacher_of_project(p_project), v_uid)` in both.

#### DB-28 - Low - Edu-grant regex accepts any `*.edu`, `*.edu.xx`, `*.ac.xx`
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `0074:28-38`; strips only `+tags`; `edu_credit_grant` `0075:12`. With DB-04 it gives QAR 60 of vouchers per alias.
- Fix proposed: domain allowlist in store_settings, or admin review.

#### DB-29 - Low - Every guest session gets 5 welcome ideation tokens
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `0089:396-398` (`idea_token_status`, no `ai_role` check). Partly mitigated by the IP guest limit in `lib/studio/server/product.ts:157` (coverage unverified).

#### DB-30 - Low - Free shipping decided before credit redemption
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `create_part_order` applies the threshold at `0097:253`; `redeem_credits` lowers goods later without recomputing shipping (`0042:563-587`).
- Fix proposed: in `redeem_credits`, cap `v_applied` so goods stay >= threshold when the order had free shipping.

#### API-04 - Low - `/api/design-quote`: unauthenticated service-role signing of any path
Status at HEAD: Fixed (code). Commit: a2c5de4. Test: `lib/design/quote-paths.test.ts`. The upload side is tightened by 0104 (DB-15, NOT RUN).
- Evidence (before): `app/api/design-quote/route.ts:58-61` storage_path any string <= 400; `:63` bucket chosen by caller (`cad` = private `cad-files`); `:104-106` `await svc.storage.from(bucket).createSignedUrl(storagePath, SIGNED_URL_TTL);` (7 days); `:73-76` service-role read of `projects.name` for any id; `node_modules/@supabase/storage-js/dist/index.cjs:1528-1530` path concatenated without encoding, so `../payment-proofs/<uid>/x.png` is normalised by `fetch` to another bucket (normalisation against live Storage unverified).
- Impact: URL goes only to the owner's email and an `inquiries` row (SELECT super_admin-only, `0002:40-42`): confused deputy (owner gets another customer's private file link), project names leaked into leads.
- Fix applied: `lib/design/quote-paths.ts` `isAllowedQuoteStoragePath(bucket, path, userId)`: rejects `..`/`.`/empty segments, `%`, backslashes, leading `/`, control characters, over-long paths; enforces `quote-uploads` = `<uuid>/<name>` and `cad-files` = `<user uuid>/<project uuid>/<uuid>-<name>` with a verified session whose id equals the first segment. Rejected path is dropped (lead still saved and emailed, no signed link). Project name read with the cookie client (RLS); service client used only to sign the validated path. Plus Turnstile and 10 req / 10 min / IP limit (API-03).
- Test: `lib/design/quote-paths.test.ts` (traversal, encoding, backslash, other user's uid, wrong bucket shapes, good paths). No route-level test.

#### API-05 - Low - Cron auth non-constant-time in 4 of 6 routes
Status at HEAD: Fixed (code). Commit: 974fb8d. Test: `lib/auth/cron.test.ts`.
- Evidence (before): `app/api/cron/delivery-promises/route.ts:31`, `supplier-refresh/route.ts:12`, `voltaat-sync/route.ts:12`, `youtube-retire/route.ts:13`: ``if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {`` vs `anonymous-cleanup/route.ts:31-32` and `notifications/route.ts:17-18` using `isAuthorizedCron` (`lib/notifications/links.ts:74-81`, timingSafeEqual). Unset secret: all refused, but 4 answered 401 and 2 answered 500 `cron_secret_unset`.
- Fix applied: all six call `isAuthorizedCron()` (moved to `lib/auth/cron.ts`, re-exported from `lib/notifications/links.ts`); missing header, wrong secret and unset secret all answer 401 `{"error":"unauthorized"}`.
- Test: `lib/auth/cron.test.ts` (new, incl. different-length header); `lib/notifications/links.test.ts` trimmed.

#### API-06 - Low - No Origin/Content-Type check on cookie-authenticated JSON POSTs
Status at HEAD: Open — recommended. No commit.
- Evidence: every mutating route uses `await request.json()` regardless of content type (e.g. `app/api/admin/sourcing-backup/route.ts:226`); only `app/api/auth/claim-guest/route.ts:19-24` checks Origin and content type. `node_modules/@supabase/ssr/dist/main/utils/constants.js:6` `sameSite: "lax"`.
- Scenario: a cross-site `<form enctype="text/plain">` can produce a body `request.json()` parses (`{"step":"clear","x":"="}`); it fails today only because Lax cookies are not sent on cross-site POST. A cookie-option change, same-site subdomain or old browser would expose sourcing-backup `clear` and store-cleanup `placeholders`.
- Fix proposed: `assertSameOriginJson(request)` reusing `sameOrigin()` from `lib/auth/claim-guest.ts:88-96` + require `application/json` on every mutating route.
- Test: `Origin: https://evil.example` -> 403; `text/plain` -> 415.

#### API-07 - Low - site_v2 preview gate is a constant, forgeable cookie
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `lib/site-v2.ts:22-23` `SITE_V2_PREVIEW_COOKIE = "site_v2"` / `SITE_V2_PREVIEW_COOKIE_VALUE = "1"`; `middleware.ts:95` compares only the value; the route comment "The cookie is only ever set here" is false for visitors. Cookie set by `app/api/admin/site-v2-preview/route.ts:34` (7 d, httpOnly, prod-secure). Web review: v2 serves public marketing content only (whether v2 exposes anything sensitive is unverified).
- Fix proposed: HMAC-signed value (reuse `signState` pattern) or a super_admin check in the v2 layout when the flag is off.

#### API-08 - Low - Outbound fetch hardening (SSRF / memory)
Status at HEAD: Fixed (code). Commit: 3d06ce9. Test: `lib/net/safe-fetch.test.ts`.
- Evidence: `lib/store/store-image.ts:47-50` allow-list on first URL only, redirects followed, body buffered before the 25 MB check; `app/[locale]/dashboard/store/actions.ts:285-303` allow-list `*.google.com`/`*.googleusercontent.com` with `redirect: "follow"` and `(await res.text()).slice(0, 2_000_000)` (cap after full read); `app/api/admin/drive-import/route.ts:48-49` buffer then check, x8 parallel (~200 MB peak).
- Impact: super_admin-only or supplier-provided URLs; a redirect from an allowed host can make the server fetch other hosts.
- Fix applied (3d06ce9): new `lib/net/safe-fetch.ts` `fetchWithinAllowList(url, {allowHost, maxBytes, maxRedirects, timeoutMs, fetchImpl})` follows redirects by hand (`redirect: "manual"`), re-validates each hop (https + allow-list, max 3 hops), refuses an over-cap `content-length` and stream-reads with a byte cap (`readCapped`). Used by `importPartsFromSheet` (same Google host list every hop, 2 MB cap streamed, 12 s timeout; a sheet over 2 MB now fails with `fetch_failed` instead of being truncated mid-row), `fetchImage` (15 MB), `drive-import` (fixed Drive host, 25 MB cap).
- Test: `lib/net/safe-fetch.test.ts` (allowed chain, redirect to foreign / non-https host, too many hops, declared and streamed over-cap bodies, non-2xx, `accept()` refusal, network error); `lib/store/store-image.test.ts`.

#### API-09 - Low - Schools invoice: server-side HTTP hop to a Host-derived origin forwarding cookies
Status at HEAD: Fixed (code). Commit: 405ca7e (the invoice action calls `createLead` in-process; no HTTP hop, no forwarded cookies, no Host-derived origin). Tests: `lib/leads/save.test.ts`, `lib/leads/parse.test.ts`.
- Evidence: `app/[locale]/schools/classes/actions.ts:200-201` `const host = head.get("x-forwarded-host") ?? head.get("host");` and `:222` `...(head.get("cookie") ? { cookie: head.get("cookie") as string } : {}),` in ``fetch(`${origin}/api/store-lead`)``.
- Scenario: if the platform passes a client-supplied `X-Forwarded-Host`, the server POSTs the teacher's session cookies to any host (SSRF + token exfiltration; self-inflicted unless a proxy injects the header). Vercel is believed to overwrite it - unverified.
- Fix proposed: call a shared lead-creation function directly (also saves an invocation), or use constant `SITE_URL`.

#### API-10 - Low - Order rating: GET records a score; tokens never expire; secret falls back to CRON_SECRET
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `app/api/orders/rate/route.ts:53-75` writes on GET (HEAD safe; link scanners issue GETs); `lib/orders/rating.ts:18-20` `return env.ORDER_RATING_SECRET || env.CRON_SECRET || null;`; token has no timestamp.
- Fix proposed: GET renders a confirm button that POSTs (as unsubscribe does); require a dedicated `ORDER_RATING_SECRET`; optionally date the token.

#### API-11 - Low/Info - `auth/callback` used a weaker `next` sanitiser
Status at HEAD: Fixed (code). Commit: 48626b6. Test: `lib/auth/next-path.test.ts`. The verifyOtp login-CSRF note (Info) is not addressed.
- Evidence (before): `app/api/auth/callback/route.ts:27-31` accepted any same-origin path (`/api/...`, `/en/sign-in`, non-locale paths); `lib/auth/next-path.ts:31-55` not used. Redirect always `${origin}${next}` (`:153`): no open redirect. `:125-126` `verifyOtp({ type, token_hash })` with `type` cast from the query: crafted email link signs the visitor into the attacker's account (standard Supabase login-CSRF).
- Fix applied: `callbackNextPath()` in `lib/auth/next-path.ts` (locale required, no `//host`, backslash, control characters, auth pages excluded; falls back to `/`); lets exactly `/{locale}/reset-password` through so password recovery keeps working.
- Test: callbackNextPath cases in `lib/auth/next-path.test.ts` (`/api/x`, `//evil`, `https://evil`, `/en/sign-in` rejected; `/en/projects/abc` kept; reset-password exception).

#### API-12 - Low - Store writes without `revalidateStorefront()`
Status at HEAD: Fixed (code). Commit: 7f6a4d6. No test named in the commit.
- Evidence (before): `app/[locale]/dashboard/store/restock/actions.ts:39-49` `markReceived` -> `mark_restock_received` (`0069:113` updates `own_stock` -> `parts.in_own_stock`, shown at `app/[locale]/store/[sku]/page.tsx:139,244`); also `restock/actions.ts:20-22` (store_settings `restock_weights`), `:32` (`suppliers.min_order_value_qar`) and `engineering-jobs/actions.ts:89-91` (`engineer_services`, read uncached only, no storefront impact; not changed).
- Impact: the "in our own stock" badge stale up to 24 h after a receipt.
- Fix applied: `revalidateStorefront()` after `markReceived`, `restock_weights` and `min_order_value_qar` writes. No test.

#### AI-07 - Low - CAD credit cost (tier) derived from user-controlled input
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `app/api/cad/route.ts:89` `classifyCadRequest(asked)` (tier from request text); `app/api/studio/enclosure/route.ts:66` and `product/unlock/route.ts:62` `studioCadTier(components.length)` (client doc). `cad_tier_cost` maps simple/standard/complex to 1/2/3 (`0090:20-23`).
- Impact: a complex request phrased as "simple" pays 1 credit instead of 3 (revenue leak). Fix: accept, or derive tier from produced geometry (worker bbox/part count) before `cad_deliver` takes the extra credits.

#### AI-08 - Low - Guest design limit non-atomic and fails open; signed-in users uncapped
Status at HEAD: Open — recommended. No commit.
- Evidence: `lib/studio/server/product.ts:151-168` `guestDesignLimit` does `hits` then `bump` (read-then-write) and returns `allowed:true` on any store error or missing service key; `app/api/studio/product/design/route.ts:42-45` applies it only `if (isAnonymous)`.
- Fix proposed: atomic increment (`bom_rate_check` upsert pattern) and a per-user cap, or rely on token balance once AI-06 is fixed. Test: concurrency test on `guestDesignLimit`.

#### AI-10 - Low - Several AI routes read the body without zod
Status at HEAD: Partially fixed — see note. Commits: ab7d08c (`/api/brief-chat`, `BriefChatBody`), 24d4df1 (`/api/project-cad`, `/api/bom/match`; `lib/projects/route-bodies.ts`). Test: `lib/projects/route-bodies.test.ts`. Open: the request bodies of `/api/netlist` and `/api/bom/electronics` (their zod use covers only the model's answer).
- Evidence: `/api/brief-chat` (cast only), `/api/netlist` (`projectId` any string), `/api/bom/electronics`, `/api/bom/match`, `/api/project-cad` (manual `String().slice`). Lengths sliced, shapes trusted; downstream `.eq()` and RLS contain it.
- Fix proposed: zod schema per body as the studio routes do (`studioRequest`).

#### AI-11 - Low - `/api/project-cad` has no rate limit and emails the owner on every call
Status at HEAD: Fixed (code). Commit: 24d4df1 (5 notifications per user per 10 min, 429 `rate_limited` with `Retry-After`; per instance, in memory). Test: `lib/projects/route-bodies.test.ts` covers the body schema only; the limiter has no test.
- Evidence: `app/api/project-cad/route.ts:22-142`; no `bomRate`/quota; `sendEmail` to `OWNER_EMAIL` per request after owner/path checks (one `inquiries` row + one email per call).
- Fix proposed: per-project debounce or small per-user limit.

#### WEB-04 - Low - Supabase auth cookies JS-readable and lack `Secure`
Status at HEAD: Partially fixed — see note. Commit: f9c82e1 (`supabaseCookieOptions()`: `secure` in production, identical on the browser, server and middleware clients). Test: `lib/supabase/cookie-options.test.ts`. Open: `httpOnly` stays off because the browser client reads the session from `document.cookie` (owner decision for a server-only session).
- Evidence: no `cookieOptions` in `lib/supabase/client.ts:6-9`, `server.ts:11-28`, `middleware.ts:29-40`; defaults `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11`: `path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60`. Guests hold the same cookie; `.0/.1` chunks and `-code-verifier` (PKCE) likewise.
- Impact: any XSS = session theft for 400 days (see WEB-01); cookie could go over plain HTTP on a first non-HSTS request. `httpOnly:false` is inherent to `createBrowserClient`.
- Fix applied (f9c82e1): `supabaseCookieOptions()` passed to all three clients. Original proposal: `cookieOptions: { secure: process.env.NODE_ENV === "production" }` identically in all three clients (else chunk names/attributes diverge); keep Lax; explicit HSTS (WEB-03). Long term a server-only session would allow HttpOnly.
- Test: unit test on a shared `supabaseCookieOptions()` helper; Playwright on the prod build: `sb-*` cookies `secure: true`.

#### WEB-07 - Low - OpenSCAD engine loaded from public CDNs without integrity check
Status at HEAD: Open — needs owner decision. No commit.
- Evidence: `lib/cad/render.ts:13-15` jsDelivr/unpkg `openscad-wasm-prebuilt@1.2.0`; `lib/cad/render.worker.ts:32` `await import(/* webpackIgnore: true */ url)`.
- Impact: a compromised CDN response runs as a same-origin worker (credentialed same-origin requests as the user); version pinned, which limits but does not remove the risk.
- Fix proposed: self-host both files under `public/` (zero cost), or fetch, verify SHA-384, then `import(URL.createObjectURL(blob))`.

#### WEB-08 - Low - `/dashboard/contact` reachable by any signed-in client/workshop
Status at HEAD: Fixed (code). Commit: 1619d56. Test: `lib/auth/guards.test.ts`, `lib/auth/admin-pages-guard.test.ts`.
- Evidence (before): `app/[locale]/dashboard/contact/page.tsx` had no role check or role layout; only `dashboard/layout.tsx:33-41`. UI only (public phone + editor); save gated at `contact/actions.ts:15-16` `if (s?.profile.role !== "super_admin") throw new Error("forbidden");`.
- Fix applied: `requireSuperAdmin` on the page (1619d56). Test: `lib/auth/guards.test.ts`.

### 3.4 Info

| ID | Evidence | Note | Status |
|---|---|---|---|
| DB-23 | `profiles_guard_privileges` (`0009:21`), `profiles_guard_email` (`0042:64`), `profiles_guard_price_cohort` (`0060:140`), `projects_guard_credit_columns` (`0042:129`), `projects_insert_defaults` (`0042:152`), `projects_guard_recovery_columns` (`0045:102`) | "`auth.uid() is null` => trusted" is safe only while anon has no write policy on `profiles`/`projects`. Prefer `current_user not in ('anon','authenticated')` as `0073:103` does. | Info |
| DB-24 | `offer_landed_cost_qar`, `refresh_part_sourcing`, `refresh_all_part_sourcing`, `supplier_offers_refresh_trg`, `parts_sourcing_trg`, `suppliers_refresh_trg`, `suppliers_rank_refresh` pinned `public` (0028/0095/0098); `cleanup_anonymous_users` `public, auth, pg_temp` (`0055:109`) | Safe while untrusted roles cannot CREATE in `public`. Re-pin to `''` with qualified names when next touched. After 0093 no function is unpinned. | Info |
| DB-31 | `analysis_runs_insert` (`0024:56-58`), lookup `app/api/analyse/route.ts:91-101` | Owner can pre-seed the reuse cache; self-only effect (same as AI-13). | Info |
| API-13 | `quick/actions.ts:60` `rows.map((r) => r.category.trim())`; `attributes/actions.ts:41-50` `ids` unbounded, `patch.field` any key; `suppliers/import/actions.ts:168-175` `offers` unchecked | Admin actions trust TS types at runtime; super_admin only, so 500s / odd data, not escalation. Fix: zod at the action boundary. | Info |
| API-14 | `drive-import/route.ts:63,73`, `starter-parts/route.ts:116`, `restock/actions.ts:23,33,47`, `voltaat/actions.ts`, `attributes/actions.ts:49`; cron `anonymous-cleanup/route.ts:60`, `notifications/route.ts:25` return `detail` | Raw error text returned on admin/cron paths only; public routes map errors to codes. | Info |
| API-15 | `lib/integrations/crypto.ts:36-107`, `lib/orders/rating.ts:23-33`, `unsubscribe/route.ts:88-102`, `lib/billing/server.ts:69`, `0091:185`, `lib/turnstile-server.ts:52-60` | Checked sound: YouTube OAuth state (HMAC, timingSafeEqual, 10-min TTL, httpOnly/lax path-scoped cookie), token sealing AES-256-GCM (no AAD, Info), rating/review HMAC 192-bit bound to order id, unsubscribe GET non-mutating with escaped output, recovery key in URL fragment rotated on claim, proof/return path checks, server-side Turnstile, no PII/tokens logged. Mouser key in the query string is a vendor requirement. | Info |
| AI-12 | `lib/studio/server/context.ts:5-8`, `lib/ai/usage.ts:17-19` | Feature `"studio"` rejected by the `ai_usage`/`analysis_runs` CHECK until 0068 runs; `logUsage` only warns, so studio calls are unmetered before the migrations. Matches the documented migration-gating pattern. | Info |
| AI-13 | `0024_project_diagnostics.sql:56-58`, `app/api/analyse` `:103` re-parses via `AnalysisSchema` | Client-insertable `analysis_runs`; worst case a self-served free analysis. Matters only if a paid feature ever reuses this table. | Info |
| AI-14 | `app/api/transcribe/route.ts:19` sets only `dynamic` | No `maxDuration` and no server upstream timeout (fetch uses `request.signal` only); 4 MB audio cap bounds the payload. Addressed in ab7d08c (`maxDuration = 60`, 45 s `AbortSignal.timeout` on the Groq call). | Info |
| AI-15 | `SchematicFrame.tsx:454`, `schematics-stage.tsx:320`, `svg-frame.tsx:111` | SVG is produced by `lib/studio/schematic.ts` / `lib/prototyping/schematic.ts` with `esc()`; the model produces JSON, not SVG. Safe unless the drawing library is changed to pass user HTML (but see WEB-01 for the DB read-back path at `schematics-stage.tsx:320`). | Info |
| AI-16 | `gemini-client.ts:42`, `transcribe/route.ts:36`, `dashboard/usage/page.tsx:175-176`, `lib/admin/project-export.ts:48-66`, `cloud.ts:121-131` | Provider keys server-only, `NEXT_PUBLIC_*` all non-secret, exports redact key-shaped strings, errors carry status/code only. | Info |
| WEB-09 | `.next/server/app` (60 `.html`, none under dashboard/projects/inventory/orders/tokens/my-inventory/e2e-fixtures), `.next/prerender-manifest.json` (68 routes), `dashboard/page.tsx:12`, `payments/page.tsx:14`, `leads/page.tsx:25` `force-dynamic` | The "prerendered dashboard" marker comes from `generateStaticParams` on `app/[locale]/layout.tsx:76`; no admin data in static HTML (build ran without Supabase env; conclusion rests on `force-dynamic`). | Info |
| WEB-10 | `middleware.ts:132` matcher skips dotted paths; `dashboard/layout.tsx:40` `redirect(`/${locale}/sign-in`)`; `[locale]/layout.tsx:87-89` `notFound()` | `/%2F%2Fevil.com/dashboard` could yield `///evil.com/sign-in` if the dashboard layout ran before the parent `notFound()`; likely not exploitable (unverified). Check: `curl -sI 'http://localhost:3000/%2F%2Fevil.com/dashboard'` on `next start` expects 404. Cheap hardening: validate `locale` against `routing.locales` where redirects are built. | Info (unverified) |
| WEB-11 | `lib/legal/markdown.ts:18` `const SAFE_HREF = /^(https?:\/\/\|mailto:\|tel:\|\/)/i;` | `[x](//evil.example)` passes; owner-authored content only. Fix `/^(https?:\/\/|mailto:|tel:|\/(?!\/))/i` in the parser (never hand-edit `content/legal/**`). Test: `parseInline("[a](//x.y)")` -> text node. | Info |
| WEB-12 | `lib/turnstile.ts:107-109` | Accepts `success === true` without checking `data.hostname`; low risk (per-site keys). Optional: compare with the site host. | Info |
| WEB-13 | `api/store-lead/route.ts:208-333`, `projects/recovery-email/route.ts:40`, `projects/claim/route.ts:38`, `schools/classes/actions.ts:240`, `youtube/callback/route.ts:95`, `transcribe/route.ts:94` | No secrets/PII logged deliberately; raw PostgREST error objects (can echo row values on constraint errors) and first 300 chars of a Groq error body. Log `code`/`message` only. | Info |

### 3.5 Added by the post-fix reviews

Found by two independent read-only reviews of the fixes (High fixes; migrations 0100/0102/0103/0105 with the DB-01/DB-02 gap fixes). Every row is in the section 1 table. "Open" remainders have no commit.

#### G-C1 - High - `cad_set_code` was session-callable: CAD credits became vouchers with no model call
Status at HEAD: Fixed (code + migration 0102, NOT RUN). Commit: 189c26e (on top of 2067917). Tests: `lib/credits/db/credits-server-spend.test.ts` (hole shown before; `permission denied` as a session after; `not_ready` from `cad_deliver` without stored code; exactly one spend row via `cad_begin` + `cad_set_code_for` + `cad_deliver`), `lib/credits/credits.test.ts`.
- Evidence (review): `cad_begin`, `cad_set_code` (`0043:134`) and `cad_deliver` (`0090:97,153`) were all granted to authenticated; a session stored any text as code, then `cad_deliver` called `spend_credit('cad')`, which wrote a `spend:<project>` row that `redeem_credits` turns into QAR 20 off. This is DB-04 through the CAD path, left open by 2067917.
- Fix applied: 0102 adds `cad_set_code_for(p_user, p_id, p_scad, p_model)` (service_role only; the generation must be `p_user`'s, or `p_user` is super_admin) and revokes `cad_set_code` from public / anon / authenticated, then `notify pgrst`. `setCadCode()` in `lib/credits/server.ts` writes through the service client with the route's verified id (falls back to `cad_set_code` on PGRST202, before 0102 runs). `/api/cad` (browser and cloud paths), `/api/studio/enclosure` and `/api/studio/product/unlock` answer 503 before `cad_begin` and the model call when the service key is missing.

#### G1.1 - Medium - `studio = null` or a non-object reset `product.regens`
Status at HEAD: Fixed (migration 0100, NOT RUN). Commit: 2141a19. Test: `lib/studio/db/studio-private.test.ts` (null, `[]`, `{}` PATCH keeps `product`). The guard trigger returned early on a non-object value, so `PATCH studio=null` then `{}` dropped the stored product and `regens` restarted at 0 (free regenerations, the AI-06 leak). It now coerces to `{}` and restores `product`.

#### G1.2 - Medium - Private models readable through `engineering_jobs.snapshot`
Status at HEAD: Fixed (code). Commit: 05ce7c1. Test: `lib/engineering/snapshot.test.ts` (stored snapshot has no `productPrivate`; admin download has it; non-admin 403). 391f854 wrote the models into the snapshot, which the job's owner can SELECT (0091), so an owner could submit a step job, read every model and cancel for a refund. `submitStepJob` now strips `productPrivate`; the admin download adds the models from `project_studio_private` with the service client at read time (the models as they are at download time).

#### G1.2 data clean-up - Medium - Existing job snapshots already hold every model
Status at HEAD: Fixed (migration 0100, NOT RUN). Commit: 0090118. Test: `lib/studio/db/studio-private.test.ts` (BEFORE: owner reads the models from an old snapshot; after 0100 applied twice the key is gone, the rest of the snapshot and `updated_at` unchanged, clean and array snapshots untouched). On origin/main `submitStepJob` stored `project.studio` verbatim, so every job submitted before this branch carries a copy. 0100 strips `studio.productPrivate` from those snapshots (idempotent). The strip is not reversed by the rollback. Note: any copy already exfiltrated cannot be recalled.

#### G1.3 - Medium (reviewer: Low-Medium) - Class teacher could write a student's product designs
Status at HEAD: Fixed (code + migration 0100, NOT RUN). Commit: 2141a19. Tests: `lib/studio/db/studio-private.test.ts` (`not_owner`), `lib/studio/server/product-routes.test.ts` (a teacher with read visibility gets 404 on design / choose / unlock, nothing charged or written; admin still writes). Regression from 391f854: the write moved to the service client, which bypasses `projects_update`, while `projects_select_class_teacher` lets a teacher see the project. Now owner or super_admin only (see AI-01 section for the three layers). Teachers keep read access.

#### G1.4 - Low - Pre-0100 fallback matched any "does not exist"
Status at HEAD: Fixed (code + migration 0100, NOT RUN). Commit: 2141a19. Test: `lib/studio/server/product-routes.test.ts` (pre-0100 fallback and 503 cases). `isMissing0100` now needs 42P01 / PGRST205 naming `project_studio_private`, or 42883 / PGRST202 naming `studio_product_save`; 0100 ends with `notify pgrst, 'reload schema'`.

#### G2.1 - Low - DB-02: second Auth round trip; failed lookup dropped usage rows
Status at HEAD: Fixed (code). Commit: 4fb95e5. Test: `lib/ai/usage.test.ts`. `logUsage` / `validatedCall` / `studioCall` / `logCloudFallback` take the user id the route already verified; the fallback lookup caches only a found id.

#### DB-22 regression - Medium (reviewer: Medium/Low) - anon `select` on `projects` raised a permission error
Status at HEAD: Fixed (migration 0103, NOT RUN). Commit: 6a2f9dd. Test: `lib/db-test/guards-and-grants.test.ts` (anon select returns `[]`; teacher still reads the team project; with the policy back on PUBLIC the anon read fails). The 0096 policy `projects_select_class_teacher` has no `TO` clause, so after 0103 revoked `is_class_teacher_of_project` from anon, every anon SELECT on `projects` raised. Store-lead and design-quote name lookups with no session hit it (logged, name stayed null). 0103 now runs `alter policy ... to authenticated` and ends with `notify pgrst`.

#### Left open by the reviews

| ID | Note | Status |
|---|---|---|
| DB-06b | Per-team / per-day credit cap (`class_teams.credit_cap`, `team_cap`), teacher approval, join throttle. Reviewer G-C4 (Info). | Open — recommended |
| DB-07b | Pass-paid job refund can exceed the pass cap that `payment_apply_internal` enforces; cap or sweep. | Open — recommended |
| DB-08b | Guest's idea spend rows move while its welcome row is deleted: balance below 0 possible. Net the spend against the dropped grant. | Open — recommended |
| DB-10b | Per-`auth.uid()` hourly cap; email has no plus-tag folding; victim phone / email lockout by 10 spoofed orders; no lock, so concurrent inserts can pass 10; direct DB sessions (`auth.role()` null) are not exempt; cart does not clamp quantity at 1000. | Open — recommended |
| DB-10c | 100 lines per order also limits a teacher's class order (teams x parts). Raise or exempt class orders (5.23). | Open — needs owner decision |
| DB-17b | `auth.uid() is not null and profile_id = auth.uid()` would be safe if no sessionless order path exists (checkout always has a session; unverified for other callers). | Open — recommended |
| API-02b | `create index ... on projects (contact_email) where recovery_emailed_at is not null`; also fold plus-addressing. | Open — recommended |

Review items closed without a new row: G-C2 (free wiring without the service key, d33b23d, see AI-05), G-C3 (`notify pgrst` added to 0102 in 189c26e and to 0103 in 6a2f9dd), G3.1 (Arabic-Indic digits in receipts, 00400b9), G5.1 (every-page guard test, fd943f9), WEB-01 render test (59eb979), 0105 hardening (ce9c2da), DB-10 checkout messages (ae11361, 781a510), DB-13 recovery mail for class projects (ae11361), snapshot test drift (520cbb4). Not acted on: G1.5 / G2.2 (Info), the `Info` DB-08 / DB-07 edges beyond DB-07b / DB-08b.

## 4. Re-check of earlier reviews

Merged verdicts of the four reviewers.

| Item (SECURITY_REVIEW.md unless noted) | Verdict | Evidence / pointer |
|---|---|---|
| C1 self-promotion to super_admin | Fixed, still in place | `0009:21-51` trigger `profiles_guard_privileges` never dropped; `profiles_update` unchanged since `0001:158-168`; later guards add email (`0042:64`) and price_cohort (`0060:140`). Residual pattern: DB-23. FINDINGS #5 records 0001-0012 as applied (2026-09-18), so 0009 is among them; direct production proof was not possible here. |
| H1 `startJob` double deduction | Obsolete, code removed | `app/[locale]/dashboard/jobs/` does not exist; no `startJob`/`deduct` in app/lib/components; `next.config.mjs` comment "The jobs pipeline was retired". |
| H2 clients write workshop BOM | N/A, object removed | `job_bom` dropped `0013:57`; `can_manage_job_bom` dropped `0013:69`. |
| H3 job edit window | N/A, object removed | `jobs` dropped `0013:60`; `jobs_status_transition` dropped `0013:73`. |
| H4 open redirect via `locale` form field | Fixed | `app/[locale]/inventory/actions.ts:15-17` `safeLocale()` pins en/ar; same pattern in store/actions.ts, store/orders/actions.ts, leads/reviews/credits/payments/engineering actions; `returnTo` via `lib/admin/return-to.ts:33-35`. Actions taking a raw `locale` use it only in `revalidatePath`. Residual dotted-path edge case: WEB-10 (unverified, likely safe). |
| H5 tenant re-type to workshop | Fixed, still in place; model dormant | `tenants_guard_type` `0009:61-81`, no later change. |
| M1 forged variation trail | N/A, object removed | `job_variations` dropped `0013:56`. |
| M2 non-atomic inventory deduction | Obsolete, code removed | Stock writes now go through SQL RPCs (`set_own_stock`, `mark_restock_received`, `0069`). |
| M3 unbounded public `inquiries` insert | Fixed in migration 0103 (NOT RUN); open until it runs | `0002:29-36` `with check (true)` for anon, no length constraints; anon can also set `status`/`is_test`. See DB-16, and API-03 for the endpoints that write to it. |
| M4 dependency advisories | Cited advisories addressed by upgrades; current state not re-verified offline | Installed next 15.5.25, next-intl 4.14.5 (the 8A next-intl 3.x advisories need 4.x). `npm audit` not run (no network). BASELINE (commit 3491047): `npm audit --omit=dev` 8 high / 3 moderate; after 41bc697 (sharp 0.35.5) 7 high / 3 moderate (per that commit's message). Remaining items per `sec-web-layer.md` section 8: next 15.5.28 and the postcss / tailwind build-tooling chain (only sharp was runtime-reachable; ISR advisories apply to self-hosted Next, unverified on Vercel). Update 2026-10-22: see section 6, item 10 (next 15.5.25 is now listed under a critical advisory set; fix is 15.5.28). |
| M5 no security headers | Fixed in code (38d62b7); CSP is report-only | WEB-03. `next.config.mjs` now sends the headers on `/:path*`; whether Vercel also sends HSTS is not re-verified (`curl -sI https://gestaltung360.com`). |
| SECURITY_REVIEW Info section | Stale in two claims | (1) "the service-role key is not used anywhere in app code" - false: baseline counts 76 references to the service-role client (`lib/supabase/service.ts` and users). (2) "every /dashboard/* page ... calls getSessionContext()" - ~35 dashboard pages relied on a layout only; closed by 1619d56 (WEB-02). The advice to delete `SUPABASE_SERVICE_ROLE_KEY` from Vercel is therefore obsolete (service-role users per `sec-web-layer.md` section 5 include `lib/credits/server.ts`, `lib/admin/project-export.ts`, `lib/integrations/youtube-server.ts`, crons and billing). |
| FINDINGS #8 CAPTCHA breaks all auth endpoints | Code side fixed; production setting unverified | `captchaToken` now passed by sign-in (`components/auth/sign-in-form.tsx:83`), sign-up (`sign-up-form.tsx:109`), forgot-password (`forgot-password-form.tsx:53`) and guest creation (`lib/supabase/guest.ts:37-45`, used by quote-request, new-project-form/chat, join-form). Whether Supabase Auth -> Attack Protection -> CAPTCHA is ON is invisible to the repo; store-lead's session bypass (API-03) is now closed in code (1d9a88c), so the dependency left is the sign-in / sign-up / guest forms. |
| `docs/cad-champions/SECURITY_REVIEW.md` | Does not exist in this repo | `ls docs/cad-champions` fails; the only `SECURITY_REVIEW*.md` is `docs/audit-history/SECURITY_REVIEW.md` (the root file until slice R13). Any reference to it is dangling. |

## 5. Needs owner decision

Each of these changes customer/admin behaviour or is a business rule. Recommendation is the auditors' pick, not a decision.

1. API-01 option (a) - never auto-approve `kind='service'` payments: Recommend yes; an approval opens a paid human engineering job. Cost: service payers wait for manual review.
2. API-01 option (c) - cap auto-approvals (per user per period, per amount): Recommend <= 1 auto-approved payment per user per 30 days and a QAR ceiling you choose, with auto-approved rows in a spot-check queue before tokens are spendable. Option (d), bank-statement reconciliation, is the durable fix. (Option (b), the GT code check, is live but does not stop a forged screenshot that carries the payer's own code; options (a) and (c) plus item 22 are the real controls.)
3. AI-02 - Studio model exposed before unlock: Recommend dropping `model` from `/product/check` now (no preview need found) and shipping a reduced preview mesh from `/product/design`; accept-as-public only if the product wants "price the export, not the geometry".
4. AI-07 - CAD tier from user text / part count: Recommend accept for now; revisit by deriving tier from produced geometry before `cad_deliver`.
5. DB-03 - browser CAD path returns SCAD before payment: Recommend blocking new generations while one is undelivered plus `cad_settle_stale()`; full "charge at code-store" changes refund UX.
6. DB-04 (beyond server-side spend) - purchase reward of 3+1 credits per delivered order of any value, edu 2+1, and QAR 20 redeemable vouchers: Recommend a minimum goods value for the purchase reward and deciding whether free credits should be voucher-redeemable at all.
7. DB-05 - who is a "teacher": Recommend admin verification (`verified_at`) before free class delivery and the project-cap exemption.
8. DB-14 - kit discount: First read the live `kit_discount_pct` (seed 0). If 0 keep as Low; if > 0 move kit creation server-side.
9. DB-20 - cohort-code oracle: Recommend longer random codes (>= 10 chars) or per-user throttle; existing short codes in circulation would need re-issuing.
10. DB-21 - `co_purchased` threshold: Recommend `>= 3` distinct orders; hides low-volume "bought together" rows on the storefront.
11. DB-25 - listable public buckets: Recommend dropping anon SELECT on `product-images`/`videos`/`studio-models` after grepping that no client lists them; set size/MIME limits on `product-images`.
12. DB-28 - edu-grant domains: Recommend a store_settings domain allowlist (or admin review) instead of regex on any `*.edu`/`*.ac.xx`.
13. DB-29 - 5 welcome tokens per guest session: Recommend granting on confirmed accounts only, or keep and rely on the IP guest limit once its coverage is verified.
14. DB-30 - free shipping before credit redemption: Recommend cap `v_applied` so goods stay >= threshold; changes the effective discount on borderline orders.
15. WEB-07 - OpenSCAD from CDNs: Recommend self-hosting under `public/` (no cost); changes bundle/deploy size.
16. API-10 - rating links: Recommend GET -> confirm-button POST, dedicated `ORDER_RATING_SECRET`, optional token date; existing emailed links change behaviour (and rotating the secret invalidates old links).
17. API-07 - `site_v2` cookie: Recommend signing the value (or admin-only layout check). Low priority if /v2 is public marketing only.
18. FINDINGS #8 dashboard CAPTCHA state: Confirm in Supabase Dashboard -> Authentication -> Attack Protection whether CAPTCHA is on. If off, anonymous sign-in has no CAPTCHA and the guest-session gates (brief-chat, transcribe, store-lead, design-quote, demand) rely on Turnstile alone, which is itself off until the `store_settings` switch is on; if on, document the dependency in code. (The store-lead "any session" bypass is closed in code, 1d9a88c.)
19. Supabase default function privileges (unverified assumption): Run `select has_function_privilege('anon','public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer,text,numeric)','execute');` in the SQL editor. If true, every SD function with only `revoke ... from public` is anon-callable and the DB-02/11/18/19/22 fixes should explicitly revoke from `anon, authenticated`, as the proposals do.
20. WIF provider attribute conditions: In Google Cloud confirm the provider accepts only Vercel-issued tokens for this project (issuer, audience, project/environment attributes). AI-04 removed the client header path, but a permissive provider is still a standing risk.
21. Cloud Run deployment hardening for the CAD worker: Confirm `--no-allow-unauthenticated`, `CAD_WORKER_TOKEN` set, zero-role service account, gVisor sandbox (`docs/CAD_CLOUD.md:79` shows the intended flags). Recommend this be treated as the real security boundary and README wording updated (AI-03).
22. API-01 unique transfer reference: Recommend a unique index on `lower(transfer_ref)` for approved / verifying / needs_review rows (DB-26). Cost: a legitimately repeated reference goes to manual review. With 5.1 and 5.2 this is what makes auto-approval safe.
23. DB-10c - 100-line order limit and class orders: Recommend exempting class orders (teams x parts can pass 100) or raising the cap for verified classes; as shipped, such an order fails with `errorLineCap`.
24. DB-15 / DB-25 - `quote-uploads` size and MIME limits: 0104 fixes only the path shape. Recommend 25 MB and an allowlist (stl, octet-stream, step, dxf, pdf, png, jpeg); changes what customers may attach.
25. WEB-04 - server-only session (HttpOnly): `Secure` is done; HttpOnly needs the browser client to stop reading `document.cookie`. Recommend leaving as is while WEB-01-class sinks stay closed and the CSP is enforced.
26. WEB-03 - enforce the CSP: after one release of reports with no violations from Studio, Drive Picker, Turnstile and GA, rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `lib/security/headers.mjs`.

## 6. Unverified assumptions

1. Supabase default privileges grant EXECUTE on new public functions to `anon, authenticated` (so `revoke ... from public` alone does not remove it); the repo relies on this at `0071:294` and the PGlite helper `lib/db-test/pglite.ts` mirrors it. Not checked against production.
2. Which migrations are applied in production beyond FINDINGS #5's 0001-0012 sweep (2026-09-18). All proposed DB fixes assume nothing new is applied until the owner runs it.
3. Supabase Auth CAPTCHA state (FINDINGS #8) and the anonymous sign-in rate limit.
4. Live `kit_discount_pct` and other admin-edited `store_settings` values.
5. `@supabase/storage-js` path normalisation (`../`) against live Storage (API-04); mitigated by the new path validator regardless.
6. Vercel overwrites a client-supplied `x-forwarded-host` (API-09) and `x-vercel-oidc-token` (now moot after AI-04's fix).
7. WEB-02's end-to-end behaviour was derived from `walk-tree-with-flight-router-state.js` source, not from a running server; the fix is covered by a unit test that the page redirects before using the service client.
8. WEB-10 dotted-path locale redirect (likely not exploitable).
9. cad-worker production flags, `CAD_WORKER_TOKEN`, SA roles, and WIF provider conditions (sections 5.20-5.21); the gVisor claim is from docs.
10. `npm audit` (no network here). As of 2026-10-22 `npm audit --omit=dev` lists next 15.5.25 under a critical advisory set: GHSA-2464-fhr4-w9xw (image-optimizer SVG RCE), cache poisoning (GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p; applicability to Vercel hosting unverified) and a server-action DoS. The fix is the in-range patch 15.5.28 (package.json says `^15.2.3`), being applied in the verification step, so it is not in the commits counted here. What the orchestrator checked: the app does not configure `remotePatterns` or `dangerouslyAllowSVG` (no `images` block in `next.config.mjs`), which narrows the image-optimizer path but is not a proof of non-exposure. Also unverified: whether 15.5.28 bundles a fixed postcss (7 high / 3 moderate remained after sharp 0.35.5, per 41bc697).
11. `NEXT_PUBLIC_GOOGLE_API_KEY` is HTTP-referrer and API restricted in GCP; HSTS actually served by Vercel; `vercel.live` needs for preview CSP; Google Picker `content.googleapis.com` frame origin.
12. Vercel body-size cap (~4.5 MB) and default `maxDuration` for routes without one.
13. Coverage of the IP guest limit at `lib/studio/server/product.ts:157` (DB-29); that nothing client-side lists the public buckets (DB-25).
14. Whether `/v2` exposes anything sensitive (API-07) and whether `inventory/actions.ts` relies on RLS alone for authorisation (legacy table, FINDINGS 3-4).
15. NEXT_LOCALE cookie max-age at runtime (next-intl 4 default, not observed).
16. The bundle scan in `sec-web-layer.md` section 5 used a build with no env, so it proves no hard-coded secrets, not what a Vercel build inlines (only `NEXT_PUBLIC_*` can be).
17. Admin `insert(...).select("id, sku")` on `parts` after 0105: works only if PostgREST generates RETURNING for the selected columns, not `parts.*`. Confirm once on staging.
18. Whether any over-long legacy `inquiries` rows exist (0103's CHECK is NOT VALID; count them, then validate) and whether any sessionless caller of `create_part_order` exists (DB-17b).
19. Whether the live database has a SELECT grant to PUBLIC or an inherited grant on `parts`: 0105's post-condition assert raises if so, which PGlite cannot show.
20. CSP report-only behaviour on Studio WASM / workers, Drive Picker, Turnstile and GA has not been observed in a browser.

## 7. Deploy order

1. Deploy the code from this branch first. Every migration has a code fallback until it runs, and 0100 and 0105 need the new code live before they run (0105 makes `select *` on `parts` fail; the code now names columns).
2. Run the migrations in numeric order in the Supabase SQL editor: 0098 (the pending list still marks it NOT RUN, and 0103 re-pins `refresh_part_sourcing` from 0098, so it must precede 0103), then 0100, 0101, 0102, 0103, 0104, 0105. Each file is idempotent with a rollback note in its header; `docs/MIGRATIONS.md` has the per-file notes.
   - 0100 Studio private models (DB-01, G1.1-G1.4, G1.2 data) - 0101 AI usage server-only (DB-02) - 0102 server-side credit spend and `cad_set_code` (DB-04, DB-06, G-C1) - 0103 guards and grants (DB-07/08/10/11/12/13/16/17/18/19/22, API-02) - 0104 quote-upload path (DB-15) - 0105 parts cost private (DB-09).
   - Before 0103: optionally count `inquiries` rows over 120 / 40 / 160 / 8000 characters (the CHECK is NOT VALID); after, `validate constraint` once clean.
   - After 0105: one staging check that admin `insert().select()` on `parts` still works (section 6, item 17).
3. Set `SUPABASE_SERVICE_ROLE_KEY` in every environment that serves these routes. Without it the Studio product routes, CAD (`/api/cad`, enclosure, product unlock) and the non-admin wiring routes (`/api/netlist`, `/api/bom/electronics`, `/api/studio/wiring`) answer 503, and AI usage rows are skipped (the daily guard then counts nothing).
4. The CSP is `Content-Security-Policy-Report-Only`: it blocks nothing. Watch reports for one release, then rename it (5.26). The other security headers are enforced from the first deploy.
5. Turnstile client wiring is in place for when the owner turns the `store_settings` switch on: brief-chat, dictation (voice notes), store-lead callers, design-quote, demand. With the switch off nothing changes, and no server check is enforced. Confirm the Supabase Auth CAPTCHA state first (5.18).
6. The Next patch bump (15.5.28, section 6 item 10) is applied in the verification step; deploy it with this code.

## 8. Behaviour changes

Intentional changes a user, admin or operator can observe. Source: commit bodies. Items marked (0xxx) take effect only when that migration runs.

Payments and credits
- API-01: a Fawran receipt without the payment's GT code in its note or transfer reference goes to manual review (`reference_mismatch`) instead of auto-approval. Arabic-Indic and Persian digits are folded, so they still match.
- DB-04 / DB-06 / G-C1 (0102): sessions can no longer call `spend_credit` or `cad_set_code`; wiring and CAD charges go through the service client. Without the service key, `/api/cad`, enclosure and unlock refuse before the model call (503 `unavailable`; unlock 503 `service_unavailable`).
- AI-05: for non-admin callers the wiring routes answer 503 `unavailable` before the model call when the service key is missing, and return no circuit when the charge fails (401 `sign_in`, 402 `no_credits`, 404, 503); the saved bom / netlist are rolled back. Admins are never charged or refused. `listOnly` stays free. No unpaid circuit is handed out any more.
- AI-06: idea-chat turns are priced from the server-stored tier; the client card can only raise it.
- DB-07 (0103): a cancelled pass-paid job refunds pass tokens as `idea_pass`, not as permanent tokens.
- DB-08 (0103): a guest claim no longer aborts on a duplicate welcome row; the guest's welcome row is dropped (balance can go below 0, DB-08b).

Orders and store
- DB-10 (0103): quantity is at most 1000 per line, at most 100 lines per order, at most 10 orders per hour per customer phone (last 8 digits) or email; super_admin and service_role are exempt. Refusals show `errorQtyCap`, `errorLineCap`, `errorTooManyOrders` (EN + AR) instead of the generic submit error. A class order with more than 100 lines fails (DB-10c).
- DB-16 (0103): `inquiries` fields are capped (name 120, phone 40, email 160, message 8000) and a public insert always stores `status = new`, `is_test = false`. `/api/project-cad` caps the lead's name and email to the same limits.
- DB-09 (0105): `select *` on `parts` by anon or a session is "permission denied"; seven cost / margin columns are admin-only through the `parts_admin` view; internal `store_settings` keys (margin and commission floors, `fx_to_qar`, `anonymous_cleanup`, `backup_search`, `ai_limits`, `restock_weights`, `voltaat_sync`, `fix_on_request`, `csv_mapping:*`) are hidden from anon and non-admin sessions.
- DB-12 / DB-17 / DB-18 / DB-19 (0103): non-admins cannot change `projects.is_test` / `tenant_id`; `set_order_payment_method` only for your own order; `refresh_part_sourcing` and `offer_landed_cost_qar` only for admin / service_role.
- DB-13 (0103): class team projects cannot be claimed or recovered by token (reason `invalid`, no recovery email).
- API-02 (0103): at most 3 recovery emails per contact address per 24 h.
- DB-15 (0104): `quote-uploads` accepts only `<uuid>/<name>` paths; a sanitised file name over 200 characters is refused at upload.
- Admin overview counts shipped (not yet delivered) orders as open (820fef5).
- Admin sheet import: a sheet over 2 MB fails with `fetch_failed` instead of being cut mid-row (3d06ce9).
- Image import (supplier / Drive): SVG refused, 15 MB cap (Drive 25 MB), only jpeg / png / webp / gif / avif, redirects re-checked on every hop (3 max), `failOn: "error"` and a 40 MP pixel limit, so a damaged image that used to process may now fail.
- `safeFileName` (engineering upload / return names, print-file names): output is unchanged for ordinary and Arabic names; names containing `..`, a leading dot or longer than 80 characters differ (an over-long print name now keeps its `.stl`).

Studio, schools, engineering
- DB-01 (0100): private product models leave `projects.studio`; a PostgREST read of `studio->productPrivate` returns null; a direct PATCH cannot change `studio.product` (a null / non-object `studio` is coerced to `{}` with `product` restored). All Studio product routes answer 503 `service_unavailable` without the service key.
- Class teachers can read but no longer write their teams' product designs (design / check / preview / unlock / choose answer 404 for them); super_admin and the owner are unaffected.
- Engineering job snapshots no longer contain `productPrivate`; the admin download adds the models at download time. 0100 strips old snapshots.
- Schools invoice: the action calls `createLead` in-process (no HTTP hop to `/api/store-lead`, no forwarded cookies).
- Admin actions that redirect now use `requireSuperAdmin`: a guest session is sent to `/projects`, a signed-out visitor to `/sign-in`, other roles to `/dashboard`. `/dashboard/contact` redirects non-admins.

Public endpoints
- `/api/store-lead`: a non-object JSON body answers 400 `bad_request`; an unknown or missing `source` falls back to the store-callback source (both pinned by `lib/leads/parse.test.ts` after the move to `lib/leads`). When Turnstile is on, guest sessions need a token (only a signed-in non-anonymous account is exempt).
- `/api/design-quote`: 403 `captcha_failed` (Turnstile on), 429 `rate_limited` (10 per 10 min per IP); a storage path outside the uploader's shape is dropped (the lead is saved and emailed, no signed link); the project name is read under RLS.
- `/api/demand`: kind `request` returns 403 `captcha_failed` (Turnstile on) and 429 (10 per 10 min per IP); beacons 300 per 10 min per IP.
- `/api/brief-chat`, `/api/transcribe`: guests get 403 `captcha_failed` when Turnstile is on; 429 `rate_limited` per user (guests also per IP); transcribe has `maxDuration = 60` and a 45 s upstream timeout.
- `/api/project-cad`: 429 `rate_limited` after 5 notifications per user per 10 min (per instance); invalid bodies are rejected by zod.
- Cron routes: all six answer a missing header, a wrong secret and an unset secret with the same 401 `{ error: "unauthorized" }` (two used to answer 500 `cron_secret_unset`).
- `auth/callback`: `next` must be a locale-prefixed same-site path (plus `/{locale}/reset-password`); anything else goes to `/`.
- AI usage (0101): usage rows are written only with the service key; `cost_usd` is capped at 50 per row (was 100); `is_test` is copied from the project again.
- Auth cookies are `Secure` in production; every route sends HSTS, nosniff, `X-Frame-Options: SAMEORIGIN`, Referrer-Policy, Permissions-Policy and COOP; `X-Powered-By` is gone.
- Stored schematic SVG is shown as an `<img>`, so it no longer inherits page CSS or fonts.

## 9. Counts

Computed from the summary table in section 1: 86 rows (71 original rows after merging 4 duplicate pairs from 75 raw IDs: DB 31 + API 15 + AI 16 + WEB 13; plus 15 rows added by the post-fix reviews, section 3.5).

| Severity | Rows |
|---|---|
| Critical | 0 |
| High | 7 |
| Medium | 25 |
| Low | 38 |
| Info | 16 |
| Total | 86 |

| Status | Rows |
|---|---|
| Fixed (code) | 16 |
| Fixed (migration 0100, NOT RUN) | 2 |
| Fixed (migration 0103, NOT RUN) | 9 |
| Fixed (code + migration 0100, NOT RUN) | 4 |
| Fixed (code + migration 0101, NOT RUN) | 1 |
| Fixed (code + migration 0102, NOT RUN) | 1 |
| Fixed (code + migration 0103, NOT RUN) | 2 |
| Fixed (code + migration 0105, NOT RUN) | 1 |
| Partially fixed — see note | 10 |
| Open — needs owner decision | 15 |
| Open — recommended | 9 |
| Info | 16 |
| Total | 86 |

Fixed in code or a migration file, all variants: 36; of those, 20 depend on a migration the owner has not run.

Notes: "Fixed (migration ..., NOT RUN)" means the exposure stays until the owner applies the file. Partially fixed rows: API-01 (GT code only; does not stop a forged screenshot with the payer's code), AI-03 (filter, not a boundary), DB-04 and DB-06 (reward rules / per-team cap open), DB-13 (`recovery_token` still readable), DB-15 (path shape only), API-02 (address cap only), AI-10 (two bodies not schema-checked), WEB-03 (CSP report-only), WEB-04 (`httpOnly` off). WEB-01 is Fixed (code) for the render side only. API-03 / AI-09 is Fixed (code) but enforces only when the Turnstile switch is on. Status snapshot: HEAD bab42fd (125 commits ahead of origin/main); no uncommitted drafts are counted.
