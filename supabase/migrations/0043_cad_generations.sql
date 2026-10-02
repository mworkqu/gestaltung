-- ============================================================================
-- Gestaltung — 0043: CAD generations (2026-10-02)
-- ============================================================================
-- The 3D model (CAD) stage. Gemini writes OpenSCAD on the server; the
-- customer's BROWSER renders it to STL (OpenSCAD WebAssembly). So the server
-- never knows whether a model actually built — the browser reports it:
--
--   cad_begin     server route, before the model call: re-checks the credit
--                 rules (credit_can_use) and opens a 'pending' row
--   cad_set_code  server route, after a validated answer: stores the code
--   cad_deliver   browser, after its render succeeded: spends via the 0042
--                 spend_credit('cad', project) — the first delivery of a
--                 session charges 1 cad credit and opens 3 versions, later
--                 ones use an included version; admin is never charged
--   cad_fail      browser or server, on any failure: no spend
--
-- A failed generation never charges. The code reaches the browser before it
-- is paid for, so to stop a caller collecting code they never deliver, 5 or
-- more generations in 24 h whose code was handed over but not delivered block
-- new ones ('too_many_failed'; admin exempt). Failures of our own model call
-- (no code) do not count against the caller.
--
-- Clients can READ their own rows (re-opening a saved model needs no AI call)
-- but never write them: every write goes through the functions below.
--
-- Also: analysis_runs accepts feature 'cad' (raw model answers are recorded
-- there like every other structured call).
--
-- Run after 0042. Safe to re-run.
-- ============================================================================

-- ─── cad_generations ────────────────────────────────────────────────────────
create table if not exists public.cad_generations (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  parent_id    uuid references public.cad_generations (id) on delete set null,  -- the version refined / repaired
  request      text not null,                                                   -- what the user asked
  tier         text not null check (tier in ('simple', 'standard', 'complex')),
  scad         text,
  status       text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  error        text,
  charged      boolean not null default false,
  model        text,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists cad_generations_project_idx on public.cad_generations (project_id, created_at);
create index if not exists cad_generations_user_recent_idx on public.cad_generations (user_id, created_at)
  where status <> 'delivered';

alter table public.cad_generations enable row level security;

revoke all on public.cad_generations from anon, authenticated;
grant select on public.cad_generations to authenticated;

drop policy if exists cad_generations_select on public.cad_generations;
create policy cad_generations_select on public.cad_generations
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- ─── cad_begin: open a pending generation (server route, before the model) ──
-- Raises sign_in / no_credits / not_found (from credit_can_use), bad_tier,
-- bad_request, too_many_failed. Returns the new row id.
create or replace function public.cad_begin(p_project uuid, p_request text, p_tier text, p_parent uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_can jsonb;
  v_id  uuid;
begin
  if p_tier is null or p_tier not in ('simple', 'standard', 'complex') then raise exception 'bad_tier'; end if;
  if nullif(btrim(coalesce(p_request, '')), '') is null then raise exception 'bad_request'; end if;

  v_can := public.credit_can_use('cad', p_project);
  if not coalesce((v_can ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_can ->> 'reason', 'not_found');
  end if;
  -- credit_can_use lets an admin through without looking at the project.
  if not exists (
    select 1 from public.projects where id = p_project and (user_id = v_uid or public.is_super_admin())
  ) then
    raise exception 'not_found';
  end if;
  if p_parent is not null and not exists (
    select 1 from public.cad_generations where id = p_parent and project_id = p_project
  ) then
    raise exception 'not_found';
  end if;

  if v_can ->> 'role' <> 'admin' then
    -- One caller at a time, so parallel requests cannot all slip under the cap.
    perform pg_advisory_xact_lock(hashtext('cad:' || v_uid::text));
    if (select count(*) from public.cad_generations
         where user_id = v_uid and status <> 'delivered' and scad is not null
           and created_at > now() - interval '24 hours') >= 5 then
      raise exception 'too_many_failed';
    end if;
  end if;

  insert into public.cad_generations (project_id, user_id, parent_id, request, tier)
  values (p_project, v_uid, p_parent, left(btrim(p_request), 4000), p_tier)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.cad_begin(uuid, text, text, uuid) from public, anon;
grant execute on function public.cad_begin(uuid, text, text, uuid) to authenticated;

-- ─── cad_set_code: store the validated code (server route) ──────────────────
create or replace function public.cad_set_code(p_id uuid, p_scad text, p_model text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_scad, '')), '') is null then raise exception 'bad_code'; end if;
  if length(p_scad) > 40000 then raise exception 'too_large'; end if;
  update public.cad_generations
     set scad = p_scad, model = left(p_model, 100)
   where id = p_id
     and status = 'pending'
     and (user_id = auth.uid() or public.is_super_admin());
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function public.cad_set_code(uuid, text, text) from public, anon;
grant execute on function public.cad_set_code(uuid, text, text) to authenticated;

-- ─── cad_deliver: the browser built it — spend now ──────────────────────────
-- Returns {charged, regens, balance}. Idempotent: a delivered row returns its
-- result again without spending. Raises not_found / not_ready, and whatever
-- spend_credit raises (sign_in / no_credits / not_found) — the row then stays
-- pending and nothing is spent.
create or replace function public.cad_deliver(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_g     record;
  v_spend jsonb;
  v_regen integer;
begin
  if v_uid is null then raise exception 'sign_in'; end if;
  select id, project_id, status, scad, charged into v_g
    from public.cad_generations where id = p_id and user_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_g.status = 'delivered' then
    select cad_regens_remaining into v_regen from public.projects where id = v_g.project_id;
    return jsonb_build_object('charged', v_g.charged, 'regens', v_regen,
                              'balance', public.credit_balance_of(v_uid, 'cad'));
  end if;
  if v_g.status <> 'pending' or v_g.scad is null then raise exception 'not_ready'; end if;

  -- The credit rules stay in one place (0042).
  v_spend := public.spend_credit('cad', v_g.project_id);

  update public.cad_generations
     set status = 'delivered',
         delivered_at = now(),
         charged = coalesce((v_spend ->> 'charged')::boolean, false)
   where id = p_id;

  select cad_regens_remaining into v_regen from public.projects where id = v_g.project_id;
  return jsonb_build_object('charged', coalesce((v_spend ->> 'charged')::boolean, false),
                            'regens', v_regen,
                            'balance', v_spend -> 'balance');
end $$;

revoke all on function public.cad_deliver(uuid) from public, anon;
grant execute on function public.cad_deliver(uuid) to authenticated;

-- ─── cad_fail: the model call or the browser build failed — no spend ────────
create or replace function public.cad_fail(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cad_generations
     set status = 'failed', error = left(coalesce(p_error, ''), 500)
   where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function public.cad_fail(uuid, text) from public, anon;
grant execute on function public.cad_fail(uuid, text) to authenticated;

-- ─── analysis_runs: record raw CAD answers too ──────────────────────────────
alter table public.analysis_runs drop constraint if exists analysis_runs_feature_check;
alter table public.analysis_runs add constraint analysis_runs_feature_check
  check (feature in ('analyse', 'netlist', 'electronics', 'firmware', 'cad'));

do $$ begin raise notice '0043 applied: cad_generations + cad_begin / cad_set_code / cad_deliver / cad_fail'; end $$;
