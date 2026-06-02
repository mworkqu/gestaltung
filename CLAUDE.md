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
  - Vercel project: "gestaltung" in team "gestaltungco-7345s-projects". Deployed via Vercel CLI.
  - next pinned to ^15.2.3 (>=15.2.3 required; Vercel blocks the CVE-2025-29927 versions).
  - vercel.json pins framework to "nextjs" (project was created bare, so this forces the Next.js build).
  - Deploy is one-click from the USER'S machine: double-click GO-LIVE.bat (runs go-live.ps1):
    clean reinstall -> vercel login (if needed) -> "vercel project add gestaltung" -> "vercel --prod --yes --project gestaltung".
  - Helper scripts in repo root: GO-LIVE.bat / go-live.ps1 (deploy), run-local.ps1 (localhost:3000),
    push-to-github.ps1 (optional GitHub), DEPLOY.md (written instructions).
  - NOT on GitHub yet, so there is no push -> auto-deploy. To redeploy: re-run GO-LIVE.bat.
    (To get auto-deploy: run push-to-github.ps1, then import the repo at vercel.com/new.)
- Stage 2 (bilingual EN/AR shell + dark metallic theme + logo in header): NOT STARTED.
  - Logo was provided in chat but not saved to disk; user must drop the file into /public when Stage 2 begins.

## ENVIRONMENT NOTES (for Claude)
- The project folder is mounted read/write in the agent sandbox but BLOCKS file deletion/rename,
  and the agent's npm registry is blocked (cannot create-next-app / npm install / build / run git here).
  => Build, install, git, and deploy all run on the USER'S Windows machine via the PowerShell scripts above.
