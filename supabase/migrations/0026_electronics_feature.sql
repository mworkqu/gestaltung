-- ============================================================================
-- Gestaltung — 0026: record the electronics builder's model calls
-- ============================================================================
-- The electronics builder (/api/bom/electronics, Part 3) is its own metered,
-- recorded feature. Until this runs, its calls still work but are not written
-- to ai_usage or analysis_runs (the feature check rejects 'electronics').
--
-- Run after 0025. Safe to re-run.
-- ============================================================================

alter table public.analysis_runs drop constraint if exists analysis_runs_feature_check;
alter table public.analysis_runs add constraint analysis_runs_feature_check
  check (feature in ('analyse', 'netlist', 'electronics'));

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('analyse', 'netlist', 'transcribe', 'electronics'));

do $$ begin raise notice '0026 applied: electronics feature recorded in ai_usage and analysis_runs'; end $$;
