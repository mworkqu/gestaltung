-- ============================================================================
-- Gestaltung — Stage 6a: CAD upload + job creation
-- ============================================================================
-- Run AFTER 0001_auth_roles_rls.sql (reuses is_super_admin() /
-- current_user_tenant_id() and the shared set_updated_at()). Creates the
-- private CAD storage bucket + its policies, plus the jobs and job_files tables
-- with the same multi-tenant RLS model. No workshop assignment / status
-- transitions yet (Stage 6b).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Private storage bucket for CAD files
-- ----------------------------------------------------------------------------
-- Files live under  <client_tenant_id>/<group>/<filename>  so the first path
-- segment identifies the owning tenant for RLS. NEVER public; downloads use
-- short-lived signed URLs generated server-side.
insert into storage.buckets (id, name, public, file_size_limit)
values ('cad-files', 'cad-files', false, 52428800) -- 50 MB
on conflict (id) do nothing;

-- Storage object policies, scoped to the cad-files bucket. A tenant may only
-- touch objects whose first folder equals their tenant_id; super_admin: all.
drop policy if exists cad_files_select on storage.objects;
create policy cad_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cad-files'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  );

drop policy if exists cad_files_insert on storage.objects;
create policy cad_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cad-files'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  );

drop policy if exists cad_files_delete on storage.objects;
create policy cad_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'cad-files'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.jobs (
  id                          uuid primary key default gen_random_uuid(),
  client_tenant_id            uuid not null references public.tenants (id) on delete cascade,
  assigned_workshop_tenant_id uuid references public.tenants (id) on delete set null, -- reserved for 6b
  title                       text not null,
  notes                       text,
  material                    text,
  quantity                    integer not null default 1,
  method                      text not null
                                check (method in ('3d_printing', 'cnc_machining', 'laser_cutting', 'edm')),
  status                      text not null default 'submitted'
                                check (status in ('submitted', 'in_review', 'assigned',
                                                  'in_production', 'completed', 'delivered', 'cancelled')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists jobs_client_tenant_id_idx on public.jobs (client_tenant_id);
create index if not exists jobs_assigned_workshop_idx on public.jobs (assigned_workshop_tenant_id);

create table if not exists public.job_files (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  file_ext     text not null check (file_ext in ('stl', 'step', 'dxf', 'iges')),
  size_bytes   bigint,
  uploaded_at  timestamptz not null default now()
);

create index if not exists job_files_job_id_idx on public.job_files (job_id);

-- ----------------------------------------------------------------------------
-- 3. Triggers
-- ----------------------------------------------------------------------------

-- Keep updated_at fresh (set_updated_at() defined in 0004).
drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Default client_tenant_id to the caller's tenant when omitted.
create or replace function public.jobs_default_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_tenant_id is null then
    new.client_tenant_id := public.current_user_tenant_id();
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_default_tenant on public.jobs;
create trigger jobs_default_tenant
  before insert on public.jobs
  for each row execute function public.jobs_default_tenant();

-- Status is admin-only territory (6b owns transitions). Block non-super_admin
-- from changing status, so a client editing their own job can't tamper with it.
create or replace function public.jobs_guard_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (not public.is_super_admin()) and new.status is distinct from old.status then
    raise exception 'Only an administrator can change job status';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_guard_status on public.jobs;
create trigger jobs_guard_status
  before update on public.jobs
  for each row execute function public.jobs_guard_status();

-- ----------------------------------------------------------------------------
-- 4. Helper for job_files policies (SECURITY DEFINER → no recursion)
-- ----------------------------------------------------------------------------

create or replace function public.can_access_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and (
        public.is_super_admin()
        or j.client_tenant_id = public.current_user_tenant_id()
      )
  );
$$;

grant execute on function public.can_access_job(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.jobs       enable row level security;
alter table public.job_files  enable row level security;

grant select, insert, update, delete on public.jobs       to authenticated;
grant select, insert, update, delete on public.job_files  to authenticated;

-- jobs: client sees/owns its own; super_admin all. (Workshop policies = 6b.)
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
  );

drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs
  for insert to authenticated
  with check (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
  );

drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
  for update to authenticated
  using (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
  )
  with check (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
  );

drop policy if exists jobs_delete on public.jobs;
create policy jobs_delete on public.jobs
  for delete to authenticated
  using (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
  );

-- job_files: gated by access to the parent job.
drop policy if exists job_files_select on public.job_files;
create policy job_files_select on public.job_files
  for select to authenticated
  using (public.can_access_job(job_id));

drop policy if exists job_files_insert on public.job_files;
create policy job_files_insert on public.job_files
  for insert to authenticated
  with check (public.can_access_job(job_id));

drop policy if exists job_files_delete on public.job_files;
create policy job_files_delete on public.job_files
  for delete to authenticated
  using (public.can_access_job(job_id));
