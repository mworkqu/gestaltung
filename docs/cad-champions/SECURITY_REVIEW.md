# CAD Champions pre-launch security review (Prompt 12 Step A)

Date: 2026-10-15. Branch `cad-champions`. Scope: everything under `app/[locale]/cad-champions`, `app/api/cad-champions`, `app/api/cron/cc-*`, `lib/cad-champions`, `components/cad-champions`, the CC branch of `middleware.ts`, migrations 0077–0085 and `grader/app`.

Each finding is marked **FIXED** (changed in this pass, tests green) or **RECOMMENDED** (owner decision, main-site file, RLS change below High, or a change that needs new UI copy). Paths are relative to the repo root.

## Summary

| Severity | Count | Fixed | Recommended |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 1 | 1 (migration 0086, owner must run it) | 0 |
| Medium | 8 | 2 | 6 |
| Low | 22 | 8 | 13 (+1 accepted by design) |

What I checked and found sound:
- **Answer data.** `reference_data`, `rubric` and `tolerances` on tasks and exercises, locked hints, solution video ids, `partial_rule` on aspects, and raw grader output (`cc_grading_logs`) are all unreachable for students and anon.
- **Private and admin data.** Other students' attempts, submissions, results, scores, exercise attempts, unlocks, certificates, questions and files are unreachable. So are payment proofs (owner and admin only), trainer notes, and the admin tables: coupons, audit log, integrity flags, announcements, and writes to overrides and testimonials.
- **Server actions and routes.** Every one re-checks auth and role on the server. Every service-role path has an explicit role or ownership check first.
- **Cron and webhook secrets.** Cron routes require `CRON_SECRET` with a constant-time compare and deny when it is unset. The SkipCash webhook uses a constant-time HMAC, refuses when its key is unset, and is idempotent.
- **Leak checks.** No secrets reach the client bundle, no raw errors reach students, and there is no open redirect. Email HTML is escaped and zip-slip is handled.

---

## Critical

None.

## High

### SR-H1: paid lesson files and every test's task files were readable by any signed-in user. FIXED (migration 0086, RUN AFTER 0085)

- **Where:** `supabase/migrations/0078_cc_storage.sql:60-62` (`cc_task_files_read`) and `:84-86` (`cc_lesson_files_read`). Both policies were `for select to authenticated using (bucket_id = '…')`.
- **Impact:** a free account could list and download every paid lesson download through the Storage API (`supabase.storage.from('cc-lesson-files').list()`, then `createSignedUrl`), which bypasses the enrollment check in `lib/cad-champions/training/access.ts`.
  - The same account could also read the files of every test task, including unpublished and admin-only (future mock) tests and tests the student has not started.
- **Fix:** both read policies are now staff-only.
  - The app never reads these buckets with a student session. It signs 10-minute URLs with the service role after its own access check (`lib/cad-champions/training/server.ts:494` `signedFileLinks`, `lib/cad-champions/test/actions.ts:323` `createSignedDownload`), so nothing in the app changes.
  - `supabase/migrations/0086_cc_security.sql`:

  ```sql
  drop policy if exists cc_task_files_read on storage.objects;
  create policy cc_task_files_read on storage.objects for select to authenticated
    using (bucket_id = 'cc-task-files' and public.cc_is_staff());
  drop policy if exists cc_lesson_files_read on storage.objects;
  create policy cc_lesson_files_read on storage.objects for select to authenticated
    using (bucket_id = 'cc-lesson-files' and public.cc_is_staff());
  ```

  - Note: re-running 0078 restores the old policies, so run 0086 again after it.
- **Test:** `lib/cad-champions/db/rls.test.ts`, "SR-H1: students cannot read or list lesson files or task files; staff can".

## Medium

### SR-M1: coupon codes can be guessed through PostgREST, bypassing the app's rate limit. RECOMMENDED
- **Where:** `0084_cc_payments.sql:213` grants `cc_validate_coupon(text, uuid)` to `authenticated`. The app limits `validateCouponAction` to 10 per 10 minutes (`lib/cad-champions/payments/actions.ts:43`), but `POST /rest/v1/rpc/cc_validate_coupon` with the user's JWT is unlimited.
- **Impact:** a student can brute-force short coupon codes, such as a 100 % institution code.
- **Fix:** the function relies on `auth.uid()`, so the grant can't simply be revoked. Add a throttle inside the function (migration 0087):

  ```sql
  create table if not exists public.cc_coupon_attempts (user_id uuid not null, at timestamptz not null default now());
  alter table public.cc_coupon_attempts enable row level security; -- no policies: definer-only
  create index if not exists cc_coupon_attempts_idx on public.cc_coupon_attempts (user_id, at);
  -- at the top of cc_validate_coupon's body (it is plpgsql/sql security definer):
  --   if (select count(*) from public.cc_coupon_attempts where user_id = auth.uid() and at > now() - interval '10 minutes') >= 10
  --     then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  --   insert into public.cc_coupon_attempts (user_id) values (auth.uid());
  ```

  Also tell the owner to use coupon codes of 8 or more random characters.

### SR-M2: rate limits are per server instance, and sign-in, OTP, resend and password reset have none server-side. RECOMMENDED
- **Where:** `lib/rate-limit.ts` (in-memory). The CC buckets are in `lib/cad-champions/rate-limits.ts`. Sign-in, OTP, resend and reset call Supabase from the browser: `components/cad-champions/auth/sign-in-form.tsx:91,124,153`, `check-email.tsx:46` and `password-reset.tsx:55`.
- **Impact:** on Vercel each warm instance keeps its own window, so limits are a brake, not a quota. Credential stuffing and email-bombing are limited only by Supabase Auth's own rate limits.
- **Fix, with no new paid service:**
  1. Supabase → Authentication → Rate Limits: set sign-in/sign-up, token verification and email sending to the lowest values that fit, for example 30 sign-ins per 5 minutes per IP and 4 emails per hour.
  2. Turn on Supabase Attack Protection → CAPTCHA (Turnstile) only after the site keys and switch are live, in the order given in `docs/TURNSTILE.md`.
  3. For exact limits on the CC actions that matter (sign-up, proof, coupon), add a Postgres counter, either the SR-M1 table pattern or an `ai_rate_limits`-style RPC, instead of Redis.

### SR-M3: lesson progress is trusted from the browser. RECOMMENDED (owner decision)
- **Where:** `lib/cad-champions/training/actions.ts:117-131`. `saveLessonProgressAction` takes `second` and `duration` from the client, and `markLessonCompleteAction` completes a lesson outright.
- **Impact:** watched percent, XP, streaks, badges and, through `refreshModuleRewards`, module certificates can be earned without watching. Certificates are public through `/verify/[code]`.
- **Fix:** if a certificate should mean "watched", stamp `first_seen_at` on the first progress ping (server clock) and refuse completion until `now() - first_seen_at >= 0.5 * duration_minutes`. Gate certificates on passed exercises rather than lesson completion.

### SR-M4: test task briefs and attachments can be read before the timed attempt starts. RECOMMENDED (owner decision)
- **Where:** `0077_cc_core.sql:1070-1080`. The `cc_test_tasks_public` view shows every task of every published test to any signed-in user. `lib/cad-champions/test/actions.ts:323` `createSignedDownload` signs a task file for anyone who can see the view.
- **Impact:** a student can read the diagnostic or mock tasks and drawings before starting the clock. That is a fairness issue on timed tests, not a data leak.
- **Fix:** in `createSignedDownload`, require an `in_progress` attempt of the caller on that task's test, or staff:

  ```ts
  // after the view check, before signing:
  if (!cc.isStaff) {
    const { data: a } = await service.from("cc_attempts").select("id").eq("user_id", cc.user.id)
      .eq("test_id", task.test_id).eq("status", "in_progress").limit(1).maybeSingle();
    if (!a) return { ok: false, reason: "not_allowed" };
  }
  ```

  Add `test_id` to the view select. For the view itself, keep it as the catalogue and move `brief_*` and `attachments` behind the same "attempt started" rule, through a SECURITY DEFINER `cc_task_brief(task_id)` RPC.

### SR-M5: the admin review page signed student files for 1 hour. FIXED
- **Where:** `lib/cad-champions/drawing/review-server.ts:24` (`SIGNED_SECONDS = 3600`).
- **Impact:** a leaked URL from history or a shared screen exposed a student's file for an hour.
- **Fix:** `SIGNED_SECONDS = 600`, the same as every other CC signed URL. The page re-signs on load. All CC signed URLs are now 600 s or less, except the grader's 1800 s internal ZIP read (`lib/cad-champions/grader/queue.ts:206`, server-to-server) and the 900 s AI-check and admin file routes.

### SR-M6: uploaded content was matched against the whole accept set, not the file's own extension. FIXED
- **Where:** `lib/cad-champions/upload/validate.ts:151` (`validateHeader`) and `lib/cad-champions/upload/server.ts:74`.
- **Impact:** a `.pdf` payment proof that was really a PNG, or the reverse, was accepted. That made polyglot and mislabelled files reach the admin PDF viewer.
- **Fix:** `validateHeader(bytes, accept, name?)` now requires the signature of that extension (`.pdf` → `%PDF-`, `.png` → PNG, and so on). `verifyUploadedObject` passes the stored path. Covered by tests in `validate.test.ts`.

### SR-M7: no per-user storage quota on direct uploads. RECOMMENDED
- **Where:** `0078_cc_storage.sql:103-109,126-132`. Insert-own policies pin only the first folder segment.
- **Impact:** a student can fill their own folder with many maximum-size objects (50 MB, or 300 MB for ZIPs). Nothing is overwritten, because there is no update or delete policy and the app uses `upsert:false`. The cost is storage.
- **Fix:** add a weekly cron that deletes objects in `cc-submissions` and `cc-payment-proofs` older than 7 days that no `cc_submissions`, `cc_exercise_attempts`, `cc_lesson_questions` or `cc_payments` row references. Optionally add an insert policy check `(select count(*) from storage.objects o where o.bucket_id = bucket_id and o.owner = auth.uid() and o.created_at > now() - interval '1 day') < 200`.

### SR-M8: a full Content-Security-Policy is not applied yet. RECOMMENDED (needs testing with the 3D hero and the Bunny iframe)
- **Current state:**
  - The CC branch now sends `frame-ancestors` (see SR-L20) and `Referrer-Policy`, `X-Content-Type-Options` and `Permissions-Policy`.
  - Vercel already sends `Strict-Transport-Security: max-age=63072000` (checked live on gestaltung360.com).
  - `next.config.mjs` and `vercel.json` set no security headers for the main site.
- **Proposed CC CSP.** Ship it first as `Content-Security-Policy-Report-Only` in `lib/cad-champions/security-headers.ts`, watch the console on landing (3D hero), get-ready, test workspace, lesson player (Bunny), checkout and admin, then enforce:

  ```
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: https://fonts.gstatic.com;
  img-src 'self' data: blob: https://*.supabase.co https://*.b-cdn.net https://www.google-analytics.com https://www.googletagmanager.com https://i.ytimg.com;
  media-src 'self' blob: https://*.supabase.co https://*.b-cdn.net;
  connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com;
  frame-src https://iframe.mediadelivery.net https://www.youtube-nocookie.com https://challenges.cloudflare.com https://*.supabase.co;
  worker-src 'self' blob:;
  object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'; upgrade-insecure-requests
  ```

- **Notes:**
  - Next.js inline bootstrap scripts need `'unsafe-inline'`, or nonces through middleware.
  - Add `'wasm-unsafe-eval'` if the 3D hero loads WASM.
  - `*.supabase.co` in `frame-src` is for the admin review iframe of a signed PDF.
  - Drop `fonts.googleapis.com` if every font comes from `next/font`.
  - On the share page, replace `frame-ancestors 'none'` with no directive.
  - Add `preload; includeSubDomains` to HSTS only when every subdomain is HTTPS.

## Low

### SR-L1: instructors read every payment row. RECOMMENDED (SQL)
- **Where:** `0077_cc_core.sql:1305-1313`, where `cc_payments_select` uses `cc_is_staff()`.
- **Impact:** instructors see payer name, bank and transfer reference.
- **Fix:**

  ```sql
  drop policy if exists cc_payments_select on public.cc_payments;
  create policy cc_payments_select on public.cc_payments for select to authenticated
    using (user_id = (select auth.uid()) or public.cc_is_admin());
  ```

- **Test:** un-skip "GAP SR-L1" in `rls.test.ts`.

### SR-L2: `cc_has_active_enrollment(p_user)` answers for any user id. RECOMMENDED (SQL)
- **Where:** `0077_cc_core.sql:975-989`.
- **Fix:** add `and (p_user = (select auth.uid()) or (select auth.uid()) is null or public.cc_is_staff())` to its `where`. The service role has a null `auth.uid()`, and anon has no grant.

### SR-L3: a student can insert the grader-only Get Ready key `practice_upload` directly. RECOMMENDED (SQL)
- **Where:** `0077_cc_core.sql:1197-1200`.
- **Fix:** `with check (user_id = (select auth.uid()) and step_key <> 'practice_upload')` on `cc_get_ready_steps_insert_own` and `_update_own`.
- **Before applying:** first confirm that `lib/cad-champions/get-ready/server.ts` `upsertKeys` writes with the service role.

### SR-L4: a grade query can reference another student's attempt, and `image_path` is unconstrained. RECOMMENDED (SQL)
- **Where:** `0077_cc_core.sql:1367-1371`.
- **Fix:**

  ```sql
  -- added to cc_lesson_questions_insert_own's with check:
  and (attempt_id is null or exists (select 1 from public.cc_attempts a where a.id = attempt_id and a.user_id = (select auth.uid())))
  and (image_path is null or image_path like (select auth.uid())::text || '/%')
  ```

### SR-L5: public answered FAQ rows expose the asker's `user_id`. RECOMMENDED
- **Where:** `0077_cc_core.sql:1360-1365`. No name is exposed, because profiles stay private.
- **Fix:** serve public FAQs through a view without `user_id`, `attempt_id` and `image_path`, or through column grants.
- **Test:** documented in `rls.test.ts` ("documents SR-L5").

### SR-L6: lesson paid-column privacy depends on migration order. RECOMMENDED (runbook)
- **Where:** `0083_cc_training_seed.sql:104-113`. Re-running 0077 re-grants table-wide select on `cc_lessons`.
- **Fix:** add "re-run 0083 and 0086 after any re-run of 0077 or 0078" to `docs/cad-champions/DEPLOY.md`.

### SR-L7: `checkUploadAction` had no limiter and trusted the client's `maxBytes` up to 300 MB. FIXED
- **Where:** `lib/cad-champions/upload/actions.ts`.
- **Fix:**
  - It is now limited by `ccRateLimited("upload")`.
  - The client's limit is capped by the bucket's own `CC_BUCKET_LIMITS`. Payment proofs are capped at 10 MB, and only `zip` in `cc-submissions` may use 300 MB.
  - The action is currently unused by the UI.

### SR-L8: several student actions with a server-side cost were unthrottled. FIXED
- **Where:**
  - `startAttemptAction` (`test/actions.ts:53`)
  - `createSignedDownload` (`test/actions.ts:323`)
  - `revealHintAction` (`training/actions.ts:492`, staff exempt)
  - `cancelReservationAction` (`payments/actions.ts:95`)
  - `requestAccountDeletion` (`app/[locale]/cad-champions/account/actions.ts:121`)
  - `GET /api/cad-champions/payments/[id]/status`, which may call the SkipCash API on every poll.
- **Fix:**
  - New buckets `action` (60 per 10 min) and `poll` (240 per 10 min) in `lib/cad-champions/rate-limits.ts`.
  - The actions return their existing generic error codes, so no new UI strings are needed.
  - The status route returns 429 with `Retry-After`. The return poller already keeps polling on a non-final answer.

### SR-L9: stored display file names kept control and bidi characters. FIXED
- **Where:** `test/actions.ts` (`recordSubmissionAction`, `file_name`) and `training/actions.ts` (exercise attempt `file_name`).
- **Impact:** a name using U+202E could spoof admin lists, and `review-server.ts` passes it as a `download` name.
- **Fix:** the new `cleanDisplayFileName()` in `lib/cad-champions/upload/validate.ts` drops path parts, C0 and C1 controls, LRM/RLM, and U+202A–202E / U+2066–2069, then caps the length. It is covered by tests. Storage keys already used `safeFileName`, which is ASCII only.

### SR-L10: the client-sent `sha256` and `size` are stored unverified. RECOMMENDED
- **Where:** `test/actions.ts` around line 194 and `training/actions.ts` around line 330.
- **Impact:** both are informational. The real size check uses the stored object, and the duplicate-file integrity flag compares `sha256`, so a student can dodge that flag.
- **Fix:** return `size` from `verifyUploadedObject` and store that. For the integrity flag, hash server-side in the grader, which already downloads STEP files.

### SR-L11: `readObjectHead` could download a whole object if Storage ignored `Range`. FIXED
- **Where:** `lib/cad-champions/upload/server.ts:50`.
- **Fix:** it now reads at most the first 64 bytes from the body stream and cancels the rest.

### SR-L12: encrypted ZIP entries are accepted by the package check without a warning. RECOMMENDED
- **Where:** `lib/cad-champions/upload/package-check.ts`. The grader skips them (`grader/zip-extract.ts:17`, `grader/plan.ts:120`).
- **Fix:** add an `encrypted_entry` warning. This needs new en and ar strings, so it is left for the QA pass.

### SR-L13: announcement subjects kept inner CR/LF. FIXED
- **Where:** `lib/cad-champions/admin/announcements.ts` (`validateAnnouncement`).
- **Note:** Resend takes JSON and authors are staff, so this was hardening only. Subjects are now one line.

### SR-L14: admin email-test actions returned the provider's raw error text. FIXED
- **Where:** `app/[locale]/cad-champions/admin/emails/actions.ts:41` and `lib/cad-champions/admin/announcements-server.ts:198`.
- **Fix:** the browser now gets `detail: "send_failed"`. The text stays in the server log.

### SR-L15: `recordPhaseMarkerAction` did not validate `attemptId`. FIXED
- **Where:** `test/actions.ts:381`.
- **Fix:** it now runs a UUID check before the query.

### SR-L16: certificate codes are short and the verify page is unthrottled. RECOMMENDED
- **Where:** `lib/cad-champions/training/certificate.ts:15-20`. Codes are 8 characters from a 31-character alphabet, about 39.7 bits, with a slight modulo bias. `/verify/[code]` returns the holder's name.
- **Fix:** use 12 characters with rejection sampling (`if (b >= 248) continue`), and add an IP limiter (`createRateLimiter` + `clientIp`) on the verify page. Existing codes stay valid.

### SR-L17: share tokens never expire. RECOMMENDED (optional)
- **Context:** tokens are 192 bits (`randomBytes(24)`), revocable (turning sharing off nulls the token), and the shared payload is first name, band and area scores only (`0081_cc_results.sql:36-62`).
- **Optional fix:** add `share_expires_at` and check `now() < share_expires_at` in `cc_shared_result`.

### SR-L18: the grader follows redirects and accepts any `https://` URL when `GRADER_ALLOWED_URL_PREFIXES` is unset. RECOMMENDED
- **Where:** `grader/app/measure.py:40-58`.
- **Context:** `GRADER_SECRET` is required and compared with `hmac.compare_digest`, and the service answers 503 when it is unset. The deploy command in `docs/cad-champions/DEPLOY.md:114` sets the prefix.
- **Fix:** keep that prefix in production. Use `follow_redirects=False` (Supabase signed URLs do not redirect), or re-check `_allowed_url` on the final URL.

### SR-L19: `GET /api/cad-champions/attempts/[id]/status` changes state. RECOMMENDED (info)
- **Context:** it calls `closeIfExpired`. It is owner or staff only and idempotent, so the risk is minimal. Move the close to the cron or a POST if it is ever reworked.

### SR-L20: CC pages allowed same-origin framing. FIXED
- **Where:** `lib/cad-champions/security-headers.ts` and the `middleware.ts` CC branch.
- **Fix:** `Content-Security-Policy: frame-ancestors 'none'` plus `X-Frame-Options: DENY` on every CC page. The only exception is the public shared result `/cad-champions/{en|ar}/results/share/<token>`, which drops the two frame headers so it can be embedded.
- Referrer-Policy `strict-origin-when-cross-origin`, `nosniff` and Permissions-Policy `camera=(), microphone=(), geolocation=()` stay on every CC response.
- No CC page frames another CC page (checked every `<iframe>` in `components/cad-champions`).
- Covered by `lib/cad-champions/security-headers.test.ts`.

### SR-L21: the SkipCash webhook has no timestamp or nonce. RECOMMENDED (info)
- **Context:**
  - The HMAC is checked in constant time, and the route refuses to run with no key set.
  - Bodies over 20 KB are refused.
  - Each event is re-fetched from SkipCash, and the amount and currency are compared before the payment is marked paid.
  - Payment state moves only through the service-role `cc_payment_transition`.
- **Replay:** a replay can't move a paid payment backwards. `lib/cad-champions/payments/skipcash.test.ts`, "never moves a paid payment backwards (replayed / late pending, failed)", covers pending, failed, cancelled and paid after paid. 78/78 payment tests pass.

### SR-L22: the `cc_locale` cookie is not httpOnly. ACCEPTED (by design)
- **Context:** the client language switcher writes it, and it holds only `en` or `ar`. It has `SameSite=Lax`, has `Secure` on https, and lasts one year.
- **Auth cookies:** these are `@supabase/ssr` defaults, unchanged from the main site.
- **CSRF on server actions:** covered by Next's built-in Origin vs Host check, and no CC action is exposed as a GET.

---

## Section notes

### 1. RLS audit (0077–0085, plus 0086)
- **Harness:** the PGlite harness (`lib/cad-champions/db/rls.test.ts`) runs the real migrations in order, now including 0086. It tests as anon, student A, student B, instructor, CC admin and site super_admin.
- **Cases added in this pass:**
  - SR-H1 (lesson and task files), now passing.
  - Student A cannot read, update or delete B's submissions, task results, skill scores, aspect results, exercise attempts, unlocks, certificates, lesson progress, integrity flags, questions, journey, Get Ready rows or profile.
  - Students cannot self-insert results, exercise attempts, unlocks, certificates or submissions, or self-grade attempts.
  - Students and instructors cannot write coupons, announcements, testimonials, overrides, integrity flags or plans, and cannot delete the audit log.
  - Anon reads no private table, answer table or view.
  - `cc_verify_certificate` returns only code, name, module and date.
  - SR-L5 is documented.
- **Remaining skipped `GAP` tests:** SR-M1 (coupon RPC), SR-L1, SR-L2, SR-L3 and SR-L4. Their current behaviour is pinned by "documents current behaviour of the gaps", so the skips can't rot silently. Flip each one when its SQL lands.

### 2. Server checks
- **Coverage:** all 31 `"use server"` files and 11 CC route handlers were read.
- **Admin actions:** they use `adminGuard("admin"|"staff")` (`lib/cad-champions/admin/server.ts:37`), which re-checks the role server-side. They never rely only on the page or layout check.
- **Student actions:** they use `getCcUser()` plus explicit ownership (`loadOwnAttempt`, `ownedPayment`, `user_id === cc.user.id || cc.isStaff`).
- **IDOR checks:** the `/results/[attemptId]` page and its report route, `/account/payments/[id]` and the receipt route (owner or admin, paid or refunded only) all check ownership explicitly. The certificate download route reads through RLS. The admin routes use `adminGuard`.
- **Cron:** both `app/api/cron/cc-*` routes use `isAuthorizedCron` (`lib/notifications/links.ts:74`, `timingSafeEqual`, Bearer) and return 500 when `CRON_SECRET` is unset.
- **Grader:** the internal call sends `X-Grader-Secret`, and the grader compares it with `hmac.compare_digest`.

### 3. Secrets
- **Build:** `npm run build` ran once and passed. `node scripts/cc-secret-scan.mjs` scanned 415 `.next/static` files for every non-`NEXT_PUBLIC_` value of 12 or more characters in `.env.local` (10 values) and 10 markers, including the service-role JWT payload. Nothing was found.
- **Script extended:** it now also checks every `"use client"` file in `app/`, `components/` and `lib/` (308 files) for non-`NEXT_PUBLIC_` `process.env` reads and imports of `lib/supabase/service`. It found 0.
- **Run it** after a build: `node scripts/cc-secret-scan.mjs`. It exits 1 on a find and 2 with no build.

### 4. Uploads
- **Server checks:** every upload is re-read on the server (`verifyUploadedObject`). The real size comes from Content-Range, and the first 64 bytes are checked for STEP (`ISO-10303-21`), PDF, ZIP, PNG, JPEG, WebP, MP4 and WebM. The content must now match the extension (SR-M6). Bucket `file_size_limit` and `allowed_mime_types` are a second layer.
- **Paths:** they are server-checked by `isPathUnderPrefix` (`<uid>/<attempt>/<task>/`). Keys go through `safeFileName`, and display names through `cleanDisplayFileName` (SR-L9).
- **Uploads go straight to Storage:** they use the user JWT with `upsert:false`. No signed upload URLs are minted.
- **Signed URL lifetimes:** listed under SR-M5.
- **ZIP:** archives are read from the central directory only. The limits are 500 entries, an 8 MB directory, a 2 GB declared uncompressed total and a 300 MB upload.
  - Zip-slip is refused by `normalizeEntryPath`: `..`, absolute paths, drive letters and NUL or control characters.
  - Only the grader inflates entries (`grader/zip-extract.ts`), one at a time, with `maxOutputLength`. It accepts only stored and deflate methods, refuses encrypted entries, and handles at most 40 STEP files of 50 MB each, re-uploaded under server-built names.

### 5. Rate limits

| Endpoint | Status |
|---|---|
| Sign-up | Present: IP, 8 per 10 min (`sign-up/actions.ts:42`) |
| Sign-in, OTP, resend, password reset | Supabase Auth only. See SR-M2 |
| Uploads (record, package, check) | Present: `upload` (check: FIXED SR-L7) |
| Grading (exercise, practice) | Present: `grade` |
| AI drawing checks | Not user-triggerable. They run once per finalised attempt and are bounded by the retake cooldown |
| Payment proof | Present: `proof` |
| Checkout | Present: `checkout` |
| Coupon | Present: `coupon` in the app. The RPC is open (SR-M1) |
| Questions and grade queries | Present: `question`, plus 3 open per lesson |
| Help feedback | Present: IP, 20 per 10 min |
| Translate (staff AI) | Present: `translate` |
| Start test, signed task download, hint reveal, cancel reservation, deletion request | FIXED: `action` (SR-L8) |
| Payment status poll | FIXED: `poll` (SR-L8) |

All limiters are per instance (SR-M2).

### 6. Grader and SkipCash
- **Grader:**
  - `GRADER_SECRET` is required: 503 when unset, 401 on mismatch, constant-time compare.
  - Huge files are capped by the declared Content-Length and a streamed byte count (`GRADER_MAX_FILE_MB`, default 50) and return `E_TOO_LARGE`.
  - Downloads have a 20 s total deadline.
  - Parsing runs in a child process with a 60 s wall clock and an `RLIMIT_AS` memory cap. A kill returns `E_TIMEOUT`, and a busy queue returns `E_TIMEOUT` after 50 s.
  - Package jobs are capped at 40 STEP files.
- **SkipCash:** see SR-L21.

### 7. Headers
- See SR-L20 (applied) and SR-M8 (proposed CSP). HSTS comes from Vercel.

### 8. Other checks
- **Open redirects:**
  - `ccNextOrNull` and `safeCcNext` (`lib/cad-champions/auth/paths.ts:90-112`) require a leading `/`, reject `//`, `\` and control characters, parse against a dummy origin, require the same origin and a `/cad-champions/{en|ar}/…` path, and rebuild the result from the parsed pathname.
  - Mentally tested and safe: `//evil.com`, `/\evil.com`, `https://evil.com`, `%2F%2Fevil.com`, `javascript:`, `\t//evil.com` and `/cad-champions/en/../../x`.
- **Share token entropy:** 192 bits.
- **Email injection:** every CC email goes through `renderBrandedEmail` (`lib/email/brand-layout.ts`), which escapes all text, facts, quotes and hrefs. Announcement markdown is escaped first, then limited markup is re-added. Recipients always come from the database.
- **`dangerouslySetInnerHTML`:** used once, for the landing JSON-LD, with static data and `</script>` neutralised.

---

## Files changed in this pass
- `supabase/migrations/0086_cc_security.sql`: **new, owner runs it after 0085** (SR-H1).
- `lib/cad-champions/security-headers.ts` and `.test.ts`, plus the `middleware.ts` CC branch (`applyCcSecurityHeaders(res.headers, rest)`): SR-L20.
- `lib/cad-champions/upload/validate.ts` and `.test.ts`, and `lib/cad-champions/upload/server.ts`: SR-M6, SR-L9, SR-L11.
- `lib/cad-champions/upload/actions.ts`: SR-L7.
- `lib/cad-champions/rate-limits.ts`, `lib/cad-champions/test/actions.ts`, `lib/cad-champions/training/actions.ts`, `lib/cad-champions/payments/actions.ts`, `app/[locale]/cad-champions/account/actions.ts` and `app/api/cad-champions/payments/[id]/status/route.ts`: SR-L8, SR-L9, SR-L15.
- `lib/cad-champions/drawing/review-server.ts`: SR-M5.
- `lib/cad-champions/admin/announcements.ts`, `lib/cad-champions/admin/announcements-server.ts` and `app/[locale]/cad-champions/admin/emails/actions.ts`: SR-L13, SR-L14.
- `lib/cad-champions/db/rls.test.ts`: new cases (section 1).
- `scripts/cc-secret-scan.mjs`: finished, with the `"use client"` source check added.

## Verification
- `npx tsc --noEmit -p .`: clean.
- `npm run lint` (eslint + CC RTL check): clean.
- `npx vitest run lib/cad-champions`: 89 files, 1019 passed, 5 skipped (the documented gaps).
- `npm run build` + `node scripts/cc-secret-scan.mjs`: OK.
