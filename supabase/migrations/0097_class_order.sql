-- 0097_class_order.sql
-- The class parts order: a teacher buys the parts for every team in one order,
-- and Economy delivery on that order is QAR 0.
--
-- RUN AFTER 0096. Safe to re-run. This is the only file of the school stage
-- that touches checkout, so run it on its own and place one test order after.
--
-- WHAT CHANGES
--   1. part_orders.class_id + class_breakdown (the per-team split, so the
--      studio can pack one bag per team).
--   2. school_free_class_delivery() reads store_settings.school_pricing
--      (default true when the row or the key is missing).
--   3. class_order_delivery_quote(items, class, from) = order_delivery_quote()
--      with the Economy tier at 0. Teachers only, for their own class.
--      Mirrors lib/schools/delivery.ts applyClassDelivery().
--   4. create_part_order v5 = the 0044 version plus p_class_id. Line for line
--      identical except: the class-teacher check, class_id/class_breakdown on
--      the order, a team's project accepted on a line of that class's order
--      (and then never written into — the teacher does not own it), and
--      Economy forced to 0 for a class order. The 0044 9-argument version is
--      dropped so PostgREST keeps exactly one create_part_order.
--
-- ROLLBACK (comments)
--   drop function if exists public.create_part_order(text, text, text, text, text, jsonb, text, boolean, text, uuid);
--   -- then re-create the 9-argument version verbatim from 0044_shipping_flat_free_threshold.sql
--   drop function if exists public.class_order_delivery_quote(jsonb, uuid, date);
--   drop function if exists public.school_free_class_delivery();
--   alter table public.part_orders drop column if exists class_breakdown, drop column if exists class_id;

alter table public.part_orders add column if not exists class_id uuid references public.school_classes (id) on delete set null;
-- [{team_id, team_name, project_id}] — the teams this one order is for, so the
-- studio can pack one bag per team (the lines are in part_order_items).
alter table public.part_orders add column if not exists class_breakdown jsonb;

create index if not exists part_orders_class_idx on public.part_orders (class_id);

create or replace function public.school_free_class_delivery()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value -> 'free_delivery_class_order')::text = 'true'
       from public.store_settings where key = 'school_pricing'),
    true);
$$;

revoke all on function public.school_free_class_delivery() from public, anon, authenticated;

-- The quote a teacher is shown for "Buy parts for all teams": the normal quote
-- with Economy at QAR 0. Mirrors lib/schools/delivery.ts applyClassDelivery().
create or replace function public.class_order_delivery_quote(p_items jsonb, p_class uuid, p_from date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote jsonb := public.order_delivery_quote(p_items, p_from);
begin
  if auth.uid() is null
     or not exists (select 1 from public.school_classes c where c.id = p_class and c.teacher_id = auth.uid()) then
    raise exception 'not_found';
  end if;
  if not public.school_free_class_delivery() then return v_quote; end if;
  if v_quote -> 'tiers' -> 'economy' is null then return v_quote; end if;
  return jsonb_set(
    v_quote,
    '{tiers,economy}',
    (v_quote -> 'tiers' -> 'economy')
      || jsonb_build_object('carrier_cost_qar', 0, 'base_cost_qar', 0, 'free', true));
end $$;

revoke all on function public.class_order_delivery_quote(jsonb, uuid, date) from public, anon;
grant execute on function public.class_order_delivery_quote(jsonb, uuid, date) to authenticated;

-- create_part_order v5: identical to 0044 except for p_class_id (a class order
-- the calling teacher owns; Economy delivery is then free) and the stored
-- per-team breakdown. The 0044 9-argument version is dropped at the end so
-- PostgREST has exactly one create_part_order.
create or replace function public.create_part_order(
  p_customer_name  text,
  p_customer_phone text,
  p_customer_email text,
  p_delivery_area  text,
  p_delivery_notes text,
  p_items          jsonb,
  p_shipping_tier  text default 'standard',
  p_split          boolean default false,
  p_payment_method text default null,
  p_class_id       uuid default null
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
  v_class     uuid := p_class_id;
  v_breakdown jsonb;
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
  -- 0097: only the class's own teacher may place a class order.
  if v_class is not null and not exists (
    select 1 from public.school_classes c where c.id = v_class and c.teacher_id = auth.uid()
  ) then raise exception 'not the class teacher'; end if;

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

  -- One bag per team: every team of this class, in join order.
  if v_class is not null then
    select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'team_name', t.team_name, 'project_id', t.project_id)
                              order by t.created_at), '[]'::jsonb)
      into v_breakdown
      from public.class_teams t where t.class_id = v_class;
  end if;

  insert into public.part_orders (profile_id, customer_name, customer_phone, customer_email, delivery_area, delivery_notes, total_qar,
                                  shipping_tier, split_shipments, shipping_qar, handling_fee_qar, promised_date, early_promised_date, held_by,
                                  has_on_request, payment_method, class_id, class_breakdown)
  values (auth.uid(), btrim(p_customer_name), btrim(p_customer_phone),
          nullif(btrim(coalesce(p_customer_email, '')), ''), btrim(p_delivery_area),
          nullif(btrim(coalesce(p_delivery_notes, '')), ''), 0,
          p_shipping_tier, v_split, v_shipping, v_fee, v_date, v_early,
          case when v_split or v_can_split then v_quote ->> 'held_by' end,
          v_on_req, p_payment_method, v_class, v_breakdown)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select id, sku, name, unit_price, lead_time_class into v_part
      from public.parts where id = (v_item ->> 'part_id')::uuid and is_published = true;
    if not found then raise exception 'part not available'; end if;

    v_project := nullif(v_item ->> 'project_id', '')::uuid;
    v_owns := v_project is not null and auth.uid() is not null
              and exists (select 1 from public.projects p where p.id = v_project and p.user_id = auth.uid());
    -- 0097: a teacher's class order may reference their teams' projects.
    if not v_owns and v_project is not null and v_class is not null then
      v_owns := exists (select 1 from public.class_teams t where t.project_id = v_project and t.class_id = v_class);
    end if;
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

    -- A class order never writes into a team's project (the teacher is not its
    -- owner); the per-team split is on the order instead.
    if v_project is not null and v_class is null then
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
  -- 0097: a class order ships Economy for free.
  if v_class is not null and p_shipping_tier = 'economy' and public.school_free_class_delivery() then
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

grant execute on function public.create_part_order(text, text, text, text, text, jsonb, text, boolean, text, uuid) to anon, authenticated;

-- Exactly one create_part_order, so a 9-argument call is never ambiguous.
drop function if exists public.create_part_order(text, text, text, text, text, jsonb, text, boolean, text);

do $$
declare n integer;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'create_part_order';
  raise notice 'create_part_order overloads: % (expected 1)', n;
  if n <> 1 then
    raise exception 'create_part_order must have exactly one overload (found %)', n;
  end if;
end $$;
