-- ============================================================================
-- Gestaltung — 0034: checkout no longer doubles a project line's quantity
--                    (SITE_AUDIT #3/#4 — the "ESP32 · GR-011 × 2" mismatch)
-- ============================================================================
-- ROLLBACK (manual, run as one transaction):
--   1. Re-run the create_part_order section of 0032_on_request_checkout.sql
--      (from `create or replace function public.create_part_order(` down to
--      its `grant execute …` line). That restores v4 (which doubles again).
--      Same signature, so no drop is needed.
--   2. Only if you also want the repaired quantities back:
--        update public.project_items pi
--           set quantity = r.quantity_before
--          from public.project_items_repair_0034 r
--         where pi.id = r.project_item_id and pi.quantity = r.quantity_after;
--      Do NOT drop public.project_items_repair_0034: its existence is what
--      stops a re-run of this file from repairing the same lines twice.
--
-- WHAT CHANGES
-- 1. create_part_order v5 = v4 (0032) with one change, in the project_items
--    upsert. A project's cart line is the line's "to buy" remainder
--    (quantity − qty_from_inventory): those units are already counted in
--    quantity. v4 added the bought units to BOTH columns, so a line of 1
--    became 2 after checkout and the project cost doubled. v5:
--      qty_from_inventory = qty_from_inventory + bought
--      quantity           = greatest(quantity, qty_from_inventory + bought)
--    i.e. the bought units become held, and quantity only grows when more was
--    bought than the line still needed. A new line (no conflict) is still
--    inserted as (bought, bought). Signature, security definer,
--    search_path = '' and grants are unchanged.
--
-- 2. One-time data repair of lines already doubled by v4 (and by the 0027 /
--    0029 versions, which had the same upsert). For a line with live
--    (not cancelled) order lines for the same project + part, B = the units
--    on those order lines. Doubling turned (q0, f0) into (q0 + B, f0 + B), so
--      quantity := greatest(quantity − B, qty_from_inventory)
--    gives back exactly what v5 would have written. Only lines with
--    quantity − B ≥ 1 and qty_from_inventory ≥ B are touched (a line whose
--    held units were later returned to the shelf is left alone), and only
--    lines created BEFORE their first live order (project_items.created_at <
--    min(part_orders.created_at)): v4 can only have doubled a line that
--    already existed when the order came in. A line created by the insert
--    path gets the same transaction now() as its order (equal → excluded), so
--    a client raising it afterwards with "+" (2/2 → 3/2) keeps that unit; a
--    line removed and re-added after the order is newer still (excluded).
--    (Test note: PGlite can give a line and an order inserted back-to-back
--    identical timestamps; real Postgres runs them in separate transactions
--    with a microsecond clock, so they differ. The harness sleeps between.)
--    qty_from_inventory is never changed and quantity never drops below it.
--
--    The formula alone is NOT safe to repeat: once v5 is live, a normal order
--    (line 5 / 0, buy 1 → 5 / 1) looks exactly like a doubled line and a
--    second pass would wrongly lower it to 4. So the repair runs only once:
--    it creates public.project_items_repair_0034 (one row per corrected line,
--    with the before/after quantity) and skips itself whenever that table
--    already exists. The repair runs in the same transaction as the v5
--    switch, after locking part_orders and project_items, so every order it
--    counts was placed under the old function.
--
--    Not repaired (review by hand if the DRY RUN below shows any):
--      * lines whose only orders were cancelled — v4 doubled them at checkout
--        and cancelling does not undo it (second dry-run query);
--      * lines edited by the client after checkout, or bought under 0025/0026
--        (quantity grew, qty_from_inventory did not) — the guard skips most.
--
-- DRY RUN (read-only; run in the SQL editor BEFORE applying, to see what the
-- repair will change):
--   with bought as (
--     select oi.project_id, oi.part_id, sum(oi.quantity)::int as b,
--            min(o.created_at) as first_order
--       from public.part_order_items oi
--       join public.part_orders o on o.id = oi.order_id
--      where oi.project_id is not null and o.status <> 'cancelled'
--      group by oi.project_id, oi.part_id
--   )
--   select pr.name as project, p.sku, pi.quantity, pi.qty_from_inventory,
--          b.b as bought, greatest(pi.quantity - b.b, pi.qty_from_inventory) as quantity_after
--     from public.project_items pi
--     join bought b on b.project_id = pi.project_id and b.part_id = pi.product_id
--     join public.projects pr on pr.id = pi.project_id
--     join public.parts p on p.id = pi.product_id
--    where pi.quantity - b.b >= 1
--      and pi.qty_from_inventory >= b.b
--      and greatest(pi.quantity - b.b, pi.qty_from_inventory) < pi.quantity
--      and pi.created_at < b.first_order
--    order by pr.name, p.sku;
--
--   -- lines carrying cancelled orders (not repaired; check by hand):
--   select pr.name as project, oi.part_sku, pi.quantity, pi.qty_from_inventory,
--          oi.quantity as cancelled_qty, o.id as order_id
--     from public.part_order_items oi
--     join public.part_orders o on o.id = oi.order_id and o.status = 'cancelled'
--     join public.project_items pi on pi.project_id = oi.project_id and pi.product_id = oi.part_id
--     join public.projects pr on pr.id = pi.project_id
--    order by pr.name, oi.part_sku;
--
-- This dry run is only valid BEFORE 0034 is applied. After it, lines ordered
-- under v5 show up in it too and must not be "repaired".
--
-- Run after 0032/0033. Safe to re-run: the function is replaced in place and
-- the repair is skipped once public.project_items_repair_0034 exists.
-- ============================================================================

begin;

-- No checkout may write orders or project lines while the function is swapped
-- and the old doubling is repaired.
lock table public.part_orders, public.project_items in share row exclusive mode;

-- ── 1. create_part_order v5 (same signature, grants and security as v4) ─────
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
  update public.part_orders
     set total_qar = v_total - v_discount + v_shipping + v_fee, discount_qar = v_discount
   where id = v_order_id;
  update public.project_kits set order_id = v_order_id
   where user_id = auth.uid() and order_id is null
     and id in (select distinct oi.kit_id from public.part_order_items oi where oi.order_id = v_order_id and oi.kit_id is not null);

  return v_order_id;
end $$;

grant execute on function public.create_part_order(text, text, text, text, text, jsonb, text, boolean) to anon, authenticated;

-- ── 2. One-time repair of lines doubled by the old checkout ─────────────────
do $$
declare
  v_count integer;
  v_when  timestamptz;
begin
  if to_regclass('public.project_items_repair_0034') is not null then
    select min(repaired_at) into v_when from public.project_items_repair_0034;
    raise notice '0034 repair: already ran (%) — 0 project line(s) changed; do not drop project_items_repair_0034', coalesce(v_when::text, 'no lines needed it');
    return;
  end if;

  create table public.project_items_repair_0034 (
    project_item_id    uuid primary key,
    project_id         uuid not null,
    product_id         uuid not null,
    bought             integer not null,
    quantity_before    integer not null,
    quantity_after     integer not null,
    qty_from_inventory integer not null,
    repaired_at        timestamptz not null default now()
  );
  comment on table public.project_items_repair_0034 is
    'Lines corrected by 0034 (checkout had doubled their quantity). Its existence stops 0034 from repairing twice — do not drop.';
  alter table public.project_items_repair_0034 enable row level security;
  revoke all on table public.project_items_repair_0034 from public, anon, authenticated;

  with bought as (
    select oi.project_id, oi.part_id, sum(oi.quantity)::int as b,
           min(o.created_at) as first_order
      from public.part_order_items oi
      join public.part_orders o on o.id = oi.order_id
     where oi.project_id is not null and o.status <> 'cancelled'
     group by oi.project_id, oi.part_id
  ), target as (
    select pi.id, pi.project_id, pi.product_id, b.b, pi.quantity as q_before,
           greatest(pi.quantity - b.b, pi.qty_from_inventory) as q_after, pi.qty_from_inventory
      from public.project_items pi
      join bought b on b.project_id = pi.project_id and b.part_id = pi.product_id
     where pi.quantity - b.b >= 1
       and pi.qty_from_inventory >= b.b
       and greatest(pi.quantity - b.b, pi.qty_from_inventory) < pi.quantity
       and pi.created_at < b.first_order  -- v4 only doubled lines that existed before the order
  ), logged as (
    insert into public.project_items_repair_0034
           (project_item_id, project_id, product_id, bought, quantity_before, quantity_after, qty_from_inventory)
    select id, project_id, product_id, b, q_before, q_after, qty_from_inventory from target
    returning project_item_id, quantity_after
  )
  update public.project_items pi
     set quantity = l.quantity_after
    from logged l
   where pi.id = l.project_item_id;
  get diagnostics v_count = row_count;
  raise notice '0034 repair: % project line(s) had their doubled quantity corrected (logged in public.project_items_repair_0034 — do not drop project_items_repair_0034, it stops a re-run from repairing twice)', v_count;
end $$;

do $$ begin raise notice '0034 applied: create_part_order v5 marks bought project units as held instead of adding them to the line quantity'; end $$;

commit;
