-- ============================================================================
-- Gestaltung — 0095: suppliers have a running order (owner, 2026-10-19)
-- ============================================================================
-- Run AFTER 0028 (and after 0069, which is where own stock comes from).
-- Safe to re-run. NOT RUN YET (written by Claude; the owner runs it).
--
-- WHY
-- The owner is starting to hold his own stock, and wants it sold first: his
-- own shelf, then Voltaat, then DigiKey, then Mouser. Until now
-- refresh_part_sourcing() (0028) had no idea who a supplier was. It ranked
-- offers by in-stock, then fewest lead days, then landed cost — so a DigiKey
-- offer that happened to carry a shorter lead time than Voltaat's won, and an
-- own-stock offer had no standing at all.
--
-- WHAT CHANGES
-- 1. suppliers.rank (integer, default 50, lower goes first). Seeded:
--      own_stock 10 · voltaat 20 · digikey 30 · mouser 40 · alibaba /
--      aliexpress 70. A supplier added later starts at 50, i.e. after the
--      named ones and before the marketplaces.
-- 2. The "own stock (Lusail)" supplier row is created here if it does not
--    exist yet, instead of waiting for the first Fix-list use to make it
--    (lib/admin/fix-delivery.ts still creates it if this has not run).
-- 3. refresh_part_sourcing() is REPLACED. Same signature, same behaviour,
--    one changed line: rank is now the second sort key.
--
--      order by (o.availability = 'in_stock') desc,   -- unchanged, still first
--               coalesce(s.rank, 50) asc,             -- NEW
--               o.lead_time_days asc nulls last,
--               landed cost asc, created_at asc
--
--    Availability stays ahead of rank on purpose: a part we do not actually
--    have on the shelf must not beat one Voltaat can ship today. "Mine first"
--    means mine first among the suppliers that can supply it.
-- 4. A trigger on suppliers.rank re-derives the parts that supplier touches,
--    so changing the running order later takes effect without a full rebuild.
-- 5. refresh_all_part_sourcing() runs once at the end, so every part picks its
--    offer again under the new order. Expect prices on mirror-priced parts to
--    move if a different supplier now wins.
--
-- DRY RUN (read-only) — who would change hands:
--   select s.code, count(*) from public.parts p
--     join public.supplier_offers o on o.id = p.preferred_offer_id
--     join public.suppliers s on s.id = o.supplier_id
--    group by s.code order by 2 desc;
--   -- run the same query after the migration and compare.
--
-- ROLLBACK (manual):
--   alter table public.suppliers drop column if exists rank;
--   drop trigger if exists suppliers_rank_refresh on public.suppliers;
--   drop function if exists public.suppliers_rank_refresh();
--   -- then re-run the refresh_part_sourcing block from 0028, and
--   select public.refresh_all_part_sourcing();
-- ============================================================================

-- ── 1. The column ────────────────────────────────────────────────────────────
alter table public.suppliers add column if not exists rank integer not null default 50;

comment on column public.suppliers.rank is
  'Running order when two offers are equally available: lower goes first. Own stock 10, Voltaat 20, DigiKey 30, Mouser 40, marketplaces 70.';

update public.suppliers set rank = 10 where code = 'own_stock'  and rank <> 10;
update public.suppliers set rank = 20 where code = 'voltaat'    and rank <> 20;
update public.suppliers set rank = 30 where code = 'digikey'    and rank <> 30;
update public.suppliers set rank = 40 where code = 'mouser'     and rank <> 40;
update public.suppliers set rank = 70 where code in ('alibaba', 'aliexpress') and rank <> 70;

-- ── 2. Our own shelf, as a supplier ──────────────────────────────────────────
insert into public.suppliers (code, name, default_pricing_mode, commission_percent, landed_overhead_pct, default_currency, active, rank)
values ('own_stock', 'Own stock (Lusail)', 'markup', null, 0, 'QAR', true, 10)
on conflict (code) do update set rank = excluded.rank, active = true;

-- ── 3. The rule, with rank in it ─────────────────────────────────────────────
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
             coalesce(s.rank, 50) asc,
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

revoke all on function public.refresh_part_sourcing(uuid) from public, anon;
grant execute on function public.refresh_part_sourcing(uuid) to authenticated;

-- ── 4. Changing the order re-derives that supplier's parts ───────────────────
create or replace function public.suppliers_rank_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in
    select distinct o.part_id from supplier_offers o where o.supplier_id = new.id
  loop
    perform public.refresh_part_sourcing(r.part_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists suppliers_rank_refresh on public.suppliers;
create trigger suppliers_rank_refresh
  after update of rank on public.suppliers
  for each row when (old.rank is distinct from new.rank)
  execute function public.suppliers_rank_refresh();

-- ── 5. Re-pick every part's offer under the new order ────────────────────────
-- Called in a DO block rather than through refresh_all_part_sourcing(), whose
-- super-admin guard does not hold when a migration runs as the table owner.
do $$
declare r record;
begin
  for r in select id from public.parts loop
    perform public.refresh_part_sourcing(r.id);
  end loop;
end $$;
