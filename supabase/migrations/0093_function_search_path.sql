-- Gestaltung — 0093: pin search_path on the last three functions (owner, 2026-10-18). Run after 0092.
--
-- Supabase's Security Advisor flagged "Function Search Path Mutable" on
-- lead_class_days (0029), part_name_key and part_material_key (0030). All three
-- are pure SQL over pg_catalog built-ins, so pinning search_path to pg_catalog
-- costs nothing and stops a function of the same name in a caller's schema from
-- being picked up. Bodies are unchanged.
--
-- Rollback:
--   alter function public.lead_class_days(text) reset search_path;
--   alter function public.part_name_key(text) reset search_path;
--   alter function public.part_material_key(text) reset search_path;

alter function public.lead_class_days(text)    set search_path = pg_catalog;
alter function public.part_name_key(text)      set search_path = pg_catalog;
alter function public.part_material_key(text)  set search_path = pg_catalog;
