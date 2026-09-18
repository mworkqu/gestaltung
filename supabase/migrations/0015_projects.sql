-- ============================================================================
-- Gestaltung — 0015: projects, the client workspace
-- ============================================================================
-- A project is the centre of the product. A visitor can start one without an
-- account (they get a Supabase anonymous user, so they have a real auth.uid()
-- and these policies apply to them unchanged), fill it with notes, text and
-- image blocks, materials, and items taken from the store.
--
-- KEYED ON user_id, NOT tenant_id. The tenant model belongs to the retired
-- workshop side; a self-signed-up client has no tenant at all (see FINDINGS.md
-- note 3), so tenant-scoped policies would match zero rows for exactly the
-- people this feature is for. projects.tenant_id exists, nullable and unused,
-- so team-shared projects later are a policy change rather than a migration.
--
-- WORKSHOPS SEE NOTHING HERE. No policy grants the workshop role access, so
-- with the jobs tables gone the role is fully dormant — which is the intent.
--
-- Every user_id FK is `on delete cascade` so the anonymous-user cleanup rule in
-- FINDINGS.md can reap an abandoned guest in one delete.
--
-- Run after 0014. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Reserved for team-shared projects. Never read today.
  tenant_id  uuid references public.tenants (id) on delete set null,
  name       text not null,
  -- The main input for now: the client writes what they want to build.
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id);

-- Free-form body: text paragraphs and uploaded images, in an order the client
-- controls. `position` is a plain integer the app rewrites on reorder.
create table if not exists public.project_blocks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  type         text not null check (type in ('text', 'image')),
  content      text,          -- the paragraph, for type = 'text'
  storage_path text,          -- <user_id>/<project_id>/<uuid>, for type = 'image'
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  -- A block is one thing or the other, never empty and never both.
  constraint project_blocks_shape check (
    (type = 'text'  and content is not null      and storage_path is null) or
    (type = 'image' and storage_path is not null and content is null)
  )
);

create index if not exists project_blocks_project_idx
  on public.project_blocks (project_id, position);

-- What the client wants it made of: PLA, aluminium 6061, acrylic, …
create table if not exists public.project_materials (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  material   text not null,
  created_at timestamptz not null default now(),
  unique (project_id, material)
);

-- Store items the client has added to this project. Deliberately ONE ROW PER
-- ITEM linked to public.parts, not a JSON blob: a later assistant that suggests
-- parts from a goal ("I want to make a watch") needs to write exactly these
-- rows, and reporting needs to join them.
create table if not exists public.project_items (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- restrict, not cascade: deleting a catalogue part must not silently empty
  -- someone's project. Matches part_order_items.
  product_id uuid not null references public.parts (id) on delete restrict,
  quantity   integer not null default 1 check (quantity > 0),
  note       text,
  created_at timestamptz not null default now(),
  unique (project_id, product_id)
);

create index if not exists project_items_project_idx on public.project_items (project_id);

-- ----------------------------------------------------------------------------
-- 2. updated_at
-- ----------------------------------------------------------------------------
-- Reuses the shared trigger function from 0004.

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Access helper
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so the child-table policies can ask "is this project mine?"
-- without re-entering the projects policies. search_path pinned per 0001.

create or replace function public.owns_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.projects p
     where p.id = p_project_id
       and (p.user_id = auth.uid() or public.is_super_admin())
  );
$$;

grant execute on function public.owns_project(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------

alter table public.projects          enable row level security;
alter table public.project_blocks    enable row level security;
alter table public.project_materials enable row level security;
alter table public.project_items     enable row level security;

grant select, insert, update, delete on public.projects          to authenticated;
grant select, insert, update, delete on public.project_blocks    to authenticated;
grant select, insert, update, delete on public.project_materials to authenticated;
grant select, insert, update, delete on public.project_items     to authenticated;

-- projects: your own rows; super_admin sees everything.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- The three child tables all gate on owning the parent project.
do $$
declare
  t text;
begin
  foreach t in array array['project_blocks', 'project_materials', 'project_items']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using (public.owns_project(project_id))', t);

    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated
         with check (public.owns_project(project_id))', t);

    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated
         using (public.owns_project(project_id))
         with check (public.owns_project(project_id))', t);

    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated
         using (public.owns_project(project_id))', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Private bucket for project images
-- ----------------------------------------------------------------------------
-- Paths are <user_id>/<project_id>/<uuid>. The first folder is the owner, which
-- is what the policies below check — the same shape the cad-files bucket used,
-- but keyed on the user instead of the tenant.

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-images', 'project-images', false, 10485760) -- 10 MB
on conflict (id) do nothing;

drop policy if exists project_images_select on storage.objects;
create policy project_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_super_admin()
    )
  );

drop policy if exists project_images_insert on storage.objects;
create policy project_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists project_images_delete on storage.objects;
create policy project_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_super_admin()
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Verify
-- ----------------------------------------------------------------------------

do $$
declare
  n_tables int;
  n_pol    int;
  n_bucket int;
begin
  select count(*) into n_tables from information_schema.tables
   where table_schema = 'public'
     and table_name in ('projects','project_blocks','project_materials','project_items');

  select count(*) into n_pol from pg_policies
   where schemaname = 'public'
     and tablename in ('projects','project_blocks','project_materials','project_items');

  select count(*) into n_bucket from storage.buckets where id = 'project-images';

  raise notice 'project tables: % (expected 4)', n_tables;
  raise notice 'project policies: % (expected 16)', n_pol;
  raise notice 'project-images bucket: % (expected 1)', n_bucket;

  if n_tables <> 4 or n_pol <> 16 or n_bucket <> 1 then
    raise exception 'projects migration incomplete';
  end if;
end $$;
