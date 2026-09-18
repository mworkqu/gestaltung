-- ============================================================================
-- Gestaltung — 0016: the cart moves to the database, and learns about projects
-- ============================================================================
-- The cart was localStorage only (key gestaltung:cart), keyed by SKU, bound to
-- a browser rather than a person. Two problems: it did not survive a change of
-- device, and it could not say which project a line was for.
--
-- Now: one row per line, owned by a user_id, optionally tagged with a project.
-- Adding an item to a project also adds it to the cart tagged with that
-- project; the cart groups by project; and NO ORDER IS PLACED until the client
-- deliberately checks out. Checkout still goes through create_part_order.
--
-- project_id is nullable on purpose — buying something straight from the store,
-- unattached to any project, stays a first-class action.
--
-- Run after 0015. Safe to re-run.
-- ============================================================================

create table if not exists public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.parts (id) on delete cascade,
  -- Null = "for my inventory / no particular project".
  project_id uuid references public.projects (id) on delete set null,
  quantity   integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One line per product per project. Adding the same thing again tops up the
  -- quantity instead of creating a duplicate row.
  unique (user_id, product_id, project_id)
);

create index if not exists cart_items_user_idx    on public.cart_items (user_id);
create index if not exists cart_items_project_idx on public.cart_items (project_id);

drop trigger if exists cart_items_set_updated_at on public.cart_items;
create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

alter table public.cart_items enable row level security;
grant select, insert, update, delete on public.cart_items to authenticated;

-- Strictly your own cart. Note that super_admin is deliberately NOT given a
-- read here: nobody needs to browse a customer's un-ordered basket, and the
-- less that is readable the better. Placed orders remain fully visible through
-- part_orders.
drop policy if exists cart_items_select on public.cart_items;
create policy cart_items_select on public.cart_items
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists cart_items_insert on public.cart_items;
create policy cart_items_insert on public.cart_items
  for insert to authenticated
  with check (
    user_id = auth.uid()
    -- A line may only be tagged with a project you actually own.
    and (project_id is null or public.owns_project(project_id))
  );

drop policy if exists cart_items_update on public.cart_items;
create policy cart_items_update on public.cart_items
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (project_id is null or public.owns_project(project_id))
  );

drop policy if exists cart_items_delete on public.cart_items;
create policy cart_items_delete on public.cart_items
  for delete to authenticated
  using (user_id = auth.uid());

do $$
declare n_pol int;
begin
  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'cart_items';
  raise notice 'cart_items policies: % (expected 4)', n_pol;
  if n_pol <> 4 then raise exception 'cart_items migration incomplete'; end if;
end $$;
