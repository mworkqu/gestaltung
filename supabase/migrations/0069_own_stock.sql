-- ============================================================================
-- Gestaltung — 0069: own stock ("In stock in Lusail") (P5-12, 2026-10-10)
-- ============================================================================
-- Run AFTER 0068. Safe to re-run. NOT RUN YET (written by Claude; the owner runs it).
--
-- WHY
-- The owner buys stock to hold himself. 0037 already records a receipt
-- (restock_receipts) when stock arrives, but nothing keeps a running count of
-- what is on the shelf, and the public product page cannot say "In stock in
-- Lusail". This adds both, reusing the 0037 receipt flow.
--
-- WHAT CHANGES
-- 1. own_stock(part_id, qty): units we hold. Super admin only (RLS). The
--    number never reaches the public.
-- 2. parts.in_own_stock boolean: true while own_stock.qty > 0. Kept in step by
--    a trigger. This is the ONLY thing the storefront reads (anon already
--    reads published parts rows; the quantity stays in own_stock).
-- 3. mark_restock_received(part, supplier, qty) is REPLACED (same signature,
--    same behaviour as 0037) and now also adds qty to own_stock. The "I bought
--    these" button on /dashboard/store/stock calls it.
-- 4. set_own_stock(part, qty): super admin sets the count by hand (stock take,
--    a loss, a correction).
-- 5. Sales count down: AFTER INSERT on part_order_items takes the ordered
--    quantity off own_stock (never below 0). A cancelled order does NOT put
--    the units back; use set_own_stock to correct.
-- 6. Back-fill: own_stock starts from the total of existing restock_receipts.
--
-- Until this runs: /dashboard/store/stock falls back to the receipts total as
-- "own stock" (it never counts down), shows a "run 0069" note to the admin
-- only, and the product page shows nothing (parts.in_own_stock is absent).
--
-- DRY RUN (read-only):
--   select count(*) as receipts, coalesce(sum(quantity), 0) as units from public.restock_receipts;
--
-- ROLLBACK (manual):
--   drop trigger  if exists part_order_items_own_stock on public.part_order_items;
--   drop trigger  if exists own_stock_sync_flag on public.own_stock;
--   drop function if exists public.part_order_items_own_stock();
--   drop function if exists public.own_stock_sync_flag();
--   drop function if exists public.set_own_stock(uuid, integer);
--   alter table public.parts drop column if exists in_own_stock;
--   drop table    if exists public.own_stock;
--   -- then re-run the mark_restock_received block from 0037.
-- ============================================================================

-- 1. Own stock: the count, admin only.
create table if not exists public.own_stock (
  part_id    uuid primary key references public.parts (id) on delete cascade,
  qty        integer not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now()
);

alter table public.own_stock enable row level security;
grant select, insert, update, delete on public.own_stock to authenticated;

drop policy if exists own_stock_admin_all on public.own_stock;
create policy own_stock_admin_all on public.own_stock
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- 2. The public flag on the product row (boolean only).
alter table public.parts
  add column if not exists in_own_stock boolean not null default false;

create or replace function public.own_stock_sync_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_part uuid := coalesce(new.part_id, old.part_id);
  v_have boolean;
begin
  v_have := exists (select 1 from public.own_stock where part_id = v_part and qty > 0);
  update public.parts set in_own_stock = v_have
   where id = v_part and in_own_stock is distinct from v_have;
  return null;
end $$;

revoke all on function public.own_stock_sync_flag() from public, anon, authenticated;

drop trigger if exists own_stock_sync_flag on public.own_stock;
create trigger own_stock_sync_flag
  after insert or update or delete on public.own_stock
  for each row execute function public.own_stock_sync_flag();

-- 3. "I bought these": the 0037 receipt + served signals, plus the shelf count.
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

  insert into public.own_stock (part_id, qty) values (p_part, p_quantity)
  on conflict (part_id) do update
    set qty = public.own_stock.qty + excluded.qty, updated_at = now();

  return v_served;
end $$;

revoke all on function public.mark_restock_received(uuid, uuid, integer) from public, anon;
grant execute on function public.mark_restock_received(uuid, uuid, integer) to authenticated;

-- 4. Set the count by hand.
create or replace function public.set_own_stock(p_part uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'quantity'; end if;
  insert into public.own_stock (part_id, qty) values (p_part, p_qty)
  on conflict (part_id) do update set qty = excluded.qty, updated_at = now();
end $$;

revoke all on function public.set_own_stock(uuid, integer) from public, anon;
grant execute on function public.set_own_stock(uuid, integer) to authenticated;

-- 5. Sales count down.
create or replace function public.part_order_items_own_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.part_id is not null and coalesce(new.quantity, 0) > 0 then
    update public.own_stock
       set qty = greatest(qty - new.quantity, 0), updated_at = now()
     where part_id = new.part_id and qty > 0;
  end if;
  return null;
end $$;

revoke all on function public.part_order_items_own_stock() from public, anon, authenticated;

drop trigger if exists part_order_items_own_stock on public.part_order_items;
create trigger part_order_items_own_stock
  after insert on public.part_order_items
  for each row execute function public.part_order_items_own_stock();

-- 6. Back-fill from the receipts already recorded (only where no count exists yet).
insert into public.own_stock (part_id, qty)
select r.part_id, sum(r.quantity)::integer
  from public.restock_receipts r
 group by r.part_id
on conflict (part_id) do nothing;

do $$ begin raise notice '0069 applied: own_stock, parts.in_own_stock, mark_restock_received now counts stock, set_own_stock, sales count down'; end $$;
