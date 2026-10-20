-- ============================================================================
-- Gestaltung — 0096: remember which request each analysis answered
-- ============================================================================
-- A client pressed "Analyse" twenty-four times in nine minutes on an unchanged
-- five-word brief (project 9196d9cc, 18 Oct 2026). Every press reached the
-- provider, so every press cost money for an answer we already held.
--
-- analysis_runs kept the answer but not the question, so nothing could tell a
-- repeat from a real re-analysis. request_hash is the fingerprint of what the
-- model was asked (normalised brief + the client's settled answers + locale,
-- lib/prototyping/analysis-request.ts). /api/analyse looks for the newest
-- successful run with the same fingerprint and reuses its parsed answer
-- instead of calling the provider.
--
-- A fingerprint, not a cooldown: a cooldown would refuse the client who fixed
-- their brief and asked again — the one re-run worth paying for — and would
-- still pay for the identical run once its window passed.
--
-- Old rows keep request_hash null and are simply never reused.
--
-- Run after 0095. Safe to re-run.
-- ============================================================================

alter table public.analysis_runs
  add column if not exists request_hash text;

comment on column public.analysis_runs.request_hash is
  'Fingerprint of the request this run answered (lib/prototyping/analysis-request.ts). Null on rows written before 0096.';

-- The lookup is always "this project, this feature, this fingerprint, newest
-- successful first", so the index carries created_at as well.
create index if not exists analysis_runs_request_idx
  on public.analysis_runs (project_id, feature, request_hash, created_at desc)
  where request_hash is not null;
