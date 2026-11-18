# 2026-11 consolidation and hosting split: final report

Branch `consolidation-2026-11`, 66 commits on top of `origin/main`. Written 2026-11-11. Stage prompt: `docs/history/prompts/STAGE_CONSOLIDATION_AND_HOSTING_SPLIT_PROMPT.md`. Per-phase detail: `2026-11-consolidation-phase2.md`, `2026-11-consolidation-phase4.md`, `docs/WORKER.md`.

## 1. One-page summary

**State.** The branch is ready for your review. **The worker is off. Nothing is merged, pushed to `main`, or deployed.** The live site still runs the old code. Three migrations are already run in the database (0109, 0110, and 0107 was run and then put back; see section 7).

**What is done**
- `cad-champions` is merged into the main line (Phase 0).
- The old v1 pages and the `site_v2` flag are deleted. Workshop inventory, jobs tables and `project_claims` are retired (Phase 1). 3,025 lines deleted, 80 message keys removed.
- Vercel costs are cut: builds only for `main`, smaller cache purges after supplier syncs, crawlers kept away from private and search pages (Phase 2).
- The worker for the Mac Mini exists as code, with a runbook (Phase 3, part A). It is off.
- `main` is guarded: a CI workflow, generated database types, a lint warning limit, loading and error screens (Phase 4).
- Documentation is updated (this phase).

**What is not done**
- The Mac Mini install and worker part B (you postponed the Mac step on 2026-11-11). Google Cloud Run stays.
- "100 % of public pages static" was not reached (section 4 says why).
- The Supabase client types and the 140 `as unknown as` casts are unchanged.
- GitHub Actions has never run. The Docker images were never built.
- 19 studio e2e tests fail (known; listed in section 9).
- The product library with 3D model downloads is not built. It is the next project.

**What you must do**: the checklist in section 8. In short: open a pull request, merge, wait for the deploy, run migration 0107 then 0108, clear one Vercel setting, turn on branch protection.

## 2. Phase by phase

| Phase | Goal | Result | Key numbers | Not done |
|---|---|---|---|---|
| 0. Merge | Bring `cad-champions` onto the main line | Merged. Schools files kept main's audited version. The `sharp-admin` alias work is now on the main line. Two side commits cherry-picked ("Studio: one press of the designer costs 6 model calls, not 10"; "docs: migrations 0098 and 0100-0106 are run"). A lost note (build levels, ideation tokens, engineering, decisions of 2026-10-23) was recovered into `docs/DECISIONS.md`. The CAD Champions side button lost the word "free". | 31 commits merged, 33 conflicted files, migrations 0077-0087 came with it, no renumbering | Nothing |
| 1. Delete what is dead | Remove dead code and tables (O1-O5) | v1 pages and flag, tenant inventory, jobs tables, `project_claims` removed. Migrations 0107-0110 written. | 3,025 lines deleted, net about -1,840. 80 keys removed (5,328 to 5,248). Routes 261 to 253 | The prompt expected about 12,000 lines and 750 keys. That estimate counted the Engineer view (O2), which you keep. |
| 2. Vercel diet | Stop paying for builds, cache writes and crawlers | Main-only builds, per-SKU purges, robots rules, search caps, a test that anonymous requests make no network call in middleware | See section 4 | "100 % static": not met. 139 pages still render per request. |
| 3. Worker (part A) | Run slow and scheduled work on the Mac Mini | Worker service, eight jobs shared with Vercel, switch (default off) with fallback, `/api/internal/revalidate`, `/api/worker-token`, `services/compose.yaml`, `docs/WORKER.md`, migration 0111 | 75 files changed, about 4,800 lines added. 8 jobs. | Part B (section 5). Docker images never built (no Docker on the dev PC); `cad-worker` and `grader` never built for arm64. Mac install not done. |
| 4. Guard main | Make `main` hard to break | `main.yml` CI, `database.types.ts` generated from the migrations, lint ratchet, loading and error screens, hooks moved out of `lib/` (R11 part) | 37 files changed. Lint ratchet 304. 109 migrations apply to PGlite. | Typed Supabase factories (tried, reverted). R12 unchanged. CI never ran on GitHub. |
| 5. Documents | Index, decisions, report | `CLAUDE.md` 322 to 194 lines; decisions recorded; this report | | |

**Checks at the end of Phase 4:** typecheck clean; lint 0 errors, 304 warnings (equals the limit); vitest 416 files / 5,212 tests; i18n parity 5,253 / 5,253; no import cycles; build green; CAD Champions Playwright 72/72; full e2e 398 passed, 39 skipped, 19 failed (all in studio specs; 18 failed before this stage). Phase 5 changed only documents.

## 3. Deletions

| What | Number |
|---|---|
| Lines deleted in Phase 1 | 3,025 (net about -1,840 after the moved pages) |
| Message keys removed | 80 (5,328 to 5,248): 69 inventory, 10 from the v1 pages, 1 `DashboardNav.jobs` |
| Routes | 261 to 253 (stage figures; the Phase 2 build table, measured later, shows 252, an unexplained difference of one) |
| Tables dropped by migration | `inventory_items`, `job_bom` (0108); `jobs`, `job_files`, `job_events`, `job_variations` where they still existed (0109); `project_claims` (0110). Also one settings row, `site_v2` (0107). |
| Kept on purpose | `tenants`, `profiles.tenant_id`, `client_inventory_items` (customer inventory), the Engineer view (O2), the jobs redirects |

Why the prompt's estimate was larger (about 12,000 lines, 750 keys): it counted the Engineer view, 48 files and 11,143 lines. You decided to keep it (O2).

## 4. Vercel diet

| Item | Before | After |
|---|---|---|
| Builds | Any branch with `[deploy]` in the message built a preview | `ignoreCommand` in `vercel.json`: only `main` builds. Builds per week: not measured. |
| Cache purge after a supplier sync | One tag for all products, so every page re-rendered | Tag per product `part-<sku>`, a listing tag `parts-listing`, the full tag `parts`. Full purge only when more than 100 products moved. |
| Sitemap | Rebuilt every hour | Rebuilt every day (and at once on a listing purge) |
| Crawlers | Few rules | `robots.txt` blocks `/api/`, dashboard, inventory, projects (except new), orders, my-inventory, store query listings, `/store/search`, CAD Champions admin. Store `?q` over 64 characters or `?page` over 20 gives 404. |
| Middleware | Not tested | Test: an anonymous request makes no network call |
| Routes in build table | 252 (73 under `/api`) | 252 (same) |
| Static `○` / prerendered `●` / ISR / dynamic `ƒ` | 3 / 103 / 29 / 117 | same |
| Pages that render per request | 139 | 139 |
| First Load JS: `/`, `/store`, `/store/[sku]`, Studio | 151, 149, 212, 361 kB | same |

Counts were not re-measured after Phase 3 (the two worker routes were added).

**What stayed dynamic, and why.** No public page was dynamic only because it read a setting or a flag (the flag is gone). The 139 dynamic pages are signed-in areas, checkout, auth flows, and the CAD Champions section. The CAD Champions layout reads the session for the account menu, so all its pages render per request, even the public ones (all `noindex`). Making them static means moving that session read to the browser: a later CAD Champions change.

## 5. Worker inventory

**What exists (all off).**
- `services/worker`: a Node service with the eight scheduled jobs: supplier-refresh, voltaat-sync, delivery-promises, notifications, anonymous-cleanup, youtube-retire, cc-payments-expire, cc-weekly-progress. Each job is defined once in `lib/cron/jobs.ts`; Vercel and the worker run the same code.
- Switch `store_settings.worker` (default off) with `WORKER_URL` and `WORKER_SECRET` in Vercel. Off, malformed or missing means every cron runs in Vercel as before. If the worker is on but down, Vercel runs the job itself.
- `/api/internal/revalidate`: the worker calls it to purge the storefront cache, so the per-SKU purges still work.
- `/api/worker-token`: a 10-minute user token for part B. It carries no credits.
- `services/compose.yaml`: worker, `cad-worker`, `grader`, optional Cloudflare tunnel.
- `docs/WORKER.md`: runbook for the Mac Mini, step by step.
- CI builds the worker bundle (`worker:build`).

**What moved.** Nothing. While the switch is off, everything runs in Vercel.

**What stayed in Vercel, and why.** The site, store, checkout, sign-in, all AI routes and all CAD and grading calls. Part B is what would move the last ones. It was held on purpose: it changes how credits are spent, so it should wait until the worker has run on the real Mac. The six crons in `vercel.json` stay until after a healthy week.

**Part B scope.** Move the long AI routes (`/api/analyse`, `brief-chat`, `cad`, `project-cad`, `firmware`, `netlist`, `bom/**`, `studio/**`), the heavy admin jobs, and the CAD and grading calls. Then remove the six Vercel crons and retire Google Cloud Run.

**Open design questions for part B**
1. Streaming: do long answers (idea chat, NDJSON steps) stream well through the tunnel? Untested.
2. Credit idempotency: the worker must check and spend credits in the database at the moment of the paid work, and a retry after a tunnel failure must not charge twice.
3. Guest IP limits: guest limits use the client IP. Behind a tunnel the worker sees the tunnel's address, so the real IP must be passed and trusted safely.
4. No queue: the worker runs jobs directly. If the Mac is busy, a second request waits or is refused (409). A queue is not built.
5. arm64: the `cad-worker` and `grader` images were never built for the Mac's arm64 chip. Whether they build and run there is untested.
6. Tunnel: needs the domain's nameservers on Cloudflare (fallback: Tailscale Funnel).

## 6. Behaviour changes, by phase

**Phase 0**
- `/cad-champions` (English and Arabic) goes live with the deploy: a training and competition section. All its pages are `noindex`. The home page gets the CAD Champions side button (label without "free").
- One Studio press of the designer costs 6 model calls, not 10.
- The CAD Champions migrations 0077-0087 are part of the code that needs them.

**Phase 1**
- The old v1 pages are gone. The former `/v2` pages are the public pages. `/en/v2/...` and `/ar/v2/...` redirect (308) to the normal path.
- `/inventory` and `/dashboard/inventory` redirect to `/my-inventory`. The Inventory item disappears from the admin sidebar and the workshop menu. The admin Today tiles for tenants and low stock are gone.
- Jobs and `project_claims` have no users; nothing visible.
- The preview cookie route for the old flag is gone.

**Phase 2**
- Pushes to branches other than `main` no longer build. `[deploy]` in a message does nothing.
- After a supplier cron, only changed products re-render; listings re-render only if a listed field changed. A product's bought-together cards update with it.
- A Voltaat run that fails after writing now purges everything (before: nothing).
- The "newest" order of the home featured row can lag up to 24 hours.
- Sitemap rebuilds daily.
- `robots.txt` has more rules. Store search over 64 characters or page over 20 gives 404. Search boxes take 64 characters (was 100).

**Phase 3**
- None while the worker is off. When on: the daily jobs run on the Mac at Qatar times (3 hours later than the UTC times of Vercel), and two CAD Champions jobs (hourly payment expiry, weekly progress mail) run for the first time on a schedule.

**Phase 4**
- `/dashboard`, `/projects`, `/orders` show a loading skeleton.
- An error on those pages, or on any CAD Champions admin page, shows "Something went wrong on our side" with Try again and Contact us (no error text).
- 5 short keys (`RouteState`) are added to every page's messages.

**Phase 5**: documents only.

## 7. Migrations

Claude never runs a migration. Every file is idempotent, has a rollback note in its header and a PGlite test.

| File | What it does | Status (2026-11-11) | When to run |
|---|---|---|---|
| 0107_drop_site_v2_setting | Deletes the `site_v2` row in `store_settings` | **Run early on 2026-11-10 and reverted** (row re-inserted). Not in effect. | **After merge and deploy: run first.** |
| 0108_drop_tenant_inventory | Drops `inventory_items`, `job_bom`, `inventory_default_tenant()` | **Not run** (`inventory_items` still exists) | **After the deploy and after 0107.** Export the table first if it holds anything. |
| 0109_drop_jobs_remnants | Drops what is left of the jobs tables and helper functions | **Run** (probe: `jobs` is gone). No live code read it. | Done |
| 0110_drop_project_claims | Drops `project_claims` | **Run** (probe: gone). No live code read it. | Done |
| 0111_worker_switch | Adds `store_settings.worker = {"enabled": false}` if missing | **Not run** | Only before the worker is switched on. Order does not matter. |
| 0076, 0087 | Social sign-in profiles; CAD Champions security | You say both are run (no probe) | Done |

**Run order after merge and deploy: 0107, then 0108. 0111 only before the worker is switched on.**

**The incident of 2026-11-10.** You ran 0107 before the new code was live. The live code still read the `site_v2` row, so with the row gone it served the old v1 pages and `/en/v2` answered 404 for a short time. You put the row back and the live site was checked again. **Rule:** run a migration that removes something only after the code that stops using it is live. Each migration in the list says "after the deploy".

## 8. Owner actions, in order

1. Review the branch. On GitHub, open a pull request from `consolidation-2026-11` to `main`. The new CI runs on it for the first time. Expect CI-only surprises and fix them on the branch.
2. Merge. Vercel builds `main` and deploys. Wait until the deploy is **Ready**.
3. In the Supabase SQL editor, run `0107`, then `0108` (export `inventory_items` first if you care about its rows).
4. Vercel dashboard, Project, Settings, Git, **Ignored Build Step**: clear the old custom command and leave it on Automatic.
5. GitHub, Settings, Branches (or Rules): add a rule for `main`. Require a pull request, require status checks, add `Main / all checks` (it only appears after the workflow has run once), require branches to be up to date.
6. After the first CI run: look at the "CAD worker (pytest)" job. When it is green, remove `continue-on-error: true` from `.github/workflows/main.yml`.
7. Delete the `cad-champions` branch (after the merge).
8. In your main checkout folder, switch to `main` (it is still on the old `cad-champions` branch; four uncommitted files are saved in `_archive/uncommitted-cad-champions-2026-11-10.patch`).
9. Move the two plain-text secret files in the outer folder into a password manager, then delete them.
10. Later, when you are ready: follow the Mac Mini runbook `docs/WORKER.md`. After one healthy week, do worker part B.
11. Answer the open question: keep Google Cloud Run for good if it costs nothing?
12. Later: the product library with 3D model downloads (decision 5 in `docs/DECISIONS.md`). It needs an R2 API token.

## 9. Still open

- **Typed Supabase factories and 140 casts.** 56 type errors in 38 files appeared when the four client factories were typed. Reverted. `as unknown as`: 140 in 76 files, unchanged. Suggested order and causes: Phase 4 doc, section 4.2.
- **R11 and R12 lists.** The not-fixed R11 items (inline queries in components, 10 cache modules without a `server-only` marker) and the 31 API routes with their own error shape are listed with fixes and risk in `2026-11-consolidation-phase4.md`, section 4.4.
- **19 known-failing studio e2e tests** (`e2e/KNOWN_FAILING.txt`). Exact titles: Phase 2 doc. One more studio test failed once in the last full run (`studio-wiring-views`, `[ar]`, mobile), and `studio-engine` "out of credits" is flaky. The wiring-viewer drag test is flaky too.
- **`e2e/NEEDS_LIVE_READS.txt`**: 6 tests (28 runs) pass only against the real Supabase project. Fix: a seeded local Supabase in CI.
- **Both lists may only shrink.**
- **Public pages still dynamic**: see section 4. The "100 % static" target was not met.
- **CAD Champions pages are dynamic** because the layout reads the session.
- **The CAD worker pytest job has never run** (no Python on the dev PC), so it is `continue-on-error`.
- **`node scripts/split-legal-draft.mjs --check` reports a difference on a CRLF (Windows) checkout.** It is not in CI. Do not hand-edit `content/legal/**`.
- **GitHub Actions never ran**; the workflow was checked against its schema only. The Docker images were never built.
- **Claude API** is allowed but not built; it would be the first paid AI service, so ask first.

## 10. A 10-minute live test after the merge (phone first)

Use your phone, then repeat two steps on the computer. Do the test after the deploy is Ready and after 0107 and 0108 are run. Do not place an order.

1. **Home** `gestaltung360.com`: loads, header is right, CAD Champions side button shows.
2. **Store search**: open the store, search "arduino". Results show with prices.
3. **A product page**: open one. Photo, price, delivery date, Add to cart button show.
4. **Cart**: add the item. The cart shows it and the total.
5. **Checkout page**: open it. Do not order. Check the payment methods and the WhatsApp number.
6. **Sign in**: sign in with your account.
7. **Dashboard, Today**: the tiles load; no tenant or inventory tiles; no error screen.
8. **A project in Studio**: open one. The Studio loads.
9. **Old addresses**: `/en/v2` goes to `/en`. `/en/inventory` goes to `/en/my-inventory`.
10. **CAD Champions**: `/cad-champions/en` landing loads.
11. **Arabic**: `/ar` and `/ar/store` (right to left, product names in Arabic).

If a page shows "Something went wrong on our side", note the address and tell Claude. If `/en/v2` shows a 404, 0107 ran before the deploy: re-insert the row `site_v2 = {"enabled": true}` (see section 7) and tell Claude.
