-- ============================================================================
-- Gestaltung — 0021: prototyping disciplines
-- ============================================================================
-- The prototyping workspace is a tree: Brief, one branch per engineering
-- discipline the product needs (mechanical / electronics / software), Quote.
--
-- projects.disciplines holds two things, both read by lib/prototyping/tree.ts:
--   detected — what the last brief analysis found; rewritten by each analysis.
--   manual   — branches the client added or removed by hand; an analysis never
--              touches this, so a manual choice always wins.
--   e.g. {"detected": ["mechanical","electronics"], "manual": {"software": true}}
--
-- jsonb on the project, not a table: three fixed keys, always read whole,
-- never queried across projects. RLS is unchanged — projects already lets the
-- owner (owns_project, 0015) update their own row.
--
-- Run after 0020. Safe to re-run. Until it runs, the tree still shows branches
-- (it reads them from the brief) but adding/removing a branch cannot be saved.
-- ============================================================================

alter table public.projects
  add column if not exists disciplines jsonb not null default '{}'::jsonb;
