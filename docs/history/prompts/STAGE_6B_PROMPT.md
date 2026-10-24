# Stage 6b — Dispatch + status workflow (paste into Claude Code AFTER 6a is done & tested)

Stage 6b — Workshop dispatch + job status workflow. Build ONLY this. Stage 6a (CAD upload + job
creation + storage) is already done and tested. Do NOT build the admin analytics dashboard,
e-commerce, or AI yet. When done, give me exact local test steps.

CONTEXT: read CLAUDE.md first. Stages 1–5 + Stage 6a are done and live: bilingual EN/AR site +
azure theme, Supabase auth with roles (super_admin | workshop | client) + multi-tenant RLS,
inventory CRUD, and the jobs + job_files tables with a PRIVATE "cad-files" storage bucket where a
client creates jobs (method picked manually; status defaults to 'submitted'). Reuse the existing
SECURITY DEFINER helpers is_super_admin() / current_user_role() / current_user_tenant_id() and the
established RLS + server-action + signed-URL patterns. Stack unchanged. Env vars already set;
service-role key stays server-only.

GOAL: turn the static job into a dispatched, tracked workflow across three roles — super_admin
assigns a job to a workshop, the assigned workshop advances its status, and the client tracks it
through to delivered.

DELIVER:
1. SQL migration (save under /supabase/migrations, next number in sequence — 0006_*):
   - Add the workshop + admin RLS policies on jobs (and job_files read) that 6a deliberately left
     out: workshop sees/updates ONLY rows where assigned_workshop_tenant_id =
     current_user_tenant_id() (status update + file read, NO reassignment); super_admin = full
     access incl. setting assigned_workshop_tenant_id.
   - Enforce allowed status transitions per role (e.g. via a trigger or a CHECK on a transition
     function): submitted → quoted → in_production → ready → delivered; client may cancel before
     assignment; workshop moves assigned jobs forward only; super_admin may override.
   - Optional job_events audit table: id, job_id, from_status, to_status, note, actor (profile id),
     created_at — one row per status change, RLS-readable by the job's client, its assigned
     workshop, and super_admin.
2. UI additions under /[locale]/dashboard/jobs (role-aware):
   - SUPER_ADMIN: list of ALL jobs across tenants with filters (status, tenant); on a job detail,
     assign a workshop (dropdown of workshop tenants) and override status.
   - WORKSHOP: list of jobs assigned to them ONLY; detail view to download the CAD files
     (signed URL) and advance status through their allowed transitions.
   - CLIENT: their existing job views now show the live status + a simple status timeline
     (from job_events if built).
3. All tenant reads/writes go through the server Supabase client so RLS enforces isolation — no
   service-role bypass for tenant data; signed URLs for downloads.
4. Fully bilingual: extend the Jobs namespace in messages/en.json + ar.json with status labels +
   assignment UI strings, RTL-correct, azure theme + shadcn.

CONSTRAINTS:
- Minimal: NO quoting/pricing engine, NO payments, NO email/WhatsApp notifications, NO AI method
  detection (Stage 9). Method stays the value chosen in 6a.
- Don't break Stage 6a, auth, inventory, marketing pages, or the language switcher.

AFTER BUILDING, tell me exactly how to test locally: which SQL to run, the npm command, and the
precise click-path to verify (a) super_admin sees a submitted job and assigns a workshop, (b) that
workshop — and ONLY that workshop — sees the job, downloads the file, and advances status,
(c) a different workshop and a different client cannot see it, (d) the client sees status update
through to delivered, (e) an illegal status transition is rejected. Then STOP and wait.
