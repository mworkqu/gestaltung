# Environment

Where the project lives. Copied from the pre-audit `CLAUDE.md` (`docs/history/CLAUDE-2026-10-full.md`: Stage 1, "Permanent notes", "Environment notes"). Ids only; no secret values (keys live in `.env.local` and the Vercel project settings).

## Services and ids

| Item | Value |
|---|---|
| Supabase project | `jgwuafubtmpaonsznfyw` |
| Vercel project | "gestaltung" (`prj_xO2xcUzSvV0Y7D0fAlqHmFcB6n5P`) |
| Vercel team | "GESTALTUNG RASHWAN" (slug `gestaltungco-7345s`) |
| GitHub repo | `mworkqu/gestaltung`, branch `main` (source of truth) |
| Deploy | Push to `main` auto-deploys on Vercel (Git integration, production branch `main`). Config in `vercel.json` (framework `nextjs`; no publish dir or output setting). Manual deploy if ever needed: `vercel --prod` from the project folder after `vercel link`; push-to-deploy is preferred. |
| Live URLs | https://gestaltung.vercel.app (live); custom domain www.gestaltung360.com (recorded as "point DNS at Vercel when ready"). |
| GA4 Measurement ID | `G-QXVQ4H05Y7` |
| Hosting history | Netlify 2026-06-03 to 2026-06-04, then moved back to Vercel on 2026-06-04. The Netlify projects, `netlify.toml` and the `NODE_VERSION=20` env var are gone. |

## Environment variables

- Vercel, all three scopes (Production / Preview / Development): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only). Values: (see .env.local).
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` must be set in Vercel (all three scopes).
- `NEXT_PUBLIC_WHATSAPP_NUMBER` (digits only, e.g. 97412345678). Recorded as not set, with a fallback to /contact; see the note in `docs/DECISIONS.md` (D10).
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
