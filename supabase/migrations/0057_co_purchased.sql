-- ============================================================================
-- Gestaltung — 0057: "Frequently bought together" (co-purchased products)
--                    (P3-06 / WF-34, 2026-10-09)
-- ============================================================================
-- RUN AFTER 0056. Safe to re-run: the function is `create or replace`, the
-- index is `create index if not exists`, the grants are idempotent. No table,
-- column, row or setting is created or changed.
--
-- UNTIL THIS RUNS: the product page calls co_purchased() through PostgREST,
-- gets PGRST202 (function not found) and falls back to same-category products
-- (parts.store_category, published, in stock first) under the honest heading
-- "You may also need" (lib/store/public-catalog.ts getFrequentlyBoughtTogether,
-- pure merge in lib/store/bought-together.ts). Nothing breaks. After it runs,
-- the heading becomes "Frequently bought together" only when EVERY product
-- shown came from real orders; while there are fewer than 3 co-purchased
-- products the list is topped up from the same category and keeps the
-- fallback heading. The storefront cache (tag "parts") refreshes within
-- 5 minutes, or at once on any Dashboard → Store save.
--
-- CHECKS (before / after):
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'co_purchased';     -- 0 rows / 1 row
--   select * from public.co_purchased('<a published sku>');         -- after
--   select * from public.co_purchased('<a published sku>', 50);     -- clamped to 12
--
-- ROLLBACK (manual):
--   drop function if exists public.co_purchased(text, integer);
--   drop index if exists public.part_order_items_part_idx;
--
-- WHAT IT DOES
-- co_purchased(p_sku, p_limit default 3) → table (sku text, orders integer)
--   * the orders = part_orders that contain p_sku (by part_order_items.part_id
--     of the product with that SKU, or the part_sku snapshot, so an order
--     placed before a re-import still counts), NOT cancelled and NOT is_test
--     (0031). Status vocabulary after 0053: confirmed, paid, sourcing,
--     shipped, delivered, cancelled (older rows may still read pending /
--     processing — they count; only 'cancelled' is excluded).
--   * the other products in those orders, a merged duplicate (0030
--     merged_into) counted as its survivor, keeping only PUBLISHED, unmerged
--     products, never p_sku itself;
--   * orders = number of DISTINCT orders the pair shares; ranked by orders
--     desc, then the newest shared order, then sku; p_limit clamped to 1..12.
--   Returns ONLY the SKU and the order count — no price, cost, landed cost,
--   income, margin, supplier, customer or order id. The app loads the card
--   fields itself from the cached public catalogue.
--   SECURITY DEFINER because part_orders / part_order_items are not readable
--   by anon (0011 RLS); search_path = '' and every name schema-qualified.
--   EXECUTE: anon, authenticated (the product page uses the cookie-free anon
--   client); revoked from public first.
-- ============================================================================

-- Lookup "which orders contain this product" by part.
create index if not exists part_order_items_part_idx on public.part_order_items (part_id);

create or replace function public.co_purchased(p_sku text, p_limit integer default 3)
returns table (sku text, orders integer)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select p.id
      from public.parts p
     where p.sku = p_sku
  ),
  base_orders as (
    select distinct i.order_id
      from public.part_order_items i
      join public.part_orders o on o.id = i.order_id
     where (i.part_id in (select t.id from target t) or i.part_sku = p_sku)
       and o.status <> 'cancelled'
       and o.is_test is not true
  ),
  others as (
    select coalesce(src.merged_into, src.id) as part_id,
           i.order_id,
           o.created_at
      from public.part_order_items i
      join base_orders b on b.order_id = i.order_id
      join public.part_orders o on o.id = i.order_id
      join public.parts src on src.id = i.part_id
  )
  select p.sku,
         count(distinct x.order_id)::integer as orders
    from others x
    join public.parts p on p.id = x.part_id
   where p.is_published = true
     and p.merged_into is null
     and p.sku <> p_sku
     and p.id not in (select t.id from target t)
   group by p.sku
   order by count(distinct x.order_id) desc, max(x.created_at) desc, p.sku
   limit greatest(1, least(12, coalesce(p_limit, 3)));
$$;

revoke all on function public.co_purchased(text, integer) from public;
grant execute on function public.co_purchased(text, integer) to anon, authenticated;
