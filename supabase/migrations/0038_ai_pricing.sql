-- ============================================================================
-- Gestaltung — 0038: AI generation pricing, payment-ready (2026-09-28)
-- ============================================================================
-- Owner: every AI call costs 1 QAR. No payment gateway yet, so everything is
-- free for now, but the price is calculated and shown so switching payments
-- on later changes one setting, not the product.
--
-- 1. store_settings.ai_pricing = {"per_call_qar": 1, "charging": false}.
-- 2. project_ai_charges(project) — for the project's owner (or super_admin):
--    successful AI calls on that project (ai_usage, outcome 'ok', not test
--    rows), the price per call, whether charging is on, and the amount.
--    ai_usage itself stays super_admin-only; this returns counts, not rows.
--
-- Run after 0037. Safe to re-run.
-- ============================================================================

insert into public.store_settings (key, value)
values ('ai_pricing', '{"per_call_qar": 1, "charging": false}'::jsonb)
on conflict (key) do nothing;

create or replace function public.project_ai_charges(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_calls  integer;
  v_price  numeric;
  v_charge boolean;
begin
  if not (public.owns_project(p_project) or public.is_super_admin()) then
    raise exception 'not allowed';
  end if;

  select count(*) into v_calls
    from public.ai_usage
   where project_id = p_project and outcome = 'ok' and not coalesce(is_test, false);

  select coalesce((value ->> 'per_call_qar')::numeric, 1), coalesce((value ->> 'charging')::boolean, false)
    into v_price, v_charge
    from public.store_settings where key = 'ai_pricing';

  return jsonb_build_object(
    'calls', v_calls,
    'per_call_qar', coalesce(v_price, 1),
    'charging', coalesce(v_charge, false),
    'amount_qar', round(v_calls * coalesce(v_price, 1), 2)
  );
end $$;

revoke all on function public.project_ai_charges(uuid) from public, anon;
grant execute on function public.project_ai_charges(uuid) to authenticated;

do $$ begin raise notice '0038 applied: ai_pricing setting, project_ai_charges()'; end $$;
