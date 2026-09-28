-- ============================================================================
-- Gestaltung — 0037: restock dashboard (Part 4, Task 20)
-- ============================================================================
-- 1. store_settings.restock_weights — score weights per demand signal
--    (request 10, unmatched BOM line 8, add to cart 5, view 1). Editable.
-- 2. suppliers.min_order_value_qar — a supplier's minimum order value, so a
--    draft order shows each supplier's total against it.
-- 3. restock_receipts — stock we received: product, supplier, quantity, when.
--    Receiving marks that product's open demand signals as served (served_at),
--    never deleted, so later we can see whether stocking it converted.
-- 4. restock_summary() — one read for the dashboard: open signals per
--    product (counts per kind, requested quantity), zero-result searches and
--    unmatched BOM lines grouped, and receipts with what happened since.
--    super_admin only.
-- 5. mark_restock_received(part, supplier, qty) — records a receipt and
--    serves the open signals. super_admin only.
--
-- Run after 0036. Safe to re-run.
-- ============================================================================

insert into public.store_settings (key, value)
values ('restock_weights', '{"request": 10, "bom_unmatched": 8, "add_to_cart": 5, "view": 1}'::jsonb)
on conflict (key) do nothing;

alter table public.suppliers
  add column if not exists min_order_value_qar numeric(12, 2) check (min_order_value_qar is null or min_order_value_qar >= 0);

create table if not exists public.restock_receipts (
  id           uuid primary key default gen_random_uuid(),
  part_id      uuid not null references public.parts (id) on delete cascade,
  supplier_id  uuid references public.suppliers (id) on delete set null,
  quantity     integer not null check (quantity >= 1),
  received_at  timestamptz not null default now(),
  served       integer not null default 0,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists restock_receipts_part_idx on public.restock_receipts (part_id, received_at desc);

alter table public.restock_receipts enable row level security;
grant select on public.restock_receipts to authenticated;
drop policy if exists restock_receipts_admin_select on public.restock_receipts;
create policy restock_receipts_admin_select on public.restock_receipts
  for select to authenticated using (public.is_super_admin());

create or replace function public.restock_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare out jsonb;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;

  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(x) from (
        select d.part_id,
               count(*) filter (where d.kind = 'view')          as views,
               count(*) filter (where d.kind = 'add_to_cart')   as carts,
               count(*) filter (where d.kind = 'request')       as requests,
               coalesce(sum(d.quantity) filter (where d.kind = 'request'), 0) as requested_qty,
               max(d.created_at)                                 as last_signal
          from public.demand_signals d
         where d.served_at is null and d.part_id is not null
         group by d.part_id
      ) x), '[]'::jsonb),
    'searches', coalesce((
      select jsonb_agg(x order by x.n desc) from (
        select lower(btrim(search_term)) as term, count(*) as n, max(created_at) as last_seen
          from public.demand_signals
         where kind = 'zero_search' and served_at is null and coalesce(btrim(search_term), '') <> ''
         group by lower(btrim(search_term))
         order by count(*) desc
         limit 100
      ) x), '[]'::jsonb),
    'bom', coalesce((
      select jsonb_agg(x order by x.projects desc) from (
        select lower(btrim(bom_label)) as label,
               count(distinct project_id) as projects,
               coalesce(sum(quantity), 0) as quantity,
               max(created_at) as last_seen
          from public.demand_signals
         where kind = 'bom_unmatched' and served_at is null and coalesce(btrim(bom_label), '') <> ''
         group by lower(btrim(bom_label))
         order by count(distinct project_id) desc
         limit 100
      ) x), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(x order by x.received_at desc) from (
        select r.id, r.part_id, p.name as part_name, r.quantity, r.received_at, r.served,
               (select coalesce(sum(oi.quantity), 0) from public.part_order_items oi
                  join public.part_orders o on o.id = oi.order_id
                 where oi.part_id = r.part_id and o.created_at >= r.received_at and o.status <> 'cancelled') as sold_since,
               (select count(*) from public.demand_signals d
                 where d.part_id = r.part_id and d.kind = 'add_to_cart' and d.created_at >= r.received_at) as carts_since
          from public.restock_receipts r
          join public.parts p on p.id = r.part_id
         order by r.received_at desc
         limit 50
      ) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;

revoke all on function public.restock_summary() from public, anon;
grant execute on function public.restock_summary() to authenticated;

create or replace function public.mark_restock_received(p_part uuid, p_supplier uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt uuid;
  v_served  integer;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'quantity'; end if;

  insert into public.restock_receipts (part_id, supplier_id, quantity)
  values (p_part, p_supplier, p_quantity)
  returning id into v_receipt;

  update public.demand_signals set served_at = now()
   where part_id = p_part and served_at is null;
  get diagnostics v_served = row_count;

  update public.restock_receipts set served = v_served where id = v_receipt;
  return v_served;
end $$;

revoke all on function public.mark_restock_received(uuid, uuid, integer) from public, anon;
grant execute on function public.mark_restock_received(uuid, uuid, integer) to authenticated;

do $$ begin raise notice '0037 applied: restock weights, supplier minimum order value, receipts, restock_summary()'; end $$;
