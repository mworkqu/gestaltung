-- Gestaltung — 0109: drop whatever is left of the retired jobs pipeline (consolidation 2026-11, owner decision O4).
--
-- WHY: the CAD job -> workshop dispatch pipeline (0005-0010) was retired in the
-- app long ago; next.config.mjs keeps 308 redirects from every old jobs URL to
-- /design/quote. 0013_drop_jobs.sql already drops all of it, but its run status
-- was never recorded (docs/MIGRATIONS.md: "No record"). This file makes the end
-- state certain either way: on a database where 0013 ran it changes nothing.
-- The live "engineering jobs" queue (engineering_jobs, 0091) is a DIFFERENT
-- table and is not touched.
--
-- WHAT (all IF EXISTS, safe to re-run):
--   * tables job_variations, job_bom, job_events, job_files, jobs — their own
--     policies, triggers and indexes go with them.
--   * the helper functions of the pipeline: jobs_default_tenant(),
--     jobs_guard_status(), jobs_status_transition(), jobs_log_insert_event(),
--     jobs_log_status_event(), can_access_job(uuid), can_manage_job_bom(uuid),
--     accessible_client_tenants(), can_read_cad_object(text), and the role
--     helper current_user_role() (0001; only the jobs functions called it).
--     Each function is dropped ONLY when no policy, trigger, view or other
--     function still refers to it; otherwise it is left and a NOTICE names it.
--
-- STORAGE: the cad-files bucket and its objects are NOT touched. Its live
-- policies (cad_files_select / _insert / _delete from 0018, *_by_project from
-- 0045) are owner-scoped by user_id / project and call neither
-- can_read_cad_object() nor can_access_job(). If a database still had the old
-- 0006 tenant-path policy (0013 and 0018 never ran), step 0 stops the file
-- before it changes anything and names the policy; no storage policy is
-- rewritten here.
--
-- PRODUCTION ROW COUNTS WERE NOT CHECKED (Claude cannot read production).
-- 0013's header says every job row was exported to
-- supabase/exports/0013_jobs_export.json before it ran. If 0013 never ran and
-- any of these tables still exists, export it first (Table Editor -> Export
-- CSV) if it holds anything you want, e.g.:
--   select to_regclass('public.jobs'), to_regclass('public.job_files'),
--          to_regclass('public.job_events'), to_regclass('public.job_bom'),
--          to_regclass('public.job_variations');   -- all null = nothing to drop
--
-- Run AFTER 0108. Safe to re-run.
--
-- Rollback: none in practice — the app has had no jobs code since 0013. To
-- re-create the structure, re-run 0005, 0006, 0007, 0008, 0009 (job parts only)
-- and 0010 in order on a scratch database and restore rows from the export.

-- 0. Safety stop: if a policy OUTSIDE the jobs tables still calls a jobs
--    helper (e.g. the 0006 tenant-path cad_files_select, on a database where
--    neither 0013 nor 0018 ran), dropping the tables would make that policy
--    fail at query time. Abort with a clear message instead of breaking the
--    bucket; nothing is changed in that case.
do $$
declare
  hit text;
begin
  select string_agg(format('%s on %s', pol.polname, pol.polrelid::regclass), ', ')
    into hit
    from pg_depend d
    join pg_policy pol on d.classid = 'pg_policy'::regclass and pol.oid = d.objid
   where d.refclassid = 'pg_proc'::regclass
     and d.refobjid in (
       select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('can_access_job', 'can_read_cad_object', 'can_manage_job_bom', 'accessible_client_tenants'))
     and pol.polrelid not in (
       select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('jobs', 'job_files', 'job_events', 'job_bom', 'job_variations'));
  if hit is not null then
    raise exception '0109 stopped, nothing changed: % still call(s) a jobs helper. Run 0018_project_files.sql (owner-scoped cad-files policies) first.', hit;
  end if;
end $$;

-- 1. Tables, children first. Dropping a table takes its own policies,
--    triggers, indexes and constraints with it (job_bom is normally already
--    gone through 0013 or 0108).
drop table if exists public.job_variations;
drop table if exists public.job_bom;
drop table if exists public.job_events;
drop table if exists public.job_files;
drop table if exists public.jobs;

-- 2. Helper functions, each only when nothing refers to it any more: no
--    policy / trigger / view / default (pg_depend) and no other function body
--    naming it (plpgsql bodies are not tracked in pg_depend). The list is in
--    dependency order: the trigger and helper functions that call
--    current_user_role() / can_access_job() go first, so a second pass is
--    never needed.
do $$
declare
  sig text;
  fn regprocedure;
  fname text;
begin
  foreach sig in array array[
    'public.jobs_default_tenant()',
    'public.jobs_guard_status()',
    'public.jobs_status_transition()',
    'public.jobs_log_insert_event()',
    'public.jobs_log_status_event()',
    'public.can_manage_job_bom(uuid)',
    'public.accessible_client_tenants()',
    'public.can_read_cad_object(text)',
    'public.can_access_job(uuid)',
    'public.current_user_role()'
  ] loop
    fn := to_regprocedure(sig);
    continue when fn is null;
    select p.proname into fname from pg_proc p where p.oid = fn;
    if exists (select 1 from pg_depend d
                where d.refclassid = 'pg_proc'::regclass and d.refobjid = fn and d.deptype = 'n')
       or exists (select 1 from pg_proc p
                   where p.oid <> fn and p.prosrc ~* ('\m' || fname || '\M')) then
      raise notice '0109: kept % (something still refers to it)', sig;
    else
      execute format('drop function %s', fn);
    end if;
  end loop;
end $$;

-- 3. Verify: no jobs table is left.
do $$
begin
  if to_regclass('public.jobs') is not null or to_regclass('public.job_files') is not null
     or to_regclass('public.job_events') is not null or to_regclass('public.job_bom') is not null
     or to_regclass('public.job_variations') is not null then
    raise exception '0109: a jobs table is still present';
  end if;
end $$;
