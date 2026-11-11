# Review fixes — merge the audit, fix the QA findings, rebuild password reset

Paste everything below this line into Claude Code opened in the repo (`mworkqu/gestaltung`,
start from a clean `origin/main`). Use delegation defaults.

---

## 0. Working rules

**Use delegation defaults.** Apply the model-delegation rules from my global CLAUDE.md; if that
file cannot be found or read, STOP and tell me before doing anything else. In short: this main
session keeps orchestration, architecture decisions, anything ambiguous, final review and the
synthesis of subagent output. `opus` subagents: security/money/credits/RLS code, the checkout and
credit paths, subtle refactors, critical review. `sonnet` subagents: standard implementation,
tests, docs, codebase exploration, data scripts. `haiku` subagents: mechanical edits, searches,
message-key work, format conversions. Every subagent prompt is self-contained (context, rules,
expected output); launch independent subagents in parallel; when unsure pick the cheaper tier.

Hard rules (same as the audit):
1. Branch `fix/review-2026-10` from `origin/main`. Never push to `main`, never merge, never
   deploy, never run `vercel`. No `[deploy]` in commit messages. I review and merge.
2. `.env.local` is PRODUCTION. Never run migrations, never write to the database, never call
   paid/AI APIs from scripts. Never print secrets.
3. Never edit an existing migration. New SQL = new files numbered after the highest in
   `supabase/migrations/` (the audit already proposed 0100–0105, so yours start at 0106), each
   idempotent, with a rollback block in the header and a PGlite test like
   `lib/schools/db/schools-migration.test.ts`. List every new migration in CLAUDE.md as NOT RUN.
4. Keep the project rules in CLAUDE.md: storefront pages stay static/ISR, `revalidateStorefront()`
   after store writes, EN/AR message parity (`node scripts/check-i18n-parity.mjs`), scopes in
   `lib/i18n/scopes.ts`, no top-level `sharp`, no expression-bodied `useEffect`, no paid services,
   never hand-edit `content/legal/**` (edit `LEGAL_PAGES_DRAFT.md` and run
   `scripts/split-legal-draft.mjs`), never promise reprints/remakes, never promise partner
   workshops or automatic method detection.
5. Small green commits: after each, `npx tsc --noEmit`, `npm run lint`, `npm run test`, i18n
   parity, `npm run build` all pass. Run `npm run test:e2e` after each phase.
6. Do not delete anything a customer or admin can still reach without listing it under
   "Needs owner decision" first.
7. Behaviour changes only where this prompt or a listed finding asks for one; list every one in
   the final report.

Inputs (read them first; they are in the repo root under `review/` — copy the folder
`C:\Users\mmamr\Desktop\projects\Gestaltung company webpage\review` there if it is missing):
- `review/qa/REPORT.md` — live-site QA, findings F-001…F-054 (use the IDs from its section 4
  table; the in-body step references are off by one in places).
- `review/gestaltung-audit-reports-2026-10/` — FINAL_REPORT.md, SECURITY_AUDIT.md,
  CODE_QUALITY_AUDIT.md, REFACTOR_PLAN.md, findings/*, proposed-migrations/0100–0105,
  proposed-code-changes/{all-changes.diff, code-and-sql-only.diff, COMMITS.txt, CHANGED_FILES.txt}.
- `CLAUDE.md`, `docs/AUTH_EMAILS.md`, `supabase/auth-templates/*.html`.

## 1. Phase A — bring in the audit work (the branch was never pushed)

The audit ran with read-only GitHub access, so its 129 commits exist only as the two diffs.
`all-changes.diff` applies cleanly to `origin/main` 88a6473 with
`git apply --exclude='.fuse_hidden*' review/gestaltung-audit-reports-2026-10/proposed-code-changes/all-changes.diff`
(verified 2026-10-24). It EXCLUDES `docs/**` and `package-lock.json`.

1. Apply the diff on your branch as ONE commit "Apply audit 2026-10 proposed changes (see
   review/…/COMMITS.txt)". Then `git rm --cached` the `.fuse_hidden*` file if present.
2. Repair what the diff cannot carry:
   - The slimmed `CLAUDE.md` refers to `docs/history/*` and `docs/audit/*` that do not exist.
     Recreate `docs/history/CLAUDE-2026-10-full.md` from the pre-apply CLAUDE.md (`git show
     origin/main:CLAUDE.md`) so no decision or owner rule is lost, and copy the audit reports
     into `docs/audit/`. Root files the diff deletes (FINDINGS.md, SECURITY_REVIEW.md,
     STAGE_*.md, FIX_ALL_PROMPT.md…) go to `docs/history/` instead of disappearing.
   - `package.json` changed but the lockfile did not: run `npm install` so the lockfile matches
     (this also brings next 15.5.28 and sharp 0.35.5 as the audit intended). Commit the lockfile.
3. Re-verify everything the audit said passes: tsc, lint, vitest (expect ≈3,855), parity
   (5,241/5,241), `check:cycles`, build with the same static/ISR flags as `origin/main`.
4. **Re-review before you keep them (opus subagent, fresh eyes, one per item):**
   - `supabase/migrations/0102_credits_server_spend.sql`: `spend_credit_for` is a hand copy of the
     live `spend_credit` (0096 v4). Diff it line by line against the body in 0096. Any
     difference = fix or report.
   - `0103_guards_and_grants.sql`: seven function bodies were copied from older migrations
     (`engineering_job_refund_internal`, `claim_guest_work`, `claim_project`,
     `set_order_payment_method`, `refresh_part_sourcing` [on top of 0098], `offer_landed_cost_qar`,
     `project_recovery_begin`). Diff each against the latest migration that defines it. Confirm
     no non-admin code path calls `refresh_part_sourcing` / `offer_landed_cost_qar` directly
     (they now raise for non-admins). Raise the 100-line order cap to 300 and exempt class orders
     (`class_id is not null`) — that is my decision on DB-10c.
   - `0105_parts_cost_private.sql`: grep every `select('*')`, `parts(*)` embed and
     `insert().select()` on `parts` in app/lib/components; each must list columns or run as
     service role. Add a vitest that greps for `from("parts")` + `select("*")`.
   - `0100_studio_private.sql`: the strip of `engineering_jobs.snapshot` is irreversible — add a
     backup table `engineering_jobs_snapshot_backup_2026_10` written first in the same migration.
   - The 90 deleted message keys: grep the branch for dynamic construction
     (`t(\`…${`, `cat${n}`, `group_${`, `need_scope`, `filterStock`, `notifyMe`, `StoreLanding.cat`).
     Restore any key that is still built at runtime.
   - `lib/auth/next-path.ts callbackNextPath()`: it now returns "/" for any `next` that is not
     `/{en|ar}/…`. Confirm the live auth templates and `forgot-password-form.tsx` produce exactly
     `/{locale}/reset-password` (Phase C replaces this flow anyway, but it must not break in
     between).
   - Service-role dependency: many routes now answer 503 without `SUPABASE_SERVICE_ROLE_KEY`.
     Add a startup check (`lib/env.ts` or the existing place) that logs ONE clear warning naming
     the env var, and a line in the final report telling me to confirm it is set in all three
     Vercel environments.
5. Do NOT act on the audit's "Needs owner decision" items (O1 v1 pages/site_v2, O2 Engineer view,
   O3–O5/O15 legacy tables, AI-02 model-before-unlock, service-payment auto-approval, teacher
   verification, Turnstile switch, CSP enforce, HSTS preload). Carry them into your final report
   with the auditor's recommendation and your own one-line view.

## 2. Phase B — fix the QA findings (REPORT.md section 4 table)

Treat `review/qa/REPORT.md` as the spec. For each finding below, fix it, add or extend a test
where logic is involved, and reference the F-id in the commit message. Where I have made a
decision it is stated; otherwise use the tester's suggested fix.

**Money, pricing and trust (do first)**
- F-002 CAD credit cost: the Enclosure "Draw it" button charges 2 credits while /pricing, home
  and the FAQ promise 1 credit = up to 3 versions. DECISION: the published price is the
  contract (Qatar consumer-protection: the price shown must be the price charged). Charge
  exactly what /pricing says; find where the 2 comes from (`cad_regens_remaining`, Studio unlock
  vs enclosure path) and make ONE constant drive the button label, the spend and the pricing
  page. Test it.
- F-001 Terms §3b "through partners / عبر شركاء" and §3d "free planning tool": edit
  `LEGAL_PAGES_DRAFT.md` (EN + AR) to "in our Lusail studio; larger CNC or sheet-metal jobs are
  quoted case by case" and "a planning tool (the parts list is free; wiring diagrams and 3D
  models cost credits)", plus §7 فوري → فوران and the §13 credit-expiry sentence from the
  report's Arabic table. Regenerate with `scripts/split-legal-draft.mjs`; `--check` must pass.
  Bump "Last updated".
- F-008 / F-023 Ideation tokens: a second currency that only /pricing explains, and the counter
  shows 0 while a reply is pending. DECISION: keep tokens for now, but (a) explain them in one
  sentence on home ("Plan a product" card), on the Idea step next to the counter, and in the
  pricing FAQ; (b) never deduct optimistically — show the old value or "…" until the server
  answers. Add a short "How tokens and credits work" block to /pricing#credits in EN + AR.
- F-014 Delivery tiers: when two tiers cost the same, show only the faster one at checkout
  (Standard disappears when Express is QAR 50 too). Keep the data model; this is display logic
  in `lib/store/checkout-totals.ts` / the tier cards, unit-tested.
- F-015 Cart "This is your final price" under a subtotal without delivery: change the cart line
  to "Final price shown at checkout" / "السعر النهائي يظهر عند إتمام الطلب" and keep the binding
  line only on checkout.
- F-017 Three meanings of "confirm": initial order status label becomes "Received" / "تم
  الاستلام" (label only — do NOT rename the DB status), the success-page button becomes "Message
  us on WhatsApp", the sentence stays "We confirm your order within one working day".
- F-016 Checkout for a signed-in user prefills name/phone/email from `profiles` (the Get-it-made
  dialog already does this — reuse it).
- F-013 Delivery-time filter: filter on the computed arrival date, not the lead class, so
  "3–5 days" never shows "Arrives by" dates two weeks out.

**Design Studio engineering output (opus subagents; these are rules, not prompts)**
- F-006 "Add all to cart" added 3 of 7 stocked lines: a deterministic bug. Trace
  `kitPlan` → `addKit`/`addAll` → `cart_items` insert for the Studio Parts step; helper parts
  ("Added for you") and pack items were dropped. Fix, and show a toast "Added N parts · M we'll
  source" so the count is visible. Regression test with the tester's 9-part plant-waterer list.
- F-007 + F-052 Wiring: the IRF520 low-side MOSFET module was wired "OUT → Pump +, Pump − →
  GND". Model low-side switch modules as a two-terminal load path (V+ → load → V−/OUT) in
  `lib/studio/netlist.ts` / `buildWiring` and add a hard rule in `hardRules()` that a load on a
  low-side switch never has its return on GND directly. Add the back-feed caution line (USB +
  booster on the 5 V rail) to "What we checked". Fixtures + tests.
- F-010 Code: `soilValue < 600` = dry is inverted for capacitive sensors. In
  `lib/prototyping/firmware.ts` / `/api/studio/firmware` give the model per-part calibration
  facts from the library (capacitive soil sensor: higher = drier, with a typical wet/dry range)
  and re-insert them as constants in the pin block; require a max-run safety guard for pumps,
  heaters and motors (e.g. no more than N seconds per hour) and implement any spec feature
  (tank-empty LED) or state in a comment that it needs a part that is not in the list.
- F-011 / F-012 Spec ↔ parts: every "Includes" line on the understanding card must map to at
  least one part before the Parts step is marked complete (add to readiness); the model must not
  add features the brief did not mention — put a guard in `spec-guards.ts` that drops new
  `features` absent from the user's text unless the user confirmed them in chat.
- F-046 Prefer in-stock SKUs when a stocked equivalent exists (18650 over an unstocked LiPo);
  say why when it cannot.
- F-003 / F-004 / F-005 / F-027 Enclosure + STL export (the biggest engineering gap):
  * STLs must be watertight single shells: boolean-union the CSG result per body before export
    and run a manifold check; refuse to offer a download that fails and show "we could not
    close this model" instead. Fixture test on the plant-waterer design: `is_watertight`,
    one body per part, consistent winding.
  * Size: the lid came out Ø190 mm for a "palm-sized" device. Find the scale/unit error or the
    envelope rule in `lib/studio/product/solve.ts` / enclosure templates; cap the outer size to
    the packed parts envelope + margins and assert it in tests (plant waterer < 120 mm).
  * Weight: ONE function computes grams from mesh volume × material density, used by the Print
    step, the Request page and the quote estimate (today three different numbers: 118 / 50 /
    327 g).
  * Cut-outs: every port/connector/sensor the solver places on a face gets an opening; the soil
    spike/stake named in "Why this shape" must be exported; battery clip geometry follows the
    battery type (flat LiPo ≠ cylindrical cell); "×2" parts must be identical or listed as two
    parts.
  * Print plate: lay out within 250 × 210 mm (Prusa MK4) or split into several plates.
  * F-042: say plainly on the Print step that STEP comes from the engineer quote (or offer it if
    the cloud CAD path can).
- F-009 Enclosure pictures "could not draw": check the network/API response first (quota, key,
  image model). Whatever the cause, the UI must show the reason and a Retry button and fall back
  to the worker-rendered 3D preview instead of an empty grey box.
- F-024 AI waits of 25–100 s with only "Thinking…": staged progress text per step
  (reading → parts → checking…) and a "usually 30–60 s" hint, EN + AR.
- F-026 Missing key `Studio.cat_logic` (EN) — add, and add a test that renders every Studio
  category label in both locales.
- F-039, F-040, F-041, F-043, F-044, F-045, F-048: as the tester suggests (pin-list highlight,
  real net names in the schematic, bind the Try-it threshold, parts count/status on project
  cards, estimate inside the Get-it-made dialog, "Arduino Nano" not the FQBN, clear the chat
  input on send).
- F-025 Guest project after cleared site data: detect the missing guest token and show "This
  design was saved in another browser. Sign in to find it, or start again" instead of "Try again".
- F-028 Idea step promises questions it never asks: either ask 1–2 real ones or change the copy.

**Store, content, Arabic, accessibility, performance (sonnet/haiku)**
- F-018 supplier-pasted product text: add a `translate_details`-style admin step "Clean
  description" that rewrites the top 50 best-selling descriptions into plain English (Gemini,
  metered, super_admin button — never run it yourself) and strips supplier links/emoticons; show
  "Datasheet" only when `datasheet_url` exists.
- F-019 /ar product pages "not translated yet": run the existing translate step from the
  dashboard is the owner's job — but make the specs TABLE render from the English specs with
  Arabic headings when `specs_ar` is empty, instead of hiding it.
- F-020 "You may also need" nonsense (HDMI for a DC jack): require same store category or a
  real co-purchase; hide the block when nothing qualifies.
- F-021 / F-022 / F-051 Quote + drawing pages (AR): reference number + file name on the success
  screen and in the email; the drawing page describes the on-site form and keeps WhatsApp as the
  alternative; no prices inside the method `<select>`; hide the "My projects" breadcrumb for guests.
- F-029 / F-030 / F-032 / F-034 / F-033 Accessibility: accessible names on card image links, the
  Google button, step buttons and the consent checkbox; "Skip to content" link; 404 page title.
  Add an axe-core check in e2e for home, store, product, checkout, Studio fixture (EN + AR).
- F-031 Sign-up: minimum 8 characters + one line "By creating an account you agree to the Terms
  and Privacy policy" with links (EN + AR).
- F-035 Arabic typography: under `html[dir=rtl]` / `:lang(ar)` the font stack starts with IBM
  Plex Sans Arabic, including form labels, eyebrows, chat bubbles and buttons.
- F-036 / F-050 wording: apply the report's Arabic table (credits sentence, §13); fix the English
  pricing FAQ "Do credits expire?" so it says the same thing as Terms §13.
- F-037 / F-049 / F-053 / F-054: three.js only loads in the Studio, fix the one 404 asset on
  /projects/new, retry once on a 409 from `PUT /api/studio/doc`, prefetch product cards on hover
  only, eager-load the first 3 cart thumbnails, inline critical CSS on home. Measure First Load
  JS before/after and report it.
- F-038 fade-up at opacity 0 in background tabs: start visible, animate with IntersectionObserver.
- F-047 (Info): when the user writes Arabic in the EN Studio, answer in Arabic.

Skip nothing from F-001 to F-054 without a line in the final report saying why.

## 3. Phase C — password reset and email confirmation: make it fast, reliable, simple

**The complaint:** a user requests a reset, the email arrives late, and when the link is clicked
it is already expired. The screenshot I have is a reset sent to a `@qu.edu.qa` mailbox whose
subject was rewritten to "[EXTERNAL]…", i.e. a Microsoft 365 tenant with link scanning.

**Root causes (confirmed in the code, fix all of them):**
1. The email link is Supabase's `…/auth/v1/verify?token=pkce_…&type=recovery&redirect_to=…`
   (template uses `{{ .ConfirmationURL }}`). It is single-use and is consumed by the FIRST GET.
   Corporate/university mail scanners (Safe Links, Mimecast, Proofpoint) pre-fetch links on
   arrival, so by the time the human clicks, the token is spent → our callback bounces to
   `/forgot-password?expired=1`. Any prefetching mail client does the same.
2. PKCE: the code verifier lives in a cookie of the browser that requested the reset. Opening
   the email on a phone, in another browser or in an in-app browser fails with "expired"
   (`hasVerifierCookie` in `app/api/auth/callback/route.ts`).
3. The default Supabase OTP expiry is 1 hour and university gateways can delay external mail
   by many minutes; together with (1) and (2) the window is too tight.
4. The UI never tells the user how long the link is valid, which inbox it went to, to check
   spam, or how to get a new one quickly.

**Target design (standard practice; implement exactly this):**
- Templates switch from `{{ .ConfirmationURL }}` to a link into OUR site that carries the
  token hash and preserves the language:
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` for reset (the app passes
  `redirectTo = {origin}/{locale}/reset-password`), and the same pattern with `type=signup`
  (→ `/{locale}/confirm-email`) and `type=email_change` for the other two templates. The app sets
  `emailRedirectTo` on sign-up and `updateUser` so `{{ .RedirectTo }}` is always a locale path.
- **The landing page does NOT verify on GET.** `/{locale}/reset-password?token_hash=…` renders
  the new-password form (server component, `force-dynamic`, `noindex`) with the hash in a
  hidden field. Verification happens only on submit: a server action calls
  `supabase.auth.verifyOtp({ type: 'recovery', token_hash })` and then `updateUser({ password })`
  in one request, then signs out and shows "Password updated — sign in". Scanners and
  prefetchers can no longer spend the token; no PKCE cookie is needed, so any device works.
  `/{locale}/confirm-email` shows one button "Confirm my email" that does the same with
  `type: 'signup'`, then redirects to `/{locale}` (or `?next=`), signed in.
- **Fallback code:** the email also prints the 6-digit `{{ .Token }}` ("or enter this code").
  The reset page has a second path: email + code → `verifyOtp({ email, token, type:'recovery' })`
  → same password form. The forgot-password "sent" screen links to it ("Have the code?").
- **Forgot-password UX:** after sending, show "We sent a link and a code to <email>. It can take
  a few minutes; check Spam/Junk. The link is valid for 1 hour." with a Resend button enabled
  after 60 s, the email prefilled, and a WhatsApp link for help. `?expired=1` shows the same
  screen with "That link was already used or has expired — request a new one" and the email
  prefilled when known. Everything EN + AR (Western digits in AR).
- **Email look:** keep the bilingual template but make it cleaner: one card, English then Arabic,
  one button each, the 6-digit code in a large monospace box, one short "or copy this link" line
  (our short URL, not the long Supabase one), validity line, footer. Plain email HTML only
  (tables, inline styles). Update `supabase/auth-templates/{reset-password,confirm-signup,
  change-email,magic-link}.html` and the subjects. Test-render with a tiny script to PNG and
  include the renders in the report (EN/AR, 600 px and 360 px wide).
- Keep `/api/auth/callback` for social sign-in; it may keep accepting `code` and `token_hash` for
  compatibility with old emails for 7 days, then I will remove the token_hash GET path (note it
  in the report as a follow-up).
- Supabase dashboard settings I must apply (cannot be scripted; write them into
  `docs/AUTH_EMAILS.md` as a numbered checklist): Authentication → Emails → templates +
  subjects; URL Configuration → add `https://gestaltung360.com/en/reset-password`,
  `/ar/reset-password`, `/en/confirm-email`, `/ar/confirm-email` (+ www and localhost);
  Authentication → Email → "OTP expiration" set to 3 hours (10800 s); confirm Custom SMTP is
  Resend (`smtp.resend.com:465`, sender `noreply@contact.gestaltung360.com`) and the Supabase
  email rate limit is ≥ 30/hour; Attack Protection → CAPTCHA state. Also tell me how to read the
  delivery latency in Resend → Emails for the `qu.edu.qa` recipient.
- Tests: unit tests for the token-hash parsing and the code path; e2e (fixtures, write guard
  on): reset page renders the form on GET without any auth call (assert no request to
  `/auth/v1/verify` or `/auth/v1/otp` happens before submit), the expired message, the resend
  countdown, EN + AR at 375 and 1366 px.

## 4. Phase D — verification and report

- All checks green (tsc, lint, vitest, parity, build, `check:cycles`, `split-legal-draft --check`,
  e2e). Compare the build route table and First Load JS with `origin/main`.
- Click through locally (`npm run build && npm run start`, fixtures on): home, store, product,
  cart, checkout tiers, Studio fixture (Parts add-all, Wiring pin list, Enclosure, Print), the
  new reset and confirm-email pages, EN + AR, 375 + 1366 px. Screenshots into `review/fixes/`.
- `docs/audit/FIX_REPORT.md`: (1) summary; (2) table of every F-id and audit finding → status
  (fixed / partial / skipped-why / needs owner) + commit; (3) every intentional behaviour change;
  (4) migrations to run in order (0098 if not yet, 0100–0105 as re-reviewed, then yours) with
  the check query for each and the smoke test after each; (5) Supabase dashboard checklist for
  auth emails; (6) "Needs owner decision" list with recommendations; (7) what I must do in the
  dashboard afterwards (clean descriptions, translate, cleanup list below); (8) next steps.
- Update CLAUDE.md (short section + pending migrations) and give me the branch name and the
  commit list in the final message.

## 5. Cleanup I will do myself (do not touch the database)
Order 3a939b38 "TEST QA — please cancel" (cancel); project 719b2ec2 "TEST QA — Balcony Plant
Waterer" + its Get-it-made request; guest project 6cc3bf2f "Auto Desk Lamp"; drawing request
bc67437f; the quote request and contact message named "TEST QA — please ignore" (22 Oct).
