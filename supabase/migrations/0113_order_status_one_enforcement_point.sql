-- ============================================================================
-- Gestaltung — 0113: one enforcement point for an order status change
--                    (2026-11-23)
-- ============================================================================
-- Run AFTER 0053. Safe to re-run (every object is create-or-replace).
-- Touches no table, no trigger, no data: three functions only.
--
-- WHY
-- The website changes an order status through 0053's RPC
-- public.set_order_status(uuid, text, text). That RPC starts with
--   if not public.is_super_admin() then raise exception 'not allowed'; end if;
-- and is_super_admin() reads auth.uid(). For a service-role caller auth.uid()
-- is null, so the RPC always answers 'not allowed'. The owner's Mac dashboard
-- (SwiftUI, service-role key) therefore re-implemented the rule in Swift: it
-- called order_status_transition_ok() itself, PATCHed part_orders and then
-- PATCHed the note onto the history row the trigger had written. Two code
-- paths enforced one rule and only one of them was the database's. This
-- migration gives both callers the same body.
--
-- WHAT CHANGES
-- 1. public.set_order_status_internal(p_order, p_status, p_note) — the body of
--    0053's set_order_status with the is_super_admin() check removed: status
--    validation, the row lock, 'same_status', order_status_transition_ok(),
--    the transaction-local app.order_status_note and the UPDATE. Not reachable
--    from PostgREST: execute is revoked from public, anon, authenticated AND
--    service_role, so only the two SECURITY DEFINER wrappers below (which run
--    as the function owner) can call it.
-- 2. public.set_order_status(p_order, p_status, p_note) — unchanged in
--    behaviour and in grants: super admin check, then the internal function.
--    Same return value {from, to} and the same error strings.
-- 3. public.set_order_status_service(p_order, p_status, p_note) — the new
--    entry point for a service-role caller (the Mac dashboard). Same
--    signature, same return value, same errors, minus 'not allowed'.
--
-- HOW set_order_status_service IS AUTHORISED, AND WHAT THAT IS WORTH
-- It is authorised by the database role alone: execute is revoked from
-- public, anon and authenticated and granted only to service_role. PostgREST
-- does expose anything callable by anon or authenticated, so the grant list IS
-- the access control here — a request reaches this function only when its JWT
-- resolves to service_role, which means it carried the service-role key. That
-- key already bypasses RLS and can UPDATE public.part_orders directly, so the
-- function hands out no power its caller did not already have; it only makes
-- the validated path as easy to use as the unvalidated one. 0053 set this
-- precedent in the same file: public.record_order_rating(uuid, integer) is
-- granted to service_role and nothing else.
-- No auth.uid() is involved, so order_status_history.changed_by stays null for
-- this path, exactly as it is today when the Mac app PATCHes the table.
--
-- Honest limit: this is one enforcement point that both callers CAN use, not
-- one they MUST use. A service-role caller can still skip it with a direct
-- UPDATE, and 0053 kept that on purpose ("Direct UPDATEs are not validated —
-- the Table Editor stays an escape hatch"). Making the rule unavoidable would
-- mean a BEFORE UPDATE trigger on part_orders that rejects a bad transition;
-- that would close the Table Editor hatch and would also have to be taught
-- about 0053's own status mapping and back-fill, so it is deliberately not
-- done here. It is the change to make if the owner ever wants the rule
-- enforced rather than offered.
--
-- KEPT AS IT IS (not a bug, do not "fix" it)
-- set_order_status raises 'same_status' for p_status = the current status,
-- and order_status_transition_ok(from, to) ALSO returns false when from = to.
-- The explicit check runs first, so a no-op change keeps reporting
-- 'same_status' rather than 'bad_transition'. The internal function keeps that
-- order, so both entry points keep that error.
--
-- The three triggers on a status change are untouched and still fire for both
-- entry points: part_orders_status_history (0053, appends the history row and
-- picks the note up from app.order_status_note), part_orders_notify_status
-- (0053, queues the customer email) and part_orders_grant_credits (0042,
-- grants 3 wiring + 1 cad the first time an order reaches 'delivered'; none of
-- the three is undone by moving the status back).
--
-- ROLLBACK (manual, one transaction — restores the 0053 definitions):
--   begin;
--   drop function if exists public.set_order_status_service(uuid, text, text);
--   drop function if exists public.set_order_status_internal(uuid, text, text);
--   -- then re-run section 3 of 0053_order_status_history.sql, which recreates
--   -- public.set_order_status(uuid, text, text) with the check and the body in
--   -- one function, plus its revoke/grant pair. Nothing else in 0053 is
--   -- affected by this file.
--   commit;
--   -- The Mac dashboard must go back to its own Swift guard first, or it will
--   -- get 'function does not exist' (42883) on every status change.
-- ============================================================================

begin;

-- ─── 1. The rule, in one place ──────────────────────────────────────────────
-- 0053's set_order_status body without the is_super_admin() check. The caller
-- is responsible for deciding who may call it; this decides what is a legal
-- change. Returns {from, to}. Raises: bad_status / not_found / same_status /
-- bad_transition.
create or replace function public.set_order_status_internal(p_order uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  if p_status is null or p_status not in ('confirmed', 'paid', 'sourcing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'bad_status';
  end if;

  select status into v_from from public.part_orders where id = p_order for update;
  if not found then raise exception 'not_found'; end if;
  -- Before order_status_transition_ok, which also rejects from = to: a no-op
  -- change must keep reporting 'same_status' (see the header).
  if v_from = p_status then raise exception 'same_status'; end if;
  if not public.order_status_transition_ok(v_from, p_status) then
    raise exception 'bad_transition' using detail = v_from || ' -> ' || p_status;
  end if;

  -- Transaction-local: part_orders_status_history and part_orders_notify_status
  -- read it off the UPDATE below.
  perform set_config('app.order_status_note', coalesce(left(btrim(p_note), 1000), ''), true);
  update public.part_orders set status = p_status where id = p_order;
  perform set_config('app.order_status_note', '', true);

  return jsonb_build_object('from', v_from, 'to', p_status);
end $$;

-- Not an entry point: the wrappers below are SECURITY DEFINER and run as this
-- function's owner, who keeps execute regardless of these revokes. service_role
-- is revoked too, so the only way in is through a wrapper that checks the caller.
revoke all on function public.set_order_status_internal(uuid, text, text)
  from public, anon, authenticated, service_role;

-- ─── 2. Website entry point (unchanged behaviour) ───────────────────────────
-- Raises: not allowed / bad_status / not_found / same_status / bad_transition.
create or replace function public.set_order_status(p_order uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return public.set_order_status_internal(p_order, p_status, p_note);
end $$;

revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

-- ─── 3. Service-role entry point (the Mac dashboard) ────────────────────────
-- Authorised by the grant list alone — see the header. Raises: bad_status /
-- not_found / same_status / bad_transition.
create or replace function public.set_order_status_service(p_order uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.set_order_status_internal(p_order, p_status, p_note);
end $$;

revoke all on function public.set_order_status_service(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_order_status_service(uuid, text, text) to service_role;

do $$ begin raise notice '0113 applied: set_order_status_internal (the rule), set_order_status (super admin, unchanged), set_order_status_service (service_role only)'; end $$;

commit;
