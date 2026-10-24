# Stage 6a — CAD upload + job creation (paste into Claude Code)

Stage 6a — CAD upload + job creation. Build ONLY this. Do NOT build workshop assignment, the
status workflow, the admin analytics dashboard, e-commerce, or AI yet — those are Stage 6b and
later. When done, give me exact local test steps.

CONTEXT: read CLAUDE.md first. Stages 1–5 are done and live: bilingual EN/AR marketing site +
azure theme, Supabase auth with roles (super_admin | workshop | client) + multi-tenant RLS (each
tenant sees only their own tenant_id, super_admin sees all), and multi-tenant inventory CRUD.
Reuse the existing SECURITY DEFINER helpers is_super_admin() / current_user_role() /
current_user_tenant_id() and the established RLS + server-action patterns. Stack unchanged:
Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, next-intl, Supabase (Postgres + Auth +
Storage). Env vars already set locally and in Vercel — read them, never hardcode; service-role key
stays server-only.

GOAL: a client uploads a 3D/CAD file, fills in basic fields, manually picks a manufacturing
method, and creates a job. That's the whole pass — storage + data model + the client's create &
view experience, locked down by the SAME RLS model. No dispatch, no status changes yet.

DELIVER:
1. Supabase Storage: a PRIVATE bucket (e.g. "cad-files"). Access policies so a client can upload
   to / read only their own job's files, and super_admin can read all. Never make the bucket
   public; downloads are via short-lived signed URLs generated server-side.
2. SQL migration (save under /supabase/migrations, next number in sequence — 0005_*):
   - jobs table: id, client_tenant_id (NOT NULL FK -> tenants), assigned_workshop_tenant_id
     (nullable, reserved for 6b), title, notes, material, quantity (int),
     method (enum: '3d_printing' | 'cnc_machining' | 'laser_cutting' | 'edm'),
     status (enum incl. 'submitted' ... 'delivered'; default 'submitted'),
     created_at, updated_at (auto-update trigger).
   - job_files table: id, job_id (FK -> jobs), storage_path, file_name,
     file_ext (stl/step/dxf/iges), size_bytes, uploaded_at.
   - A trigger (like inventory's) that defaults/forces client_tenant_id to the caller's tenant on
     insert. Indexes on client_tenant_id.
   - Enable RLS on both. Policies: client = select/insert/update(own non-status fields)/delete on
     rows where client_tenant_id = current_user_tenant_id(); super_admin = all. (Workshop policies
     and status-transition rules come in 6b — keep this pass simple.)
3. UI under /[locale]/dashboard/jobs (role-aware, reuse the dashboard layout + nav pattern):
   - CLIENT: a "New job" form — upload one or more CAD files (validate extension
     stl/step/dxf/iges and a sane max size), enter title / material / quantity / notes, and
     manually pick the method. Submit creates the job + job_files rows and uploads to storage.
   - CLIENT: a list of their own jobs (status shown read-only as "submitted") and a job detail
     view that lists the files with signed-URL download links.
   - Empty state, plus basic loading/error states.
4. Data access via the server Supabase client in server components / server actions so RLS is
   enforced server-side. Do NOT bypass RLS with the service-role key for tenant reads/writes; use
   signed URLs for downloads.
5. Fully bilingual: all strings from messages/en.json + ar.json (add a Jobs namespace incl.
   method labels), RTL-correct in Arabic, azure theme + shadcn throughout. Add a Jobs link to the
   dashboard nav.
6. Google Analytics (GA4) site-wide tracking — this is a separate, self-contained addition; wire
   it up in this pass since it's a global concern:
   - Use the official @next/third-parties/google <GoogleAnalytics /> component (install
     @next/third-parties if not present). Render it once in the root app/[locale]/layout.tsx so
     EVERY page (marketing + dashboard, EN + AR) is tracked.
   - Read the Measurement ID from an env var NEXT_PUBLIC_GA_MEASUREMENT_ID — do NOT hardcode it in
     source. The value is G-QXVQ4H05Y7 (GA4 stream "gestaltung", stream ID 15007875857, site URL
     https://www.gestaltung360.com). Add NEXT_PUBLIC_GA_MEASUREMENT_ID to .env.local and tell me
     to add it in Vercel (Production / Preview / Development) — it's NEXT_PUBLIC_ so browser-safe.
   - Only inject the tag when the env var is set, so local dev without the var (and previews)
     don't pollute analytics. No custom events yet — just baseline pageview tracking.

CONSTRAINTS:
- Minimal and incremental: NO assignment, NO status transitions beyond the default 'submitted',
  NO quoting/pricing, NO notifications, NO AI method detection.
- Don't break existing auth, inventory, marketing pages, or the language switcher.
- No hardcoded secrets; service-role key stays server-only.

AFTER BUILDING, tell me exactly how to test locally: which SQL to run, how to create the storage
bucket + its policies, the npm command, and the precise click-path to verify (a) a client uploads
a CAD file and a job + stored file appear, (b) the client can download their file via a signed
URL, (c) a DIFFERENT client cannot see that job or file, (d) /dashboard/jobs redirects when
logged out, and (e) with NEXT_PUBLIC_GA_MEASUREMENT_ID set, the GA4 gtag.js script loads and a
collect/pageview request fires (check the browser Network tab). Then STOP and wait.
