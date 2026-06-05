-- ============================================================================
-- Gestaltung — Stage 4: Auth, roles, and multi-tenant Row Level Security
-- ============================================================================
-- Run this whole file in the Supabase SQL editor (or `supabase db push`).
-- It is idempotent enough to re-run during development.
--
-- Model:
--   tenants   — a workshop or a client organisation.
--   profiles  — one row per auth.users row; carries role + tenant_id.
--   roles     — 'super_admin' (sees everything), 'workshop', 'client'
--               (each sees ONLY rows whose tenant_id == their own).
--
-- Isolation is enforced by RLS below, NOT by the API key. Reads/writes from the
-- app use the anon key + the logged-in user's JWT; these policies do the rest.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('workshop', 'client')),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'client'
               check (role in ('super_admin', 'workshop', 'client')),
  tenant_id  uuid references public.tenants (id) on delete set null,
  full_name  text,
  locale     text not null default 'en',
  created_at timestamptz not null default now()
);

create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);

-- ----------------------------------------------------------------------------
-- 2. SECURITY DEFINER helpers
-- ----------------------------------------------------------------------------
-- These read the caller's own profile. Because they are SECURITY DEFINER and
-- owned by the privileged migration role, they BYPASS RLS internally — which is
-- exactly what lets a policy ON public.profiles call them without recursing
-- back into that same policy (the classic "infinite recursion detected in
-- policy" error). search_path is pinned to '' so every name must be schema-
-- qualified, closing the usual SECURITY DEFINER search_path hole.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = 'super_admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Auto-create a profile when a new auth user signs up
-- ----------------------------------------------------------------------------
-- Runs as the table owner (SECURITY DEFINER) so the insert is not blocked by
-- RLS. full_name / locale are pulled from the sign-up metadata when present.
-- Role always defaults to 'client'; promote to super_admin / workshop manually.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, locale)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. Enable Row Level Security
-- ----------------------------------------------------------------------------

alter table public.tenants  enable row level security;
alter table public.profiles enable row level security;

-- Table-level grants: RLS narrows rows, but the role still needs base access to
-- the table at all. (Supabase usually sets these via default privileges; we
-- make them explicit.)
grant select, insert, update, delete on public.tenants  to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

grant execute on function public.current_user_role()      to authenticated, anon;
grant execute on function public.current_user_tenant_id() to authenticated, anon;
grant execute on function public.is_super_admin()         to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. Policies — profiles
-- ----------------------------------------------------------------------------
-- super_admin: every row. Everyone else: their own row, plus any profile that
-- shares their tenant_id.

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.is_super_admin()
    or id = auth.uid()
    or (
      tenant_id is not null
      and tenant_id = public.current_user_tenant_id()
    )
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_super_admin()
    or id = auth.uid()
  );

-- A user may edit their own profile; a super_admin may edit anyone. The WITH
-- CHECK mirrors USING so a user cannot move a row out from under the policy.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    public.is_super_admin()
    or id = auth.uid()
  )
  with check (
    public.is_super_admin()
    or id = auth.uid()
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 6. Policies — tenants
-- ----------------------------------------------------------------------------
-- super_admin: every tenant. workshop/client: only their own tenant row.
-- Creating/deleting tenants is reserved for super_admin.

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    public.is_super_admin()
    or id = public.current_user_tenant_id()
  );

drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants
  for update to authenticated
  using (
    public.is_super_admin()
    or id = public.current_user_tenant_id()
  )
  with check (
    public.is_super_admin()
    or id = public.current_user_tenant_id()
  );

drop policy if exists tenants_delete on public.tenants;
create policy tenants_delete on public.tenants
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- End of migration. After running:
--   • Sign up a user in the app, then promote them:
--       update public.profiles set role = 'super_admin', tenant_id = null
--       where id = (select id from auth.users where email = 'you@example.com');
--   • See CLAUDE.md / the Stage 4 test steps for the full verification path.
-- ============================================================================
