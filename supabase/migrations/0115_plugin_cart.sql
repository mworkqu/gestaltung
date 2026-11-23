-- ============================================================================
-- 0115 — Add store parts to the signed-in user's cart in ONE statement
--        (chat plugin Phase 4b: the MCP tool add_parts_to_cart)
--
-- WHY: a client who designed something in their own Claude / ChatGPT and has
-- connected their Gestaltung360 account can put the parts in their cart from
-- the chat. Checkout stays on the website; this never places an order and
-- never touches create_part_order or any total.
--
-- The rule it exists for (CLAUDE.md, failure P5-02 / F-006): cart lines are
-- written by ONE statement, all or nothing — never a line-at-a-time loop.
--
-- 1. plugin_add_to_cart(p_lines jsonb) -> jsonb
--    authenticated only; the caller IS the user (auth.uid() comes from their
--    OAuth access token). Returns
--      {ok:true, added, lines:[{sku,name,qty,unit_price_qar}], skipped:[sku]}
--    or {ok:false, reason:'sign_in'|'guest'|'bad_lines'}. It never raises, so
--    the MCP tool can turn every outcome into words for the model.
--
-- Quantities follow the storefront's own rule: at least the product's
-- min_order_qty, and a product already in the cart is topped up rather than
-- duplicated (unique index cart_items_line_unique, 0025). Only a published,
-- unmerged, deliverable product can be added; anything else comes back in
-- `skipped` so the model can say so instead of silently dropping it.
--
-- ROLLBACK: drop function if exists public.plugin_add_to_cart(jsonb);
--           (nothing else is created; no column or row is changed)
-- ============================================================================

create or replace function public.plugin_add_to_cart(p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_guest  boolean;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'sign_in');
  end if;

  -- A guest (anonymous) session is not an account: it cannot be signed into on
  -- the website later, so a cart filled under it would be lost.
  select coalesce(is_anonymous, false) into v_guest from auth.users where id = v_uid;
  if coalesce(v_guest, false) then
    return jsonb_build_object('ok', false, 'reason', 'guest');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_lines');
  end if;

  -- One statement. `want` sums a repeated SKU, because ON CONFLICT DO UPDATE
  -- cannot touch the same row twice; `ins` is the only write; the json is
  -- built from the same CTEs, so what is reported is what was written.
  with want as (
    select btrim(l.sku) as sku, least(sum(greatest(coalesce(l.qty, 1), 1)), 999)::integer as qty
      from jsonb_to_recordset(p_lines) as l(sku text, qty integer)
     where l.sku is not null and btrim(l.sku) <> ''
     group by btrim(l.sku)
  ),
  capped as (
    select sku, qty from want order by sku limit 20
  ),
  found as (
    select c.sku, p.id, p.name, p.unit_price, greatest(coalesce(p.min_order_qty, 1), c.qty) as qty
      from capped c
      join public.parts p
        on p.sku = c.sku
       and p.is_published
       and p.merged_into is null
       and p.lead_time_class is not null
  ),
  ins as (
    insert into public.cart_items (user_id, product_id, quantity)
    select v_uid, f.id, f.qty from found f
    on conflict (user_id, product_id,
                 coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 coalesce(kit_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do update set quantity = cart_items.quantity + excluded.quantity, updated_at = now()
    returning 1 as one
  )
  select jsonb_build_object(
           'ok', true,
           'added', (select count(*)::integer from ins),
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                              'sku', f.sku, 'name', f.name, 'qty', f.qty, 'unit_price_qar', f.unit_price
                            ) order by f.sku), '[]'::jsonb) from found f),
           'skipped', (select coalesce(jsonb_agg(c.sku order by c.sku), '[]'::jsonb)
                         from capped c where not exists (select 1 from found f where f.sku = c.sku))
         )
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.plugin_add_to_cart(jsonb) from public;
revoke all on function public.plugin_add_to_cart(jsonb) from anon;
grant execute on function public.plugin_add_to_cart(jsonb) to authenticated;

comment on function public.plugin_add_to_cart(jsonb) is
  'Chat plugin (0115): adds published store parts to the calling user''s cart in one statement. Returns {ok,added,lines,skipped}; never raises.';
