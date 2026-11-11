# Full code read, security audit and professional clean-up — Gestaltung repo

Copy everything below this line into a new Claude Code session opened in the project folder
(the folder that contains package.json and .git).

---

## 1. Your role and goal

You are a principal software engineer and application-security reviewer. This codebase
(Next.js 15 App Router + TypeScript + Tailwind + next-intl + Supabase Postgres/Auth/Storage,
deployed on Vercel, ~100 SQL migrations) was built over many months in small stages, with many
fixes on top of fixes. Some parts are now inconsistent, duplicated or more complex than they
need to be.

Your job, in this order:
1. **Read and understand the whole codebase** — every app route, component, lib module, API
   route, middleware, migration, script, test and config.
2. **Security audit** — find every real vulnerability and risky pattern, with evidence.
3. **Code-quality audit** — find dead code, duplication, over-complex code, wrong layering,
   inconsistent patterns, weak typing and missing tests.
4. **Fix the flaws** — security fixes first, then a careful, professional re-organisation so
   the code is clean, consistent and easy for a new engineer to work on.
5. **Prove nothing broke** and write a clear final report.

Quality bar: the result should look like it was written by one experienced team with one set
of conventions — not like 100 separate patches.

## 2. Read these first (they are the source of truth)

- `CLAUDE.md` (long — read all of it: stages, decisions, owner rules, permanent notes)
- `docs/ARCHITECTURE.md`, `DESIGN.md`, `SECURITY_REVIEW.md`, `SITE_AUDIT.md`, `FINDINGS.md`,
  `CHANGELOG-audit.md`, `docs/CUTOVER.md`, `docs/STUDIO_PRODUCT.md`, `docs/STUDIO_CAD.md`,
  `docs/cad-champions/SECURITY_REVIEW.md`
- `package.json`, `next.config.mjs`, `middleware.ts`, `vercel.json`, `eslint.config.mjs`,
  `tsconfig.json`, `playwright.config.ts`, `.github/workflows/*`
- every file in `supabase/migrations/` in number order (0001 → latest)

## 3. Hard rules (do not break these)

0. **Start from the live code.** Production deploys from `main`. First run `git status` and
   `git branch --show-current`. If there are uncommitted or untracked files (other than prompt
   files and `qa/`), STOP and list them for the owner — do not commit, stash or delete them.
   When the tree is clean, `git fetch origin` and create your branch from `origin/main`
   (not from `cad-champions` or any other branch). The `cad-champions` branch is a separate,
   not-yet-merged feature: leave it alone and audit only what is on `main`.
1. **Work on a new branch** `audit/code-and-security-2026-10`. Never push to `main`, never
   merge, never deploy, never run `vercel`. Commits only; the owner reviews and merges.
   Do not put `[deploy]` in commit messages.
2. **Production data is off-limits.** `.env.local` points at the PRODUCTION Supabase. Never run
   migrations, never write to the database, never call production APIs with writes, never call
   paid or AI APIs. Do not print, copy or commit any secret value from `.env*` files.
3. **Never edit a migration that already exists** (they are already applied). Any database fix
   goes in a NEW migration numbered after the highest existing one (check the folder; currently
   0097 is the latest, so start at 0098). Each new migration must be safe to re-run, include a
   rollback note in its header, and be listed in CLAUDE.md under "PENDING MIGRATIONS" as NOT RUN.
   Test SQL changes in PGlite the way `lib/schools/db/schools-migration.test.ts` does.
4. **Behaviour must stay the same** unless you are fixing a bug or a vulnerability. Every
   intentional behaviour change must be listed in the final report.
5. **Never hand-edit `content/legal/**`** (generated from `LEGAL_PAGES_DRAFT.md` by
   `scripts/split-legal-draft.mjs`). Never change the owner's wording in legal text.
6. **Keep these project rules** (from CLAUDE.md): public storefront pages stay static/ISR (no
   `cookies()` / `headers()` / force-dynamic on them; call `setRequestLocale`); any write to
   store tables calls `revalidateStorefront()`; English + Arabic messages stay in parity
   (`node scripts/check-i18n-parity.mjs`); new client components get their message namespace
   added to the right scope in `lib/i18n/scopes.ts`; no top-level `sharp` dependency (Vercel
   function size); expression-bodied `useEffect` is banned by lint; no new paid services.
7. **Do not delete user-facing features, routes or database objects on your own.** If something
   looks unused but a customer or admin could still reach it, list it under "Needs owner
   decision" with evidence instead of deleting it.
8. **Small, green commits.** Each commit does one thing and leaves `npm run typecheck` (or
   `npx tsc --noEmit`), `npm run lint`, `npm run test` and `npm run build` passing. Commit
   messages explain what and why.
9. Pin any new dev dependency to an exact version; do not add runtime dependencies unless they
   clearly reduce risk or code.

## 4. Phase 0 — Baseline and map (no code changes)

1. Run and record the baseline: typecheck, lint, `npm run test`, i18n parity, `npm run build`
   (save the route table and First Load JS sizes), `npm audit --omit=dev`, `npm outdated`.
   Note every check that already fails (for example `lib/notifications/kinds-sync.test.ts`
   currently fails because migration 0091 adds the `engineering_job_ready` kind without adding it
   to `OUTBOX_KINDS` / `NOTIFICATION_KINDS` — confirm and include it in the fixes).
2. Run analysis tools with `npx` (do not add them to package.json unless useful long-term):
   `knip` (unused files/exports/deps), `jscpd` (duplication), `madge --circular`
   (import cycles), ESLint with `complexity` / `max-lines-per-function` warnings, a count of
   `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, `console.log`, `TODO`.
3. Write `docs/audit/CODE_MAP.md`: every top-level area (store, checkout, orders, design/quote,
   projects, Studio, prototyping/engineer view, credits, CAD, dashboard/admin, sourcing &
   supplier sync, notifications/email, auth, CAD Champions, schools, i18n, SEO, analytics),
   with its routes, main files, tables, API routes, crons and env vars, plus a data-flow note for
   the money paths (cart → checkout → `create_part_order` → emails) and the AI paths.
4. Commit the docs.

## 5. Phase 1 — Security audit (write findings first, fix in Phase 3)

Go through EVERY item; for each, record file:line evidence, an exploit scenario, severity
(Critical / High / Medium / Low / Info) and the fix. Output `docs/audit/SECURITY_AUDIT.md`.

**Database & Supabase**
- Every table: RLS enabled? select/insert/update/delete policies correct for anon, guest
  (anonymous session), client, workshop, super_admin? Any table with RLS on but grants that leak
  columns (known: anon can read `parts.landed_cost_qar`, `expected_income_qar`, `income_pct`;
  owners can read `projects.studio.productPrivate` through PostgREST — propose column-level
  grants or a view).
- Every `SECURITY DEFINER` function: `search_path` pinned, caller checked, inputs validated,
  `EXECUTE` revoked from `public` and granted only to the right roles, no way to act on someone
  else's rows (orders, projects, credits, claims, class teams).
- Triggers that guard money/credits/status (status transitions, credit spend/grant, price
  experiment cohort, inquiries guard, profiles role/tenant guard): can a client bypass them?
- Storage buckets and policies (`cad-files`, `quote-uploads`, `project-images`,
  `product-images`, `videos`, `studio-models`): public vs private, path ownership, size and
  MIME limits, signed URL lifetimes.
- Credits & money: can anyone get credits, discounts, free delivery, kit discounts or a lower
  total by changing what the browser sends? Is every price recomputed on the server?

**Next.js / API**
- Every file under `app/api/**` and every server action: authentication, authorisation
  (role + ownership), input validation (zod), body size limits, rate limiting, error messages
  that leak internals, correct HTTP methods.
- Every use of the service-role client (`lib/supabase/service.ts`): is it only reached after a
  proper check? Could it be used to read/write another user's data?
- Cron routes: `CRON_SECRET` checked with a constant-time compare? Admin routes: role checked
  on the server, not only in the UI?
- Open redirects (`next`, `returnTo`, locale fields), SSRF (supplier/Google Sheet/image/Drive
  fetches — host allow-lists, redirects, timeouts, size caps), path traversal in storage paths.
- XSS: every `dangerouslySetInnerHTML` (SVG wiring/schematic/drawing renderers, markdown/legal
  renderers, JSON-LD) — is any user, AI or supplier text inserted without escaping? Email
  templates escaping. AI-generated code shown on screen.
- Tokens and secrets: HMAC tokens (order rating, unsubscribe, project recovery), OAuth state
  cookie, AES-GCM integration tokens, Google ID token/WIF flow, Turnstile verification,
  `NEXT_PUBLIC_*` variables that should not be public.
- Prompt-injection: can text from a user brief, a supplier page or a product description make
  the AI routes do something unsafe (write data, leak keys, bypass credits)?
- Security headers: CSP, `X-Frame-Options`/frame-ancestors, HSTS, Referrer-Policy,
  Permissions-Policy, cookies `Secure`/`HttpOnly`/`SameSite`.
- Middleware: locale + site_v2 + Supabase session logic — any path that skips auth by accident?
- Logging: personal data (phones, emails, briefs) or tokens written to logs.
- Dependencies: known CVEs, outdated major versions with security fixes (next, next-intl,
  supabase-js, three, etc.). Recommend upgrades; only apply ones that are low-risk and covered
  by tests.
- Re-check every open item in `SECURITY_REVIEW.md` and `docs/cad-champions/SECURITY_REVIEW.md`
  and mark it fixed / still open.

## 6. Phase 2 — Code-quality audit

Output `docs/audit/CODE_QUALITY_AUDIT.md` and `docs/audit/REFACTOR_PLAN.md`.

Look for and list, with file paths:
- **Dead or superseded code:** files/exports/messages/CSS nothing uses; old v1 pages kept after
  the site_v2 cut-over; retired features (old jobs/workshop dispatch UI, `project_claims`, the
  old prototyping stage rail and template drawings, the unused CSV price-list importer,
  AliExpress, store-landing leftovers, old redirects targets). Separate "safe to delete"
  (unreachable, no data) from "needs owner decision".
- **Duplication:** the same rule implemented twice (pricing, pack maths, delivery dates,
  phone formatting, Supabase clients, cart logic, BOM matching, email layouts, admin tables,
  forms). Each business rule must have ONE home.
- **Complexity hot spots:** the largest files and functions (e.g. Studio shell, BOM table,
  checkout client, prototyping workspace, matcher, admin pages). Propose splits by
  responsibility.
- **Layering:** pure business logic in `lib/` (tested, no React, no Supabase client), data access
  in clear server modules, UI in `components/`, routes thin. Find places where pages contain
  business rules, or components call the database directly in different ways.
- **Consistency:** naming, folder structure, error handling (one pattern for API errors and
  user-facing messages), loading/empty/error states, server vs client component boundaries,
  zod schemas vs hand-written checks, date/money/phone formatting helpers.
- **Types:** `any`, unsafe casts, Supabase types out of date with the migrations (regenerate the
  type file from the migrations if possible, or tighten `lib/supabase/types.ts`).
- **Tests:** important logic with no tests (money, credits, permissions, delivery dates, status
  transitions); flaky e2e tests.
- **Docs:** CLAUDE.md is now very long — propose a cleaner structure (keep it as the index, move
  stage history to `docs/history/`), but do not lose any decision or owner rule.

REFACTOR_PLAN.md: the target folder structure, the conventions you will apply, and an ordered
list of slices (each slice = one commit or a few), each with risk level and how it is verified.

## 7. Phase 3 — Fix security issues

- Fix every Critical and High finding, and every Medium that is cheap and safe.
- For each fix: add a test that fails before and passes after (unit, PGlite SQL test, or a
  route test). SQL fixes go in new migrations (rule 3).
- Use a separate reviewer (a fresh subagent that did not write the fix) to check each
  Critical/High fix and try to break it.
- Update `docs/audit/SECURITY_AUDIT.md` with the status of each finding.

## 8. Phase 4 — Professional re-organisation (refactor)

Apply REFACTOR_PLAN.md slice by slice:
- Delete the "safe to delete" dead code (with evidence in the commit message).
- Merge duplicated rules into one module and point every caller at it.
- Split oversized files/functions by responsibility; keep public interfaces stable.
- Make data access, error handling, forms and formatting follow one convention each.
- Tighten types; remove unnecessary casts and `any`.
- Keep folder names and imports consistent; fix import cycles.
- Add short comments only where the WHY is not obvious; remove stale comments.
- After every slice: typecheck, lint, unit tests, build. Run the Playwright suite
  (`npm run build && npm run test:e2e`, it has a write guard that blocks production writes) at
  least after every large slice and at the end. Compare First Load JS with the baseline; no page
  may get heavier without a reason.
- Stop and list under "Needs owner decision" anything that would change what a customer or
  admin sees or can do.

## 9. Phase 5 — Verification

- All checks green: typecheck, lint, `npm run test`, i18n parity, `npm run build`, e2e suite,
  `node scripts/split-legal-draft.mjs --check`.
- Run the app locally (`npm run build && npm run start`) and click through home, store,
  product, cart, Studio fixture pages (`/en/e2e-fixtures/studio?...` with `E2E_FIXTURES=1`), the
  dashboard fixture, EN and AR, 375 px and desktop. Note anything that differs from before.
- Compare the build route table with the baseline: every route that was static/ISR is still
  static/ISR.

## 10. Phase 6 — Final report

Write `docs/audit/FINAL_REPORT.md`:
1. Summary (what you found, what you fixed, what is left) — one page.
2. Security findings table: ID, severity, area, status (fixed / open / needs owner), commit.
3. Code-quality changes: before/after metrics (files, lines, duplication %, unused exports,
   `any` count, largest files, import cycles, test count, First Load JS per main route).
4. Every intentional behaviour change.
5. New migrations the owner must run, in order, with what each does and how to check it.
6. "Needs owner decision" list with a recommendation for each.
7. Recommended next steps (max 10), ordered by risk reduction.
Also update CLAUDE.md (short section for this audit, the new pending migrations, any new
conventions) and give the branch name and commit list in your final message.

## 11. Working method

- Use a task list; tick items as you go so progress is visible.
- You may use subagents for parallel, self-contained work. Split by model strength:
  opus for security review, deep debugging and risky refactors; sonnet for standard refactors,
  tests and documentation; haiku for mechanical edits, searches and format conversions. Keep
  orchestration, decisions and final review in the main session. Every subagent prompt must be
  self-contained (context, rules from section 3, expected output).
- Never guess: if you are not sure something is unused or safe, prove it (search, test) or put
  it in "Needs owner decision".
