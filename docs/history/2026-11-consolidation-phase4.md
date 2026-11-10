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
