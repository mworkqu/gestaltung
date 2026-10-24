# Refactor plan — audit/code-and-security-2026-10

Companion to `CODE_QUALITY_AUDIT.md` (findings, evidence) and `SECURITY_AUDIT.md`
(security fixes, done first). This file is the *decision*: the target shape of the
codebase, the conventions every slice applies, and the ordered list of slices with
risk and verification. Slice IDs (R1…) are referenced from commit messages.

Ground rules carried over from the owner's brief: behaviour stays the same unless a
bug or vulnerability is being fixed; public storefront pages stay static/ISR; store
writes call `revalidateStorefront()`; EN/AR parity; every commit leaves typecheck,
lint, unit tests and build green; nothing customer- or admin-facing is removed
without the owner's decision (those items are listed, not done).

## 1. Target structure

Nothing moves between top-level folders. The rule is *where new code goes and what
each layer may import*:

| Layer | Folder | May import | Must not import |
|---|---|---|---|
| Pure domain logic (tested) | `lib/<area>/*.ts` | other `lib/`, `zod` | React, `next/*`, Supabase clients |
| Server data access | `lib/<area>/server*.ts`, `lib/<area>/db/` | `lib/supabase/{server,service,public}`, `next/cache`, `server-only` | React components |
| Client-side helpers / hooks | `lib/<area>/client/*.ts`, `lib/<area>/use-*.ts` (`"use client"`) | `lib/supabase/{client,lazy}` | `next/headers`, service client |
| Route handlers | `app/api/**/route.ts` | one `lib/<area>/server` entry, `lib/http.ts`, `lib/auth/guards.ts` | business rules inline (parse → guard → call lib → respond) |
| Server actions | `app/[locale]/**/actions.ts` | `lib/auth/guards.ts`, `lib/<area>/server` | hand-rolled role checks |
| Pages / layouts | `app/[locale]/**` | guards, lib server modules, components | `.from()` chains longer than a simple read; money/date maths |
| UI | `components/**` | `lib/<area>/client`, pure `lib/` | `lib/supabase/service`, SQL-shaped logic |

Shared primitives — exactly one home each (created in slice R3, then every copy is
pointed at it):

| Concern | Home | Replaces (see CODE_QUALITY_AUDIT D-nn) |
|---|---|---|
| Admin / user / cron guards | `lib/auth/guards.ts` (`requireSuperAdmin`, `requireSignedIn`, `requireUser` for routes, `isAuthorizedCron` in `lib/auth/cron.ts`) | D-01, D-02, D-03, D-04, D-05, D-06 |
| Route responses | `lib/http.ts` (`jsonOk`, `jsonError(code, status)`, `emptyStatus`) | D-07 |
| JSON body parsing | `lib/http.ts parseJsonBody(request, schema)` (zod) | D-05, D-32 |
| UUID | `lib/uuid.ts` (`UUID_RE`, `isUuid`) | D-20 |
| Locale narrowing + Intl tags | `lib/locale.ts` (`asLocale`, `intlTag`, `isRtl`, `pick`) | D-10, 4g |
| Money | `lib/format/money.ts` (`formatQar`, `round2`, `CREDIT_QAR` re-export) | D-08, D-09, D-14, D-18 |
| Dates | `lib/format/date.ts` (`dayFormatter`, `timeFormatter`, `addDays`, `DAY_MS`, Asia/Qatar) | D-11, D-12 |
| "Run migration NNNN" detection | `lib/supabase/errors.ts` (`isMissingRelation/Function/Column`) | D-19 |
| HTML / XML escaping | `lib/text/escape.ts` | D-25 |
| Email address check | `lib/email-address.ts` | D-21 |
| Storage buckets + safe file names + user paths | `lib/storage/paths.ts` | D-24 |
| Outbound fetch with allow-list + byte cap | `lib/net/safe-fetch.ts` (created by WEB-05 fix) | API-08, WEB-05 |
| Security headers | `lib/security/headers.mjs` (created by WEB-03 fix) | — |
| Phone | `lib/phone.ts` (already the home; add `waLink`) | D-17 |
| Text normalisation | `lib/text/normalize.ts` (`normalizeText`, `tokenize`) | D-27 (normaliser only; the three matchers stay separate) |

Conventions applied by every slice:

1. **Routes**: `export async function POST(request)` → `parseJsonBody` → `require*`
   → one lib call → `jsonOk`/`jsonError`. Error body is always `{ error: "<code>" }`
   with the HTTP status carrying the meaning. Existing routes keep their current
   body shape where a client reads it (noted per route in the slice); new/changed
   routes use the convention.
2. **Server actions** return `{ ok: true, ... } | { ok: false, error: "<code>" }`.
   Actions that today throw `Error("forbidden")` keep throwing (their forms rely on
   the error boundary) but through `requireSuperAdmin()`.
3. **Validation**: zod at every boundary that accepts JSON or FormData; shared
   primitives (`uuid`, `email`, `phone`, `locale`) imported from the homes above.
4. **Formatting**: no inline `Intl.*Format`, `Math.round(x*100)/100`,
   `locale === "ar" ? … : …` in pages/components when a helper exists.
5. **Naming**: kebab-case files everywhere except `components/studio/**`, which
   stays PascalCase (45 files; renaming them is churn with no gain — documented as
   the one exception). Barrel files keep old import paths stable when a file is
   split.
6. **Comments**: say *why*, not *what*. Stale references (Windows paths, retired
   features, "run 0054 first") are removed when a file is touched.
7. **Tests**: every pure module created or split gets a vitest file; every SQL rule
   mirrored in TS gets a test that parses the migration constant (pattern:
   `lib/notifications/kinds-sync.test.ts`).

## 2. Slices (ordered)

Each slice = one or a few commits. Risk: L (mechanical, type-checked), M (behaviour
preserved but wide), H (touches money/3D/auth paths; needs e2e). "Verify" lists what
runs before the commit beyond typecheck + lint + `npm run test` + `npm run build`.

| # | Slice | Scope (files owned) | Risk | Verify |
|---|---|---|---|---|
| R1 | **Safe deletions** (S1–S7): `components/account-bar.tsx`, `components/payment/home-trust.tsx` + its 5 `PayMethods.*` keys, tracked `.fuse_hidden0000000d00000001`, `.delay-4`, dead cart functions + stale header in `lib/parts/cart.ts`, the 34 dead exports/types, the ~90 dead message keys (re-verified by script before deletion; dynamic-key families excluded) | listed files, `messages/*.json`, `app/globals.css` | L | `node scripts/check-i18n-parity.mjs`; `lib/i18n/scopes.test.ts`; grep per symbol in commit body |
| R2 | **Tooling & config**: `knip.json` (entries: scripts, dynamic providers), `package.json` adds `three-stdlib`, `@eslint/eslintrc` (exact versions), `postcss.config.mjs` type comment, `npm run check:cycles` (madge) and `check:unused` (knip) scripts, eslint `no-console` (warn, allow warn/error) + `complexity`/`max-lines-per-function` as *warnings* with a documented ratchet, vitest include `{lib,app,components}/**/*.test.{ts,tsx}`, tsconfig `exclude` adds `playwright-report`, `test-results`, `_archive`; comment in `next.config.mjs` about the Windows root rewritten | config files only | L | `npm run lint` still 0 errors; `npm run test` count unchanged or higher |
| R3 | **Shared primitives** created with tests (table in §1), no callers moved yet | new files under `lib/` | L | new unit tests |
| R4 | **Point callers at the primitives**, one commit per primitive: guards (≈100 sites; every admin action/route/page uses `requireSuperAdmin`/`requireUser`; response bodies unchanged per route), UUID (14), locale narrowing (71) + Intl tags (48), rounding (17), missing-migration shims (14+), escaping (4), email check (2), `addDays`/`DAY_MS`, `CREDIT_QAR`, phone `waLink` (9) and `contact-phone.ts`, storage buckets/sanitizers (6+2) | `app/**`, `components/**`, `lib/**` touched per primitive | M | per-primitive grep shows 0 remaining copies; e2e smoke after the guards commit |
| R5 | **Import cycles** (6 edits): `components/studio/studio-ctx.ts`, `lib/studio/product/archetype-names.ts`, `lib/prototyping/bom-types.ts` + `LevelFlag` move, `lib/youtube-types.ts`, `lib/studio/netlist-parts.ts`, `lib/studio/wiring3d/types.ts`; `check:cycles` = 0 | the named modules + 12 step imports | L | `npx madge --circular` → 0; lib/studio tests |
| R6 | **Money/business rules out of UI into lib (tested)**: `lib/store/checkout-totals.ts` + `lib/store/place-order.ts` from `checkout-client.tsx`; `lib/parts/cart.ts` totals test; `OPEN_ORDER_STATUSES` used by `admin-overview.tsx` (fixes the list that omits `shipped` — bug fix, listed as a behaviour change); supplier-lookup landed cost → `lib/sourcing/landed-cost.ts`; restock revenue → `lib/store/restock.ts`; credit redeemable check → `lib/credits/redeem-window.ts`; 60-minute confirmation window → `lib/orders/confirmation-window.ts`; ETA/overdue → `lib/engineering/view.ts` | the named components/pages + new lib files | H (checkout) | checkout totals test pins TS mirror to the SQL constants; e2e `store.spec.ts`; manual click-through of cart → checkout (no order placed) |
| R7 | **Route logic into lib**: `app/api/store-lead` → `lib/leads/{sources,parse,save}.ts`; `app/api/cron/delivery-promises` → `lib/store/delivery-promises.ts` (tested against `working-days.ts`); `app/api/analyse` → `lib/prototyping/analyse-run.ts`; `app/api/orders/confirmation` window + idempotency → lib; the two admin export routes share `lib/admin/export-route.ts` | those routes + new lib files | M | new unit tests; route behaviour unchanged (same bodies/statuses) |
| R8 | **Splits by responsibility (barrels keep paths)**: `lib/studio/schema.ts` → enums/zod/clamp/defaults; `lib/studio/netlist.ts` → parts/power/required/build/legacy; `components/studio/StudioShell.tsx` → `use-studio-save`, `use-studio-navigation`, `use-studio-handlers`, `studio-banners`; `components/studio/viewer/rig.tsx` shared by `Viewer.tsx` and `Wiring3DView.tsx`; `components/projects/project-workspace.tsx` → cards; `app/[locale]/dashboard/customers/[id]` → `lib/admin/customer-data.ts` shared with `customer-export.ts` + section components; `components/studio/steps/PartsStep.tsx` → tile/choices/picture pane | listed files | M–H (3D) | lib/studio 782 tests; e2e studio specs (`studio.spec`, `studio-wiring-views`, `studio-product`); First Load JS of `/projects/[id]/studio` not heavier |
| R9 | **Geometry hot spots** (only after R8 is green): `lib/studio/product/solve.ts` → types/geometry/place/fit/checks; `lib/studio/wiring3d/layout.ts` → types/pose/layout-mat/move; `lib/studio/schematic.ts` and `lib/studio/wiring-drawing.ts` → style/model/layout/svg | listed files | H | existing solve/layout/schematic tests must pass unchanged (they pin output); add golden SVG tests before splitting |
| R10 | **Types**: `lib/supabase/types.ts` brought level with the migrations (49 columns), the two real typing bugs (`shipping-settings.tsx:29`, `restock-dashboard.tsx:362`), `drive-picker.ts` `any` → local interface, one `Window` augmentation for the 10 global casts, env `!` replaced by `lib/supabase/env.ts` | `lib/supabase/types.ts`, the named files | L | typecheck; unit tests |
| R11 | **Layering clean-up**: hooks out of `lib/` into `lib/<area>/client/` (`use-credits`, `use-price-quote`, `schools/client`, `use-delivery-quote`); `server-only` marker on the 10 cache modules; components that query Supabase for project/cart/inventory data call `lib/<area>/client/*` functions instead of inline `.from()` chains (same queries, moved) | listed modules; `components/projects/**`, `components/parts/cart-provider.tsx`, `components/inventory/my-inventory.tsx` | M | e2e projects/studio/cart specs; First Load JS unchanged |
| R12 | **Error-handling convention**: `lib/http.ts` applied to every route whose client only checks `res.ok` (listed in the commit); the 9 bespoke shapes that clients parse (`reason`, `sent`, `name: null`, HTML routes, 303s) are left and documented; action result types unified to `{ ok, error }` where the form only displays `error` | routes/actions listed in the commit | M | grep of client `fetch("/api/…")` consumers per changed route |
| R13 | **Docs restructure**: `CLAUDE.md` → ≤300-line index (rules, architecture map, commands, decisions digest, pointers, pending migrations); history lines 30–1416 moved verbatim to `docs/history/01…09-*.md`; `docs/DECISIONS.md`, `docs/MIGRATIONS.md`, `docs/ENVIRONMENT.md`; root `STAGE_*`/`STAGES_STORE_FIRST.md` → `docs/history/prompts/`; `README.md` rewritten; `SECURITY_REVIEW.md`, `FINDINGS.md`, `SITE_AUDIT.md`, `CHANGELOG-audit.md` → `docs/audit-history/` with the comment in `lib/supabase/guest.ts` updated | docs only | L | every CLAUDE.md line accounted for (diff of concatenated history == old range); `grep` for moved-file references |
| R14 | **Tests for untested money/auth logic**: `lib/parts/cart`, `lib/parts/format`, `lib/store/public-catalog` (pure parts), `lib/auth/get-session`, `lib/notifications/drain`, email templates (one render test per template asserting escaping + no raw URL), `lib/ai/{limits,usage}` pure parts | `lib/**/*.test.ts` | L | `npm run test` |
| R15 | **Modal/dialog consolidation** (D-28) and admin editor repeater (D-29) | `components/ui/*`, 11 dialog sites | M | keyboard/Escape/scroll-lock checked in the browser at 375 px and desktop |

Slices R1–R5, R7, R10, R12, R13, R14 are planned for this branch. R6 and R8 are
done where the verification above can run without production data (everything
except placing a real order). R9, R11 and R15 are started only if the earlier
slices are green and time allows; otherwise they are handed over as the first items
of "Recommended next steps" in `FINAL_REPORT.md`.

## 3. Explicitly not done without the owner

Listed with evidence in `CODE_QUALITY_AUDIT.md` §3 (O1–O15) and `SECURITY_AUDIT.md`
"Needs owner decision": v1 pages + `site_v2` flag removal (O1), the Engineer view
(49 files, O2), the legacy workshop inventory and `tenants`/`inventory_items` (O3),
jobs tables and redirects (O4), `project_claims` drop (O5), the CSV importer (keep,
O7), the test-only SQL mirrors (O8), future-seam stubs (O9), the public prototype
HTML (O11), the .ps1 helpers (O12), stale planning files (O14), dead DB columns (O15),
`Gestaltung_Build_Plan.md` (a .docx), `FIX_ALL_PROMPT.md`.

## 4. Metrics to report after Phase 4 (same commands as the baseline)

files/lines per area, `jscpd` duplication %, `knip` unused exports, real `any` and
`as unknown as` counts, `madge --circular`, largest files, CC≥15/25/40 counts
(eslint complexity pass), test files/cases, First Load JS for `/`, `/store`,
`/store/[sku]`, `/design/quote`, `/projects/[id]/studio`, `/pricing`, and the
static/ISR flag of every public route (must be unchanged).
