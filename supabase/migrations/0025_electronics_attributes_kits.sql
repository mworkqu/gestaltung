-- ============================================================================
-- Gestaltung — 0025: electronics build route, product attributes, project kits
-- ============================================================================
-- 1. projects.build_route — how the electronics get built: 'prototype'
--    (development boards, modules and discrete parts — what the store sells)
--    or 'custom_pcb' (a designed board, still prototyped first). Null until
--    the client chooses; the page preselects prototype.
--
-- 2. Typed attributes on products — parts.attributes and
--    client_inventory_items.attributes, shaped by lib/store/attributes.ts
--    ({ class: "resistor", resistance_ohm: 10000, tolerance_pct: 5, ... }).
--    The BOM matcher compares these first and falls back to text only when
--    they are missing (and then labels the match as weak). parts.pack_size is
--    how many pieces one sold unit contains ("sold in packs of 10").
--
-- 3. store_settings — owner-editable store settings; today only
--    kit_discount_pct. Anyone may read; super_admin writes.
--
-- 4. Project kits — a whole bill of materials bought as one cart entry.
--    project_kits is the kit; cart_items.kit_id groups its lines, and
--    cart_items.bom_lines records which BOM lines each cart line fulfils.
--
-- 5. create_part_order, extended (same signature). Items may now carry
--    project_id, bom_lines and kit_id. The server alone decides the price:
--    kit lines get the kit discount from store_settings at order time. For a
--    project the caller owns, the bought quantities are added to the project's
--    items (project_items) and the named BOM lines are marked fulfilled, so a
--    later re-analysis never adds them again.
--
-- 6. The event trigger (0024) also records build-route choices, fulfilled and
--    removed BOM lines. (The 'electronics' feature for analysis_runs /
--    ai_usage is migration 0026.)
--
-- Run after 0024. Safe to re-run.
-- ============================================================================

alter table public.projects
  add column if not exists build_route text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_build_route_check') then
    alter table public.projects
      add constraint projects_build_route_check check (build_route is null or build_route in ('prototype', 'custom_pcb'));
  end if;
end $$;

alter table public.parts
  add column if not exists attributes jsonb not null default '{}'::jsonb,
  add column if not exists pack_size  integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parts_pack_size_positive') then
    alter table public.parts add constraint parts_pack_size_positive check (pack_size >= 1);
  end if;
end $$;

alter table public.client_inventory_items
  add column if not exists attributes jsonb not null default '{}'::jsonb;

-- ── Store settings ───────────────────────────────────────────────────────────
create table if not exists public.store_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.store_settings enable row level security;
grant select on public.store_settings to anon, authenticated;
grant insert, update on public.store_settings to authenticated;

drop policy if exists store_settings_select on public.store_settings;
create policy store_settings_select on public.store_settings for select to anon, authenticated using (true);

drop policy if exists store_settings_write on public.store_settings;
create policy store_settings_write on public.store_settings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

insert into public.store_settings (key, value) values ('kit_discount_pct', '0'::jsonb)
on conflict (key) do nothing;

-- ── Project kits ─────────────────────────────────────────────────────────────
create table if not exists public.project_kits (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id   uuid references public.part_orders (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.project_kits enable row level security;
grant select, insert, delete on public.project_kits to authenticated;

drop policy if exists project_kits_select on public.project_kits;
create policy project_kits_select on public.project_kits
  for select to authenticated using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists project_kits_insert on public.project_kits;
create policy project_kits_insert on public.project_kits
  for insert to authenticated with check (user_id = auth.uid() and public.owns_project(project_id));

drop policy if exists project_kits_delete on public.project_kits;
create policy project_kits_delete on public.project_kits
  for delete to authenticated using (user_id = auth.uid() and order_id is null);

alter table public.cart_items
  add column if not exists bom_lines text[] not null default '{}',
  add column if not exists kit_id    uuid references public.project_kits (id) on delete cascade;

-- A kit line and a loose line for the same product and project can coexist.
alter table public.cart_items drop constraint if exists cart_items_user_id_product_id_project_id_key;
drop index if exists cart_items_line_unique;
create unique index cart_items_line_unique
  on public.cart_items (user_id, product_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        coalesce(kit_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.part_orders
  add column if not exists discount_qar numeric(10, 2) not null default 0;

alter table public.part_order_items
  add column if not exists project_id uuid references public.projects (id) on delete set null,
  add column if not exists kit_id     uuid references public.project_kits (id) on delete set null,
  add column if not exists bom_lines  text[] not null default '{}';

-- ── Checkout: kits, discounts, fulfilment ────────────────────────────────────
create or replace function public.create_part_order(
  p_customer_name  text,
  p_customer_phone text,
  p_customer_email text,
  p_delivery_area  text,
  p_delivery_notes text,
  p_items          jsonb
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
begin
  if coalesce(btrim(p_customer_name), '') = '' then raise exception 'customer_name is required'; end if;
  if coalesce(btrim(p_customer_phone), '') = '' then raise exception 'customer_phone is required'; end if;
  if coalesce(btrim(p_delivery_area), '') = '' then raise exception 'delivery_area is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;

  select coalesce((value #>> '{}')::numeric, 0) into v_pct from public.store_settings where key = 'kit_discount_pct';
  v_pct := least(greatest(coalesce(v_pct, 0), 0), 90);

  insert into public.part_orders (profile_id, customer_name, customer_phone, customer_email, delivery_area, delivery_notes, total_qar)
  values (auth.uid(), btrim(p_customer_name), btrim(p_customer_phone),
          nullif(btrim(coalesce(p_customer_email, '')), ''), btrim(p_delivery_area),
          nullif(btrim(coalesce(p_delivery_notes, '')), ''), 0)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select id, sku, name, unit_price into v_part
      from public.parts where id = (v_item ->> 'part_id')::uuid and is_published = true;
    if not found then raise exception 'part not available'; end if;

    -- Project links are only honoured for the caller's own project.
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

    insert into public.part_order_items (order_id, part_id, part_sku, part_name, quantity, unit_price_qar, project_id, kit_id, bom_lines)
    values (v_order_id, v_part.id, v_part.sku, v_part.name, v_qty, v_part.unit_price, v_project, v_kit, v_lines);

    v_total := v_total + (v_qty * v_part.unit_price);
    if v_kit is not null then v_kit_sum := v_kit_sum + (v_qty * v_part.unit_price); end if;

    if v_project is not null then
      -- The bought units now belong to the project…
      insert into public.project_items (project_id, product_id, quantity)
      values (v_project, v_part.id, v_qty)
      on conflict (project_id, product_id) do update set quantity = public.project_items.quantity + excluded.quantity;

      -- …and the BOM lines they were bought for are fulfilled.
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
  update public.part_orders set total_qar = v_total - v_discount, discount_qar = v_discount where id = v_order_id;
  update public.project_kits set order_id = v_order_id
   where user_id = auth.uid() and order_id is null
     and id in (select distinct oi.kit_id from public.part_order_items oi where oi.order_id = v_order_id and oi.kit_id is not null);

  return v_order_id;
end $$;

-- ── Event log: build route + fulfilled lines ─────────────────────────────────
create or replace function public.projects_event_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r      jsonb;
  prev   jsonb;
  l      jsonb;
  pl     jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_project_event(new.id, 'project_created', jsonb_build_object('name', new.name));
    return new;
  end if;

  if new.name is distinct from old.name then
    perform public.log_project_event(new.id, 'project_renamed', jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if new.brief is distinct from old.brief then
    perform public.log_project_event(new.id, 'brief_edited', jsonb_build_object(
      'charsBefore', coalesce(char_length(old.brief), 0), 'charsAfter', coalesce(char_length(new.brief), 0)));
  end if;
  if new.disciplines is distinct from old.disciplines then
    perform public.log_project_event(new.id, 'disciplines_changed', jsonb_build_object('from', old.disciplines, 'to', new.disciplines));
  end if;
  if new.build_route is distinct from old.build_route then
    perform public.log_project_event(new.id, 'build_route_chosen', jsonb_build_object('from', old.build_route, 'to', new.build_route));
  end if;
  if new.stages -> 'manufacturing' is distinct from old.stages -> 'manufacturing' then
    perform public.log_project_event(new.id,
      case when new.stages ->> 'manufacturing' = 'complete' then 'route_accepted' else 'route_unaccepted' end, '{}'::jsonb);
  end if;

  if new.spec is distinct from old.spec then
    if coalesce((new.spec ->> 'confirmed')::boolean, false) is distinct from coalesce((old.spec ->> 'confirmed')::boolean, false) then
      perform public.log_project_event(new.id,
        case when coalesce((new.spec ->> 'confirmed')::boolean, false) then 'understanding_confirmed' else 'understanding_unconfirmed' end,
        '{}'::jsonb);
    end if;
    for r in select * from jsonb_array_elements(coalesce(new.spec -> 'rows', '[]'::jsonb)) loop
      if coalesce((r ->> 'edited')::boolean, false) then
        prev := null;
        select x into prev from jsonb_array_elements(coalesce(old.spec -> 'rows', '[]'::jsonb)) x where x ->> 'id' = r ->> 'id' limit 1;
        if prev is null or not coalesce((prev ->> 'edited')::boolean, false) or (prev -> 'value') is distinct from (r -> 'value') then
          perform public.log_project_event(new.id, 'answer_given', jsonb_build_object(
            'id', r ->> 'id', 'label', r ->> 'label', 'value', r -> 'value', 'previous', prev -> 'value'));
        end if;
      end if;
    end loop;
  end if;

  if new.bom is distinct from old.bom then
    if (new.bom ->> 'analysedAt') is distinct from (old.bom ->> 'analysedAt') then
      perform public.log_project_event(new.id, 'bom_updated', jsonb_build_object(
        'lines', jsonb_array_length(coalesce(new.bom -> 'lines', '[]'::jsonb))));
    else
      for l in select * from jsonb_array_elements(coalesce(new.bom -> 'lines', '[]'::jsonb)) loop
        pl := null;
        select x into pl from jsonb_array_elements(coalesce(old.bom -> 'lines', '[]'::jsonb)) x where x ->> 'id' = l ->> 'id' limit 1;
        if (l -> 'choice') is distinct from (pl -> 'choice') then
          perform public.log_project_event(new.id, 'bom_product_chosen', jsonb_build_object(
            'line', l ->> 'id', 'function', l ->> 'function', 'productId', l -> 'choice', 'previous', pl -> 'choice'));
        end if;
        if (l -> 'fulfilled') is not null and (l -> 'fulfilled') is distinct from (pl -> 'fulfilled') then
          perform public.log_project_event(new.id, 'bom_line_fulfilled', jsonb_build_object(
            'line', l ->> 'id', 'function', l ->> 'function', 'fulfilled', l -> 'fulfilled'));
        end if;
      end loop;
      if (new.bom -> 'dismissed') is distinct from (old.bom -> 'dismissed') then
        perform public.log_project_event(new.id, 'bom_lines_dismissed', jsonb_build_object('dismissed', new.bom -> 'dismissed'));
      end if;
    end if;
  end if;

  if (new.netlist ->> 'generatedAt') is distinct from (old.netlist ->> 'generatedAt') and new.netlist is not null then
    perform public.log_project_event(new.id, 'circuit_generated', jsonb_build_object(
      'components', jsonb_array_length(coalesce(new.netlist -> 'components', '[]'::jsonb)),
      'nets', jsonb_array_length(coalesce(new.netlist -> 'nets', '[]'::jsonb))));
  end if;
  return new;
end $$;

do $$
begin
  raise notice '0025 applied: build_route, attributes, pack_size, store_settings, project_kits, kit-aware create_part_order';
end $$;
