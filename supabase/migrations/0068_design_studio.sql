-- ============================================================================
-- Gestaltung — 0068: Design Studio document on a project (2026-10-10, P5-13)
-- ============================================================================
-- projects.studio         the StudioDoc (lib/studio/schema.ts): product spec,
--                         chosen parts, netlist, checks, enclosure spec, layout,
--                         printable parts, firmware. JSON only — no geometry.
-- projects.studio_version bumped on every save (optimistic concurrency: the API
--                         writes `where studio_version = <read value>`).
-- ai_usage / analysis_runs accept the new feature 'studio' (idea chat, part
-- picker, enclosure look, printable parts); the step column says which.
--
-- RLS unchanged: the existing projects policies (owner / guest session / super
-- admin) already cover every column; the Studio API routes write through them.
-- Credits unchanged: wiring and enclosure ("Draw it") reuse the existing
-- credit RPCs and cad_generations from 0042 / 0043 / 0052.
--
-- Until this runs the Studio still works in the browser but cannot save
-- (the API answers 409 run_0068 and the client keeps the doc in memory).
--
-- Run after 0067. Safe to re-run.
-- ============================================================================

alter table public.projects
  add column if not exists studio jsonb,
  add column if not exists studio_version integer not null default 0;

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('analyse', 'netlist', 'transcribe', 'electronics', 'firmware', 'cad', 'studio'));

alter table public.analysis_runs drop constraint if exists analysis_runs_feature_check;
alter table public.analysis_runs add constraint analysis_runs_feature_check
  check (feature in ('analyse', 'netlist', 'electronics', 'firmware', 'cad', 'studio'));

do $$ begin raise notice '0068 applied: projects.studio + studio_version, feature studio'; end $$;
