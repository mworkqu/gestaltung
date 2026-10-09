-- ============================================================================
-- Gestaltung — 0054: Qatar working days in every delivery promise, and the
--                    public "Source" line on product pages
--                    (P2-06 / P2-07, 2026-10-09)
-- ============================================================================
-- Run AFTER 0053. Safe to re-run (create or replace; the holidays row is
-- inserted with `on conflict do nothing`, so the owner's dates survive).
--
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   -- the shipping settings the dates are built from, and whether a
--   -- holidays row already exists
--   select key, value from public.store_settings where key in ('shipping', 'holidays');
--   -- function versions that exist now (expect order_delivery_quote(jsonb, date))
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('order_delivery_quote', 'add_working_days', 'working_days_config', 'part_public_source');
--   -- open orders whose promise was made with calendar days (NOT changed by
--   -- this migration; only new quotes / orders and the daily re-check use
--   -- working days)
--   select count(*) from public.part_orders where promised_date >= current_date;
--
-- AFTER (checks):
--   select public.add_working_days('2026-12-17', 7);           -- 2026-12-28
--   select public.add_working_days('2026-12-18', 0);           -- 2026-12-20 (roll forward)
--   select public.order_delivery_quote('[]'::jsonb) -> 'tiers' -> 'standard' ->> 'date';  -- null (nothing datable)
--
-- ROLLBACK (manual, one transaction):
--   1. Re-run the order_delivery_quote section of
--      0044_shipping_flat_free_threshold.sql (same signature, replaced in place).
--   2. drop function if exists public.part_public_source(uuid);
--      drop function if exists public.is_working_day(date);
--      drop function if exists public.add_working_days(date, integer);
--      drop function if exists public.add_working_days(date, integer, integer[], date[]);
--      drop function if exists public.working_days_config();
--   3. Optional: delete from public.store_settings where key = 'holidays';
--      (With the row gone the site also goes back to calendar days: the TS
--      mirror treats a missing row as "no working-day rule".)
--
-- WHAT CHANGES
-- 1. store_settings.holidays = {"weekend": [5, 6], "dates": [...]}.
--    weekend = ISO weekdays (Mon 1 … Sun 7; Qatar: Fri 5, Sat 6). dates =
--    ISO dates of public holidays; seeded with Qatar National Day (18 Dec
--    2026) and the day after. The owner adds Eid dates on Dashboard → Store →
--    Suppliers (Shipping area). Parsing (here and in lib/store/working-days.ts
--    parseHolidays): weekend = the JSON integers 1..7 in the array (a missing
--    or non-array weekend = [5, 6]; all seven days = [5, 6]); NO ROW at all =
--    no rule (calendar days, like before 0054); dates = the
--    valid YYYY-MM-DD strings (years 2000-2999), others ignored.
--
-- 2. add_working_days(start, n): the n-th working day AFTER start (start
--    itself is never counted). n <= 0 returns start when it is a working day,
--    else the next working day (roll forward). So the result is never on a
--    weekend day or a holiday. A pure 4-argument core takes the weekend and
--    dates explicitly (used by the quote, so the setting is read once).
--
-- 3. order_delivery_quote v3 (same signature as 0029/0044, replaced in
--    place). Tier date was
--        p_from + lead + handling + transit + buffer          (calendar days)
--    and is now
--        add_working_days(p_from + lead, handling + transit + buffer)
--    i.e. the SUPPLIER lead time (lead_class_days: 2/5/14/28, defined in
--    calendar days — "1–2 weeks") stays calendar days, OUR handling, carrier
--    transit and the promise buffer are counted in Qatar working days, and the
--    result is rolled forward off a weekend/holiday. early_date the same with
--    the shortest lead. New top-level key working_days = whether the
--    holidays row exists (the UI shows the "working days are Sun–Thu" note
--    only then). Everything else (prices, free
--    delivery, held_by, on_request) is unchanged. create_part_order (v6, 0044) is NOT replaced:
--    it records the quote's date / early_date, so new orders get working-day
--    promises automatically.
--
-- 4. part_public_source(part): what the product page may say about where a
--    product comes from — the preferred offer's supplier CODE and the
--    product's lead class, plus the published backup product (parts.backup_for
--    = this product, 0041) with its SKU, supplier code and lead class. NO
--    cost, landed cost, income, margin, price or offer fields. suppliers and
--    supplier_offers stay admin-only (0028 RLS); this SECURITY DEFINER
--    function is the only public window, and anon may call it.
--
-- The delivery-promises cron (app/api/cron/delivery-promises) does its date
-- maths in TypeScript (lib/store/delivery.ts reviewPromise), which now uses
-- lib/store/working-days.ts with the same rule; there is no SQL to change.
-- ============================================================================

-- ── 1. Setting ──────────────────────────────────────────────────────────────
insert into public.store_settings (key, value)
values ('holidays', '{"weekend": [5, 6], "dates": ["2026-12-18", "2026-12-19"]}'::jsonb)
on conflict (key) do nothing;

-- ── 2. Working days ─────────────────────────────────────────────────────────
-- The parsed setting (mirrors parseHolidays in lib/store/working-days.ts).
create or replace function public.working_days_config(out weekend integer[], out dates date[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb;
  v_el  jsonb;
  v_n   numeric;
  v_s   text;
  v_d   date;
  v_wk  integer[] := '{}';
  v_ds  date[] := '{}';
begin
  weekend := array[5, 6];
  dates   := '{}';
  select value into v_cfg from public.store_settings where key = 'holidays';
  -- No row at all = no working-day rule: calendar days (as before 0054; the TS
  -- mirror's getHolidays() returns null in that case).
  if not found then
    weekend := '{}';
    return;
  end if;
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then return; end if;

  if jsonb_typeof(v_cfg -> 'weekend') = 'array' then
    for v_el in select * from jsonb_array_elements(v_cfg -> 'weekend') loop
      continue when jsonb_typeof(v_el) <> 'number';
      v_n := (v_el #>> '{}')::numeric;
      continue when v_n <> trunc(v_n) or v_n < 1 or v_n > 7;
      if not (v_n::integer = any (v_wk)) then v_wk := v_wk || v_n::integer; end if;
    end loop;
    -- Every day a weekend day would make every date impossible: use the default.
    if cardinality(v_wk) < 7 then
      select coalesce(array_agg(x order by x), '{}') into weekend from unnest(v_wk) x;
    end if;
  end if;

  if jsonb_typeof(v_cfg -> 'dates') = 'array' then
    for v_el in select * from jsonb_array_elements(v_cfg -> 'dates') loop
      continue when jsonb_typeof(v_el) <> 'string';
      v_s := v_el #>> '{}';
      continue when v_s !~ '^2[0-9]{3}-[0-9]{2}-[0-9]{2}$';  -- years 2000-2999
      begin
        v_d := v_s::date;
      exception when others then
        continue;  -- e.g. 2026-02-30
      end;
      -- Round-trip check: the same "is it a real calendar date" test as TS.
      continue when to_char(v_d, 'YYYY-MM-DD') <> v_s;
      if not (v_d = any (v_ds)) then v_ds := v_ds || v_d; end if;
    end loop;
    select coalesce(array_agg(x order by x), '{}') into dates from unnest(v_ds) x;
  end if;
end $$;

-- Core: pure, explicit weekend + dates (mirrors addWorkingDays).
create or replace function public.add_working_days(p_start date, p_n integer, p_weekend integer[], p_dates date[])
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_d     date := p_start;
  v_k     integer := 0;
  v_guard integer := 0;
  v_wk    integer[] := coalesce(p_weekend, '{}');
  v_hol   date[] := coalesce(p_dates, '{}');
begin
  if p_start is null then return null; end if;
  if (select count(distinct x) from unnest(v_wk) x where x between 1 and 7) >= 7 then
    v_wk := array[5, 6];
  end if;
  if coalesce(p_n, 0) <= 0 then
    -- Roll forward to the first working day on or after start.
    while (extract(isodow from v_d)::integer = any (v_wk) or v_d = any (v_hol)) and v_guard < 100000 loop
      v_d := v_d + 1;
      v_guard := v_guard + 1;
    end loop;
    return v_d;
  end if;
  while v_k < p_n and v_guard < 100000 loop
    v_d := v_d + 1;
    v_guard := v_guard + 1;
    if not (extract(isodow from v_d)::integer = any (v_wk) or v_d = any (v_hol)) then
      v_k := v_k + 1;
    end if;
  end loop;
  return v_d;
end $$;

-- Convenience: reads store_settings.holidays.
create or replace function public.add_working_days(p_start date, p_n integer)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select public.add_working_days(p_start, p_n, c.weekend, c.dates) from public.working_days_config() c;
$$;

create or replace function public.is_working_day(p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.add_working_days(p_day, 0) = p_day;
$$;

grant execute on function public.working_days_config() to anon, authenticated;
grant execute on function public.add_working_days(date, integer, integer[], date[]) to anon, authenticated;
grant execute on function public.add_working_days(date, integer) to anon, authenticated;
grant execute on function public.is_working_day(date) to anon, authenticated;

-- ── 3. order_delivery_quote v3 (same signature as 0029 / 0044) ──────────────
create or replace function public.order_delivery_quote(p_items jsonb, p_from date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb;
  v_tier     text;
  v_t        jsonb;
  v_max      integer;
  v_min      integer;
  v_held     text;
  v_on_req   jsonb;
  v_handling integer;
  v_buffer   integer;
  v_transit  integer;
  v_fee      numeric;
  v_base     numeric;
  v_free     boolean;
  v_fs       jsonb;
  v_goods    numeric;
  v_week     integer[];
  v_hol      date[];
  v_out      jsonb := '{}'::jsonb;
begin
  select value into v_cfg from public.store_settings where key = 'shipping';
  v_handling := coalesce((v_cfg ->> 'handling_days')::integer, 1);
  v_buffer   := coalesce((v_cfg ->> 'buffer_days')::integer, 3);
  v_fee      := coalesce((v_cfg ->> 'handling_fee_qar')::numeric, 0);
  v_fs       := public.free_shipping_config();
  v_goods    := public.order_goods_qar(p_items);
  select c.weekend, c.dates into v_week, v_hol from public.working_days_config() c;

  select coalesce(jsonb_agg(p.id), '[]'::jsonb) into v_on_req
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
    join public.parts p on p.id = (i ->> 'part_id')::uuid
   where p.lead_time_class is null;

  select max(public.lead_class_days(p.lead_time_class)), min(public.lead_class_days(p.lead_time_class))
    into v_max, v_min
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
    join public.parts p on p.id = (i ->> 'part_id')::uuid
   where p.lead_time_class is not null;

  select p.name into v_held
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
    join public.parts p on p.id = (i ->> 'part_id')::uuid
   where p.lead_time_class is not null
   order by public.lead_class_days(p.lead_time_class) desc, p.name
   limit 1;

  for v_tier in select unnest(array['express', 'standard', 'economy']) loop
    v_t := v_cfg -> 'tiers' -> v_tier;
    continue when v_t is null;
    v_base    := coalesce((v_t ->> 'carrier_cost_qar')::numeric, 0);
    v_free    := public.free_shipping_applies(v_tier, v_goods);
    v_transit := coalesce((v_t ->> 'transit_days')::integer, 0);
    v_out := v_out || jsonb_build_object(v_tier, jsonb_build_object(
      'carrier_cost_qar', case when v_free then 0 else v_base end,
      'base_cost_qar',    v_base,
      'free',             v_free,
      'transit_days',     v_transit,
      -- Supplier lead in calendar days, then our days in Qatar working days.
      'date', case when v_max is null then null
                   else public.add_working_days(p_from + v_max, v_handling + v_transit + v_buffer, v_week, v_hol) end,
      'early_date', case when v_max is null or v_min = v_max then null
                         else public.add_working_days(p_from + v_min, v_handling + v_transit + v_buffer, v_week, v_hol) end
    ));
  end loop;

  return jsonb_build_object(
    'tiers', v_out,
    'handling_fee_qar', v_fee,
    'held_by', case when v_max is not null and v_min <> v_max then v_held end,
    'can_split', v_max is not null and v_min <> v_max,
    'on_request', v_on_req,
    -- 0054 marker: the dates above skip the weekend + holidays (the UI shows
    -- the "working days are Sun–Thu" note only when this is true).
    'working_days', exists (select 1 from public.store_settings where key = 'holidays'),
    'free_shipping', case when v_fs is null then null
                          else v_fs || jsonb_build_object(
                            'goods_qar', v_goods,
                            'qualifies', v_goods >= (v_fs ->> 'threshold_qar')::numeric)
                     end
  );
end $$;

grant execute on function public.order_delivery_quote(jsonb, date) to anon, authenticated;

-- ── 4. Public source line for a product page ────────────────────────────────
create or replace function public.part_public_source(p_part uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'supplier',        s.code,
    'lead_time_class', p.lead_time_class,
    'backup', (
      select jsonb_build_object('sku', b.sku, 'supplier', bs.code, 'lead_time_class', b.lead_time_class)
        from public.parts b
        left join public.supplier_offers bo on bo.id = b.preferred_offer_id
        left join public.suppliers bs on bs.id = bo.supplier_id
       where b.backup_for = p.id
         and b.is_published
         and b.merged_into is null
       order by public.lead_class_days(b.lead_time_class) nulls last, b.sku
       limit 1
    )
  )
    from public.parts p
    left join public.supplier_offers o on o.id = p.preferred_offer_id
    left join public.suppliers s on s.id = o.supplier_id
   where p.id = p_part
     and p.is_published;
$$;

revoke all on function public.part_public_source(uuid) from public;
grant execute on function public.part_public_source(uuid) to anon, authenticated;

do $$ begin raise notice '0054 applied: store_settings.holidays, working_days_config, add_working_days (2 + 4 args), is_working_day, order_delivery_quote v3 (working days), part_public_source'; end $$;
