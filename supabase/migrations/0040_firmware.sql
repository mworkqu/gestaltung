-- ============================================================================
-- Gestaltung — 0040: generated firmware on a project (owner, 2026-09-29)
-- ============================================================================
-- Software › Code: once a project has its board, components and circuit, the
-- site can write starter Arduino / ESP32 code for it. The latest result is
-- kept on the project (projects.firmware). Calls are metered as the new
-- 'firmware' feature.
--
-- Until this runs, the code is still generated and shown, but not saved, and
-- the calls are not recorded in ai_usage.
--
-- Run after 0039. Safe to re-run.
-- ============================================================================

alter table public.projects add column if not exists firmware jsonb;

alter table public.analysis_runs drop constraint if exists analysis_runs_feature_check;
alter table public.analysis_runs add constraint analysis_runs_feature_check
  check (feature in ('analyse', 'netlist', 'electronics', 'firmware'));

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('analyse', 'netlist', 'transcribe', 'electronics', 'firmware'));

do $$ begin raise notice '0040 applied: projects.firmware + firmware feature'; end $$;
