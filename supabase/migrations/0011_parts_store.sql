-- ============================================================================
-- Gestaltung — Parts Store (e-commerce module)
-- ============================================================================
-- Run AFTER 0010_job_upsells.sql. Reuses the Stage 4 helpers
-- public.is_super_admin() and the shared public.set_updated_at() trigger fn
-- (created in 0004). Three tables: a public parts catalog, guest-friendly
-- part_orders, and snapshotted part_order_items. No payment processor — orders
-- are confirmed off-platform via WhatsApp.
--
-- Isolation model:
--   parts            — anyone (incl. anon) may read PUBLISHED rows; super_admin
--                      manages everything.
--   part_orders      — anyone may create (guest checkout); a signed-in user sees
--                      only their own; super_admin sees/manages all.
--   part_order_items — created alongside an order; readable by the order owner
--                      or super_admin.
-- Guest checkout goes through public.create_part_order() (SECURITY DEFINER) so
-- a guest never needs to SELECT the row back (RLS would hide it) and prices are
-- snapshotted authoritatively from the catalog, not trusted from the client.
-- ============================================================================

-- ─── Parts Catalog ──────────────────────────────────────────────────────────
create table if not exists public.parts (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique,
  name            text not null,
  name_ar         text,                          -- Arabic name (optional, falls back to name)
  description     text,
  description_ar  text,
  category        text not null,                 -- e.g. 'fasteners', 'screws', 'nuts', 'washers'
  material        text,                          -- e.g. 'stainless_steel', 'carbon_steel', 'brass'
  standard        text,                          -- e.g. 'ISO', 'DIN', 'ANSI'
  unit_price      numeric(10, 2) not null check (unit_price >= 0),
  min_order_qty   integer not null default 1 check (min_order_qty >= 1),
  stock_status    text not null default 'in_stock'
                    constraint parts_stock_status_check
                    check (stock_status in ('in_stock', 'low_stock', 'out_of_stock')),
  image_url       text,                          -- public URL (Supabase Storage or external)
  is_published    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists parts_published_idx on public.parts (is_published);
create index if not exists parts_category_idx on public.parts (category);

drop trigger if exists set_parts_updated_at on public.parts;
create trigger set_parts_updated_at
  before update on public.parts
  for each row execute function public.set_updated_at();

alter table public.parts enable row level security;

-- anon + authenticated can read published parts; super_admin reads all.
grant select on public.parts to anon, authenticated;
grant insert, update, delete on public.parts to authenticated;

drop policy if exists parts_public_select on public.parts;
create policy parts_public_select on public.parts
  for select to anon, authenticated
  using (is_published = true or public.is_super_admin());

drop policy if exists parts_admin_all on public.parts;
create policy parts_admin_all on public.parts
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ─── Part Orders ────────────────────────────────────────────────────────────
-- Guest checkout: profile_id is nullable (anon orders allowed).
create table if not exists public.part_orders (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid references public.profiles (id) on delete set null,
  customer_name   text not null,
  customer_phone  text not null,
  customer_email  text,
  delivery_area   text not null,                 -- e.g. 'Doha', 'Lusail', 'Industrial Area'
  delivery_notes  text,
  status          text not null default 'pending'
                    constraint part_orders_status_check
                    check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  total_qar       numeric(10, 2) not null default 0,
  whatsapp_sent   boolean not null default false, -- toggled by admin after confirming via WA
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists part_orders_created_at_idx on public.part_orders (created_at desc);
create index if not exists part_orders_profile_idx on public.part_orders (profile_id);

drop trigger if exists set_part_orders_updated_at on public.part_orders;
create trigger set_part_orders_updated_at
  before update on public.part_orders
  for each row execute function public.set_updated_at();

alter table public.part_orders enable row level security;

grant insert on public.part_orders to anon, authenticated;
grant select, update, delete on public.part_orders to authenticated;

-- Anyone may place an order (guest checkout). Inserts also flow through the
-- create_part_order() RPC below, which is the path the app actually uses.
drop policy if exists part_orders_insert on public.part_orders;
create policy part_orders_insert on public.part_orders
  for insert to anon, authenticated
  with check (true);

-- A signed-in user can see their own orders.
drop policy if exists part_orders_own_select on public.part_orders;
create policy part_orders_own_select on public.part_orders
  for select to authenticated
  using (public.is_super_admin() or profile_id = auth.uid());

-- Super admin manages all (status changes, whatsapp_sent, etc.).
drop policy if exists part_orders_admin_all on public.part_orders;
create policy part_orders_admin_all on public.part_orders
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ─── Order Line Items ───────────────────────────────────────────────────────
create table if not exists public.part_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.part_orders (id) on delete cascade,
  part_id         uuid not null references public.parts (id) on delete restrict,
  part_sku        text not null,   -- snapshot at order time
  part_name       text not null,   -- snapshot
  quantity        integer not null check (quantity > 0),
  unit_price_qar  numeric(10, 2) not null check (unit_price_qar >= 0),
  line_total_qar  numeric(10, 2) generated always as (quantity * unit_price_qar) stored
);

create index if not exists part_order_items_order_idx on public.part_order_items (order_id);

alter table public.part_order_items enable row level security;

grant insert on public.part_order_items to anon, authenticated;
grant select, update, delete on public.part_order_items to authenticated;

drop policy if exists part_order_items_insert on public.part_order_items;
create policy part_order_items_insert on public.part_order_items
  for insert to anon, authenticated
  with check (true);

-- Readable by the parent order's owner or super_admin.
drop policy if exists part_order_items_select on public.part_order_items;
create policy part_order_items_select on public.part_order_items
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.part_orders po
      where po.id = order_id
        and po.profile_id = auth.uid()
    )
  );

drop policy if exists part_order_items_admin_all on public.part_order_items;
create policy part_order_items_admin_all on public.part_order_items
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ─── Guest-safe checkout RPC ────────────────────────────────────────────────
-- Inserts an order plus its line items in one call and returns the new order id.
-- SECURITY DEFINER so a guest doesn't need SELECT on the freshly inserted row
-- (RLS would otherwise hide it) and so prices are snapshotted from the catalog
-- rather than trusted from the browser. p_items: jsonb array of
-- [{ "part_id": "<uuid>", "quantity": <int> }, ...].
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
  v_order_id uuid;
  v_item     jsonb;
  v_qty      integer;
  v_part     record;
  v_total    numeric(10, 2) := 0;
begin
  if coalesce(btrim(p_customer_name), '') = '' then
    raise exception 'customer_name is required';
  end if;
  if coalesce(btrim(p_customer_phone), '') = '' then
    raise exception 'customer_phone is required';
  end if;
  if coalesce(btrim(p_delivery_area), '') = '' then
    raise exception 'delivery_area is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;

  insert into public.part_orders (
    profile_id, customer_name, customer_phone, customer_email,
    delivery_area, delivery_notes, total_qar
  ) values (
    auth.uid(),
    btrim(p_customer_name),
    btrim(p_customer_phone),
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    btrim(p_delivery_area),
    nullif(btrim(coalesce(p_delivery_notes, '')), ''),
    0
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select id, sku, name, unit_price
      into v_part
      from public.parts
      where id = (v_item ->> 'part_id')::uuid
        and is_published = true;

    if not found then
      raise exception 'part not available';
    end if;

    insert into public.part_order_items (
      order_id, part_id, part_sku, part_name, quantity, unit_price_qar
    ) values (
      v_order_id, v_part.id, v_part.sku, v_part.name, v_qty, v_part.unit_price
    );

    v_total := v_total + (v_qty * v_part.unit_price);
  end loop;

  update public.part_orders set total_qar = v_total where id = v_order_id;

  return v_order_id;
end;
$$;

grant execute on function
  public.create_part_order(text, text, text, text, text, jsonb)
  to anon, authenticated;
