-- ============================================================================
-- Gestaltung — 0045: project link by email (open a guest project on another
--                    device) (2026-10-03, site review Phase B, decision D6)
-- ============================================================================
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   -- the columns and functions this adds (expect 0 rows before, 3 + 3 after)
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'projects'
--      and column_name in ('contact_email', 'recovery_token', 'recovery_emailed_at');
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('project_recovery_begin', 'claim_project', 'owns_storage_project');
--
--   -- how many projects belong to guests today (the only ones a link can move)
--   select count(*) from public.projects p join auth.users u on u.id = p.user_id
--    where coalesce(u.is_anonymous, false);
--
-- ROLLBACK (manual, run as one transaction):
--   drop policy if exists project_images_select_by_project on storage.objects;
--   drop policy if exists project_images_delete_by_project on storage.objects;
--   drop policy if exists cad_files_select_by_project      on storage.objects;
--   drop policy if exists cad_files_delete_by_project      on storage.objects;
--   drop function if exists public.claim_project(uuid, uuid);
--   drop function if exists public.project_recovery_begin(uuid, text);
--   drop function if exists public.owns_storage_project(text);
--   drop trigger  if exists projects_guard_recovery_columns on public.projects;
--   drop function if exists public.projects_guard_recovery_columns();
--   drop index    if exists public.projects_recovery_emailed_idx;
--   alter table public.projects drop column if exists recovery_emailed_at,
--                               drop column if exists recovery_token,
--                               drop column if exists contact_email;
--   The app keeps working after a rollback: /projects/new skips the email
--   (the RPC is missing → "not_ready") and a #key= link just opens the normal
--   "not available here" page.
--
-- WHY
-- A guest's project belongs to an ANONYMOUS Supabase user that exists only in
-- the browser that created it. A plain link opened in another browser shows
-- "This project isn't available here" (RLS + user_id = auth.uid()). So the
-- optional email on /projects/new gets a link that carries a secret:
--   /{locale}/projects/{id}#key={recovery_token}
-- The key is in the URL FRAGMENT, so it is never sent to our server in the
-- request line, never appears in Referer headers and is not part of the
-- analytics page_location. The page reads it in the browser and posts it to
-- /api/projects/claim, which calls claim_project() below.
--
-- WHAT CHANGES
-- 1. projects.contact_email, recovery_token (uuid v4, unguessable),
--    recovery_emailed_at. Clients can never write them directly: a guard
--    trigger blanks them on insert and keeps the old values on update unless
--    the caller is one of the functions below (app.recovery_write = 'on') or a
--    super_admin. Owners can READ their own row as before (they own the key).
--
-- 2. project_recovery_begin(project, email) — owner only. Stores the email,
--    mints the key, stamps recovery_emailed_at and returns the key so the API
--    route can send ONE email. Refuses: not the owner, a malformed email, a
--    project older than 1 hour (it's the "at creation" email, not a mailer),
--    a project that was already emailed, or a caller who already had 3 project
--    emails in the last 24 h.
--
-- 3. claim_project(project, key) — any signed-in session (a guest's anonymous
--    session included). With the right key it MOVES the project to the caller
--    (projects.user_id := auth.uid()). Every child table follows, because they
--    are all gated by owns_project(). Rules:
--      * wrong / old key or unknown project → 'invalid' (indistinguishable);
--      * caller already owns it → 'already_owner' (nothing changes);
--      * the current owner is NOT anonymous (signed up, or already claimed by
--        an account) → 'has_account': a real account never loses a project to
--        someone holding a stale link;
--      * the caller is at the 3-active-project limit (0042 trigger) →
--        'project_limit', nothing changes;
--      * otherwise the key is ROTATED (the link that was used stops working),
--        the move is logged in project_events ('project_claimed'), and the new
--        key + contact email are returned so the route can email the new link
--        to the same address (the only place it ever goes).
--    The device that had the project before loses it (it moved); the newest
--    email always holds a working link.
--
-- 4. Storage. Project images and CAD files live under <user_id>/<project_id>/…
--    and the 0015/0018 policies only let the FIRST folder's user read them, so
--    a moved project's files would vanish for its new owner. Two extra
--    permissive policies per bucket (select, delete) also allow the owner of
--    the project named in the SECOND folder. Uploads still go under the
--    uploader's own folder (insert policies unchanged).
--
-- Run after 0044. Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.projects
  add column if not exists contact_email       text,
  add column if not exists recovery_token      uuid,
  add column if not exists recovery_emailed_at timestamptz;

create index if not exists projects_recovery_emailed_idx
  on public.projects (user_id, recovery_emailed_at)
  where recovery_emailed_at is not null;

-- ── 2. Guard: only the functions below write these columns ──────────────────
create or replace function public.projects_guard_recovery_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.recovery_write', true), '') = 'on'
     or auth.uid() is null
     or public.is_super_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.contact_email := null;
    new.recovery_token := null;
    new.recovery_emailed_at := null;
  else
    new.contact_email := old.contact_email;
    new.recovery_token := old.recovery_token;
    new.recovery_emailed_at := old.recovery_emailed_at;
  end if;
  return new;
end $$;

drop trigger if exists projects_guard_recovery_columns on public.projects;
create trigger projects_guard_recovery_columns
  before insert or update on public.projects
  for each row execute function public.projects_guard_recovery_columns();

-- ── 3. project_recovery_begin ───────────────────────────────────────────────
create or replace function public.project_recovery_begin(p_project uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_row     record;
  v_recent  integer;
  v_token   uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;

  select id, name, created_at, recovery_emailed_at into v_row
    from public.projects
   where id = p_project and user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if v_row.recovery_emailed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;
  if v_row.created_at < now() - interval '1 hour' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;

  select count(*) into v_recent
    from public.projects
   where user_id = v_uid
     and recovery_emailed_at > now() - interval '24 hours';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  perform set_config('app.recovery_write', 'on', true);
  update public.projects
     set contact_email = v_email,
         recovery_token = gen_random_uuid(),
         recovery_emailed_at = now()
   where id = p_project
  returning recovery_token into v_token;
  perform set_config('app.recovery_write', 'off', true);

  return jsonb_build_object('ok', true, 'token', v_token, 'name', v_row.name, 'email', v_email);
end $$;

revoke all on function public.project_recovery_begin(uuid, text) from public;
grant execute on function public.project_recovery_begin(uuid, text) to authenticated;

-- ── 4. claim_project ────────────────────────────────────────────────────────
create or replace function public.claim_project(p_project uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       record;
  v_anonymous boolean;
  v_token     uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_project is null or p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select id, user_id, name, contact_email, recovery_token into v_row
    from public.projects
   where id = p_project
   for update;
  if not found or v_row.recovery_token is null or v_row.recovery_token <> p_token then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if v_row.user_id = v_uid then
    return jsonb_build_object('ok', true, 'status', 'already_owner');
  end if;

  select coalesce(u.is_anonymous, false) into v_anonymous
    from auth.users u where u.id = v_row.user_id;
  if not coalesce(v_anonymous, false) then
    return jsonb_build_object('ok', false, 'reason', 'has_account');
  end if;

  begin
    perform set_config('app.recovery_write', 'on', true);
    update public.projects
       set user_id = v_uid,
           recovery_token = gen_random_uuid()
     where id = p_project
    returning recovery_token into v_token;
    perform set_config('app.recovery_write', 'off', true);
  exception when raise_exception then
    perform set_config('app.recovery_write', 'off', true);
    if sqlerrm = 'project_limit' then
      return jsonb_build_object('ok', false, 'reason', 'project_limit');
    end if;
    raise;
  end;

  perform public.log_project_event(p_project, 'project_claimed', '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'status', 'claimed',
    'token', v_token,
    'name', v_row.name,
    'email', v_row.contact_email
  );
end $$;

revoke all on function public.claim_project(uuid, uuid) from public;
grant execute on function public.claim_project(uuid, uuid) to authenticated;

-- ── 5. Storage: the project's owner can read / delete its files ─────────────
-- "<user_id>/<project_id>/<file>": true when the caller owns the project in
-- the second folder. A second folder that isn't a uuid is simply false.
create or replace function public.owns_storage_project(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := (storage.foldername(p_name))[2];
begin
  if v_folder is null
     or v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.projects p
     where p.id = v_folder::uuid and p.user_id = auth.uid()
  );
end $$;

revoke all on function public.owns_storage_project(text) from public;
grant execute on function public.owns_storage_project(text) to authenticated;

drop policy if exists project_images_select_by_project on storage.objects;
create policy project_images_select_by_project on storage.objects
  for select to authenticated
  using (bucket_id = 'project-images' and public.owns_storage_project(name));

drop policy if exists project_images_delete_by_project on storage.objects;
create policy project_images_delete_by_project on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-images' and public.owns_storage_project(name));

drop policy if exists cad_files_select_by_project on storage.objects;
create policy cad_files_select_by_project on storage.objects
  for select to authenticated
  using (bucket_id = 'cad-files' and public.owns_storage_project(name));

drop policy if exists cad_files_delete_by_project on storage.objects;
create policy cad_files_delete_by_project on storage.objects
  for delete to authenticated
  using (bucket_id = 'cad-files' and public.owns_storage_project(name));

do $$
declare n_cols int; n_fns int; n_pol int;
begin
  select count(*) into n_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'projects'
     and column_name in ('contact_email', 'recovery_token', 'recovery_emailed_at');
  select count(*) into n_fns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('project_recovery_begin', 'claim_project', 'owns_storage_project');
  select count(*) into n_pol from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('project_images_select_by_project', 'project_images_delete_by_project',
                        'cad_files_select_by_project', 'cad_files_delete_by_project');
  if n_cols <> 3 or n_fns <> 3 or n_pol <> 4 then
    raise exception '0045 incomplete: columns %/3, functions %/3, storage policies %/4', n_cols, n_fns, n_pol;
  end if;
  raise notice '0045 applied: projects.contact_email/recovery_token/recovery_emailed_at (guarded), project_recovery_begin(), claim_project() (guests only, key rotated), storage read/delete by project owner';
end $$;

commit;
