# 2026-11 consolidation, phase 4: guard main

Branch `consolidation-2026-11`. Goal: make `main` impossible to break
silently. One commit per task. Nothing here was pushed or deployed.

## 4.1 CI: `.github/workflows/main.yml`

Runs on push to `main` and on pull requests that target `main`. It replaces
`cad-champions.yml` (deleted; every check that file ran is in `main.yml`).

| Job | What it runs |
|---|---|
| Static checks | `npm ci` (npm cache), `npm run lint`, `npm run lint:ratchet`, `npm run typecheck`, `node scripts/check-i18n-parity.mjs`, `npm run i18n:check` (CAD Champions strings), `npm run check:cycles`, `npm run test` (vitest), `npm run db:types:check`, `npm run worker:build` |
| Build and e2e | `npm run build` with DUMMY Supabase env (`http://127.0.0.1:54321`, `ci-dummy-anon-key`, `E2E_FIXTURES=1`), Playwright Chromium (browser cache keyed on the Playwright version), `npx playwright test 'e2e/[^/]+\.spec\.ts'` (root suite, write-guarded) and `npx playwright test e2e/cad-champions`, both with the known-failing list excluded; report uploaded on failure |
| Grader (pytest) | as in the old workflow (CadQuery wheel optional; `cadquery`-marked tests skip) |
| CAD worker (pytest) | `services/cad-worker` tests without CadQuery; **skipped here:** every test marked `cadquery` (the CadQuery/OCP/vtk wheels are not installed, the Cloud Build image runs them). **Not yet seen green** (no Python on the machine this was written on), so the job is `continue-on-error` until the first CI run; remove that line afterwards. |
| all checks | one stable required-check name: succeeds only when Static, Build and e2e and Grader all succeeded |

No job uses a secret. The build never sees the production Supabase project.

### What was checked locally, and what was not

- The workflow YAML parses (`yaml` package) and validates against the GitHub
  Actions schema (`@action-validator/cli`). `actionlint` is not available
  through npm, so it was **not linted with actionlint**.
- GitHub Actions cannot run here. The jobs were NOT executed on GitHub. What was
  run locally, with the same commands and the same dummy env: the build, and the
  whole Playwright suite (see "Dummy-env e2e" below).
- `node scripts/split-legal-draft.mjs --check` reports DIFF on this Windows
  checkout (CRLF), so it is not in CI. It was not part of the old workflow either.

### Known-failing e2e tests

`e2e/KNOWN_FAILING.txt` lists the 19 studio tests recorded in
`2026-11-consolidation-phase2.md`, one `project | spec file | title` per line.
`playwright.config.ts` turns the list into a `grepInvert` **only when
`E2E_SKIP_KNOWN_FAILING=1`** (set in CI). Locally nothing is hidden: they still
run and still fail. CI prints how many it excluded. No test was deleted, skipped
or marked `fixme`.

Rule: **the list may only shrink.** Fix a test, delete its line. Never add a line
to hide a new failure.

### Dummy-env e2e

See the end of this file (filled in after the run).

### Owner: make the gate binding

GitHub does not require the check just because the workflow exists. Settings →
Branches → Add branch protection rule (or Rules → Rulesets) for `main`:
tick "Require status checks to pass before merging", search and add
**`Main / all checks`** (it appears after the workflow has run once on a pull
request), tick "Require branches to be up to date before merging". Optionally
"Require a pull request before merging". Vercel only builds `main` (phase 2),
so this is what stops a red commit reaching production.

## 4.2 Database types

### Feasibility (measured)

Feasible. All 109 migrations (0001 to 0111; 0063 does not exist) apply, in
order, to an in-memory PGlite on a small Supabase stub (roles anon /
authenticated / service_role, `auth.users` + `auth.uid()` / `auth.role()` /
`auth.jwt()`, `storage.buckets` / `storage.objects` / `storage.foldername()`).
No migration needed a change; none was edited. `supabase gen types` needs Docker
and was not installed.

`scripts/db-types.mjs` applies the migrations, reads `pg_catalog` back and
writes `lib/supabase/database.types.ts` in the shape `supabase gen types`
produces (Tables Row / Insert / Update / Relationships, Views, Functions, Enums).
It takes about 13 s and touches no real database.

- `npm run db:types` rewrites the file; `npm run db:types:check` fails when it is
  stale (a migration changed and the file was not regenerated). It runs in CI.
- Two deliberate departures from the Supabase CLI output: rpc arguments accept
  `null` (every Postgres function argument may be NULL), and the *write* side of
  json/jsonb columns and rpc arguments is `JsonInput = Json | object`, because
  the app passes interfaces and `Record<string, unknown>`. Row (read) types are
  the strict `Json`.
- Not a replica of production: it is what the migrations say. If a migration was
  never run on production, or production was changed by hand, the file differs
  from the live schema.

(Typing the factories and the cast count are filled in below once done.)

## 4.3 Loading and error screens

New: `loading.tsx` and `error.tsx` for `/dashboard`, `/projects`, `/orders`; an
`error.tsx` for the CAD Champions admin area (`cad-champions/admin` already had
`loading.tsx`; its `error.tsx` re-exports the CAD Champions one so the admin side
nav stays on screen). Shared bodies: `components/route-state/route-error.tsx`
(client, retry button + contact link, never shows the error or digest, logs it to
the console) and `route-loading.tsx` (neu skeleton, announced "Loading" for
screen readers). Messages: namespace `RouteState` (EN + AR). `error.tsx` is a
client component rendered outside any page's `MessagesScope`, so `RouteState`
is in `BASE_MESSAGES` (5 short keys in every page payload).

## 4.5 Lint ratchet

`lint-ratchet.json` = 304 warnings (measured 2026-11-11, equals the end of
phase 3A). `npm run lint:ratchet` runs ESLint with JSON output and fails if the
count goes above the stored number; below it prints "lower the number" (and
fails in CI, so the number really gets lowered: `npm run lint:ratchet -- --update`
writes the new count). The comparison lives in `scripts/lint-ratchet.mjs`
(`compareToRatchet`, `countFromEslintJson`) and is unit-tested in
`lib/dev-lint-ratchet.test.ts`.

## 4.4 Audit slices R11 and R12

Rule: only mechanical, test-covered items were fixed (cap about 10 files).
Everything else is listed with a suggested fix and a risk rating.

### R11: hooks out of `lib/`, no inline Supabase queries in components

Fixed (mechanical: file moves + import paths, `tsc`, vitest, build as proof, 16 files touched):

| Was | Now |
|---|---|
| `lib/credits/use-credits.ts` (11 importers) | `lib/credits/client/use-credits.ts` |
| `lib/pricing/use-price-quote.ts` | `lib/pricing/client/use-price-quote.ts` |
| `lib/store/use-delivery-quote.ts` | `lib/store/client/use-delivery-quote.ts` |

Not fixed:

| File | Violation | Suggested fix | Risk |
|---|---|---|---|
| `lib/schools/client.ts` | exports a hook (`useClassOrderId`) beside client helpers; already client-only, imported by 2 pages | move to `lib/schools/client/` with `use-class-order.ts` | Low, but it is also imported as `schools/client` by name in `client.test.ts`; do it with its test |
| `components/parts/cart-provider.tsx` (19 `.from(` calls) | the whole cart (guest session, kits, project lines) is inline queries in a context provider | extract `lib/store/client/cart-db.ts` (same queries, moved); provider keeps state only | High: money path, guest-cart migration; needs the e2e store specs against a real project |
| `components/dashboard/admin-overview.tsx` (17) | KPI queries inline in a component | `lib/admin/overview-data.ts` called from the (server) page | Medium |
| `components/prototyping/workspace.tsx` (10), `idea-stage.tsx` (5), `part-dialogs.tsx` (4), `schematics-stage.tsx` (3), `parts-stage.tsx` (3), `bom-table.tsx` (3), `parts-list.tsx` (2), `client/client-workspace.tsx`, `use-project-boards.ts` | project/brief/BOM reads and writes inline | one `lib/prototyping/client/project-db.ts` (typed functions: `loadProject`, `patchProject`, `savePart` ...) | High: the studio e2e specs (the known-failing ones) cover it |
| `components/inventory/my-inventory.tsx` (7) | inventory CRUD inline | `lib/inventory/client/*` | Medium |
| `components/home/your-work-strip.tsx` (7) | read queries inline (pure selection logic is already in `lib/home/your-work.ts`) | move the 4 reads next to the selection logic | Low |
| `components/projects/{project-list,items-card,blocks-card}.tsx` (6 each), `new-project-form.tsx` (4), `project-cad-card.tsx` (3), `use-project-data.ts`, `brief-card`, `phone-prompt`, `new-project-chat`, `project-header`, `project-parts-list` | inline project queries | `lib/projects/client/*` (some already exist) | Medium |
| `components/parts/add-to-project-button.tsx` (5), `components/search/unified-search.tsx` (3), `components/design/quote-request.tsx` (2), `components/dashboard/admin-home.tsx` (2), `components/credits/cad-card.tsx`, `components/cad-champions/training/stats.tsx` (2) | inline queries | same pattern | Low to Medium |
| 10 cache modules without a `server-only` marker | can be imported from a client by mistake | `import "server-only"` | Not done: vitest imports several of them and the `server-only` package throws outside Next; needs a vitest alias first |

Totals: 29 component/hook files contain a `.from("` call (about 160 calls).

### R12: one error shape per API route

75 route files; 44 use `lib/http.ts` (`jsonError`/`jsonOk`). 31 do not:

| Group | Routes | Why left | Suggested fix |
|---|---|---|---|
| Already `{ error: "<code>" }` + status, but with a `Cache-Control: no-store` header the helper cannot carry | `cad-champions/attempts/[id]/status`, `certificates/[code]`, `payments/[id]/receipt`, `payments/[id]/status`, `results/[attemptId]/report`, `results-template`, `payments/skipcash/webhook`, `cron/cc-payments-expire`, `cron/cc-weekly-progress` | swapping to `jsonError` would drop the no-store header (a behaviour change) | give `jsonError` an optional `headers` argument, then swap (byte-identical output); Low |
| `{ ok: false, error }` / `{ ok: true }` envelopes parsed by clients | `auth/claim-guest`, `projects/claim`, `admin/youtube/upload`, `design-quote`, `project-cad` | clients read `ok` | keep (documented bespoke shape) or migrate client and route together; Medium |
| `{ sent: boolean }` | `projects/recovery-email` | client branches on `sent` | keep; documented bespoke shape |
| HTML pages, redirects, file downloads | `auth/callback`, `notifications/unsubscribe`, `orders/rate`, `orders/review`, `admin/customers/[id]/export`, `admin/projects/[id]/export`, `cad-champions/video/[ref]`, `cad-champions/time` | not JSON errors | keep |
| Studio product routes (`studio/product/{check,choose,design,engineer,model,preview,unlock}`) and `store/search` | use `lib/studio/server/product.ts` `json()` / their own helper | shape already uniform inside the studio | point `json()` at `lib/http.ts` later; Low |

Nothing in R12 was changed: the only candidates that are byte-identical need a
helper change first, and the rest are client-parsed shapes that the plan says to
leave and document.
