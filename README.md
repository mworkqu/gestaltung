# Gestaltung

Manufacturing studio and parts store for Qatar, bilingual (English and Arabic, RTL), live at
gestaltung360.com.

## What it is

- A customer uploads a design or describes a product. The studio, based in Lusail, makes the part
  itself (Prusa MK4 3D printing, CNC machining, laser cutting) and delivers it. There are no partner
  workshops and no automatic method detection; an engineer quotes the method.
- A parts store sells mechanical and electronic parts (screws, nuts, fasteners, electronics).
- A design Studio and Prototyping flow turns a brief into a project, a bill of materials, a netlist,
  CAD and a quote, using AI providers (Gemini, Groq) metered by a credits ledger.
- Roles: `super_admin` (the owner, sees everything), `workshop`, `client`; visitors without an account
  are Supabase anonymous users ("guests").

## Stack

Next.js 15 (App Router, webpack build), TypeScript strict, Tailwind CSS 3 and shadcn/ui, next-intl 4,
Supabase (Postgres, Auth, Storage via `@supabase/ssr`), zod 4, vitest 4, Playwright, deployed on
Vercel (Node 24.x). Optional cloud CAD worker in `services/cad-worker` (Google Cloud Run, see
`docs/CAD_CLOUD.md`).

## Run locally

```bash
npm ci
# create .env.local with the variables below (never commit it)
npm run dev               # http://localhost:3000
```

Environment variables (names only; values are never stored in the repo):

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser and server clients (required) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role client, server only |
| `RESEND_API_KEY`, `RESEND_FROM`, `STORE_LEAD_EMAIL` | Email (orders, leads, notifications) |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | AI features |
| `CRON_SECRET` | Authorises the cron routes in `vercel.json` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Turnstile (feature flag, off by default) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_SITE_URL` | Analytics, canonical URL |
| `GCP_WIF_PROVIDER`, `GCP_CAD_SA_EMAIL`, `GCP_CAD_URL` (and `GCP_CAD_SA_KEY`), `CAD_WORKER_TOKEN` | Optional cloud CAD worker |

More (supplier APIs, AI model overrides, Google Drive import) are read in `lib/**`; grep for
`process.env`. Project ids and hosting notes are in `docs/ENVIRONMENT.md`. Without Supabase
variables most pages cannot load data. The e2e suite points at the production Supabase and is
read-only; see `playwright.config.ts`.

## Commands

| Command | Does |
|---|---|
| `npm run dev` / `build` / `start` | Dev server, production build, serve the build |
| `npm run lint` | `eslint .` (expression-bodied `useEffect` is banned) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest, `lib/**/*.test.ts` |
| `npm run test:e2e` | Playwright smoke suite (run `npm run build` first; read-only behind a write guard) |
| `npm run check:cycles` | madge import-cycle check |
| `npm run check:unused` | knip unused files, exports, dependencies |
| `node scripts/check-i18n-parity.mjs` | EN and AR message files have identical keys |
| `node scripts/split-legal-draft.mjs --check` | `content/legal/**` still equals `LEGAL_PAGES_DRAFT.md` |

## Folder map

| Folder | Content |
|---|---|
| `app/[locale]/` | Pages and layouts (public store, `/design`, `/projects`, `/orders`, `/schools`, `/dashboard/**`) |
| `app/api/` | Route handlers (admin, cron, auth, billing, bom, engineering, orders, projects, studio, AI routes) |
| `components/` | UI; `components/studio/**` is the design Studio |
| `lib/` | Domain logic by area (pricing, credits, orders, store, parts, studio, ai, email, supabase, auth, ...) |
| `messages/` | `en.json` and `ar.json` UI strings |
| `i18n/` | next-intl routing and request config |
| `content/` | `legal/**` (generated, never hand-edited) and case studies |
| `supabase/migrations/` | SQL migrations, run by hand in the Supabase SQL editor |
| `services/cad-worker/` | Optional cloud CAD worker (not part of the Vercel build) |
| `scripts/` | Maintenance scripts (i18n parity, legal split, measurements) |
| `e2e/` | Playwright specs |
| `public/`, `assets/` | Static files, OG images |
| `docs/` | Audit, history, decisions, migrations, environment, feature notes |

## Documentation

- `CLAUDE.md`: rules, architecture map, commands and pending migrations for contributors and agents.
- `docs/audit/CODE_MAP.md`: detailed code map. Also in `docs/audit/`: security audit, code-quality
  audit, refactor plan, baseline.
- `docs/MIGRATIONS.md`: migration run log and rules for new migrations.
- `docs/DECISIONS.md`: owner decisions. `docs/ENVIRONMENT.md`: ids and environment notes.
- `docs/history/`: the old stage-by-stage log and prompt files, kept verbatim.
- `DESIGN.md`: design system. `LEGAL_PAGES_DRAFT.md`: source of the legal pages.
- `Gestaltung_Build_Plan.md` is a Word document with a `.md` extension; open it with Word, not a
  text editor.
