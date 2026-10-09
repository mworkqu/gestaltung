-- ============================================================================
-- Gestaltung — 0052: no free circuit (owner decision, 2026-10-09)
-- ============================================================================
-- Run AFTER 0051. Safe to re-run (create or replace only; no data changes).
--
-- Owner: "Free is too much free." The free tier is the parts list (bom step)
-- ONLY. Every wiring diagram / circuit costs 1 wiring credit, including the
-- first one on a project. 3D models already cost 1 cad credit (unchanged).
--
-- Replaces two 0042 functions:
--   credit_can_use(p_step, p_project)  the wiring branch no longer returns
--                                      cost 'free' when projects.free_wiring_used
--                                      is false: a user needs >= 1 wiring credit
--                                      (else reason 'no_credits', cost 'credit').
--   spend_credit(p_step, p_project)    the wiring step always writes a
--                                      'spend:' row (-1 wiring), like every
--                                      later circuit did before.
-- Unchanged: bom (always allowed, rate-limited by bom_rate_check), anonymous
-- (blocked: 'sign_in'), admin (never charged), cad (regens, then 1 credit).
--
-- projects.free_wiring_used is KEPT (not dropped) and no longer gates anything.
-- spend_credit still flips it to true on the first PAID circuit of a project,
-- only as a "first circuit drawn" marker: the 0046 trigger on that column
-- (projects AFTER UPDATE OF free_wiring_used) queues the first_circuit email,
-- once per user. Kind names are unchanged.
--
-- The TS side (lib/credits/server.ts) already applies the same rule before
-- this runs: it treats a 'free' answer as needing a credit and charges it.
-- ============================================================================

-- ─── can_use: may the caller run this step on this project right now? ───────
-- Returns {allowed, reason, cost, role, balance, regens}
--   reason: null | 'sign_in' | 'no_credits' | 'not_found' | 'bad_step'
--   cost:   'none' (bom/admin) | 'credit' | 'included' (cad regen)
create or replace function public.credit_can_use(p_step text, p_project uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := public.ai_role();
  v_p    record;
  v_bal  integer;
begin
  if p_step not in ('bom', 'wiring', 'cad') then
    return jsonb_build_object('allowed', false, 'reason', 'bad_step', 'cost', null, 'role', v_role);
  end if;
  if p_step = 'bom' then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'none', 'role', v_role);
  end if;
  if v_role = 'anonymous' then
    return jsonb_build_object('allowed', false, 'reason', 'sign_in', 'cost', null, 'role', v_role);
  end if;
  if v_role = 'admin' then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'none', 'role', v_role);
  end if;

  select id, cad_regens_remaining into v_p
    from public.projects where id = p_project and user_id = v_uid;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'not_found', 'cost', null, 'role', v_role);
  end if;

  v_bal := public.credit_balance_of(v_uid, p_step);

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

-- ─── spend: called AFTER a successful result ────────────────────────────────
-- wiring: always writes a 'spend:' row (-1 wiring), redeemable for 30 days;
--         the first one on a project also sets free_wiring_used (marker for
--         the first_circuit email only).
-- cad:    uses an included regeneration if any; otherwise spends 1 cad credit
--         and opens a session of 3 generations (this one + 2 more).
-- admin:  never charged, nothing written.
-- Returns {charged, cost, balance}. Raises sign_in / not_found / no_credits.
create or replace function public.spend_credit(p_step text, p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := public.ai_role();
  v_p    record;
  v_bal  integer;
begin
  if p_step not in ('wiring', 'cad') then raise exception 'bad_step'; end if;
  if v_role = 'anonymous' then raise exception 'sign_in'; end if;
  if v_role = 'admin' then
    return jsonb_build_object('charged', false, 'cost', 'none', 'balance', null);
  end if;

  -- Lock the project so two parallel calls cannot both use one cad regen.
  select id, free_wiring_used, cad_regens_remaining into v_p
    from public.projects where id = p_project and user_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;

  perform set_config('app.credits_write', 'on', true);

  if p_step = 'cad' and v_p.cad_regens_remaining > 0 then
    update public.projects set cad_regens_remaining = cad_regens_remaining - 1 where id = p_project;
    return jsonb_build_object('charged', false, 'cost', 'included', 'balance', public.credit_balance_of(v_uid, 'cad'),
                              'regens', v_p.cad_regens_remaining - 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || v_uid::text));
  v_bal := public.credit_balance_of(v_uid, p_step);
  if v_bal < 1 then raise exception 'no_credits'; end if;

  insert into public.credits_ledger (user_id, kind, delta, reason, redeemable_until, created_by)
  values (v_uid, p_step, -1, 'spend:' || p_project::text, now() + interval '30 days', v_uid);

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

do $$ begin raise notice '0052 applied: no free circuit — every wiring diagram costs 1 wiring credit (credit_can_use, spend_credit replaced)'; end $$;
