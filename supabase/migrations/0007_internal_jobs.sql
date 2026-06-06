-- ============================================================================
-- Gestaltung — Stage 7: workshop internal jobs + BOM + inventory deduction
-- ============================================================================
-- Run AFTER 0006_job_workflow.sql. Reuses can_access_job() / is_super_admin() /
-- current_user_tenant_id(). No service-role anywhere.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Internal jobs: source + parts list
-- ----------------------------------------------------------------------------
alter table public.jobs add column if not exists job_source text not null default 'client'
  check (job_source in ('client', 'internal'));

-- Simple parts list for internal production jobs: [{name, quantity, unit}, ...]
alter table public.jobs add column if not exists parts jsonb;

-- A workshop creating an internal job inserts it with client_tenant_id = its own
-- tenant, which the existing jobs_insert policy already permits
-- (client_tenant_id = current_user_tenant_id()). The app also self-assigns the
-- workshop (assigned_workshop_tenant_id = its tenant) so the status-transition
-- trigger lets it advance the job. No policy change needed here.

-- ----------------------------------------------------------------------------
-- 2. Stock can be fractional (kg, m, …) so deductions don't truncate
-- ----------------------------------------------------------------------------
alter table public.inventory_items
  alter column quantity type numeric(12, 2) using quantity::numeric;
alter table public.inventory_items
  alter column quantity set default 0;

-- ----------------------------------------------------------------------------
-- 3. Client-name helper (a workshop can't read other tenants via RLS)
-- ----------------------------------------------------------------------------
-- Returns the client tenant id+name for every job the caller can access, so the
-- jobs list/detail can show a real "Client" label instead of a tenant id.
create or replace function public.accessible_client_tenants()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ten.id, ten.name
  from public.tenants ten
  join public.jobs j on j.client_tenant_id = ten.id
  where public.is_super_admin()
     or j.client_tenant_id = public.current_user_tenant_id()
     or j.assigned_workshop_tenant_id = public.current_user_tenant_id();
$$;

grant execute on function public.accessible_client_tenants() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Bill of Materials: links a job to the workshop's inventory items
-- ----------------------------------------------------------------------------
create table if not exists public.job_bom (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  quantity_needed   numeric(12, 2) not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists job_bom_job_id_idx on public.job_bom (job_id);

alter table public.job_bom enable row level security;
grant select, insert, update, delete on public.job_bom to authenticated;

-- Gated by access to the parent job (covers the assigned workshop, the client,
-- and super_admin). super_admin = all via can_access_job().
drop policy if exists job_bom_select on public.job_bom;
create policy job_bom_select on public.job_bom
  for select to authenticated
  using (public.can_access_job(job_id));

drop policy if exists job_bom_insert on public.job_bom;
create policy job_bom_insert on public.job_bom
  for insert to authenticated
  with check (public.can_access_job(job_id));

drop policy if exists job_bom_update on public.job_bom;
create policy job_bom_update on public.job_bom
  for update to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

drop policy if exists job_bom_delete on public.job_bom;
create policy job_bom_delete on public.job_bom
  for delete to authenticated
  using (public.can_access_job(job_id));
