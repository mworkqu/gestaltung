-- 0096_school_classes.sql
-- School projects: a teacher runs a class, teams of ~4 students (ages 12-15)
-- bring their OWN idea and walk the Studio steps themselves. No ready-made
-- kits, no student accounts, no personal data from a team.
--
-- RUN AFTER 0093. Safe to re-run.
--
-- WHAT CHANGES
--   1. school_classes / class_teams / class_team_comments (+ RLS).
--   2. Helpers: class_teacher_of_project(), is_class_project(), ai_role_of(),
--      new_join_code(). One extra SELECT policy on projects so a teacher can
--      read (never write) the projects of their own class teams.
--   3. credit_can_use() / spend_credit() v4: a project that belongs to a class
--      team spends the TEACHER's credits, and the teacher's account decides the
--      AI role — so an anonymous student in a class is not refused with
--      'sign_in'. Everything else is unchanged (1 credit per circuit,
--      1 cad credit = 3 versions, 30-day redemption, oldest-first).
--   4. projects_enforce_limit() v2: class team projects never count towards the
--      3-active-project cap, and are themselves exempt. A teacher's own
--      projects are capped as before.
--   5. create_school_class() / join_class_team(): the two writes that need more
--      than RLS (a unique join code; a project created and linked in one step).
--   6. store_settings.school_pricing seed (team pack, class pack, school print
--      rule, free delivery on a class order).
--
-- The class ORDER (part_orders.class_id, free Economy delivery) is 0097, which
-- is the only file that touches checkout. 0096 alone is enough for a teacher to
-- run a class; without 0097 a class parts order is just a normal order.
--
-- ROLLBACK (comments)
--   drop function if exists public.join_class_team(text, text);
--   drop function if exists public.create_school_class(text, text);
--   drop function if exists public.new_join_code();
--   drop policy if exists projects_select_class_teacher on public.projects;
--   drop table if exists public.class_team_comments;
--   drop table if exists public.class_teams;
--   drop table if exists public.school_classes;
--   drop function if exists public.is_class_project(uuid);
--   drop function if exists public.class_teacher_of_project(uuid);
--   drop function if exists public.ai_role_of(uuid);
--   -- then re-create credit_can_use from 0052, spend_credit from 0053 and
--   -- projects_enforce_limit from 0042.

-- ───────────────────────── 1. tables ────────────────────────────────────────

create table if not exists public.school_classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  school_name text not null check (length(btrim(school_name)) between 1 and 120),
  -- 6 characters, no vowels and no 0/1/O/I, so a code read off a printed
  -- sheet cannot be mistyped into another class.
  join_code   text not null unique check (join_code ~ '^[BCDFGHJKLMNPQRSTVWXYZ2-9]{6}$'),
  created_at  timestamptz not null default now(),
  archived    boolean not null default false
);

create index if not exists school_classes_teacher_idx on public.school_classes (teacher_id);

create table if not exists public.class_teams (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.school_classes (id) on delete cascade,
  -- One project per team, one team per project.
  project_id uuid not null unique references public.projects (id) on delete cascade,
  team_name  text not null check (length(btrim(team_name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create index if not exists class_teams_class_idx on public.class_teams (class_id);

-- The teacher's read-only remarks on a team project (3b). Students read them;
-- only the class teacher (or an admin) writes them.
create table if not exists public.class_team_comments (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.class_teams (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists class_team_comments_team_idx on public.class_team_comments (team_id, created_at);

-- ───────────────────────── 2. helpers ───────────────────────────────────────

-- The teacher who pays for a project, or null when the project is not a class
-- team project. SECURITY DEFINER: the caller may be the anonymous student, who
-- cannot read school_classes.
create or replace function public.class_teacher_of_project(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.teacher_id
    from public.class_teams t
    join public.school_classes c on c.id = t.class_id
   where t.project_id = p_project
   limit 1;
$$;

revoke all on function public.class_teacher_of_project(uuid) from public;
grant execute on function public.class_teacher_of_project(uuid) to anon, authenticated;

create or replace function public.is_class_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.class_teams t where t.project_id = p_project);
$$;

revoke all on function public.is_class_project(uuid) from public;
grant execute on function public.is_class_project(uuid) to anon, authenticated;

-- ai_role() for a GIVEN user (0042 ai_role() only answers for auth.uid()).
-- Used to price a class project against the teacher's account.
create or replace function public.ai_role_of(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user is null then return 'anonymous'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'super_admin') then return 'admin'; end if;
  if exists (
    select 1 from auth.users u
     where u.id = p_user
       and u.email_confirmed_at is not null
       and not coalesce(u.is_anonymous, false)
  ) then return 'user'; end if;
  return 'anonymous';
end $$;

revoke all on function public.ai_role_of(uuid) from public, anon, authenticated;

-- ───────────────────────── 3. RLS ───────────────────────────────────────────

alter table public.school_classes      enable row level security;
alter table public.class_teams         enable row level security;
alter table public.class_team_comments enable row level security;

-- Anonymous visitors never read these directly: a team reaches its class only
-- through join_class_team() and the row it owns.
revoke all on public.school_classes, public.class_teams, public.class_team_comments from anon, public;
grant select, insert, update, delete on public.school_classes      to authenticated;
grant select, insert, update, delete on public.class_teams         to authenticated;
grant select, insert, update, delete on public.class_team_comments to authenticated;

-- school_classes: the teacher owns their classes; super_admin sees all.
drop policy if exists school_classes_select on public.school_classes;
create policy school_classes_select on public.school_classes
  for select using (teacher_id = auth.uid() or public.is_super_admin());

drop policy if exists school_classes_insert on public.school_classes;
create policy school_classes_insert on public.school_classes
  for insert with check (
    public.is_super_admin()
    or (teacher_id = auth.uid() and public.ai_role() in ('user', 'admin'))
  );

drop policy if exists school_classes_update on public.school_classes;
create policy school_classes_update on public.school_classes
  for update using (teacher_id = auth.uid() or public.is_super_admin())
          with check (teacher_id = auth.uid() or public.is_super_admin());

drop policy if exists school_classes_delete on public.school_classes;
create policy school_classes_delete on public.school_classes
  for delete using (teacher_id = auth.uid() or public.is_super_admin());

-- class_teams: the class teacher, super_admin, and the team itself (the
-- project owner) may read the row. Teams are created by join_class_team().
drop policy if exists class_teams_select on public.class_teams;
create policy class_teams_select on public.class_teams
  for select using (
    public.is_super_admin()
    or exists (select 1 from public.school_classes c where c.id = class_id and c.teacher_id = auth.uid())
    or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists class_teams_insert on public.class_teams;
create policy class_teams_insert on public.class_teams
  for insert with check (public.is_super_admin());

drop policy if exists class_teams_delete on public.class_teams;
create policy class_teams_delete on public.class_teams
  for delete using (
    public.is_super_admin()
    or exists (select 1 from public.school_classes c where c.id = class_id and c.teacher_id = auth.uid())
  );

-- class_team_comments: the class teacher writes, the team reads. The teacher
-- is resolved through class_teacher_of_project() (SECURITY DEFINER) rather than
-- a join on school_classes, which a team may not read — a join there would
-- silently hide every comment from the students it is written for.
drop policy if exists class_team_comments_select on public.class_team_comments;
create policy class_team_comments_select on public.class_team_comments
  for select using (
    public.is_super_admin()
    or exists (
      select 1 from public.class_teams t
       where t.id = team_id
         and (
           public.class_teacher_of_project(t.project_id) = auth.uid()
           or exists (select 1 from public.projects p where p.id = t.project_id and p.user_id = auth.uid())
         )
    )
  );

drop policy if exists class_team_comments_insert on public.class_team_comments;
create policy class_team_comments_insert on public.class_team_comments
  for insert with check (
    author_id = auth.uid()
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.class_teams t
         where t.id = team_id and public.class_teacher_of_project(t.project_id) = auth.uid()
      )
    )
  );

drop policy if exists class_team_comments_delete on public.class_team_comments;
create policy class_team_comments_delete on public.class_team_comments
  for delete using (author_id = auth.uid() or public.is_super_admin());

-- The teacher reads (never writes) their class teams' projects. Policies are
-- OR-ed, so this only widens SELECT; there is no matching update policy, which
-- is what makes the teacher's view read-only.
create or replace function public.is_class_teacher_of_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.class_teacher_of_project(p_project) = auth.uid() and auth.uid() is not null;
$$;

revoke all on function public.is_class_teacher_of_project(uuid) from public;
grant execute on function public.is_class_teacher_of_project(uuid) to anon, authenticated;

drop policy if exists projects_select_class_teacher on public.projects;
create policy projects_select_class_teacher on public.projects
  for select using (public.is_class_teacher_of_project(id));

-- ───────────────────────── 4. credits route to the teacher ──────────────────

-- v4 (was 0052). Only the payer resolution is new.
create or replace function public.credit_can_use(p_step text, p_project uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := public.ai_role();
  v_teacher uuid;
  v_payer   uuid;
  v_p       record;
  v_bal     integer;
begin
  if p_step not in ('bom', 'wiring', 'cad') then
    return jsonb_build_object('allowed', false, 'reason', 'bad_step', 'cost', null, 'role', v_role);
  end if;
  if p_step = 'bom' then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'none', 'role', v_role);
  end if;

  -- 0096: a class team project is paid for by the teacher, and the teacher's
  -- account decides the role (students have no account).
  v_teacher := case when p_project is null then null else public.class_teacher_of_project(p_project) end;
  if v_teacher is not null then
    v_payer := v_teacher;
    v_role  := public.ai_role_of(v_teacher);
  else
    v_payer := v_uid;
  end if;

  if v_role = 'anonymous' then
    return jsonb_build_object('allowed', false, 'reason', 'sign_in', 'cost', null, 'role', v_role);
  end if;
  if v_role = 'admin' then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'none', 'role', v_role);
  end if;

  select id, cad_regens_remaining into v_p
    from public.projects
   where id = p_project
     and (user_id = v_uid or (v_teacher is not null and v_teacher = v_uid));
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'not_found', 'cost', null, 'role', v_role);
  end if;

  v_bal := public.credit_balance_of(v_payer, p_step);

  if p_step = 'cad' and v_p.cad_regens_remaining > 0 then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'included', 'role', v_role,
                              'balance', v_bal, 'regens', v_p.cad_regens_remaining);
  end if;

  if v_bal >= 1 then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'credit', 'role', v_role, 'balance', v_bal);
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'no_credits', 'cost', 'credit', 'role', v_role, 'balance', v_bal);
end $$;

revoke all on function public.credit_can_use(text, uuid) from public;
grant execute on function public.credit_can_use(text, uuid) to anon, authenticated;

-- v4 (was 0053). The ledger row is written for the payer (the teacher for a
-- class team project), never for the anonymous student.
create or replace function public.spend_credit(p_step text, p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := public.ai_role();
  v_teacher uuid;
  v_payer   uuid;
  v_p       record;
  v_bal     integer;
  v_earned  timestamptz;
begin
  if p_step not in ('wiring', 'cad') then raise exception 'bad_step'; end if;

  v_teacher := public.class_teacher_of_project(p_project);
  if v_teacher is not null then
    v_payer := v_teacher;
    v_role  := public.ai_role_of(v_teacher);
  else
    v_payer := v_uid;
  end if;

  if v_role = 'anonymous' then raise exception 'sign_in'; end if;
  if v_role = 'admin' then
    return jsonb_build_object('charged', false, 'cost', 'none', 'balance', null);
  end if;

  -- Lock the project so two parallel calls cannot both use one cad regen.
  select id, free_wiring_used, cad_regens_remaining into v_p
    from public.projects
   where id = p_project
     and (user_id = v_uid or (v_teacher is not null and v_teacher = v_uid))
     for update;
  if not found then raise exception 'not_found'; end if;

  perform set_config('app.credits_write', 'on', true);

  if p_step = 'cad' and v_p.cad_regens_remaining > 0 then
    update public.projects set cad_regens_remaining = cad_regens_remaining - 1 where id = p_project;
    return jsonb_build_object('charged', false, 'cost', 'included', 'balance', public.credit_balance_of(v_payer, 'cad'),
                              'regens', v_p.cad_regens_remaining - 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || v_payer::text));
  v_bal := public.credit_balance_of(v_payer, p_step);
  if v_bal < 1 then raise exception 'no_credits'; end if;

  v_earned := coalesce(public.credit_next_earned_at(v_payer, p_step), now());

  insert into public.credits_ledger (user_id, kind, delta, reason, redeemable_until, earned_at, created_by)
  values (v_payer, p_step, -1, 'spend:' || p_project::text, v_earned + interval '30 days', v_earned, v_uid);

  if p_step = 'cad' then
    update public.projects set cad_regens_remaining = 2 where id = p_project;
  elsif not v_p.free_wiring_used then
    -- Marker only (no longer a free circuit): fires the 0046 first_circuit email.
    update public.projects set free_wiring_used = true where id = p_project;
  end if;

  return jsonb_build_object('charged', true, 'cost', 'credit', 'balance', v_bal - 1);
end $$;

revoke all on function public.spend_credit(text, uuid) from public, anon;
grant execute on function public.spend_credit(text, uuid) to authenticated;

-- ───────────────────────── 5. the 3-active-project cap ──────────────────────

-- v2 (was 0042): a class team project is outside the cap, and never counts
-- towards its owner's three. The teacher's OWN projects are capped as before.
create or replace function public.projects_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.status <> 'active' or new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.user_id is not distinct from new.user_id then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = new.user_id and role = 'super_admin') then
    return new;
  end if;
  -- join_class_team() sets this for the one insert it makes (the class_teams
  -- row does not exist yet at that point).
  if coalesce(current_setting('app.class_project', true), '') = 'on' then return new; end if;
  if public.is_class_project(new.id) then return new; end if;
  perform pg_advisory_xact_lock(hashtext('projects_limit:' || new.user_id::text));
  select count(*) into v_count
    from public.projects p
   where p.user_id = new.user_id
     and p.status = 'active'
     and p.id <> new.id
     and not public.is_class_project(p.id);
  if v_count >= 3 then
    raise exception 'project_limit' using hint = 'Archive a project to create another (3 active projects at a time).';
  end if;
  return new;
end $$;

drop trigger if exists projects_enforce_limit on public.projects;
create trigger projects_enforce_limit
  before insert or update of status, user_id on public.projects
  for each row execute function public.projects_enforce_limit();

-- ───────────────────────── 6. the two write RPCs ────────────────────────────

-- A 6-character code from an alphabet with no vowels and no look-alikes.
create or replace function public.new_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet text := 'BCDFGHJKLMNPQRSTVWXYZ23456789';
  v_code     text;
  v_try      integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.school_classes c where c.join_code = v_code);
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'join_code_exhausted'; end if;
  end loop;
  return v_code;
end $$;

revoke all on function public.new_join_code() from public, anon, authenticated;

-- The teacher creates a class. SECURITY DEFINER only so the join code can be
-- made unique; the caller still has to be a confirmed, non-anonymous account.
create or replace function public.create_school_class(p_name text, p_school text)
returns public.school_classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.school_classes;
begin
  if v_uid is null then raise exception 'sign_in'; end if;
  if public.ai_role() not in ('user', 'admin') then raise exception 'sign_in'; end if;
  if coalesce(btrim(p_name), '') = '' or length(btrim(p_name)) > 80 then raise exception 'bad_name'; end if;
  if coalesce(btrim(p_school), '') = '' or length(btrim(p_school)) > 120 then raise exception 'bad_school'; end if;
  if (select count(*) from public.school_classes c where c.teacher_id = v_uid and not c.archived) >= 20 then
    raise exception 'class_limit';
  end if;

  insert into public.school_classes (teacher_id, name, school_name, join_code)
  values (v_uid, btrim(p_name), btrim(p_school), public.new_join_code())
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.create_school_class(text, text) from public, anon;
grant execute on function public.create_school_class(text, text) to authenticated;

-- A team joins with the class code: one project, owned by the team's own
-- (anonymous) session, linked to the class. Nothing personal is stored — the
-- team name is the only thing the students type.
create or replace function public.join_class_team(p_code text, p_team_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_class   public.school_classes;
  v_name    text := btrim(coalesce(p_team_name, ''));
  v_project uuid;
begin
  if v_uid is null then raise exception 'sign_in'; end if;
  if v_name = '' or length(v_name) > 40 then raise exception 'bad_team_name'; end if;

  select * into v_class from public.school_classes c
   where c.join_code = upper(btrim(coalesce(p_code, ''))) and not c.archived;
  if not found then raise exception 'bad_code'; end if;

  if (select count(*) from public.class_teams t where t.class_id = v_class.id) >= 40 then
    raise exception 'class_full';
  end if;

  -- The project the team works in. aiConsent is set here because the Studio
  -- routes refuse without it, and joining a class is the consent step.
  perform set_config('app.class_project', 'on', true);
  insert into public.projects (user_id, name, spec)
  values (
    v_uid,
    v_name,
    jsonb_build_object('aiConsent', jsonb_build_object('at', now(), 'destination', 'studio'))
  )
  returning id into v_project;
  perform set_config('app.class_project', 'off', true);

  insert into public.class_teams (class_id, project_id, team_name)
  values (v_class.id, v_project, v_name);

  return jsonb_build_object('project_id', v_project, 'class_id', v_class.id, 'team_name', v_name);
end $$;

revoke all on function public.join_class_team(text, text) from public, anon;
grant execute on function public.join_class_team(text, text) to authenticated;

-- ───────────────────────── 7. school pricing ────────────────────────────────

-- Mirrors lib/schools/pricing.ts (SCHOOL_PRICING_KEY / DEFAULT_SCHOOL_PRICING)
-- — keep the two identical. Admin-editable in Dashboard -> Store -> Schools.
insert into public.store_settings (key, value)
values (
  'school_pricing',
  jsonb_build_object(
    'team_pack',  jsonb_build_object('credits', 3,  'qar', 49),
    'class_pack', jsonb_build_object('credits', 15, 'qar', 199),
    'print',      jsonb_build_object('base_qar', 30, 'per_gram_qar', 0.7),
    'free_delivery_class_order', true
  )
)
on conflict (key) do nothing;

