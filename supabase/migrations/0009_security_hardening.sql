-- ============================================================================
-- Gestaltung — Stage 8a: security hardening (from SECURITY_REVIEW.md)
-- ============================================================================
-- Run AFTER 0008_job_variations.sql. Closes the Critical/High findings of the
-- Stage 8a security review. All checks allow two trusted contexts through:
--   • auth.uid() IS NULL  — the SQL editor / service-role (keeps the documented
--     "promote the first super_admin by hand" bootstrap flow working), and
--   • is_super_admin()    — the platform owner.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CRITICAL: block self-service privilege escalation on profiles
-- ----------------------------------------------------------------------------
-- The Stage 4 profiles_update policy lets a user update their OWN row — but
-- nothing stopped them from setting role='super_admin' or pointing tenant_id at
-- another tenant via a direct PostgREST call with their JWT. This trigger pins
-- role + tenant_id: only the SQL editor / service-role / a super_admin may
-- change them. Sign-up still works: handle_new_user inserts role='client',
-- tenant_id=null, which the INSERT branch permits.

create or replace function public.profiles_guard_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trusted contexts: SQL editor / service-role (no JWT) or a super_admin.
  if auth.uid() is null or public.is_super_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Only an administrator can change a role or tenant';
    end if;
  else -- INSERT
    if new.role is distinct from 'client' or new.tenant_id is not null then
      raise exception 'Only an administrator can set a role or tenant';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_privileges();

-- ----------------------------------------------------------------------------
-- 2. HIGH: a tenant member must not be able to change their tenant's TYPE
-- ----------------------------------------------------------------------------
-- tenants_update lets members rename their tenant (fine) — but also allowed
-- flipping type client→workshop, which would surface the tenant in the admin's
-- "assign workshop" dropdown (a social-engineering path to other clients' CAD
-- files). Pin type the same way.

create or replace function public.tenants_guard_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_super_admin() then
    return new;
  end if;
  if new.type is distinct from old.type then
    raise exception 'Only an administrator can change a tenant type';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_guard_type on public.tenants;
create trigger tenants_guard_type
  before update on public.tenants
  for each row execute function public.tenants_guard_type();

-- ----------------------------------------------------------------------------
-- 3. HIGH: enforce the job "variation window" at the DB, not just in the app
-- ----------------------------------------------------------------------------
-- canVaryJob() gates the UI/server actions, but jobs RLS + the old trigger let
-- a client PATCH its own job's spec (quantity, method, …) at ANY status via
-- direct PostgREST — e.g. after a workshop quoted it. Mirror the rule here:
--   client   -> non-status edits only while status = 'submitted'
--   workshop -> its assigned job, any non-terminal status
--   nobody (but super_admin) edits a delivered/cancelled job.
-- This REPLACES jobs_status_transition from 0006 (the status rules at the
-- bottom are unchanged).

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

  -- Non-status edits (title/notes/quantity/…): enforce the variation window.
  if new.status is not distinct from old.status then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'This job can no longer be edited';
    end if;
    if v_role = 'client' and old.status <> 'submitted' then
      raise exception 'A client can only edit a job while it is still submitted';
    end if;
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

-- (The trigger itself already exists from 0006 and now points at the new body.)

-- ----------------------------------------------------------------------------
-- 4. HIGH: BOM writes belong to the ASSIGNED WORKSHOP only
-- ----------------------------------------------------------------------------
-- 0007 gated all job_bom writes on can_access_job(), which includes the owner
-- CLIENT — so a client could insert/delete rows in the workshop's bill of
-- materials (and thus steer the stock deduction) via direct PostgREST. Reads
-- stay open to everyone on the job; writes narrow to the assigned workshop.

create or replace function public.can_manage_job_bom(p_job_id uuid)
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
        or j.assigned_workshop_tenant_id = public.current_user_tenant_id()
      )
  );
$$;

grant execute on function public.can_manage_job_bom(uuid) to authenticated;

drop policy if exists job_bom_insert on public.job_bom;
create policy job_bom_insert on public.job_bom
  for insert to authenticated
  with check (public.can_manage_job_bom(job_id));

drop policy if exists job_bom_update on public.job_bom;
create policy job_bom_update on public.job_bom
  for update to authenticated
  using (public.can_manage_job_bom(job_id))
  with check (public.can_manage_job_bom(job_id));

drop policy if exists job_bom_delete on public.job_bom;
create policy job_bom_delete on public.job_bom
  for delete to authenticated
  using (public.can_manage_job_bom(job_id));

-- ----------------------------------------------------------------------------
-- 5. MEDIUM: variation-trail rows must name their real author
-- ----------------------------------------------------------------------------
-- job_variations_insert accepted any changed_by; a user with job access could
-- append trail entries attributed to someone else. Bind changed_by to the
-- caller's own uid.

drop policy if exists job_variations_insert on public.job_variations;
create policy job_variations_insert on public.job_variations
  for insert to authenticated
  with check (
    public.can_access_job(job_id)
    and changed_by = auth.uid()
  );
