# Code-quality audit: Gestaltung

Branch `audit/code-and-security-2026-10`, base `origin/main` 88a6473, analysed 2026-10-22. Read-only: no source file was changed. Consolidates `findings/cq-dead-code-and-duplication.md` (review A) and `findings/cq-structure-types-tests.md` (review B); metrics from `BASELINE.md`.

---

## 1. Scope and method

| Item | Detail |
|---|---|
| Reviews | Two parallel read-only reviews. A: dead/superseded code, duplication, i18n/CSS liveness. B: complexity, cycles, layering, consistency, types, tests, docs, lint/config. |
| Reachability (A) | Own import graph: 1,231 TS/TSX/MJS files, 4,328 edges (static imports, `import()`, `new URL()`). Entry points: every `app/**/{page,layout,route,loading,error,not-found,opengraph-image,sitemap,robots,manifest,icon}` + `middleware.ts` + `i18n/request.ts`. Tests excluded from the graph. The dynamic `import(\`./${name}\`)` in `lib/prototyping/providers/index.ts` was added by hand. |
| "SAFE TO DELETE" bar | No import, href or string reference in app/components/lib/e2e/scripts/messages/next.config.mjs/middleware.ts/vercel.json, no data, no customer or admin route. Everything else is "NEEDS OWNER DECISION". |
| Tools | knip 5 (unused files/exports/types/deps), jscpd (min 70 tokens / 8 lines, app+components+lib, tests excluded), madge `--circular`, ESLint run with `--rule complexity=1, max-lines-per-function=1` (app+components+lib, tests excluded), regex counts, a migration replay parser for column drift (`cols.py`; helper scripts live in the audit scratchpad, not the repo), build route table. |
| knip blind spot | knip counts test imports as usage; A computed the test-only exports separately (336, section 2/3). |
| What the heuristics cannot see | (1) i18n key liveness is last-segment name lookup plus 230 template prefixes: keys built from variables are undecidable (1,181 keys), counts are bounds. (2) Dynamic imports/strings other than the one added by hand (`gemini.ts` showed up as a knip false positive). (3) Indirect test coverage: "no test imports this module" does not prove no test exercises it through another module. (4) DB state: whether `jobs*`, `project_claims`, `project_materials` rows exist cannot be checked from this checkout (no `.env.local`, no Supabase access). (5) Runtime behaviour, flag state in production, Lighthouse. (6) `!`-assertion count is a rough regex. (7) Function-internal line ranges in the split plans (solveProduct, Scene, StudioShellInner, checkout handleSubmit) are approximate, taken from comment markers and hook positions. (8) "Likely server-capable" component flags are heuristic. |
| Corrections to BASELINE | `@electric-sql/pglite` 0.5.11 is now in `package.json:42` (file changed 11:23 during the audit); the baseline said it was missing. Real `any` is 7, not 15. StudioShell cycles are 12, not 13 (madge lists 12; total still 20). |

---

## 2. Metrics ("before")

### 2a. Size per area (lines include tests unless stated)

| Area | Files | Lines | Notes |
|---|---:|---:|---|
| `app/` | 224 | 26,551 | 100 pages under `app/[locale]`, 62 API routes, 26 `"use server"` files |
| `components/` | 258 | 47,308 | 213 kebab-case, 45 PascalCase (Pascal only in `components/studio/**`) |
| `lib/` | 715 | 90,584 | includes ~232 test files; 406 kebab, 47 snake_case + 18 camelCase part-data files |
| `e2e/` | 36 | 4,710 | Playwright specs + fixtures |
| `scripts/` | 38 | 4,205 | hand-run tools |
| `messages/` (en+ar) | 2 | 11,162 | 5,330 keys each, parity 5330/5330 |
| `supabase/migrations/` | 87 files | 16,694 | 86 migrations, latest 0099, next = 0100 |
| app+components+lib, tests excluded (BASELINE) | | 135,882 | |

### 2b. Quality metrics

| Metric | Before | Source |
|---|---:|---|
| Duplication (jscpd) | 88 clones, 1,217 lines, 0.90 % (9,012 tokens, 0.85 %) | BASELINE |
| knip unused files | 23 (21 scripts, `account-bar`, `home-trust`, `gemini.ts` [false positive], `cad-setting.ts`) | BASELINE + A |
| knip unused exports / types | 382 / 354 (736): 588 internal (drop `export`), 34 dead, 114 ambiguous | A |
| Exports used only by tests (knip-invisible) | 336 (290 also used in own file, 46 unused in production) | A |
| knip duplicate exports | 3 (all intentional aliases) | A |
| Real `any` | **7** (5 in `lib/google/drive-picker.ts`, 3 sites in `lib/projects/uses-ai.test.ts`; see section 8). BASELINE regex counted 15: 8 are the word "any" in comments/CSS/identifiers such as `anyToConfirm` | B |
| `@ts-ignore` / `@ts-expect-error` | 0 | BASELINE |
| `as unknown as` | **97 = 62 production + 35 tests** | BASELINE + B |
| Non-null `!` on env | 5 (`lib/supabase/server.ts:11,12`, `client.ts:7,8`, `sourcing/adapters/digikey.ts:66`); other `!` about 242 (regex) | B |
| `process.env.X` | 98 sites in 56 files, no central env module | B |
| Import cycles (madge) | **20** (12 StudioShell<>steps type-only, 3 schema, 1 bom<>electronics-rules, 1 supabase/types<>bom, 1 youtube, 1 netlist<>plain-checks, 1 wiring3d) | BASELINE + B |
| `eslint-disable` | 65 (`no-img-element` 31, `exhaustive-deps` 26, `no-explicit-any` 4, `no-unused-vars` 2, other 2) | BASELINE + B |
| `console.log(` (all dirs) | 77 (mostly `scripts/`); in app/components/lib: 102 `console.error`, 58 `console.warn`, 4 `console.log` | BASELINE + B |
| `dangerouslySetInnerHTML` | 8 | BASELINE |
| Service-role client references | 76 | BASELINE |
| `force-dynamic` | 137 files | BASELINE |
| `loading.tsx` / `error.tsx` / `global-error.tsx` | 0 / 0 / 0 (`not-found.tsx` 2) | B |
| Lint / typecheck / tests | lint pass (1 warning, `app/[l]/opengraph-image.tsx:101`); tsc 1 error (pglite import, now fixed in package.json); vitest 231 files / 3,246 tests pass + 1 file failing to load (same import) | BASELINE |

### 2c. Largest files (app, components, lib; tests excluded)

Lines, file: components/studio/steps/wiring/Wiring3DView.tsx (1,402); lib/studio/product/solve.ts (1,387); components/prototyping/workspace.tsx (1,370); components/projects/project-workspace.tsx (1,080); lib/studio/netlist.ts (1,008); components/prototyping/bom-table.tsx (965); lib/studio/schema.ts (889); components/studio/StudioShell.tsx (856); components/studio/steps/PartsStep.tsx (841); lib/studio/wiring3d/layout.ts (829); components/studio/viewer/Viewer.tsx (776); lib/studio/schematic.ts (758); lib/studio/geometry/product-kernel.ts (741); lib/studio/wiring-drawing.ts (698); components/admin/videos-youtube.tsx (693); app/[l]/dashboard/customers/[id]/page.tsx (691); components/studio/steps/IdeaStep.tsx (661); lib/studio/enclosure/build.ts (655); lib/prototyping/electronics-rules.ts (638); components/admin/fix-list.tsx (637); lib/studio/product/forms/geometry.ts (628); components/prototyping/idea-stage.tsx (619); components/admin/quick-entry.tsx (594); components/studio/steps/EnclosureTemplate.tsx (575); app/[l]/store/checkout/checkout-client.tsx (563).

### 2d. Complexity thresholds (non-test functions, ESLint)

| Threshold | Functions |
|---|---:|
| cyclomatic complexity >= 15 | **323** |
| >= 25 | **140** |
| >= 40 | **45** |
| lines per function >= 120 | 166 |
| lines per function >= 300 | 31 |

### 2e. Tests

| Metric | Value |
|---|---|
| Unit test files / tests reported | 232 files (231 pass + 1 load failure) / 3,246 tests (`it.each` expanded); about 2,340 `it/test(` call sites in the per-area table (section 9a) |
| Location | all in `lib/**/*.test.ts`; 0 in app/, components/, scripts/ |
| Component / route-handler / RLS-RPC tests | 0 / 0 / 0 (PGlite used by one file only) |
| e2e | 36 spec/fixture files, 4,710 lines, desktop + mobile-375 |
| `waitForTimeout` in e2e | 54 in 8 files; `toPass` 21; `networkidle` 0 |
| lib modules without sibling test | 272 (156 in lib/studio, mostly part data files) |

### 2f. First Load JS per main route (BASELINE route table; shared baseline 104 kB)

| Route | Page size | First Load JS | Notes |
|---|---:|---:|---|
| `/[locale]` (home) | 1.92 kB | 148 kB | SSG, revalidate 1d |
| `/[locale]/store` | 150 B | 147 kB | SSG, revalidate 1d |
| `/[locale]/store/[sku]` | 2.74 kB | 209 kB | SSG |
| `/[locale]/design/quote` | 10.5 kB | 204 kB | SSG, revalidate 1d |
| `/[locale]/projects/[id]/studio` | 1.2 kB | **326 kB** | dynamic |
| `/[locale]/pricing` | 9.33 kB | 161 kB | SSG, revalidate 1d |
| for reference: `/projects/[id]/prototyping` (Engineer view) | 88.5 kB | 338 kB | dynamic, O2 |
| for reference: `/projects/[id]` | 17.2 kB | 226 kB | dynamic |
| for reference: `/dashboard/studio-library/[id]` | 4.98 kB | 246 kB | dynamic |
| Middleware | | 103 kB | |

---

## 3. Dead or superseded code

### 3.0 Corrections to the brief (stale claims)

| Brief claim | Finding |
|---|---|
| CSV price-list importer is unused (CLAUDE.md digest) | **Wrong, it is reachable.** `app/[l]/dashboard/store/suppliers/page.tsx:119` links to it; it writes `supplier_offers`, the Google-Sheet importer writes `parts`. Different jobs; parser shared (`csv.ts:6` imports `parseCsv` from `sheet-import.ts:111`). Only `csvAdapter` const inside is dead. See O7. |
| `Features` / `LocalAdvantage` / `Social` i18n namespaces to remove | **Already gone** from both `messages/en.json` and `ar.json`. So are `Home`, `Meta.credits*`, `Payment.cardTitle/cardBody`, `PayMethods.cardSoon`, `StoreLanding.tagline/footerText`, `Hero.kicker`, `Credits.pageTitle`. All 98 remaining namespaces have at least one production reference. |
| `lib/prototyping/providers/gemini.ts` unused (knip) | **False positive.** Loaded by `providers/index.ts:15` `import(\`./${name}\`)`, `DEFAULT_PROVIDER = "gemini"` (`index.ts:9`), used by `app/api/analyse/route.ts:132`. See O10. |
| Retired `.store-landing` / `.sl-*` CSS | Already gone (grep `\.sl-` in `globals.css` = 0; `sl-*` hits are `StudioLoader.tsx` inline CSS). |
| Jobs pipeline code | TS already gone (no `lib/jobs`, `components/jobs`, no `.from("jobs"/"job_*")`). `AdminJobs` namespace is the live engineering-jobs dashboard, not the old pipeline. |

### 3a. SAFE TO DELETE (proved unreachable)

| # | Item | Evidence | Notes |
|---|---|---|---|
| S1 | `components/account-bar.tsx` (27 lines) | `AccountBar` has zero imports (grep `account-bar\|AccountBar` hits only the file and CLAUDE.md:438). Graph: no importer. Not a route. Matches knip. | `SignOutButton` (dashboard/layout.tsx:13, inventory/layout.tsx:8) and `Nav.dashboard` (header-nav.tsx:82) stay used elsewhere. |
| S2 | `components/payment/home-trust.tsx` (~45 lines) | `HomeTrust` zero imports; CLAUDE.md:919 "HomeTrust removed from home". | Orphans `PayMethods.homeKicker/homeIntro/homeTitle/crLabel/locationLabel` (only used at home-trust.tsx:17,19,24,31,37). `PaymentInstructions` stays (checkout, orders/[id], success, payment-card). Re-check `Company.location` before removing that key. |
| S3 | `.fuse_hidden0000000d00000001` (repo root, 225,502 B) | `git ls-files` lists it as TRACKED; `file` = "Microsoft Word 2007+"; added in commit c8d109f ("Stage 6a"); zero references. FUSE temp artefact committed by accident. | Not byte-identical to `Gestaltung_Build_Plan.md` (also a .docx with a .md name, 224 KB) but same family. |
| S4 | `.delay-4` rule, `app/globals.css:191-193` | Scan of all 18 classes in globals.css: only `delay-4` has 0 uses in app/components/lib/tailwind.config.ts; no `delay-${n}` template. | globals.css is 201 lines. |
| S5 | 25 dead exports + 9 dead types (zero references anywhere, tests included) | List below. | Delete the symbol, not the file. |
| S6 | `addToCart`, `updateCartQty`, `removeFromCart` in `lib/parts/cart.ts:62-96` | Zero references outside the file (only `getCart/saveCart/toCartItem/cartItemCount/cartTotal` imported, by `components/parts/cart-provider.tsx:14`). Header lines 1-3 still say "State lives entirely in localStorage (no auth, no DB table)", false since the cart moved to `cart_items`. | Also removes 2 of 6 copies of the quantity clamp (D-15). |
| S7 | 90 high-confidence dead i18n keys (EN + AR) | Each key's last segment appears nowhere in app/components/lib and is not covered by a template prefix. Groups: Prototyping 22, Inventory 16, StoreLanding 16 (`cat1..6`, `theme*`, `navStore`, `langToggle`, `menuAria`, `whatsappMsg`, `choiceIdeaStep1..3`), DashboardNav 5, Parts 5, Studio 5 (`viewerParts, codeCard, codeBoard, requestPrintSending, skipToCode`), Nav 4, AdminHome 4, Admin 2, DesignQuote 2, Projects 2, Search 2, PartsDashboard 1, MyInventory 1, Payment 1, Credits 1, SchoolSafety 1. | Delete from both files so `check-i18n-parity.mjs` stays green. A few may be built from variables (`Prototyping.need_scope`, `DashboardNav.group_*`): check each. Full list in scratchpad `i18n_dead.json`. |

**S5 symbol list (file: symbol)**

| File | Dead symbols |
|---|---|
| lib/studio/schema.ts | `ROT_Z`; types `ActuatorLoad`, `Drawing2DOverride`, `ProductDesignStatus` |
| lib/occasions.ts | `isYearly` |
| i18n/navigation.ts | `getPathname` |
| lib/credits/edu.ts | `EDU_CREDITS` |
| lib/studio/connections.ts | `connectionsAt`, `describeConnection` |
| lib/parts/format.ts | `partDescription` |
| lib/email/templates/layout.ts | `isRecord` |
| lib/sourcing/adapters/{csv,voltaat,digikey,mouser}.ts | `csvAdapter`, `voltaatAdapter`, `digikeyAdapter`, `mouserAdapter` (`SupplierAdapter` stubs; rest of each file is live) |
| lib/studio/placement.ts | `partPointToContent` |
| lib/studio/product/schema.ts | type `LinkKind` |
| lib/studio/product/shapes.ts | `isIdentityRotation`, `boxSize`, `stadiumOutline` |
| lib/studio/server/product.ts | `ExcludeArchetypes` |
| app/[l]/dashboard/ai-costs/format.ts | `billableQar` (formula re-typed inline 5 times, D-18) |
| lib/parts/constants.ts | `PART_ORDER_STATUSES`; type `DeliveryArea` |
| lib/turnstile-client.ts | `turnstileChallengeAvailable` |
| app/[l]/dashboard/store/orders/actions.ts | `updateOrderStatus` (unreferenced "use server" action; Next tree-shakes it, still dead) |
| lib/projects/constants.ts | type `ProjectMaterialKey` |
| lib/studio/product/forms/geometry.ts | `OPPOSITE` |
| components/studio/steps/wiring/views-context.tsx | `useOptionalWiringViews` |
| lib/supabase/types.ts | types `PartOrderItem`, `ProjectMaterial`, `CartRow` |

Also trivial: the three knip "duplicate exports" are aliases, not bugs: `lib/credits/constants.ts:5,7` (`CREDIT_QAR` / `AI_PRICE_QAR`, 2 importers of the alias); `lib/studio/server/product.ts:61-62` (`DesignRefBody` / `DesignRefQuery`, both used); `components/home/your-work-strip.tsx:118,334` (named + default; the named one is unused; a different `YourWorkStrip` is in `your-work-gate.tsx:14`).

### 3b. NEEDS OWNER DECISION

| # | Item | Evidence | Why not safe | Recommendation |
|---|---|---|---|---|
| O1 | **v1 public pages** after site_v2 cut-over: `app/[l]/page.tsx` (326 lines), `how-it-works/page.tsx` (157), `design/page.tsx` (244), `store/page.tsx` (25) = 752 lines | `middleware.ts:93-124` + `lib/site-v2.ts:117-124`: with the flag ON, `/:locale`, `/how-it-works`, `/design`, `/store` (no listing params) are REWRITTEN to `/v2…`; `/store?q=…` goes to `/store/search` by `next.config.mjs:32-40`. v1 is reachable only when the flag is OFF, **or when the flag read fails** (`middleware.ts:41-55`: 1.5 s timeout, any error/missing env/missing row = OFF = v1, "fail closed"), or after the documented rollback (docs/CUTOVER.md s.4). Graph: no component is exclusive to v1; only the 4 page files go. About 7 i18n keys orphaned (`DesignHub.uploadTitle/uploadCopy/drawingMeta/panelTag`, `Videos.seeItWorkHeading/Sub`, `StoreLanding.choiceIdeaNote`). | Customer-reachable on a Supabase read failure; owner kept it as rollback; CUTOVER.md s.7 "later, separate task"; Lighthouse step unsigned (CLAUDE.md "P3-09 BLOCKED"). | Keep until the owner accepts removing the rollback. Then one change: v1 pages, `lib/site-v2*.ts` flag branch, `middleware.ts` flag fetch, `app/api/admin/site-v2-preview`, `/v2` routes (move content to public paths), `e2e/site-v2-flag.spec.ts`, `e2e/home-w7.spec.ts:16-21`. Note: if the flag read fails today the site silently serves a different home page. |
| O2 | **Engineer view**: `/projects/[id]/prototyping` page + 48 files, 11,143 lines: `components/prototyping/{workspace,idea-stage,parts-stage,schematics-stage,bom-table,netlist-view,spec-sheet,tree-nav,client/*,…}`, `components/credits/{cad-card,cad-viewer}`, `lib/cad/render.ts` (+ worker, browser OpenSCAD fallback), `lib/prototyping/{schematic,schematic-svg,wiring-svg,client-steps,node-click,view-mode,…}`, `lib/store/payment.ts`, `components/projects/phone-prompt.tsx`, `components/header-auth-link.tsx` | `app/[l]/projects/[id]/prototyping/page.tsx:42-47`: every non-`super_admin` is redirected to `/studio`. Only inbound link `projects/[id]/studio/page.tsx:78` (admin). `only_via.py` proves these 49 files are reachable ONLY through that page. Old 8-stage workspace, old "template drawings", the whole `components/prototyping/client/*` client view (clients cannot reach it). First Load 338 kB. | Reachable by super_admin; the lib half is still used by live APIs (`lib/prototyping/{bom,bom-match,bom-server,netlist,electronics-build,kit-plan}` imported by `/api/bom/*`, `/api/netlist`, `project-parts-list.tsx`, `lib/studio/*`, `lib/admin/project-export.ts`). `Prototyping` namespace 686 keys (22 dead, 38 doubtful); `ClientView` 62 keys (8 files, all Engineer view). | Owner decides if the Engineer view is still wanted. If not: remove page + 48 files + unused part of `Prototyping` and `ClientView` (about 748 keys); keep shared lib modules. Largest dead-weight candidate in the repo. |
| O3 | **Old workshop inventory**: `/[locale]/inventory/**` (page, new, [id]/edit, actions), `components/inventory/{delete-item-button,item-form,tenant-filter}`, `tenants` + `inventory_items` tables, `Inventory` namespace (77 keys, 16 dead), `Admin.{tenants,inventory,lowStock*}` tiles in `components/dashboard/admin-overview.tsx` | Live: `inventory/page.tsx:52,69`, `inventory/actions.ts:109,139,162`, `lib/auth/get-session.ts:54` (tenants), linked from `dashboard/layout.tsx:54` (non-clients) and `components/dashboard/admin-nav-groups.ts:54`; `e2e/dashboard-nav.spec.ts:38`; `next.config.mjs:101-109` redirects `/dashboard/inventory`. CLAUDE.md: "kept but hidden". | Admin-reachable UI, holds data. | Owner decision; retiring needs a migration plan for the two tables. `/my-inventory` (`client_inventory_items`) is a different live feature (header-nav.tsx:81), must stay. |
| O4 | **Jobs-pipeline remnants** | Remain: 8 permanent redirects `next.config.mjs:50-78` (`/design/upload`, `/design/jobs`, `/dashboard/jobs` -> `/design/quote`); tables `jobs/job_files/job_events/job_bom` (CLAUDE.md: "remain, no explicit dropped statement"); root docs `STAGE_6A_PROMPT.md`, `STAGE_6B_PROMPT.md`; role `workshop` in `lib/supabase/types.ts:11-12`, `lib/auth/redirects.ts:15`, `components/auth/sign-in-form.tsx:110`. | Redirects serve old bookmarks; tables hold data. | Keep redirects. Check in the live DB whether the four `job*` tables are empty before proposing a DROP migration (cannot be checked here). |
| O5 | **`project_claims`** (retired table) | Migration 0020:50 creates it; 0022:11 "RETIRED: nothing reads or writes it"; `lib/supabase/types.ts:255` "no longer typed". Zero `.from("project_claims")` in app/components/lib. (`ProjectClaimGate`, `/api/projects/claim` are the unrelated guest-claim feature.) | Table, RLS policies, grants and legacy rows exist; 0071_claim_guest_work.sql mentions it. | New migration (>= 0100) to drop after confirming rows are disposable. Nothing to delete in code. |
| O6 | **AliExpress** | Not code: supplier row seeded by 0028:68, `rank` set by 0095:65. TS keeps four strings: `lib/admin/fix-groups.ts:49` (bucket "ali"), `lib/sourcing/lead-times.ts:34` (rank 70), `lib/store/part-source.ts:30` (label), `messages/*.json:723` `bucket_ali`; docs/SOURCING_ORDER.md:19; tests lead-times.test.ts:21, fix-groups.test.ts:35. CLAUDE.md says dropped but "Alibaba/AliExpress" is still ranked last. | Tiny; shares branches with the Alibaba path. | Leave. |
| O7 | **CSV price-list importer** (`lib/sourcing/adapters/csv.ts`, `components/admin/price-list-import.tsx`, `dashboard/store/suppliers/import/{page,actions}.tsx`, `PriceImport` namespace 47 keys) vs Google-Sheet importer (`lib/parts/sheet-import.ts`, `dashboard/store/import/page.tsx`, `importPartsFromSheet` in `dashboard/store/actions.ts:265`) | CLAUDE.md digest says CSV importer is "unused": it is NOT unreachable (`suppliers/page.tsx:119` links to it). Different tables written. Parser shared, no duplicate. Dead inside: `csvAdapter` const only. | Admin-reachable. | Keep; correct the CLAUDE.md line. |
| O8 | **TS spec of SQL rules, tested but never called**: `lib/schools/delivery.ts` (43 lines + test; checkout reads `class_order_delivery_quote` from SQL via `lib/store/use-delivery-quote.ts:45`), `lib/credits/edu.ts` (29 lines + test; `is_edu_email` in 0074 is authority) | Graph: imported only by own `*.test.ts`. Migration comments reference them (0097_class_order.sql:15,53; 0074_edu_credits.sql:15); migrations cannot be edited. | Deleting removes executable documentation of the SQL rule. | Engineer call. If kept, move under a `__spec__`/test folder; if deleted, SQL comments dangle (harmless). |
| O9 | **Future-seam stubs**: `lib/studio/cad-adapter.ts` (137), `lib/studio/cad-setting.ts` (22, ZERO importers, only non-test file knip lists in lib/studio), `lib/studio/product/ai/concept.ts` (37, always returns `skipped`), `lib/studio/wiring3d/verify.ts` (96, "used by the tests") | docs/STUDIO_CAD.md ("off and not wired"), docs/STUDIO_PRODUCT.md:29,117. `STUDIO_CAD_KEY` also referenced by SQL notes. cad-adapter used by `enclosure/build.test.ts`, `mech/build.test.ts`. | Intentional placeholders. | `cad-setting.ts` alone is dead (nothing reads the `studio_cad` row): delete or wire. Keep the others until the feature decision. |
| O10 | **`lib/prototyping/providers/gemini.ts`** (knip: unused file) | Dynamic import (see 3.0). | knip false positive. | KEEP. Add to knip config `entry`. |
| O11 | **`public/prototypes/gestaltung-project-creation-hub-prototype.html`** (432 KB, tracked) + `prototypes/…NOTES.md` | Served publicly at `/prototypes/…html` (noindex per notes). No code reference; CLAUDE.md:477 describes it. | Publicly reachable design mock-up with mocked features. | Owner decides whether it stays on the production domain. |
| O12 | **Scripts** (21 knip "unused files" + `.ps1` pair) | None reference removed features. Referenced from docs/CUTOVER.md, CHANGELOG-audit.md, migrations or source comments: check-i18n-parity (CUTOVER.md:39), check-live (CUTOVER.md:49,87), measure-page, studio-bundle-size (studio-geometry.worker.ts:19), split-legal-draft (lib/legal/content.ts:20), make-og-ar (opengraph-image.tsx:18), make-hero-poster (hero-visual.tsx:5), upload-video, record-videos/* (lib/videos.ts:68,75; docs/TEST_DATA_CLEANUP.md), find-low-res-photos. One-shot leftovers: `build-category-migration.mjs` (output already in 0048, RUN; `lib/store/store-categories.ts:15` still says it loads it), `make-video-placeholders.mjs`. Windows helpers `run-local.ps1`, `scripts/vercel-prune.ps1`: zero references. | Tooling, not app code. | Keep all; add `scripts/**` to knip `entry`. Optionally drop the two .ps1 files if the owner no longer uses Windows. |
| O13 | **`services/cad-worker`** | STILL USED: `lib/cad/cloud.ts:42` reads `GCP_CAD_URL`; `lib/cad/cloud-flow.ts`, `/api/cad`, `/api/project-cad`; docs/CAD_CLOUD.md; `e2e/cad-cloud.spec.ts`; excluded from Vercel by `.vercelignore:3`. | Active production dependency (`cad_engine` setting). | KEEP. |
| O14 | **Docs describing removed features** | Root: `STAGE_6A_PROMPT.md` (CAD upload + job creation), `STAGE_6B_PROMPT.md` (workshop dispatch), `STAGE_8B_PROMPT.md`, `STAGE_PARTS_STORE_PROMPT.md`, `STAGES_STORE_FIRST.md` (retired dark store-landing), `FIX_ALL_PROMPT.md` (0 references), `STAGE_8A/SITE_REVIEW_FIXES/WIRING_VIEWS_PROMPT.md`; `Gestaltung_Build_Plan.md` is a .docx with a .md extension (225 KB; referenced by README.md:21 and FIX_ALL_PROMPT.md:30); `README.md` describes "Stage 1: a single landing page". `docs/STUDIO_CAD.md` documents a switch "off and not wired". Each prompt file cited once, as history, by CLAUDE.md:259,1493-1497. | Historical record the owner may want. | Move prompts to `docs/history/`, or delete after owner OK; fix README.md; rename/replace the .docx. See section 10. |
| O15 | **Retired DB objects with no code** | `project_materials` (write-only, UI removed; type `ProjectMaterial` dead), `pricing_plans.first_circuit_free` (unused), `projects.free_wiring_used` (kept, no gate), `stock_status` column (never shown). Per CLAUDE.md digest. | Hold data. | Future "drop dead columns" migration only after owner OK. |

### 3c. Unused exports and types (knip 382 + 354), classified

| Bucket | Exports | Types | Total |
|---|---:|---:|---:|
| internal (used in own file; drop `export` only) | 306 | 282 | 588 |
| dead (zero references; S5) | 25 | 9 | 34 |
| ambiguous (same identifier occurs in other files) | 51 | 63 | 114 |
| **sum** | **382** | **354** | **736** |

By module (internal / dead / ambiguous, exports+types): lib/studio 258 / 13 / 57 (328 of 736, 45 %); lib/prototyping 41 / 0 / 16; lib root 37 / 2 / 4; lib/store 39 / 0 / 3; lib/admin 30 / 0 / 2; components/studio 12 / 1 / 8; lib/cad 17 / 0 / 3; lib/sourcing 16 / 4 / 0; app/dashboard 12 / 2 / 1; lib/orders 12 / 0 / 0; lib/schools 12 / 0 / 0 (types); lib/auth 11; lib/email 10 / 1; lib/parts 4 / 5 / 2; lib/notifications 7 / 0 / 3; lib/engineering 3 / 0 / 6; lib/supabase 0 / 3 / 0; about 25 small modules 1-5 each.

Reading: public-surface noise (`export` on helpers only used in their file), not dead code. Genuinely dead: the 34 in S5.

**Used only by tests (336 exports; 290 also used in own file; 46 unused in production):** lib/videos.ts:`videoFileNames`; lib/company.ts:`COMPANY_WHATSAPP`; lib/design/quote-method.ts:`normalizeQuoteMethod`; lib/studio/request-summary.ts:`priceEstimate`; lib/studio/enclosure/{templates:`pointInCavity`, label-font:`LABEL_CHARS`}; lib/studio/library/class-safe.ts:`classSafeIds`,`unsafeIdsAmong`; lib/studio/product/{schema:`parseProductModel`, stl:`pieceSTL`, private:`stripServerOnly`, store:`EMPTY_PRODUCT`, ai/concept:`conceptImageEnabled`}; lib/studio/wiring3d/{verify:`wireProblems`, wires:`touchesPart`,`planWires`, route:`snapXY`,`crossingCount`, pin-labels:`overlappingLabels`}; lib/studio/geometry/{product-kernel:`measureOverlaps`, client:`hasEnclosureGeometry`,`resetGeometryClientForTests`, product-mock:`resetProductMock`}; lib/studio/mech/templates.ts:`buildMechGeometryLoose`; lib/studio/client/steps.ts:`factKeys`; lib/admin/home-tiles.ts:`countFix`; lib/cad/cloud.ts:`resetCloudAuth`; lib/orders/admin-rules.ts:`filterVisible`; lib/schools/{pricing:`schoolPrintPrice`, join-code:`JOIN_CODE_ALPHABET`, delivery:`classDeliveryQar`,`freeByClassRule`}; lib/sourcing/lead-times.ts:`supplierRank`,`supplierLeadDays`; lib/pricing/{experiment:`clearStoredCode`, usage-price:`usagePriceQar`}; lib/credits/{redeem-window:`spendWindow`, edu:`isEduEmail`,`eduEmailKey`}; lib/notifications/decide.ts:`isRetryable`; lib/store/{working-days:`DEFAULT_HOLIDAYS`,`isWorkingDay`, search-suggest:`SUGGESTION_FIELDS`, store-categories:`storeCategoryForSource`, sourcing:`isBelowFloor`, delivery:`splitByDatability`}.

Finished-but-unwired logic worth an owner glance: `usagePriceQar` (usage-price.ts header: "Not wired into checkout yet"), `priceEstimate`, `splitByDatability`, `supplierLeadDays`.

Whole files reachable only from tests: `lib/credits/edu.ts`, `lib/schools/delivery.ts`, `lib/studio/cad-adapter.ts`, `lib/studio/cad-setting.ts` (not even a test), `lib/studio/product/ai/concept.ts`, `lib/studio/wiring3d/verify.ts`, plus legitimate fixtures (`plant-monitor.fixture.ts`, `__fixtures__/parts.ts`, `enclosure/test-fixtures.ts`, `ai/fake-model.ts`, `server/fake-supabase.ts`).

**knip's 23 unused files resolved:** 21 scripts (O12); `account-bar.tsx` (S1); `home-trust.tsx` (S2); `gemini.ts` (O10, false positive); `cad-setting.ts` (O9). Net: 2 deletable files, 1 doubtful, 1 false positive, 21 tools.

### 3d. i18n liveness (98 namespaces, 5,330 keys, EN = AR)

| Measure | Count |
|---|---:|
| Keys referenced by name | 3,856 |
| Not found anywhere ("A") | 167 (77 explained by verified dynamic lookups, **90 dead**) |
| Name exists in source but not in a file using that namespace ("B", weak) | 126 |
| Unreferenced by exact name but compatible with a dynamic template prefix ("D", undecidable) | 1,181 |
| Realistic dead total | about 90 certain, up to about 215 if all "B" are dead (2 to 4 % of the file) |

Verified dynamic families (77): `AiUsage.health.*` 13, `PriceImport.c_*/f_*` 15, `Delivery.s_*` 3, `Restock.w_*` 4, `Studio.ideaCard.act_*`, `understanding.cnt_*`, `understanding.buildClass_*`, `views.sim.effect.*`, `views.sim.unit.*`, `product.progress_*/piece_*` 37, `Partners.[sa]Honest*` 6.

Namespaces of interest (all others fully live; none orphaned). Name (keys, prod files, note): Prototyping (686, 28; O2; 22 dead, 38 doubtful); Studio (577, 34; 5 dead; many dynamic families); PartsDashboard (151, 17); Projects (176, 20); Credits (142, 9); Customers (140, 2); StudioLibrary (136, 5); VideosYoutube (124, 2); Pricing (104, 5); Engineering (100, 3); Sourcing (92, 6); Parts (91, 17; 5 dead); SchoolClasses (82, 8; 9 doubtful); StoreLanding (82, 6; live (v1 home, v2 home, v2 store, founder-cards, design-dropzone, callback-form); name historical; 16 dead); Inventory (77, 8; O3; 16 dead); DashboardNav (60, 8; 5 dead, 28 doubtful); ClientView (62, 8; Engineer view (O2)); PriceImport (47, 2; O7); SiteV2 (46, 5; goes with flag cleanup (O1)); AdminJobs (69, 2; live (engineering jobs), not the old pipeline).

Limits: `t(\`status_${x}\`)` lookups, `t.raw`, keys passed as props and keys in `scopes.ts` strings are covered only by the name lookup. `lib/i18n/scopes.test.ts` + `check-i18n-parity.mjs` catch parity and scope gaps but not a missing dynamic key.

Dead CSS: `app/globals.css` 201 lines, 18 distinct classes, 17 used, 1 unused (`.delay-4`, S4).

---

## 4. Duplication

jscpd sees 88 clones / 1,217 lines (0.90 %), mostly boilerplate. The bigger problem is semantic duplication (same rule re-implemented), which jscpd cannot see. Risk column = risk of merging.

### 4a. Business rules and helpers (D-01 to D-32)

| # | Rule / helper | Copies (file:line) | Proposed home | Risk |
|---|---|---|---|---|
| D-01 | **Super-admin guard in server actions**: identical 3-line `requireAdmin()` (`getSessionContext()` + `role !== "super_admin"` -> `throw new Error("forbidden")`) | `dashboard/store/suppliers/voltaat/actions.ts:22`, `suppliers/lookup/actions.ts:24`, `suppliers/import/actions.ts:35`, `store/attributes/actions.ts:15`, `store/restock/actions.ts:12`, `store/sourcing/actions.ts:22`, `dashboard/payments/actions.ts:21` (`guard`), `dashboard/engineering-jobs/actions.ts:21` (`guard`). Variants: boolean `isAdmin()` `store/fix/actions.ts:29`; `admin()` `studio-library/actions.ts:25`; redirecting `requireSuperAdmin(locale)` `store/orders/actions.ts:21`; DB-based `isSuperAdmin(supabase,userId)` `lib/studio/server/product.ts:175`; inline `session?.profile.role !== "super_admin"` about 70 times (13 `throw "forbidden"`, 6 `{ok:false,error:"forbidden"}`, 3 `{ok:false,errors:[],message:"forbidden"}`, 2 `{error:"forbidden"}`). B counts 79 inline `role === "super_admin"` in 129 files. | `lib/auth/require.ts`: `requireSuperAdmin()` (throws), `isSuperAdmin(session)`, `adminOnlyResponse()` | Low; keep each action's failure shape (throw vs return) |
| D-02 | **Super-admin guard in admin layouts**: 10 near-identical 14-line `layout.tsx` (`setRequestLocale`, `getSessionContext`, redirect sign-in, redirect /dashboard, `force-dynamic`) | `dashboard/{ai-costs,usage,studio-library,projects,payments,notifications,engineering-jobs,customers,credits}/layout.tsx:9-23`, `dashboard/store/layout.tsx:11-24` (jscpd 14 lines x 8) | One route-group layout `dashboard/(admin)/layout.tsx` or shared `<RequireSuperAdmin>` | Low; moving routes changes file paths (keep URLs); `dashboard/layout.tsx` is shared with client roles |
| D-03 | **Admin API route guard**: 5 shapes of "not super_admin" | `api/admin/*`: `new Response(null,{status:403})` drive-import:22, youtube/callback:32, youtube/connect:19, store-cleanup:339, voltaat-import:18, sourcing-backup:225, starter-parts:61, voltaat-sync:13; `json(403,{ok:false,error:"forbidden"})` youtube/upload:72; `Response.json({error:"forbidden"},403)` notifications/test:19; `NextResponse` site-v2-preview:25; DB role read `me?.role` customers/[id]/export:29, projects/[id]/export:28 | Same helper as D-01 | Low-medium; admin pages may depend on empty vs JSON body |
| D-04 | **Signed-in user check in API routes**: `supabase.auth.getUser()` inline in 25 routes | api/studio/{product/model:18, product/engineer:17, doc:29,44, tokens:16}, firmware:20, store-lead:115,258,285, bom/{match:29, electronics:27}, projects/{recovery-email:34, claim:32, name:25}, netlist:31, brief-chat:32, project-cad:52, cad:58, analyse:62, engineering/jobs:19, transcribe:33, billing/{proof:21, checkout:19, service:25}, auth/callback:144. 401 answered 5 ways: empty body (15), `{error:"sign_in"}` (10), `{error:"unauthenticated"}`, `{ok:false,reason:"not_signed_in"}`, `{sent:false,reason:"not_signed_in"}`. `lib/auth/get-session.ts:getAuthUser` exists, 1 route uses it | `lib/auth/api.ts`: `requireUser(request)` -> `{user, supabase}` or canonical 401 | Medium; front-end reads some bodies (`reason`, `"sign_in"`); unify per route family |
| D-05 | **AI-route prelude** (`createClient` + `auth.getUser` + `request.json().catch(null)` + `projectId` + `locale === "ar" ? "ar":"en"` + 400) | jscpd 10-line clones: api/bom/electronics:21-30, bom/match:23-32, netlist:25-34, firmware:14-23, brief-chat:26-36, projects/name:19-28; 12-line clones billing/{checkout:13-24, service:19-30, proof:15-26} + engineering/jobs:13-24 | D-04 helper + `parseJsonBody()` | Low-medium |
| D-06 | **Cron secret check**: 4 use non-constant-time `headers.get("authorization") !== \`Bearer ${secret}\``; 2 use `isAuthorizedCron` (`timingSafeEqual`) | delivery-promises:30-31, supplier-refresh:11-12, voltaat-sync:11-12, youtube-retire:12-13 vs notifications:16-18, anonymous-cleanup:30-32 (helper `lib/notifications/links.ts:74`) | `isAuthorizedCron` everywhere (move to `lib/auth/cron.ts`) | Very low; closes a minor timing-compare inconsistency |
| D-07 | **JSON error shapes in API routes** | about 127 `{error}`, 18 `{ok:false}`, 10 `{sent:false}`, 49 `new Response(null,{status})` (B: 119 / 16 NextResponse / 45); two local helpers with swapped argument order `app/api/admin/youtube/upload/route.ts:67 json(status, body)` vs `lib/studio/server/product.ts:66 json(body, status=200)`; `NextResponse.json` 29 vs `Response.json` 176 | `lib/http.ts`: `jsonError(code, status)`, `jsonOk(body)` | Medium (client contracts); family by family |
| D-08 | **Money formatting** | `lib/parts/format.ts:4` formatPrice ("QAR 12.50"/"12.50 ر.ق"); `lib/email/templates/layout.ts:87` qar; `lib/store/order-email.ts:72,74` qar/qarAr (`<bdi>`); `lib/pricing/plans.ts:100` formatQar (Intl en-US, no symbol); `dashboard/ai-costs/format.ts:62` qarFormatter; `components/studio/RequestReceived.tsx:42` qar (Intl, 0 dp); 3 identical `fmt`: `components/admin/quote-accuracy.tsx:11`, `quote-form.tsx:16`, `quote-calc-card.tsx:12`; `dashboard/store/discounts/page.tsx:77` money; `inventory/page.tsx:79` priceFmt; `schools/classes/[id]/page.tsx:41` money (toFixed(2)); `components/services/services-panel.tsx:45` money | `lib/format/money.ts`: `formatQar(n, locale, {symbol, decimals})`; email variants as thin wrappers | Medium: outputs differ and some are asserted by tests/e2e/emails; merge the three `fmt`s first |
| D-09 | **Rounding to 2 dp**: 17-19 inline `Math.round(x*100)/100` + named copies | `lib/prototyping/kit-money.ts:11` (money), `lib/studio/request-summary.ts:82`, `lib/schools/class-parts.ts:104`, `lib/studio/quote-accuracy.ts:59` (round2), `lib/store/payment.ts:24` (round2), `lib/studio/drawing2d.ts:161`, `lib/studio/enclosure/templates.ts:130`, `dashboard/store/fix/actions.ts:156`, `checkout-client.tsx:~87` | `lib/format/money.ts: round2` | Very low |
| D-10 | **Locale narrowing** `locale === "ar" ? "ar" : "en"`: 71 inline + 6 local functions + 3 local consts | `safeLocale()` in `dashboard/leads/actions.ts:18`, `dashboard/store/actions.ts:21`, `store/orders/actions.ts:17`, `dashboard/reviews/actions.ts:13`, `inventory/actions.ts:15`, `schools/classes/actions.ts:36`; consts `store/youtube/actions.ts:37`, `store/occasions/actions.ts:32`, `store/schools/actions.ts:38`; other names: `lib/seo.ts:22 seoLocale`, `lib/store/search-suggest.ts:57 suggestLocale`, `api/auth/callback/route.ts:44 localeOf`, `lib/auth/next-path.ts:22 localeOf`. Intl tag `"ar-QA-u-nu-latn" : "en-GB"` written 48 times in 46 files | `lib/locale.ts`: `asLocale(x)`, `intlTag(locale)` | Very low |
| D-11 | **Date formatting**: 46 `Intl.DateTimeFormat(` + 8 `toLocale*String` | helpers `lib/email/templates/layout.ts:93`, `lib/store/delivery.ts:64`, `lib/occasions.ts:75,260`, `lib/reviews/reviews.ts:116`, `lib/ai/limits.ts:68`, `lib/youtube-upload.ts:72,77`; admin pages rebuild `dayFmt/timeFmt`: `dashboard/customers/[id]/page.tsx:35-36`, `customers/page.tsx:68-69`, `payments/page.tsx:61-62`, `engineering-jobs/page.tsx:59`, `ai-costs/page.tsx:69-70`, `ai-costs/[userId]/page.tsx:47-48`, `usage/page.tsx:48-49` | `lib/format/date.ts`: `dayFormatter(locale)`, `timeFormatter(locale)` with `timeZone: "Asia/Qatar"` | Low; check time zones (some copies set Asia/Qatar, others rely on server UTC) |
| D-12 | **Day arithmetic**: byte-identical `addDays(iso, days)` | `lib/store/working-days.ts:92`, `lib/store/delivery.ts:97`; ms-per-day: `lib/admin/stock-lists.ts:81`, `lib/orders/admin-rules.ts:120`, `lib/credits/redeem-window.ts:17`, `lib/billing/verify.ts:88`; literals `86400000` in `dashboard/usage/page.tsx:58,118`, `engineering-jobs/page.tsx:63`, `lib/sourcing/api-refresh.ts:80` | Export `addDays` from `working-days.ts`; add `DAY_MS` to a date helper | Very low |
| D-13 | **TS mirrors of SQL rules** (intentional; DB authority; listed so drift is visible) | `lib/store/shipping.ts` (`free_shipping_applies`, 0044); `lib/store/delivery.ts:56 LEAD_CLASS_DAYS` (`lead_class_days()`); `lib/store/working-days.ts` (order_delivery_quote v3, 0054); `lib/prototyping/kit-money.ts` (`create_part_order`); `lib/store/shipping.ts:93` (`is_plausible_email`); `lib/schools/delivery.ts` (test-only, O8); `lib/credits/edu.ts` (test-only, O8); `lib/credits/constants.ts:1-3` ("mirror them for labels only") | Keep; one test per mirror parsing the migration constants (pattern: `lib/notifications/kinds-sync.test.ts`) | n/a |
| D-14 | **Pricing/credit constants**: QAR 20 credit price | `lib/credits/constants.ts:5` CREDIT_QAR (+ alias `:7` AI_PRICE_QAR), `lib/pricing/defaults.ts:63 overage_per_credit_qar: 20`, `lib/pricing/usage-price.ts:~20 minimum_qar: 20`, SQL 0042/0050. QAR/USD single home `lib/pricing/fx.ts:9` (good); service prices via `store_settings` through `lib/pricing/defaults.ts` (good) | `defaults.ts` and `usage-price.ts` import `CREDIT_QAR`; drop `AI_PRICE_QAR` | Low |
| D-15 | **Quantity clamp** `Math.max(min, Math.trunc(qty) \|\| min)` | `lib/parts/cart.ts:67,85` (dead, S6), `components/parts/cart-provider.tsx:286,342,396,435`, `dashboard/store/restock/actions.ts:45`; pack maths centralised in `lib/store/pack.ts` (`packSizeOf`, `packsFor`; consumers `lib/prototyping/bom.ts:25,290`, `components/studio/use-studio-cart.ts:17,36`, `PartsStep.tsx:47`); small copies `Math.max(1, Math.trunc(packSize)\|\|1)` `dashboard/store/attributes/actions.ts:30,56`; alias `packOf` `lib/prototyping/bom.ts:290` | `lib/store/pack.ts: clampQty(qty, min)` | Low |
| D-16 | **Cart implementation layers** | `lib/parts/cart.ts` (localStorage layer, stale header), `lib/parts/cart-snapshot.ts`, `components/parts/cart-provider.tsx` (499 lines; `cart_items` access at 146,151,255,263,300,309,319,322,343,353,364,391,430,458), `components/studio/use-studio-cart.ts`, `components/projects/project-parts-list.tsx`, `lib/projects/parts-list.ts:142 projectCartTotal`. `kitDiscountQar()` in kit-money.ts is the one formula (cart-provider:469, cart/page.tsx:127, parts-list.ts:152, kit-plan.ts:23); `kit_discount_pct` setting read in two places (`cart-provider.tsx:143`, `dashboard/store/attributes/page.tsx:36`) | After S6, `cart.ts` = legacy migration + snapshot + totals | Low |
| D-17 | **Phone**: validation centralised in `lib/phone.ts` (good); leftovers in display and links | `lib/phone.ts:103 formatPhoneDisplay` vs `lib/contact-phone.ts:30` (same regex); `^\+\d{8,15}$` at `lib/phone.ts:93` and `lib/contact-phone.ts:41`; `wa.me` built by hand: `dashboard/customers/[id]/page.tsx:148,359`, `customers/page.tsx:283`, `leads/[id]/page.tsx:88`, `leads/page.tsx:262`, `projects/page.tsx:202`, `store/orders/[id]/page.tsx:286`, `lib/email/lead-email.ts:56`, `lib/contact-phone.ts:19-30`; number triplicated `lib/company.ts:24-25,30-31`; digit-stripping `customers/page.tsx:190,198` | `lib/phone.ts`: `waLink(raw, text?)`; `contact-phone.ts` calls `formatPhoneDisplay`; derive `company.ts` from one E.164 | Low |
| D-18 | **AI cost to QAR** | `cost * COST_MULTIPLIER * QAR_PER_USD` inline: `dashboard/ai-costs/page.tsx:125,173,215`, `ai-costs/[userId]/page.tsx:144,179`; helper `billableQar` `ai-costs/format.ts:57` has zero users (S5). Same rule as `lib/pricing/usage-price.ts` (x10 x 1.12 office tax, round up to 10 QAR); `format.ts:54` takes only the multiplier | Use `billableQar` / `usagePriceQar` consistently | Low; confirm which rule the page should show (pages currently ignore 12 % tax and rounding) |
| D-19 | **"Run migration NNNN first" detection**: 14+ copies | shared `dashboard/ai-costs/format.ts:18 needsMigration` (PGRST202, 42883, 42703, 42P01, PGRST205) used by customers pages; 5 identical local `isMissing(e)`: `schools/classes/page.tsx:22-27`, `classes/[id]/page.tsx:33-38`, `classes/[id]/sheet/page.tsx:41-46`, `classes/[id]/teams/[teamId]/page.tsx:24-29`, `schools/classes/actions.ts:28-33`; `MISSING` sets: `studio-library/actions.ts:23`, `studio-library/[id]/page.tsx:15`, `studio-library/page.tsx:17`, `engineering-jobs/page.tsx:41`, `store/orders/actions.ts:37`; inline: `projects/page.tsx:170`, `usage/page.tsx:240`, `store/gaps/page.tsx:58`, `store/suppliers/page.tsx:63`, `store/actions.ts:365`, `api/projects/recovery-email/route.ts:39`, `api/projects/claim/route.ts:37`, `api/cad/route.ts:50`, `api/cron/anonymous-cleanup/route.ts:27`, `api/admin/store-cleanup/route.ts:255`, `store/checkout/checkout-client.tsx:196-209`; i18n `needsMigration`/`migrationPending` in about 20 namespaces | `lib/supabase/errors.ts`: `isMissingRelation/Function/Column` | Low; longer term most branches deletable now that all 99 migrations are RUN (owner confirms per CLAUDE.md marks; 0028, 0029 never marked) |
| D-20 | **UUID regex**: 14 constants, 2 exported `isUuid` | `projects/[id]/request/page.tsx:26`, `projects/[id]/page.tsx:15`, `projects/[id]/engineering/page.tsx:31`, `dashboard/leads/actions.ts:14`, `dashboard/leads/[id]/page.tsx:29`, `dashboard/ai-costs/format.ts:43`, `dashboard/store/fix/actions.ts:25`, `api/store-lead/route.ts:67`, `lib/studio/server/initial.ts:15`, `lib/projects/recovery.ts:9` (+`isUuid` :11), `lib/orders/rating.ts:16`, `lib/schools/client.ts:20`, `lib/notifications/links.ts:21` (+`isUuid` :83); looser `api/demand/route.ts:13`; unanchored `lib/admin/lead-parse.ts:31`, `lead-kind.ts:18` | `lib/uuid.ts`: `UUID_RE`, `isUuid` | Very low |
| D-21 | **Email address check** | `lib/store/shipping.ts:93 isPlausibleEmail` (importers checkout.ts:3, GetItMade.tsx:22, phone-prompt.tsx:20, new-project-form.tsx:12, recovery-email route:6) and `lib/notifications/decide.ts:139` (identical regex, type-guard variant, used 154,157); zod not used for e-mail anywhere | `lib/email-address.ts` | Very low |
| D-22 | **site_v2 flag parsing and constants** | `lib/site-v2.ts:41 parseSiteV2` + `:20 SITE_V2_KEY` vs `lib/site-v2-server.ts:17 isSiteV2On` (accepts JSON strings) + `:14 SITE_V2_KEY`; `middleware.ts:41-55` own fetch + `parseSiteV2Rows`. Store listing params in three places: `lib/site-v2.ts:29`, `lib/store/catalog.ts:107 STORE_URL_PARAMS`, `next.config.mjs:35` (tests keep equal; middleware copy deliberate for bundle size) | One parse function; disappears with O1 | Low |
| D-23 | **Supabase client creation / env reads**: 5 factories + 4 raw variants | factories `lib/supabase/client.ts:6` (browser, `!` env), `server.ts:10`, `service.ts:9` (null if key missing), `public.ts:9` (anon cookie-free; 29 call sites), `middleware.ts:20-29` (own env read); `lazy.ts`. Raw env: `middleware.ts:39-40`, `lib/auth/providers-server.ts:19-20`, "is Supabase configured?" tests `api/store-lead/route.ts:318-319`, `api/design-quote/route.ts:141-142`, `store/checkout/page.tsx:18`. `createServiceClient()` about 33 call sites; key read at `service.ts:10`, `lib/integrations/youtube-server.ts:35`, `lib/admin/project-export.ts` (redaction), `lib/credits/server.ts:69` (**salt falls back to the service-role key**: `AI_RATE_SALT \|\| SUPABASE_SERVICE_ROLE_KEY`) | `lib/supabase/env.ts`: `supabaseEnv()`, `isSupabaseConfigured()`. Keep the factory split (anon vs service is a security boundary) | Low for env helper. `credits/server.ts:69` fallback is a hygiene item for the security audit (service key reused as rate-limit salt hash; no secret leaves) |
| D-24 | **Storage buckets / path builders / filename sanitizers** | `"payment-proofs"` at `dashboard/payments/page.tsx:107`, `components/payments/fawran-checkout.tsx:57` vs `PROOF_BUCKET` `lib/billing/server.ts:16` (server-only); `"product-images"` at `api/admin/drive-import/route.ts:36`, `lib/store/store-image.ts:24`. 6 sanitizers: `dashboard/engineering-jobs/upload-result.tsx:20 safeName`, `components/design/quote-request.tsx:33 sanitize`, `components/engineering/step-panel.tsx:109`, `lib/studio/client/api.ts:285`, `lib/studio/geometry/product-preview.ts:209 fileSafe`, `lib/studio/client/steps.ts:262 fileSlug`. Path templates `${user.id}/${projectId}/${uuid}…` at `new-project-form.tsx:160`, `project-workspace.tsx:547`, `project-cad-card.tsx:70`, `my-inventory.tsx:395`, `quote-request.tsx:164,184`, `fawran-checkout.tsx:56`, `step-panel.tsx:110`, `studio/client/api.ts:286` | `lib/storage/paths.ts` (buckets, `safeFileName`, `userPath(userId,…)`), client-importable | Low-medium: paths matched by RLS/storage policies (`<uid>/…`) and regex `lib/admin/lead-parse.ts`, `api/store-lead/route.ts:80`; additive changes only |
| D-25 | **HTML escaping** | `lib/email.ts:57 escapeHtml` == `lib/email/brand-layout.ts:34 escapeHtmlText` (byte-identical; `layout.ts:173`/`order-email.ts:76` alias the first). XML twins `lib/prototyping/schematic.ts:69 esc`, `lib/prototyping/netlist.ts:409 esc` | `lib/text/escape.ts` | Very low |
| D-26 | **Email layouts**: already single-sourced | `lib/email/brand-layout.ts renderBrandedEmail` used by `templates/layout.ts:buildEmail`, `store/order-email.ts:78`, `lead-email.ts`, `projects/link-email.ts:4`, `dataTable` in `sourcing/{voltaat-sync:21, api-refresh:14}`. Residue: per-template copy tables and local `qar` (D-08) | none | n/a |
| D-27 | **Text normalisation / stop-words / tokenizers** | `lib/store/search.ts:77 normalizeText` (Arabic-aware, NFKD), `lib/store/similar.ts:6 normalizeName`, `lib/prototyping/bom.ts:112 normaliseFunction` (NFKC, plurals), `lib/billing/verify.ts:78 fold`, `lib/prototyping/bom-match.ts:68 tokens` + `STOP` :54, `lib/sourcing/backup.ts:22 STOP` + `:44 words`, `lib/prototyping/example-photos.ts:11 STOP`, `lib/prototyping/analysis.ts:194 STOP` + own `stem`. Three part-matching engines (`bom-match.ts`; `lib/studio/ai/pick.ts` + Studio library `storeSkus`; `lib/store/similar.ts` + `lib/sourcing/backup.ts`) | One `normalizeText` + `tokenize(stopwords)`; keep the three engines separate | Medium: `bom-match.test.ts` (571 lines) pins ranking; share only the normaliser first |
| D-28 | **Hand-rolled modal dialogs** (11) vs `components/ui/sheet.tsx` | `fixed inset-0` overlays in `turnstile-challenge.tsx`, `studio/ui.tsx`, `prototyping/{part-dialogs,brief-chat,bom-table,client/client-parts}.tsx`, `parts/{request-item-button,delete-part-button}.tsx`, `inventory/delete-item-button.tsx`, `credits/cad-card.tsx`, `admin/order-controls.tsx`; `delete-item-button.tsx:31-52` vs `delete-part-button.tsx:40-61` (22-line clone); `SchematicFrame.tsx:104-120` vs `ui/sheet.tsx:44-60` | Shared `ConfirmDialog` + `Modal` in `components/ui` | Medium: focus, Escape, scroll lock must be retested (a11y gain) |
| D-29 | **Admin forms / page chunks** | `components/admin/occasions-editor.tsx` vs `youtube-editor.tsx`: 5 clones (24, 15, 15, 14, 12 lines at 198-221/228-251, 180-194/202-216, 73-87/78-92, 107-120/115-128, 52-63/52-62). `inventory/item-form.tsx:179-191` vs `parts/part-form.tsx:274-286`. `api/admin/customers/[id]/export/route.ts:3-31` vs `projects/[id]/export/route.ts:3-30` (29 lines). `dashboard/store/page.tsx:279-304` vs `inventory/page.tsx:215-240` (26); `engineering-jobs/page.tsx:167-188` vs `payments/page.tsx:134-155`. `auth/sign-in-form.tsx:128-154` vs `sign-up-form.tsx:213-239` (27, social buttons); `sign-in/page.tsx:33-47` vs `sign-up/page.tsx:29-42`; `institutions/page.tsx:40-54` vs `students/page.tsx:37-51`; v1 vs v2 how-it-works (22 + 12, goes with O1); IC parts `ic_7400/7408/7432/7486.ts:16-38` (data, fine) | `<RepeaterField>`, `<SocialButtons>`, `exportRoute(builder)` | Low each; worthwhile: sign-in/up, export routes |
| D-30 | **Duplicated JSX/geometry in Studio** | `Wiring3DView.tsx:497-519 / 1376-1396 / 1291-1302 / 1306-1314 / 278-286` vs `viewer/Viewer.tsx:242-264 / 720-742 / 549-558 / 628-634 / 191-201` (5 clones, 9-23 lines: camera/controls/lighting); `EnclosureProduct.tsx:216-237` vs `EnclosureTemplate.tsx:404-425`; `EnclosureTemplate.tsx:94-112` vs `PrintStep.tsx:130-149` and `MakeStep.tsx:102-114`; `PrintProduct.tsx` vs `PrintStep.tsx` (95-108/268-281, 130-143/312-325); `studio/cache.ts:23-33` vs `geometry/key.ts:27-37`; `geometry/client.ts:242-258` vs `product/scene/stage.ts:192-202`; `projects/allocation.ts:41-56` vs `:68-83`. Also duplicated symbols: `KEY_DIR/FILL_DIR/RIM_DIR`, `BG`, `EXPOSURE`, `ENV_INTENSITY`, `PCB_ENV_INTENSITY`, `CONTENT_ROT`, `Lights`, `CameraRig`, `OrbitControlsImpl` (Viewer.tsx:62-80,524-750; Wiring3DView.tsx:96-100,1241-1306) | Shared 3D rig (`viewer/rig.tsx`); shared Print/Enclosure sub-components | Medium (3D regression; studio e2e catches most) |
| D-31 | **JSON/CSV helpers** | one CSV writer (`lib/store/restock.ts:95 draftCsv`; `lib/admin/stock-lists.ts:218 groupsCsv` is a wrapper), one CSV parser (`lib/parts/sheet-import.ts:111`) | none | n/a |
| D-32 | **Zod vs hand-written validation** | zod in 22 production files (billing, engineering, cad, studio doc/product, schools pricing, pricing plans, occasions, services quote). Public lead routes (`api/store-lead`, `api/design-quote`, `api/demand`, `api/orders/*`, `api/projects/*`, `api/analyse`) validate by hand. Same data validated twice: e-mail (D-21), UUID (D-20), phone (`lib/phone.ts:79-87` rule; 422 `invalid_phone` enforced in both client forms and two lead routes) | Zod schemas on lead routes importing shared primitives | Medium: money-adjacent public surface; add tests first |

### 4b. jscpd boilerplate clone summary (88 clones)

| Family | Clones | Where | Verdict |
|---|---|---|---|
| Admin layout guard | 8 x 14 lines | 10 `dashboard/*/layout.tsx` (D-02) | extract |
| AI/billing route prelude | 6 x 10 + 4 x 12 lines | api/bom, netlist, firmware, brief-chat, projects/name, billing/*, engineering/jobs (D-05) | extract |
| Customer/project export routes | 1 x 29 lines | `api/admin/{customers,projects}/[id]/export/route.ts:3` | extract `exportRoute()` |
| Occasions vs YouTube editors | 5 (12-24 lines) | `components/admin/occasions-editor.tsx` / `youtube-editor.tsx` (D-29) | extract repeater |
| Sign-in vs sign-up | 27 + 15 lines | `sign-in-form.tsx`/`sign-up-form.tsx`, `sign-in/page.tsx`/`sign-up/page.tsx` | `<SocialButtons>` |
| Dashboard page table/pagination | 26 + 22 lines | `store/page.tsx` vs `inventory/page.tsx`; `engineering-jobs` vs `payments` | extract |
| Studio 3D canvas / print / enclosure | 5 (9-23 lines) + 7 smaller | Wiring3DView vs Viewer; Enclosure*/Print* steps (D-30) | shared rig/hooks |
| v1 vs v2 pages | 22 + 12 lines | how-it-works | goes with O1 |
| Hand-rolled dialogs | 22 lines | delete-item-button vs delete-part-button | `ConfirmDialog` |
| Part-form fields | 13 lines | `item-form.tsx:179-191` vs `part-form.tsx:274-286` | low value |
| IC library data | 3 | `ic_7400/7408/7432/7486.ts:16-38` | data; ignore |
| Self-clone | 1 x 16 lines | `projects/allocation.ts:41-56` vs `:68-83` | local helper |

### 4c. Most important duplication

1. Auth/role guard boilerplate (D-01 to D-06): about 100 sites, 5 response shapes; best value for security consistency.
2. "Missing migration" shims (D-19): 14+ copies, mostly removable now that migrations are RUN.
3. Formatting helpers (D-08 to D-11): 48 locale-tag literals, 46 date formatters, 12 money formatters.
4. Two parallel prototyping UIs (O2): the Engineer view duplicates concepts Studio replaced.

---

## 5. Complexity hot spots

### 5a. Top 40 functions by cyclomatic complexity

| # | CC | file:line | function | # | CC | file:line | function |
|---|---:|---|---|---|---:|---|---|
| 1 | 176 | lib/studio/schematic.ts:147 | renderSchematicSVG | 21 | 57 | app/[l]/store/[sku]/page.tsx:93 | PartDetailPage |
| 2 | 157 | lib/studio/wiring-drawing.ts:272 | renderWiringSVG | 22 | 56 | app/[l]/projects/[id]/engineering/page.tsx:54 | EngineeringPage |
| 3 | 151 | lib/studio/product/solve.ts:651 | solveProduct | 23 | 55 | lib/studio/wiring3d/route.ts:298 | (anonymous) |
| 4 | 124 | components/prototyping/workspace.tsx:138 | PrototypingWorkspace | 24 | 55 | lib/studio/ai/spec-guards.ts:189 | guardSpec |
| 5 | 111 | app/api/store-lead/route.ts:141 | POST | 25 | 55 | lib/studio/ai/pick.ts:161 | enforcePick |
| 6 | 100 | lib/studio/plain-checks.ts:246 | studioChecks | 26 | 54 | app/api/design-quote/route.ts:29 | POST |
| 7 | 92 | lib/prototyping/electronics-rules.ts:170 | deriveElectronics | 27 | 51 | lib/studio/wiring3d/layout.ts:239 | layoutMat |
| 8 | 92 | components/prototyping/bom-table.tsx:651 | Row | 28 | 51 | app/[l]/store/checkout/checkout-client.tsx:37 | CheckoutClient |
| 9 | 88 | lib/studio/netlist.ts:573 | buildNetlist | 29 | 50 | components/credits/cad-card.tsx:90 | CadCard |
| 10 | 82 | app/[l]/dashboard/customers/[id]/page.tsx:24 | CustomerPage | 30 | 49 | lib/studio/wiring3d/breadboard.ts:176 | plugFor |
| 11 | 79 | lib/admin/project-export.ts:81 | buildProjectExport | 31 | 46 | app/api/analyse/route.ts:80 | start |
| 12 | 71 | lib/admin/customer-export.ts:155 | buildCustomerExport | 32 | 45 | lib/prototyping/readiness.ts:110 | projectReadiness |
| 13 | 70 | lib/studio/sim/step.ts:142 | step | 33 | 45 | components/parts/part-form.tsx:25 | PartForm |
| 14 | 70 | components/studio/StudioShell.tsx:122 | StudioShellInner | 34 | 45 | app/[l]/store/checkout/checkout-client.tsx:132 | handleSubmit |
| 15 | 70 | app/api/admin/youtube/upload/route.ts:70 | POST | 35 | 44 | lib/studio/card-parts.ts:121 | cardItems |
| 16 | 66 | lib/prototyping/bom-match.ts:279 | matchLine | 36 | 43 | lib/studio/sim/model.ts:214 | simModel |
| 17 | 64 | components/studio/steps/EnclosureProduct.tsx:54 | EnclosureProduct | 37 | 43 | components/studio/steps/PartsStep.tsx:609 | PartsPicturePane |
| 18 | 63 | components/studio/steps/EnclosureTemplate.tsx:82 | EnclosureTemplateFlow | 38 | 42 | app/[l]/dashboard/usage/page.tsx:39 | UsagePage |
| 19 | 63 | components/prototyping/idea-stage.tsx:101 | IdeaStage | 39 | 41 | components/studio/steps/IdeaStep.tsx:56 | IdeaStep |
| 20 | 59 | lib/sourcing/spec-map.ts:48 | parametersToAttributes | 40 | 41 | components/admin/videos-youtube.tsx:210 | ClipRow |

Observation: 4 of the top 40 functions (`PrototypingWorkspace`, `Row`, `IdeaStage`, `CadCard`) and 2 of the 14 split files (`workspace.tsx`, `bom-table.tsx`) live in the Engineer view; if O2 is accepted they leave the split list.

### 5b. Longest functions (top 25 by lines)

Lines, file:line, function: 1081 components/prototyping/workspace.tsx:138 PrototypingWorkspace; 638 lib/studio/product/solve.ts:651 solveProduct; 620 components/studio/steps/wiring/Wiring3DView.tsx:486 Scene; 608 app/[l]/dashboard/customers/[id]/page.tsx:24 CustomerPage; 561 lib/studio/schematic.ts:147 renderSchematicSVG; 561 components/studio/StudioShell.tsx:122 StudioShellInner; 462 app/[l]/store/checkout/checkout-client.tsx:37 CheckoutClient; 443 components/prototyping/idea-stage.tsx:101 IdeaStage; 432 components/studio/steps/EnclosureTemplate.tsx:82 EnclosureTemplateFlow; 428 components/credits/cad-card.tsx:90 CadCard; 412 app/[l]/projects/[id]/engineering/page.tsx:54 EngineeringPage; 396 components/admin/studio-library/part-form.tsx:42 StudioPartForm; 395 lib/prototyping/electronics-rules.ts:170 deriveElectronics; 382 lib/studio/wiring-drawing.ts:272 renderWiringSVG; 372 app/[l]/pricing/page.tsx:49 PricingPage; 361 components/admin/fix-list.tsx:53 FixList; 357 components/studio/steps/PartsStep.tsx:154 PartsStep; 356 components/design/quote-request.tsx:43 QuoteRequest; 354 components/prototyping/tree-nav.tsx:73 TreeNav; 346 app/[l]/dashboard/store/orders/[id]/page.tsx:29 OrderDetailPage; 344 components/studio/GetItMade.tsx:38 GetItMade; 337 components/parts/cart-provider.tsx:110 CartProvider; 333 app/[l]/dashboard/usage/page.tsx:39 UsagePage; 330 components/studio/steps/EnclosureProduct.tsx:54 EnclosureProduct; 330 components/projects/new-project-form.tsx:36 NewProjectForm.

### 5c. Proposed splits (14 files)

Rule for every split: the original path stays as a thin barrel / entry component re-exporting the public API, so importers do not change in the first pass. Importers: schema.ts 61 `@/` importers, netlist.ts 16 (+ relative), others 0-1. Line ranges inside functions are approximate (confirm when splitting).

Payoff ranking: (1) checkout totals + place-order out of `checkout-client.tsx` (money path, currently untested); (2) shared customer bundle for page + export; (3) shared viewer rig for Viewer/Wiring3DView; (4) the cycle-breaking extractions (section 5d).

| # | File (lines) | New module | Moves |
|---|---|---|---|
| 1 | components/studio/steps/wiring/Wiring3DView.tsx (1402) (public `Wiring3DView({doc, locale})`, L172) | wiring/wiring3d-constants.ts | consts L95-115, `movesKey/loadMoves/saveMoves` L117-144 |
|  |  | wiring/WireMaterials.ts | `wireMaterial`, `sleeveGeometry`, `hitMaterial`, `noRaycast` L414-450 |
|  |  | wiring/WiringScene.tsx | `Scene` L486-1172 split into hooks `useWires` (L571-661), `useBuildGuide` (L663-690), `usePinDecals` (L691-739), `useSimOverlay` (L740-771), `useMatDrag` (L974-1105), `usePointerHover` (L952-973); `Scene` keeps the useFrame loop L882 |
|  |  | wiring/WiringRig.tsx | `Mat`, `BreadboardModel`, `Lights`, `CameraRig` L1192-end; `Lights`/`CameraRig`/light consts identical to viewer/Viewer.tsx -> move to `viewer/rig.tsx`, import from both |
|  |  | stays | component L172-398, `EndLabel`, `CanvasBoundary`, `hasWebGL` |
| 2 | lib/studio/product/solve.ts (1387) (public `solveProduct`, `solvedHash`, `MK4_BED`, 19 exports) | product/solve-types.ts | types L83-208 (SolvedProduct, SolverIssue, PrintPlan, ...) |
|  |  | product/solve-geometry.ts | `localBox`, `fitsMk4`, `poseSize`, `gramsFor`, `contactAnchor`, `splitOffset`, `isStacked`, `unionBoxes`, `toLocal/toWorld` L240-313, L381-382, L1355 |
|  |  | product/solve-place.ts | `placeBodies` L321-380 + pass 1/2 placement blocks of solveProduct (L776-966) |
|  |  | product/solve-fit.ts | `fitInside`, `pushToWalls`, `widestSection`, `ensureHomes`, `resolveShell` L384-646 |
|  |  | product/solve-checks.ts | floating/overlap/USB/outlet checks (~L1097-1200), printability + explode (~L1207-1355), `dedupeIssues` |
|  |  | stays | `solve.ts`: orchestrator (~150 lines), `solvedHash`, type re-exports |
| 3 | components/prototyping/workspace.tsx (1370) (public `PrototypingWorkspace`; goes away with O2) | prototyping/use-workspace-data.ts | `load`, `loadMatches`, project/parts/items state L165-380 |
|  |  | prototyping/use-workspace-actions.ts | `patchProject`, `goTo`, `saveSpec`, `setBranch`, `acceptRoute`, `chooseProduct`, `dismissLines`, `chooseRoute` L428-534 |
|  |  | prototyping/use-panels.ts | `PANELS_KEY`, `savedPanels`, `togglePanel`, view mode L119-137, L254-290 |
|  |  | prototyping/workspace-stages.tsx | `designStage`, `bomTable`, `stageAction`, `fixButton`, node switch (render L538-1370) |
|  |  | stays | shell, header bar, not-available state |
| 4 | components/projects/project-workspace.tsx (1080) | projects/use-project-data.ts | `useBomMatches` (L80), `load` L138-233 |
|  |  | projects/project-header.tsx | `ProjectHeader`, `PrototypingCard`, `ProjectSkeleton` L328-434 |
|  |  | projects/brief-card.tsx | `BriefCard` L440-506 |
|  |  | projects/blocks-card.tsx | `BlocksCard`, `IconBtn` L509-724 |
|  |  | projects/items-card.tsx | `ItemsCard`, `ItemStatusTags` L727-977 |
|  |  | projects/danger-zone-card.tsx | `DangerZoneCard` L981-end |
|  |  | stays | `ProjectWorkspace` L114-327 |
| 5 | lib/studio/netlist.ts (1008) (47 exports, 16 external importers; re-export everything) | studio/netlist-parts.ts | role/part predicates L27-111, `splitRef`, `chargerPins`, `shifterChannels`, `RAIL_RANGE`, `DEV_TO_MCU/MCU_TO_DEV`, `servoSupplyRail` (breaks cycle with plain-checks) |
|  |  | studio/netlist-power.ts | `Rail`, `planPower`, `railFor`, `effectiveLogic` L159-338 |
|  |  | studio/netlist-required.ts | `resolveRequired`, `ADDED_REASON` L339-458 |
|  |  | studio/netlist-build.ts | `NetBook`, `PinPool`, `netCodes`, `buildNetlist` L459-834 |
|  |  | studio/netlist-legacy.ts | `toLegacyNetlist`, `legacyFunction`, `buildWiring` L835-1008 |
|  |  | stays | `netlist.ts` barrel |
| 6 | components/prototyping/bom-table.tsx (965) (goes away with O2) | prototyping/bom-cost-summary.tsx | `CostSummary` L98-165 |
|  |  | prototyping/bom-quote-request.tsx | `QuoteRequest` L166-338 (name clashes with `components/design/quote-request.tsx`; rename `BomQuoteRequest`) |
|  |  | prototyping/use-is-super-admin.ts | `useIsSuperAdmin` L339-364 (calls Supabase from a component) |
|  |  | prototyping/bom-row.tsx | `Row` L651-953 (CC 92), `Why` L954 |
|  |  | prototyping/use-bom-actions.ts | `add`, `buyKit`, order status effect L427-485 |
|  |  | stays | `BomTable` L365-650 |
| 7 | lib/studio/schema.ts (889) (113 exports, 61 importers) | studio/schema-enums.ts | enum arrays and derived types L18-123 + `LIMITS` L129 |
|  |  | studio/schema-zod.ts | Zod schemas L154-445 |
|  |  | studio/schema-clamp.ts | `ClampLog`, `pickEnum`, `clampNum/Str`, `clampSpec`, `clampActuators`, `clampUnderstanding`, `clampEnclosure`, `clampMechPart(s)` L446-870 |
|  |  | studio/schema-defaults.ts | `DEFAULT_SPEC`, `DEFAULT_ENCLOSURE`, `PHASE_TEMPLATES`, `THROUGH_LID`, `MECH_PARAMS`, `emptyStudioDoc`, `parseStudioDoc` |
|  |  | stays | barrel with `export *`; `ARCHETYPES/Archetype` moves to a leaf (cycle fix) |
| 8 | components/studio/StudioShell.tsx (856) (public `StudioShell`, `StudioCtx`) | studio/studio-ctx.ts | `StudioCtx` L69-78 (cycle fix) |
|  |  | studio/use-studio-save.ts | refs, `refreshStatus`, `flush`, `commit`, retry effect L132-250 |
|  |  | studio/use-studio-navigation.ts | `go`, `next`, `furthest`, URL/step effects L251-345 |
|  |  | studio/use-studio-handlers.ts | `docForCard`, `onIdeaConfirmed`, `onIdeaDraft`, `onComponents`, `onWiring`, `onEnclosure`, `onMech`, `onFirmware`, `showIn*`, `onProduct*` L370-540 |
|  |  | studio/studio-banners.tsx | `FadedBanner`, `ClassBanner`, `StepSlide`, `sameBoard` L761-856 |
|  |  | stays | `StudioShell` / `StudioShellInner` render |
| 9 | components/studio/steps/PartsStep.tsx (841) | steps/parts/PartTile.tsx | `CATEGORY_ICON`, `PartTile`, `PartPopover` L60-153 |
|  |  | steps/parts/PartChoices.tsx | `PartChoices` L538-582 |
|  |  | steps/parts/PartsPicturePane.tsx | `usePictureSize`, `PartsPicturePane` (CC 43; imported by MakeStep.tsx:30), `PartsSpots` L583-841 |
|  |  | steps/parts/use-parts-actions.ts | `pick`, `swap`, `add`, `edit`, colour-backfill effect L185-260 |
|  |  | stays | `PartsStep` |
| 10 | lib/studio/wiring3d/layout.ts (829) | wiring3d/types.ts | `MatItem`, `PlacedHole`, `Placement`, `MatLayout`, `Rot` L54-92 (cycle fix with rails.ts) |
|  |  | wiring3d/pose.ts | `GAP..FIRST_COL`, `rotXY`, `poseLocal`, `pinWorld`, `footprint` L94-148 |
|  |  | wiring3d/layout-mat.ts | `linksOf`, `pinNetMap`, `helperLegs`, `occupantOf`, `plugged`, `unplugged`, `layoutMat` (CC 51), `servoGroup`, `rotToward`, `boundsOf` L149-694 |
|  |  | wiring3d/move.ts | `MatMoves`, `obstacles`, `resolveMove`, `snapToBreadboard`, `settleMove`, `movePart`, `applyMoves`, `apartLift` L695-829 |
|  |  | stays | `layout.ts` barrel (1 importer via `@/`) |
| 11 | components/studio/viewer/Viewer.tsx (776) | viewer/rig.tsx | `Lights`, `placeLights`, `CameraRig`, `boundsAt`, light constants L524-750 (shared with Wiring3DView) |
|  |  | viewer/Plate.tsx | `Plate` L750-776 |
|  |  | viewer/use-viewer-placements.ts | placements/explode/enclosure keys L263-343 of `Scene` |
|  |  | viewer/ViewerScene.tsx | `Scene` L225-523 |
|  |  | stays | `Viewer` L84-224 (default export), type re-exports |
| 12 | lib/studio/schematic.ts (758) (`renderSchematicSVG` CC 176, 561 lines; same shape applies to `lib/studio/wiring-drawing.ts`, CC 157) | studio/schematic-style.ts | look/size consts L47-81, `KIND_TEXT`, `POWER_TEXT`, `ENV_TEXT`, `CHIP`, `summaryLine` L66-110 |
|  |  | studio/schematic-model.ts | entries, net kinds/colours, inline chains, board pin sides (L147-420) as pure `buildSchematicModel()` |
|  |  | studio/schematic-layout.ts | column order, vertical + horizontal layout, wire routing, `clash` |
|  |  | studio/schematic-svg.ts | string emission only |
|  |  | stays | `SchematicOpts`, `renderSchematicSVG` = model -> layout -> svg |
| 13 | app/[l]/dashboard/customers/[id]/page.tsx (691) | lib/admin/customer-data.ts | the 14 queries L48-100 + `soft()`; `lib/admin/customer-export.ts:172-197` runs the same 13 queries, so both use one `loadCustomerBundle(db, id)` |
|  |  | app/…/customers/[id]/sections/*.tsx | one server component per `Panel` (profile, projects, orders, items, leads, ledger, payments, pass, sessions, ai, jobs, cad, signals, outbox; L212-660) |
|  |  | app/…/customers/[id]/panel.tsx | `Panel` L666-691 |
|  |  | stays | `page.tsx`: auth, bundle load, header (L198), section list (< 120 lines) |
| 14 | app/[l]/store/checkout/checkout-client.tsx (563) | lib/store/checkout-totals.ts | `priceOf`, `splitExtraQar`, `creditQar`, `grandTotal`, `placedTotal` (L62-97, L232) as pure functions + test |
|  |  | lib/store/place-order.ts | `handleSubmit` core L132-300: validation (L141-165), RPC call with PGRST202 fallbacks (L183-215), `redeem_credits`, `set_order_payment_method`, `LAST_ORDER_KEY` snapshot; takes a supabase client, returns `{ok, orderId} or {error key}` |
|  |  | app/…/checkout/order-summary.tsx | right-hand summary and tier picker |
|  |  | app/…/checkout/customer-fields.tsx | form fields, `label`, `mono` |
|  |  | stays | `CheckoutClient` state + submit wiring |

### 5d. Import cycles (madge, 20) and the 5-edit fix

Pattern A (12 cycles; #7, 9-19): every step does `import type { StudioCtx } from "../StudioShell"` while StudioShell imports the step. Type-only, erased at build, no runtime bug, but madge goes red and it blocks splitting StudioShell. Fix: `components/studio/studio-ctx.ts` exporting `StudioCtx` (defined StudioShell.tsx:69-78; needs only `StudioApi`, `Locale`, `FlowStep`), re-export from StudioShell, change 12 imports: steps/CodeStep.tsx:20, EnclosureStep.tsx:19, EnclosureProduct.tsx:42, ProductEngineer.tsx:15, share.tsx:16, EnclosureTemplate.tsx:51, IdeaStep.tsx:48, MakeStep.tsx:26, PartsStep.tsx:44, PrintStep.tsx:43, PrintProduct.tsx:18, WiringStep.tsx:24.

| # | cycle | edge that closes it | cheapest fix |
|---|---|---|---|
| 1 | lib/prototyping/bom.ts <> electronics-rules.ts | bom.ts:51 `import("./electronics-rules").LevelFlag[]` (type) vs electronics-rules.ts:35 `import type { ProjectLine } from "./bom"` | move `LevelFlag` (electronics-rules.ts:53) to `lib/prototyping/analysis.ts`; re-export (plain-safety.ts:9 imports it) |
| 2 | lib/supabase/types.ts <> prototyping/bom.ts | types.ts:4 `import type { ProjectBom }` vs bom.ts:22 `import type { Part }` | `lib/prototyping/bom-types.ts` with `ProjectLine/ProjectBom/LineOrigin/Fulfilled` (bom.ts:28-56) |
| 3 | lib/studio/schema.ts > product/schema.ts > forms/clamp.ts > forms/params.ts | schema.ts:16 `import type { Archetype } from "./product/schema"` (used once, schema.ts:397) | move `ARCHETYPES/Archetype` (product/schema.ts:26-31) to leaf `lib/studio/product/archetype-names.ts` |
| 4 | schema.ts > product/schema.ts > forms/clamp.ts | same edge (clamp.ts:7, params.ts:16 import `../../schema`) | same as #3 |
| 5 | schema.ts > product/schema.ts | same edge | same as #3 (one edge closes #3, #4, #5) |
| 6 | lib/youtube-upload.ts <> youtube-retire.ts | youtube-upload.ts:23 `parseRetireList` (runtime) vs youtube-retire.ts:14 `import type { YoutubeMeta }` | move `YoutubeMeta/UploadRecord/QuotaState` (youtube-upload.ts:124-131) to `lib/youtube-types.ts`; re-export |
| 7, 9-19 | StudioShell <> 12 step files | pattern A | `studio-ctx.ts` |
| 8 | lib/studio/netlist.ts <> plain-checks.ts | netlist.ts:24,1006 `studioChecks` (runtime) vs plain-checks.ts:13-38 imports 13 runtime helpers (`isMcu`, `splitRef`, `RAIL_RANGE`, `DEV_TO_MCU`, ...). Only real runtime cycle; works because use is at call time, a top-level const read would hit TDZ | extract netlist.ts:27-111, 117, 134, 185, 300-303, 841 to `studio/netlist-parts.ts` |
| 20 | lib/studio/wiring3d/layout.ts <> rails.ts | layout.ts:52 `railNets` (runtime) vs rails.ts:12 `import type { MatLayout }` | move `MatItem/Placement/MatLayout` (layout.ts:56-92) to `wiring3d/types.ts` |

Net: 5-6 small edits remove all 20 cycles. Then add `madge --circular --extensions ts,tsx --ts-config tsconfig.json app components lib` as a CI script.

---

## 6. Layering

### 6a. Data-access styles (non-test call sites)

| # | Style | Evidence | Size |
|---|---|---|---|
| 1 | Server component / page, RLS client (`lib/supabase/server`) | `.from(`/`.rpc(` in 49 `page.tsx`, plus 3 async components (`components/dashboard/admin-overview.tsx` 18 calls, `admin-home.tsx`, `continue-card.tsx`) | app/[locale]: 229 `.from` + 30 `.rpc` in 76 files |
| 2 | Server component, service-role client | `supabase/service` imported by 5 pages | with routes 17, actions 1, lib 5 |
| 3 | Server action | 26 `"use server"` files, 25 query the DB | all under dashboard, inventory, schools |
| 4 | API route + browser `fetch("/api/...")` | 62 routes (91 `.from`, 27 `.rpc` in 34 files); 33 client files fetch `/api` (`lib/studio/client/api.ts` 3, `components/engineering/step-panel.tsx` 3, `prototyping/workspace.tsx` 2, `projects/new-project-form.tsx` 2, `admin/voltaat-sync.tsx` 2) | |
| 5 | Browser Supabase client direct | 33 files in components/ + `checkout-client.tsx` import `supabase/client`; 134 `.from` + 10 `.rpc` in 30 component files | `project-workspace.tsx` 21, `cart-provider.tsx` 19, `workspace.tsx` 10, `my-inventory.tsx` 7, `your-work-strip.tsx` 7, `project-list.tsx` 6 |
| 6 | RPC (SECURITY DEFINER) from any of the above | 105 `.rpc(` sites: app/api 27, app/[locale] 30, components 10, lib 38 | `create_part_order` called from the browser (`checkout-client.tsx:183`) |
| 7 | lib data modules | 49 lib files, 151 `.from` + 38 `.rpc` (`lib/store/public-catalog.ts` cached anon reads, `lib/studio/server/*`, `lib/credits/server.ts`) | only layer with a clear boundary |
| 8 | Raw PostgREST fetch | `middleware.ts` site_v2 flag; `lib/supabase/middleware.ts` | 1 place |

8 styles; 44 distinct tables hit via `.from()`, 12 with hand types (section 8). The same query is written 2-3 times: customer detail page (`page.tsx:48-100`) vs `lib/admin/customer-export.ts:172-197`; open-order status lists in `admin-overview.tsx:61` vs `lib/orders/status.ts:36 OPEN_ORDER_STATUSES` vs `lib/admin/home-tiles.ts:13 ORDER_STATUSES_TO_HANDLE` (three different lists; the first omits "shipped").

### 6b. Business rules sitting in pages/components

| Rule | Where | Belongs in |
|---|---|---|
| Order total = goods - credit + shipping + handling, rounded | `app/[l]/store/checkout/checkout-client.tsx:62-90` (`priceOf`, `splitExtraQar`, `creditQar`, `grandTotal`), `:232 placedTotal` | `lib/store/checkout-totals.ts` + test (server RPC is authority; a test should pin both) |
| Cart total with kit discount | `components/parts/cart-provider.tsx:479-482` (`cartTotal`, `kitDiscountQar` in `lib/parts/cart.ts`, untested) | `lib/parts/cart.ts` + test |
| Landed cost and suggested price (FX, overhead, markup, ceil 0.5) | `components/admin/supplier-lookup.tsx:107-108` | `lib/sourcing` or `lib/pricing` |
| Estimated revenue | `app/[l]/dashboard/store/restock/page.tsx:91` | `lib/store/restock.ts` (exists, tested) |
| Fixed-price write rounding | `dashboard/store/fix/actions.ts:156`, `usage/actions.ts:17` | `lib/pricing` |
| "Open order" status set | `components/dashboard/admin-overview.tsx:61` | `lib/orders/status.ts` (`OPEN_ORDER_STATUSES`) |
| ETA / overdue minutes | `dashboard/engineering-jobs/page.tsx:63,146-153` | `lib/engineering/view.ts` (untested) |
| Week/month windows | `admin-overview.tsx:33-34`, `store/overview/page.tsx:66`, `engineering-jobs/page.tsx:63`, `usage/page.tsx:58,118` (`86400000`, `864e5`) | `lib/dates` |
| Credit redeemable-until check | `dashboard/credits/page.tsx:275-276` | `lib/credits/redeem-window.ts` (exists) |
| "Order confirmation allowed within 60 minutes" | `app/api/orders/confirmation/route.ts:26` | `lib/orders` |
| Form validation (required, phone, email, totals) | `checkout-client.tsx:141-165`; `components/design/quote-request.tsx`; `components/projects/new-project-form.tsx` | `lib/*/validate.ts`, ideally zod |
| super_admin check | inline 79 times in 129 files; 8 copy-pasted `requireAdmin()` (D-01) | `lib/auth/require.ts` |

### 6c. Components that call Supabase directly (33 files)

admin/studio-library/part-form.tsx; auth/{forgot-password,reset-password,sign-in,sign-out,sign-up,social-sign-in}; credits/cad-card.tsx; dashboard/{admin-home,admin-overview,continue-card} (server); design/quote-request.tsx; inventory/my-inventory.tsx; parts/add-to-project-button.tsx; projects/{new-project-chat,new-project-form,project-cad-card,project-list,project-parts-list,project-workspace}.tsx; prototyping/{bom-table,client/client-wiring,client/client-workspace,idea-stage,netlist-view,part-dialogs,parts-list,parts-stage,payment-card,schematics-stage,use-project-boards,workspace}; schools/join-form.tsx; search/unified-search.tsx; studio/DeleteProject.tsx.

Auth forms are expected. The rest (project, prototyping, inventory, cart) are candidates to move behind lib hooks or server actions; the prototyping ones disappear with O2. Six more component files run `.from(` without a static `supabase/client` import (`home/your-work-strip.tsx`, `pricing/invite-price.tsx`, `projects/phone-prompt.tsx`, `payments/fawran-checkout.tsx`, `parts/cart-provider.tsx`, `parts/add-to-project-button.tsx`); likely via `lib/supabase/lazy.ts` (unverified).

### 6d. Impure lib/

| Module | Issue |
|---|---|
| `lib/credits/use-credits.ts:16`, `lib/pricing/use-price-quote.ts:10`, `lib/schools/client.ts:16`, `lib/store/use-delivery-quote.ts:3` | React hooks in lib/ (belong in components/hooks or `lib/*/client`) |
| `lib/contact-phone-server.ts:13`, `lib/store/shipping-settings.ts:7` | `react` `cache()`; server-only in practice but not marked `server-only` |
| `lib/meta.ts:6`, `lib/admin/project-export.ts:12`, `lib/prototyping/electronics-build.ts:18`, `lib/prototyping/providers/rules.ts:7` | `next-intl/server` `getTranslations` inside domain logic: not unit-testable without Next |
| `lib/supabase/server.ts:1`, `lib/supabase/middleware.ts:1` | `next/headers`, `next/server` (expected) |
| `unstable_cache`: `lib/site-v2-server.ts:8`, `contact-phone-server.ts:14`, `turnstile-server.ts:1`, `studio/cad-setting.ts:6`, `studio/library/remote.ts:7`, `auth/providers-server.ts:10`, `cad/engine-server.ts:6`, `store/public-catalog.ts:13`, `store/shipping-settings.ts:8`, `cache/storefront.ts:29` | caching in lib is acceptable; only 10 lib files carry `server-only` |
| 14 lib files with `"use client"` (`lib/studio/client/*`, `lib/supabase/{lazy,guest}.ts`, `lib/google/drive-picker.ts`, `lib/cad/render.ts`, ...) | client code in lib/ |

### 6e. API routes with logic that belongs in lib/

| Route | Lines / CC | Logic inside |
|---|---|---|
| `app/api/store-lead/route.ts` | 388 / 111 | `SOURCES` label table (:27-66), STL path validation `printFiles` (:74), `leadAllowed` (Turnstile, :108), `quoteItems` (:123), lead insert, owner email -> `lib/leads/{sources,parse,save}.ts` |
| `app/api/admin/youtube/upload/route.ts` | 309 / 70 | resumable upload, captions, thumbnails, `store_settings` writes (:108-290) -> `lib/integrations/youtube-server.ts` (exists, untested) |
| `app/api/analyse/route.ts` | 235 / 46 | credit gate, daily guard, provider call, metering stream, `analysis_runs` writes -> `lib/prototyping/analyse-run.ts` |
| `app/api/design-quote/route.ts` | 191 / 54 | validation, signed upload paths, inquiry insert |
| `app/api/orders/review/route.ts` | 162 | HTML page rendering, token check, RPC |
| `app/api/cron/delivery-promises/route.ts` | 116 | re-quote delivery date with holidays/handling/transit/buffer (:37-101) -> `lib/store/delivery-promises.ts` (`working-days.ts` exists and is tested) |
| `app/api/orders/confirmation/route.ts` | 58 | 60-minute window, claim-then-send idempotency, Arabic name lookup, holidays flag |
| `app/api/admin/{customers,projects}/[id]/export/route.ts` | 29 duplicated lines | shared admin gate + zip response helper |

Pattern to copy: `app/api/studio/*` are thin routes over `lib/studio/server/*` (tested in `lib/studio/server/product-routes.test.ts`).

---

## 7. Consistency

### 7a. Naming

| Area | State |
|---|---|
| components/ (258 files) | kebab-case 213, PascalCase 45; every folder is pure kebab except `components/studio/**` (Pascal 42, kebab 11): studio 9 Pascal + 4 kebab; steps 13 + 2; steps/code 3 + 0; steps/wiring 9 + 4; viewer 11 + 5 |
| lib/ | kebab (406) except 47 snake_case + 18 camelCase part-definition data files in `lib/studio/library/parts` (named after part ids) |
| app/ | 100 % kebab |
| Structure collisions | `lib/email.ts` next to `lib/email/`; `lib/youtube*.ts` x4 at root; `lib/store`, `lib/parts`, `lib/sourcing`, `lib/inventory` overlap; `components/payment/` and `components/payments/` |

### 7b. Error-handling shapes (5 for routes, 7 for actions)

| Context | Shape (count) |
|---|---|
| API routes | `Response.json({ error: "code" }, {status})` 119; `NextResponse.json({ error })` 16 (mixed class use); empty `new Response(null,{status})` 45; success bodies `{ ok: true }` 11+8, `{ sent }` 9, bespoke (`{tokens}`, `{doc}`, `{job}`...); error values include `r.error`, `cur.error`, `denied.error` passthroughs (30+) |
| Server actions | `{ ok: false, error: "code" }` 64; `{ ok: false, message }` 8; `{ ok: false, errors: [...] }` 8; `{ ok: false, error, bad }`; `{ ok: false, checks }`; `{ error?: string }` (PartFormState, ItemFormState); `{ ok } \| null` (OrderStatusState); about 30 named result types (SaveResult, ClassActionResult, ...) |
| lib | `{ ok: false ... }` 168 sites; `throw new Error` 47 (lib), 14 (actions), 2 (routes) |
| Redirects | `redirect(` 30 in actions |

No shared `Result<T,E>` type.

### 7c. Loading / empty / error states

| Item | Count |
|---|---|
| `loading.tsx` | **0** |
| `error.tsx` / `global-error.tsx` | **0** |
| `not-found.tsx` | 2 (`app/not-found.tsx`, `app/[locale]/not-found.tsx`); `notFound()` called in 24 pages |
| `<Suspense>` | 6 files |
| Class error boundaries | 2 (`components/studio/viewer/LeanCanvas.tsx`, `Wiring3DView.tsx`) |
| Consequence | a thrown server error on any of 104 pages shows Next's default error page; 137 files carry `force-dynamic` |

### 7d. Server/client boundary

`"use client"`: 219 files (components 200, app 5, lib 14). Client pages: `store/cart/page.tsx`, `store/checkout/success/page.tsx`. Likely server-capable (no hooks except next-intl, no handlers, no browser APIs): `components/prototyping/client/step-card.tsx`, `client/client-make.tsx`, `studio/steps/code/WireSnippet.tsx`, `feature-video-client.tsx` (parent probably already server; unverified). The other 7 flagged by the heuristic need the directive (`useActionState`, `dynamic(ssr:false)` wrappers).

### 7e. Validation: zod vs hand-written

zod in 22 non-test files (8 routes: studio/doc, studio/product/engineer, cad, engineering/jobs, engineering/jobs/[id]/return, billing/{service,proof,checkout}). Of 62 routes, 26 call `request.json()`, 21 of those cast the result with `as {...}` instead of parsing. 10 server actions read `FormData.get` by hand. So 54 of 62 routes use hand checks (`typeof x === "string"`, regex, `clamp*`). See D-32.

### 7f. Formatters (references outside definition, non-test)

| Helper | Defined | Refs / files |
|---|---|---|
| formatPrice (QAR, 2 dp, "ر.ق") | lib/parts/format.ts:4 | 107 / 30 |
| formatQar (en-US grouping) | lib/pricing/plans.ts:100 | 56 / 17 |
| qar (email; int-or-2dp) | lib/email/templates/layout.ts:87 | 8 / lib/email |
| qarAmount | lib/store/shipping.ts:88 | 4 / 3 |
| qarFormatter / usdFormatter | app/[l]/dashboard/ai-costs/format.ts:62,7 | 10 / 6 and 6 / 4 |
| local `qar()` | components/studio/RequestReceived.tsx:42 | 1 |
| local `fmt()` | components/admin/quote-form.tsx:16, quote-calc-card.tsx:12, quote-accuracy.tsx:11 | 3 copies |
| local `money` | schools/classes/[id]/page.tsx:41 (`toFixed(2)`), dashboard/store/discounts/page.tsx:77, kit-money.ts:11, services-panel.tsx:45 | 4 |
| formatDeliveryDate | lib/store/delivery.ts:64 | 29 / 8 |
| formatOccasionDate / formatReviewDate / email `formatDate` | lib/occasions.ts:255, lib/reviews/reviews.ts:113, lib/email/templates/layout.ts:93 | 6 / 4 / 7 |
| `Intl.DateTimeFormat(` inline | 46 sites in 37 files; locale tags `en-GB` x51, `ar-QA-u-nu-latn` x46, `ar-QA` x5, `en-US` x6 | |
| `Intl.NumberFormat(` inline | 17 | |
| `toLocale*String` | 8 | |
| formatPhoneDisplay / toWhatsAppDigits / normalizePhone / isValidPhone | lib/phone.ts | 27 / 19 / 22 / 32 (one module, consistent) |
| formatFileSize | lib/format-bytes.ts:8 | 8 / 5 |
| arabicCountForm | lib/text/count.ts | 43 / 20 |
| `Math.round(x*100)/100` | 19 sites (5 in app/components) | |

Result: 7 money formatters with 3 different outputs ("QAR 12.50", "12.50 ر.ق", "12.5", grouped), none uses Intl currency; date format strings re-declared in 37 files.

### 7g. Locale handling

| Item | Count / location |
|---|---|
| `Locale` union declared | 13 times: `i18n/routing.ts:8` (canonical) plus `app/api/orders/rate/route.ts:20`, `unsubscribe/route.ts:15`, `lib/seo.ts:15`, `studio/netlist.ts:28`, `studio/client/api.ts:22`, `prototyping/plain-names.ts:16`, `orders/rating-page.ts:10`, `email/brand-layout.ts:16`, `studio/ai/spec-guards.ts:18`, `reviews/reviews.ts:5`, `email/templates/layout.ts:10`, `orders/review/route.ts:21` |
| `locale === "ar"` | 254 times; `isRtl/isAr` re-derived in 102 places |
| Helpers | `i18n/{routing,request,navigation}.ts`, `lib/i18n/{scopes,pick-messages}.ts`, `lib/text/bidi.ts`; none for `isRtl(locale)`, `dir()` or `pick(locale, {en, ar})` |
| `setRequestLocale` / `useLocale` | 111 files / 61 files |

---

## 8. Types

### 8a. `any` (7 real; BASELINE 15 was a regex false positive)

| file:line | Use | Reason / fix |
|---|---|---|
| lib/google/drive-picker.ts:12 (`eslint-disable no-explicit-any`), :15 `gapi?: any`, :16 `google?: any`, :83 `(data: any)`, :87 `(d: any)` | Google Picker globals | no `@types/google.picker`; write a local interface for the 4 fields used |
| lib/projects/uses-ai.test.ts:12, :15, :17 | test fixtures (`spec: any`, `{} as any`) | partial objects; use `as unknown as Spec` or a factory |

`@ts-ignore` / `@ts-expect-error`: 0.

### 8b. `as unknown as` (97 = 62 production + 35 tests)

| Group | Prod | Sites | Why it exists |
|---|---:|---|---|
| Supabase untyped select rows cast to a row type | 35 | app: dashboard/store/actions.ts:373, suppliers/lookup/actions.ts:80,235, suppliers/voltaat/page.tsx:65, suppliers/import/actions.ts:106, gaps/page.tsx:60, orders/page.tsx:45, orders/[id]/page.tsx:92, [id]/edit/page.tsx:87, inventory/page.tsx:63, projects/[id]/page.tsx:34; api: admin/store-cleanup/route.ts:258, cron/delivery-promises/route.ts:63; components: home/your-work-strip.tsx:81,89,107,191,203, projects/project-list.tsx:113,149, project-workspace.tsx:208, prototyping/part-dialogs.tsx:141, parts/cart-provider.tsx:168; lib: studio/client/api.ts:335, admin/order-lines.ts:79, admin/continue-projects.ts:63, prototyping/bom-server.ts:42, sourcing/voltaat-sync.ts:97, sourcing/api-refresh.ts:92, store/public-catalog.ts:193,215,399,454,500, schools/server.ts:61 | no generated `Database` type; clients are `createClient()` with no generic, so joined selects are `any`-ish. A generated type removes all 35 |
| window / self / globalThis casts | 10 | StudioFixture.tsx:237, Wiring3DView.tsx:1109,1120, TryItPanel.tsx:269, prototyping/dictation.tsx:50, studio/client/mock.ts:397, lib/cad/cloud.ts:110, studio-geometry.worker.ts:13, cad/render.worker.ts:21 | test hooks and vendor-prefixed browser APIs; one `Window` augmentation |
| three/r3f controls and canvas | 4 | Wiring3DView.tsx:999,1122; studio/geometry/product-render.ts:51 (OffscreenCanvas); StudioFixture.tsx:191 | drei OrbitControls type does not expose `enabled/target` via `get().controls`; offscreen canvas |
| zod / clamp typing | 6 | studio/product/schema.ts:95,96,497; product/forms/clamp.ts:107; enclosure/shape-pick.ts:104; dashboard/store/actions.ts:126 | recursive discriminated union from `FORM_KINDS.map`; records indexed by key |
| JSON message files typed as shape | 3 | studio/product/ai/why.ts:16,17; TryItPanel.tsx:49 | next-intl messages untyped (no `global.d.ts` IntlMessages) |
| geometry job result vs BuiltProduct | 2 | studio/geometry/product-job.ts:78,126 | worker transfer of a packed product |
| fake Supabase client | 1 | studio/ai/fake-model.ts:32 | test double |
| `e.target.value as unknown as number` | 2 | admin/shipping-settings.tsx:29, admin/restock-dashboard.tsx:362 | **real typing bug**: state holds strings in `number` slots; fix state type |

Tests (35): `lib/cad/cloud.test.ts` 13, `studio/product/ai/design.test.ts` 5, `prototyping/spec.test.ts` 3, 14 singles (mock clients, partial rows).

### 8c. Non-null assertions and env

`!` on env: **5** (`lib/supabase/server.ts:11,12`, `lib/supabase/client.ts:7,8`, `lib/sourcing/adapters/digikey.ts:66`). `process.env.X` read in 56 files / 98 sites with no central validated env module (see D-23). Other `!` about 242 (rough regex), concentrated in geometry: `lib/studio/product/solve.ts` 27, `schematic.ts` 19, `wiring3d/layout.ts` 11, `netlist.ts` 11, `wiring-drawing.ts` 7.

### 8d. lib/supabase/types.ts (316 lines) vs migrations

No generated `Database` type anywhere (no `Database`, no `supabase gen`; `supabase/` has no `config.toml`). Header: "Kept hand-written for now". 44 tables queried via `.from()`, 12 with a type, 7 of those drifted. Columns checked by replaying `create table` + `alter table` over all 86 migrations (`cols.py`).

| Table (type) | SQL cols | Missing from TS type | Other |
|---|---:|---|---|
| profiles (Profile) | 9 | `email` (0042), `price_cohort` (0060) = 2 | |
| parts (Part) | 39 | `attributes`, `pack_size` (0025); `pinned_offer_id`, `preferred_offer_id`, `landed_cost_qar`, `expected_income_qar` (0028); `images` (0029); `is_test` (0031); `datasheet_url`, `specs`, `backup_for` (0041); `specs_ar`, `details_ar_at` (0047) = 13 | `tags, pricing_mode, income_pct, below_floor, lead_time_class, name_key, merged_into, store_category*, in_own_stock` typed optional though SQL NOT NULL default (deliberate pre-migration tolerance) |
| part_orders (PartOrder) | 28 | `discount_qar` (0025); `shipping_tier, split_shipments, shipping_qar, handling_fee_qar, promised_date, early_promised_date, held_by, confirmation_emailed_at, delay_notified_at` (0029); `is_test` (0031); `has_on_request` (0032); `payment_method` (0039); `credit_discount_qar` (0042); `class_id, class_breakdown` (0097) = 16 | `status` union excludes legacy pending/processing (intentional, `lib/orders/status.ts`) |
| part_order_items (PartOrderItem) | 13 | `project_id, kit_id, bom_lines` (0025); `lead_time_class, promised_date` (0029) = 5 | |
| cart_items (CartRow) | 9 | `bom_lines, kit_id` (0025) = 2 | |
| projects (Project) | 26 | `is_test` (0031); `status, free_wiring_used, cad_tier, cad_regens_remaining` (0042); `contact_email, recovery_token, recovery_emailed_at` (0045); `studio, studio_version` (0068) = 10 | `disciplines, spec, bom, netlist, build_route, firmware` optional vs NOT NULL for `disciplines` |
| client_inventory_items (ClientInventoryItem) | 10 | `attributes` (0025) = 1 | |
| inquiries (Inquiry) | 15 | none | `final_quote_qar: number \| string \| null` looser than numeric |
| project_items | 7 | none | |
| project_parts | 29 | none | `source` optional vs NOT NULL default |
| project_blocks / project_materials / project_schematics / project_schematic_revisions / tenants / inventory_items | | none | `inventory_items.quantity` retyped integer->numeric in 0007, TS `number` fine |

**Total 49 columns missing** (2 + 13 + 16 + 5 + 2 + 10 + 1) across 7 of the 10 core tables checked; no drift in inquiries, project_items, project_parts. Everything else (credits_ledger, payments, school_classes, engineering_jobs, ...) is typed ad hoc per call site (the 35 casts). Also: 3 dead hand types (`PartOrderItem`, `ProjectMaterial`, `CartRow`, S5).

Fix: `supabase gen types typescript --local > lib/supabase/database.types.ts` against a local PGlite/Supabase applying the migrations (no prod access needed); `createClient<Database>()` in the factories; delete hand types or derive them with `Tables<"parts">`.

---

## 9. Tests

### 9a. Counts per area (vitest `lib/**/*.test.ts` only; cases = `it/test(` call sites; `it.each` expands to the 3,246 reported tests)

| Area | Files | Cases |
|---|---:|---:|
| lib/studio | 75 | 782 |
| lib/prototyping | 28 | 294 |
| lib/store | 25 | 292 |
| lib (root) | 20 | 234 |
| lib/admin | 14 | 145 |
| lib/projects | 9 | 73 |
| lib/schools | 8 | 54 |
| lib/sourcing | 6 | 40 |
| lib/credits | 6 | 33 |
| lib/auth | 5 | 45 |
| lib/orders | 4 | 46 |
| lib/pricing | 4 | 38 |
| lib/cad | 3 | 55 |
| lib/notifications | 3 | 34 |
| lib/email | 2 | 47 |
| lib/billing | 1 | 8 |
| others (text, reviews, parts, i18n, home, design, supabase, integrations, cleanup, inventory, legal, services, analytics) | 17 | about 120 |
| app/, components/, scripts/ | 0 | 0 |

No component tests, no route-handler tests (62 routes), no jsdom environment, no RLS/RPC tests (PGlite only in `lib/schools/db/schools-migration.test.ts`). 272 lib modules have no sibling `*.test.ts` (156 in lib/studio, mostly library part data).

### 9b. Important logic with no test that imports it

Checked by scanning every test file for the module path; indirect coverage through another module is possible but unverified.

| Priority | Module | Lines | Why it matters |
|---|---|---:|---|
| money | `lib/parts/cart.ts` (`cartTotal`, `kitDiscountQar`, `cartItemCount`) | 100 | cart total shown to buyer; `cart-provider.tsx:479` rounds on top |
| money | `lib/parts/format.ts` `formatPrice` | 58 | 107 callers |
| money | `lib/store/public-catalog.ts` | 557 | every storefront price/stock read |
| money | `lib/admin/order-lines.ts`, `fix-delivery.ts`, `stock-data.ts` | 112 / 197 / 157 | admin order maths |
| money | `lib/ai/{usage,limits,prices}.ts` | 110 / 90 / 66 | AI cost metering and daily guard |
| money | checkout totals (live in `checkout-client.tsx`); no test pins TS mirrors against SQL RPCs (`create_part_order`, `order_delivery_quote`, `order_status_transition_ok`) | | |
| credits | `lib/credits/use-credits.ts` (redeemable_qar fetch); `constants.ts` partly via `credits.test.ts`; `spend/canUse` covered | 102 | checkout credit discount |
| auth/permissions | `lib/auth/get-session.ts` (62), `claim-guest-server.ts` (34), `providers-server.ts` (42), `redirects.ts` (20); no test for the 79 inline `super_admin` checks or the 8 `requireAdmin` copies; no RLS test | | role resolution |
| delivery dates | tested: `working-days.ts`, `delivery.ts`, `shipping.ts`, `checkout.ts`. Untested: `app/api/cron/delivery-promises/route.ts:37-101`, `lib/store/shipping-settings.ts`, `use-delivery-quote.ts` | | |
| status transitions | `lib/orders/status.ts`, `admin-rules.ts` tested; the `admin-overview.tsx:61` open-status list differs from `OPEN_ORDER_STATUSES` and is untested | | |
| email | `lib/email/templates/index.ts` + `templates.test.ts` exist; untested directly: `order-status.ts` (125), `layout.ts` (215), first-circuit, credits-admin-grant, engineering-job-ready, credits-order-delivered, discount-ready, first-project, html-to-text, `lead-email.ts` (99) | | |
| notifications | `decide.test.ts`, `links.test.ts`, `kinds-sync.test.ts` (passes on main; checks decide.ts vs templates/index.ts); `lib/notifications/drain.ts` (117) untested | | outbox drain |
| other | `lib/billing/{server,verify,config}.ts` (only 8 cases in `billing.test.ts`); `lib/cache/storefront.ts` (`revalidateStorefront`, 75); `lib/engineering/view.ts`; `lib/projects/allocation.ts` (150); sourcing adapters (digikey, mouser); `voltaat-sync.ts` (252); `api-refresh.ts` (206); `lib/cad/cloud-flow.ts` (268); `lib/supabase/{guest,middleware,fetch-all}.ts` | | |

### 9c. e2e (36 spec/fixture files, 4,710 lines; Playwright desktop + mobile-375)

| Topic | Finding |
|---|---|
| Config | `playwright.config.ts`: `retries: 1`, `fullyParallel`, 3 workers, `reuseExistingServer: true`, `trace: on-first-retry`, no `forbidOnly`; `webServer.command: npm run start` (needs a prior build, not enforced); no `globalSetup`; `retries: 1` hides flaky waits |
| Environment | runs against `npm run start`; relies on `.env.local` pointing at production Supabase (`e2e/fixtures.ts` header), write-guarded |
| Fixed sleeps | `waitForTimeout` 54 across 8 files: `studio-wiring-views.spec.ts` 22, `studio.spec.ts` 12, `studio-product.spec.ts` 5, `studio-parts-flipbook` 4, `studio-enclosure` 4, `studio-engine` 3, `home-w7.spec.ts:103` `waitForTimeout(6_500)`, `pricing.spec.ts:30` 3 s race. `networkidle`: 0. `toPass`: 21. `test.setTimeout` 90-400 s in 20+ places (`studio-product.spec.ts:183` 400 s) |
| Production-data dependence | `store.spec.ts:22-26` scrapes the first product link from the live catalog; `social-sign-in.spec.ts:22-25` throws without Supabase env; case-studies, guest-claim, speed, projects-open-studio skip without `NEXT_PUBLIC_SUPABASE_URL`; results change with catalog/provider flags |
| Env-gated shots | `P517_SHOTS`, `STUDIO_PERF` are `test.skip`'d by default; screenshots, not assertions |
| Likeliest flaky | `studio-wiring-views.spec.ts` (22 sleeps, 3D camera timing), `studio.spec.ts:182` `waitForTimeout(1200)` on a 650 ms animation, `home-w7.spec.ts:103` |

---

## 10. Docs

### 10a. CLAUDE.md map (1,624 lines, 280,643 bytes)

| Lines | Content |
|---|---|
| 1-28 | header, business, roles, requirements, build style |
| 29 | `## PROGRESS` |
| 30-1416 | chronological history (1,387 lines, 85 % of the file) |
| 1417-1437 | owner decisions D1-D13 |
| 1438-1491 | build-sequence status |
| 1492-1498 | prompt-file list |
| 1499-1503 | what's next |
| 1504-1602 | pending migrations log |
| 1603-1618 | permanent notes |
| 1619-1624 | environment notes |

Durable rules buried in history (must be hoisted into the index): caching/ISR policy (:1026, :1138, :1107, :1603), messages scopes (:1028), expression-bodied `useEffect` ban (:1206 + eslint.config.mjs), i18n parity script (:1010), legal pages generated from LEGAL_PAGES_DRAFT.md (:1014, :1144, :1428), e2e write guard (:1075), "no invented numbers" (:512), readiness single source (:495), AliExpress dropped (:809), no paid services (:1613), email layout rule (:1604), 24 h cache expiry (:1603). **Not stated anywhere in CLAUDE.md:** "every store write calls `revalidateStorefront()`" (only in `lib/cache/storefront.ts`, incidental mention at :1163).

Stale: :1619-1624 describes a Windows/PowerShell machine; :1499-1503 points to `C:\Users\mmamr\...`; :1492-1498 lists 5 of the 9 prompt files; Supabase and Vercel project ids at :1613-1616 (not secrets) belong in `docs/ENVIRONMENT.md`. Also `next.config.mjs` `outputFileTracingRoot` comment still describes `C:\Users\<user>`. The CLAUDE.md digest note "CSV importer unused" is wrong (section 3.0).

### 10b. Proposed docs/history layout (nothing deleted; every range moves verbatim)

| CLAUDE.md lines | Destination | Notes |
|---|---|---|
| 1-28 | CLAUDE.md (kept) | |
| 29 | CLAUDE.md heading "History" + pointer | |
| 30-224 | docs/history/01-platform-stages-1-8b.md | Stage 1-8b (original workshop platform) |
| 225-472 | docs/history/02-parts-store.md | Parts Store (225), Store-first rebuild 1-5 (258-432), signed-in chrome (433), website fixes + public quote (442) |
| 473-934 | docs/history/03-prototyping.md | Prototyping, BOM/netlist, site-audit phases 1-5, Voltaat/Mouser/DigiKey, restock, payments, sourcing |
| 935-1031 | docs/history/04-ai-credits-cad-site-review.md | AI access + credits (935), CAD generation (955), Site review phases A-I (999-1031) |
| 1032-1232 | docs/history/05-qrdi-phases-0-4.md | feature videos, phases 0-4, hotfix at 1206 |
| 1233-1308 | docs/history/06-design-studio-phase-5.md | P5-01..P5-17, studio walkthroughs, admin home + stock |
| 1309-1416 | docs/history/07-edu-credits-school-projects.md | edu credits, school projects, personal number removed |
| 1417-1437 | docs/DECISIONS.md | D1-D13 + phase notes (5-line digest stays in CLAUDE.md) |
| 1438-1491 | docs/history/08-build-sequence-status.md | |
| 1492-1503 | docs/history/09-prompts-and-next.md; the 9 root prompt files move to docs/history/prompts/ | |
| 1504-1602 | docs/MIGRATIONS.md | run log; add "next = 0100" |
| 1603-1618 | split: rules (1603-1605, 1612-1613 owner rule) back into the CLAUDE.md index; env ids (1606-1611, 1614-1618) to docs/ENVIRONMENT.md | |
| 1619-1624 | docs/ENVIRONMENT.md, rewritten for macOS | |

New CLAUDE.md (~250 lines, < 300): lines 1-28 (28); "Hard rules" (~60: static/ISR storefront, `revalidateStorefront`, i18n parity + scopes, useEffect ban, legal generated, no paid services, write guard, never edit migrations, migration numbering); "Architecture map" (~40: dirs, Supabase clients, auth/roles, money path, credits, AI paths); "Commands" (~15: lint, typecheck, test, e2e, parity, legal check); "Owner decisions in force" digest D1-D13 (~20); "Pointers" table to docs/*.md and docs/history (~40); "Environment" short (~15); "Maintenance rule" (~10): new stage notes go to `docs/history/NN-*.md`, handoff stays out of CLAUDE.md.

### 10c. Root planning files

| File | Size | CLAUDE.md refs | Other refs | Action |
|---|---|---|---|---|
| STAGE_6A_PROMPT.md | 73 L | :1493 | none | docs/history/prompts/ |
| STAGE_6B_PROMPT.md | 52 L | :1494 | none | same |
| STAGE_8A_PROMPT.md | 103 L | :1496 | none | same |
| STAGE_8B_PROMPT.md | 154 L | :1497 | none | same |
| STAGE_PARTS_STORE_PROMPT.md | 287 L | :1495 | none | same |
| STAGE_SITE_REVIEW_FIXES_PROMPT.md | 245 L, 30 KB | :1000, :1419 (not in list at :1492) | none | same |
| STAGE_WIRING_VIEWS_PROMPT.md | 34 L | :1276 only | none | same |
| STAGES_STORE_FIRST.md | 126 L | :259 only | none | same |
| FIX_ALL_PROMPT.md | 164 L, 17 KB | none | none | unreferenced: owner decision |
| Gestaltung_Build_Plan.md | 867 L, 226 KB (a .docx named .md) | none | README.md | archive to docs/history/ (rename .docx) |
| `.fuse_hidden0000000d00000001` | 225,502 B | none | none | S3: delete |
| LEGAL_PAGES_DRAFT.md | 346 L | :1014, :1144, :1145, :1212, :1428 | scripts/split-legal-draft.mjs, lib/legal/markdown.ts | stays (source of generated `content/legal/**`) |
| DESIGN.md | 89 L | :1134 | app/apple-icon.tsx, manifest.ts, opengraph-image.tsx | stays |
| SITE_AUDIT.md, CHANGELOG-audit.md, SECURITY_REVIEW.md, FINDINGS.md | 225 / 238 / 158 / 166 L | 4 / 7 / 2 / 0 | FINDINGS: lib/supabase/guest.ts | move to docs/audit-history/ after this audit, update refs |
| README.md | 21 L | | | Stage-1 stub ("single landing page"); rewrite |

---

## 11. Lint and config gaps

### 11a. eslint.config.mjs

Only `next/core-web-vitals` + `next/typescript` (via FlatCompat) and one `no-restricted-syntax` (expression-bodied effect).

| Gap | Evidence | Suggested level |
|---|---|---|
| `complexity`, `max-lines-per-function`, `max-lines` | 323 functions CC >= 15; 166 > 120 lines; 25 files > 575 lines | warn at 25 / 200 / 800 with a baseline file, ratchet down |
| `import/no-cycle` or madge in CI | 20 cycles | `eslint-plugin-import` or keep madge in CI |
| `no-console` | 102 `console.error`, 58 `console.warn`, 4 `console.log` in app/components/lib (BASELINE's 77 are mostly scripts/) | `["warn", {allow:["warn","error"]}]` |
| layering rule | components import `supabase/client` 33 times; lib imports React 6x | `no-restricted-imports` per folder (lib/** may not import react / `next/headers` except `*-server.ts`, `use-*.ts`) |
| `@typescript-eslint/no-non-null-assertion` | 242 `!`, 5 on env | warn |
| `@typescript-eslint/consistent-type-imports` | cycles #1-5 are type-only | warn |
| `as unknown as` | 97 casts | `no-restricted-syntax` warn in production code |

65 `eslint-disable`: `no-img-element` 31, `exhaustive-deps` 26, `no-explicit-any` 4, `no-unused-vars` 2, `prefer-rest-params` 1, jsx-a11y 1. Lint passes with 1 warning (unused disable at `app/[locale]/opengraph-image.tsx:101`). Lint scope: `eslint .` also lints e2e/ and `scripts/*.mjs`; ignores `services/**`.

### 11b. tsconfig.json

| Item | Finding |
|---|---|
| target | `ES2017` with `lib: esnext` (SWC transpiles, no runtime effect); raise to ES2022 to match Node 24 |
| allowJs | `true` but include globs only `*.ts/*.tsx`, so it does nothing; `scripts/*.mjs`, postcss/next config not type-checked |
| include | `**/*.ts, **/*.tsx` pulls in e2e/ (36 files), `playwright.config.ts`, `tailwind.config.ts`, and `.next/types` (183 files when a build exists): typecheck result depends on whether `next build` ran |
| exclude | `node_modules`, "Design that I like", `services`; add `.next` (keep `.next/types/**` include explicit), `_archive`, `playwright-report`, `test-results` |
| strictness | `strict: true` only; consider `noUncheckedIndexedAccess` (large change; about 240 `!` in geometry), `noFallthroughCasesInSwitch`, `noImplicitOverride` |
| incremental | leaves `tsconfig.tsbuildinfo` in the repo root (check `.gitignore`) |
| split | no `tsc` split between app and e2e/tests |

### 11c. vitest.config.mts

`include: ["lib/**/*.test.ts"]`, `environment: node`, no coverage, no setupFiles, no `.test.tsx`. No tests exist outside lib today (checked app/, components/, e2e/, scripts/), so nothing is silently skipped, but any new component or route test would never run. Recommend `include: ["{lib,app,components}/**/*.test.{ts,tsx}"]`, a second `jsdom` project for components, and v8 `coverage` with thresholds on lib/pricing, lib/credits, lib/orders, lib/store.

### 11d. Dependencies (knip)

| Package | Importer | State | Action |
|---|---|---|---|
| @electric-sql/pglite | `lib/schools/db/schools-migration.test.ts:9` | now in devDependencies 0.5.11 (`package.json:42`; changed after baseline) | done; confirm lockfile (3 hits) |
| three-stdlib | `components/studio/viewer/ProductViewer.tsx:18` (`OrbitControls`) | only transitive via @react-three/drei (`^2.35.6`); installed 2.36.1 | add `"three-stdlib": "^2.36.1"` to dependencies, or import from drei/three examples |
| @eslint/eslintrc | `eslint.config.mjs:3` (FlatCompat) | transitive via eslint; installed 3.3.7 | add `"@eslint/eslintrc": "^3.3.7"` to devDependencies |
| postcss-load-config | `postcss.config.mjs:1` (JSDoc type only) | transitive via tailwindcss; installed 6.0.1 | drop the `@type` comment or add as devDependency |
| eslint-config-next | `eslint.config.mjs` via FlatCompat | knip false positive | keep |

knip config: add `scripts/**` and `lib/prototyping/providers/gemini.ts` to `entry` (O10, O12).

---

## 12. Summary (ten lines)

1. Safe to delete: `account-bar.tsx`, `home-trust.tsx`, tracked `.fuse_hidden…` docx (225 KB), CSS `.delay-4`, 3 dead cart functions, 34 dead exports/types, about 90 dead i18n keys (x2 for EN/AR). Brief corrections: CSV importer is reachable, `Features/LocalAdvantage/Social` already gone, `gemini.ts` is a knip false positive.
2. knip: 736 unused exports/types, of which 588 only need `export` removed, 34 dead, 114 ambiguous; another 336 exports are test-only (46 with no production use).
3. v1 pages (752 lines) are unreachable with site_v2 ON except when the middleware flag read fails (fails closed to v1) or on rollback; owner decision (O1).
4. Largest dead-weight candidate: the Engineer view, 49 files / 11,143 lines reachable only by super_admin, plus about 750 message keys (O2); `/inventory` + tenants (O3) and the jobs/`project_claims` DB remnants (O4, O5) also need owner calls.
5. Duplication is 0.90 % by jscpd but semantically large: about 100 hand-written role/user checks in 5 response shapes, 14+ "run migration" detectors, 14 UUID regexes, 48 locale-tag literals, 12 money formatters, 6 filename sanitizers; 32 D-items.
6. Complexity: 323 functions CC >= 15, 140 >= 25, 45 >= 40 (worst `renderSchematicSVG` 176); 14 split plans written; best payoff is extracting checkout totals/place-order.
7. 20 import cycles clear with about 5-6 small edits; only netlist<>plain-checks is a real runtime cycle.
8. Layering: 8 data-access styles, 33 component files call Supabase directly, 7 routes carry business logic (store-lead 388 lines, CC 111); 0 `loading.tsx` / `error.tsx`; 5 route and 7 action error shapes.
9. Types: 7 real `any`; 97 `as unknown as` (35 prod ones only because there is no generated `Database` type); hand types drift by 49 columns on 7 of 10 core tables.
10. Tests: 232 files / 3,246 tests, all in lib; 0 component/route/RLS tests; money and auth paths untested (cart.ts, public-catalog.ts, lib/ai/*, get-session.ts, checkout totals, cron delivery-promises); e2e has 54 fixed sleeps and production-data dependence; CLAUDE.md is 85 % history; eslint/vitest/tsconfig lack complexity, layering, no-console and non-lib test globs.
