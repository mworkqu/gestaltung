-- ============================================================================
-- Gestaltung — 0013: retire the jobs pipeline
-- ============================================================================
-- The CAD job -> workshop dispatch -> status workflow -> BOM pipeline is
-- cancelled. The platform is now projects + the store. The application layer
-- was removed in the preceding commit; this drops the database objects.
--
-- DATA: every row was exported to supabase/exports/0013_jobs_export.json
-- before this ran (5 jobs, 2 job_files, 8 job_events, 1 job_bom, 0
-- job_variations). Do not run this without that file.
--
-- DELIBERATELY KEPT:
--   * the private 'cad-files' bucket AND its 2 objects — project file
--     attachments will reuse it, rescoped to <user_id>/… paths. Its old
--     tenant-path policies go, because they call can_read_cad_object(), which
--     this migration drops; a super_admin-only policy replaces them so the
--     files stay reachable in the meantime.
--   * inventory_items (and the numeric(12,2) quantity widening from 0007)
--   * profiles_guard_privileges() and tenants_guard_type() from 0009 — those
--     are the privilege-escalation guards, nothing to do with jobs
--   * set_updated_at(), is_super_admin(), current_user_role(),
--     current_user_tenant_id()
--   * the 'workshop' role value — kept but dormant. With these tables gone it
--     has zero rows visible anywhere, which is the intended end state.
--
-- Everything is guarded with `if exists` so the file is safe to re-run.
-- Run this in the Supabase SQL editor (or `supabase db push`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Storage policies on the 'cad-files' bucket
-- ----------------------------------------------------------------------------
-- These must go first: cad_files_select depends on can_read_cad_object(), and
-- the tenant-path model they encode is being replaced by user_id paths. The
-- bucket and its objects are untouched.

drop policy if exists cad_files_select on storage.objects;
drop policy if exists cad_files_insert on storage.objects;
drop policy if exists cad_files_delete on storage.objects;

-- Interim access: owner-only, until project attachments rescope this bucket.
-- Without at least one policy the objects would be unreachable by anyone.
create policy cad_files_admin_all on storage.objects
  for all
  to authenticated
  using (bucket_id = 'cad-files' and public.is_super_admin())
  with check (bucket_id = 'cad-files' and public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 2. Tables, in foreign-key order
-- ----------------------------------------------------------------------------
-- Dropping a table takes its policies, triggers, indexes and constraints with
-- it, so those need no separate statements. job_bom references inventory_items,
-- which survives; dropping job_bom does not touch it.

drop table if exists public.job_variations cascade;
drop table if exists public.job_bom        cascade;
drop table if exists public.job_events     cascade;
drop table if exists public.job_files      cascade;
drop table if exists public.jobs           cascade;

-- ----------------------------------------------------------------------------
-- 3. Functions
-- ----------------------------------------------------------------------------
-- Dropped after the tables so no policy or trigger still depends on them.

drop function if exists public.can_access_job(uuid);
drop function if exists public.can_read_cad_object(text);
drop function if exists public.can_manage_job_bom(uuid);
drop function if exists public.accessible_client_tenants();
drop function if exists public.jobs_default_tenant();
drop function if exists public.jobs_guard_status();
drop function if exists public.jobs_status_transition();
drop function if exists public.jobs_log_insert_event();
drop function if exists public.jobs_log_status_event();

-- ----------------------------------------------------------------------------
-- 4. Verify
-- ----------------------------------------------------------------------------
-- Expect: 0 jobs tables, 0 jobs functions, 1 policy on the cad-files bucket,
-- and the 2 stored objects still present.

do $$
declare
  n_tables int;
  n_funcs  int;
  n_files  int;
begin
  select count(*) into n_tables
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('jobs','job_files','job_events','job_bom','job_variations');

  select count(*) into n_funcs
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('can_access_job','can_read_cad_object','can_manage_job_bom',
                       'accessible_client_tenants','jobs_default_tenant','jobs_guard_status',
                       'jobs_status_transition','jobs_log_insert_event','jobs_log_status_event');

  select count(*) into n_files from storage.objects where bucket_id = 'cad-files';

  raise notice 'jobs tables remaining: % (expected 0)', n_tables;
  raise notice 'jobs functions remaining: % (expected 0)', n_funcs;
  raise notice 'cad-files objects preserved: % (expected 2)', n_files;

  if n_tables <> 0 or n_funcs <> 0 then
    raise exception 'jobs pipeline not fully removed';
  end if;
end $$;
