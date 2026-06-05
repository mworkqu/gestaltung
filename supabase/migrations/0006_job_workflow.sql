-- ============================================================================
-- Gestaltung — Stage 6b: workshop dispatch + job status workflow
-- ============================================================================
-- Run AFTER 0005_jobs.sql. Adds workshop + admin access, role-aware status
-- transitions, a job_events audit trail, and a storage-read path so the
-- ASSIGNED workshop can download the client's CAD files. Reuses the Stage 4
-- helpers. No quoting/payments/notifications.
--
-- Canonical status set (replaces the 6a set):
--   submitted -> quoted -> in_production -> ready -> delivered   (+ cancelled)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Status value set
-- ----------------------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('submitted', 'quoted', 'in_production', 'ready', 'delivered', 'cancelled'));

-- ----------------------------------------------------------------------------
-- 2. Access helper now includes the assigned workshop
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
        or j.assigned_workshop_tenant_id = public.current_user_tenant_id()
      )
  );
$$;

-- Can the caller read this storage object? (client owner, assigned workshop, or
-- super_admin) — used by the storage SELECT policy so a workshop can download.
create or replace function public.can_read_cad_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_files f
    join public.jobs j on j.id = f.job_id
    where f.storage_path = p_name
      and (
        public.is_super_admin()
        or j.client_tenant_id = public.current_user_tenant_id()
        or j.assigned_workshop_tenant_id = public.current_user_tenant_id()
      )
  );
$$;

grant execute on function public.can_read_cad_object(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Storage: allow the assigned workshop to READ the client's files
-- ----------------------------------------------------------------------------
drop policy if exists cad_files_select on storage.objects;
create policy cad_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cad-files'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1] = public.current_user_tenant_id()::text
      or public.can_read_cad_object(name)
    )
  );

-- ----------------------------------------------------------------------------
-- 4. jobs RLS: workshop sees + updates its assigned rows
-- ----------------------------------------------------------------------------
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
    or assigned_workshop_tenant_id = public.current_user_tenant_id()
  );

drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
  for update to authenticated
  using (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
    or assigned_workshop_tenant_id = public.current_user_tenant_id()
  )
  with check (
    public.is_super_admin()
    or client_tenant_id = public.current_user_tenant_id()
    or assigned_workshop_tenant_id = public.current_user_tenant_id()
  );

-- ----------------------------------------------------------------------------
-- 5. job_files: assigned workshop can read (can_access_job now covers it)
-- ----------------------------------------------------------------------------
-- (policies already reference can_access_job, which we redefined above)

-- ----------------------------------------------------------------------------
-- 6. Role-aware status transitions (replaces the 6a status guard)
-- ----------------------------------------------------------------------------
create or replace function public.jobs_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text := public.current_user_role();
  v_tenant uuid := public.current_user_tenant_id();
  chain    text[] := array['submitted', 'quoted', 'in_production', 'ready', 'delivered'];
  old_idx  int;
  new_idx  int;
begin
  -- super_admin: full override (incl. assignment + any status).
  if public.is_super_admin() then
    return new;
  end if;

  -- Only super_admin may set/clear the workshop assignment.
  if new.assigned_workshop_tenant_id is distinct from old.assigned_workshop_tenant_id then
    raise exception 'Only an administrator can assign a workshop';
  end if;

  -- Non-status edits (title/notes/etc.) by an allowed tenant are fine.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Client: may cancel only an unassigned, still-submitted job they own.
  if v_role = 'client' and old.client_tenant_id = v_tenant then
    if new.status = 'cancelled'
       and old.status = 'submitted'
       and old.assigned_workshop_tenant_id is null then
      return new;
    end if;
    raise exception 'A client can only cancel an unassigned submitted job';
  end if;

  -- Workshop: may move ITS assigned job forward exactly one step in the chain.
  if v_role = 'workshop' and old.assigned_workshop_tenant_id = v_tenant then
    old_idx := array_position(chain, old.status);
    new_idx := array_position(chain, new.status);
    if old_idx is not null and new_idx is not null and new_idx = old_idx + 1 then
      return new;
    end if;
    raise exception 'Invalid status transition';
  end if;

  raise exception 'Not allowed to change job status';
end;
$$;

drop trigger if exists jobs_guard_status on public.jobs;
drop trigger if exists jobs_status_transition on public.jobs;
create trigger jobs_status_transition
  before update on public.jobs
  for each row execute function public.jobs_status_transition();

-- ----------------------------------------------------------------------------
-- 7. Audit trail: job_events
-- ----------------------------------------------------------------------------
create table if not exists public.job_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  from_status text,
  to_status   text not null,
  note        text,
  actor       uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists job_events_job_id_idx on public.job_events (job_id);

alter table public.job_events enable row level security;
grant select, insert on public.job_events to authenticated;

drop policy if exists job_events_select on public.job_events;
create policy job_events_select on public.job_events
  for select to authenticated
  using (public.can_access_job(job_id));

drop policy if exists job_events_insert on public.job_events;
create policy job_events_insert on public.job_events
  for insert to authenticated
  with check (public.can_access_job(job_id));

-- Log an event for the initial status (on insert) and every status change.
create or replace function public.jobs_log_insert_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_events (job_id, from_status, to_status, actor)
  values (new.id, null, new.status, auth.uid());
  return new;
end;
$$;

drop trigger if exists jobs_log_insert_event on public.jobs;
create trigger jobs_log_insert_event
  after insert on public.jobs
  for each row execute function public.jobs_log_insert_event();

create or replace function public.jobs_log_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.job_events (job_id, from_status, to_status, actor)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_log_status_event on public.jobs;
create trigger jobs_log_status_event
  after update on public.jobs
  for each row execute function public.jobs_log_status_event();
