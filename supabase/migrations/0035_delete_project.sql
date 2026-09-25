-- ============================================================================
-- Gestaltung — 0035: delete a project in one transaction (SITE_AUDIT #18)
-- ============================================================================
-- ROLLBACK (manual, run as one transaction):
--   begin;
--   drop function if exists public.delete_project(uuid, boolean);
--   commit;
--   The project page then fails every delete with its "could not be deleted"
--   message until the page is reverted to the old client-side delete. No data
--   is created or changed by this migration, so nothing else needs undoing.
--
-- WHAT CHANGES
-- public.delete_project(p_id, p_put_back) replaces the project page's
-- client-side delete (several separate requests: a dropped connection half
-- way through could delete the project and lose the units that were meant to
-- go back on the client's shelf). One function call = one transaction:
--   (a) the caller must own the project (projects.user_id = auth.uid()),
--       else it raises 'not_owner' and changes nothing;
--   (b) when p_put_back, every project line's OWN-SHELF units go back to the
--       caller's inventory. Own-shelf = qty_from_inventory minus the units on
--       live (not cancelled) orders for this project + part, because
--       create_part_order (0027 → 0034) also writes bought units into
--       qty_from_inventory — bought units are not "returned" to a shelf they
--       never came from. The upsert mirrors lib/projects/allocation.ts
--       returnToInventory: top up the caller's catalogue line for that part
--       (one per user + part, 0017 client_inventory_user_product_idx), or
--       insert (user_id, product_id, quantity);
--   (c) the project's cart lines are deleted (cart_items.project_id is ON
--       DELETE SET NULL, so they would otherwise survive untagged);
--   (d) the project is deleted; its lines, blocks, parts… cascade. Order
--       lines keep the order and lose the project tag (ON DELETE SET NULL).
-- Any error rolls all four back.
--
-- security definer with search_path = ''; executable by authenticated only
-- (anon and public revoked). The ownership check is the only gate, so it is
-- done on auth.uid() inside the function, never on a caller-supplied id.
--
-- Requires 0033 (a project with parts could not be deleted before it).
-- Run after 0034. Safe to re-run: the function is replaced in place.
-- ============================================================================

begin;

create or replace function public.delete_project(p_id uuid, p_put_back boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     record;
begin
  -- Lock the row so a second delete (double click) waits and then fails cleanly.
  perform 1 from public.projects
   where id = p_id and user_id = v_uid
   for update;
  if v_uid is null or not found then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if coalesce(p_put_back, false) then
    for r in
      select pi.product_id,
             (pi.qty_from_inventory - coalesce(b.bought, 0))::integer as shelf
        from public.project_items pi
        left join (
          select oi.part_id, sum(oi.quantity) as bought
            from public.part_order_items oi
            join public.part_orders o on o.id = oi.order_id
           where oi.project_id = p_id
             and o.status <> 'cancelled'
           group by oi.part_id
        ) b on b.part_id = pi.product_id
       where pi.project_id = p_id
         and pi.qty_from_inventory - coalesce(b.bought, 0) > 0
    loop
      insert into public.client_inventory_items (user_id, product_id, quantity)
      values (v_uid, r.product_id, r.shelf)
      on conflict (user_id, product_id) where product_id is not null
      do update set quantity = public.client_inventory_items.quantity + excluded.quantity;
    end loop;
  end if;

  delete from public.cart_items where project_id = p_id;
  delete from public.projects where id = p_id and user_id = v_uid;
end;
$$;

revoke all on function public.delete_project(uuid, boolean) from public;
revoke all on function public.delete_project(uuid, boolean) from anon;
grant execute on function public.delete_project(uuid, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_project' and p.prosecdef
  ) then
    raise exception '0035 incomplete: delete_project missing';
  end if;
  raise notice '0035 applied: delete_project(p_id, p_put_back) deletes a project, its cart lines and (optionally) returns own-shelf units, in one transaction';
end $$;

commit;
