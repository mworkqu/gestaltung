-- Gestaltung — 0092: paid engineer services (owner, 2026-10-18). Run after 0091.
--
-- "Assembled by an engineer", "CAD by an engineer" and the PCB / Gerber path
-- are bought like tokens: a payments row (kind 'service') paid by Fawran and
-- checked automatically (0089). The quote (components, wires, hours) is
-- computed on the server from the saved Studio doc (lib/services/quote.ts) and
-- stored in payments.meta. When the payment is approved — automatically or by
-- an admin — an engineering_jobs row (0091) of that kind opens with the quote,
-- and the work runs through /dashboard/engineering-jobs like a STEP job.
-- Prices: store_settings 'engineer_services' (admin-editable).
--
-- Rollback:
--   drop function if exists public.payment_create_service(uuid, text, numeric, uuid, jsonb, boolean);
--   alter table public.payments drop column if exists meta;
--   (and re-run 0089 for payment_apply_internal)

alter table public.payments add column if not exists meta jsonb;

insert into public.store_settings (key, value)
values ('engineer_services', jsonb_build_object(
  'assembly', jsonb_build_object('base_qar', 100, 'per_component_qar', 5, 'per_connection_qar', 2, 'days', 3),
  'cad_engineer', jsonb_build_object('base_qar', 200, 'hourly_qar', 60, 'base_hours', 2, 'days', 2),
  'pcb_gerber', jsonb_build_object('base_qar', 150, 'per_component_qar', 5, 'days', 3),
  'round_to_qar', 5))
on conflict (key) do nothing;

-- Service role only: the server route computed p_amount and p_meta (quote) itself.
create or replace function public.payment_create_service(
  p_user uuid, p_service text, p_amount numeric, p_project uuid, p_meta jsonb, p_is_test boolean default false
) returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payments;
begin
  if p_service not in ('assembly', 'cad_engineer', 'pcb_gerber') then raise exception 'bad_service'; end if;
  if not exists (select 1 from public.projects where id = p_project and user_id = p_user) then raise exception 'not_found'; end if;
  if exists (select 1 from public.engineering_jobs where project_id = p_project and kind = p_service and status in ('queued', 'in_progress')) then
    raise exception 'already_open';
  end if;
  v_row := public.payment_create(p_user, 'service', p_service || ':' || p_project::text, p_amount, 0, null, null, p_is_test);
  update public.payments
     set meta = coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('service', p_service, 'project_id', p_project)
   where id = v_row.id
   returning * into v_row;
  return v_row;
end $$;

revoke all on function public.payment_create_service(uuid, text, numeric, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.payment_create_service(uuid, text, numeric, uuid, jsonb, boolean) to service_role;

-- 0089's grant, now with services: an approved service payment opens its job (once).
create or replace function public.payment_apply_internal(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p     public.payments;
  v_bal integer;
  v_add integer;
  v_kind text;
  v_project uuid;
  v_days integer;
begin
  select * into p from public.payments where id = p_payment for update;
  if p.kind = 'tokens' and p.tokens > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (p.user_id, 'idea', p.tokens, 'topup:' || p.id::text, p.product);
  elsif p.kind = 'pass' then
    perform public.idea_pass_sweep(p.user_id);
    insert into public.idea_passes as s (user_id, active_until, last_payment_id)
    values (p.user_id, now() + make_interval(days => coalesce(p.days, 30)), p.id)
    on conflict (user_id) do update
      set active_until = greatest(s.active_until, now()) + make_interval(days => coalesce(p.days, 30)),
          last_payment_id = p.id,
          started_at = case when s.active_until < now() then now() else s.started_at end,
          updated_at = now();
    v_bal := public.credit_balance_of(p.user_id, 'idea_pass');
    v_add := least(p.tokens, greatest(coalesce(p.cap, p.tokens * 2) - v_bal, 0));
    if v_add > 0 then
      insert into public.credits_ledger (user_id, kind, delta, reason, note)
      values (p.user_id, 'idea_pass', v_add, 'pass:' || p.id::text, 'Maker Pass month');
    end if;
  elsif p.kind = 'service' then
    v_kind := p.meta ->> 'service';
    v_project := nullif(p.meta ->> 'project_id', '')::uuid;
    v_days := coalesce((p.meta -> 'quote' ->> 'days')::integer, 3);
    if v_kind in ('assembly', 'cad_engineer', 'pcb_gerber')
       and not exists (select 1 from public.engineering_jobs where payment_id = p.id) then
      insert into public.engineering_jobs (project_id, user_id, kind, tokens, payment_id, eta_at, snapshot, quote, note)
      values (v_project, p.user_id, v_kind, 0, p.id, now() + make_interval(days => greatest(v_days, 1)),
              p.meta -> 'snapshot', p.meta -> 'quote', nullif(p.meta ->> 'note', ''));
    end if;
  end if;
end $$;

revoke all on function public.payment_apply_internal(uuid) from public, anon, authenticated;

-- 0089's revoke, now with services: a revoked service payment cancels its open job.
create or replace function public.payment_unapply_internal(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.payments;
  v_take integer;
begin
  select * into p from public.payments where id = p_payment for update;
  if p.kind = 'tokens' then
    v_take := least(p.tokens, greatest(public.credit_balance_of(p.user_id, 'idea'), 0));
    if v_take > 0 then
      insert into public.credits_ledger (user_id, kind, delta, reason, note)
      values (p.user_id, 'idea', -v_take, 'revoke:' || p.id::text, 'Payment revoked');
    end if;
  elsif p.kind = 'pass' then
    update public.idea_passes set active_until = now(), updated_at = now() where user_id = p.user_id;
    perform public.idea_pass_sweep(p.user_id);
  elsif p.kind = 'service' then
    update public.engineering_jobs set status = 'cancelled', admin_note = 'Payment revoked', updated_at = now()
     where payment_id = p.id and status in ('queued', 'in_progress');
  end if;
end $$;

revoke all on function public.payment_unapply_internal(uuid) from public, anon, authenticated;

do $$ begin raise notice '0092 applied: engineer services (assembly, cad_engineer, pcb_gerber) paid by Fawran open engineering jobs'; end $$;
