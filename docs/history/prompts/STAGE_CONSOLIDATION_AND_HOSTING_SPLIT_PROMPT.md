# Stage: consolidation + hosting split (owner, 2026-11-02)

Why this stage exists: the site has no traffic yet Vercel usage is high, and the codebase has grown
by vibe coding into something hard to keep. Before any new Studio feature (verified wiring, real CAD
kernel, order pipeline, tiers, versioning) the code gets smaller, one source of truth, a CI that
guards main, and the heavy work moves off Vercel onto the owner's Mac Mini. Nothing in this stage is
customer-facing. No new product features.

Paste everything below into Claude Code opened in the repo (`mworkqu/gestaltung`).

---

```
Use delegation defaults. Read CLAUDE.md (the 321-line index on origin/main), docs/DECISIONS.md,
docs/MIGRATIONS.md, docs/ENVIRONMENT.md, docs/audit/SECURITY_AUDIT.md §6 (owner decisions O1–O15),
docs/CAD_CLOUD.md, docs/cad-champions/DEPLOY.md, vercel.json, next.config.mjs, middleware.ts,
lib/site-v2.ts, lib/cache/storefront.ts, app/[locale]/store/[sku]/page.tsx, app/sitemap.ts,
lib/seo.ts (robotsRules), services/cad-worker/README.md, grader/ (README), .github/workflows/.

## 0. Working rules

1. Branch `consolidation-2026-11` from origin/main. Commit per step, small and green:
   `npx tsc --noEmit`, `npm run lint`, `npm run test`, `node scripts/check-i18n-parity.mjs`,
   `npm run check:cycles`, `npm run build`, then `npm run test:e2e` at the end of each phase.
   Never push to main, never merge to main, never deploy, no `[deploy]` in commit messages. The owner
   reviews and merges.
2. `.env.local` is PRODUCTION. Never run a migration, never write to the database, never call a
   paid API from a script, never print a secret.
3. Migrations: never edit an existing one. New SQL = new files numbered after the highest in
   `supabase/migrations/` (re-check `ls supabase/migrations` right before each commit: a parallel
   session can take a number). Each idempotent, rollback block in the header, PGlite test. List every
   new migration in docs/MIGRATIONS.md as NOT RUN and tell the owner the run order; never stop to wait.
4. No paid services, no subscriptions, no new cloud accounts. Free tiers only, and say which.
5. Behaviour stays the same except where this prompt says "delete" or "change". Every behaviour
   change goes in the final report.
6. Storefront pages stay static/ISR. `revalidateStorefront()` after store writes. EN/AR parity.
   `content/legal/**` is generated (edit LEGAL_PAGES_DRAFT.md). Never promise reprints, partner
   workshops or automatic method detection.
7. Stop and ask ONLY at the two gates marked [GATE]. Everything else: decide, do, report.

## 1. Phase 0 — one branch again

The `cad-champions` branch (CAD Champions platform + school classes 0096/0097, 31 commits) was never
merged; main moved on by 77 commits (audit + QA fixes, migrations 0098–0106). Two branches means two
truths.

0.1 Rebase or merge `cad-champions` onto origin/main in a temp worktree. Resolve conflicts in favour
    of main's shared primitives (lib/auth/guards.ts, lib/http.ts, lib/format/*, lib/locale.ts) and
    cad-champions' own files. Migration numbers: cad-champions' 0096/0097 keep their numbers only if
    main has no 0096/0097; otherwise renumber to the next free numbers and update docs/MIGRATIONS.md.
0.2 Run the full check list + `npm run test:cc` + `npm run test:e2e`.
0.3 [GATE] Show the owner: conflict list, renumbered migrations, test totals. Wait for "merge".
    Then merge the result into `consolidation-2026-11` (NOT into main). From here on there is one
    branch; the owner deletes `cad-champions` after the final merge.

## 2. Phase 1 — delete what is dead (owner decisions O1–O5, now decided)

Every deletion: one commit, `knip` + grep prove nothing references it, message keys removed with
`scripts/check-i18n-parity.mjs` green, e2e specs for the deleted thing removed too.

1.1 O1 — v1 public pages + site_v2 flag. site_v2 has been ON since 2026-10-09. The v2 pages become the
    only pages: move app/[locale]/v2/{page,how-it-works,design,store} to their public paths, delete
    the v1 versions, delete lib/site-v2.ts, the middleware branch, app/api/admin/site-v2-preview, the
    next.config.mjs rewrites that only served the flag, e2e/site-v2-flag.spec.ts, and migration
    columns are left alone (store_settings.site_v2 row: new migration deletes the row, idempotent).
1.2 O3 — legacy workshop inventory. Delete app/[locale]/inventory/** (the tenant inventory), its
    components, actions, nav link, messages and the admin Overview/Inventory tenant widgets. Customer
    "My inventory" (app/[locale]/my-inventory, lib/inventory client) STAYS. New migration drops
    `inventory_items`, `job_bom` if still present, and the tenant helpers only if nothing else calls
    them (grep the migrations; `profiles.tenant_id` stays, nullable, untouched).
1.3 O4 — jobs. The jobs pipeline was retired; the redirects in next.config.mjs stay (cheap, keep old
    links alive). New migration drops jobs, job_files, job_events, job_variations and their storage
    policies if the tables still exist (check with `\d` equivalents in the PGlite test).
1.4 O5 — drop `project_claims` if docs/audit lists it as unused; otherwise leave and say why.
1.5 O2 — the super_admin "Engineer view" of a Studio product (49 files): KEEP. It is the owner's own
    review tool. Do not touch.
1.6 Root clutter: every `STAGE_*_PROMPT.md`, `Gestaltung_Build_Plan.md`, `_plan_extracted.txt`,
    `tsconfig.tmp.*`, `playwright-report/`, `test-results/`, `prototypes/` (if unused by any route),
    `qa/` → docs/history/prompts or docs/history/qa, or .gitignore. The repo root holds config,
    README, CLAUDE.md and folders only.
1.7 Report the line count removed per item (expected: about 12,000 lines and about 750 keys).

## 3. Phase 2 — Vercel diet (what burns usage with zero visitors)

Facts measured 2026-11-02: 165 pages, 66 API routes, 178 force-dynamic pages, 7 ISR pages, product
pages NOT pre-rendered (generateStaticParams returns []), 2 supplier crons purge the "parts" tag daily
so every crawler visit re-renders up to 2,600 product pages, 6 daily crons (two at 300 s), a build on
every push (45 deployments 16–26 Oct, 17 cancelled previews), Fluid compute on, region iad1.

2.1 Builds. Add `ignoreCommand` in vercel.json: build only when the branch is `main` (exit 0 for
    everything else). This replaces the dashboard "Ignored Build Step" rule that today builds previews
    for commits containing [deploy]; tell the owner to clear that setting. Previews are gone; the
    owner tests locally or on the Mac Mini (Phase 3). Document in docs/ENVIRONMENT.md. Keep
    scripts/vercel-prune.ps1 and its rule.
2.2 Product pages. Stop the daily full purge: `revalidateStorefront()` is called by the two supplier
    crons only when at least one price/stock/offer row actually changed, and then per-SKU tags
    (`part:<sku>`) for the changed products plus "parts" only when the listing set changed (new or
    dropped SKUs). unstable_cache keys in lib/store/public-catalog.ts get per-SKU tags. Test it.
2.3 Crawlers. robotsRules(): disallow `/*/store?*` (query listings), `/*/store/search`, `/api/`,
    `/*/dashboard`, `/*/projects`, `/*/orders`, `/*/my-inventory`, `/cad-champions/*/admin`; keep the
    sitemap. Sitemap: `lastmod` from parts.updated_at so crawlers skip unchanged pages. Search route:
    cap `q` length (64) and page (20), 400 beyond.
2.4 force-dynamic audit. For each of the 178 pages: auth-gated pages stay dynamic; any PUBLIC page
    that is force-dynamic only because it reads store_settings or a flag becomes static/ISR with
    unstable_cache. Target: public pages 100 % static/ISR. List before/after in the report.
2.5 Middleware. Keep the matcher. Remove the site_v2 fetch (gone in 1.1). Confirm anonymous requests
    make zero network calls in middleware (test with a unit test on the edge function).
2.6 Crons. All six vercel.json crons are deleted from vercel.json in Phase 3 once the worker runs
    them. Until then leave them.
2.7 Measure: `npm run build` route table (static / ISR / dynamic counts) before and after, First Load
    JS of /, /store, /store/[sku], /projects/[id]/studio unchanged or lower.

## 4. Phase 3 — the worker on the Mac Mini

Goal: Vercel = thin public site + light CRUD + auth. Mac Mini = everything slow, scheduled or
compute-heavy, as ONE service, reached over a free tunnel, so Google Cloud Run (cad-worker, grader)
can be retired.

3.1 Layout (same repo, no new repo):
      services/worker/            Node 24 + TypeScript, Fastify or plain http, Dockerfile
      services/cad-worker/        existing Python CadQuery service (unchanged code)
      grader/                     existing Python grader (unchanged code)
      services/compose.yaml       docker compose: worker, cad-worker, grader; cad-worker and grader
                                  are reachable only from the worker (internal network)
    The worker imports `lib/**` directly (tsconfig path alias, esbuild bundle); no copy of business
    logic. If a lib module imports `next/*` or `server-only`, split the pure part out (that is the
    R11 layering rule; do it only for modules the worker needs).
3.2 What moves to the worker, exposed as `POST /jobs/<name>` with a shared bearer secret
    (`WORKER_SECRET`) checked on every call, plus `GET /healthz`:
      - the six crons (node-cron inside the worker, same schedules, Asia/Qatar): supplier-refresh,
        voltaat-sync, delivery-promises, notifications, anonymous-cleanup, youtube-retire; plus the
        two unscheduled cad-champions crons (cc-payments-expire, cc-weekly-progress).
      - the long AI routes: analyse, bom/electronics, brief-chat, cad, firmware, netlist, project-cad,
        projects/name, transcribe, studio/{spec,mech,enclosure,firmware,pick,wiring,product/design,
        product/check}.
      - the heavy admin jobs: drive-import, sourcing-backup, starter-parts, store-cleanup,
        voltaat-import, voltaat-sync, youtube/upload (sharp moves with them: `sharp-admin` becomes a
        worker-only dependency, and the SHARP_ROUTES block in next.config.mjs goes away).
      - cad-champions grading calls (attempts status) and the CadQuery build calls (lib/cad/cloud.ts
        → worker → cad-worker container). GCP_CAD_URL/WIF env vars and docs/CAD_CLOUD.md's Cloud Run
        section are replaced by WORKER_URL; the gcloud scripts move to docs/history.
3.3 How Vercel talks to it. The Next route handlers stay as thin proxies ONLY where the browser must
    not know the worker (admin jobs, crons triggered by hand). For the long AI routes the browser
    calls the worker directly: Vercel mints a short-lived token (`/api/worker-token`, Supabase
    session → 10-minute HS256 JWT signed with WORKER_SECRET, carrying user id, project id, tier,
    is_admin), the worker verifies it, does the AI/credit work with the service-role key exactly as
    the route does today (same lib functions, same credit checks, same ai_usage rows), and streams
    the answer. Credits are still spent server-side in the worker, never trusted from the token.
    CORS on the worker: only https://gestaltung360.com and localhost.
3.4 Tunnel: Tailscale Funnel (free personal plan, stable `<host>.ts.net` URL, HTTPS included, no DNS
    change). Document the alternative (Cloudflare Tunnel) in one paragraph; do not set it up.
3.5 Fallback. `store_settings.worker = {"enabled": false}`. While false (and whenever the worker's
    healthz fails twice in 60 s, cached per instance), every proxied route runs the old in-Vercel code
    path and the browser calls the old route. Nothing is deleted from Vercel until the owner flips the
    switch and one week of healthz is green; then the old code paths are removed in a follow-up
    commit on this branch (marked "after cutover" in the report), and the crons leave vercel.json.
3.6 Mac Mini runbook docs/WORKER.md: install Docker Desktop and Tailscale (free), `docker compose up
    -d`, Funnel command, env file list (service-role key, WORKER_SECRET, AI keys, YouTube, Resend),
    disable sleep, auto-start on boot, log rotation, how to update (git pull + compose build), how to
    check healthz, what breaks if the Mac is off (AI steps and crons pause; the public site, store,
    checkout, auth keep working). Vercel env vars to add: WORKER_URL, WORKER_SECRET.
3.7 [GATE] Before anything is installed on the Mac Mini: show the owner the runbook and the env list.
    The owner installs; you verify with `curl healthz` from here. Then the owner flips the switch.

## 5. Phase 4 — guard main

4.1 .github/workflows/main.yml: on push and PR to main: lint, typecheck, i18n parity, check:cycles,
    vitest, build with dummy Supabase, Playwright `e2e/` (root suite, write-guarded) and
    `e2e/cad-champions`, worker unit tests, cad-worker + grader pytest. Cache npm and Playwright.
    Fold cad-champions.yml into it.
4.2 Database type: generate `lib/supabase/database.types.ts` from the migrations with a local
    Postgres in CI (or PGlite + `supabase gen types` if feasible) and type the four Supabase client
    factories; remove the remaining `as unknown as` casts (54). Add a CI step that fails when the
    generated file is stale.
4.3 `loading.tsx` + `error.tsx` for /dashboard, /projects, /orders, /cad-champions/*/admin.
4.4 Remaining audit slices R11 (hooks out of lib/, no inline Supabase queries in components) and R12
    (one error shape per route) where Phase 3 has not already forced them.
4.5 Ratchet: the eslint complexity/max-lines warnings count must not grow (CI compares to a number
    in `lint-ratchet.json`; lower it whenever it drops).

## 6. Phase 5 — docs and report

5.1 CLAUDE.md stays an index ≤ 320 lines: update the architecture map (Vercel vs worker), commands,
    pending migrations, the hosting rules (ignoreCommand, per-SKU tags, robots), and point to
    docs/WORKER.md. docs/DECISIONS.md gets O1–O5 as decided here, plus "worker on the Mac Mini,
    Tailscale Funnel, Cloud Run retired".
5.2 Final report docs/history/2026-11-consolidation.md: deletions (lines, keys, tables), Vercel diet
    numbers (static/ISR/dynamic counts, crons, builds), worker inventory (which routes moved, which
    stayed and why), behaviour changes, migrations to run (order), owner actions (Mac Mini install,
    Vercel env vars, switch flip, delete the cad-champions branch, retire Cloud Run after one green
    week), and what is still open from the audit.
5.3 Hand back: the branch name, the merge order, and a 10-minute live test for the owner after merge.
```

---

Owner decisions taken in this prompt (change them before pasting if wrong):
- O1 delete v1 + flag · O2 keep Engineer view · O3 drop tenant inventory · O4 drop jobs tables, keep
  redirects · O5 drop project_claims if unused.
- Previews off entirely (build only main).
- Worker = Node service in the same repo on the Mac Mini, Tailscale Funnel, Cloud Run retired after one
  green week. Browser calls the worker directly for long AI steps.
- Two gates only: the cad-champions merge, and the Mac Mini install.
