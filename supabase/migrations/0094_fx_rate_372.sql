-- ============================================================================
-- Gestaltung — 0094: USD is 3.72 QAR, not 3.64 (owner, 2026-10-19)
-- ============================================================================
-- Run any time after 0028. Safe to re-run. NOT RUN YET (the owner runs it).
--
-- WHY
-- store_settings('fx_to_qar') still carries the rate 0028 seeded, 3.64 QAR per
-- USD. The owner's rate is 3.72. Every landed cost from a USD supplier
-- (DigiKey, Mouser) is therefore ~2 % low, and so is every price derived from
-- it. The other currencies move with the dollar, so they are refreshed too.
--
-- WHAT CHANGES
-- 1. store_settings('fx_to_qar') -> {"QAR": 1, "USD": 3.72, "EUR": 4.03,
--    "CNY": 0.52, "GBP": 4.7}. The same numbers live in lib/pricing/fx.ts as
--    the code's fallback.
-- 2. refresh_all_part_sourcing() runs once, so landed_cost_qar,
--    expected_income_qar, income_pct and below_floor are recomputed on every
--    part at the new rate. Prices themselves are NOT rewritten: a product on
--    'markup' keeps its stored price, and the margin columns simply tell the
--    truth again. Watch for parts that newly show below_floor.
--
-- DRY RUN (read-only) — what the change does to margins:
--   select value from public.store_settings where key = 'fx_to_qar';
--   select count(*) filter (where below_floor) as below_floor_now, count(*)
--     from public.parts where merged_into is null;
--
-- ROLLBACK (manual):
--   update public.store_settings
--      set value = '{"QAR": 1, "USD": 3.64, "EUR": 3.95, "CNY": 0.51, "GBP": 4.6}'::jsonb
--    where key = 'fx_to_qar';
--   select public.refresh_all_part_sourcing();
-- ============================================================================

insert into public.store_settings (key, value)
values ('fx_to_qar', '{"QAR": 1, "USD": 3.72, "EUR": 4.03, "CNY": 0.52, "GBP": 4.7}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- Recompute every part's landed cost / income at the new rate. Looped here
-- rather than through refresh_all_part_sourcing(), whose super-admin guard
-- does not hold when a migration runs as the table owner.
do $$
declare r record;
begin
  for r in select id from public.parts loop
    perform public.refresh_part_sourcing(r.id);
  end loop;
end $$;
