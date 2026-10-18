-- Gestaltung — 0088: ideation tokens + per-call AI cost (owner, 2026-10-18).
--
-- 1. Ideation tokens: a third credit kind, 'idea', in credits_ledger. Every
--    signed-in user (guests too) gets 5 once (reason 'idea_welcome'). A new
--    idea in the Studio chat costs 1; edits cost 1 per N chat turns, times the
--    build tier's multiplier (lib/studio/tiers.ts decides the amounts; these
--    functions only move tokens and can never add any).
--    Spends are 'idea:<project_id>' (NOT 'spend:%', so they are never
--    redeemable at checkout like wiring/cad spends).
-- 2. idea_sessions: per-project turn counter + tier, server-written only.
-- 3. ai_usage gets `step` (studio spec / pick / …) and log_ai_usage gets an
--    overload that also records step + cost_usd (computed in lib/ai/prices.ts).
-- 4. Admin cost RPCs: per-user totals for /dashboard/ai-costs.
--
-- Run after 0087 (cad-champions) — it only touches tables from 0023/0042.
-- Rollback:
--   drop function if exists public.idea_token_status(uuid);
--   drop function if exists public.idea_token_charge(uuid, integer, text, boolean);
--   drop function if exists public.admin_ai_cost_users(text);
--   drop function if exists public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric);
--   drop table if exists public.idea_sessions;
--   alter table public.ai_usage drop column if exists step;
--   (credits_ledger: delete from public.credits_ledger where kind = 'idea'; then restore the 0042 kind check)

-- ─── credits_ledger: kind 'idea' ────────────────────────────────────────────
alter table public.credits_ledger drop constraint if exists credits_ledger_kind_check;
alter table public.credits_ledger add constraint credits_ledger_kind_check
  check (kind in ('wiring', 'cad', 'idea'));

-- One welcome grant per user, however often it is asked for.
create unique index if not exists credits_ledger_idea_welcome_once
  on public.credits_ledger (user_id)
  where kind = 'idea' and reason = 'idea_welcome';

-- Mirror of IDEATION.welcomeTokens in lib/studio/tiers.ts — change both.
create or replace function public.idea_welcome_tokens()
returns integer language sql immutable set search_path = '' as $$ select 5 $$;

-- ─── idea_sessions ──────────────────────────────────────────────────────────
create table if not exists public.idea_sessions (
  project_id   uuid primary key references public.projects (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  -- Chat turns that reached the model once the understanding existed.
  edit_turns   integer not null default 0,
  tokens_used  integer not null default 0,
  tier         text not null default 'explorer',
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idea_sessions_user_idx on public.idea_sessions (user_id);

alter table public.idea_sessions enable row level security;
revoke insert, update, delete on public.idea_sessions from anon, authenticated;
grant select on public.idea_sessions to authenticated;

drop policy if exists idea_sessions_select on public.idea_sessions;
create policy idea_sessions_select on public.idea_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- ─── Status (grants the welcome tokens on first sight) ──────────────────────
-- {role, balance, started, edit_turns, tokens_used, tier}
create or replace function public.idea_token_status(p_project uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := public.ai_role();
  v_s    public.idea_sessions;
begin
  if v_uid is null then
    return jsonb_build_object('role', 'anonymous', 'balance', 0, 'started', false, 'edit_turns', 0, 'tokens_used', 0, 'tier', 'explorer');
  end if;

  insert into public.credits_ledger (user_id, kind, delta, reason, note)
  values (v_uid, 'idea', public.idea_welcome_tokens(), 'idea_welcome', 'Welcome ideation tokens')
  on conflict do nothing;

  if p_project is not null and public.owns_project(p_project) then
    select * into v_s from public.idea_sessions where project_id = p_project;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'balance', public.credit_balance_of(v_uid, 'idea'),
    'started', v_s.project_id is not null,
    'edit_turns', coalesce(v_s.edit_turns, 0),
    'tokens_used', coalesce(v_s.tokens_used, 0),
    'tier', coalesce(v_s.tier, 'explorer')
  );
end $$;

revoke all on function public.idea_token_status(uuid) from public;
grant execute on function public.idea_token_status(uuid) to authenticated;

-- ─── Charge one chat turn ───────────────────────────────────────────────────
-- p_amount: tokens for this turn (0 = free turn, still counted), 0..20.
-- p_edit:   true for a turn on an existing understanding (edit_turns + 1).
-- Admins are never charged. Returns {ok, charged, balance, edit_turns, tokens_used}
-- or {ok:false, error:'no_tokens'|'not_found'|'sign_in', balance}.
create or replace function public.idea_token_charge(p_project uuid, p_amount integer, p_tier text, p_edit boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_amount  integer := greatest(0, least(coalesce(p_amount, 0), 20));
  v_tier    text := case when p_tier in ('explorer', 'maker', 'engineer') then p_tier else 'explorer' end;
  v_balance integer;
  v_s       public.idea_sessions;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'sign_in', 'balance', 0); end if;
  if p_project is null or not public.owns_project(p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'balance', 0);
  end if;
  if public.is_super_admin() then v_amount := 0; end if;

  -- One charge at a time per user (two tabs cannot overspend).
  perform pg_advisory_xact_lock(hashtext('idea:' || v_uid::text));

  insert into public.credits_ledger (user_id, kind, delta, reason, note)
  values (v_uid, 'idea', public.idea_welcome_tokens(), 'idea_welcome', 'Welcome ideation tokens')
  on conflict do nothing;

  v_balance := public.credit_balance_of(v_uid, 'idea');
  if v_amount > v_balance then
    return jsonb_build_object('ok', false, 'error', 'no_tokens', 'balance', v_balance);
  end if;

  if v_amount > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (v_uid, 'idea', -v_amount, 'idea:' || p_project::text, case when p_edit then 'Idea edits' else 'New idea' end);
  end if;

  insert into public.idea_sessions as s (project_id, user_id, edit_turns, tokens_used, tier)
  values (p_project, v_uid, case when p_edit then 1 else 0 end, v_amount, v_tier)
  on conflict (project_id) do update
    set edit_turns  = s.edit_turns + case when p_edit then 1 else 0 end,
        tokens_used = s.tokens_used + v_amount,
        tier        = v_tier,
        updated_at  = now()
  returning * into v_s;

  return jsonb_build_object(
    'ok', true,
    'charged', v_amount,
    'balance', v_balance - v_amount,
    'edit_turns', v_s.edit_turns,
    'tokens_used', v_s.tokens_used
  );
end $$;

revoke all on function public.idea_token_charge(uuid, integer, text, boolean) from public;
grant execute on function public.idea_token_charge(uuid, integer, text, boolean) to authenticated;

-- ─── admin_grant: allow 'idea' top-ups ──────────────────────────────────────
create or replace function public.admin_grant(p_user uuid, p_kind text, p_amount integer, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_kind not in ('wiring', 'cad', 'idea') then raise exception 'bad_kind'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000 then raise exception 'bad_amount'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'note_required'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'no_user'; end if;
  if p_amount < 0 and public.credit_balance_of(p_user, p_kind) + p_amount < 0 then
    raise exception 'below_zero';
  end if;
  insert into public.credits_ledger (user_id, kind, delta, reason, note, created_by)
  values (p_user, p_kind, p_amount, 'admin_grant', btrim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ─── ai_usage: step + cost on every call ────────────────────────────────────
alter table public.ai_usage add column if not exists step text;
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at);

-- Same as 0023's log_ai_usage plus p_step and p_cost_usd (an overload: the
-- old 13-argument form keeps working for anything not yet updated).
create or replace function public.log_ai_usage(
  p_provider text, p_model text, p_project uuid, p_feature text,
  p_prompt_tokens integer, p_completion_tokens integer, p_total_tokens integer,
  p_audio_seconds numeric, p_latency_ms integer, p_outcome text, p_error_code text,
  p_remaining_requests integer, p_remaining_tokens integer,
  p_step text, p_cost_usd numeric
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.ai_usage (
    provider, model, project_id, user_id, feature, prompt_tokens, completion_tokens,
    total_tokens, audio_seconds, latency_ms, outcome, error_code, remaining_requests, remaining_tokens,
    step, cost_usd
  ) values (
    left(p_provider, 40), left(p_model, 80),
    case when p_project is not null and public.owns_project(p_project) then p_project end,
    auth.uid(), p_feature, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_audio_seconds, p_latency_ms, p_outcome, left(p_error_code, 60),
    p_remaining_requests, p_remaining_tokens,
    left(p_step, 40), case when p_cost_usd is null then null else greatest(0, least(p_cost_usd, 100)) end
  );
end $$;

revoke all on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric) from public;
grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric) to authenticated;

-- ─── Admin: every user with AI activity, grouped per model ──────────────────
-- One row per (user, model). cost_usd sums logged costs; tokens_unpriced_in/out
-- are tokens on rows logged before 0088 (no cost) so the page can price them
-- with lib/ai/prices.ts. Idea-token figures repeat on each of a user's rows.
create or replace function public.admin_ai_cost_users(p_query text default null)
returns table (
  user_id uuid, email text, full_name text, is_anonymous boolean,
  model text, calls bigint, tokens_in bigint, tokens_out bigint, cost_usd numeric,
  tokens_unpriced_in bigint, tokens_unpriced_out bigint, last_call timestamptz,
  projects bigint, idea_used bigint, idea_balance integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return query
    with users as (
      select distinct x.uid from (
        select u.user_id as uid from public.ai_usage u where u.user_id is not null
        union
        select l.user_id from public.credits_ledger l where l.kind = 'idea' and l.reason like 'idea:%'
      ) x
    ),
    usage as (
      select u.user_id as uid, coalesce(u.model, '—') as model,
             count(*) filter (where u.outcome <> 'blocked') as calls,
             coalesce(sum(u.prompt_tokens), 0)::bigint as tin,
             coalesce(sum(u.completion_tokens), 0)::bigint as tout,
             coalesce(sum(u.cost_usd), 0) as cost,
             coalesce(sum(u.prompt_tokens) filter (where u.cost_usd is null), 0)::bigint as uin,
             coalesce(sum(u.completion_tokens) filter (where u.cost_usd is null), 0)::bigint as uout,
             max(u.created_at) as last_call
        from public.ai_usage u
       where u.user_id is not null
       group by 1, 2
    )
    select us.uid, coalesce(p.email, au.email), p.full_name, coalesce(au.is_anonymous, false),
           g.model, coalesce(g.calls, 0), coalesce(g.tin, 0), coalesce(g.tout, 0), coalesce(g.cost, 0),
           coalesce(g.uin, 0), coalesce(g.uout, 0), g.last_call,
           (select count(*) from public.projects pr where pr.user_id = us.uid),
           (select coalesce(-sum(l.delta), 0)::bigint from public.credits_ledger l
             where l.user_id = us.uid and l.kind = 'idea' and l.reason like 'idea:%'),
           public.credit_balance_of(us.uid, 'idea')
      from users us
      left join usage g on g.uid = us.uid
      left join public.profiles p on p.id = us.uid
      left join auth.users au on au.id = us.uid
     where v_q is null
        or coalesce(p.email, au.email) ilike '%' || v_q || '%'
        or p.full_name ilike '%' || v_q || '%'
        or us.uid::text = v_q
     order by g.last_call desc nulls last
     limit 2000;
end $$;

revoke all on function public.admin_ai_cost_users(text) from public, anon;
grant execute on function public.admin_ai_cost_users(text) to authenticated;

do $$ begin raise notice '0088 applied: ideation tokens (kind idea, 5 welcome), idea_sessions, ai_usage.step + cost, admin_ai_cost_users'; end $$;
