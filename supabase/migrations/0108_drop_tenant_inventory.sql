-- Gestaltung — 0108: drop the legacy workshop/tenant inventory (consolidation 2026-11, owner decision O3).
--
-- WHY: the tenant inventory (/inventory, Stage 5, migration 0004) and its
-- workshop job BOM (job_bom, 0007) are retired. The app commit that ships with
-- this file deletes every page, action and component that read or wrote
-- inventory_items; nothing in the app touches either table any more.
-- The customer "My inventory" (client_inventory_items, 0017) is a different
-- table and is NOT touched.
--
-- WHAT (all IF EXISTS, safe to re-run):
--   * drop table public.job_bom          (0007; FK to inventory_items + jobs.
--                                         0013 may already have dropped it)
--   * drop table public.inventory_items  (0004; its policies, triggers and
--                                         indexes go with it)
--   * drop function public.inventory_default_tenant()  (0004; only the
--     inventory_items insert trigger used it). Dropped only when nothing
--     depends on it any more.
-- KEPT on purpose:
--   * public.tenants and profiles.tenant_id (owner: untouched).
--   * public.current_user_tenant_id() — the live profiles / tenants policies
--     from 0001 call it.
--   * public.current_user_role() — checked here, dropped (if ever) by 0109,
--     after the jobs functions that call it are gone.
--   * public.set_updated_at() — shared by many tables.
--
-- PRODUCTION ROW COUNTS WERE NOT CHECKED (Claude cannot read production).
-- BEFORE RUNNING: if inventory_items or job_bom holds anything you want to
-- keep, export it first (Supabase -> Table Editor -> the table -> Export CSV),
-- or run:
--   select count(*) from public.inventory_items;
--   select count(*) from public.job_bom;      -- may say "does not exist" (0013)
--
-- BEFORE IT RUNS the app no longer reads either table, so running it late is
-- harmless. Run it AFTER the app commit is deployed (the old /inventory pages
-- would error once the table is gone).
--
-- Run AFTER 0107. Safe to re-run.
--
-- Rollback (structure only; rows come back only from your export):
--   re-run supabase/migrations/0004_inventory_items.sql (creates the table,
--   its triggers, inventory_default_tenant() and the RLS policies), then
--   `alter table public.inventory_items alter column quantity type numeric(12,2);`
--   (the 0007 widening) and re-import the exported CSV. job_bom belonged to the
--   jobs pipeline already retired by 0013; it is not restored.

-- 1. Tables. job_bom first: it references inventory_items. Dropping a table
--    takes its own policies, triggers, indexes and constraints with it.
drop table if exists public.job_bom;
drop table if exists public.inventory_items;

-- 2. The inventory-only trigger function, only when nothing still uses it
--    (no trigger / policy / view dependency, no other function body naming it).
do $$
declare
  fn regprocedure := to_regprocedure('public.inventory_default_tenant()');
begin
  if fn is null then
    return;
  end if;
  if exists (select 1 from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.refobjid = fn and d.deptype = 'n')
     or exists (select 1 from pg_proc p where p.oid <> fn and p.prosrc ilike '%inventory_default_tenant%') then
    raise notice '0108: kept public.inventory_default_tenant(): something still refers to it';
  else
    drop function public.inventory_default_tenant();
  end if;
end $$;

-- 3. Verify.
do $$
begin
  if to_regclass('public.inventory_items') is not null or to_regclass('public.job_bom') is not null then
    raise exception '0108: inventory_items / job_bom still present';
  end if;
  if to_regclass('public.client_inventory_items') is null then
    raise notice '0108: client_inventory_items not found (this file never touches it)';
  end if;
end $$;
