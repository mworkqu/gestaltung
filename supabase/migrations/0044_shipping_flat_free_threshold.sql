-- ============================================================================
-- Gestaltung — 0044: flat QAR 50 shipping, free Standard delivery over
--                    QAR 300, bank-transfer email, no zero-total orders
--                    (2026-10-03, site review Phase A)
-- ============================================================================
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   -- current shipping settings and whether a threshold already exists
--   select key, value, updated_at from public.store_settings
--    where key in ('shipping', 'free_shipping_threshold');
--
--   -- function versions that exist now (expect create_part_order with 8 args,
--   -- order_delivery_quote(jsonb, date), set_order_payment_method(uuid, text))
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('create_part_order', 'order_delivery_quote', 'set_order_payment_method');
--
--   -- past bank-transfer orders the new rule would have refused (NOT changed)
--   select id, created_at, customer_email from public.part_orders
--    where payment_method = 'bank_transfer'
--      and coalesce(btrim(customer_email), '') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
--
-- ROLLBACK (manual, run as one transaction):
--   1. drop function if exists public.create_part_order(text, text, text, text, text, jsonb, text, boolean, text);
--      then re-run the create_part_order section of 0034_checkout_quantity_fix.sql
--      (from `create or replace function public.create_part_order(` down to its
--      `grant execute …` line) to restore v5 with the 8-argument signature.
--   2. Re-run the order_delivery_quote section of 0029_intake_demand_delivery.sql
--      (same signature, replaced in place).
--   3. Re-run the set_order_payment_method section of 0039_payment_method.sql.
--   4. drop function if exists public.order_goods_qar(jsonb);
--      drop function if exists public.free_shipping_applies(text, numeric);
--      drop function if exists public.free_shipping_config();
--      drop function if exists public.is_plausible_email(text);
--   5. delete from public.store_settings where key = 'free_shipping_threshold';
--      (The shipping prices are left as they are: the owner decided QAR 50 / 0.)
--   6. The checkout client keeps working after a rollback: when the 9-argument
--      create_part_order is missing it retries without p_payment_method.
--
-- WHAT CHANGES
-- 1. Settings (owner decision D1/D2). store_settings.shipping gets carrier
--    cost QAR 50 on every tier (express, standard, economy) and handling fee
--    0, set OUTRIGHT with jsonb_set so handling_days, buffer_days and each
--    tier's transit_days stay as they are. If the row is missing it is created
--    first (handling 1 day, buffer 3, transit 1/3/7). New key
--    store_settings.free_shipping_threshold = {"threshold_qar":300,
--    "tiers":["standard"]} (insert … on conflict do nothing, so an owner edit
--    survives a re-run). It is a SEPARATE key on purpose: the admin shipping
--    editor (saveShippingSettings) rewrites the whole `shipping` value from
--    its known fields and would erase a nested threshold. A missing key, a
--    non-numeric threshold or a threshold <= 0 means no free delivery.
--
-- 2. "Goods subtotal" — ONE definition, here and in lib/store/shipping.ts:
--      sum(quantity × unit_price) over the order's published parts
--      − the kit discount (round(kit lines × kit_discount_pct / 100, 2), kit
--        lines counted only for the caller's own unordered kit)
--    i.e. after the kit discount, BEFORE shipping, handling and any AI-credit
--    redemption (redeem_credits runs after the order exists). It is what
--    create_part_order stores as total_qar − shipping_qar − handling_fee_qar,
--    and what redeem_credits (0042) calls the goods subtotal. Quantities are
--    read as create_part_order reads them: greatest(1, quantity).
--    order_goods_qar(items) computes it for the quote; create_part_order
--    uses its own loop totals (the numbers it stores), which follow the same
--    rules. free_shipping_applies(tier, goods) is the single test used by both.
--
-- 3. order_delivery_quote (same signature, replaced in place). Each tier now
--    returns carrier_cost_qar = what this cart pays for one shipment on that
--    tier (0 when it qualifies), base_cost_qar = the normal price, and free.
--    New top-level key free_shipping = {threshold_qar, tiers, goods_qar,
--    qualifies} or null when not configured. Callers that only read
--    carrier_cost_qar keep working and see the real charge. The client now
--    sends kit_id per item so the quote's goods match the order's.
--
-- 4. create_part_order v6 = v5 (0034) plus:
--      * shipping = 0 when the chosen tier qualifies for free delivery. A split
--        order (two shipments) normally pays the carrier cost twice; free means
--        free, so a qualifying split order also pays 0. shipping_qar stores the
--        amount actually charged, so redeem_credits' "total − shipping −
--        handling" is still the goods subtotal.
--      * rejects an order whose total (goods − kit discount + shipping +
--        handling) is <= 0: 'order total must be greater than zero'.
--      * new optional trailing parameter p_payment_method text default null.
--        When given it is validated and stored on the order, and bank_transfer
--        requires a plausible customer email ('email is required for bank
--        transfer'). The signature changes, so the 8-argument version is
--        DROPPED first (otherwise PostgREST/Postgres would see two candidates
--        and an 8-argument call would be ambiguous).
--
-- 5. set_order_payment_method also refuses bank_transfer without a plausible
--    email on the order.
--
-- WHY THE EMAIL IS CHECKED IN create_part_order TOO: checkout calls
-- create_part_order, then redeem_credits, then set_order_payment_method. A
-- check only in set_order_payment_method would fire after the order already
-- exists, leaving an orphan order with no payment method. So checkout now
-- passes p_payment_method to create_part_order, which refuses up front and
-- creates nothing. set_order_payment_method keeps the same rule as a backstop
-- for any other caller (it only fills an empty method, so after v6 has stored
-- the method the checkout's follow-up call is a harmless no-op).
-- "Plausible email" = something@something.something with no spaces
-- (is_plausible_email; lib/store/shipping.ts isPlausibleEmail is the same).
--
-- Run after 0043. Safe to re-run: settings are set to the same values (the
-- threshold row is only inserted when missing), functions are replaced in
-- place and the old create_part_order overload is dropped only if present.
-- ============================================================================

begin;

-- ── 1. Settings ─────────────────────────────────────────────────────────────
insert into public.store_settings (key, value) values (
  'shipping',
  '{
     "handling_fee_qar": 0,
     "handling_days": 1,
     "buffer_days": 3,
     "tiers": {
       "express":  { "carrier_cost_qar": 50, "transit_days": 1 },
       "standard": { "carrier_cost_qar": 50, "transit_days": 3 },
       "economy":  { "carrier_cost_qar": 50, "transit_days": 7 }
     }
   }'::jsonb
) on conflict (key) do nothing;

update public.store_settings s
   set value = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     s.value || jsonb_build_object(
                       'handling_fee_qar', 0,
                       'tiers', case when jsonb_typeof(s.value -> 'tiers') = 'object' then s.value -> 'tiers' else '{}'::jsonb end),
                     '{tiers,express}',
                     coalesce(case when jsonb_typeof(s.value #> '{tiers,express}') = 'object' then s.value #> '{tiers,express}' end,
                              '{"transit_days": 1}'::jsonb) || '{"carrier_cost_qar": 50}'::jsonb),
                   '{tiers,standard}',
                   coalesce(case when jsonb_typeof(s.value #> '{tiers,standard}') = 'object' then s.value #> '{tiers,standard}' end,
                            '{"transit_days": 3}'::jsonb) || '{"carrier_cost_qar": 50}'::jsonb),
                 '{tiers,economy}',
                 coalesce(case when jsonb_typeof(s.value #> '{tiers,economy}') = 'object' then s.value #> '{tiers,economy}' end,
                          '{"transit_days": 7}'::jsonb) || '{"carrier_cost_qar": 50}'::jsonb),
       updated_at = now()
 where s.key = 'shipping';

insert into public.store_settings (key, value)
values ('free_shipping_threshold', '{"threshold_qar": 300, "tiers": ["standard"]}'::jsonb)
on conflict (key) do nothing;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
-- something@something.something, no spaces. Null/blank → false.
create or replace function public.is_plausible_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(p_email) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$', false);
$$;

-- {threshold_qar, tiers} when free delivery is configured, else null.
create or replace function public.free_shipping_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select value into v from public.store_settings where key = 'free_shipping_threshold';
  if v is null or coalesce(jsonb_typeof(v -> 'threshold_qar'), '') <> 'number' then
    return null;
  end if;
  if (v ->> 'threshold_qar')::numeric <= 0 then
    return null;
  end if;
  return jsonb_build_object(
    'threshold_qar', (v ->> 'threshold_qar')::numeric,
    'tiers', case when jsonb_typeof(v -> 'tiers') = 'array' then v -> 'tiers' else '[]'::jsonb end
  );
end $$;

-- Does this tier ship free for this goods subtotal? The ONE test.
create or replace function public.free_shipping_applies(p_tier text, p_goods numeric)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.free_shipping_config();
begin
  if v is null or p_tier is null or p_goods is null then return false; end if;
  return (v -> 'tiers') @> jsonb_build_array(p_tier) and p_goods >= (v ->> 'threshold_qar')::numeric;
end $$;

-- Goods subtotal of a cart (see WHAT CHANGES 2).
create or replace function public.order_goods_qar(p_items jsonb)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_qty     integer;
  v_price   numeric(10, 2);
  v_kit     uuid;
  v_total   numeric(10, 2) := 0;
  v_kit_sum numeric(10, 2) := 0;
  v_pct     numeric := 0;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));
    select unit_price into v_price
      from public.parts where id = (v_item ->> 'part_id')::uuid and is_published = true;
    continue when not found;
    v_total := v_total + (v_qty * v_price);
    v_kit := nullif(v_item ->> 'kit_id', '')::uuid;
    if v_kit is not null and exists (
      select 1 from public.project_kits k where k.id = v_kit and k.user_id = auth.uid() and k.order_id is null
    ) then
      v_kit_sum := v_kit_sum + (v_qty * v_price);
    end if;
  end loop;

  select coalesce((value #>> '{}')::numeric, 0) into v_pct from public.store_settings where key = 'kit_discount_pct';
  v_pct := least(greatest(coalesce(v_pct, 0), 0), 90);
  return v_total - round(v_kit_sum * v_pct / 100, 2);
end $$;

revoke all on function public.is_plausible_email(text) from public, anon, authenticated;
revoke all on function public.free_shipping_config() from public, anon, authenticated;
revoke all on function public.free_shipping_applies(text, numeric) from public, anon, authenticated;
revoke all on function public.order_goods_qar(jsonb) from public, anon, authenticated;

-- ── 3. order_delivery_quote v2 (same signature as 0029) ─────────────────────
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
  v_fee      numeric;
  v_base     numeric;
  v_free     boolean;
  v_fs       jsonb;
  v_goods    numeric;
  v_out      jsonb := '{}'::jsonb;
begin
  select value into v_cfg from public.store_settings where key = 'shipping';
  v_handling := coalesce((v_cfg ->> 'handling_days')::integer, 1);
  v_buffer   := coalesce((v_cfg ->> 'buffer_days')::integer, 3);
  v_fee      := coalesce((v_cfg ->> 'handling_fee_qar')::numeric, 0);
  v_fs       := public.free_shipping_config();
  v_goods    := public.order_goods_qar(p_items);

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
    v_base := coalesce((v_t ->> 'carrier_cost_qar')::numeric, 0);
    v_free := public.free_shipping_applies(v_tier, v_goods);
    v_out := v_out || jsonb_build_object(v_tier, jsonb_build_object(
      'carrier_cost_qar', case when v_free then 0 else v_base end,
      'base_cost_qar',    v_base,
      'free',             v_free,
      'transit_days',     coalesce((v_t ->> 'transit_days')::integer, 0),
      'date', case when v_max is null then null
                   else p_from + v_max + v_handling + coalesce((v_t ->> 'transit_days')::integer, 0) + v_buffer end,
      'early_date', case when v_max is null or v_min = v_max then null
                         else p_from + v_min + v_handling + coalesce((v_t ->> 'transit_days')::integer, 0) + v_buffer end
    ));
  end loop;

  return jsonb_build_object(
    'tiers', v_out,
    'handling_fee_qar', v_fee,
    'held_by', case when v_max is not null and v_min <> v_max then v_held end,
    'can_split', v_max is not null and v_min <> v_max,
    'on_request', v_on_req,
    'free_shipping', case when v_fs is null then null
                          else v_fs || jsonb_build_object(
                            'goods_qar', v_goods,
                            'qualifies', v_goods >= (v_fs ->> 'threshold_qar')::numeric)
                     end
  );
end $$;

grant execute on function public.order_delivery_quote(jsonb, date) to anon, authenticated;

-- ── 4. create_part_order v6 ─────────────────────────────────────────────────
drop function if exists public.create_part_order(text, text, text, text, text, jsonb, text, boolean);

create or replace function public.create_part_order(
  p_customer_name  text,
  p_customer_phone text,
  p_customer_email text,
  p_delivery_area  text,
  p_delivery_notes text,
  p_items          jsonb,
  p_shipping_tier  text default 'standard',
  p_split          boolean default false,
  p_payment_method text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id  uuid;
  v_item      jsonb;
  v_qty       integer;
  v_part      record;
  v_total     numeric(10, 2) := 0;
  v_kit_sum   numeric(10, 2) := 0;
  v_discount  numeric(10, 2) := 0;
  v_pct       numeric := 0;
  v_project   uuid;
  v_kit       uuid;
  v_lines     text[];
  v_owns      boolean;
  v_quote     jsonb;
  v_tier      jsonb;
  v_split     boolean;
  v_can_split boolean;
  v_on_req    boolean;
  v_shipping  numeric(10, 2);
  v_fee       numeric(10, 2);
  v_date      date;
  v_early     date;
  v_min_days  integer;
begin
  if coalesce(btrim(p_customer_name), '') = '' then raise exception 'customer_name is required'; end if;
  if coalesce(btrim(p_customer_phone), '') = '' then raise exception 'customer_phone is required'; end if;
  if coalesce(btrim(p_delivery_area), '') = '' then raise exception 'delivery_area is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;
  if p_shipping_tier not in ('express', 'standard', 'economy') then raise exception 'bad shipping tier'; end if;
  if p_payment_method is not null and p_payment_method not in ('cash_on_delivery', 'fawran', 'bank_transfer') then
    raise exception 'bad payment method';
  end if;
  -- Bank details are sent by email only (never shown on the site).
  if p_payment_method = 'bank_transfer' and not public.is_plausible_email(p_customer_email) then
    raise exception 'email is required for bank transfer';
  end if;

  -- Dates come from the lines that have a supplier offer. Lines without one
  -- ("available on request") are sold at the listed price with the date to be
  -- confirmed; if nothing is datable the order has no promised date at all.
  v_quote := public.order_delivery_quote(p_items);
  v_tier := v_quote -> 'tiers' -> p_shipping_tier;
  if v_tier is null then raise exception 'shipping tier not configured'; end if;

  v_on_req    := jsonb_array_length(coalesce(v_quote -> 'on_request', '[]'::jsonb)) > 0;
  v_can_split := coalesce((v_quote ->> 'can_split')::boolean, false);
  v_split     := coalesce(p_split, false) and v_can_split;
  -- The normal price; free delivery is decided below from this order's own
  -- goods subtotal.
  v_shipping  := coalesce((v_tier ->> 'base_cost_qar')::numeric, (v_tier ->> 'carrier_cost_qar')::numeric)
                 * (case when v_split then 2 else 1 end);
  v_fee       := (v_quote ->> 'handling_fee_qar')::numeric;
  v_date      := (v_tier ->> 'date')::date;
  v_early     := case when v_split then (v_tier ->> 'early_date')::date end;
  select min(public.lead_class_days(p.lead_time_class)) into v_min_days
    from jsonb_array_elements(p_items) i join public.parts p on p.id = (i ->> 'part_id')::uuid
   where p.lead_time_class is not null;

  select coalesce((value #>> '{}')::numeric, 0) into v_pct from public.store_settings where key = 'kit_discount_pct';
  v_pct := least(greatest(coalesce(v_pct, 0), 0), 90);

  insert into public.part_orders (profile_id, customer_name, customer_phone, customer_email, delivery_area, delivery_notes, total_qar,
                                  shipping_tier, split_shipments, shipping_qar, handling_fee_qar, promised_date, early_promised_date, held_by,
                                  has_on_request, payment_method)
  values (auth.uid(), btrim(p_customer_name), btrim(p_customer_phone),
          nullif(btrim(coalesce(p_customer_email, '')), ''), btrim(p_delivery_area),
          nullif(btrim(coalesce(p_delivery_notes, '')), ''), 0,
          p_shipping_tier, v_split, v_shipping, v_fee, v_date, v_early,
          case when v_split or v_can_split then v_quote ->> 'held_by' end,
          v_on_req, p_payment_method)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select id, sku, name, unit_price, lead_time_class into v_part
      from public.parts where id = (v_item ->> 'part_id')::uuid and is_published = true;
    if not found then raise exception 'part not available'; end if;

    v_project := nullif(v_item ->> 'project_id', '')::uuid;
    v_owns := v_project is not null and auth.uid() is not null
              and exists (select 1 from public.projects p where p.id = v_project and p.user_id = auth.uid());
    if not v_owns then v_project := null; end if;

    v_kit := nullif(v_item ->> 'kit_id', '')::uuid;
    if v_kit is not null and not exists (
      select 1 from public.project_kits k where k.id = v_kit and k.user_id = auth.uid() and k.order_id is null
    ) then v_kit := null; end if;

    select coalesce(array_agg(x), '{}') into v_lines
      from jsonb_array_elements_text(coalesce(v_item -> 'bom_lines', '[]'::jsonb)) x;

    insert into public.part_order_items (order_id, part_id, part_sku, part_name, quantity, unit_price_qar, project_id, kit_id, bom_lines,
                                         lead_time_class, promised_date)
    values (v_order_id, v_part.id, v_part.sku, v_part.name, v_qty, v_part.unit_price, v_project, v_kit, v_lines,
            v_part.lead_time_class,
            case
              when v_part.lead_time_class is null then null  -- on request: date to be confirmed
              when v_split and public.lead_class_days(v_part.lead_time_class) = v_min_days then v_early
              else v_date
            end);

    v_total := v_total + (v_qty * v_part.unit_price);
    if v_kit is not null then v_kit_sum := v_kit_sum + (v_qty * v_part.unit_price); end if;

    if v_project is not null then
      insert into public.project_items (project_id, product_id, quantity, qty_from_inventory)
      values (v_project, v_part.id, v_qty, v_qty)
      on conflict (project_id, product_id) do update
        set quantity = greatest(public.project_items.quantity, public.project_items.qty_from_inventory + excluded.qty_from_inventory),
            qty_from_inventory = public.project_items.qty_from_inventory + excluded.qty_from_inventory;

      if array_length(v_lines, 1) > 0 then
        update public.projects p
           set bom = jsonb_set(p.bom, '{lines}', (
             select coalesce(jsonb_agg(
               case when (l ->> 'id') = any (v_lines)
                    then l || jsonb_build_object('fulfilled', jsonb_build_object(
                      'orderId', v_order_id, 'at', now(), 'productId', v_part.id, 'sku', v_part.sku, 'quantity', v_qty))
                    else l end
               order by ord), '[]'::jsonb)
             from jsonb_array_elements(p.bom -> 'lines') with ordinality as t(l, ord)))
         where p.id = v_project and p.bom is not null and jsonb_typeof(p.bom -> 'lines') = 'array';
      end if;
    end if;
  end loop;

  v_discount := round(v_kit_sum * v_pct / 100, 2);
  -- Free delivery on qualifying tiers (goods subtotal = after the kit
  -- discount, before shipping/handling). Free means 0, split or not.
  if public.free_shipping_applies(p_shipping_tier, v_total - v_discount) then
    v_shipping := 0;
  end if;
  if v_total - v_discount + v_shipping + v_fee <= 0 then
    raise exception 'order total must be greater than zero';
  end if;

  update public.part_orders
     set total_qar = v_total - v_discount + v_shipping + v_fee, discount_qar = v_discount, shipping_qar = v_shipping
   where id = v_order_id;
  update public.project_kits set order_id = v_order_id
   where user_id = auth.uid() and order_id is null
     and id in (select distinct oi.kit_id from public.part_order_items oi where oi.order_id = v_order_id and oi.kit_id is not null);

  return v_order_id;
end $$;

grant execute on function public.create_part_order(text, text, text, text, text, jsonb, text, boolean, text) to anon, authenticated;

-- ── 5. set_order_payment_method v2 ──────────────────────────────────────────
create or replace function public.set_order_payment_method(p_order uuid, p_method text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n       integer;
  v_email text;
begin
  if p_method not in ('cash_on_delivery', 'fawran', 'bank_transfer') then raise exception 'bad payment method'; end if;
  if p_method = 'bank_transfer' then
    select customer_email into v_email from public.part_orders where id = p_order;
    if found and not public.is_plausible_email(v_email) then
      raise exception 'email is required for bank transfer';
    end if;
  end if;
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

do $$ begin raise notice '0044 applied: shipping QAR 50 all tiers + handling 0, free_shipping_threshold (QAR 300, standard), order_delivery_quote v2, create_part_order v6 (free delivery, total > 0, bank-transfer email), set_order_payment_method v2'; end $$;

commit;
