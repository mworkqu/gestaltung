-- ============================================================================
-- Gestaltung — 0014: close the guest order-forgery hole
-- ============================================================================
-- 0011 shipped two blanket INSERT policies:
--
--   part_orders_insert       ... with check (true)
--   part_order_items_insert  ... with check (true)
--
-- part_order_items.unit_price_qar is a client-supplied column, and the
-- publishable anon key is readable in any browser. Together that let anyone
-- write orders at any price they liked, or flood the tables with junk.
--
-- public.create_part_order() already exists precisely to prevent this: it is
-- SECURITY DEFINER, snapshots prices authoritatively from the catalog, ignores
-- whatever the client claims a price is, and computes the total server-side.
-- The app has only ever used the RPC — verified across the codebase, the sole
-- call site is app/[locale]/store/checkout/page.tsx. The raw INSERT policies
-- were dead weight holding the door open.
--
-- This drops them. Checkout is unaffected: the RPC runs as its owner and does
-- not consult these policies at all. super_admin management of orders goes
-- through part_orders_admin_all / part_order_items_admin_all, untouched here,
-- as does a signed-in customer reading their own order.
--
-- Safe to re-run.
-- ============================================================================

drop policy if exists part_orders_insert      on public.part_orders;
drop policy if exists part_order_items_insert on public.part_order_items;

-- Belt and braces: make sure the RPC is actually callable by guests and by
-- signed-in customers, since it is now the only way an order can be created.
grant execute on function public.create_part_order(
  text, text, text, text, text, jsonb
) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Verify
-- ----------------------------------------------------------------------------
-- Expect: no INSERT policy left on either table, and the RPC still present.

do $$
declare
  n_insert_policies int;
  n_rpc             int;
begin
  select count(*) into n_insert_policies
    from pg_policies
   where schemaname = 'public'
     and tablename in ('part_orders', 'part_order_items')
     and cmd = 'INSERT';

  select count(*) into n_rpc
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'create_part_order';

  raise notice 'raw INSERT policies remaining: % (expected 0)', n_insert_policies;
  raise notice 'create_part_order present: % (expected 1)', n_rpc;

  if n_rpc <> 1 then
    raise exception 'create_part_order is missing — do NOT apply this migration, checkout would break';
  end if;
end $$;
