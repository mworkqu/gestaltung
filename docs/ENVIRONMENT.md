# Environment

Where the project lives. Copied from the pre-audit `CLAUDE.md` (`docs/history/CLAUDE-2026-10-full.md`: Stage 1, "Permanent notes", "Environment notes"). Ids only; no secret values (keys live in `.env.local` and the Vercel project settings).

## Services and ids

| Item | Value |
|---|---|
| Supabase project | `jgwuafubtmpaonsznfyw` |
| Vercel project | "gestaltung" (`prj_xO2xcUzSvV0Y7D0fAlqHmFcB6n5P`) |
| Vercel team | "GESTALTUNG RASHWAN" (slug `gestaltungco-7345s`) |
| GitHub repo | `mworkqu/gestaltung`, branch `main` (source of truth) |
| Deploy | Push to `main` auto-deploys on Vercel (Git integration, production branch `main`); every other branch is skipped (see "Builds" below). Config in `vercel.json` (framework `nextjs`; no publish dir or output setting). Manual deploy if ever needed: `vercel --prod` from the project folder after `vercel link`; push-to-deploy is preferred. |
| Live URLs | https://gestaltung.vercel.app (live); custom domain www.gestaltung360.com (recorded as "point DNS at Vercel when ready"). |
| GA4 Measurement ID | `G-QXVQ4H05Y7` |
| Hosting history | Netlify 2026-06-03 to 2026-06-04, then moved back to Vercel on 2026-06-04. The Netlify projects, `netlify.toml` and the `NODE_VERSION=20` env var are gone. |

## Builds: `main` only (2026-11 consolidation, phase 2)

- `vercel.json` has `"ignoreCommand": "[ \"$VERCEL_GIT_COMMIT_REF\" != \"main\" ]"`. Vercel skips the build when the command exits 0 (any branch other than `main`) and builds when it exits 1 (`main`). Sources: https://vercel.com/docs/project-configuration/vercel-json#ignorecommand ("When the command exits with code 1, the build will continue. When the command exits with 0, the build is ignored"; it overrides the dashboard setting) and https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel (`VERCEL_GIT_COMMIT_REF` = the branch name).
- **Preview deployments are off.** A push to any other branch (`consolidation-*`, `cad-champions`, ...) creates no build, and a `[deploy]` marker in a commit message no longer does anything.
- **Owner action:** Vercel dashboard → Project → Settings → Git → **Ignored Build Step**: clear the old custom command (it built previews for commits containing `[deploy]`) and leave it on "Automatic". `vercel.json` overrides it anyway, but the leftover command is misleading.
- **Testing happens locally:** `npm run build && npm start` (http://localhost:3000) with `.env.local`, then `npm run test:e2e`.
- `scripts/vercel-prune.ps1` and its rule stay: run it only once the new `main` build is Ready (it deletes in-flight builds).

## Environment variables

- Vercel, all three scopes (Production / Preview / Development): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only). Values: (see .env.local).
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` must be set in Vercel (all three scopes).
- `NEXT_PUBLIC_WHATSAPP_NUMBER` (digits only, e.g. 97412345678). Recorded as not set, with a fallback to /contact; see the note in `docs/DECISIONS.md` (D10).
- Mac Mini worker (Phase 3A, `docs/WORKER.md`): Vercel Production gets `WORKER_URL` (https tunnel address) and `WORKER_SECRET` (32+ characters, the same value as in `services/.env` on the Mac). Without both, no cron route ever contacts the worker. The worker's own env names are in `services/.env.example`.
- Only `NEXT_PUBLIC_`-prefixed variables reach the browser.
- Further env var names per area: `README.md` and `docs/audit/CODE_MAP.md`.

## Versions

| Item | Value |
|---|---|
| Node | 24.x. `"engines": {"node": "24.x"}` in `package.json` and the Vercel project setting (Project Settings -> Node.js Version) must match; if they drift, the dashboard setting wins the build. Bumped from 20.x on 2026-06-04 because Node 20 reached end of life. |
| next | Pinned to `^15.2.3` (15.2.3 or later is required for the CVE-2025-29927 fix). Pre-audit `CLAUDE.md` value; check `package.json` for the current pin. |

## Windows notes (old)

- The project runs on the owner's Windows machine (PowerShell). npm, git, `next build`, netlify and vercel CLIs all work there. Earlier sandbox notes about blocked npm/git no longer apply.
- The Next.js project root is the subfolder "Gestaltung - a manufacturing marketplace and inventory platform for Qatar" (contains `package.json` and `.git`; the folder name has an em dash and spaces). The Claude Code working directory was its parent, so `cd` into the subfolder for npm/git, or pass an explicit path (e.g. `vercel --cwd <subfolder>`).
- Local builds once mis-detected the workspace root because of a stray `C:\Users\<user>\package-lock.json` plus the spaces and em dash in the folder name. Fixed 2026-06-04 by pinning `outputFileTracingRoot` to the project folder in `next.config.mjs`. Vercel's clean checkout was never affected.
