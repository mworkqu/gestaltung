-- ============================================================================
-- Gestaltung — 0070: Design Studio part library in the database (P5-15c, 2026-10-11)
-- ============================================================================
-- Run AFTER 0069. Safe to re-run. NOT RUN YET (written by Claude; the owner runs it).
--
-- WHY
-- The Studio's part library (lib/studio/library, 39 parts) lives in code, so
-- the owner cannot link store SKUs, fix a size or add a part without a deploy.
-- Every part shows "We'll source this" because storeSkus is empty everywhere.
-- This table holds the owner's edits; the app merges them over the code parts.
--
-- WHAT CHANGES
-- 1. public.studio_parts(id, data, enabled, updated_at, updated_by):
--    id   = the part id (^[a-z0-9_]+$). Same id as a code part = the owner's
--           edit REPLACES it; a new id = a new part.
--    data = one full LibraryPart as JSON (lib/studio/schema.ts). The app
--           validates every row (LibraryPartSchema + validatePart) and skips a
--           bad one, so a bad row never breaks the Studio.
--    enabled = false: the Studio ignores the row (code part back to its code
--           version; a new part is hidden).
-- 2. RLS: anon + authenticated SELECT enabled rows (the Studio reads them
--    publicly with the cookie-free client; part data has no secrets, no cost,
--    no supplier). Super admin: everything (all rows, insert, update, delete).
-- 3. Public storage bucket "studio-models" for uploaded STL meshes: public
--    read, super-admin write, 20 MB, model/stl + application/octet-stream +
--    application/sla. Layout: studio-models/<part id>/<timestamp>.stl.
--
-- Until this runs: the Studio uses the code library exactly as today, and
-- /dashboard/studio-library is read-only with "Run migration 0070 to save edits".
--
-- DRY RUN (read-only, after running):
--   select id, enabled, updated_at, data->'storeSkus' as skus from public.studio_parts order by id;
--
-- ROLLBACK (manual; the code library takes over again at once):
--   drop policy if exists studio_models_admin_write on storage.objects;
--   drop policy if exists studio_models_read on storage.objects;
--   delete from storage.objects where bucket_id = 'studio-models';
--   delete from storage.buckets where id = 'studio-models';
--   drop table if exists public.studio_parts;
-- ============================================================================

create table if not exists public.studio_parts (
  id          text primary key check (id ~ '^[a-z0-9_]+$' and length(id) <= 64),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

comment on table public.studio_parts is
  'Design Studio library parts edited/added by the owner (P5-15c). data = a full LibraryPart; same id as a code part overrides it.';

-- updated_at + updated_by on every write.
create or replace function public.studio_parts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists studio_parts_touch on public.studio_parts;
create trigger studio_parts_touch
  before insert or update on public.studio_parts
  for each row execute function public.studio_parts_touch();

alter table public.studio_parts enable row level security;

drop policy if exists studio_parts_public_read on public.studio_parts;
create policy studio_parts_public_read on public.studio_parts
  for select to anon, authenticated
  using (enabled or public.is_super_admin());

drop policy if exists studio_parts_admin_insert on public.studio_parts;
create policy studio_parts_admin_insert on public.studio_parts
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists studio_parts_admin_update on public.studio_parts;
create policy studio_parts_admin_update on public.studio_parts
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists studio_parts_admin_delete on public.studio_parts;
create policy studio_parts_admin_delete on public.studio_parts
  for delete to authenticated
  using (public.is_super_admin());

grant select on public.studio_parts to anon, authenticated;
grant insert, update, delete on public.studio_parts to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: public "studio-models" bucket for STL uploads.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'studio-models', 'studio-models', true,
  20971520, -- 20 MB
  array['model/stl', 'application/octet-stream', 'application/sla']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 20971520,
      allowed_mime_types = array['model/stl', 'application/octet-stream', 'application/sla'];

drop policy if exists studio_models_read on storage.objects;
create policy studio_models_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'studio-models');

drop policy if exists studio_models_admin_write on storage.objects;
create policy studio_models_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'studio-models' and public.is_super_admin())
  with check (bucket_id = 'studio-models' and public.is_super_admin());
