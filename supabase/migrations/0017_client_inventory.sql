-- ============================================================================
-- Gestaltung — 0017: a personal inventory for signed-in clients
-- ============================================================================
-- Things the client owns or wants to track. Independent of the cart: they can
-- add a store item they never bought here, or a custom item that is not in the
-- catalogue at all (name, quantity, optional photo).
--
-- A SEPARATE TABLE from public.inventory_items, deliberately. That one is the
-- workshop's tenant-scoped production stock, tied to the retired jobs pipeline
-- and unusable by clients (FINDINGS.md notes 3 and 4). Merging them would
-- confuse two different things that happen to share a word. They must stay
-- distinct in the UI and in the en/ar labels too: this one is "your inventory",
-- that one is workshop stock.
--
-- Requires an account. A guest who tries to use it is prompted to sign up, and
-- because signing up keeps the same auth.uid() (verified: updateUser preserves
-- the id), the action they started can simply be completed afterwards.
--
-- Run after 0016. Safe to re-run.
-- ============================================================================

create table if not exists public.client_inventory_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Either a catalogue part…
  product_id  uuid references public.parts (id) on delete set null,
  -- …or something of their own that we do not sell.
  custom_name text,
  quantity    integer not null default 1 check (quantity >= 0),
  -- <user_id>/<uuid> in the project-images bucket, for a custom item's photo.
  image_path  text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Exactly one of the two identities, never both, never neither. Note that
  -- product_id is `on delete set null`, so a delisted part would violate this —
  -- hence the custom_name fallback is filled in by the app before delisting.
  constraint client_inventory_identity check (
    (product_id is not null and custom_name is null) or
    (product_id is null     and custom_name is not null)
  )
);

create index if not exists client_inventory_user_idx
  on public.client_inventory_items (user_id);

-- One line per catalogue part per person; adding more tops up the quantity.
-- Custom items are not constrained this way — two things can share a name.
create unique index if not exists client_inventory_user_product_idx
  on public.client_inventory_items (user_id, product_id)
  where product_id is not null;

drop trigger if exists client_inventory_set_updated_at on public.client_inventory_items;
create trigger client_inventory_set_updated_at
  before update on public.client_inventory_items
  for each row execute function public.set_updated_at();

alter table public.client_inventory_items enable row level security;
grant select, insert, update, delete on public.client_inventory_items to authenticated;

drop policy if exists client_inventory_select on public.client_inventory_items;
create policy client_inventory_select on public.client_inventory_items
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists client_inventory_insert on public.client_inventory_items;
create policy client_inventory_insert on public.client_inventory_items
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists client_inventory_update on public.client_inventory_items;
create policy client_inventory_update on public.client_inventory_items
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists client_inventory_delete on public.client_inventory_items;
create policy client_inventory_delete on public.client_inventory_items
  for delete to authenticated
  using (user_id = auth.uid());

do $$
declare n_pol int;
begin
  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'client_inventory_items';
  raise notice 'client_inventory_items policies: % (expected 4)', n_pol;
  if n_pol <> 4 then raise exception 'client inventory migration incomplete'; end if;
end $$;
