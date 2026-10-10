-- ============================================================================
-- Gestaltung — 0066: Qatar public holidays 2026–2027 (editable defaults)
--                    (Group 8 / P5-08, 2026-10-10)
-- ============================================================================
-- Merges National Day (18 + 19 Dec 2026, 18 Dec 2027), National Sports Day
-- (2027-02-09) and the EXPECTED Eid dates (Eid al-Fitr 2027-03-09..11, Eid
-- al-Adha 2027-05-16..18; moon-sighted, the owner confirms when announced)
-- into store_settings.holidays.dates. Existing owner dates and the weekend
-- are kept; the dates are unioned, unique and sorted. Safe to re-run.
-- Run AFTER 0054. If the holidays row does not exist it is created with the
-- default Fri/Sat weekend.
--
-- Read-only check before running:
--   select value from public.store_settings where key = 'holidays';
-- ============================================================================

insert into public.store_settings (key, value)
select 'holidays', jsonb_build_object(
  'weekend', coalesce(
    (select s.value -> 'weekend' from public.store_settings s where s.key = 'holidays'),
    '[5, 6]'::jsonb),
  'dates', (
    select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
    from (
      select distinct d from (
        select jsonb_array_elements_text(
                 coalesce((select s.value -> 'dates' from public.store_settings s where s.key = 'holidays'), '[]'::jsonb)
               ) as d
        union
        select unnest(array[
          '2026-12-18', '2026-12-19', '2027-02-09', '2027-12-18',
          '2027-03-09', '2027-03-10', '2027-03-11',
          '2027-05-16', '2027-05-17', '2027-05-18'
        ])
      ) all_dates
    ) u
  )
)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();
