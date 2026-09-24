-- ============================================================================
-- Gestaltung — 0029: image intake, demand capture, honest delivery dates
--                    (Part 4, Tasks 17 + 18)
-- ============================================================================
-- 1. Product images (Task 17). parts.images = [{ web, thumb, path, drive_file_id }]
--    copied from Google Drive into the public `product-images` bucket (never
--    hotlinked). parts.image_url stays the first web image for older readers.
--
-- 2. demand_signals (Task 18b/c) — one table, one row per signal:
--      view | add_to_cart | request | zero_search | bom_unmatched
--    with part, user (when known), time, source page; request adds email,
--    quantity, note; zero_search the term; bom_unmatched the project and BOM
--    line (one row per project + line however often it's matched).
--    served_at marks signals answered by stock arriving (Task 20) — never
--    deleted. Written only through record_demand() / record_bom_demand().
--
-- 3. Delivery promises (Task 18d/f). store_settings.shipping holds the three
--    tiers (real carrier cost + transit days), the handling fee (its own line)
--    and handling / buffer days. Promise date =
--      today + item lead days + handling days + transit days + buffer days
--    where item lead days is the upper bound of its lead-time class
--    (in_stock 2, 3_5_days 5, 1_2_weeks 14, 2_4_weeks 28). A product with no
--    offer (class null, "available on request") cannot be ordered.
--    A mixed order ships once at the latest date (naming the item holding it)
--    unless the customer splits it: two shipments, two carrier charges.
--
-- 4. create_part_order v3: + p_shipping_tier, p_split. Prices shipping on the
--    server, snapshots each item's lead-time class and the promised date(s).
--    The old 6-argument version is dropped (the new one has defaults, so old
--    callers still work).
--
-- 5. order_delivery_quote() — the same computation, read-only, for the cart
--    and checkout to display exactly what the order will record.
--
-- Run after 0028. Safe to re-run.
-- ============================================================================

-- ── 1. Product images ────────────────────────────────────────────────────────
alter table public.parts
  add column if not exists images jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');

drop policy if exists product_images_admin_write on storage.objects;
create policy product_images_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'product-images' and public.is_super_admin())
  with check (bucket_id = 'product-images' and public.is_super_admin());

-- ── 2. Demand signals ────────────────────────────────────────────────────────
create table if not exists public.demand_signals (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('view', 'add_to_cart', 'request', 'zero_search', 'bom_unmatched')),
  part_id      uuid references public.parts (id) on delete set null,
  user_id      uuid references auth.users (id) on delete set null,
  source_page  text,
  email        text,
  quantity     integer check (quantity is null or quantity >= 1),
  note         text,
  search_term  text,
  project_id   uuid references public.projects (id) on delete set null,
  bom_line_id  text,
  bom_label    text,
  served_at    timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists demand_signals_part_idx on public.demand_signals (part_id, kind);
create index if not exists demand_signals_kind_idx on public.demand_signals (kind, created_at desc);
create unique index if not exists demand_signals_bom_line_uniq
  on public.demand_signals (project_id, bom_line_id) where kind = 'bom_unmatched';

alter table public.demand_signals enable row level security;
grant select, update on public.demand_signals to authenticated;
drop policy if exists demand_signals_admin_select on public.demand_signals;
create policy demand_signals_admin_select on public.demand_signals
  for select to authenticated using (public.is_super_admin());
drop policy if exists demand_signals_admin_update on public.demand_signals;
create policy demand_signals_admin_update on public.demand_signals
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.record_demand(
  p_kind        text,
  p_part_id     uuid default null,
  p_source_page text default null,
  p_email       text default null,
  p_quantity    integer default null,
  p_note        text default null,
  p_search_term text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_kind not in ('view', 'add_to_cart', 'request', 'zero_search') then raise exception 'bad kind'; end if;
  if p_kind in ('view', 'add_to_cart', 'request') then
    if p_part_id is null or not exists (select 1 from public.parts where id = p_part_id) then return; end if;
  end if;
  if p_kind = 'request' and (p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'email required';
  end if;
  if p_kind = 'zero_search' and coalesce(btrim(p_search_term), '') = '' then return; end if;

  -- A reload is not a second view: one view per signed-in user and product per 30 minutes.
  if p_kind = 'view' and v_uid is not null and exists (
    select 1 from public.demand_signals
    where kind = 'view' and part_id = p_part_id and user_id = v_uid and created_at > now() - interval '30 minutes'
  ) then return; end if;
  if p_kind = 'zero_search' and exists (
    select 1 from public.demand_signals
    where kind = 'zero_search' and lower(search_term) = lower(btrim(p_search_term))
      and user_id is not distinct from v_uid and created_at > now() - interval '30 minutes'
  ) then return; end if;

  insert into public.demand_signals (kind, part_id, user_id, source_page, email, quantity, note, search_term)
  values (
    p_kind, p_part_id, v_uid,
    left(p_source_page, 300),
    case when p_kind = 'request' then left(lower(btrim(p_email)), 200) end,
    case when p_kind = 'request' then least(greatest(coalesce(p_quantity, 1), 1), 100000) end,
    case when p_kind = 'request' then nullif(left(btrim(coalesce(p_note, '')), 1000), '') end,
    case when p_kind = 'zero_search' then left(btrim(p_search_term), 200) end
  );
end $$;

revoke all on function public.record_demand(text, uuid, text, text, integer, text, text) from public;
grant execute on function public.record_demand(text, uuid, text, text, integer, text, text) to anon, authenticated;

-- BOM lines with no store match, for a project the caller owns.
-- p_lines = [{ "id": "...", "label": "10 kΩ resistor", "quantity": 4 }]
create or replace function public.record_bom_demand(p_project uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare l jsonb;
begin
  if not public.owns_project(p_project) then return; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    continue when coalesce(l ->> 'id', '') = '';
    insert into public.demand_signals (kind, user_id, project_id, bom_line_id, bom_label, quantity, source_page)
    values ('bom_unmatched', auth.uid(), p_project, left(l ->> 'id', 120), left(l ->> 'label', 200),
            greatest(1, coalesce((l ->> 'quantity')::integer, 1)), 'prototyping')
    on conflict (project_id, bom_line_id) where kind = 'bom_unmatched' do update
      set bom_label = excluded.bom_label, quantity = excluded.quantity;
  end loop;
end $$;

grant execute on function public.record_bom_demand(uuid, jsonb) to authenticated;

-- ── 3. Shipping settings + order columns ─────────────────────────────────────
insert into public.store_settings (key, value) values (
  'shipping',
  '{
     "handling_fee_qar": 10,
     "handling_days": 1,
     "buffer_days": 3,
     "tiers": {
       "express":  { "carrier_cost_qar": 45, "transit_days": 1 },
       "standard": { "carrier_cost_qar": 20, "transit_days": 3 },
       "economy":  { "carrier_cost_qar": 10, "transit_days": 7 }
     }
   }'::jsonb
) on conflict (key) do nothing;

alter table public.part_orders
  add column if not exists shipping_tier          text,
  add column if not exists split_shipments        boolean not null default false,
  add column if not exists shipping_qar           numeric(10, 2) not null default 0,
  add column if not exists handling_fee_qar       numeric(10, 2) not null default 0,
  add column if not exists promised_date          date,
  add column if not exists early_promised_date    date,
  add column if not exists held_by                text,
  add column if not exists confirmation_emailed_at timestamptz,
  add column if not exists delay_notified_at      timestamptz;

alter table public.part_order_items
  add column if not exists lead_time_class text,
  add column if not exists promised_date   date;

create or replace function public.lead_class_days(p_class text)
returns integer
language sql
immutable
as $$
  select case p_class
    when 'in_stock' then 2
    when '3_5_days' then 5
    when '1_2_weeks' then 14
    when '2_4_weeks' then 28
  end;
$$;

-- ── 5. Delivery quote (read-only, shared by cart/checkout and the RPC) ───────
-- p_items = [{ "part_id": "...", "quantity": 2 }]. Returns per tier: carrier
-- cost, handling fee, single-shipment date, and (when lead times differ) the
-- split option: early date, extra carrier cost.
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
  v_out      jsonb := '{}'::jsonb;
begin
  select value into v_cfg from public.store_settings where key = 'shipping';
  v_handling := coalesce((v_cfg ->> 'handling_days')::integer, 1);
  v_buffer   := coalesce((v_cfg ->> 'buffer_days')::integer, 3);
  v_fee      := coalesce((v_cfg ->> 'handling_fee_qar')::numeric, 0);

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
    v_out := v_out || jsonb_build_object(v_tier, jsonb_build_object(
      'carrier_cost_qar', coalesce((v_t ->> 'carrier_cost_qar')::numeric, 0),
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
    'on_request', v_on_req
  );
end $$;

grant execute on function public.order_delivery_quote(jsonb, date) to anon, authenticated;

-- ── 4. create_part_order v3 ──────────────────────────────────────────────────
drop function if exists public.create_part_order(text, text, text, text, text, jsonb);

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

  -- No money against a date we have not committed to.
  v_quote := public.order_delivery_quote(p_items);
  if jsonb_array_length(v_quote -> 'on_request') > 0 then raise exception 'item available on request only'; end if;
  v_tier := v_quote -> 'tiers' -> p_shipping_tier;
  if v_tier is null or v_tier ->> 'date' is null then raise exception 'no delivery date'; end if;

  v_split    := coalesce(p_split, false) and coalesce((v_quote ->> 'can_split')::boolean, false);
  v_shipping := (v_tier ->> 'carrier_cost_qar')::numeric * (case when v_split then 2 else 1 end);
  v_fee      := (v_quote ->> 'handling_fee_qar')::numeric;
  v_date     := (v_tier ->> 'date')::date;
  v_early    := case when v_split then (v_tier ->> 'early_date')::date end;
  select min(public.lead_class_days(p.lead_time_class)) into v_min_days
    from jsonb_array_elements(p_items) i join public.parts p on p.id = (i ->> 'part_id')::uuid;

  select coalesce((value #>> '{}')::numeric, 0) into v_pct from public.store_settings where key = 'kit_discount_pct';
  v_pct := least(greatest(coalesce(v_pct, 0), 0), 90);

  insert into public.part_orders (profile_id, customer_name, customer_phone, customer_email, delivery_area, delivery_notes, total_qar,
                                  shipping_tier, split_shipments, shipping_qar, handling_fee_qar, promised_date, early_promised_date, held_by)
  values (auth.uid(), btrim(p_customer_name), btrim(p_customer_phone),
          nullif(btrim(coalesce(p_customer_email, '')), ''), btrim(p_delivery_area),
          nullif(btrim(coalesce(p_delivery_notes, '')), ''), 0,
          p_shipping_tier, v_split, v_shipping, v_fee, v_date, v_early,
          case when v_split or (v_quote ->> 'can_split')::boolean then v_quote ->> 'held_by' end)
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
            case when v_split and public.lead_class_days(v_part.lead_time_class) = v_min_days then v_early else v_date end);

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

do $$ begin raise notice '0029 applied: product images, demand signals, shipping tiers, promised dates, create_part_order v3'; end $$;
