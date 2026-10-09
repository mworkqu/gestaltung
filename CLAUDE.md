# CLAUDE.md

PROJECT: Gestaltung — a manufacturing marketplace and inventory platform for Qatar.

## WHAT THE BUSINESS DOES
- Clients upload 3D/CAD files (STL, STEP, DXF, IGES).
- The platform identifies the right manufacturing method (3D printing, CNC machining, laser cutting, EDM).
- Jobs are dispatched to partner workshops across Qatar, who produce the part.
- The finished product is delivered back to the client.
- A second module is e-commerce for high-quality mechanical parts (screws, nuts, fasteners).
- The backbone is a multi-tenant inventory system.
- 2026-10 note: the studio makes parts itself in Lusail (Prusa MK4, CNC, laser); there are no partner workshops and no automatic method detection — copy must never promise either.

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
- Stage 4 (Supabase auth + roles + multi-tenant RLS): DONE and verified live (migrations 0001–0003 run; Supabase
  project jgwuafubtmpaonsznfyw, new sb_publishable_ key format; Vercel env set Production + Development).
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
- Stage 5 (multi-tenant inventory): DONE and verified live (migration 0004 run in Supabase 2026-06-05).
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
- Stage 6a (CAD upload + job creation): DONE (code) — needs migration 0005 run + GA env var in Vercel.
  - supabase/migrations/0005_jobs.sql: creates the PRIVATE storage bucket 'cad-files' (50MB limit) + storage.objects
    policies (tenant = first path folder; super_admin all). jobs table (client_tenant_id NOT NULL FK,
    assigned_workshop_tenant_id nullable [reserved 6b], title, notes, material, quantity, method check
    3d_printing|cnc_machining|laser_cutting|edm, status check default 'submitted', created/updated_at). job_files
    (job_id FK, storage_path, file_name, file_ext check stl|step|dxf|iges, size_bytes, uploaded_at). Triggers:
    set_updated_at, jobs_default_tenant, jobs_guard_status (blocks non-super_admin status changes). RLS reuses
    is_super_admin()/current_user_tenant_id(); job_files gated by can_access_job() SECURITY DEFINER helper.
    client = own rows, super_admin = all, workshop = none yet. RUN 0005 after 0001+0004.
  - UI under app/[locale]/dashboard/jobs: list (page.tsx, RLS reads; super_admin gets a Client column), new/
    (client-only NewJobForm), [id]/ detail with 60s signed-URL downloads. Files upload DIRECT from browser to
    Storage (lib/supabase/client) under <tenant_id>/<uuid>/<file> — keeps big CAD files off the Vercel
    server-action 4.5MB body limit; DB rows written via server action createJob (jobs/actions.ts, RLS server-side,
    no service-role). Jobs link added to dashboard nav. lib/jobs/constants.ts (methods, exts, 50MB, bucket).
  - GA4 (global): loaded by components/cookie-notice.tsx only after the visitor presses Accept (decision D7,
    Phase G; @next/third-parties was removed), gated on NEXT_PUBLIC_GA_MEASUREMENT_ID (value G-QXVQ4H05Y7;
    in .env.local). ADD it in Vercel (Prod/Preview/Dev).
- Stage 6b (workshop dispatch + status workflow): DONE (code) — needs migration 0006 run in Supabase.
  - supabase/migrations/0006_job_workflow.sql: canonical status set submitted→quoted→in_production→ready→delivered
    (+cancelled) [replaces 6a set]. jobs RLS now also lets the assigned workshop SELECT/UPDATE its rows; storage
    cad_files_select extended via can_read_cad_object() so the assigned workshop can download the client's files;
    can_access_job() now includes the assigned workshop (covers job_files + job_events). jobs_status_transition
    trigger (replaces 6a jobs_guard_status): super_admin override; only admin sets assigned_workshop_tenant_id;
    client may cancel only an unassigned submitted job; workshop advances its assigned job exactly one step along
    the chain; illegal transitions raise. job_events audit table (RLS via can_access_job) auto-filled by
    insert/update triggers. RUN 0006 after 0005.
  - UI (app/[locale]/dashboard/jobs): list adds super_admin status+tenant filters (components/jobs/jobs-filters.tsx,
    ?status=&tenant=); detail adds role-aware controls (components/jobs/job-actions.tsx) — super_admin assign
    workshop + override status, workshop advance one step, client cancel — plus a status timeline from job_events.
    Workshops now see their assigned jobs via RLS. Server actions assignWorkshop/changeStatus in jobs/actions.ts
    (RLS + trigger enforce; no service-role). lib/jobs/constants.ts has JOB_STATUSES/STATUS_CHAIN/nextStatus().
  - Jobs namespace extended (en+ar) with the new status labels + assignment/override/advance/cancel/timeline/filter
    strings. JobStatus type + JobEvent type added.
- Stage 7 (workshop jobs, internal jobs, BOM + inventory deduction): DONE (code) — needs migration 0007 run.
  - Part 1: Inventory nav link hidden from clients (filtered in app/[locale]/dashboard/layout.tsx by role; the
    inventory table/route stays in the DB for clients, just not shown).
  - Part 2: jobs list usable for workshops — Client column shown for workshop+super_admin via the new
    accessible_client_tenants() SECURITY DEFINER RPC (a workshop can't read other tenants directly); status
    advance controls already work for the assigned workshop.
  - Part 3: workshop internal jobs. supabase/migrations/0007_internal_jobs.sql adds jobs.job_source
    (client|internal, default client) + jobs.parts jsonb ([{name,quantity,unit}]). Internal jobs are inserted with
    client_tenant_id = assigned_workshop_tenant_id = the workshop's tenant (self-assigned) so the existing
    jobs_insert policy + jobs_status_transition trigger let the workshop create and advance them. "New internal
    job" button + form (components/jobs/internal-job-form.tsx, app/.../jobs/new-internal). Internal/Client badge
    in the list + detail (source_internal/source_client labels).
  - Part 4: BOM + stock deduction. 0007 also: alters inventory_items.quantity to numeric(12,2) so fractional
    deductions don't truncate; new job_bom table (job_id FK, inventory_item_id FK, quantity_needed numeric) with
    RLS gated by can_access_job(). Job detail shows a Bill of Materials panel for the assigned workshop
    (components/jobs/workshop-job-panel.tsx): add/remove rows picking from their own inventory, per-row current
    stock with a red under-stock flag, and a Start Job button (submitted→quoted) with an insufficient-stock
    warning banner. Start Job (startJob server action) deducts quantity_needed from inventory_items.quantity
    (floored at 0) then advances status — all via the RLS server client, no service-role. The plain workshop
    "advance" in job-actions.tsx now starts from 'quoted' (submitted→quoted is the BOM/Start Job step).
  - Server actions added to jobs/actions.ts: createInternalJob, addBomRow, deleteBomRow, startJob. New types
    JobSource/JobPart/JobBomRow. Jobs namespace extended (en+ar) with internal-job + BOM strings. RUN 0007 after 0006.
- Original-plan Stage 7 (Super Admin global dashboard): DONE — no migration (reads via RLS).
  - components/dashboard/admin-overview.tsx: super_admin /dashboard overview becomes a command center —
    KPI cards (tenants with workshop/client split, jobs + open count, inventory item count, low-stock count),
    jobs-by-status breakdown, low-stock list across all workshops, and a recent-jobs table (all tenants).
    app/[locale]/dashboard/page.tsx branches: super_admin → AdminOverview, others → the account card.
    New Admin messages namespace (en+ar); reuses Jobs status/method/column labels.
  - Header now session-aware: components/header-auth-link.tsx (client) shows "Sign in" when anon, "Dashboard"
    when signed in (live via onAuthStateChange); marketing pages stay static. Nav.dashboard string added.
  - NOTE on numbering: the custom "Stage 7" the owner ran earlier (workshop jobs + BOM + inventory deduction,
    migration 0007) is a SEPARATE addition from this original-plan Stage 7. Both are now done.
- Stage 8a (security review + conversion wins): DONE (code) — needs migration 0009 run in Supabase.
  - SECURITY REVIEW: full report in SECURITY_REVIEW.md (project root). npm audit: 0 high/critical.
    Critical/High fixes applied: supabase/migrations/0009_security_hardening.sql (RUN AFTER 0008 —
    blocks self-promotion to super_admin / tenant hopping via profiles UPDATE [CRITICAL], pins
    tenants.type, DB-enforces the canVaryJob edit window in jobs_status_transition, narrows job_bom
    writes to the assigned workshop via can_manage_job_bom(), binds job_variations.changed_by to
    auth.uid()). Code fixes: startJob now CAS-advances submitted→quoted FIRST then deducts (kills the
    double-deduction on repeat calls; workshop-only), inventory actions sanitize the locale form field
    (open-redirect sink). Mediums for next stage are listed in SECURITY_REVIEW.md (atomic stock
    deduction RPC, inquiries length limits/rate limit, security headers, next-intl 4 upgrade).
  - Homepage additions (app/[locale]/page.tsx): LocalAdvantage 3-item strip (Factory/PackageCheck/
    ShieldCheck) after the feature cards + Social proof band (bg-ink, 4 grayscale placeholder
    institution tiles + "representative institutions" footnote). The third feature card is now the
    CAD drawing service chip (Features.cadTitle/cadCopy replaced aiTitle/aiCopy) linking to
    /cad-assistance.
  - NEW PAGE app/[locale]/cad-assistance/page.tsx (paid CAD-drawing service): hero, 3 steps, pricing
    tiers (Simple 200 / Assembly 450 / Complex from 800 QAR), WhatsApp CTA from
    NEXT_PUBLIC_WHATSAPP_NUMBER (digits only; NOT SET YET — falls back to /contact until added in
    .env.local + Vercel). Header nav link added (Nav.cadAssistance, between How-it-works and About).
    New namespaces LocalAdvantage/Social/CadAssistance in messages/{en,ar}.json.
- Stage 8b (upload-funnel upsells + B2B path bifurcation): DONE (code) — needs migration 0010 run in
  Supabase. Migration 0009 (security hardening) was RUN by the owner 2026-06-10. ✔
  - supabase/migrations/0010_job_upsells.sql (RUN AFTER 0009; the 8b prompt said "0008" but that number
    was taken): jobs gains speed_tier (standard|express), post_processing text[] ({bead_blast,anodize}),
    inspection_report bool, job_path (prototype|production), production_qty_range
    (10-50|50-250|250-1000|1000+, null unless production). No RLS changes needed.
  - New-job form (components/jobs/new-job-form.tsx): path two-card toggle (production reveals qty-range
    select, client+server validated), speed-tier cards (express = amber +35% badge + informational note,
    no computed price), add-on checkbox cards (bead blast / anodize / inspection report — the report is
    the separate boolean, NOT in post_processing). createJob validates everything against
    lib/jobs/constants.ts (JOB_PATHS/SPEED_TIERS/PRODUCTION_QTY_RANGES/POST_PROCESSING_OPTIONS).
  - Job detail: "Job specifications" card (JobSpecs namespace) for client-source jobs only (internal
    jobs never set these; pre-migration rows render via defensive defaults). Below the files list:
    dismissible fastener-bundle teaser (components/jobs/fastener-banner.tsx, localStorage key
    gestaltung:fastener-banner:<job_id>) linking to /parts.
  - NEW PAGE app/[locale]/parts/page.tsx: parts-store "coming soon" + WhatsApp waitlist CTA with
    pre-filled message (falls back to /contact while NEXT_PUBLIC_WHATSAPP_NUMBER is unset — owner chose
    to NOT publish the number for now since wa.me links expose it; revisit before launch). Nav.partsStore
    added after CAD Assistance. New namespaces JobSpecs/PartsStore + Jobs form keys in messages/{en,ar}.json.
  - OWNER RULE: never sign the owner up for paid services/subscriptions (stated 2026-06-10).
- Stage Parts Store (e-commerce module): DONE (code, 2026-06-22) — needs migration 0011 run in Supabase.
  Replaces the /parts "coming soon" teaser with a real storefront. No payment processor — orders are
  confirmed via WhatsApp.
  - supabase/migrations/0011_parts_store.sql (RUN AFTER 0010): parts (public catalog, anon SELECT on
    is_published rows), part_orders (guest checkout — profile_id nullable), part_order_items (snapshot
    sku/name/price; line_total_qar generated column). RLS reuses public.is_super_admin(); reuses shared
    set_updated_at() trigger. KEY: public.create_part_order(...) SECURITY DEFINER RPC is the checkout
    path — a guest can't SELECT their own freshly-inserted order back through RLS, and the RPC snapshots
    prices authoritatively from the catalog (ignores client-sent prices) + computes the total. anon/auth
    both GRANTed EXECUTE. The plain anon INSERT policies exist too but the app uses the RPC.
  - Public: app/[locale]/parts/page.tsx (force-dynamic catalog, 2/3/4-col grid, filter bar
    ?category=&material=&stock= applied in-memory over the published set) + /parts/[sku] detail
    (notFound if unpublished/missing; out_of_stock disables add + shows WhatsApp "notify me").
    components/parts/: part-card, parts-filters, add-to-cart-button, part-detail-cart, stock-badge,
    gear-placeholder (inline SVG fallback when image_url null). Part images use a plain <img> (admin
    pastes arbitrary remote URLs — next/image would need configured domains).
  - Cart: localStorage only (key gestaltung:cart), no DB table. lib/parts/cart.ts (pure transforms),
    components/parts/cart-provider.tsx (context wraps app/[locale]/layout.tsx), cart-icon.tsx (header
    badge, always visible). /parts/cart page (client). Keyed by SKU.
  - Checkout: /parts/checkout (client, calls supabase.rpc('create_part_order')) → on success stashes an
    order snapshot in sessionStorage (key gestaltung:last-order) so the guest-safe
    /parts/checkout/success page can render the summary + WhatsApp confirm link (RLS hides a guest's own
    order, so we can't re-read it). Delivery areas: doha/lusail/al_wakra/industrial_area/other.
  - Admin (super_admin only, guarded in app/[locale]/dashboard/parts/layout.tsx): /dashboard/parts catalog
    manager (table + inline published toggle + delete), new/ + [id]/edit/ (PartForm), server actions
    createPart/updatePart/deletePart/togglePublished in parts/actions.ts. /dashboard/parts/orders list +
    [id] detail; orders/actions.ts updateOrderStatus/toggleWhatsappSent. Nav links partsCatalog/partsOrders
    added to dashboard/layout.tsx for super_admin only.
  - i18n: new namespaces Parts / Checkout / PartsDashboard in messages/{en,ar}.json; DashboardNav gains
    partsCatalog/partsOrders. lib/parts/constants.ts (STOCK_STATUSES, PART_ORDER_STATUSES, DELIVERY_AREAS,
    CART_KEY, LAST_ORDER_KEY) + lib/parts/format.ts (formatPrice QAR, partName/partDescription locale
    fallback). Types Part/PartOrder/PartOrderItem/CartItem/StockStatus added to lib/supabase/types.ts.
    `npm run build` passes.
- STORE-FIRST REBUILD — Stage 1 (store landing from the design handoff): DONE (2026-07-04). Plan lives in
  STAGES_STORE_FIRST.md (5 stages; run one at a time). No migration.
  - Homepage app/[locale]/page.tsx REPLACED by the store landing from "Store-first platform
    design-handoff.zip" (Claude Design bundle; StoreLanding.dc.html is the spec — zip kept untracked, it's
    1.4MB). Sections: design header (logo plate + Store nav + EN·ع toggle + session-aware Sign in/Dashboard +
    Cart→/store/cart), hero "Order parts. Or design your own." + search (submits to /parts) + category chips,
    Featured products (Supabase published parts, newest 8, RLS anon read — page stays force-dynamic and
    degrades to an empty state if Supabase env is missing), Custom-manufacturing strip with ONE Design
    button → /design, WhatsApp footer (env-gated wa.me, /contact fallback).
  - HARD RULE honored: zero inventory link/mention on the landing (design's Inventory nav item dropped;
    homepage also gets its own store-first generateMetadata because the sitewide meta description says
    "inventory platform").
  - Theming: design token system scoped as .store-landing in app/globals.css (--sl-* vars; light base +
    dark via prefers-color-scheme — the rest of the site keeps the light neu theme). Fonts Space Grotesk /
    IBM Plex Sans / IBM Plex Mono loaded via next/font IN THE PAGE, exposed through .sl-heading/.sl-sans/
    .sl-mono. RTL via logical props (ltr:/rtl: variants where needed).
  - New components/store-landing/: landing-header.tsx (client: cart badge via useCart, locale toggle,
    auth-aware link, mobile menu), category-chips.tsx, featured-add-button.tsx (addItem(part, min_order_qty)
    + Added flash). components/homepage-chrome-gate.tsx hides the OLD global Header/Footer on "/" only
    (next-intl usePathname strips the locale) — landing ships its own chrome until Stage 5 rebuilds the
    global header. public/store-logo.png = design logo downscaled 1024→224px (10 KB; keep /public lean).
  - i18n: new StoreLanding namespace in messages/{en,ar}.json (incl. metaTitle/metaDescription).
  - KNOWN 404s BY DESIGN until later stages: /design (Stage 3) and /store/cart (Stage 2) — the stage plan
    wires these targets now on purpose. "View all" + search point at /parts and get swept to /store by
    Stage 2's href update.
  - NOTE: .env.local on this machine has NO Supabase vars (only GA + Vercel OIDC), so local featured
    products render the empty state; production (Vercel env) loads real parts. `vercel env pull` was
    blocked by the permission classifier — pull manually if local product data is wanted.
- STORE-FIRST REBUILD — Stage 2 + owner requests (2026-07-04): DONE (code, deployed). No migration.
  - Stage 2 route rename: app/[locale]/parts → app/[locale]/store (catalog, [sku], cart, checkout,
    checkout/success), all /parts hrefs → /store, and 308 redirects /:locale(en|ar)/parts(+/:path*) →
    /store in next.config.mjs. The /dashboard/parts ADMIN did NOT move (that's Stage 5). components/parts/*
    and lib/parts/* keep their module paths (internal, not URLs). Namespace rename PartsStore→Store was
    SKIPPED on purpose: the real catalog strings live under "Parts"/"Checkout", "PartsStore" is only the
    fastener-banner teaser, and "no behaviour change" outweighed cosmetic churn before a deploy.
  - LOGO is now code-based: components/logo-mark.tsx (inline SVG "G", light metallic gradient) in a dark
    #0a0e15 chip in the landing header + footer. Deleted public/store-logo.png (the owner prefers the
    code logo; keeps /public lean). GMark/LogoMark already existed.
  - THEME: light is the default; header ThemeToggle (components/store-landing/theme-toggle.tsx) flips a
    .sl-dark class on the .store-landing root and persists gestaltung:store-theme in localStorage. On
    mobile with no saved choice, a pre-paint inline script in page.tsx follows the device theme
    (prefers-color-scheme). globals.css: dark tokens moved from @media(prefers-color-scheme) to
    .store-landing.sl-dark. Desktop default stays light regardless of OS.
  - WHATSAPP CALLBACK (owner: collect the number, tell them we'll contact them, email me): footer button →
    components/store-landing/callback-form.tsx (name + phone). POSTs /api/store-lead (app/api/store-lead/
    route.ts) which (1) inserts into the existing inquiries table [anon RLS insert; message="Store landing
    — requested a callback."] and (2) emails STORE_LEAD_EMAIL (default info@gestaltung360.com) via Resend's
    REST API (fetch, no SDK). Best-effort: returns 200 if EITHER saved or emailed, so a missing key never
    loses a lead. Email is OFF until RESEND_API_KEY is set; leads still save + show in the dashboard
    inquiries (super_admin). Env: RESEND_API_KEY (server-only), optional STORE_LEAD_EMAIL, RESEND_FROM
    (default "Gestaltung Store <onboarding@resend.dev>" — Resend's shared sender, works without domain
    verification on the free tier).
  - CONTACT CASES UNIFIED (2026-07-05, owner: "any contact/contact-us should do the email thing, each case
    separately"): /api/store-lead is now the single lead endpoint for ALL contact touchpoints, keyed by a
    `source` (SOURCES map → per-case email subject): `contact_form` ("New contact message — <name>") and
    `store_callback` ("New store callback request — <name>"). The /contact form (components/contact-form.tsx)
    now POSTs to this API (was a direct browser Supabase insert) so it emails too — sends name/phone/email/
    message. Other "Contact us" spots (design/drawing CAD CTA fallback, /store empty state, footer, marketing
    pages) are just links to /contact, so they inherit the email flow. Both cases verified live
    (saved+emailed true). To add a case: add to SOURCES + post its `source` from the form.
  - STORE FILLING via GOOGLE SHEET (owner chose the free Sheet path; STORE ≠ inventory): new super_admin
    page app/[locale]/dashboard/parts/import/page.tsx (guarded by the existing dashboard/parts layout) +
    "Import from sheet" button on the catalog. lib/parts/sheet-import.ts = pure CSV parser + validation
    (header aliases, required sku/name/category/unit_price, is_published defaults TRUE, stock defaults
    in_stock). Server action importPartsFromSheet(locale, csvUrl) in dashboard/parts/actions.ts: super_admin
    only, https+Google-host-restricted fetch (SSRF guard) with 12s timeout + 2MB cap, then upserts rows
    into the `parts` STORE table by SKU (onConflict:'sku' — re-import = sheet is source of truth). This is
    the STORE catalog (parts), entirely separate from the production inventory_items. Optional env
    STORE_SHEET_CSV_URL pre-fills the URL box. i18n: import_* keys in PartsDashboard (en+ar).
    OWNER TODO to go live: publish the Google Sheet to web as CSV (File→Share→Publish to web→CSV) and paste
    the link on /dashboard/parts/import; columns: sku*, name*, category*, unit_price*, name_ar, description,
    description_ar, material, standard, min_order_qty, stock_status, image_url, is_published.
  - DONE 2026-07-05: Resend configured + verified end-to-end. RESEND_API_KEY (all scopes) + RESEND_FROM
    "Gestaltung <noreply@contact.gestaltung360.com>" (sending domain contact.gestaltung360.com verified in
    Resend) + STORE_SHEET_CSV_URL (the owner's published sheet) set in Vercel. A test POST to
    /api/store-lead returned {ok,saved,emailed all true} — lead saved to inquiries AND email delivered to
    info@gestaltung360.com. (One "TEST LEAD (please ignore)" inquiry row + one test email exist to delete.)
  - The owner's product Google Sheet parses cleanly (5 rows: GR-001..004 published, GR-005 out-of-stock
    draft; all with Arabic names + image links). Header normalizer was hardened to tolerate the "*" markers
    and stray punctuation the owner's headers contained. Import URL is pre-filled from STORE_SHEET_CSV_URL;
    the owner clicks "Import from sheet" on /dashboard/parts/import to populate the live store (that action
    is super_admin-gated, so it can't be run headlessly).
- STORE-FIRST REBUILD — Stage 3 (/design custom-manufacturing hub): DONE (deployed + verified 2026-07-05).
  No migration.
  - NEW app/[locale]/design/page.tsx = public hub (the store landing's Design button already points here):
    two cards — "Upload a file to manufacture" → /design/upload, "Hire us to draw your CAD" →
    /design/drawing. New DesignHub namespace (en+ar, incl. meta). neu theme (marketing style, not the
    store-landing tokens).
  - MOVES (git-rename, history preserved): cad-assistance → design/drawing (public marketing page,
    unchanged, still CadAssistance namespace). Job flow OUT of the dashboard: dashboard/jobs → design/jobs
    (list, [id], [id]/edit, new-internal, actions.ts) and dashboard/jobs/new → design/upload. Every href +
    the job components' `@/app/[locale]/dashboard/jobs/actions` imports + all revalidatePath('/…/dashboard/
    jobs') strings rewritten to /design/jobs (design/jobs/page.tsx's "new job" buttons point to
    /design/upload, "new internal" to /design/jobs/new-internal).
  - AUTH: the jobs pages self-gate, but they relied on dashboard/layout for the auth gate + page container.
    Restored via NEW app/[locale]/design/jobs/layout.tsx + design/upload/layout.tsx (getSessionContext →
    redirect anon to sign-in; wrap children in `container py-10`). /design + /design/drawing stay PUBLIC (no
    design-level layout). Verified on prod: /design/jobs + /design/upload 307→/sign-in when anon.
  - Header "CAD Assistance" nav link now → /design/drawing.
  - 308 redirects (next.config.mjs, both locales, verified live): /cad-assistance → /design/drawing;
    /dashboard/jobs/new → /design/upload (ordered BEFORE the general rule); /dashboard/jobs → /design/jobs;
    /dashboard/jobs/:path* → /design/jobs/:path*.
  - NOTE: jobs are no longer under the dashboard sub-nav (Overview | Inventory | …). The dashboard's "Jobs"
    nav link now points to /design/jobs (leaves the dashboard chrome). Stage 5 rebuilds the header/nav.
  - DESIGN LANGUAGE FIX (2026-07-05, owner feedback "the old design is way better, match how-it-works"):
    the /design hub was rebuilt in the marketing neu language — pill kicker, neu bento hero with the
    blueprint panel (GMark + bg-blueprint-grid + concentric circles + spec readouts), two prominent
    neu-hover path cards, ink CTA band. Reuses Home spec/CTA + Hero("formats"); DesignHub gained
    panelTag/pathsTag/ctaTag/ctaHeading/ctaButton. RULE GOING FORWARD: ALL pages use the light neu
    "precision" design system (how-it-works is the reference). The store-first --sl-* / Space-Grotesk /
    dark-toggle handoff visual is RETIRED.
  - HOMEPAGE REBUILT IN NEU (2026-07-05, owner: "design is not updated" — the store landing was the only
    page still on the store-first look): app/[locale]/page.tsx is now light-neu and uses the GLOBAL Header +
    Footer (removed the homepage-only chrome gate in [locale]/layout.tsx). Keeps the store-first CONTENT +
    behaviour — neu bento hero with a search box (→/store), category quick-links, a custom-manufacturing
    panel (GMark + blueprint grid) with the ONE Design button → /design, a neu PartCard featured grid
    (Supabase published parts), and the callback lead form (HomeCallback in components/store-landing/
    callback-form.tsx, still POSTs /api/store-lead). Light-only (dark toggle dropped). DELETED now-unused
    components/store-landing/{landing-header,theme-toggle,category-chips,featured-add-button}.tsx +
    components/homepage-chrome-gate.tsx. The .store-landing/.sl-* block in globals.css is now DEAD CSS
    (nothing uses it) — safe to prune later. StoreLanding namespace strings are still used by the neu
    homepage. Verified live on gestaltung360.com + gestaltung.vercel.app (neu, global header, 1 Design
    button, featured products load, no sl-dark).
- STORE-FIRST REBUILD — Stage 4 (inventory as a standalone signed-in area + project planning): DONE
  (deployed + verified 2026-07-05). No migration.
  - MOVED app/[locale]/dashboard/inventory → app/[locale]/inventory (list, new, [id]/edit, actions.ts);
    rewrote every href/import (`@/app/[locale]/dashboard/inventory/actions` → …/inventory/actions) +
    revalidatePath/redirect strings (incl. design/jobs/actions.ts startJob's inventory revalidate). NEW
    app/[locale]/inventory/layout.tsx = single auth gate (redirect anon) + `container py-10` + Items|Projects
    sub-nav (components/inventory/inventory-nav.tsx) + Dashboard back-link + SignOut. RLS still scopes rows
    to the caller's tenant. dashboard/layout.tsx "Inventory" menu link now → /inventory (still hidden from
    clients). Reached only from the dashboard/account menu; NEVER from the store landing.
  - NEW /inventory/projects = project-planning board (components/inventory/project-planner.tsx, client).
    Group inventory items into projects with a bill of materials; per-row current stock with green (ok) /
    red (short) flags; project-level short badge; Planned→In progress→Done kanban via ◄ ► move buttons.
    KEY DECISION (honoring "NO new DB migration"): stock is read LIVE via RLS from inventory_items (passed
    from app/[locale]/inventory/projects/page.tsx), but the PROJECTS THEMSELVES are stored in the browser
    (localStorage key gestaltung:inventory-projects) — a per-browser planning aid, not shared/persistent.
    If shared or multi-device projects are wanted later, that needs a projects table (would STOP + ask, per
    the stage rule). i18n: Inventory namespace extended with projects/kanban strings (en+ar).
  - 308 redirects (verified live, both locales): /dashboard/inventory(+/:path*) → /inventory(+/:path*).
  - Hard rule verified: store landing has NO inventory link and its meta description is clean. (The word
    "inventory" still appears in every page's HTML because NextIntlClientProvider serializes ALL message
    namespaces for client hydration — that's an invisible bundle, not a landing mention/link.)

- STORE-FIRST REBUILD — Stage 5 (admin store rename + header/footer rebuild): DONE (deployed + verified
  2026-07-05). No migration. **Store-first rebuild (Stages 1–5) COMPLETE.**
  - MOVED app/[locale]/dashboard/parts → app/[locale]/dashboard/store (catalog, new, [id]/edit, import,
    orders, actions.ts); super-admin guard (dashboard/store/layout.tsx) kept; rewrote every href / import
    (`@/app/[locale]/dashboard/parts/*` → …/dashboard/store/*) / revalidatePath / redirect. 308 redirects
    /dashboard/parts(+/:path*) → /dashboard/store(+/:path*). DashboardNav labels: partsCatalog→"Store",
    partsOrders→"Store orders" (en+ar; ar partsOrders="طلبات المتجر" to not clash with jobs="الطلبات").
  - HEADER DECISION = (b): Inventory is NOT in the public header. Rationale: the homepage now uses the
    GLOBAL header, so an Inventory link there would put inventory on the store landing (hard-rule
    violation). Inventory is reached only from the dashboard/account menu (dashboard/layout nav → /inventory,
    non-clients).
  - HEADER rebuilt store-first (components/header.tsx): primary nav = Store (/store) + Design (/design)
    only. Removed How-it-works / CAD / About / Contact and the "Upload a file" button. Kept Cart + EN·ع
    (LanguageSwitcher) + session-aware Sign in/Dashboard (HeaderAuthLink). New Nav.store/Nav.design (en+ar).
  - FOOTER rebuilt (components/footer.tsx): gains a secondary nav — Store, Design, How it works, About,
    Contact — so those pages aren't orphaned. Inventory intentionally absent here too.
  - Verified live (vercel + gestaltung360.com): header block has only Store+Design (no how-it-works/about/
    contact/inventory); footer has the marketing links; /dashboard/parts* → 308 → /dashboard/store*;
    /dashboard/store anon → 307 sign-in.
  - FINAL ACCEPTANCE (store-first plan) — all green: homepage=store landing (neu, EN+AR, light-only per
    owner); featured products from Supabase + add-to-cart badge; exactly ONE Design button → /design; zero
    inventory link/mention on the landing; /store + [sku] + cart + checkout work, old /parts 308-redirect;
    /design hub (upload + drawing), signed-in upload creates a job; /inventory signed-in only from the
    account menu + project-planning board; all legacy URLs 308-redirect; `npm run build` passes; Vercel
    green on /en + /ar. (RLS per-role isolation unchanged — no migrations in the whole rebuild.)
  - LEFTOVER (non-blocking): dead .store-landing/.sl-* CSS block in globals.css (nothing uses it) — prune
    anytime. next-intl ships ALL message namespaces to every page's hydration bundle (so words like
    "inventory" appear in HTML source everywhere) — an invisible bundle, not a UI mention; per-route
    message scoping is a possible future optimization.

- SIGNED-IN CHROME (2026-07-05, owner: "on /inventory or when logged in, remove the top header, keep the
  footer"): the public marketing <Header> is now HIDDEN on the authenticated app areas — /dashboard/*,
  /inventory/*, /design/jobs/*, /design/upload/* — via components/header-gate.tsx (client; next-intl
  usePathname, locale-stripped) wrapping <Header> in app/[locale]/layout.tsx. The <Footer> always renders.
  Dashboard + Inventory already have their own top bars; the job-flow layouts (design/jobs, design/upload)
  got components/account-bar.tsx (Dashboard link + SignOut) so they keep a nav/escape hatch. Public pages
  (home, /store, /design, /design/drawing, marketing, sign-in) keep the header. To add/remove an area from
  header-hiding, edit APP_PREFIXES in components/header-gate.tsx.

- WEBSITE FIXES + PUBLIC QUOTE FLOW (2026-07-14, owner requests): DONE (code) — needs migration 0012 run in Supabase.
  1. STORE IMAGES were broken: the owner's Google Sheet `image` column held the literal text "[link removed]"
     (not URLs), so every card requested /<locale>/[link removed] → 404. Fixes: (a) new lib/parts/format.ts
     partImageUrl() only renders real http(s) URLs (else the GearPlaceholder shows) and rewrites Google Drive
     share links (/file/d/<id>/view or ?id=) to drive.google.com/uc?export=view&id=<id>; used in
     components/parts/part-card.tsx + app/[locale]/store/[sku]/page.tsx. (b) lib/parts/sheet-import.ts
     cleanImageUrl() drops non-http image values to null on import, so re-importing scrubs the junk.
     OWNER ACTION: put real direct image URLs in the sheet's image column (or leave blank) and re-import.
  2. MIN ORDER = 1 now shows "No minimum" (Parts.noMinimum, en "No minimum" / ar "بدون حد أدنى") on the
     part card + [sku] detail instead of hiding the line; 2+ still shows "Min. order: N".
  3. HOMEPAGE custom-manufacturing box is now a drag-and-drop CAD dropzone (components/design/design-dropzone.tsx,
     replaces the static blueprint+Design-button panel in app/[locale]/page.tsx; keeps the FIG·01 blueprint look).
     Drop/browse a file → carried via lib/design/pending-upload.ts (module-level File, survives client nav) →
     NEW PUBLIC page app/[locale]/design/quote (components/design/quote-request.tsx): email OR phone +
     manufacturing method (3d_printing/cnc/laser/edm/not_sure) + optional notes. No sign-in (separate from the
     authed job flow at /design/upload). The file uploads DIRECT from the browser to Supabase Storage bucket
     `quote-uploads` (up to 50 MB, bypassing Vercel's ~4.5 MB body limit); metadata POSTs as JSON to
     NEW app/api/design-quote/route.ts, which saves an inquiries row AND emails STORE_LEAD_EMAIL via Resend
     with a 7-day signed download link minted by lib/supabase/service.ts (service-role client). Best-effort like
     /api/store-lead. If the storage upload fails, the lead still sends and the success screen asks the visitor
     to share the file via WhatsApp/email. New DesignQuote namespace + StoreLanding drop* keys (en+ar).
  4. "Hire us to draw your CAD" → "Need help with drawing?" (DesignHub.drawingTitle en+ar); removed the other
     "hire us" phrasings from StoreLanding.customText + DesignHub.metaDescription (en+ar).
  - MIGRATION 0012_quote_uploads.sql (RUN AFTER 0001): creates the PRIVATE `quote-uploads` storage bucket
     (50 MB limit) + storage.objects policies (anon INSERT for public quote uploads; super_admin SELECT/DELETE).
     No new tables — leads land in `inquiries`, the file link is emailed. Uses SUPABASE_SERVICE_ROLE_KEY
     (already set in Vercel) for the signed URL.
  - NOTE: `npm run build` NOT run by Claude this session (the Cowork Linux sandbox's view of the repo lagged
     behind the edits, so build/git from there was unsafe). All edits verified on disk via the editor; owner
     to build + push from Windows.

- PROTOTYPING (2026-09-21): DONE (code) — needs migration 0020 run in Supabase.
  - Owner decisions: named "Prototyping" (sits BESIDE the project workspace, does not replace it);
    ZERO COST — no paid AI/LLM, a deterministic rules engine instead; 2D schematics only, 3D CAD stays
    the human service at /design/drawing. Layout from the design spike
    (public/prototypes/gestaltung-project-creation-hub-prototype.html), decluttered: each stage shows only
    its own content.
  - Route: app/[locale]/projects/[id]/prototyping (client workspace, browser Supabase client + RLS, guest-safe
    like /projects/[id]). Entry card "Open prototyping" added to components/projects/project-workspace.tsx.
  - lib/prototyping/constants.ts: PROCESSES (adds pcb_manufacturing), MATERIALS (PROJECT_MATERIALS + fr4),
    PROCESS_MATERIALS compatibility map, lead days, STAGES/stage statuses. lib/prototyping/engine.ts: PURE
    keyword rules → claims, part breakdown, suggestSpec, recommend (routes/critical path/warnings), readiness.
    Returns message KEYS, never prose (bilingual). lib/prototyping/schematic.ts: deterministic 2D SVG templates
    (outline/flat_pattern/bracket/block_diagram) + refine-prompt parsing; a flat pattern for a non-sheet material
    is recorded as a FAILED revision with the reason.
  - components/prototyping/: workspace (3 collapsible panels, stage rail, readiness), idea-stage (brief +
    confirm/correct claims), parts-stage (per-part material/process, edit-vs-suggestion tracking, add-part dialog
    with opt-in suggestion), recommendation, schematics-stage (revisions never overwritten; superseded/failed kept;
    view old + restore; SVG download; print→PDF), ui. Concepts + Engineering stages are honest cards pointing to
    the human design/drawing service.
  - MIGRATION 0020_prototyping.sql (RUN AFTER 0019): projects.brief/stage/stages; project_claims, project_parts,
    project_schematics, project_schematic_revisions; RLS via owns_project() + new owns_schematic().
  - i18n: new Prototyping namespace (en+ar, full parity) + Projects.material_fr4 / Projects.prototyping.
  - REWORK Task 1 (2026-09-21): lib/prototyping/readiness.ts is the SINGLE SOURCE for the header %,
    sidebar counters, footer open-items count and every stage status (projectReadiness → named
    requirements, percent = satisfied ÷ total; stageStatuses derives status from contents + prerequisite,
    never stored). projects.stages now only holds the route-accepted decision (manufacturing:"complete").
    Brief editor = components/prototyping/brief-editor.tsx (auto-grow, 12-row min, word count, save on
    blur). The "confirm the summary" claim is removed (legacy rows deleted on load); a brief that looks
    like SQL is cleared on load with a notice.
  - REWORK Task 2 (2026-09-21): the 8-stage rail is GONE. Left column = discipline tree (lib/prototyping/
    tree.ts + components/prototyping/tree-nav.tsx): Brief · Mechanical(Parts/Drawings/Material & process) ·
    Electronics(Board/Power/Components) · Software(Scope) · Quote. Branch active = manual choice ?? (detected
    || has parts). A part's branch comes from its process (pcb_manufacturing → electronics, else mechanical).
    Open counts = readiness requirements mapped onto nodes (nodeStates); no padlocks — a blocked node shows
    its reason and clicking jumps to the fix. projects.stage now stores the selected node id (legacy stage
    ids mapped by toNode). Interim detection = rules (engine.detectDisciplines/powerSource) until Task 5.
    MIGRATION 0021_prototyping_disciplines.sql (RUN AFTER 0020): projects.disciplines jsonb {detected,
    manual}. Until it runs, branches still show (read from the brief) but add/remove can't save.
    (0021 confirmed RUN by the owner 2026-09-21.)
  - REWORK Tasks 3–5 (2026-09-21). "No invented numbers" rule applied everywhere: confidence bars, lead
    days and critical path are GONE (PROCESS_LEAD_DAYS deleted; schematics store confidence null).
    * Brief node = brief editor + "What we understood" spec SHEET (components/prototyping/spec-sheet.tsx;
      table fact/value/source brief|assumed|you; inline edit; ONE confirm for the block) + "Needs your
      input" real controls (quantity number, power mains/battery/solar, mounting fixed/portable,
      environment indoor/outdoor/both, + provider questions; "Not decided yet" is a recorded answer).
      Data = projects.spec jsonb (lib/prototyping/spec.ts). mergeAnalysis(): edited rows ALWAYS win,
      analysis value kept beside them → "Kept your answer" marker; confirmation drops only if the reading
      changed. project_claims is RETIRED (not dropped, not read).
    * Standard facts + withStandardGaps(): lib/prototyping/analysis.ts (contract, no zod) — every provider's
      output is normalised so the 4 standard facts end up as a valid fact or a question.
    * Parts: project_parts.source catalog|to_design (+kind, sku, unit_price, stock_status, stock_qty,
      catalog_part_id, inventory_item_id). New top-level tree node "Parts" = the one table
      (components/prototyping/parts-list.tsx, Source + Status cols, filter). "Add existing part" picks from
      Store `parts` / `client_inventory_items` (part-dialogs.tsx); "Create new part" asks kind first.
      Branch leaves (Mechanical › Parts, Electronics › Board, Software › Scope) show ONLY to_design rows of
      that kind via parts-stage.tsx — same rows, never copies. partNeeds() (lib/prototyping/parts.ts) is
      the single "what's missing" for the Status column AND readiness. No lead time anywhere (no source has one).
    * Analysis: POST /api/analyse (app/api/analyse/route.ts), NDJSON stream of real steps (reading →
      disciplines → requirements; client marks gaps after merge; min 400 ms). Requires a Supabase session
      (guest ok). Provider adapter lib/prototyping/providers/: one file per provider, loaded by name from
      ANALYSIS_PROVIDER (default gemini) — adding one = new file only. gemini.ts: generateContent +
      responseSchema, model gemini-3.5-flash-lite (stable, free tier; checked 2026-09-21; GEMINI_MODEL
      overrides). Every response is zod-validated (analysis-schema.ts, strips unknown keys e.g. confidence).
      Missing key / 429 / malformed / bad schema / network → basic reader (providers/rules.ts over
      engine.ts) and the UI says so ("usedBasicReader"). Token counts logged per call: "[analyse] ...
      tokens: in= out= total=". Material/process + route stay deterministic (engine.suggestSpec/recommend).
    * Right panel = next actions (top open requirements, click → node + focus the input) + one line naming
      where the brief goes (page.tsx passes providerStatus().destination; no key ever reaches the client).
    MIGRATION 0022_prototyping_spec_and_sources.sql (RUN AFTER 0021): projects.spec + project_parts
    source/kind/catalog columns. Until it runs, analysis and adding parts show a "couldn't save" error.
    ENV (server-only, Vercel + .env.local): GEMINI_API_KEY (free key from Google AI Studio), optional
    ANALYSIS_PROVIDER (gemini|rules), optional GEMINI_MODEL.
  - REWORK gap-fix + Task 6 (2026-09-22). Keys set in .env.local AND Vercel (all 3 envs, via the
    vercel CLI — the Vercel MCP connector has no access to this team): ANALYSIS_PROVIDER=gemini,
    GEMINI_API_KEY, GROQ_API_KEY. 0022 confirmed working (a live Gemini analysis saved spec + parts).
    * Tree now matches the brief: each branch opens with a Concepts leaf (mechanical/electronics/
      software.concepts) = that kind's to-design parts still status "suggested" (isConcept() in parts.ts);
      "Keep and design" confirms → the row moves to the design leaf; "Drop" deletes it. Same rows, two
      views (PartsStage view="concepts"|"design"). New project-level Production node after Quote (quantity
      + "Start a production job" → /design/upload); its reason chains off Quote, then the route. Electronics'
      "Material & process" equivalent is Board (FR-4 · PCB manufacturing), per the brief's tree.
    * Re-analysis only suggests parts for disciplines with NO to-design parts yet (the model renames parts,
      so name-matching re-added dropped concepts / duplicated kept ones).
    * Voice (brief editor only): components/prototyping/dictation.tsx + lib/prototyping/voice.ts.
      Path A = browser SpeechRecognition (live interim text, level meter, stop). Path B = MediaRecorder or an
      uploaded audio file → POST /api/transcribe (app/api/transcribe/route.ts; session-gated like analyse;
      Groq whisper-large-v3, GROQ_WHISPER_MODEL overrides; 4 MB cap for Vercel's body limit; audio in memory
      only; cancel aborts upstream; logs "[transcribe] ..."). Arabic speech language or no browser engine →
      Path B. Mic only requested on press; text appended + editor focused, never auto-analysed.
  - PART 2 (2026-09-22): BOM, circuit, drawings, metering. MIGRATION 0023_bom_netlist_drawings_usage.sql
    (RUN AFTER 0022) — until it runs the BOM/circuit routes answer 409 not_ready, dimension inputs don't
    save, and usage/gaps aren't recorded (features degrade, pages still load).
    * Rule: the model outputs STRUCTURE, never pixels (no image generation anywhere), and proposes a
      FUNCTION, never a product — no SKU/price/brand/stock/lead time from a model (zod strips them).
    * BOM: analysis contract gains bom[{id,function,spec,quantity,kind electronics|mechanical|consumable,
      critical}] (analysis.ts/analysis-schema.ts/gemini.ts; rules reader returns []). Stored in projects.bom
      via mergeBom() (lib/prototyping/bom.ts) — only the client's `choice` is a product ref and it survives
      re-analysis (by id, else by function). Matcher lib/prototyping/bom-match.ts is deterministic (kind gate
      by category/tags, voltage/M-size contradiction check, function words x2 + spec words, keep >= 75 % of
      best, max 3, in stock first then price). POST /api/bom/match reads public.parts + client inventory
      live and upserts each not-stocked line via log_sourcing_gap(). UI components/prototyping/bom-table.tsx:
      tree node "Bill of materials" (all lines, total, Add all to cart) + electronics lines under
      Electronics › Components, mechanical under Mechanical › Parts. "Choose one" lines are readiness
      requirements. parts.tags (text[]) feeds matching; the Google Sheet import accepts a `tags` column.
      Admin /dashboard/store/gaps = sourcing gaps grouped by function.
    * Circuit: POST /api/netlist (Gemini, only with electronics BOM lines) → NetlistSchema (zod) +
      crossValidate() (bomIds, refs, pins) → one retry with the problems → else 422 with them; nothing
      unvalidated is saved. projects.netlist is the single source. sanityChecks() (ours): floating net,
      unpowered component, shorted supplies, rail overcurrent — shown in words with refs. Renderers
      lib/prototyping/wiring-svg.ts (store products per BOM line, placeholder box when no photo, links to
      /store/<sku>) and schematic-svg.ts (symbol library, rails top/GND bottom, net labels). Viewer
      components/prototyping/svg-frame.tsx (zoom, SVG download, print). Test hook NETLIST_TEST_BREAK=1
      (dev only) corrupts a connection to force the retry + fallback.
    * Drawings: project_parts.shape (block|disc|shaft|sheet) + length/width/height/diameter/thickness_mm;
      lib/prototyping/dimension-drawing.ts draws only from real numbers, gaps are labelled boxes linked to
      the input (dim-<partId>-<field>). Laser-cut = flat outline + thickness + "production DXF still
      required". partNeeds adds "dimensions" (doesn't block keeping a concept). Template "Generate" removed;
      old template drawings stay under "Earlier template drawings".
    * Metering: lib/ai/limits.ts (config, env overrides AI_LIMIT_GEMINI_REQUESTS / _TOKENS /
      AI_LIMIT_GROQ_REQUESTS / _AUDIO_SECONDS, AI_GUARD_THRESHOLD default 0.8, AI_RESET_TZ_*) and
      lib/ai/usage.ts (logUsage via log_ai_usage RPC, quota via ai_usage_totals RPC — no service key).
      Gemini day = midnight PACIFIC (Google's docs), Groq = UTC. Defaults: Gemini 500 req/day (third-party
      figure — confirm at aistudio.google.com/rate-limit), no daily token cap; Groq Whisper 2,000 req +
      28,800 audio s/day. At the threshold: analyse → basic reader with fallback "paused"; netlist → 429
      paused; transcribe → paused (live dictation still works). Admin /dashboard/usage: today per provider,
      per feature, 30-day calls chart, per-project totals.
  - PART 3 TASK 11 (2026-09-22): diagnostics. MIGRATION 0024_project_diagnostics.sql (RUN AFTER 0023):
    analysis_runs (raw_text + raw_response beside parsed_response, per attempt; written by /api/analyse and
    /api/netlist) and project_events (event log filled ONLY by triggers on projects / project_parts /
    analysis_runs: brief edits, answers, confirmation, branches, BOM updates + product picks, circuit,
    route, parts added/edited/confirmed/removed, runs). Both readable by owner + super_admin.
    Admin /dashboard/projects (super_admin layout): all projects, owner (email via service key when set),
    created, status (lib/admin/project-export.ts projectStatus), last activity, ?user= filter; per row
    Download JSON + Copy as JSON (components/admin/project-export-buttons.tsx) → GET
    /api/admin/projects/<id>/export (role checked in the route; buildProjectExport reuses the page's own
    readiness/matcher/checks/drawings; redactKeys strips only API keys; `_notes` says what couldn't be
    read). BOM matching shared via lib/prototyping/bom-server.ts. Dev-only hook EXPORT_DEV_OWNER=1 lets a
    project owner export locally (never in production).
    FIRST REAL EXPORT FINDINGS: the analysis writes BOM `function` as a verb phrase ("Stores energy
    collected from the solar panel") and the text matcher accepts one generic shared word, so it matched
    a Tempered Glass Panel (QAR 425) as a battery and diodes as fasteners; the store sheet has duplicate
    products (GR-024/034/044, GR-028/038); rules suggestSpec gave stainless_304 + laser cutting to an
    "Aluminium enclosure". FIXED in Part 3 (below).
  - PART 3 TASKS 12–15 + matcher quick fix (2026-09-22). MIGRATION 0025_electronics_attributes_kits.sql
    (RUN ✔ 2026-09-22): projects.build_route, parts.attributes + pack_size, client_inventory_items.attributes,
    store_settings (kit_discount_pct), project_kits, cart_items.kit_id/bom_lines (new unique index incl. kit),
    part_orders.discount_qar, part_order_items.project_id/kit_id/bom_lines, create_part_order v2 (kit discount
    priced on the server; for the caller's own project: project_items += bought qty and BOM lines get
    `fulfilled`), event trigger adds build_route_chosen / bom_line_fulfilled / bom_lines_dismissed, feature
    'electronics' allowed in analysis_runs + ai_usage.
    * Matcher (lib/prototyping/bom-match.ts): attributes first (lib/store/attributes.ts = the ONE class/field
      definition, compare eq/min/max/includes/within, `why` per candidate). Class mismatch or contradiction
      excludes; unknown fields = weak. Untyped products fall back to text needing ≥ 2/3 of the item-name words
      (generic verbs ignored), no volt/M-size/ohm/farad contradiction, ALWAYS weak. Only a single distinct
      STRONG match auto-resolves ("matched"); weak → "choose". Duplicate listings (same name+price+pack)
      collapse. Analysis prompt: BOM `function` = 1–4-word noun; analysis BOM = mechanical hardware +
      consumables only. engine.suggestSpec: a material named in the text wins.
    * Build route (Task 12): components/prototyping/electronics-route.tsx BuildRouteCard in Electronics ›
      Components; Prototype preselected, must be confirmed; spec.routeRecommendation shown as advice.
      Analysis never suggests an electronics part to design; choosing Custom PCB adds a to-design "Custom PCB"
      part. Readiness requirements electronics_route / electronics_list; Board needs a part only on custom_pcb.
    * Electronics builder (Task 13): POST /api/bom/electronics → lib/prototyping/electronics-build.ts:
      listElectronics (model, typed attributes, no passives/consumables) → generateNetlist (validated, one
      retry; lib/prototyping/ai-call.ts validatedCall meters + records raw/parsed) → deriveElectronics
      (lib/prototyping/electronics-rules.ts, OURS: LED resistor per LED from E12 at 10 mA, I2C + button
      pull-ups, 100 nF per bare-IC supply pin, flyback diode per inductive load, level shifter for 5 V→3.3 V
      nets + worded warning for 3.3 V→5 V, consumables, fabrication line on custom_pcb; merged lines, stable
      ids, reason text). POST /api/netlist now redraws + re-derives (no relist). Lines carry origin
      (analysis|electronics|rule), group, class, attributes, reason, fulfilled; bom.dismissed = removed ids.
    * BOM UI (components/prototyping/bom-table.tsx): groups boards/sensors/discrete/consumables/hardware/
      fabrication, collapsible with subtotals; weak labels + why; "needs 4, packs of 10"; remove/restore;
      bought lines; CostSummary = three separate figures (available now QAR / not stocked count / fabrication
      count) in the BOM and the right panel. (Superseded by site audit Phase 4: one QAR figure "To buy now" +
      a separate counts line.)
    * Attributes admin (Task 14): /dashboard/store/attributes (completeness per store category, per-row edit,
      bulk class/field/pack size, kit discount %). Sheet import accepts tags + pack_size columns. NOTE: the live
      catalogue has 119 products, NONE attributed yet, many duplicated (e.g. 21 motor listings of 3 products)
      → until attributes are filled every store match is weak/"choose".
    * VERIFIED END TO END 2026-09-23 on a test project (brief → analyse → Prototype route → build →
      pick products → Buy as project kit → checkout → Bought): 4 LEDs gave 4x120 Ω resistors at the ESP32's
      3.3 V, I2C + button pull-ups, flyback diode, consumables; kit = one cart entry; after checkout 7 lines
      show "Bought", units land on the project and a REBUILD does not re-add them. EN + AR, no overflow at
      1280 or 375 px. Gemini was flapping 503 all day: callGemini now retries and falls through to
      GEMINI_FALLBACK_MODEL (default gemini-3.5-flash), structured calls get 90 s, routes 120-300 s.
    * Kits (Task 15): cart-provider rows (rowId, kitId, bomLines, projectName, kit discount); cart page shows a
      kit as one entry with parts underneath; checkout sends project_id/bom_lines/kit_id.
  - PART 4 (store/inventory, zero-stock catalog) — TASK 16 DONE (code, 2026-09-24). MIGRATION
    0028_suppliers_and_offers.sql (NOT RUN YET): suppliers (seeded voltaat[mirror, 10% commission, QAR],
    mouser/digikey[15% overhead], alibaba[25%], aliexpress[10%]), supplier_offers (many per part: sku, url,
    cost, retail_price, currency, pack_size, moq, availability, lead_time_days, last_checked_at, active),
    parts.pricing_mode/pinned_offer_id + DERIVED preferred_offer_id, landed_cost_qar, expected_income_qar,
    income_pct, below_floor, lead_time_class — all maintained IN THE DB by refresh_part_sourcing() via triggers
    on offers / suppliers / parts(pricing_mode, pinned_offer_id, unit_price, pack_size). Rule: in stock first,
    shortest lead, lowest landed cost; pinned active offer wins. mirror → unit_price := offer retail × fx and
    income = price × commission; markup → income = price − landed. store_settings margin_floor_pct (15) +
    fx_to_qar. Lead class: ≤2d in_stock, ≤5 3_5_days, ≤14 1_2_weeks, else 2_4_weeks; no offer → null
    ("available on request"). Sourced data may only write lib/store/sourcing.ts SOURCED_OFFER_FIELDS.
    UI: SourcingPanel on /dashboard/store/[id]/edit, /dashboard/store/suppliers (suppliers + floor + FX,
    save → refresh_all_part_sourcing), catalog list shows lead time + income % (red ⚠ below floor).
  - PART 4 TASKS 17 + 18 DONE (code, 2026-09-24). MIGRATION 0029_intake_demand_delivery.sql (NOT RUN YET):
    parts.images jsonb + public `product-images` bucket (super_admin writes); demand_signals (view | add_to_cart |
    request | zero_search | bom_unmatched; served_at for Task 20; writes ONLY via record_demand() [anon ok] and
    record_bom_demand() [project owner]); store_settings.shipping (tiers express/standard/economy = carrier cost +
    transit days, handling fee + days, buffer 3); part_orders shipping_tier/split_shipments/shipping_qar/
    handling_fee_qar/promised_date/early_promised_date/held_by/confirmation_emailed_at/delay_notified_at;
    part_order_items.lead_time_class/promised_date; lead_class_days(); order_delivery_quote(items) (the ONE date
    computation — cart/checkout/product page all call it); create_part_order v3 (+p_shipping_tier, p_split; old
    6-arg version DROPPED; rejects on-request items; total_qar now includes shipping + handling).
    * Task 17: /dashboard/store/quick (components/admin/quick-entry.tsx) single (Enter saves, sticky category/
      class/supplier/lead/publish, Alt+I opens picker) + bulk (row per image, filename → name, Ctrl+Enter).
      lib/google/drive-picker.ts (GIS token, drive.file scope, Picker) → POST /api/admin/drive-import (sharp:
      1600px + 400px WebP → product-images, returns drive_file_id). quick/actions.ts saveQuickProducts creates
      part + one supplier offer; lib/store/similar.ts warns on similar names in the same category (numbers must
      match). Env: NEXT_PUBLIC_GOOGLE_CLIENT_ID / _API_KEY / _APP_ID. cleanAttributes moved to lib/store/attributes.ts.
    * Task 18: LeadTimeBadge replaces StockBadge on the storefront + BOM table (stock_status no longer shown
      publicly); filter ?stock= now takes lead classes | on_request. No offer → "Available on request": no add to
      cart, cart blocks checkout. RequestItemButton on every product (+ owner email). DemandBeacon (view,
      zero_search), cart-provider addItem → add_to_cart, /api/bom/match → record_bom_demand. Checkout: tier
      cards (cost + date), split option when lead times differ, handling fee line. /api/orders/confirmation
      (bilingual email, once, fresh orders only, service key). /api/cron/delivery-promises (vercel.json cron
      04:00 UTC; needs CRON_SECRET) emails customers before the promised date when an item's lead class changes,
      moves the promise if later, emails the owner a summary. Shipping settings on /dashboard/store/suppliers.
  - SITE AUDIT FIX — Phase 1 (2026-09-26), "Data truth and cleanup" (SITE_AUDIT.md #6, #7, #10, #15, #17).
    Branch fix/site-audit, NOT MERGED to main. Log: CHANGELOG-audit.md. Migrations 0030/0031/0032 NOT RUN.
    * #7: 0030 merges duplicate products by normalised name+material+pack (lowest SKU survives, references
      repointed, losers soft-deleted via merged_into, unique guard, material casing normalised; dry-run/backup/
      rollback blocks at the top). Sheet import de-duplicates and lists skipped rows. 0031 adds is_test;
      supabase/scripts/test_data_candidates.sql (read-only) + test_data_delete.sql (explicit ids, dry-run by
      default, refuses GESTALTUNG RASHWAN orders); admin gaps/projects/usage hide test rows (?test=1 shows).
      Admin catalog hides merged rows (?merged=1), shows publish/delete errors; old SKUs redirect via
      part_merged_redirect_sku().
    * #6/#15: 0032 lets on-request items (no supplier offer) be ordered at the listed price, "Date to be
      confirmed" on product/cart/checkout/success/email; storefront never reads stock_status; empty categories
      hidden on home + store filter; new store heading/intro; home "In stock and ready to ship" removed.
      Suppliers page shows offer coverage + empty state.
    * #10: consent checkbox before the first AI analysis (text in messages). #17: GearPlaceholder label prop
      (not yet used by callers).
    * Tests: vitest added — `npm run test`.
    * Owner still to do: run 0030 → 0031 → 0032, approve the test-data id list, add supplier offers, upload
      product photos (/dashboard/store/quick).
  - SITE AUDIT FIX — Phase 2 (2026-09-26), "Project ↔ cart ↔ order truth" (SITE_AUDIT.md #3, #4, #8, #9, #18, #19,
    #21, #22, #23, #47). Branch fix/site-audit, NOT MERGED to main. Log: CHANGELOG-audit.md. Migrations
    0033/0034/0035 NOT RUN.
    * #3/#47: cart provider keeps last good lines, shows error + Retry (never a silent empty cart). Project items
      read In cart / Ordered #id · status / Delivered / to buy; admin order detail links each line to its project
      (no customer order page yet). 0034: create_part_order v5 stops doubling a project line's quantity at
      checkout (ESP32 × 2) and repairs doubled lines once (DRY RUN block; header lists lines with cancelled
      orders for the owner to decide by hand).
    * #4: prototyping Parts lists the project's store lines too (one merged list; Catalog filter works).
    * #8/#9: customer project pages + prototyping workspace show only the signed-in user's projects; real
      not-available state otherwise.
    * #18/#19: Delete in a danger zone, runs delete_project() in one transaction (0035); 0033 fixes the 0024
      trigger that broke project delete and copies notes into empty briefs; one brief shared with prototyping.
    * #21/#22/#23: guest line hidden when signed in; cards show date, part count, status; per-project <title>
      and breadcrumb.
    * Owner still to do: run 0033 → 0034 → 0035 (after 0030–0032), re-test checklist items 3–6 on the Plant
      monitor project, decide on lines with cancelled orders.
  - SITE AUDIT FIX — Phase 3 (2026-09-26), "Prototyping correctness" (SITE_AUDIT.md #1, #2, #5, #27, #33, #36,
    #38). Branch fix/site-audit, NOT MERGED to main. Log: CHANGELOG-audit.md. No migrations.
    * #1/#33/#36 (Card 3.1): hardRules() — inductive load on a GPIO, LED without resistor, shorted supplies,
      power budget — insert the driver transistor + base resistor + flyback diode and LED resistors into the
      netlist itself (schematic, wiring, BOM from one model). Readiness adds "Circuit passes our checks" + one
      blocking item per hard flag; footer never says "validated" while flags exist; Power leaf shows a per-rail
      budget (source, loads, total, headroom, over-budget).
    * #2/#27/#38 (Card 3.2): weak matches show "No confident match" + confirm, never pre-selected; matcher debug
      admin-only; pack lines "need N · sold in packs of P · price per pack" + "To buy now" summary; unit prices
      shown when the product is known (bought-group subtotals still QAR 0.00); bought lines carry their product
      so wiring blocks show name + SKU (cause was server-side).
    * #5 (Card 3.3): suggestSpec honours process words in part + brief; honestSources() marks unstated facts
      "Inferred" for every provider, server-side; board footprint table flags an enclosure too small for its
      board (can't be kept); implausible dimensions block "Ready to make"; templates attach only to matching
      part names.
    * Behaviour change: netlists saved before Card 3.1 show as blocking until Electronics › Board → Regenerate.
    * Tests: `npm run test` now 147+ tests (Plant-monitor fixture for rules, netlist, readiness). Copy en + ar
      parity 1630/1630.
    * Owner still to do: after 0030–0035, open Plant monitor → Electronics › Board → Regenerate and re-test
      checklist item 2.
  - SITE AUDIT FIX — Phase 4 (2026-09-26), "Prototyping UX" (SITE_AUDIT.md #24–#32, #34, #35, #37, #39, #40, #58).
    Branch fix/site-audit, NOT MERGED to main. Log: CHANGELOG-audit.md. No migrations. Cards 4.3/4.4 in final
    review (4.3 55f2c7d, 4.4 e18104e).
    * #30/#40/#58/#39 (Card 4.1, fb94ef1): blocked sidebar rows show the reason inline + tooltip; a click goes to
      the fix, scrolls to the control, or opens the node (no dead clicks). Discipline "×" at the row end with
      inline confirm + 6-second Undo. Rows are real buttons with accessible names and arrow-key navigation
      (#58's other half, /projects cards with aria-label = project name, landed in Phase 2, 392ffa2). Button reads "Analyse brief" / "Re-analyse brief"; hints match.
    * #34/#37/#39 (Card 4.2, 787ab03): one "not a cut file" warning per drawing; title, view name, thickness on
      separate baselines (unit-tested); no drawable dimensions → link, not an empty frame; snake_case concept ids
      display as human names; "What it must do" grows 3–16 rows; suggested concepts stay under Concepts until Keep.
    * #25–#29 (Card 4.3): cost panel = one QAR figure ("To buy now") + a counts line; group headers show to-buy
      subtotal + "ordered: QAR Y"; ONE "Request a quote for N unstocked items" → one bom_quote lead (item list +
      project link); one kit button; consumables follow one build route (breadboard | perfboard/hookup wire/
      heat-shrink); USB cable deduped; Components and BOM share one selector.
    * #24/#30/#31/#32/#35/#40 (Card 4.4): side panels collapsed under 1440 px (saved choice wins); site header
      hidden in the workspace, workspace bar carries logo/back/cart/language/sign-in; width up to 1760 px; opens
      on Brief for a new project, else where the user left off (unit-tested); Quote/Production disabled with the
      reason inline when blocked; Material & process leaf shows material + process per part with "Accept this
      route"; blocked node views show a banner + fix link; Continue buttons show their reason; Undo of a branch
      removal restores detected branches.
    * Copy en + ar parity 1683/1683.
    * Owner still to do: after 0030–0035, walk Plant monitor at 1280 px, 1920 px and in /ar — no dead clicks, no
      clipped tables, one cost figure, one quote button, one kit button, Components count = BOM count, drawings
      without overlap.
    * Leftovers: #38 wiring view small at normal width; drawing title-block values clip at ~26+ chars
      (pre-existing); Readiness labels show raw concept ids; project page QAR total ≠ BOM "To buy now" (documented).

  - 2026-09-27: fix/site-audit (Phases 1–4) MERGED to main (fast-forward, 216 tests + build green). Owner ran
    0030–0035 (0030's final report block errored "_m0030_stats does not exist" but the merge had completed: 29
    published products, no duplicate names). Shipping = 50 QAR all tiers, handling fee 0. Google Drive picker
    live (NEXT_PUBLIC_GOOGLE_* in Vercel; OAuth app Internal to gestaltung360.com; Cloud project
    dazzling-card-506200-g5). CRON_SECRET set in Vercel.
  - PART 4 TASK 19a DONE (code, 2026-09-27): supplier price-list CSV import. No migration. lib/sourcing/types.ts
    (SourcedOffer, SupplierAdapter), lib/sourcing/adapters/csv.ts (pure: readCsv, guessMapping [saved mapping
    wins], parseAmount, parseAvailability [quantities read, never stored], toOffers; tests in csv.test.ts).
    /dashboard/store/suppliers/import (components/admin/price-list-import.tsx): supplier + file → column
    mapping → server preview (suppliers/import/actions.ts re-plans from DB: updates with old→new + cost %,
    unchanged, attach via "our SKU", unmatched) → apply. Existing offers get ONLY cost/retail/currency/
    availability/lead time (+ last_checked_at); unmatched rows optionally become UNPUBLISHED draft products
    from the supplier's file. Mapping saved in store_settings key csv_mapping:<supplier code>. The approval
    queue (19f) and daily refresh (19e) are NOT built yet — the preview is the review step for now.

  - PART 4 TASK 19b DONE (code, 2026-09-27): Mouser + DigiKey adapters. Owner says there will be NO CSV files
    (19a importer stays but is unused). Keys (server-only, Vercel all envs + .env.local, --sensitive):
    MOUSER_API_KEY (Search API, 30/min, 1,000/day; app "Gestaltung catalogue sync", host IP 76.76.21.21 =
    Vercel), DIGIKEY_CLIENT_ID/_SECRET (org "Gestaltung Qatar", production app "Gestaltung catalogue sync",
    Product Information V4, 2-legged client_credentials, never expires). lib/sourcing/adapters/mouser.ts +
    digikey.ts → SupplierProduct (lib/sourcing/types.ts): cost at qty 1, availability, lead time (in stock →
    7 days, else Mouser LeadTime / DigiKey ManufacturerLeadWeeks×7), MOQ (DigiKey picks the variation with the
    smallest MOQ = cut tape), parameters. lib/sourcing/spec-map.ts parametersToAttributes (class from category +
    description; resistor/capacitor/diode/transistor/led/switch/header; SI parsing; tests) + fillMissing (never
    overwrites). /dashboard/store/suppliers/lookup (components/admin/supplier-lookup.tsx; actions in
    suppliers/lookup/actions.ts): search both, "Add as new product" (name/description/photo/specs from the API,
    owner sets category + price [suggested landed+40%], draft unless Publish; photo copied via
    lib/store/store-image.ts, hosts limited to mouser.com/digikey.com) or "Link to a product I sell" (offer +
    missing attributes only). Sourcing panel: RefreshCw button on Mouser/DigiKey offers → refreshApiOffer
    (numbers + missing attributes). NOTE: supplier_offers↔parts has 2 FKs — embeds must name
    parts!supplier_offers_part_id_fkey.

  - OWNER DECISIONS 2026-09-28: AliExpress DROPPED completely (never build/ask). No daily Mouser/DigiKey refresh
    (19e) and no price approval queue (19f) — manual refresh button only. Demand tracking = existing
    demand_signals + GA4.
  - PART 4 TASK 19g DONE (code, 2026-09-28): Voltaat price sync. MIGRATION 0036_voltaat_sync.sql (NOT RUN
    YET): supplier_sync_runs (run log + changes jsonb), store_settings.voltaat_sync {enabled}, Voltaat supplier
    forced QAR + mirror. Voltaat = Shopify, QAR, robots.txt allows /products.json (checked 2026-09-28; its
    robots/agents.md also carry agent-directed shopping-skill promos — ignored). lib/sourcing/adapters/
    voltaat.ts: VoltaatClient (UA "GestaltungPriceSync/1.0 (+https://gestaltung360.com; info@...)", 5 s
    between requests, 403/429 → BlockedError, no retry), whole catalogue via /products.json?limit=250
    (~1,290 products = 7 requests ≈ 30 s), pure robotsAllows / handleFromUrl / pickVariant / planChanges
    (tests). lib/sourcing/voltaat-sync.ts runVoltaatSync(service client): switch off → 'disabled'; ok run in
    last 20 h → 'skipped'; robots check; writes ONLY retail_price/currency/availability/lead_time_days(1 if
    in stock)/last_checked_at on mapped offers (Voltaat offers with supplier_url); trigger 0028 moves mirror
    prices at once (no approval queue); logs run; emails owner the change report / alert on block or failure.
    Cron /api/cron/voltaat-sync 03:00 UTC (vercel.json); "Run now" POST /api/admin/voltaat-sync. Admin
    /dashboard/store/suppliers/voltaat: switch, run now, map (our SKU + Voltaat link → reads that one product,
    asks for the option when several, sets part pricing_mode mirror), daily change report, mapped list.

  - 2026-09-28: 0036 RUN ✔ by owner. Owner then asked for the daily Mouser/DigiKey refresh after all (commit 8bc825a):
    lib/sourcing/api-refresh.ts + /api/cron/supplier-refresh (02:00 UTC): one lookup per linked offer/day,
    oldest-checked first, Mouser 2.1 s / DigiKey 0.6 s apart, 250 s budget, stops on rate limit (no retry),
    numbers only, applied directly, runs logged in supplier_sync_runs, owner emailed changes.
  - PART 4 TASK 20 DONE (code, 2026-09-28): restock dashboard. MIGRATION 0037_restock.sql (NOT RUN YET):
    store_settings.restock_weights (request 10, bom_unmatched 8, add_to_cart 5, view 1), suppliers.min_order_value_qar,
    restock_receipts, restock_summary() (open signals per product + zero searches + unmatched BOM labels +
    receipts with carts/sold since), mark_restock_received() (receipt + served_at on open signals, never deleted).
    lib/store/restock.ts (scores, units = requested qty + carts, groupDraft vs minimum, draftCsv; tests).
    /dashboard/store/restock (components/admin/restock-dashboard.tsx): weights editor, ranked table with raw
    counts beside the score, best offer/cost/price/margin/MOQ/lead/est. revenue, draft order grouped by supplier
    with per-supplier minimum (editable inline), CSV export, "Received", searches + BOM lists, "did it sell".
  - REVIEWER FEEDBACK on prototyping (2026-09-28, tracked in the owner's checklist artifact
    WYoFNdQ24cPEsk2XZpespP): Brief first then Concepts under it; BOM + Parts at the very end; fewer Continue
    clicks on Concepts; CR number + company location in header/banner (owner to supply); payments: cards incl.
    foreign + pay in person at the office after a free chat; 10 QAR per generation. Owner: build payment
    CALCULATION now, no gateway, everything free for now. NOT STARTED.

  - 2026-09-28 (later): 0037 RUN ✔. Owner: store must be populated — "mainly Voltaat, and some parts not in Voltaat
    from DigiKey/Mouser", publish now. Voltaat catalogue import (/api/admin/voltaat-import, button on the Voltaat
    sync page; lib/sourcing/voltaat-catalogue.ts pure + tests): one product per Voltaat option, SKU VLT-<variant
    id>, mirror price, category mapped from Voltaat product_type, description from body_html, photo hotlinked from
    Shopify CDN (?width=), out-of-stock options = inactive offer ("available on request"; daily sync now sets
    active = available). RUN LIVE: 1,659 Voltaat products published (1,138 in stock, 521 on request); store =
    1,688 published. DigiKey starter set /api/admin/starter-parts (13 standard parts, packs of 10 where sensible,
    landed×1.4). PostgREST 1,000-row cap handled: lib/supabase/fetch-all.ts; store page filters/searches/pages
    (48) in the DB; unified search queries as you type. Mouser/DigiKey refresh: offers older than 7 days only,
    max 25/supplier/day.
  - CR from owner: C.R. 236988, "Gestaltung for Trading and Services W.L.L" / "جستالتونج للتجارة والخدمات ذ.م.م",
    Qatar (lib/company.ts; NEVER publish the owner's personal ID numbers from the CR). components/company-strip.tsx
    above the header + in the footer.
  - REVIEWER ITEMS DONE: tree order Brief → one "Concepts" node (all disciplines, NodeId "concepts"; legacy
    *.concepts map to it) → branch leaves → Quote → Production → Parts → BOM (last). AI pricing: 1 QAR per
    successful AI call (owner), MIGRATION 0038_ai_pricing.sql (NOT RUN YET): store_settings.ai_pricing
    {per_call_qar, charging:false} + project_ai_charges(project); components/prototyping/payment-card.tsx on the
    Quote step (AI calls × price, parts to buy now, total, "free during launch", card incl. foreign — coming soon,
    pay in person after a free chat → /contact); admin editor on /dashboard/usage.

  - 2026-09-29: 0038 RUN ✔. PAYMENT METHODS (owner): cash on delivery, Fawran (alias CR-236988), bank transfer
    (QIIB, account "GESTALTUNG FOR TRD AND SERV", IBAN QA94 QIIB 0000 0000 1112 2207 6400 1) — lib/company.ts
    PAYMENT_DETAILS/PAYMENT_METHODS. MIGRATION 0039_payment_method.sql (NOT RUN YET): part_orders.payment_method
    + set_order_payment_method(order, method) (SECURITY DEFINER, fills an EMPTY method on an order < 1 h old;
    create_part_order signature untouched). Checkout: method cards + PaymentInstructions
    (components/payment/payment-instructions.tsx, copy buttons); success page shows how to pay with amount +
    order ref; confirmation email paymentBlock() (bilingual; tests); admin order detail shows the method;
    prototyping PaymentCard lists the methods; home page HomeTrust section (company + CR + ways to pay). Card
    still "coming soon".
  - 2026-09-29 STORE CLEANUP (owner): 0039 confirmed live. Voltaat import is now ONE product per Voltaat product
    (first option in stock; other options listed in the description "Options: … tell us in the order notes").
    /api/admin/store-cleanup {step: dedupe|placeholders|translate} (super_admin): merged 146 variant groups
    (370 option products removed), 29 placeholder products (123, GR-…) deleted — 13 tied to old orders/projects
    are unpublished instead; Arabic names for all 1,318 published products via Gemini (run translate again after
    new imports). Starter set now DigiKey + Mouser (+8 DK, +10 MS parts, SKUs DK-/MS-). Arabic category labels:
    lib/store/category-label.ts. Test order #945ea389 ("TEST ORDER — please delete", Fawran, 53.50 QAR) placed.
    Home featured = in-stock products WITH a photo, one per category. Mouser serves a bot page instead of
    product photos, so step "photos" gives MS- products the same part's DigiKey photo (10/10 done).
  - 2026-09-29 PICTURE WIRING DIAGRAM (owner): lib/prototyping/wiring-svg.ts — bigger store photos, one colour per
    net (netColours: ground black, power red, signals from SIGNAL_WIRES), coloured pin dots/labels, cased wires,
    colour key. Parts with no product yet get an EXAMPLE store photo of the same kind (lib/prototyping/
    example-photos.ts, exampleQueries + loadExamplePhotos, labelled "Example photo", not linked/named as the part).
    Never generated. Per-product pin positions on the photo NOT done (no pin-position data yet).
  - 2026-09-29 PAYMENT DETAILS (owner): home page shows method names only (PaymentInstructions `brief`); Fawran
    alias at checkout/success; IBAN never on the site — only in the confirmation email; email required at
    checkout when bank transfer is chosen.
  - 2026-09-29 SITE AUDIT PHASE 5 DONE (on main; log CHANGELOG-audit.md): header nav = Shop parts · Make a part ·
    How it works (+ My projects with a session, account menu Dashboard/Sign out, mobile menu) in
    components/header-nav.tsx; home hero = three choices; /design/quote creates a project with the CAD file
    (cad-files + project_files, falls back to quote-uploads); /projects/new?for=drawing = drawing request project +
    drawing_request lead (store-lead SOURCES); product "Add to project"; How it works = three paths; prototyping
    tree drawer under lg + title row on phones; per-page metadata via lib/meta.ts (Meta namespace); FIG labels +
    spec chips removed. Phase 6 (admin, Arabic, polish) is next.
  - 2026-09-29 (owner): dashboard = grouped sidebar (Today · Customers · Store · Suppliers · Settings + Back to
    the website; components/dashboard/dashboard-nav.tsx) and "Today" overview (components/dashboard/admin-overview.tsx:
    new messages, open orders, product requests, parts we don't sell, active projects, on-request products + latest
    messages/orders). Offer-coverage box reworded (all "without an offer" = Voltaat out of stock). Guests starting a
    project give a WhatsApp number (saved to profiles.phone; banner "Saved under {phone}"); phone-only login on
    other devices would need paid SMS, so cross-device still = add an email. AI usage page: "Which AI does what"
    (main/backup Gemini, Groq Whisper, answers per model from ai_usage.model).
  - 2026-09-29 PROTOTYPING SIMPLIFIED (owner): one colour-coded "What we understood" list
    (components/prototyping/understood-panel.tsx: blue = answer, amber = our guess ✓/change, green = settled, grey =
    optional details with Skip all; only standard facts block readiness); "Help me describe it" chat on the brief
    (components/prototyping/brief-chat.tsx + /api/brief-chat, metered as 'analyse', same consent); read aloud
    (components/prototyping/read-aloud.tsx, browser speechSynthesis). Electronics = 3 steps: Board (Prototype/Custom,
    saves on click) → Power (1 adapter / 2 battery / 3 solar = spec fact power) → Components (Generate component list +
    BOM + circuit; circuit requirements now map to Components). BOM auto-picks the best candidate (LineMatch.auto)
    with other models one click away; candidates rank by lead_time_class. Software › Code: /api/firmware writes a
    starter Arduino/ESP32 sketch from the netlist (lib/prototyping/firmware.ts, components/prototyping/firmware-card.tsx).
    MIGRATION 0040_firmware.sql (NOT RUN YET): projects.firmware + 'firmware' feature; before it runs the code shows
    but isn't saved.
  - 2026-09-29: 0040 RUN ✔ (projects.firmware exists). Header = three paths only (Buy parts · Make my part · Turn an
    idea into a product); My projects / My inventory / Dashboard / Sign out in the account menu; footer = How it works ·
    About · Contact + one © line; HomeTrust removed from home (payment shows at checkout). SITE AUDIT PHASE 6 DONE (see
    CHANGELOG-audit.md): leads filters/kinds/file links, admin project search + guest phone, isValidPhone on all forms,
    gap grouping (lib/admin/gap-key.ts), Western digits in Arabic, tenant filter, unused copy removed.
  - 2026-09-29 SOURCING (owner): MIGRATION 0041 RUN ✔ (parts.datasheet_url, specs, backup_for). Store listing,
    search and home categories hide products with no delivery date (lead_time_class null); their pages still open.
    /api/admin/sourcing-backup {step: backups [preview] | clear | specs}: DigiKey/Mouser backups for out-of-stock
    Voltaat items — components only (lib/sourcing/backup.ts isComponent), specific code that starts the MPN, same
    kind of part (sameKind). First loose run made 107 wrong matches → cleared; strict run found 8, owner approved all
    → 7 added (MLX90614 twice = one backup). specs step filled 30 DK/MS products. Product pages: Specifications table
    (supplier specs, or the Voltaat description's "Specifications" bullets, lib/store/specs.ts) + Datasheet (PDF).
    Dashboard → Store → Sourcing overview (/dashboard/store/overview): highlights (Voltaat back in stock with a
    backup → Keep Voltaat, below margin [non-Voltaat only], backup >30% pricier, no photo) + groups. Live store = 950.
    Owner rule: through-hole and surface-mount are DIFFERENT items → backups must match mounting (sameMount;
    DigiKey "Mounting Type"/Mouser "Mounting Style"; Voltaat defaults to through-hole). Re-run: 7 backups (LF412 now
    8-PDIP, MCP4725 now the MCP4725EV board). Make my part (/design) has a store search box.

- AI ACCESS + CREDITS (2026-10-01, migration 0042 — NOT RUN YET): who may use which AI step, usage counting,
  credits. No payment. Rules live in Postgres (SECURITY DEFINER fns); TS wrappers in lib/credits/ (server.ts for
  routes, use-credits.ts read-only hooks, classify.ts = keyword CAD tier heuristic). Roles for AI = ai_role():
  admin (super_admin) / user (confirmed email, not anonymous) / anonymous (no session, guest, unconfirmed).
  - bom step (/api/analyse, /api/bom/electronics list): bom_rate_check — anonymous 5/day (per anon session AND
    hashed IP, salt env AI_RATE_SALT), user 30/day, admin unlimited; override store_settings.ai_limits.
    TODO Turnstile. Over the limit, analyse falls back to the basic reader ("daily_limit").
  - wiring step (/api/netlist; circuit part of /api/bom/electronics): anonymous blocked; first circuit per
    project free (projects.free_wiring_used), then 1 wiring credit; spend_credit() AFTER a saved circuit.
    /api/bom/electronics rebuilds the list without redrawing when wiring isn't allowed (circuit "skipped").
  - cad step: gate + cost dialog only (components/credits/cad-card.tsx in Mechanical › Drawings); Confirm stores
    projects.cad_tier via set_cad_request, spends nothing. 1 cad credit = 3 generations (cad_regens_remaining).
  - credits_ledger (balance = sum(delta), no balance column; client read-only). +3 wiring +1 cad when an order
    is marked delivered (trigger, once per order). admin_grant at /dashboard/credits (note required).
  - Every 'spend:' row is redeemable for 30 days as QAR 20 off a later order: checkout shows the line and calls
    redeem_credits(order) right after create_part_order (sets part_orders.credit_discount_qar, lowers total).
  - projects.status active/archived; trigger limits non-super_admin owners to 3 ACTIVE projects (guests too).
  - ai_usage gets anon_key/cost_usd/'cad' feature; view ai_usage_log; ai_usage_daily() on /dashboard/credits.
  - Before 0042 runs, all of this degrades to today's behaviour (no credit UI, nothing charged).

- CAD GENERATION (2026-10-02, migration 0043 — RUN ✔ 2026-10-08): zero-cost 3D models. POST /api/cad: Gemini writes
  OpenSCAD (lib/cad/prompt.ts, static check lib/cad/validate.ts, feature "cad"); the BROWSER renders it to STL in
  a Web Worker (lib/cad/render*.ts) with openscad-wasm-prebuilt@1.2.0 loaded from jsDelivr (unpkg fallback) —
  never bundled or put in /public (data-transfer cost). three.js viewer (components/credits/cad-viewer.tsx, lazy).
  cad_generations table, writes only via cad_begin / cad_set_code / cad_deliver / cad_fail. The credit is spent
  in cad_deliver, which the browser calls after a successful render (reuses spend_credit: 1 cad credit = 3
  versions); failed builds never charge and get one automatic repair. Cap: 5 undelivered-with-code generations
  per 24 h. Saved versions re-render from stored code with no AI call. No CadQuery (needs a paid Python server).
  Before 0043 the card keeps the stub. 0042 RUN ✔ 2026-10-02 and verified end to end by script (61 checks).

- SITE REVIEW FIXES, PHASE A (2026-10-03, migration 0044 — RUN ✔ 2026-10-08): money and checkout. Source prompt
  STAGE_SITE_REVIEW_FIXES_PROMPT.md; decisions in "Site review decisions" below.
  - 0044: flat QAR 50 on every tier, handling 0, free delivery >= QAR 300 goods on Standard only (store_settings
    free_shipping_threshold). create_part_order v6 refuses a 0 total and a bank transfer without an email;
    set_order_payment_method v2. lib/store/shipping.ts + checkout.ts hold the TS side (tests in *.test.ts).
  - Delivery cost shown on the product page and cart; empty-cart checkout redirects to /store/cart on the server
    (app/[locale]/store/checkout/page.tsx, form in checkout-client.tsx); handling line and "+QAR 0.00" split suffix hidden at 0.
  - Copy: priceNote = "This is your final price. We confirm your order on WhatsApp."; cardSoon once under the method
    list; Fawran account name + "(Gestaltung for Trading and Services W.L.L)" (page and email; IBAN only in the email);
    bank-transfer email required (hint + inline error); WhatsApp link under confirmNote (COMPANY_WHATSAPP in
    lib/company.ts); areaOtherHint when delivery area is "Other". Guest cart persistence checked: no change needed.
  - scripts/check-i18n-parity.mjs (run it after any message change); parity 2295/2295. Owner: run 0044 after 0043.

- SITE REVIEW FIXES, PHASE B (2026-10-03, migration 0045 — RUN ✔ 2026-10-08): copy, naming and jargon. One name per path (Shop parts / Get a part made / Plan a product / My projects, EN + AR); nav "Plan a product" → /projects/new. /projects/new has the three explanation lines, optional email and "My projects" link; with an email the project link is sent once (lib/projects/recovery.ts, link-email.ts, /api/projects/recovery-email, /api/projects/claim, components/projects/project-claim-gate.tsx; claim_project() moves guest-owned projects only and rotates the key). Client dashboard shows My orders / My projects (no customer orders page exists yet). About rewritten from owner facts. Forgot/reset password pages + /api/auth/callback added (Supabase redirect URL allow-list needed). Tests 325, parity 2337/2337.

- SITE REVIEW FIXES, PHASE D (2026-10-03, no migration): contact + footer with WhatsApp/address/C.R./payment badges; legal pages /delivery-returns, /warranty, /terms, /privacy rendered from content/legal/*.md, generated verbatim from LEGAL_PAGES_DRAFT.md by scripts/split-legal-draft.mjs (re-run it with --check after any edit to the draft; never hand-edit the content files); branded 404 via app/[locale]/[...rest]; guest sessions redirected from /dashboard and /inventory to /projects (lib/auth/guest-redirect.ts). Hours are omitted until the owner supplies them.

- SITE REVIEW FIXES, PHASE C (2026-10-03, no migration yet): store search/sort/ranking (lib/store/catalog.ts = URL contract + StoreCardPart, lib/store/search.ts = ranking and CATEGORY_WEIGHTS), new empty states, "Delivery time" filter, cards with "Arrives by" dates (arrivesByDate mirrors order_delivery_quote), SKUs hidden from customers. C5 (18 → 8/9 categories) is NOT applied: the mapping was shown to the owner and waits for approval; it must land as data (migration), not in components.

- SITE REVIEW FIXES, PHASE I (2026-10-03, migration 0046 — RUN ✔ 2026-10-08): credit and milestone emails. Outbox + triggers in 0046; drainer app/api/cron/notifications (lib/notifications/decide.ts, links.ts); templates lib/email/templates/*; unsubscribe app/api/notifications/unsubscribe; admin /dashboard/notifications. Kind names must stay in sync in three places (0046 check constraint, OUTBOX_KINDS, NOTIFICATION_KINDS). discount_ready is OFF in store_settings.notifications until spend_credit/redeem_credits can date a credit from when it was earned (owner rule: 30 days from the day earned). vercel.json cron is daily (Hobby-safe); */15 needs Pro.

- SITE REVIEW FIXES, PHASE H (2026-10-03): SEO. lib/seo.ts pageMetadata() is the only place that builds canonical/hreflang/OG/Twitter; lib/meta.ts metaFor() calls it. app/sitemap.ts, app/robots.ts, app/[locale]/opengraph-image.tsx (English card for both locales).
- SITE REVIEW FIXES, PHASE E (2026-10-03, migration 0047 — RUN ✔ 2026-10-08): Arabic. translate_details step (lib/store/translate-details.ts) fills description_ar/specs_ar; productDetailsForLocale() decides what /ar shows (never raw English supplier text); IsolatedTitle for mixed-direction titles; arabicCountForm() for counts; sensor = مستشعر, kits = مجموعات. content/legal/** is the owner's verbatim text and is excluded from wording changes.

- SITE REVIEW FIXES, PHASE F (2026-10-03): mobile. Filters drawer (components/ui/sheet.tsx, native dialog, no Radix), back-to-top, tap-target utilities in tailwind.config.ts, Button min 44 px below md, square image boxes, /design reordered on phones. Not audited at 375 px: checkout, /design/quote, prototyping workspace, dashboard.

- SITE REVIEW FIXES, PHASE G (2026-10-03, no migration): performance; log + before/after in CHANGELOG-audit.md.
  - Caching: home, /store and /store/[sku] are ISR (`revalidate = 300`, products built on first visit); marketing, legal, /design, /design/quote, cart shell and checkout success are static. Public reads go through lib/store/public-catalog.ts (cookie-free anon client + `unstable_cache`, tags `parts` / `store-settings`, lib/cache/storefront.ts). Any write to parts / supplier_offers / suppliers / store_settings must call `revalidateStorefront()` (already in every dashboard/store action, the admin store API routes and the voltaat-sync / supplier-refresh crons). Never add cookies()/headers()/force-dynamic/the cookie server client to these pages, and call setRequestLocale in every page/layout. Private areas stay dynamic.
  - /store?q|category|material|stock|sort|page is rewritten (next.config.mjs, list = STORE_URL_PARAMS in lib/store/catalog.ts, test-checked) to the dynamic app/[locale]/store/search; plain /store stays cached. Middleware skips Supabase when there is no sb-…-auth-token cookie and never sets NEXT_LOCALE on locale-prefixed pages.
  - Messages: the locale layout sends only BASE_MESSAGES (site chrome); pages/layouts wrap their output in <MessagesScope scope="…"> (components/i18n/messages-scope.tsx, scopes in lib/i18n/scopes.ts; dashboard/inventory/my-inventory/prototyping use "all"). New client component with useTranslations("X") → add "X" to the scope of each route that renders it (or BASE for header/footer chrome); lib/i18n/scopes.test.ts fails if anything is missing.
  - Photos: lib/store/image-url.ts sizedImage()/sizedSrcSet() (Shopify `?width=`: cards 300/600, product 600/1000, thumbs 140; our uploads → -thumb.webp); plain <img> with width/height, lazy except the first four cards. Low-res originals: scripts/find-low-res-photos.mjs.
  - GA4 loads only after Accept in components/cookie-notice.tsx (lib/analytics/consent.ts); @next/third-parties removed. Fonts: Outfit + JetBrains Mono variable, IBM Plex Sans Arabic 400/700 only, only Outfit preloaded. Live `x-vercel-cache: HIT` still to be confirmed after deploy.
- SITE REVIEW FIXES, PHASE C5 (2026-10-04, migration 0048 — RUN ✔ 2026-10-08): nine store categories (lib/store/store-categories.ts; AR labels in lib/store/category-label.ts). Storefront reads parts.store_category; parts.category stays the supplier/source category (import, syncs, BOM matcher untouched). New products: trigger + store_category_rules (unmapped → "Tools and accessories" + store_category_review, counted on Dashboard → Store); product form "Store category" override. Per-SKU mapping in 0048 generated by scripts/build-category-migration.mjs (re-run it only for a NEW migration). Before 0048: hasStoreCategory() probe in lib/store/public-catalog.ts falls back to parts.category. Gift card VLT-44331994546493 unpublished; Voltaat import skips gift cards. After running 0048, any Dashboard → Store save refreshes the store cache (else 5 min).
- DIRECT-TO-AI PROJECT CREATION (P1-11 / CC-1, 2026-10-08, no migration): "Plan a product" goes straight into the AI brief chat. /projects/new (no ?for=drawing) = "Describe what it must do." (components/projects/describe-idea.tsx, server, scope "project" → components/projects/new-project-chat.tsx). No name/phone/email fields; Start is disabled until the consent box is ticked and text typed. The FIRST message does everything: ensureSession() → ONE projects insert {name "New project", brief = message, spec.aiConsent} (lib/projects/create-from-chat.ts newProjectInsert — consent exists before anything reaches the provider; nothing inserted before the first send) → first /api/brief-chat turn → sessionStorage "gestaltung:chat:<projectId>" = {messages, addition, done, error} → router.replace(/projects/<id>/prototyping?start=chat). The workspace (prototyping/page.tsx reads searchParams.start → PrototypingWorkspace → IdeaStage → BriefChat initialOpen) opens Brief with the chat holding that history (key removed on read; an error shows the chat's own failure line + Start over). 3-project cap: "project_limit" → Projects.limitReached + "Archive a project" link, no API call. No AI key (providerStatus().destination null) → the old NewProjectForm. ?for=drawing unchanged. Name: POST /api/projects/name (Gemini, metered "analyse", quota-gated, RLS, only while name = "New project"; lib/projects/name-from-brief.ts) called once by the workspace on ?start=chat; failure keeps "New project". Shared chat UI: components/prototyping/chat-thread.tsx. A consent-only spec is NOT an analysis (isAnalysed() in lib/prototyping/spec.ts, used by IdeaStage, UnderstoodPanel, readiness). Phone asked only when needed: components/projects/phone-prompt.tsx (inline card, saved to profiles.phone, gating lib/projects/phone-prompt.ts; "Not now" = localStorage gestaltung:phone-prompt-dismissed:<userId>) above the BOM (node bom + Electronics › Components) once lines exist; guest "Save my project link" in the workspace bar (phone + optional email → /api/projects/recovery-email) shown ONLY while the project is < 60 min old and not yet emailed, because project_recovery_begin (0045) refuses older/already-emailed projects; QuoteRequest skips its phone field when the profile has one and saves a typed one after a successful request.
- FEATURE VIDEOS (P3-04 / WF-07 / CC-2, 2026-10-08, migration 0049 — RUN ✔ 2026-10-08): six short self-hosted clips, no third-party embeds. Public Supabase bucket `videos` (0049: public read, writes super-admin only, 50 MB, mime mp4/webm/jpeg/vtt); layout videos/<slug>/<slug>.mp4 | .webm | .jpg (poster 1280x720) | .en.vtt | .ar.vtt. Registry + pure rules in lib/videos.ts (VIDEO_SLUGS idea-to-kit, file-to-part, sketch-to-drawing, wiring-check, cad-model, store-to-door; VIDEOS with durationSeconds 45/45/42/42/40/42; videoBase/videoSources/canAutoplay/videoJsonLd; tests lib/videos.test.ts). Player components/feature-video.tsx ("use client", all text as string props so public pages need NO MessagesScope change): `<video preload="none" playsInline muted>` + webm/mp4 sources + captions track for the locale; IntersectionObserver autoplays at >= 50 % visible and pauses when it leaves; never autoplays under prefers-reduced-motion (listens for changes) or with posterOnly; 44 px play/pause/replay button at the start-bottom corner; a user pause is respected until they press play. The video file is only requested on play (preload none), so "missing" is detected when playback starts: the LAST <source> (mp4) onError (React does not bubble source errors to the video) hides the video and shows the poster as a plain lazy <img>; poster missing too (probed with new Image() at mount) = bg-panel placeholder with a Film icon + title. Pages therefore ship before any file exists. Wrappers: components/feature-video-section.tsx (server, getTranslations("Videos") + NEXT_PUBLIC_SUPABASE_URL; public pages) and components/feature-video-client.tsx (useTranslations("Videos"); workspace, scope "all"). Copy: `Videos` namespace (seeItWork*, play/pause/replay, <slug>Title/Caption/Description). Placements: home (new "See it work" section between hero and Featured: idea-to-kit large over 2 columns, file-to-part + store-to-door small in column 3), how-it-works (one per path above the 4 steps: idea→idea-to-kit, make→file-to-part, buy→store-to-door), /design (row of two under the path cards, not inside the Links: file-to-part → /design/quote, sketch-to-drawing → /design/drawing), /design/drawing (sketch-to-drawing section above Pricing), workspace empty states (NetlistView before the first circuit: wiring-check; CadCard before the first generation: cad-model; both small + posterOnly). JSON-LD: home emits a VideoObject for idea-to-kit ONLY when its `published` flag in lib/videos.ts is true (all false until the owner uploads the real clip; then flip `published` and set the real `uploadDate`). Scripts: `node scripts/upload-video.mjs <folder>` (folder name = slug; service-role fetch upload to videos/<slug>/<file>, x-upsert, long cache; needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and `node scripts/make-video-placeholders.mjs <outDir>` (sharp poster + vtt per slug, mp4/webm only if ffmpeg is on PATH; `winget install Gyan.FFmpeg`). Owner to do: upload the clips, flip `published`.
- PHASE 0 — LIVE RE-TEST PACK (P0-02 / P0-06 / P0-08, 2026-10-08, commit 5fc80cb, no migration, no app code changed): docs/LIVE_RETEST.md = owner re-test checklist for SITE_AUDIT #1–#10 (URL, clicks, expected result, regenerate step Electronics › Board › Regenerate for #1/#2/#5, results table) plus the section "Before re-testing: Supabase redirect URLs". scripts/check-live.mjs [origin] (no deps) fetches /en, /ar, /en/store, /en/how-it-works, /en/design, /en/pricing twice and prints status, x-vercel-cache, cache-control, age, content-length, ms and whether the 2nd fetch was a HIT; also prints the Lighthouse 13.5.0 mobile command. Run 2026-10-08: every 200 page was a HIT on the 2nd fetch; /en/pricing = 404 (not built yet); Phase G "live HIT" is now confirmed. Password reset: forgot-password sends redirectTo = {origin}/api/auth/callback?next=%2F{locale}%2Freset-password; OWNER must add https://gestaltung360.com/api/auth/callback, https://www.gestaltung360.com/api/auth/callback, http://localhost:3000/api/auth/callback (+ the same with ** appended; fallback host/**) under Supabase → Authentication → URL Configuration and set Site URL to https://gestaltung360.com — cannot be scripted (no management API key). Not yet tested end to end with a real email.
- PHASE 1.5 FUNNEL EVENTS (P1-08, 2026-10-09, no migration): GA4 funnel events, consent-gated, plus an admin Funnel card.
  * lib/analytics.ts: track(event, params?) is a no-op unless the cookie choice is "accepted" (re-read from localStorage + the gestaltung_consent cookie on EVERY call, so a later Accept works without reload) AND window.gtag exists. Never throws. cleanParams keeps only strings (<=100 chars), finite numbers, booleans, max 10. Typed event map: path_chosen{path shop|make|plan}, project_created{method chat|form|drawing|quote}, bom_generated{lines}, circuit_generated{cost credit|blocked}, cad_generated, add_to_cart{sku,qty}, checkout_started{items,total_qar}, order_placed{order_id,total_qar,method}, phone_captured{where bom|save-link|quote}, pricing_viewed{plan?}. order_delivered has NO client event (admin server action); the Funnel card counts it from part_orders. Tests lib/analytics.test.ts.
  * Server pages use components/analytics/track-click.tsx (display:contents wrapper, onClickCapture) and pricing-viewed.tsx (mount event). Client call sites: header-nav, design-dropzone, new-project-chat/form, quote-request, phone-prompt, idea-stage (only when the BOM save succeeds), netlist-view + electronics-route, cad-card (after cad_deliver), cart-provider addItem, checkout-client (checkout_started once; order_placed right after the order exists), pricing page (pricing_viewed on mount; paid-plan WhatsApp CTA fires it with plan=<id>).
  * Admin Funnel card (components/dashboard/admin-overview.tsx, Admin.funnel* EN+AR): last 30 days, eight head-count queries: projects (not is_test), analysis_runs analyse/ok, analysis_runs netlist/ok, cad_generations delivered, part_orders (not is_test), part_orders delivered, credits_ledger spend:% and redeemed:%. analysis_runs has no is_test.
  * New events: add the name + params to AnalyticsEvents in lib/analytics.ts and call track(); never pass objects, arrays or free text. Verify in GA4 DebugView with ?debug_mode=1 after Accept.
  * EN+AR parity 2648/2648, tests 808.
- PRICING RULE CHANGE (owner, 2026-10-09, migration 0052 — NOT RUN YET): parts list free, every circuit costs a credit, no free CTA, engineer-review promise replaces reprint.
  * 0052_no_free_circuit.sql replaces credit_can_use + spend_credit: wiring always needs/spends 1 wiring credit (anonymous blocked, admin free, bom + cad unchanged). projects.free_wiring_used KEPT; no longer gates anything; spend_credit still sets it on a project's first PAID circuit so the 0046 first_circuit email still fires. Kind names unchanged.
  * TS mirror (works before 0052): lib/credits/constants.ts noFreeCircuit() maps a DB "free" answer to credit/no_credits; used by server.ts canUse() and use-credits.ts useCanUse(); server.ts spend() calls spend_credit a second time when the old DB answers "free", so the credit is charged. CostLabel/costFree removed. Tests lib/credits/credits.test.ts.
  * Out of credits (no card payment): components/credits/access-note.tsx = "Each wiring diagram or 3D model costs one credit (QAR {price}). Credits are paid by bank transfer or in person; message us on WhatsApp…" + wa.me (COMPANY_WHATSAPP, "Hi, I'd like to buy credits for project {name}") + "How credits work" → /pricing#credits. projectName passed from NetlistView, CadCard, GenerateComponents.
  * Copy EN+AR: no "— free" CTAs (StoreLanding.heroPrimary, Students.ctaPrimary, Pricing.ctaStart = "Start a project"); Maker "AI included per month" = "Parts list"; "What is free" = parts list only; Payment "free during launch" lines reworded; first_circuit + credit-email copy no longer say free. Trust: warrantyTitle "An engineer checks before we make it.", new warrantyText, warrantyMore "You approve the drawing and the quote; we make exactly that. The warranty covers manufacturing defects."; icon ClipboardCheck. Pricing.faq3A = engineer review + you approve first. OWNER RULE: never promise reprint/rework/remake/"we are sure" (memory feedback_no_reprint_promise).
  * Left on purpose: "free quote" (fabrication quote), "free chat", Google free-tier facts, Maker price "Free", free delivery. store_settings.pricing_plans still carries first_circuit_free:true (unused).
  * EN+AR parity 2636/2636, tests 795.
- PHASE 1.4 PRICING (P1-06 / P1-07 / P1-10, 2026-10-09, migration 0051 — RUN ✔ 2026-10-09): /pricing in EN + AR; service prices published; "card coming soon" removed. Plans are DISPLAY-ONLY until card payments exist (Phase 4): no billing code.
  * Numbers are data: store_settings.pricing_plans + service_prices, seeded by 0051 (on conflict do nothing, so owner edits survive). lib/pricing/defaults.ts holds the identical defaults (lib/pricing/plans.test.ts checks the SQL matches); lib/pricing/plans.ts = parsePricingPlans/parseServicePrices (zod; invalid → defaults), planOrderDesktop (anchor Studio, target Builder, Maker, Institutions), planOrderMobile (Maker, Builder, Studio, Institutions), formatQar/formatPerOutput. Cached reads getPricingPlans()/getServicePrices() in lib/store/public-catalog.ts (tag "store-settings"). DEFAULTS — OWNER TO CONFIRM: QAR 20/credit, 30 days; Maker free/3 projects; Builder QAR 149, 10 projects, 5 wiring + 2 CAD, priority quotes, 5 % kits (target); Studio QAR 399, no limit, 15 + 6, engineer hour, 10 % kits (anchor); Institutions contact only; enclosure from 800, drawing 200/450/from 800, sprint from 20,000, pilot from 15,000 (pilot not shown yet).
  * app/[locale]/pricing/page.tsx (static, metaFor("pricing"), "/pricing" in SITEMAP_STATIC_PATHS + seo test, Pricing namespace): hero; plan grid (DOM = mobile order + order-N / lg:order-N = desktop order; Builder ring + "Most teams pick this"); CTAs Maker → /projects/new, Builder/Studio → wa.me "Hi, I'd like the {plan} plan…", Institutions → /contact?kind=institution; paid-by-transfer note; #credits section (CreditsOverview balance inside MessagesScope "pricing"; cost/free/refund/projects/order-delivered +3/+1 = ORDER_DELIVERED_CREDITS; loss-framed line); "Services, from" cards; 6-question FAQ (ownership answer points to /terms, B7). /design has a "Prices from" strip; /design/drawing tier prices read service_prices + "See plans and prices" link.
  * /credits page deleted; next.config 308 /:locale(en|ar)/credits → /:locale/pricing; links we control carry #credits (badge, AccessNote, CAD dialog, checkout expiry line, credit emails). Removed Credits page-only keys, Meta.credits*, scope "credits".
  * P1-10: PayMethods.cardSoon → PayMethods.methodsLine "Pay by cash on delivery, Fawran or bank transfer. We confirm every order on WhatsApp." (checkout, home-trust); Payment.cardTitle/cardBody + the card row in PaymentCard removed.
  * Contact ?kind=institution: contact-form prefills Contact.institutionPrefill; /api/store-lead prefixes "Institution / team plan: " (CONTACT_KINDS map). Footer.pricing in the Information column.
  * OWNER: confirm all numbers; Builder/Studio benefits (10 projects, monthly credits, kit discounts) are NOT enforced by the DB (the 3-project trigger still applies) — grant by hand until Phase 4. Deploy gate: screenshots reviewed by the owner before push.
  * EN+AR parity 2633/2633, tests 785.
- HOTFIX client-side exception (2026-10-09, no migration): Chrome now returns a Promise from scrollIntoView, and BriefChat's `useEffect(() => endRef.current?.scrollIntoView(...))` returned it, so React called the Promise as cleanup ("TypeError: destroy is not a function") on the next chat message, on closing the chat or on leaving the workspace — "Application error: a client-side exception" on live. Fixed by giving that effect (and the expression-bodied effects in dictation / parts-stage / spec-sheet) a block body; an eslint no-restricted-syntax rule now rejects expression-bodied useEffect/useLayoutEffect callbacks. Test project 6b5907f2-c957-43f9-bce8-42e73beeff33 ("TEST crash repro — delete") was created on prod during the repro — owner to delete.
- PHASE 1.3 TRUST BLOCK + /trust + DATASHEET LINE (P1-04 / P1-05, 2026-10-09, no migration): site-wide trust block above the footer, a /trust page, and the datasheet-grounding line.
  * components/trust-block.tsx (server, Trust namespace): TrustBlock (neu section: kicker, h2, "Read more" → /trust, 2-col md / 3-col lg grid, then TrustedBy), TrustItemCards({full}) and TrustedBy. Five items: files, data (→ /privacy), contact (wa.me link, number forced ltr), registered (name = COMPANY.legalNameEn / legalNameAr, cr = COMPANY.crNumber, address = COMPANY_ADDRESS, never copy), warranty (→ /warranty). Sixth item "Trusted by" = logo row from store_settings.trusted_by, NOT seeded, rendered as nothing when missing/empty/invalid. Value shape [{name, logo_url, href?}]; lib/trust.ts parseTrustedBy (https:// or site-relative logos, https:// links, max 12; lib/trust.test.ts). Read via getTrustedBy() in lib/store/public-catalog.ts (cookie-free anon client + unstable_cache + tag "store-settings"), so static/ISR pages stay static. Logos are plain <img>.
  * Gating: layout renders <TrustGate><TrustBlock/></TrustGate> directly above <Footer/>. components/trust-gate.tsx (client, no messages) hides it where the header is hidden (isAppPath() exported from components/header-gate.tsx) and on /trust. BASE_MESSAGES unchanged.
  * /trust: app/[locale]/trust/page.tsx, static, metaFor("trust"), "/trust" in SITEMAP_STATIC_PATHS + seo test. Hero, full cards (<id>More sentence under each; data card states the Gemini free-tier and Groq voice facts; warranty card follows content/legal/warranty: remake or refund, 7 days store items), Questions row → /contact. Linked from the block and Footer.trust.
  * P1-05: StoreLanding.choiceIdeaDatasheet (home "Plan a product" card) and Prototyping.datasheetLine (under the intro of Electronics › Components, GenerateComponents in components/prototyping/electronics-route.tsx).
  * OWNER: (a) content/legal/privacy.*.md §4 still lists "Partner workshops" — contradicts "visible only to you and our engineer"; remove that line in the draft and re-run scripts/split-legal-draft.mjs. (b) Confirm "Sun–Thu" hours and the deletion / no-training claims. (c) AR registered line uses COMPANY.legalNameAr (CR spelling), not the brand spelling. (d) Fill trusted_by only with customers who agreed.
  * EN+AR parity 2554/2554, tests 771.
- PHASE 1.2 FOUNDER-FIRST HOME + /students (P1-02, 2026-10-09, no migration): home order is hero → "Built for founders" (three neu outcome cards, no numbers; StoreLanding.foundersKicker/foundersHeading/foundersIntro/founders1..3Title/Text; reuses ChoiceHead) → paths row → See it work → Featured → slim school/student row (StoreLanding.studentsTitle/studentsText/studentsCta → /students) → callback form. Home stays ISR, scope "home" unchanged. New static page app/[locale]/students/page.tsx (server only; Students namespace): hero (Start a project → /projects/new, Shop parts → /store), "What you get" (parts list; checked wiring, first circuit free; 3D case = one credit, up to three versions), three kit links into the store search (/store?q=line following | soil moisture | DHT), Teachers block → /contact?kind=school. Meta via metaFor("students"); "/students" in lib/seo.ts SITEMAP_STATIC_PATHS (sitemap + test). Not in the header; Footer.students in the Information column. Contact ?kind=school: components/contact-form.tsx reads window.location.search in an effect (NOT searchParams, so /contact stays static), prefills an empty message with Contact.schoolPrefill and sends kind:"school"; /api/store-lead (contact_form only) prefixes the message "School / class project: " and adds "(school / class project)" to the email subject. No DB change. get1Text deliberately says unstocked parts get a quote. EN+AR parity 2523/2523, tests 765.
- PHASE 1.1 HERO + WHY (P1-01 / P1-09, 2026-10-09, no migration): home is outcome-led. Hero (app/[locale]/page.tsx, a neu card) = H1 + one sub line + ONE primary CTA ("Start a project — free" → /projects/new) + a small "Shop parts" text link → /store + a mono proof line (StoreLanding.heroH1/heroSub/heroPrimary/heroSecondary/heroProof); no search box or dropzone above the fold (verified 375×667: proof line ends at 518 px in EN and AR). "50 projects delivered since March 2026" in heroProof is a DEFAULT — OWNER TO CONFIRM the real number (edit StoreLanding.heroProof in en.json + ar.json). The three choices are a compact row of p-5 neu cards right after the hero and before "See it work" (plan §5.2 order; same functions: store search form, DesignDropzone compact + /design/drawing link, Plan button); heroChoose is its sr-only h2; heroChooseIntro removed; choiceIdeaStep1..3 now unused. Why (two sentences): About.whyKicker/whyBody (block after the About hero) and Footer.why (paragraph above the footer link columns; footer is a server component, no scope change). StoreLanding.metaTitle/metaDescription reworded ("From idea to prototype in Qatar"). Home stays ISR (revalidate 300), scope "home" unchanged.
- PHASE 0 FIRST-RUN POLISH (P0-07 / WF-31, 2026-10-09). No migrations.
  * #59: skeletons (components/ui/skeleton.tsx, motion-safe pulse) instead of QAR 0.00 / a bare spinner — cost panel, BOM summary, payment card (null until the first /api/bom/match; workspace matchesLoaded + lib/prototyping/bom-cost.ts costState) and the project page.
  * #38: SvgFrame minHeight (720 px lg / 360 px phone; sideways scroll instead of tiny labels), 44 px zoom/download/print targets, wiring svg preserveAspectRatio meet (lib/prototyping/svg-size.ts).
  * Readiness labels: humanName()/titleCaseId() (lib/prototyping/human-name.ts) used in readiness part labels + reasons, bom-choose, circuit orphan/hard flags; no raw concept ids.
  * Drawing title block: fitText() (24 chars per cell) + <title> tooltip with the full text (lib/prototyping/dimension-drawing.ts).
  * Project page vs BOM: ONE toBuyNow(bom, matches) in lib/prototyping/bom-cost.ts used by the workspace panel, BOM table, payment card and the project page (PrototypingCard loads /api/bom/match — its writes are upserts, so idempotent). The page's own parts sum is relabelled "Total of parts added here" (a different sum; merging would double-count).
  * #60 /my-inventory: visible "Quantity: N", Edit (inline qty/name) and Delete (inline confirm) at 44 px; typing 0 no longer deletes (lib/inventory/edit.ts). No unit column exists.
  * #20: project-page Materials chips REMOVED (project_materials was write-only; rows left in the DB).
  * Copy en+ar parity 2479/2479; tests 763. Owner still to re-test on live (docs/LIVE_RETEST.md).
- PHASE 0 COPY AUDIT (P0-03 / P0-04 / P0-05 / P1-03, 2026-10-08, migration 0050 — NOT RUN YET): every promise must be one the studio can keep (made in our Lusail studio; an engineer quotes the method; no partner workshops, no automatic matching).
  - Replaced (EN + AR): R1 "Made in our Lusail studio; larger CNC or sheet-metal jobs are quoted case by case." (HowItWorks.makeStep3Copy, About.partnersBody; titles "Made in our Lusail studio" / About "Made in-house"); R2 "Our engineer reviews your file and quotes the best method within one working day." (DesignHub.uploadCopy, StoreLanding.choiceMakeText + dropText, DesignQuote.subheading, HowItWorks.makeStep2Copy; makeStep2Title "Our engineer quotes the method"); Prototyping.productionIntro/Note and Meta.aboutDescription no longer mention workshops. makeStep2Copy lists 3D printing, CNC and laser only (no EDM).
  - One SLA phrase, "within one working day": Checkout.successNote (was "within a few hours"), Contact.responseNote (was "business day"). The Credits.cadErr_too_many "24 hours" rate-limit message stays.
  - /design/drawing (CadAssistance) — D5 DEFAULT, OWNER TO CONFIRM: turnaround "Typically 2–3 working days" (was "48 hours"), step 2 "...manufacturing-ready STEP file, typically within 2–3 working days.", output "STEP, plus IGES on request" (was "STEP · IGES"). AR: "عادةً 2–3 أيام عمل" / "STEP، وIGES عند الطلب".
  - One tagline: Brand.tagline = "Product design & fabrication · Lusail, Qatar" / "تصميم المنتجات والتصنيع · لوسيل، قطر" (header; app/[locale]/page.tsx now reads it via getTranslations("Brand")).
  - Deleted (all unreferenced): the whole `Home` namespace (incl. specMethodValue "Auto-matched"), the dead `tHome` line in app/[locale]/design/page.tsx (clears the lint warning), StoreLanding.tagline + footerText ("Doha, Qatar / Sun–Thu"), Hero.kicker/heading/subheading/ctaPrimary/ctaSecondary (Hero.formats stays), and the dead old HowItWorks set (heading, intro, panelTag, stepsTag, step1..4Title/Copy, ctaText, ctaButton; the page only uses the buy/make/idea keys).
  - P0-05 one AI price: migration 0050_one_ai_price.sql sets store_settings.ai_pricing = {"per_call_qar": 20, "charging": false} (NOT RUN YET; the per-call figure must equal the credit price, QAR 20; charging stays off). Code default is AI_PRICE_QAR (= CREDIT_QAR, lib/credits/constants.ts) in dashboard/usage/page.tsx and saveAiPricing. PaymentCard (prototyping Quote step) hides the "AI generations: N × price" line while charging is off and shows the total without the waived AI amount; the "free during launch" note stays. Admin AI-pricing form has the hint Payment.adminPriceHint "Must match the credit price (QAR 20 per credit)." Until 0050 runs the live setting still reads QAR 1.
  - Left on purpose: the Prototyping "route" wording (electronics build route / manufacturing route accepted) and recHeading "How this gets made" are product-planning features, not workshop promises; "Workshop inventory" (tenant role/dashboard) is a data model term; EDM still appears in process labels and DesignHub.metaDescription (owner to decide whether the studio offers it).

## Site review decisions (owner, 2026-10-03)

Source prompt: STAGE_SITE_REVIEW_FIXES_PROMPT.md. One commit per phase (A–I).

- D1 Shipping: QAR 50 for every tier, handling 0. Free delivery over QAR 300 goods subtotal on **Standard only**; Express is never free (Economy also stays QAR 50).
- D2 Handling fee: removed (0, line hidden when 0).
- D3 Checkout total is binding. Cart line: "This is your final price. We confirm your order on WhatsApp."
- D4 Hide VLT codes from customers (cards, product page, cart). Keep them in the product URL, the order confirmation email and admin pages.
- D5 Guests on /dashboard and /inventory are redirected to /projects.
- D6 Projects stay in this browser; optional email on /projects/new; when given, email the project link to it.
- D7 Cookie notice (Accept / Decline); GA4 only after Accept; no Google Signals.
- D8 Legal pages come from LEGAL_PAGES_DRAFT.md exactly as written (EN + AR, four routes: /delivery-returns, /warranty, /terms, /privacy). Keep "Last updated". Skip the header note. Do not soften wording.
- D9 Keep all published products.
- D10 Publish WhatsApp +974 6656 7410 on Contact, footer, checkout, 404.
- D11 About: founded 2026; Prusa MK4 3D printer, CNC machining, laser cutting, electronics prototyping; no photo for now.
- D12 Address: Rafal Tower, Lusail, Qatar. Hours not given → omit.
- D13 Category consolidation: show the mapping table and wait for approval.
- B7: do NOT publish "1 free revision; you own the files". /design/drawing gets one line "See what the price includes" → /warranty.
- Phase A: migration 0044 sets shipping outright, makes email required server-side for bank transfer, rejects 0-total orders, adds the free-delivery threshold.
- Phase I: the 30-day expiry of the QAR 20 redemption runs from the day the credit is earned.

## FULL BUILD SEQUENCE — STATUS SUMMARY (updated 2026-10-08)

| # | Stage | Migration(s) | Status |
|---|-------|-------------|--------|
| 1 | Scaffold + deploy (Next.js + Vercel) | — | ✅ LIVE |
| 2 | Bilingual EN/AR shell + theme + logo | — | ✅ DONE |
| 3 | Public marketing site (home, how-it-works, about, contact) | — | ✅ DONE |
| 4 | Supabase auth + roles + RLS | 0001, 0002, 0003 | ✅ DONE |
| 5 | Multi-tenant inventory (workshop/client) | 0004 | ✅ DONE |
| 6a | CAD upload + job creation + GA4 | 0005 | ✅ DONE |
| 6b | Workshop dispatch + status workflow + job events | 0006 | ✅ DONE |
| 7 | Workshop internal jobs + BOM + inventory deduction | 0007 | ✅ DONE |
| 7† | Super Admin global command-centre dashboard | — | ✅ DONE |
| 8a | Security hardening + conversion wins (social proof, local advantage, CAD service page) | 0009 | ✅ DONE |
| 8b | Upload-funnel upsells + B2B path bifurcation | 0010 | ✅ DONE |
| PS | Parts Store e-commerce module (catalog, cart, checkout, admin) | 0011 | ✅ DONE (code) — run 0011 in Supabase |
| 9 | AI method auto-detection | — | ❌ DROPPED 2026-10-08 (an engineer quotes the method) |
| 10 | Store-first rebuild Stages 1–5 | — | ✅ DONE |
| 11 | Website fixes + public quote flow | 0012 | ✅ DONE |
| 12 | Prototyping | 0020–0027 | ✅ DONE |
| 13 | Prototyping Part 4 store/sourcing | 0028–0029 | ✅ DONE |
| 14 | Site audit fix Phases 1–6 | 0030–0035 | ✅ DONE |
| 15 | Supplier sync + restock + AI pricing + payment methods | 0036–0039 | ✅ DONE |
| 16 | Firmware/datasheets | 0040–0041 | ✅ DONE |
| 17 | AI access + credits | 0042 | ✅ DONE |
| 18 | CAD generation | 0043 | ✅ DONE |
| 19 | Site review fixes Phases A–I + C5 | 0044–0048 | ✅ DONE |
| 20 | Direct-to-AI project creation P1-11 | — | ✅ DONE |
| 21 | Feature videos P3-04 website side | 0049 | ✅ DONE |

† The "original-plan Stage 7" (super admin dashboard) was built as an add-on alongside the workshop Stage 7.

## PROMPT FILES IN PROJECT ROOT
- STAGE_6A_PROMPT.md — CAD upload + GA4
- STAGE_6B_PROMPT.md — workshop dispatch + status workflow
- STAGE_PARTS_STORE_PROMPT.md — e-commerce parts store (the prompt used for Stage PS above)
- STAGE_8A_PROMPT.md — security review + conversion wins (reference; stage already done)
- STAGE_8B_PROMPT.md — upload-funnel upsells + B2B paths (reference; stage already done)

## WHAT'S NEXT — QRDI workshop upgrade plan (Phases 0–4)
- The plan lives in C:\Users\mmamr\Desktop\projects\QRDI wrorkshop\03-Website-Upgrade-and-Rebuild-Plan.md, with prompt pack 05 and the tracker artifact https://claude.ai/artifact/SLdtibTbt19YRbWKTvDeLt (collections tasks/fixes).
- Phase 0 started 2026-10-08 with P0-01 (migrations confirmed run).
- The old "Stage 9 AI method auto-detection" idea is DROPPED: the business no longer promises automatic method detection; an engineer quotes the method.

## PENDING MIGRATIONS (run in order if not already done)
Check Supabase → Table Editor to confirm which tables exist before running:
- 0010_job_upsells.sql — jobs upsell columns (speed_tier, post_processing, inspection_report, job_path, production_qty_range)
- 0011_parts_store.sql — parts, part_orders, part_order_items tables + create_part_order RPC
- 0012_quote_uploads.sql — private `quote-uploads` storage bucket + policies for the public /design/quote flow
  (RUN THIS before the drag-and-drop quote upload works in production; needs SUPABASE_SERVICE_ROLE_KEY set)
- 0020_prototyping.sql — prototyping tables + projects.brief/stage/stages (RUN AFTER 0019; /projects/<id>/prototyping
  loads without it but cannot save an analysis until it runs)
- 0021_prototyping_disciplines.sql — projects.disciplines jsonb (RUN 2026-09-21 ✔)
- 0022_prototyping_spec_and_sources.sql — projects.spec + project_parts source/kind/catalog columns (RUN ✔ —
  confirmed 2026-09-22 by a live analysis saving spec + parts)
- 0023_bom_netlist_drawings_usage.sql — projects.bom/netlist, part dimensions, parts.tags, sourcing_gaps,
  ai_usage + RPCs (RUN ✔ — confirmed 2026-09-22)
- 0028_suppliers_and_offers.sql — suppliers, supplier_offers, pricing modes, derived sourcing (RUN AFTER 0027;
  /dashboard/store/suppliers and the product Sourcing panel show "run 0028" until it runs)
- 0029_intake_demand_delivery.sql — images bucket, demand signals, shipping tiers, promised dates,
  create_part_order v3 (RUN AFTER 0028; until it runs, checkout detects the missing quote function (PGRST202)
  and keeps the old no-shipping flow)
- 0030_merge_duplicate_parts.sql — merges duplicate store products, repoints references, soft-deletes losers via
  merged_into, unique guard (RUN AFTER 0029; dry-run/backup blocks at the top)
- 0031_is_test_flag.sql — is_test on projects, inquiries, part_orders, parts, ai_usage (RUN AFTER 0030)
- 0032_on_request_checkout.sql — on-request items orderable at the listed price, "Date to be confirmed"
  (RUN AFTER 0031)
- 0033_order_links_and_delete_fix.sql — fixes the 0024 trigger that broke project delete; copies notes into empty briefs (RUN AFTER 0032)
- 0034_checkout_quantity_fix.sql — create_part_order v5 stops doubling project-line quantities at checkout;
  one-time repair of doubled lines with a DRY RUN block (RUN AFTER 0033; the repair runs once — never drop its
  log table)
- 0035_delete_project.sql — delete_project(): transactional project delete (RUN AFTER 0034)
- 0036_voltaat_sync.sql — supplier_sync_runs + voltaat_sync switch (RUN AFTER 0035; the Voltaat sync page says
  "run 0036" until then)
- 0037_restock.sql — restock weights, supplier minimum order value, receipts, restock_summary() (RUN AFTER 0036)
- 0038_ai_pricing.sql — ai_pricing setting + project_ai_charges() (RUN AFTER 0037; the Payment box on the Quote
  step stays hidden until then)
- 0039_payment_method.sql — (RUN ✔ 2026-09-29) part_orders.payment_method + set_order_payment_method() (RUN AFTER 0038; until then
  orders are placed without a recorded method but the success page still shows the chosen one)
- 0041_datasheets_and_backups.sql — (RUN ✔ 2026-09-29) parts.datasheet_url/specs/backup_for
- 0040_firmware.sql — (RUN ✔ 2026-09-29) projects.firmware + 'firmware' ai_usage/analysis_runs feature (RUN AFTER 0039)
- 0043_cad_generations.sql — (RUN ✔ 2026-10-08, confirmed by live probe) cad_generations + cad_begin/cad_set_code/cad_deliver/cad_fail, analysis_runs 'cad'
  (RUN AFTER 0042; until then the 3D model card only shows the cost dialog)
- 0044_shipping_flat_free_threshold.sql — (RUN ✔ 2026-10-08, confirmed by live probe) QAR 50 all tiers + handling 0, free_shipping_threshold (QAR 300, Standard), quote v2, create_part_order v6 (+p_payment_method; bank transfer needs email; total > 0), set_order_payment_method v2 (RUN AFTER 0043; checkout falls back to the old call until then)
- 0045_project_recovery_link.sql — (RUN ✔ 2026-10-08, confirmed by live probe) D6 project link by email: projects.contact_email/recovery_token/recovery_emailed_at (guarded), project_recovery_begin(), claim_project() (moves a GUEST project to the session holding the #key= link, key rotated, new link emailed), storage read/delete by project owner (RUN AFTER 0044; until then /projects/new skips the email and #key= links show "not available")
- 0046_notification_outbox.sql — (RUN ✔ 2026-10-08, confirmed by live probe) Phase I credit/milestone emails: notification_outbox (+ unique dedupe index) + notification_prefs (unsubscribe token), triggers on credits_ledger/projects, claim_notifications / mark_notification / notification_unsubscribe (service_role), store_settings.notifications (discount_ready OFF) (RUN AFTER 0045; until then /api/cron/notifications answers 500 claim_failed and nothing is queued)
- 0047_parts_arabic_details.sql — (RUN ✔ 2026-10-08, confirmed by live probe) Phase E1: parts.specs_ar (Arabic spec rows, same shape as specs) + parts.details_ar_at (translate marker); description_ar already exists (RUN AFTER 0046; then Dashboard → Store → Sourcing overview → "Arabic descriptions and specs" → Translate; until then /ar product pages show headings + "not translated yet" and the step answers run_0047)
- 0048_store_categories.sql — (RUN ✔ 2026-10-08, confirmed by live probe) C5: parts.store_category (nine values, check constraint) + store_category_review, store_category_rules + trigger for new products, per-SKU mapping of 1,323 published products, gift card unpublished (RUN AFTER 0047, does not depend on it; until then the store shows the old categories; afterwards press any Dashboard → Store save or wait 5 min)
- 0049_videos_bucket.sql — (RUN ✔ 2026-10-08) CC-2: public `videos` bucket (public read, super-admin write, 50 MB, mp4/webm/jpeg/vtt) for the feature videos (RUN AFTER 0048, does not depend on it; until then the video slots fall back to the poster / placeholder, nothing breaks; then `node scripts/upload-video.mjs <folder>` per clip)
- 0052_no_free_circuit.sql — (NOT RUN YET) owner 2026-10-09: credit_can_use + spend_credit replaced, every circuit costs 1 wiring credit (no free first circuit); free_wiring_used kept as the first_circuit email marker (RUN AFTER 0051; safe to re-run; until then lib/credits/server.ts applies the same rule and charges the credit itself)
- 0051_pricing_settings.sql — (RUN ✔ 2026-10-09) P1-06/P1-07: seeds store_settings.pricing_plans + service_prices with `on conflict (key) do nothing` (owner edits survive re-runs) (RUN AFTER 0050; until then /pricing, /design and /design/drawing show the identical defaults from lib/pricing/defaults.ts; after editing either row, press any Dashboard → Store save or wait 5 min)
- 0050_one_ai_price.sql — (RUN ✔ 2026-10-09) P0-05: store_settings.ai_pricing = {"per_call_qar": 20, "charging": false} so the per-call price equals the credit price (QAR 20); charging stays off (RUN AFTER 0049; until then the usage page and the admin form show the old QAR 1)
- 0042_ai_credits.sql — (RUN ✔ 2026-10-02) AI access + credits: credits_ledger, projects.status/limit, rate limits, credit RPCs,
  profiles.email sync, ai_usage_log (RUN AFTER 0041; also turn ON "Confirm email" in Supabase Auth)
- 0027_bought_units_are_owned.sql — create_part_order also sets project_items.qty_from_inventory, so units
  bought for a project stop showing as "to buy" (RUN AFTER 0026)
- 0026_electronics_feature.sql — lets ai_usage / analysis_runs record the 'electronics' feature (RUN AFTER
  0025; the owner ran an early 0025 without it — until 0026 runs, electronics-builder calls work but aren't
  metered or recorded)
- 0024_project_diagnostics.sql — analysis_runs + project_events + event triggers (RUN AFTER 0023; the
  export's raw responses and event log are empty until it runs)

## PERMANENT NOTES
- Analytics: GA4 Measurement ID G-QXVQ4H05Y7. Env var NEXT_PUBLIC_GA_MEASUREMENT_ID must be set in
  Vercel (Production / Preview / Development). Custom domain www.gestaltung360.com (point DNS at Vercel
  when ready; currently live at gestaltung.vercel.app).
- WhatsApp: primary contact channel. Env var NEXT_PUBLIC_WHATSAPP_NUMBER (digits only, e.g. 97412345678).
  NOT set yet — owner chose not to publish the number publicly until launch. Falls back to /contact.
- OWNER RULE: never sign the owner up for paid services or subscriptions.
- Supabase project: jgwuafubtmpaonsznfyw. Vercel env vars required (all 3 scopes):
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (server-only).
- Hosting: Vercel project "gestaltung" (prj_xO2xcUzSvV0Y7D0fAlqHmFcB6n5P), team "GESTALTUNG RASHWAN"
  (slug gestaltungco-7345s). GitHub repo mworkqu/gestaltung, branch main → auto-deploy.
- Node: 24.x (engines in package.json + Vercel project setting must match).
- next pinned to ^15.2.3 (CVE-2025-29927 fix).

## ENVIRONMENT NOTES (for Claude)
- This project now runs on the USER'S Windows machine (PowerShell): npm, git, next build, netlify, and vercel
  CLIs all work here. (Earlier sandbox notes about blocked npm/git no longer apply.)
- The Next.js project root is the subfolder "Gestaltung — a manufacturing marketplace and inventory platform
  for Qatar" (contains package.json + .git). The Claude Code working dir is its PARENT, so cd/Set-Location into
  the subfolder for npm/git, or pass an explicit path (e.g. `vercel --cwd <subfolder>`).
