-- ============================================================================
-- Gestaltung — 0028: suppliers, supplier offers, pricing modes (Part 4, Task 16)
-- ============================================================================
-- Our product (public.parts) is separate from what suppliers offer for it.
--
-- 1. suppliers — Voltaat, Mouser, DigiKey, Alibaba, AliExpress (seeded) plus
--    any added later. default_pricing_mode is what a product sourced from
--    them starts as; commission_percent is what the supplier pays us after a
--    sale ('mirror' suppliers, i.e. Voltaat); landed_overhead_pct is freight +
--    duty + fees on top of the offer cost.
--
-- 2. supplier_offers — many per product. Sourced data (adapters, CSV, daily
--    refresh) writes ONLY cost / retail_price / availability / lead_time_days /
--    last_checked_at here. It never writes the product's name, description or
--    photos.
--
-- 3. parts gains pricing_mode ('markup' | 'mirror'), pinned_offer_id (admin
--    override that survives refreshes) and derived columns maintained by
--    public.refresh_part_sourcing(): preferred_offer_id, landed_cost_qar,
--    expected_income_qar, income_pct, below_floor, lead_time_class.
--
--    Preferred offer rule: in stock at source first, then shortest lead time,
--    then lowest landed cost. A pinned active offer wins.
--    markup: income = our price − landed cost.
--    mirror: our price = the offer's retail price (updated the same moment
--            the offer changes), income = price × supplier commission %.
--    Lead-time class from the preferred offer's lead_time_days:
--      ≤ 2 → in_stock, ≤ 5 → 3_5_days, ≤ 14 → 1_2_weeks, else 2_4_weeks.
--    No active offer → lead_time_class null ("available on request").
--
-- 4. store_settings: margin_floor_pct (default 15) and fx_to_qar (QAR per
--    unit of each currency). Changing either calls refresh_all_part_sourcing().
--
-- Run after 0027. Safe to re-run.
-- ============================================================================

-- ── Suppliers ────────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  name                 text not null,
  default_pricing_mode text not null default 'markup'
                         check (default_pricing_mode in ('markup', 'mirror')),
  commission_percent   numeric(6, 2) check (commission_percent is null or commission_percent between 0 and 100),
  landed_overhead_pct  numeric(6, 2) not null default 0 check (landed_overhead_pct >= 0),
  default_currency     text not null default 'USD',
  website              text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;
grant select, insert, update, delete on public.suppliers to authenticated;
drop policy if exists suppliers_admin_all on public.suppliers;
create policy suppliers_admin_all on public.suppliers
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

insert into public.suppliers (code, name, default_pricing_mode, commission_percent, landed_overhead_pct, default_currency, website) values
  ('voltaat',    'Voltaat',    'mirror', 10,   0,  'QAR', 'https://voltaat.com'),
  ('mouser',     'Mouser',     'markup', null, 15, 'USD', 'https://www.mouser.com'),
  ('digikey',    'DigiKey',    'markup', null, 15, 'USD', 'https://www.digikey.com'),
  ('alibaba',    'Alibaba',    'markup', null, 25, 'USD', 'https://www.alibaba.com'),
  ('aliexpress', 'AliExpress', 'markup', null, 10, 'USD', 'https://www.aliexpress.com')
on conflict (code) do nothing;

-- ── Supplier offers ──────────────────────────────────────────────────────────
create table if not exists public.supplier_offers (
  id              uuid primary key default gen_random_uuid(),
  part_id         uuid not null references public.parts (id) on delete cascade,
  supplier_id     uuid not null references public.suppliers (id) on delete restrict,
  supplier_sku    text,
  supplier_url    text,
  cost            numeric(12, 4) check (cost is null or cost >= 0),       -- per supplier pack
  retail_price    numeric(12, 4) check (retail_price is null or retail_price >= 0), -- supplier's public price (mirror)
  currency        text not null default 'USD',
  pack_size       integer not null default 1 check (pack_size >= 1),
  moq             integer not null default 1 check (moq >= 1),
  availability    text not null default 'unknown'
                    check (availability in ('in_stock', 'limited', 'backorder', 'unavailable', 'unknown')),
  lead_time_days  integer check (lead_time_days is null or lead_time_days >= 0),
  last_checked_at timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists supplier_offers_part_idx on public.supplier_offers (part_id);
create unique index if not exists supplier_offers_supplier_sku_uniq
  on public.supplier_offers (part_id, supplier_id, coalesce(supplier_sku, ''));

drop trigger if exists set_supplier_offers_updated_at on public.supplier_offers;
create trigger set_supplier_offers_updated_at before update on public.supplier_offers
  for each row execute function public.set_updated_at();

alter table public.supplier_offers enable row level security;
grant select, insert, update, delete on public.supplier_offers to authenticated;
drop policy if exists supplier_offers_admin_all on public.supplier_offers;
create policy supplier_offers_admin_all on public.supplier_offers
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ── Product columns ──────────────────────────────────────────────────────────
alter table public.parts
  add column if not exists pricing_mode        text not null default 'markup',
  add column if not exists pinned_offer_id     uuid references public.supplier_offers (id) on delete set null,
  add column if not exists preferred_offer_id  uuid references public.supplier_offers (id) on delete set null,
  add column if not exists landed_cost_qar     numeric(12, 2),
  add column if not exists expected_income_qar numeric(12, 2),
  add column if not exists income_pct          numeric(7, 2),
  add column if not exists below_floor         boolean not null default false,
  add column if not exists lead_time_class     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parts_pricing_mode_check') then
    alter table public.parts add constraint parts_pricing_mode_check check (pricing_mode in ('markup', 'mirror'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'parts_lead_time_class_check') then
    alter table public.parts add constraint parts_lead_time_class_check
      check (lead_time_class is null or lead_time_class in ('in_stock', '3_5_days', '1_2_weeks', '2_4_weeks'));
  end if;
end $$;

-- ── Settings ─────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value) values
  ('margin_floor_pct', '15'::jsonb),
  ('fx_to_qar', '{"QAR": 1, "USD": 3.64, "EUR": 3.95, "CNY": 0.51, "GBP": 4.6}'::jsonb)
on conflict (key) do nothing;

-- ── Derivation ───────────────────────────────────────────────────────────────
-- Landed cost in QAR of ONE of our sold units (our pack_size) from an offer.
create or replace function public.offer_landed_cost_qar(p_offer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(
    o.cost
    * coalesce((select (value ->> o.currency)::numeric from store_settings where key = 'fx_to_qar'),
               case when o.currency = 'QAR' then 1 end)
    * (1 + s.landed_overhead_pct / 100)
    * p.pack_size::numeric / o.pack_size, 2)
  from supplier_offers o
  join suppliers s on s.id = o.supplier_id
  join parts p on p.id = o.part_id
  where o.id = p_offer_id;
$$;

create or replace function public.refresh_part_sourcing(p_part_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part     parts%rowtype;
  v_offer    supplier_offers%rowtype;
  v_supplier suppliers%rowtype;
  v_offer_id uuid;
  v_fx       numeric;
  v_floor    numeric;
  v_landed   numeric;
  v_price    numeric;
  v_income   numeric;
  v_pct      numeric;
  v_class    text;
begin
  select * into v_part from parts where id = p_part_id;
  if not found then return; end if;

  -- A pinned offer that still exists and is active wins.
  select o.id into v_offer_id from supplier_offers o
  where o.id = v_part.pinned_offer_id and o.part_id = p_part_id and o.active;

  if v_offer_id is null then
    select o.id into v_offer_id
    from supplier_offers o
    join suppliers s on s.id = o.supplier_id
    where o.part_id = p_part_id and o.active and s.active
      -- a mirror product can only follow an offer that has a retail price and a commission
      and (v_part.pricing_mode <> 'mirror' or (o.retail_price is not null and s.commission_percent is not null))
    order by (o.availability = 'in_stock') desc,
             o.lead_time_days asc nulls last,
             public.offer_landed_cost_qar(o.id) asc nulls last,
             o.created_at asc
    limit 1;
  end if;

  select coalesce((value #>> '{}')::numeric, 15) into v_floor from store_settings where key = 'margin_floor_pct';
  v_floor := coalesce(v_floor, 15);

  if v_offer_id is null then
    update parts set preferred_offer_id = null, landed_cost_qar = null, expected_income_qar = null,
      income_pct = null, below_floor = false, lead_time_class = null
    where id = p_part_id;
    return;
  end if;

  select * into v_offer from supplier_offers where id = v_offer_id;
  select * into v_supplier from suppliers where id = v_offer.supplier_id;
  v_landed := public.offer_landed_cost_qar(v_offer_id);
  v_price  := v_part.unit_price;

  if v_part.pricing_mode = 'mirror' and v_offer.retail_price is not null then
    select coalesce((value ->> v_offer.currency)::numeric, case when v_offer.currency = 'QAR' then 1 end)
      into v_fx from store_settings where key = 'fx_to_qar';
    if v_fx is not null then
      v_price := round(v_offer.retail_price * v_fx * v_part.pack_size::numeric / v_offer.pack_size, 2);
    end if;
    v_income := round(v_price * coalesce(v_supplier.commission_percent, 0) / 100, 2);
  else
    v_income := case when v_landed is null then null else round(v_price - v_landed, 2) end;
  end if;

  v_pct := case when v_income is null or v_price = 0 then null else round(v_income / v_price * 100, 2) end;

  v_class := case
    when v_offer.lead_time_days is null then '2_4_weeks'
    when v_offer.lead_time_days <= 2 then 'in_stock'
    when v_offer.lead_time_days <= 5 then '3_5_days'
    when v_offer.lead_time_days <= 14 then '1_2_weeks'
    else '2_4_weeks'
  end;

  update parts set
    preferred_offer_id  = v_offer_id,
    unit_price          = v_price,
    landed_cost_qar     = v_landed,
    expected_income_qar = v_income,
    income_pct          = v_pct,
    below_floor         = coalesce(v_pct < v_floor, false),
    lead_time_class     = v_class
  where id = p_part_id;
end;
$$;

create or replace function public.refresh_all_part_sourcing()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  if not public.is_super_admin() and auth.role() <> 'service_role' then
    raise exception 'not allowed';
  end if;
  for r in select id from parts loop
    perform public.refresh_part_sourcing(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.refresh_part_sourcing(uuid) from public, anon;
grant execute on function public.refresh_part_sourcing(uuid) to authenticated;
grant execute on function public.refresh_all_part_sourcing() to authenticated;
grant execute on function public.offer_landed_cost_qar(uuid) to authenticated;

-- Offers changing → re-derive their product.
create or replace function public.supplier_offers_refresh_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_part_sourcing(old.part_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.part_id <> old.part_id) then
    perform public.refresh_part_sourcing(new.part_id);
  end if;
  return null;
end;
$$;

drop trigger if exists supplier_offers_refresh on public.supplier_offers;
create trigger supplier_offers_refresh
  after insert or update or delete on public.supplier_offers
  for each row execute function public.supplier_offers_refresh_trg();

-- Product fields that feed the derivation changing → re-derive.
-- (The derived columns themselves are excluded, so this never loops.)
create or replace function public.parts_sourcing_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_part_sourcing(new.id);
  return null;
end;
$$;

drop trigger if exists parts_sourcing_refresh on public.parts;
create trigger parts_sourcing_refresh
  after update of pricing_mode, pinned_offer_id, unit_price, pack_size on public.parts
  for each row
  when (pg_trigger_depth() < 1)
  execute function public.parts_sourcing_trg();

-- Supplier commission / overhead / active changing → re-derive its products.
create or replace function public.suppliers_refresh_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select distinct part_id from supplier_offers where supplier_id = new.id loop
    perform public.refresh_part_sourcing(r.part_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists suppliers_refresh on public.suppliers;
create trigger suppliers_refresh
  after update of commission_percent, landed_overhead_pct, active on public.suppliers
  for each row execute function public.suppliers_refresh_trg();

do $$ begin raise notice '0028 applied: suppliers, supplier_offers, pricing modes, derived sourcing on parts'; end $$;
