-- ============================================================================
-- Gestaltung — 0032: "available on request" items can be checked out
--                    (SITE_AUDIT #6, owner decision 3a)
-- ============================================================================
-- ROLLBACK (manual, run as one transaction):
--   1. Re-run section "4. create_part_order v3" of
--      0029_intake_demand_delivery.sql (from `drop function if exists
--      public.create_part_order(text, text, text, text, text, jsonb);` down to
--      its `grant execute …` line). That restores the v3 body, which refuses
--      on-request items again. Same signature, so no drop is needed.
--   2. alter table public.part_orders drop column if exists has_on_request;
--   3. Revert the storefront code of the same change (cart/checkout would
--      otherwise let customers reach an RPC that refuses them).
--   Orders placed while 0032 was live keep their null promised dates.
--
-- WHAT CHANGES
-- A product with no active supplier offer has parts.lead_time_class = null
-- ("available on request", 0028). Until now create_part_order refused any
-- order containing one. The owner decided such items can be ordered at the
-- listed price, with the delivery date "to be confirmed":
--
--   * part_orders.has_on_request (new, default false) — true when at least one
--     line had no lead-time class when the order was placed.
--   * On-request lines are stored with lead_time_class null and
--     promised_date null.
--   * The order's promised_date / early_promised_date / held_by come from the
--     datable lines only; all null when nothing in the order is datable.
--   * A split shipment is still only offered between datable lines.
--
-- order_delivery_quote (0029) is NOT changed: it already dates only the lines
-- with a lead-time class (tier `date` null when none) and still returns the
-- on-request part ids, which the cart and checkout use to label those lines
-- "date to be confirmed".
--
-- stock_status stays admin-only and is never read here (owner decision 4b).
--
-- Run after 0029 (0030/0031 do not touch these objects). Safe to re-run.
-- ============================================================================

begin;

alter table public.part_orders
  add column if not exists has_on_request boolean not null default false;

comment on column public.part_orders.has_on_request is
  'True when at least one line had no supplier offer (lead_time_class null) at order time: its delivery date is to be confirmed (0032).';

-- ── create_part_order v4 (same signature, grants and security as v3) ─────────
create or replace function public.create_part_order(
  p_customer_name  text,
  p_customer_phone text,
  p_customer_email text,
  p_delivery_area  text,
  p_delivery_notes text,
  p_items          jsonb,
  p_shipping_tier  text default 'standard',
  p_split          boolean default false
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

  -- Dates come from the lines that have a supplier offer. Lines without one
  -- ("available on request") are sold at the listed price with the date to be
  -- confirmed; if nothing is datable the order has no promised date at all.
  v_quote := public.order_delivery_quote(p_items);
  v_tier := v_quote -> 'tiers' -> p_shipping_tier;
  if v_tier is null then raise exception 'shipping tier not configured'; end if;

  v_on_req    := jsonb_array_length(coalesce(v_quote -> 'on_request', '[]'::jsonb)) > 0;
  v_can_split := coalesce((v_quote ->> 'can_split')::boolean, false);
  v_split     := coalesce(p_split, false) and v_can_split;
  v_shipping  := (v_tier ->> 'carrier_cost_qar')::numeric * (case when v_split then 2 else 1 end);
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
                                  has_on_request)
  values (auth.uid(), btrim(p_customer_name), btrim(p_customer_phone),
          nullif(btrim(coalesce(p_customer_email, '')), ''), btrim(p_delivery_area),
          nullif(btrim(coalesce(p_delivery_notes, '')), ''), 0,
          p_shipping_tier, v_split, v_shipping, v_fee, v_date, v_early,
          case when v_split or v_can_split then v_quote ->> 'held_by' end,
          v_on_req)
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
        set quantity = public.project_items.quantity + excluded.quantity,
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
  update public.part_orders
     set total_qar = v_total - v_discount + v_shipping + v_fee, discount_qar = v_discount
   where id = v_order_id;
  update public.project_kits set order_id = v_order_id
   where user_id = auth.uid() and order_id is null
     and id in (select distinct oi.kit_id from public.part_order_items oi where oi.order_id = v_order_id and oi.kit_id is not null);

  return v_order_id;
end $$;

grant execute on function public.create_part_order(text, text, text, text, text, jsonb, text, boolean) to anon, authenticated;

do $$ begin raise notice '0032 applied: part_orders.has_on_request, create_part_order v4 accepts on-request items (date to be confirmed)'; end $$;

commit;
