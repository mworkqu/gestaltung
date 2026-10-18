-- Gestaltung — 0090: CAD credits scaled by complexity + loyalty rewards (owner, 2026-10-18).
-- Run after 0089.
--
-- 1. A new CAD session costs cad_tier_cost(tier) CAD credits: simple 1,
--    standard 2, complex 3 (mirror of CAD_CREDIT_COST in lib/credits/cad-cost.ts).
--    spend_credit('cad') still takes the first credit and opens the session's
--    included regenerations; cad_deliver takes the rest as 'cad_extra:<project>'
--    (not redeemable, no email). cad_begin refuses up front when the balance is short.
-- 2. Rewards (rebates, not refunds), amounts in store_settings 'rewards'
--    ({order_idea_tokens, print_cad_credits}; defaults 2 and 1):
--      * every delivered parts order → ideation tokens ('reward:<order>'), on top
--        of the 0042 order credits;
--      * every completed printed-STL order → CAD credits ('print:<lead>'), granted
--        by an admin from the print request (admin_reward_print).
--
-- Rollback: re-run 0043 (cad_begin / cad_deliver) and 0042 (grant_credits_for_order_internal);
--   drop function if exists public.cad_tier_cost(text), public.reward_setting(text, integer), public.admin_reward_print(uuid, uuid);
--   alter table public.cad_generations drop column if exists credit_cost;

create or replace function public.cad_tier_cost(p_tier text)
returns integer language sql immutable set search_path = '' as $$
  select case p_tier when 'complex' then 3 when 'standard' then 2 else 1 end
$$;

alter table public.cad_generations add column if not exists credit_cost integer not null default 1;

-- store_settings 'rewards' value, or the default.
create or replace function public.reward_setting(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select greatest(0, least((value ->> p_key)::integer, 50)) from public.store_settings where key = 'rewards'),
    p_default)
$$;

revoke all on function public.reward_setting(text, integer) from public, anon, authenticated;

insert into public.store_settings (key, value)
values ('rewards', jsonb_build_object('order_idea_tokens', 2, 'print_cad_credits', 1))
on conflict (key) do nothing;

-- ─── cad_begin: 0043 + the tier's credit cost ───────────────────────────────
create or replace function public.cad_begin(p_project uuid, p_request text, p_tier text, p_parent uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_can  jsonb;
  v_id   uuid;
  v_cost integer;
begin
  if p_tier is null or p_tier not in ('simple', 'standard', 'complex') then raise exception 'bad_tier'; end if;
  if nullif(btrim(coalesce(p_request, '')), '') is null then raise exception 'bad_request'; end if;

  v_can := public.credit_can_use('cad', p_project);
  if not coalesce((v_can ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_can ->> 'reason', 'not_found');
  end if;
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

  v_cost := public.cad_tier_cost(p_tier);
  -- A new session (not an included regeneration) needs the whole tier cost up front.
  if v_can ->> 'role' <> 'admin' and v_can ->> 'cost' = 'credit'
     and public.credit_balance_of(v_uid, 'cad') < v_cost then
    raise exception 'no_credits';
  end if;

  if v_can ->> 'role' <> 'admin' then
    perform pg_advisory_xact_lock(hashtext('cad:' || v_uid::text));
    if (select count(*) from public.cad_generations
         where user_id = v_uid and status <> 'delivered' and scad is not null
           and created_at > now() - interval '24 hours') >= 5 then
      raise exception 'too_many_failed';
    end if;
  end if;

  insert into public.cad_generations (project_id, user_id, parent_id, request, tier, credit_cost)
  values (p_project, v_uid, p_parent, left(btrim(p_request), 4000), p_tier, v_cost)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.cad_begin(uuid, text, text, uuid) from public, anon;
grant execute on function public.cad_begin(uuid, text, text, uuid) to authenticated;

-- ─── cad_deliver: 0043 + the rest of the tier cost ──────────────────────────
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
  v_extra integer;
begin
  if v_uid is null then raise exception 'sign_in'; end if;
  select id, project_id, status, scad, charged, credit_cost into v_g
    from public.cad_generations where id = p_id and user_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_g.status = 'delivered' then
    select cad_regens_remaining into v_regen from public.projects where id = v_g.project_id;
    return jsonb_build_object('charged', v_g.charged, 'regens', v_regen,
                              'balance', public.credit_balance_of(v_uid, 'cad'));
  end if;
  if v_g.status <> 'pending' or v_g.scad is null then raise exception 'not_ready'; end if;

  v_spend := public.spend_credit('cad', v_g.project_id);

  if coalesce((v_spend ->> 'charged')::boolean, false) and coalesce(v_g.credit_cost, 1) > 1 then
    v_extra := least(v_g.credit_cost - 1, greatest(public.credit_balance_of(v_uid, 'cad'), 0));
    if v_extra > 0 then
      insert into public.credits_ledger (user_id, kind, delta, reason, note, created_by)
      values (v_uid, 'cad', -v_extra, 'cad_extra:' || v_g.project_id::text, 'CAD complexity', v_uid);
    end if;
  end if;

  update public.cad_generations
     set status = 'delivered',
         delivered_at = now(),
         charged = coalesce((v_spend ->> 'charged')::boolean, false)
   where id = p_id;

  select cad_regens_remaining into v_regen from public.projects where id = v_g.project_id;
  return jsonb_build_object('charged', coalesce((v_spend ->> 'charged')::boolean, false),
                            'regens', v_regen,
                            'cost', coalesce(v_g.credit_cost, 1),
                            'balance', public.credit_balance_of(v_uid, 'cad'));
end $$;

revoke all on function public.cad_deliver(uuid) from public, anon;
grant execute on function public.cad_deliver(uuid) to authenticated;

-- ─── Parts order delivered: 0042 credits + ideation tokens back ─────────────
create or replace function public.grant_credits_for_order_internal(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_n      integer;
  v_tokens integer := public.reward_setting('order_idea_tokens', 2);
begin
  select profile_id into v_user from public.part_orders where id = p_order;
  if v_user is null then return false; end if;
  insert into public.credits_ledger (user_id, kind, delta, reason, note)
  values (v_user, 'wiring', 3, 'purchase:' || p_order::text, 'Completed store order'),
         (v_user, 'cad',    1, 'purchase:' || p_order::text, 'Completed store order')
  on conflict (user_id, kind, reason) where reason like 'purchase:%' do nothing;
  get diagnostics v_n = row_count;
  if v_tokens > 0 and not exists (
    select 1 from public.credits_ledger where user_id = v_user and kind = 'idea' and reason = 'reward:' || p_order::text
  ) then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (v_user, 'idea', v_tokens, 'reward:' || p_order::text, 'Parts order rebate');
  end if;
  return v_n > 0;
end $$;

revoke all on function public.grant_credits_for_order_internal(uuid) from public, anon, authenticated;

-- ─── Printed-STL order completed: CAD credits to the project's owner ────────
-- Returns the credits granted (0 = already granted). Idempotent per lead. The project is
-- the lead's project_id, else p_project (the link in the print request's message).
create or replace function public.admin_reward_print(p_lead uuid, p_project uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_credits integer := public.reward_setting('print_cad_credits', 1);
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  select p.user_id into v_user
    from public.inquiries i join public.projects p on p.id = coalesce(i.project_id, p_project)
   where i.id = p_lead;
  if v_user is null then raise exception 'no_owner'; end if;
  if v_credits <= 0 or exists (
    select 1 from public.credits_ledger where user_id = v_user and kind = 'cad' and reason = 'print:' || p_lead::text
  ) then
    return 0;
  end if;
  insert into public.credits_ledger (user_id, kind, delta, reason, note, created_by)
  values (v_user, 'cad', v_credits, 'print:' || p_lead::text, 'Printed order reward', auth.uid());
  return v_credits;
end $$;

revoke all on function public.admin_reward_print(uuid, uuid) from public, anon;
grant execute on function public.admin_reward_print(uuid, uuid) to authenticated;

do $$ begin raise notice '0090 applied: CAD cost by complexity (1/2/3), parts-order token rebate, print reward'; end $$;
