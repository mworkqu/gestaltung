-- ============================================================================
-- Gestaltung — 0020: prototyping
-- ============================================================================
-- Prototyping is the assisted route from a rough idea to something we can
-- quote and make: a brief, what the assistant understood from it, a part
-- breakdown with a material and a process per part, and 2D schematics.
--
-- It sits BESIDE the existing project workspace (notes, blocks, materials,
-- store items) rather than replacing it — /projects/<id> is unchanged, and
-- /projects/<id>/prototyping is the new area. Both read the same projects row.
--
-- NO AI SERVICE IS CALLED. Every suggestion these tables hold is produced by
-- the deterministic rules engine in lib/prototyping/, which costs nothing to
-- run. The columns (confidence, ai_material, ai_process, source) are shaped so
-- a real model can replace the engine later without a migration.
--
-- CAD IS STILL A SERVICE. We generate 2D schematics only; STEP/STL geometry
-- stays with the human drawing service at /design/drawing.
--
-- Keyed on the owning project, like every other project child table, and gated
-- by public.owns_project() from 0015 — so a guest (anonymous auth user) owns
-- their prototyping work exactly as they own their project.
--
-- Run after 0019. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Prototyping state on the project itself
-- ----------------------------------------------------------------------------
-- `brief` is the prototyping input and is deliberately NOT projects.notes:
-- notes is the client's own scratch pad on the existing workspace, and
-- overloading it would make every saved note re-trigger an analysis.
--
-- `stages` is a small jsonb map, stage id -> 'locked' | 'needs' | 'progress' |
-- 'complete'. A table would buy nothing: the stage list is a fixed, ordered,
-- app-level concept, never queried across projects and always read whole.

alter table public.projects
  add column if not exists brief  text,
  add column if not exists stage  text not null default 'idea',
  add column if not exists stages jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. What the assistant understood
-- ----------------------------------------------------------------------------
-- One row per claim. The client confirms or corrects each one; nothing is ever
-- applied silently, which is why `status` starts at 'pending' and the original
-- wording survives in `original_text` after a correction.

create table if not exists public.project_claims (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  text          text not null,
  -- Who wrote the current wording. 'engine' rows came from lib/prototyping.
  source        text not null default 'engine' check (source in ('engine', 'user')),
  status        text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'corrected', 'dismissed')),
  -- Kept when the client rewrites a claim, so the UI can show what we'd assumed.
  original_text text,
  -- 0–100. The rules engine's own score, not a probability.
  confidence    integer not null default 50 check (confidence between 0 and 100),
  -- A guess the engine made that the brief never stated. Surfaced differently.
  is_assumption boolean not null default false,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists project_claims_project_idx
  on public.project_claims (project_id, position);

-- ----------------------------------------------------------------------------
-- 3. The part breakdown
-- ----------------------------------------------------------------------------
-- material and process are plain text keys validated in the app against
-- lib/prototyping/constants.ts, NOT a check constraint or an enum: the process
-- list grows (PCB manufacturing was added the day this migration was written)
-- and a new material must not need a migration to appear.
--
-- ai_material / ai_process record what was suggested, so "you changed this"
-- and "revert to the suggestion" work after any number of edits.

create table if not exists public.project_parts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- Human-facing code, unique within the project: P-01, P-02, …
  code        text not null,
  name        text not null,
  description text,
  quantity    integer not null default 1 check (quantity > 0),
  material    text,
  process     text,
  status      text not null default 'suggested'
                check (status in ('suggested', 'confirmed', 'edited', 'added')),
  confidence  integer not null default 0 check (confidence between 0 and 100),
  ai_material text,
  ai_process  text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, code)
);

create index if not exists project_parts_project_idx
  on public.project_parts (project_id, position);

drop trigger if exists project_parts_set_updated_at on public.project_parts;
create trigger project_parts_set_updated_at
  before update on public.project_parts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Schematics and their revisions
-- ----------------------------------------------------------------------------
-- A schematic is a document; a revision is one attempt at drawing it. Every
-- attempt is kept — superseded and failed ones included — because the whole
-- point of the iteration loop is that the client can look back and restore.
--
-- The drawing is stored as SVG text in the row, not in a bucket: these are
-- generated deterministically from part data, measured in kilobytes, and are
-- useless without the row anyway. A PDF export renders from this same SVG.

create table if not exists public.project_schematics (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Which part it documents. Null means a whole-assembly drawing.
  part_id    uuid references public.project_parts (id) on delete set null,
  code       text not null,                    -- SCH-01, SCH-02, …
  title      text not null,
  -- Which 2D template drew it. Validated in the app, same reasoning as process.
  kind       text not null default 'outline',
  created_at timestamptz not null default now(),
  unique (project_id, code)
);

create index if not exists project_schematics_project_idx
  on public.project_schematics (project_id);

create table if not exists public.project_schematic_revisions (
  id            uuid primary key default gen_random_uuid(),
  schematic_id  uuid not null references public.project_schematics (id) on delete cascade,
  rev           integer not null check (rev > 0),
  status        text not null default 'generating'
                  check (status in ('generating', 'ready', 'failed', 'superseded')),
  -- The refine instruction that produced this revision, when there was one.
  prompt        text,
  note          text,
  svg           text,
  error         text,
  confidence    integer check (confidence between 0 and 100),
  created_at    timestamptz not null default now(),
  unique (schematic_id, rev)
);

create index if not exists project_schematic_revisions_idx
  on public.project_schematic_revisions (schematic_id, rev);

-- Same question as owns_project, one join further out. SECURITY DEFINER so the
-- revisions policy doesn't re-enter the schematics policies.
create or replace function public.owns_schematic(p_schematic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.project_schematics s
      join public.projects p on p.id = s.project_id
     where s.id = p_schematic_id
       and (p.user_id = auth.uid() or public.is_super_admin())
  );
$$;

grant execute on function public.owns_schematic(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------

alter table public.project_claims               enable row level security;
alter table public.project_parts                enable row level security;
alter table public.project_schematics           enable row level security;
alter table public.project_schematic_revisions  enable row level security;

grant select, insert, update, delete on public.project_claims              to authenticated;
grant select, insert, update, delete on public.project_parts               to authenticated;
grant select, insert, update, delete on public.project_schematics          to authenticated;
grant select, insert, update, delete on public.project_schematic_revisions to authenticated;

-- The project-scoped tables gate on owning the parent project, exactly as
-- project_blocks / project_materials / project_items do in 0015.
do $$
declare
  t text;
begin
  foreach t in array array['project_claims', 'project_parts', 'project_schematics']
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

-- Revisions hang off the schematic, so they gate one level further out.
drop policy if exists project_schematic_revisions_select on public.project_schematic_revisions;
create policy project_schematic_revisions_select on public.project_schematic_revisions
  for select to authenticated
  using (public.owns_schematic(schematic_id));

drop policy if exists project_schematic_revisions_insert on public.project_schematic_revisions;
create policy project_schematic_revisions_insert on public.project_schematic_revisions
  for insert to authenticated
  with check (public.owns_schematic(schematic_id));

drop policy if exists project_schematic_revisions_update on public.project_schematic_revisions;
create policy project_schematic_revisions_update on public.project_schematic_revisions
  for update to authenticated
  using (public.owns_schematic(schematic_id))
  with check (public.owns_schematic(schematic_id));

drop policy if exists project_schematic_revisions_delete on public.project_schematic_revisions;
create policy project_schematic_revisions_delete on public.project_schematic_revisions
  for delete to authenticated
  using (public.owns_schematic(schematic_id));
