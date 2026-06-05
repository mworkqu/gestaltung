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
- Stage 4 (Supabase auth + roles + multi-tenant RLS): DONE (code) — needs the SQL migration run once in Supabase.
  - @supabase/ssr wiring: browser client (lib/supabase/client.ts), server client (lib/supabase/server.ts),
    and middleware session refresh (lib/supabase/middleware.ts updateSession) that COMPOSES with next-intl —
    root middleware.ts runs the intl middleware first, then augments that same response with refreshed auth
    cookies, so /[locale] routing + EN/AR switcher are untouched. Middleware no-ops if Supabase env is missing.
  - Schema + RLS in supabase/migrations/0001_auth_roles_rls.sql (RUN THIS in the Supabase SQL editor):
    tenants (type workshop|client), profiles (id->auth.users, role super_admin|workshop|client, tenant_id,
    full_name, locale), handle_new_user trigger auto-creates a profile (default role 'client'). RLS enabled on
    both tables with explicit select/insert/update/delete policies: super_admin sees ALL, workshop/client see
    ONLY their own tenant_id. Recursion avoided via SECURITY DEFINER helpers is_super_admin() /
    current_user_role() / current_user_tenant_id() (search_path='').
  - First super_admin = sign up, then: update public.profiles set role='super_admin', tenant_id=null where
    id=(select id from auth.users where email='...').
  - Bilingual auth UI under app/[locale]: sign-in, sign-up, sign-out (components/auth/*), azure/neu themed,
    strings in messages/{en,ar}.json (Auth + Dashboard namespaces). Header has a Sign in link.
  - Protected app/[locale]/dashboard (force-dynamic) shows email/role/tenant via lib/auth/get-session.ts;
    redirects anon → /[locale]/sign-in. Role-aware redirect helper lib/auth/redirects.ts (locale-agnostic
    path; all roles → /dashboard for now). Role-specific dashboards deliberately NOT built yet.
  - tsconfig.json now excludes "Design that I like" (a gitignored reference Vite app that broke local typecheck).
  - Contact form lead capture (supabase/migrations/0002_inquiries.sql): public.inquiries table — anon INSERT
    (public form), super_admin-only SELECT/UPDATE/DELETE via RLS (reuses is_super_admin()). The contact form
    (components/contact-form.tsx) now inserts to Supabase via the browser client instead of console.logging.
    WhatsApp number is the REQUIRED primary contact channel (owner: WhatsApp is the main medium, not email);
    email is optional. Copy is WhatsApp-first in en+ar. RUN 0002 in Supabase after 0001.
  - Account phone number (supabase/migrations/0003_profiles_phone.sql): profiles.phone column; sign-up form
    collects a required phone (handle_new_user trigger copies it from metadata); shown on the dashboard.
    Owner picked the 100%-free path (no SMS/WhatsApp provider) — phone is stored now, reserved for future use
    as a confirmation channel or alternative login. NOT written to auth.users.phone (that triggers paid phone
    auth). RUN 0003 in Supabase after 0001. Phone/WhatsApp OTP deferred (costs per-message; revisit later).
- Stage 5 (multi-tenant inventory): DONE (code) — needs SQL migration 0004 run once in Supabase.
  - supabase/migrations/0004_inventory_items.sql: inventory_items (tenant_id NOT NULL FK, sku, name,
    description, category, quantity, unit, unit_price, low_stock_threshold, created_at, updated_at).
    set_updated_at trigger; inventory_default_tenant trigger forces tenant_id to caller's tenant when omitted.
    Unique (tenant_id, sku). RLS reuses is_super_admin()/current_user_tenant_id(): super_admin all rows,
    workshop/client only their own tenant. Explicit select/insert/update/delete policies. RUN 0004 after 0001.
  - Protected CRUD under app/[locale]/dashboard/inventory: list (page.tsx, server, RLS reads, low-stock badge,
    super_admin gets a tenant column + TenantFilter via ?tenant= query), new/ + [id]/edit/ pages, server
    actions in inventory/actions.ts (createItem/updateItem/deleteItem via server client — RLS server-side, no
    service-role). item-form.tsx (useActionState, client+server validation), delete-item-button.tsx (themed
    confirm modal, no radix). Empty/error/loading states.
  - Dashboard now has app/[locale]/dashboard/layout.tsx: single auth gate + sub-nav (Overview | Inventory via
    components/dashboard/dashboard-nav.tsx) + SignOut. Overview page (dashboard/page.tsx) refactored to live
    inside that layout (dropped its own container + SignOut).
  - Inventory + DashboardNav namespaces in messages/{en,ar}.json (bilingual, RTL, azure/neu theme). currency = QAR/ر.ق.
- ROADMAP: the full staged plan (Stages 1–9) lives in Gestaltung_Build_Plan.md — note that file is actually a
  Word/.docx (binary, mislabeled .md), so extract word/document.xml to read it. Next up:
  Stage 6 manufacturing flow, 7 admin dashboard, 8 e-commerce, 9 AI.
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
