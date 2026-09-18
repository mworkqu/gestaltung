-- ============================================================================
-- Gestaltung — 0018: CAD files attached to a project
-- ============================================================================
-- A client can attach a CAD file to a project. There is no method detection, no
-- workshop dispatch and no job record — that pipeline is retired. The file is
-- stored, an inquiries row notifies the owner, and the quote is produced by
-- hand.
--
-- Reuses the existing private 'cad-files' bucket, but rescoped: paths are now
-- <user_id>/<project_id>/<uuid>-<name> rather than the old tenant folders.
-- 0013 left a super_admin-only policy on that bucket after dropping the jobs
-- policies; this replaces it with owner-or-admin access. The two legacy objects
-- still in the bucket sit under tenant-id folders that match no user, so they
-- stay reachable by the super_admin only — which is correct, and their
-- filenames are recorded in supabase/exports/0013_jobs_export.json.
--
-- Run after 0017. Safe to re-run.
-- ============================================================================

create table if not exists public.project_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  file_ext     text not null check (file_ext in ('stl', 'step', 'dxf', 'iges')),
  size_bytes   bigint,
  uploaded_at  timestamptz not null default now()
);

create index if not exists project_files_project_idx
  on public.project_files (project_id);

alter table public.project_files enable row level security;
grant select, insert, update, delete on public.project_files to authenticated;

-- Same gate as every other project child table.
drop policy if exists project_files_select on public.project_files;
create policy project_files_select on public.project_files
  for select to authenticated
  using (public.owns_project(project_id));

drop policy if exists project_files_insert on public.project_files;
create policy project_files_insert on public.project_files
  for insert to authenticated
  with check (public.owns_project(project_id));

drop policy if exists project_files_delete on public.project_files;
create policy project_files_delete on public.project_files
  for delete to authenticated
  using (public.owns_project(project_id));

-- ----------------------------------------------------------------------------
-- cad-files bucket: owner-scoped by user_id
-- ----------------------------------------------------------------------------

drop policy if exists cad_files_admin_all on storage.objects;
drop policy if exists cad_files_select    on storage.objects;
drop policy if exists cad_files_insert    on storage.objects;
drop policy if exists cad_files_delete    on storage.objects;

create policy cad_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cad-files'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_super_admin()
    )
  );

create policy cad_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cad-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy cad_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'cad-files'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_super_admin()
    )
  );

do $$
declare n_pol int; n_obj int;
begin
  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'project_files';
  select count(*) into n_obj from storage.objects where bucket_id = 'cad-files';
  raise notice 'project_files policies: % (expected 3)', n_pol;
  raise notice 'cad-files objects preserved: % (expected 2)', n_obj;
  if n_pol <> 3 then raise exception 'project_files migration incomplete'; end if;
end $$;
