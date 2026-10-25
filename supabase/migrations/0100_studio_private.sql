-- ============================================================================
-- Gestaltung — 0100: Studio product data the owner can neither read nor forge
--                    (security audit 2026-10, finding DB-01)
-- ============================================================================
-- Problem: projects.studio held two server-owned keys —
--   * studio.productPrivate  the ProductModels (+ vision scores) the page must
--                            not see before "Create my CAD";
--   * studio.product         page-safe metadata, but `unlockedId` gates
--                            GET /api/studio/product/model.
-- The app's own saves merged both back (lib/studio/server/doc.ts), but the
-- owner could go straight to PostgREST:
--   GET   /rest/v1/projects?select=studio->productPrivate  → every model, free;
--   PATCH /rest/v1/projects {studio:{product:{unlockedId}}} → "unlocked", free.
--
-- This migration:
--   1. public.project_studio_private (project_id → product_private). RLS on,
--      no policies, every privilege revoked from anon/authenticated: only the
--      service role (server code) reads or writes it.
--   2. Back-fills it from projects.studio->'productPrivate', then removes that
--      key from projects.studio (updated_at is left as it was). Also removes
--      it from engineering_jobs.snapshot->'studio' (audit G1.2) — but ONLY
--      after copying every affected snapshot verbatim into
--      public.engineering_jobs_snapshot_backup_2026_10 (step 2b, same
--      transaction), because that jsonb edit is otherwise irreversible: before this
--      commit lib/engineering/server.ts stored project.studio verbatim in the
--      job snapshot ({name, studio}), which the job's owner can SELECT
--      (0091), so every job submitted before 0100 still carried every private
--      model. The admin snapshot download adds the private models from
--      project_studio_private at read time, so nothing it needs is lost.
--   3. projects_guard_studio_server_keys: BEFORE INSERT OR UPDATE OF studio.
--      For anon/authenticated callers (PostgREST, the app's user client) it
--      drops any productPrivate key and pins studio.product to the stored one
--      (removes it on insert); a null / non-object studio on UPDATE becomes
--      {"product": <stored>} so the product (and its regens count) survives. Trusted callers (service_role, postgres,
--      SECURITY DEFINER functions) are untouched. studio_version is never
--      touched, so the optimistic-concurrency check of /api/studio/doc
--      (`… where studio_version = <read>`) behaves exactly as before.
--   4. public.studio_product_save(project, user, version, studio, private):
--      service_role only; raises not_owner unless `user` owns the project or
--      is a super_admin (a class teacher only READS team projects). The product routes' write — the studio doc (with the
--      new `product`) and the private models in ONE transaction, with the same
--      version check (`null` = somebody saved first → the route retries).
--
-- App side (same commit): lib/studio/server/doc.ts reads the private models
-- and writes product changes with createServiceClient() after the ownership
-- read with the user's RLS client; no service key → 503 service_unavailable.
-- Until this runs the app falls back to the old storage (studio.productPrivate)
-- so nothing breaks — deploy the code first, then run this.
--
-- RUN AFTER 0099. Safe to re-run (create … if not exists / create or replace /
-- drop … if exists; the back-fill and the snapshot backup skip rows already
-- copied; the clean-ups only touch rows that still carry the key).
--
-- ROLLBACK (manual, one transaction; puts the models back into studio):
--   update public.projects p
--      set studio = coalesce(p.studio, '{}'::jsonb)
--                   || jsonb_build_object('productPrivate', s.product_private)
--     from public.project_studio_private s
--    where s.project_id = p.id and s.product_private is not null;
--   drop trigger  if exists projects_guard_studio_server_keys on public.projects;
--   drop function if exists public.projects_guard_studio_server_keys();
--   drop function if exists public.studio_product_save(uuid, uuid, integer, jsonb, jsonb);
--   drop table    if exists public.project_studio_private;
-- (then redeploy the app commit before this one, or keep the current code: it
--  falls back to studio.productPrivate when the table/function are missing).
--
-- ROLLBACK of the engineering_jobs.snapshot clean-up (step 2b backed it up, so
-- this IS reversible; same transaction as above if you want both):
--   update public.engineering_jobs j
--      set snapshot = b.snapshot
--     from public.engineering_jobs_snapshot_backup_2026_10 b
--    where b.job_id = j.id;
--   -- or one job only:  … and j.id = '<job uuid>';
-- public.engineering_jobs_snapshot_backup_2026_10 (job_id, project_id, user_id,
-- created_at, snapshot, backed_up_at) holds the WHOLE pre-0100 snapshot of every
-- job the clean-up touched. It is KEPT DELIBERATELY — nothing reads it, it is
-- service-role-only (RLS on, no policies, anon/authenticated revoked), and the
-- OWNER MAY DROP IT once satisfied that nothing needs restoring:
--   drop table if exists public.engineering_jobs_snapshot_backup_2026_10;
-- (It holds customer design data, so do not grant anything on it, and drop it
--  rather than leaving it to rot once the migration is proven.)
-- ============================================================================

-- ── 1. The private table ────────────────────────────────────────────────────
create table if not exists public.project_studio_private (
  project_id      uuid primary key references public.projects (id) on delete cascade,
  product_private jsonb,
  updated_at      timestamptz not null default now()
);

comment on table public.project_studio_private is
  'Server-only Studio product models (was projects.studio.productPrivate, 0100 / DB-01). service_role only.';

alter table public.project_studio_private enable row level security;
revoke all on table public.project_studio_private from public, anon, authenticated;
grant select, insert, update, delete on table public.project_studio_private to service_role;

-- ── 2. Back-fill, then take the key out of projects.studio ──────────────────
insert into public.project_studio_private (project_id, product_private)
select p.id, p.studio -> 'productPrivate'
  from public.projects p
 where jsonb_typeof(p.studio) = 'object'
   and p.studio ? 'productPrivate'
on conflict (project_id) do nothing;

-- The clean-up must not look like a user edit: keep updated_at as it was.
do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.projects'::regclass
                and tgname = 'projects_set_updated_at' and not tgisinternal) then
    alter table public.projects disable trigger projects_set_updated_at;
  end if;

  update public.projects
     set studio = studio - 'productPrivate'
   where jsonb_typeof(studio) = 'object'
     and studio ? 'productPrivate';

  if exists (select 1 from pg_trigger
              where tgrelid = 'public.projects'::regclass
                and tgname = 'projects_set_updated_at' and not tgisinternal) then
    alter table public.projects enable trigger projects_set_updated_at;
  end if;
end $$;

-- ── 2b. Back up every snapshot we are about to edit (IRREVERSIBLE otherwise) ─
-- The strip below is a jsonb edit: once it runs the private models in that
-- snapshot are gone and the rollback note cannot bring them back. So the whole
-- snapshot of every job the strip touches is copied here FIRST, in this same
-- transaction, with the job's identity beside it so a row can be put back on
-- the right job. No FK to engineering_jobs on purpose: a cascade from a deleted
-- job must not take the backup with it.
create table if not exists public.engineering_jobs_snapshot_backup_2026_10 (
  job_id       uuid primary key,
  project_id   uuid,
  user_id      uuid not null,
  created_at   timestamptz not null,
  snapshot     jsonb,
  backed_up_at timestamptz not null default now()
);

comment on table public.engineering_jobs_snapshot_backup_2026_10 is
  'Pre-0100 engineering_jobs.snapshot of every job whose snapshot->studio carried productPrivate (customer design data). Kept deliberately so 0100 can be undone; the owner may drop it once satisfied. service_role only.';

alter table public.engineering_jobs_snapshot_backup_2026_10 enable row level security;
revoke all on table public.engineering_jobs_snapshot_backup_2026_10 from public, anon, authenticated;
grant select, insert, update, delete on table public.engineering_jobs_snapshot_backup_2026_10 to service_role;

insert into public.engineering_jobs_snapshot_backup_2026_10
  (job_id, project_id, user_id, created_at, snapshot)
select j.id, j.project_id, j.user_id, j.created_at, j.snapshot
  from public.engineering_jobs j
 where jsonb_typeof(j.snapshot -> 'studio') = 'object'
   and j.snapshot -> 'studio' ? 'productPrivate'
on conflict (job_id) do nothing;

do $$
begin
  if has_table_privilege('anon', 'public.engineering_jobs_snapshot_backup_2026_10', 'select')
     or has_table_privilege('authenticated', 'public.engineering_jobs_snapshot_backup_2026_10', 'select') then
    raise exception '0100: anon/authenticated can still SELECT engineering_jobs_snapshot_backup_2026_10 (check grants to PUBLIC)';
  end if;
end $$;

-- G1.2: job snapshots taken before this commit hold a copy of the private
-- models ({name, studio: project.studio}); the owner can read them (0091).
-- updated_at is not touched (engineering_jobs has no updated_at trigger).
update public.engineering_jobs
   set snapshot = snapshot #- '{studio,productPrivate}'
 where jsonb_typeof(snapshot -> 'studio') = 'object'
   and snapshot -> 'studio' ? 'productPrivate';

-- ── 3. Guard: clients can neither write productPrivate nor change product ───
create or replace function public.projects_guard_studio_server_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- A null / non-object studio would drop the stored product (and with it
  -- product.regens): coerce it to an empty doc, then restore product below.
  if new.studio is null or jsonb_typeof(new.studio) <> 'object' then
    if tg_op = 'UPDATE'
       and old.studio is not null
       and jsonb_typeof(old.studio) = 'object'
       and old.studio ? 'product' then
      new.studio := '{}'::jsonb;
    else
      return new;  -- nothing server-owned to keep
    end if;
  end if;

  new.studio := (new.studio - 'productPrivate') - 'product';
  if tg_op = 'UPDATE'
     and old.studio is not null
     and jsonb_typeof(old.studio) = 'object'
     and old.studio ? 'product' then
    new.studio := new.studio || jsonb_build_object('product', old.studio -> 'product');
  end if;
  return new;
end $$;

revoke all on function public.projects_guard_studio_server_keys() from public, anon, authenticated;

drop trigger if exists projects_guard_studio_server_keys on public.projects;
create trigger projects_guard_studio_server_keys
  before insert or update of studio on public.projects
  for each row execute function public.projects_guard_studio_server_keys();

-- ── 4. The product routes' atomic save (service_role only) ──────────────────
create or replace function public.studio_product_save(
  p_project uuid,
  p_user    uuid,
  p_version integer,
  p_studio  jsonb,
  p_private jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new integer;
begin
  -- Only the owner (or a super_admin) changes the product: a class teacher
  -- can READ a team's project under RLS, but must not write it through here.
  if not exists (
    select 1 from public.projects p
     where p.id = p_project
       and (p.user_id = p_user
            or exists (select 1 from public.profiles pr where pr.id = p_user and pr.role = 'super_admin'))
  ) then
    raise exception 'not_owner';
  end if;

  update public.projects
     set studio = case when jsonb_typeof(p_studio) = 'object' then p_studio - 'productPrivate' else p_studio end,
         studio_version = p_version + 1
   where id = p_project
     and studio_version = p_version
  returning studio_version into v_new;

  if v_new is null then
    return null;  -- not found or somebody saved first: the caller retries
  end if;

  insert into public.project_studio_private (project_id, product_private, updated_at)
  values (p_project, p_private, now())
  on conflict (project_id) do update
    set product_private = excluded.product_private,
        updated_at      = excluded.updated_at;

  return v_new;
end $$;

revoke all on function public.studio_product_save(uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.studio_product_save(uuid, uuid, integer, jsonb, jsonb) to service_role;

-- PostgREST: see the new table / function at once (no stale schema cache).
notify pgrst, 'reload schema';

do $$ begin raise notice '0100 applied: project_studio_private + studio server-key guard + studio_product_save'; end $$;
