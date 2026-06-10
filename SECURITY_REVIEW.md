# Security Review — Stage 8A (2026-06-10)

Scope: auth & session handling, server actions, RLS migrations 0001–0008, dependency
hygiene. Every Critical and High finding below has been **fixed in this stage** —
code fixes are already in the source tree; the DB fixes live in
`supabase/migrations/0009_security_hardening.sql`, which **must be run in the
Supabase SQL editor** (after 0008) for the Critical/High DB findings to be closed
in production.

---

## Critical — must fix before next deploy

### C1. Privilege escalation: any user can promote themselves to super_admin
- **Where:** `supabase/migrations/0001_auth_roles_rls.sql:158-168` (`profiles_update`
  policy) together with the table-wide `GRANT UPDATE` at line 124.
- **What:** The update policy only checks `id = auth.uid()`. Nothing restricted *which
  columns* a user may change on their own profile, so any authenticated user could call
  PostgREST directly (`PATCH /rest/v1/profiles?id=eq.<own-id>` with the public anon key +
  their own JWT) and set `role = 'super_admin'` — full platform takeover — or set
  `tenant_id` to another tenant's id, joining that tenant and reading its inventory,
  jobs, and CAD files through every tenant-scoped policy.
- **Fix (applied):** `0009_security_hardening.sql` §1 adds a `profiles_guard_privileges`
  BEFORE INSERT/UPDATE trigger: non-admin JWT callers can never change `role` or
  `tenant_id` (inserts are pinned to `role='client', tenant_id=null`). The SQL-editor /
  service-role path (`auth.uid() IS NULL`) stays open so the documented "promote the
  first super_admin by hand" bootstrap still works. **RUN 0009 in Supabase.**

## High — fix this stage

### H1. `startJob` deducts inventory on every call (double deduction)
- **Where:** `app/[locale]/dashboard/jobs/actions.ts` (`startJob`).
- **What:** The action deducted BOM quantities *before* advancing the job, and the
  status update used `.eq("status", "submitted")` — which matches 0 rows on a repeat
  call and returns **no error**. So calling `startJob` twice (double-click, retry,
  or a direct invocation) deducted the workshop's stock twice and still reported
  success. There was also no role check: any user with job access could attempt it.
- **Fix (applied):** The action now (1) requires the caller to be a workshop, (2)
  advances `submitted → quoted` FIRST as a compare-and-set
  (`.eq("status","submitted").eq("assigned_workshop_tenant_id", …).select("id")`) and
  aborts unless exactly that row was updated, and (3) only then deducts stock. The CAS
  can only succeed once per job, so the deduction can never run twice.

### H2. Clients can write the workshop's Bill of Materials
- **Where:** `supabase/migrations/0007_internal_jobs.sql:71-90` (`job_bom` policies).
- **What:** All four `job_bom` policies used `can_access_job()`, which includes the
  *owner client*. A client could insert, edit, or delete BOM rows on their own job via
  direct PostgREST — steering which materials (and how much) get deducted from the
  workshop's stock when the job starts.
- **Fix (applied):** `0009` §4 adds `can_manage_job_bom()` (assigned workshop or
  super_admin only) and rebinds the INSERT/UPDATE/DELETE policies to it. SELECT stays
  on `can_access_job()` so the client can still *view* the BOM. **RUN 0009.**

### H3. Job edit window enforced only in the app, not in the database
- **Where:** `supabase/migrations/0006_job_workflow.sql` (`jobs_status_transition`)
  vs. `lib/jobs/constants.ts` (`canVaryJob`).
- **What:** `canVaryJob` says a client may edit a job only while `submitted` — but that
  rule lived only in the server actions. The jobs RLS + trigger allowed any non-status
  edit by the owner at ANY status, so a client could PATCH quantity/method/material
  directly *after* the workshop quoted the job (a quote-bait-and-switch), with no
  variation-trail entry.
- **Fix (applied):** `0009` §3 redefines `jobs_status_transition` to also gate
  non-status edits: terminal jobs (`delivered`/`cancelled`) are immutable for
  non-admins, and clients can only edit while `submitted`. **RUN 0009.**

### H4. Open-redirect vector via the `locale` hidden form field
- **Where:** `app/[locale]/dashboard/inventory/actions.ts` (all three actions).
- **What:** `locale` was read raw from `formData` and interpolated into
  `redirect(\`/${locale}/sign-in\`)`. A crafted value like `/evil.example` yields
  `//evil.example/sign-in` — a protocol-relative external redirect. (Exploitability is
  limited by Next's same-origin checks on server actions, but the sink is real; the
  jobs actions already sanitized their locale.) An arbitrary value also reached
  `getTranslations({ locale })`, causing a 500.
- **Fix (applied):** New `safeLocale()` helper pins the value to `"en" | "ar"` in
  `createItem`, `updateItem`, and `deleteItem`.

### H5. A tenant member can re-type their tenant as a workshop
- **Where:** `supabase/migrations/0001_auth_roles_rls.sql:194-204` (`tenants_update`).
- **What:** Members may update their own tenant row (renaming is fine), but the policy
  also allowed changing `type` from `client` to `workshop`. That surfaces the tenant in
  the super admin's "assign workshop" dropdown — a social-engineering path to being
  assigned other clients' jobs and downloading their CAD files.
- **Fix (applied):** `0009` §2 adds a `tenants_guard_type` trigger: only the SQL
  editor / service-role / super_admin may change `tenants.type`. **RUN 0009.**

## Medium — fix next stage

### M1. Variation-trail entries can be forged (partially fixed in 0009)
- **Where:** `supabase/migrations/0008_job_variations.sql` (`job_variations_insert`).
- **What:** Any user with job access could insert arbitrary trail rows, including a
  `changed_by` pointing at someone else. `0009` §5 now binds `changed_by = auth.uid()`,
  but the `changes` payload itself is still free-form; if the trail ever becomes
  contractual, write it from a DB trigger instead of the app.

### M2. Inventory deduction is read-modify-write, not atomic
- **Where:** `app/[locale]/dashboard/jobs/actions.ts` (`startJob` deduction loop).
- **What:** Stock is read, decremented in JS, and written back per item. Two jobs
  starting concurrently that share a material can lose one deduction. H1's CAS removes
  the same-job double deduction; cross-job races remain. Recommended: a single
  SQL/RPC `update … set quantity = greatest(0, quantity - $needed)` per row.

### M3. Public `inquiries` insert is unbounded
- **Where:** `supabase/migrations/0002_inquiries.sql:33-36` (`with check (true)` for
  `anon`).
- **What:** Anyone can insert unlimited rows of unlimited length — spam/DB-bloat. Add
  CHECK length constraints (e.g. `char_length(message) <= 2000`), and consider a
  captcha or rate limit (Supabase Edge Function or Vercel middleware) before launch
  marketing drives traffic.

### M4. Dependency advisories (no HIGH/CRITICAL; 3 MODERATE)
- `npm audit --audit-level=high` → **0 high/critical findings.** Moderates:
  - `next-intl@3.26.5` — open redirect (GHSA-8f24-v5vv-gm5j) + prototype pollution via
    `experimental.messages.precompile` (GHSA-4c35-wcg5-mm9h; we don't use that
    experimental flag). Fix requires next-intl 4.x — a breaking upgrade; plan it as its
    own task.
  - `next@15.5.18` — flagged only for its bundled `postcss` (XSS in stringified CSS
    output, GHSA-qx2v-qp2m-jg93); not reachable in this app's usage. Track Next patch
    releases. (Note: 15.5.18 is well past the CVE-2025-29927 middleware-bypass floor.)

### M5. No security headers configured
- **Where:** `next.config.mjs` / `vercel.json`.
- **What:** No `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`,
  `Referrer-Policy`, or `X-Content-Type-Options`. Add a `headers()` block in
  `next.config.mjs` next stage (HSTS is already handled by Vercel).

## Info — notes / best practice

- **Auth architecture is sound:** every `/dashboard/*` page AND the shared
  `dashboard/layout.tsx` calls `getSessionContext()` → `supabase.auth.getUser()`
  (server-validated, never `getSession()`); all are `force-dynamic`; there is no
  `cache: 'force-cache'` (or any caching) on auth reads. Defense is server-side
  redirects + RLS, not UI hiding. Middleware composes next-intl + `updateSession`
  correctly and no-ops safely when env is missing.
- **Server actions:** all 11 actions use the server client (`lib/supabase/server.ts`,
  anon key + cookies); the **service-role key is not used anywhere in app code**
  (verified by grep). Input validation exists on every write path. Since the
  `SUPABASE_SERVICE_ROLE_KEY` env var is unused, consider deleting it from Vercel to
  shrink the blast radius of an env leak.
- **RLS hygiene:** all SECURITY DEFINER functions pin `search_path = ''`; no
  `USING (true)` exists on any sensitive table (the only `with check (true)` is the
  intentional public `inquiries` insert, see M3). Storage bucket `cad-files` is
  private; downloads use 60-second signed URLs; upload paths are validated
  server-side to start with the caller's own `tenant_id/` (defense-in-depth on top of
  the storage RLS).
- **Client-role inventory access at the DB level is deliberate** (CLAUDE.md Stage 7):
  the nav link is hidden but RLS still scopes any direct access to their own tenant.
- **Password policy** is Supabase's default minimum (6 chars). Consider raising to 8+
  in Supabase Auth settings.
- `.env.local` is gitignored (`.env*`) and contains no secrets beyond a short-lived
  Vercel OIDC token; Supabase keys ship only via Vercel env vars. ✔

---

## Deployment note

**Action required by the owner:** run `supabase/migrations/0009_security_hardening.sql`
in the Supabase SQL editor (after 0008). C1, H2, H3, H5, and the M1 tightening are not
live until it runs. The code fixes (H1, H4) deploy with this commit.
