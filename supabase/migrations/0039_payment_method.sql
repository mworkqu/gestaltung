-- ============================================================================
-- Gestaltung — 0039: how the customer will pay (2026-09-29)
-- ============================================================================
-- Owner: offer cash on delivery, Fawran (to the alias CR-236988) and bank
-- transfer to the company's QIIB account. No payment gateway: the order
-- records the chosen method; the owner confirms payment by hand.
--
-- 1. part_orders.payment_method — cash_on_delivery | fawran | bank_transfer.
-- 2. set_order_payment_method(order, method) — checkout calls it right after
--    create_part_order (whose signature stays unchanged). A guest cannot read
--    their order under RLS, so this is SECURITY DEFINER and only fills an
--    EMPTY method on an order placed in the last hour — the order id alone
--    can't be used to change anything later.
--
-- Run after 0038. Safe to re-run.
-- ============================================================================

alter table public.part_orders
  add column if not exists payment_method text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'part_orders_payment_method_check') then
    alter table public.part_orders add constraint part_orders_payment_method_check
      check (payment_method is null or payment_method in ('cash_on_delivery', 'fawran', 'bank_transfer'));
  end if;
end $$;

create or replace function public.set_order_payment_method(p_order uuid, p_method text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if p_method not in ('cash_on_delivery', 'fawran', 'bank_transfer') then raise exception 'bad payment method'; end if;
  update public.part_orders
     set payment_method = p_method
   where id = p_order
     and payment_method is null
     and created_at > now() - interval '1 hour';
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.set_order_payment_method(uuid, text) from public;
grant execute on function public.set_order_payment_method(uuid, text) to anon, authenticated;

do $$ begin raise notice '0039 applied: part_orders.payment_method, set_order_payment_method()'; end $$;
