-- Gestaltung — 0111: the Mac Mini worker switch (consolidation 2026-11, Phase 3A).
--
-- WHY: the scheduled jobs can run on the owner's Mac Mini worker
-- (services/worker, docs/WORKER.md) instead of in Vercel functions. One row
-- decides where: store_settings.worker = {"enabled": true|false}.
--   false (this seed) or NO ROW: every /api/cron/* route runs in Vercel exactly
--     as before, and the worker's own schedules skip their runs.
--   true: each Vercel cron route forwards to the worker when it is healthy
--     (falls back to the Vercel path when it is not), and the worker runs the
--     jobs on its own schedule. Vercel also needs WORKER_URL + WORKER_SECRET.
--
-- WHAT: inserts the row {"enabled": false} only when it is missing. Nothing
-- else: no table, column, policy or function changes; an existing row (for
-- example one the owner already switched on) is never overwritten.
--
-- BEFORE IT RUNS: a missing row already means "disabled", so the app behaves
-- the same with or without it. Run it any time after 0110 (order does not
-- matter for this one). Safe to re-run.
--
-- Switch on / off later (SQL editor):
--   update public.store_settings set value = '{"enabled": true}'::jsonb, updated_at = now() where key = 'worker';
--   update public.store_settings set value = '{"enabled": false}'::jsonb, updated_at = now() where key = 'worker';
--
-- Check query (expect one row):
--   select key, value from public.store_settings where key = 'worker';
--
-- Rollback (back to "no row" = disabled):
--   delete from public.store_settings where key = 'worker';

insert into public.store_settings (key, value)
values ('worker', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;
