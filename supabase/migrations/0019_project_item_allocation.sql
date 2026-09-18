-- ============================================================================
-- Gestaltung — 0019: where each part on a project came from
-- ============================================================================
-- A part is either on the client's shelf or committed to a project, never both
-- and never counted twice. So adding a part to a project has two cases:
--
--   they already own some  -> those units move OFF the inventory and onto the
--                             project. Nothing is bought.
--   they own none (or too
--   few)                   -> the shortfall goes to the cart, tagged with the
--                             project, and is bought at checkout.
--
-- To undo that later — when an item is removed, or the whole project is
-- cancelled and they choose to put everything back — we have to know how many
-- of the units on a project came off their own shelf rather than from an
-- order. That is what this column records.
--
-- The remainder (quantity - qty_from_inventory) is the part that came from,
-- or is still waiting in, the cart.
--
-- Run after 0018. Safe to re-run.
-- ============================================================================

alter table public.project_items
  add column if not exists qty_from_inventory integer not null default 0;

-- Can't have taken more off the shelf than the project holds, and can't be
-- negative. Added separately so re-running the file is harmless.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_items_from_inventory_range'
  ) then
    alter table public.project_items
      add constraint project_items_from_inventory_range
      check (qty_from_inventory >= 0 and qty_from_inventory <= quantity);
  end if;
end $$;

comment on column public.project_items.qty_from_inventory is
  'How many of this line''s units were taken off the client''s own inventory. '
  'The rest came from the cart. Used to put units back when an item is removed '
  'or a project is cancelled.';

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'project_items'
     and column_name = 'qty_from_inventory';
  raise notice 'project_items.qty_from_inventory: % (expected 1)', n;
  if n <> 1 then raise exception 'allocation migration incomplete'; end if;
end $$;
