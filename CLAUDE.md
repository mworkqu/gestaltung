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
- Stack: Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, next-intl, Supabase (Postgres + Auth + Storage), deployed on Netlify (free plan; commercial use allowed).

## BUILD STYLE
- Build incrementally. Do only what each prompt asks. Do not scaffold future features early.
- After each task, tell me exactly how to test it locally before I continue.

## PROGRESS
- Stage 1 (scaffold + deploy "hello world"): DONE and LIVE.
  - Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui. Single landing page at app/page.tsx
    (Gestaltung name + tagline + shadcn Buttons, dark on-brand look).
  - LIVE (public, no auth wall): https://gestaltung.netlify.app
  - HOSTING = Netlify (moved off Vercel on 2026-06-03). Site "gestaltung" in team "GESTALTUNG RASHWAN"
    (account slug gestaltung-co), free plan (commercial use allowed). Admin: https://app.netlify.com/projects/gestaltung
  - SOURCE OF TRUTH = GitHub repo mworkqu/gestaltung, branch main.
  - AUTO-DEPLOY: push to main -> Netlify builds & deploys (continuous deployment via the Netlify GitHub App).
    Production branch = main. Build config in netlify.toml (next build, NODE_VERSION 20, @netlify/plugin-nextjs /
    Next.js Runtime v5). Verified: pushing commit 6aa7cd1 auto-built and deployed on Netlify.
  - VERCEL: Git integration DISCONNECTED (`vercel git disconnect`) — pushes no longer deploy to Vercel.
    Old Vercel project + deploys (gestaltung.vercel.app) left up for now; can be deleted later.
    vercel.json left in repo (Netlify ignores it).
  - next pinned to ^15.2.3 (>=15.2.3 required for CVE-2025-29927).
  - Manual deploy if ever needed: `netlify deploy --build --prod` from the project folder.
    NOTE: local builds can mis-detect the Next.js workspace root because of a stray, empty
    C:\Users\<user>\package-lock.json plus the spaces/em-dash in this folder name, which produced a
    broken serverless function on a local CLI deploy. Netlify's CD build checks the repo out to a clean
    path and is unaffected — prefer push-to-deploy.
  - STALE: the old Vercel helper scripts (GO-LIVE.bat / go-live.ps1 / push-to-github.ps1 / DEPLOY.md)
    predate the Netlify+GitHub setup and no longer reflect how deploys work.
- Stage 2 (bilingual EN/AR shell + dark metallic theme + logo in header): NOT STARTED.
  - Logo was provided in chat but not saved to disk; user must drop the file into /public when Stage 2 begins.

## ENVIRONMENT NOTES (for Claude)
- The project folder is mounted read/write in the agent sandbox but BLOCKS file deletion/rename,
  and the agent's npm registry is blocked (cannot create-next-app / npm install / build / run git here).
  => Build, install, git, and deploy all run on the USER'S Windows machine via the PowerShell scripts above.
