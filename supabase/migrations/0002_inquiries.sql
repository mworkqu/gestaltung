-- ============================================================================
-- Gestaltung — Stage 4 follow-up: public contact inquiries
-- ============================================================================
-- Run AFTER 0001_auth_roles_rls.sql (it reuses public.is_super_admin()).
-- Captures leads from the public contact form. WhatsApp number is the primary,
-- required contact channel; email is optional. Anyone (anon) can submit; only
-- a super_admin can read/manage the submissions.
-- ============================================================================

create table if not exists public.inquiries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null,            -- WhatsApp number — how we contact back
  email      text,                     -- optional
  message    text not null,
  locale     text not null default 'en',
  status     text not null default 'new'
               check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists inquiries_created_at_idx
  on public.inquiries (created_at desc);

alter table public.inquiries enable row level security;

-- anon submits the public form; authenticated may submit too. Reading/managing
-- is reserved for super_admin (RLS narrows the broad table grants below).
grant insert on public.inquiries to anon, authenticated;
grant select, update, delete on public.inquiries to authenticated;

-- INSERT: open to anyone (public lead capture).
drop policy if exists inquiries_insert on public.inquiries;
create policy inquiries_insert on public.inquiries
  for insert to anon, authenticated
  with check (true);

-- SELECT / UPDATE / DELETE: super_admin only.
drop policy if exists inquiries_select on public.inquiries;
create policy inquiries_select on public.inquiries
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists inquiries_update on public.inquiries;
create policy inquiries_update on public.inquiries
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists inquiries_delete on public.inquiries;
create policy inquiries_delete on public.inquiries
  for delete to authenticated
  using (public.is_super_admin());
