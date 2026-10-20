-- ============================================================================
-- Gestaltung — 0098: a commission has its own floor (owner, 2026-10-20)
-- ============================================================================
-- Run AFTER 0095 (this replaces 0095's refresh_part_sourcing, which replaced
-- 0028's). Safe to re-run. NOT RUN YET (written by Claude; the owner runs it).
--
-- Numbered 0098, not 0096 or 0097: `review-analyse-guard` has taken 0096 and
-- `main` has taken both 0096 (school classes) and 0097 (class order).
--
-- WHY
-- The "below margin floor" warning fires on 911 of the 1,323 published
-- products, which is every single Voltaat product that has a working offer.
-- It is arithmetic, not pricing. For a mirror-priced product we do not set the
-- price at all — we follow Voltaat's retail price and earn Voltaat's
-- commission, so refresh_part_sourcing sets
--
--   expected_income_qar = price × supplier.commission_percent
--   income_pct          = exactly that commission_percent, always
--
-- Voltaat's commission is 10. margin_floor_pct is 15. 10 < 15, 911 times, and
-- nothing the owner can do on the product page will ever clear it — he would
-- have to renegotiate with Voltaat. Meanwhile the 35 markup products, where
-- the floor is a real decision (raise the price, or pick another supplier),
-- are buried under 911 rows of noise. The overview page had already papered
-- over it by excluding VLT- SKUs from that one list in TypeScript, which left
-- the catalogue list and the product page still flagging all 911.
--
-- The two numbers are not comparable. 15% margin on a part we buy and resell
-- is a floor on OUR pricing decision. 10% commission from a mirror supplier is
-- a floor on THAT SUPPLIER'S terms. One setting cannot mean both.
--
-- WHAT CHANGES
-- 1. store_settings.commission_floor_pct, default 8 (inserted only if absent,
--    so an owner-chosen value survives a re-run). Meaning: the lowest
--    commission we accept from a mirror supplier. Voltaat's 10 clears it; a
--    supplier offering us 5 would not.
-- 2. refresh_part_sourcing() is REPLACED. Same signature. 0095's offer order
--    (availability, then suppliers.rank, then lead days, then landed cost) is
--    carried over UNCHANGED — only the floor comparison differs:
--
--      markup part  → income_pct < margin_floor_pct      (15, unchanged)
--      mirror part  → income_pct < commission_floor_pct  (8, new)
--
--    A part with no usable offer still gets below_floor = false, as before.
-- 3. Every part is re-derived at the end, so the flag settles immediately.
--
-- WHAT THE FLAG MEANS AFTERWARDS
-- "This product earns less than we accept." On a markup product: our price is
-- too close to the landed cost — raise it or switch supplier. On a mirror
-- product: that supplier's commission is below what we accept — the only
-- lever is the supplier. Expected count right after this runs: 0. The worst
-- markup product sits at 16.74% against a 15% floor, and Voltaat's 10%
-- commission clears the 8% commission floor. The warning goes quiet and
-- becomes an alarm that means something when it does fire.
--
-- DRY RUN (read-only) — what is flagged now, and what would be:
--   select p.pricing_mode,
--          count(*) filter (where p.below_floor)                  as flagged_now,
--          count(*) filter (
--            where p.income_pct < case when p.pricing_mode = 'mirror' then 8 else 15 end
--          )                                                      as flagged_after
--     from public.parts p
--    where p.is_published and p.merged_into is null
--    group by p.pricing_mode;
--   -- expect mirror: 911 → 0, markup: 0 → 0.
--
-- ROLLBACK (manual):
--   delete from public.store_settings where key = 'commission_floor_pct';
--   -- then re-run the refresh_part_sourcing block from 0095 (NOT 0028, or you
--   -- lose the supplier ranking), and
--   do $$ declare r record; begin
--     for r in select id from public.parts loop
--       perform public.refresh_part_sourcing(r.id);
--     end loop;
--   end $$;
-- ============================================================================

-- ── 1. The second floor ──────────────────────────────────────────────────────
insert into public.store_settings (key, value)
values ('commission_floor_pct', '8'::jsonb)
on conflict (key) do nothing;

-- ── 2. The rule, with the right floor per pricing mode ───────────────────────
create or replace function public.refresh_part_sourcing(p_part_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part        parts%rowtype;
  v_offer       supplier_offers%rowtype;
  v_supplier    suppliers%rowtype;
  v_offer_id    uuid;
  v_fx          numeric;
  v_margin      numeric;
  v_commission  numeric;
  v_floor       numeric;
  v_landed      numeric;
  v_price       numeric;
  v_income      numeric;
  v_pct         numeric;
  v_class       text;
begin
  select * into v_part from parts where id = p_part_id;
  if not found then return; end if;

  -- A pinned offer that still exists and is active wins.
  select o.id into v_offer_id from supplier_offers o
  where o.id = v_part.pinned_offer_id and o.part_id = p_part_id and o.active;

  if v_offer_id is null then
    select o.id into v_offer_id
    from supplier_offers o
    join suppliers s on s.id = o.supplier_id
    where o.part_id = p_part_id and o.active and s.active
      -- a mirror product can only follow an offer that has a retail price and a commission
      and (v_part.pricing_mode <> 'mirror' or (o.retail_price is not null and s.commission_percent is not null))
    order by (o.availability = 'in_stock') desc,
             coalesce(s.rank, 50) asc,
             o.lead_time_days asc nulls last,
             public.offer_landed_cost_qar(o.id) asc nulls last,
             o.created_at asc
    limit 1;
  end if;

  -- Two floors, because "income" means two different things. A markup part is
  -- measured against the margin we insist on; a mirror part only ever earns
  -- the supplier's commission, so it is measured against the lowest
  -- commission we accept. Comparing a commission to a margin floor flags
  -- every mirror part forever (see WHY above).
  select coalesce((value #>> '{}')::numeric, 15) into v_margin
    from store_settings where key = 'margin_floor_pct';
  select coalesce((value #>> '{}')::numeric, 8) into v_commission
    from store_settings where key = 'commission_floor_pct';
  v_floor := case
    when v_part.pricing_mode = 'mirror' then coalesce(v_commission, 8)
    else coalesce(v_margin, 15)
  end;

  if v_offer_id is null then
    update parts set preferred_offer_id = null, landed_cost_qar = null, expected_income_qar = null,
      income_pct = null, below_floor = false, lead_time_class = null
    where id = p_part_id;
    return;
  end if;

  select * into v_offer from supplier_offers where id = v_offer_id;
  select * into v_supplier from suppliers where id = v_offer.supplier_id;
  v_landed := public.offer_landed_cost_qar(v_offer_id);
  v_price  := v_part.unit_price;

  if v_part.pricing_mode = 'mirror' and v_offer.retail_price is not null then
    select coalesce((value ->> v_offer.currency)::numeric, case when v_offer.currency = 'QAR' then 1 end)
      into v_fx from store_settings where key = 'fx_to_qar';
    if v_fx is not null then
      v_price := round(v_offer.retail_price * v_fx * v_part.pack_size::numeric / v_offer.pack_size, 2);
    end if;
    v_income := round(v_price * coalesce(v_supplier.commission_percent, 0) / 100, 2);
  else
    v_income := case when v_landed is null then null else round(v_price - v_landed, 2) end;
  end if;

  v_pct := case when v_income is null or v_price = 0 then null else round(v_income / v_price * 100, 2) end;

  v_class := case
    when v_offer.lead_time_days is null then '2_4_weeks'
    when v_offer.lead_time_days <= 2 then 'in_stock'
    when v_offer.lead_time_days <= 5 then '3_5_days'
    when v_offer.lead_time_days <= 14 then '1_2_weeks'
    else '2_4_weeks'
  end;

  update parts set
    preferred_offer_id  = v_offer_id,
    unit_price          = v_price,
    landed_cost_qar     = v_landed,
    expected_income_qar = v_income,
    income_pct          = v_pct,
    below_floor         = coalesce(v_pct < v_floor, false),
    lead_time_class     = v_class
  where id = p_part_id;
end;
$$;

revoke all on function public.refresh_part_sourcing(uuid) from public, anon;
grant execute on function public.refresh_part_sourcing(uuid) to authenticated;

-- ── 3. Re-derive every part so the flag settles now ──────────────────────────
-- Called in a DO block rather than through refresh_all_part_sourcing(), whose
-- super-admin guard does not hold when a migration runs as the table owner.
do $$
declare r record;
begin
  for r in select id from public.parts loop
    perform public.refresh_part_sourcing(r.id);
  end loop;
end $$;
