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
  - GA4 (global): @next/third-parties <GoogleAnalytics> in app/[locale]/layout.tsx, gated on
    NEXT_PUBLIC_GA_MEASUREMENT_ID (value G-QXVQ4H05Y7; in .env.local). ADD it in Vercel (Prod/Preview/Dev).
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

## FULL BUILD SEQUENCE — STATUS SUMMARY (updated 2026-06-22)

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
| 9 | AI method auto-detection | TBD | ⬜ NEXT |

† The "original-plan Stage 7" (super admin dashboard) was built as an add-on alongside the workshop Stage 7.

## PROMPT FILES IN PROJECT ROOT
- STAGE_6A_PROMPT.md — CAD upload + GA4
- STAGE_6B_PROMPT.md — workshop dispatch + status workflow
- STAGE_PARTS_STORE_PROMPT.md — e-commerce parts store (the prompt used for Stage PS above)
- STAGE_8A_PROMPT.md — security review + conversion wins (reference; stage already done)
- STAGE_8B_PROMPT.md — upload-funnel upsells + B2B paths (reference; stage already done)

## WHAT'S NEXT — Stage 9: AI Method Auto-Detection
Currently the manufacturing method (3D printing / CNC / laser cutting / EDM) is selected manually
by the client on the job form. Stage 9 adds a rules-based suggestion engine (and optionally an
LLM call) that analyses the uploaded file extension + material + geometry hints to recommend the
best method, with the client free to override.
Prompt file: STAGE_9_AI_PROMPT.md (not yet written — create when ready to build).

## PENDING MIGRATIONS (run in order if not already done)
Check Supabase → Table Editor to confirm which tables exist before running:
- 0010_job_upsells.sql — jobs upsell columns (speed_tier, post_processing, inspection_report, job_path, production_qty_range)
- 0011_parts_store.sql — parts, part_orders, part_order_items tables + create_part_order RPC

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
