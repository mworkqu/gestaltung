-- ============================================================================
-- Gestaltung — 0067: CAD engine switch (2026-10-10)
-- ============================================================================
-- store_settings.cad_engine chooses who builds a 3D model:
--   "browser"  Gemini writes OpenSCAD, the customer's browser builds it (today)
--   "admin"    the cloud CadQuery worker (Cloud Run) for super_admin only —
--              the owner tests it on his own account first
--   "cloud"    the cloud worker for everyone
-- min_wall_mm = the thinnest wall the worker's check accepts (default 1.2).
--
-- Seeded as "browser" (no change in behaviour); `on conflict do nothing` keeps
-- an owner edit when re-run. No row = browser in the code too
-- (lib/cad/engine.ts). RLS unchanged: store_settings is anon-readable except
-- price_experiment (0060).
--
-- The cloud path reuses cad_generations and cad_begin / cad_set_code /
-- cad_deliver / cad_fail from 0043 unchanged, and stores its files in the
-- existing private cad-files bucket under <user_id>/<project_id>/cad/
-- (0018 / 0045 policies). No new table, no new function.
--
-- Switch (after GCP_CAD_URL + GCP_CAD_SA_KEY are set in Vercel):
--   update public.store_settings set value = '{"engine": "admin", "min_wall_mm": 1.2}'::jsonb where key = 'cad_engine';
-- then any Dashboard → Store save (or wait 5 min) refreshes the cached setting.
-- Back: same with "browser".
--
-- Run after 0066. Safe to re-run.
-- ============================================================================

insert into public.store_settings (key, value)
values ('cad_engine', '{"engine": "browser", "min_wall_mm": 1.2}'::jsonb)
on conflict (key) do nothing;

do $$ begin raise notice '0067 applied: store_settings.cad_engine = %',
  (select value from public.store_settings where key = 'cad_engine'); end $$;
