-- ============================================================================
-- Gestaltung — 0102: credits are spent by the server only
--                    (security audit 2026-10, findings DB-04 / DB-06)
-- ============================================================================
-- Problem: spend_credit(p_step, p_project) was granted to authenticated. Every
-- spend row it writes is redeemable as QAR 20 off a parts order for 30 days
-- (redeem_credits), so a session could turn any free credit (purchase reward,
-- edu grant, admin/print reward) into store vouchers without using any AI
-- (DB-04), and anyone holding a class join code could call it in a loop on a
-- team project and drain the teacher's paid class pack (DB-06).
--
-- This migration:
--   1. public.spend_credit_for(p_user, p_step, p_project): SECURITY DEFINER,
--      service_role only. Exactly the live spend_credit body (0096 v4) with
--      p_user in place of auth.uid() (and ai_role_of(p_user) in place of
--      ai_role()). The AI routes call it through the service client after
--      the model answered (lib/credits/server.ts spend()), with the user id
--      the route verified with auth.getUser().
--   2. Revokes EXECUTE on spend_credit from public, anon and authenticated.
--      Internal SQL callers keep working: cad_deliver (0090, SECURITY
--      DEFINER, owned by postgres) calls spend_credit as its owner, with the
--      caller's auth.uid() still set.
--   3. CAD voucher path (audit G-C1): cad_begin + cad_set_code + cad_deliver
--      were all callable by a session, so a session could store ANY text as
--      the "code" (no model call) and let cad_deliver mint the same
--      redeemable spend:<project> row. public.cad_set_code_for(p_user, p_id,
--      p_scad, p_model): SECURITY DEFINER, service_role only, the 0043 body
--      with p_user in place of auth.uid() (and ai_role_of(p_user) = 'admin'
--      in place of is_super_admin()); the generation must belong to p_user.
--      EXECUTE on cad_set_code(uuid, text, text) is revoked from public, anon
--      and authenticated. cad_begin / cad_deliver / cad_fail stay
--      session-callable: without stored code cad_deliver raises not_ready, and
--      only the server (after a validated model answer) can store code.
--   credit_can_use is unchanged.
--
-- App side (same commit): spend() uses spend_credit_for via the service
-- client; no service key → { ok: false, error: "unavailable" } (the user keeps
-- the AI answer and is not charged, as for any other spend failure). Until
-- this runs, spend() falls back to spend_credit on the caller's session.
-- The CAD routes (app/api/cad, studio/enclosure, studio/product/unlock and
-- lib/cad/cloud-flow.ts) store code with setCadCode() (lib/credits/server.ts):
-- cad_set_code_for through the service client with the verified user id;
-- no service key → the route answers 503 before the model call; before this
-- runs (PGRST202) it falls back to cad_set_code on the caller's session.
--
-- RUN AFTER 0099 (and 0100-0101). Safe to re-run.
--
-- ROLLBACK (manual):
--   grant execute on function public.spend_credit(text, uuid) to authenticated;
--   drop function if exists public.spend_credit_for(uuid, text, uuid);
--   grant execute on function public.cad_set_code(uuid, text, text) to authenticated;
--   drop function if exists public.cad_set_code_for(uuid, uuid, text, text);
--   notify pgrst, 'reload schema';
--   (the app then falls back to spend_credit / cad_set_code by itself)
-- ============================================================================

create or replace function public.spend_credit_for(p_user uuid, p_step text, p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := p_user;
  v_role    text := public.ai_role_of(p_user);
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

revoke all on function public.spend_credit_for(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.spend_credit_for(uuid, text, uuid) to service_role;

-- The browser may no longer call spend_credit; SECURITY DEFINER callers
-- (cad_deliver) run it as their owner and are unaffected.
revoke all on function public.spend_credit(text, uuid) from public, anon, authenticated;

-- ─── 3. cad_set_code_for: the server stores CAD code for a verified user ────
-- The 0043 cad_set_code body, acting as p_user. Raises sign_in (no user),
-- bad_code, too_large, not_found (not p_user's pending generation).
create or replace function public.cad_set_code_for(p_user uuid, p_id uuid, p_scad text, p_model text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then raise exception 'sign_in'; end if;
  if nullif(btrim(coalesce(p_scad, '')), '') is null then raise exception 'bad_code'; end if;
  if length(p_scad) > 40000 then raise exception 'too_large'; end if;
  update public.cad_generations
     set scad = p_scad, model = left(p_model, 100)
   where id = p_id
     and status = 'pending'
     and (user_id = p_user or public.ai_role_of(p_user) = 'admin');
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function public.cad_set_code_for(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cad_set_code_for(uuid, uuid, text, text) to service_role;

-- Without client-side cad_set_code, a session can no longer turn a free CAD
-- credit into a spend:<project> voucher row through cad_deliver.
revoke all on function public.cad_set_code(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';

do $$ begin raise notice '0102 applied: spend_credit_for + cad_set_code_for (service_role); spend_credit and cad_set_code no longer client-callable'; end $$;
