# CLAUDE.md

PROJECT: Gestaltung — a manufacturing marketplace and inventory platform for Qatar.

## WHAT THE BUSINESS DOES
- Clients upload 3D/CAD files (STL, STEP, DXF, IGES).
- The platform identifies the right manufacturing method (3D printing, CNC machining, laser cutting, EDM).
- Jobs are dispatched to partner workshops across Qatar, who produce the part.
- The finished product is delivered back to the client.
- A second module is e-commerce for high-quality mechanical parts (screws, nuts, fasteners).
- The backbone is a multi-tenant inventory system.

## USERS / ROLES
- Super Admin (the owner): sees ALL data across every workshop and client in Qatar.
- Workshop: a partner producer with their own isolated inventory and jobs.
- Client: a customer with their own isolated orders and inventory.

Each tenant only ever sees their own data. The Super Admin sees everything.

## REQUIREMENTS
- Fully bilingual: Arabic (RTL) and English. Language toggle everywhere.
- Stack: Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, next-intl, Supabase (Postgres + Auth + Storage), deployed on Vercel.

## BUILD STYLE
- Build incrementally. Do only what each prompt asks. Do not scaffold future features early.
- After each task, tell me exactly how to test it locally before I continue.

## PROGRESS
- Stage 1 (scaffold + deploy "hello world"): DONE and LIVE.
  - Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui. Single landing page at app/page.tsx
    (Gestaltung name + tagline + shadcn Buttons, dark on-brand look).
  - LIVE (public, no auth wall): https://gestaltung.vercel.app
  - HOSTING = Vercel (migrated back from Netlify on 2026-06-04). Project "gestaltung"
    (id prj_xO2xcUzSvV0Y7D0fAlqHmFcB6n5P) in team "GESTALTUNG RASHWAN" (slug gestaltungco-7345s).
  - SOURCE OF TRUTH = GitHub repo mworkqu/gestaltung, branch main.
  - AUTO-DEPLOY: push to main -> Vercel builds & deploys (Git integration, production branch = main).
    Config in vercel.json (framework: nextjs — Vercel's Next.js preset runs `next build`, no publish
    dir / output setting needed). Node version = "engines": {"node":"24.x"} in package.json (bumped
    from 20.x on 2026-06-04 — Node 20 reached EOL; Vercel project + local machine both run 24.x).
    NEXT_PUBLIC_ rule: only NEXT_PUBLIC_-prefixed vars reach the browser.
  - next pinned to ^15.2.3 (>=15.2.3 required for CVE-2025-29927).
  - Manual deploy if ever needed: `vercel --prod` from the project folder (after `vercel link`).
    NOTE: local builds used to mis-detect the Next.js workspace root because of a stray
    C:\Users\<user>\package-lock.json plus the spaces/em-dash in this folder name. FIXED 2026-06-04 by
    pinning `outputFileTracingRoot` to this folder in next.config.mjs (silences the "inferred workspace
    root" warning locally; Vercel's clean checkout is unaffected). Still prefer push-to-deploy.
  - DONE (2026-06-04): Vercel Git reconnected, production deploy verified on gestaltung.vercel.app
    (/en LTR, /ar RTL + جِشتالتُونج, / → default locale all 200). Netlify projects
    were fully DELETED, so GitHub now auto-deploys only to Vercel.
    NODE UPDATE (2026-06-04): Vercel Project Settings → Node.js Version is now 24.x and engines was
    bumped to 24.x to match (was 20.x on both). If they ever drift, the dashboard setting wins the build.
  - SUPERSEDED (Netlify era, 2026-06-03 → 2026-06-04): site was briefly hosted on Netlify
    (gestaltung.netlify.app, @netlify/plugin-nextjs, netlify.toml). netlify.toml and the only Netlify
    env var (NODE_VERSION=20) are gone; the Netlify projects have been deleted. Removed the stale
    old-Vercel/Netlify helper scripts (GO-LIVE.bat / go-live.ps1 / push-to-github.ps1 / DEPLOY.md).
- Stage 2 (bilingual EN/AR shell + on-brand theme + logo in header): DONE.
  - Full next-intl bilingual shell: /[locale] routing (en default, ar), middleware, RTL/dir + IBM Plex
    Arabic font, messages/en.json + ar.json, working EN/ع language switcher (components/language-switcher.tsx).
  - Theme: "precision / engineering" — dark (#0a0e15) with a bright azure accent (#3ea6ff). Palette lives in
    app/globals.css (shadcn HSL tokens) + tailwind.config.ts (exact-hex brand colors: azure/panel/heading/
    body/mutedtext/faint/borderstrong). Supersedes the earlier "metallic" idea.
  - Landing page (app/[locale]/page.tsx): redesigned 2-col hero (azure kicker, H1, CAD→part copy, Get a quote /
    How it works, blueprint panel with faint grid + geometric G mark + STL·STEP·DXF·IGES) and a 3-card feature row.
  - Real /public/logo.png is in the header (components/header.tsx). components/g-mark.tsx is an inline-SVG G
    used as the blueprint-panel mark in the hero.
  - Both /en and /ar are fully translated; /ar is RTL-correct (no letter-spacing on Arabic). Brand name in
    Arabic is جِشتالتُونج.
- Stage 3 (public presentation site): DONE.
  - Bilingual marketing pages under app/[locale]: home (/), how-it-works, about, contact. Responsive,
    existing azure theme, all copy from messages/{en,ar}.json (no hardcoded strings).
  - Contact form (components/contact-form.tsx, client) submits → logs to console + success state. No backend yet.
  - Header nav links to the real pages. Store is intentionally deferred from the nav until Stage 8
    (e-commerce). "Get a quote" / "Upload a file" route to /contact for now (real upload arrives in Stage 6).
- ROADMAP: the full staged plan (Stages 1–9) lives in Gestaltung_Build_Plan.md — note that file is actually a
  Word/.docx (binary, mislabeled .md), so extract word/document.xml to read it. Next up:
  Stage 4 = Supabase auth + roles (super_admin/workshop/client) + RLS multi-tenant isolation (needs a Supabase
  project + env vars from the owner); then 5 inventory, 6 manufacturing flow, 7 admin dashboard, 8 e-commerce, 9 AI.
  - HOSTING ENV NOTE for Stage 4: add the Supabase env vars in Vercel (Project → Settings → Environment
    Variables) for ALL THREE scopes (Production / Preview / Development): NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY (browser-safe), and the server-only SUPABASE_SERVICE_ROLE_KEY
    (NO NEXT_PUBLIC_ prefix — keep it server-side only). There are NO app env vars today.

## ENVIRONMENT NOTES (for Claude)
- This project now runs on the USER'S Windows machine (PowerShell): npm, git, next build, netlify, and vercel
  CLIs all work here. (Earlier sandbox notes about blocked npm/git no longer apply.)
- The Next.js project root is the subfolder "Gestaltung — a manufacturing marketplace and inventory platform
  for Qatar" (contains package.json + .git). The Claude Code working dir is its PARENT, so cd/Set-Location into
  the subfolder for npm/git, or pass an explicit path (e.g. `vercel --cwd <subfolder>`).
