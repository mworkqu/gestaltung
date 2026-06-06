-- ============================================================================
-- Gestaltung — Stage 7b: job variations (edit/change trail)
-- ============================================================================
-- Run AFTER 0007_internal_jobs.sql. Records a field-level before->after trail
-- whenever a job's spec is changed after creation — what manufacturing calls a
-- "variation". The existing jobs RLS + jobs_status_transition trigger already
-- permit non-status edits by the owner client, the assigned workshop, or
-- super_admin, so no jobs policy/trigger changes are needed here; this migration
-- only adds the immutable log table the server actions write to.
--
-- Who may vary a job (enforced in the server actions, allowed by existing RLS):
--   client  -> own job, only while status = 'submitted' (before a workshop quotes it)
--   workshop-> its assigned job (incl. its own internal jobs), any status except
--              'delivered' / 'cancelled'
--   super_admin -> any job except 'delivered' / 'cancelled'
-- ============================================================================

create table if not exists public.job_variations (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,
  changed_by      uuid references public.profiles (id) on delete set null,
  changed_by_role text,
  -- [{ "field": "quantity", "from": "1", "to": "5" }, ...]
  changes         jsonb not null,
  created_at      timestamptz not null default now()
);

create index if not exists job_variations_job_id_idx
  on public.job_variations (job_id, created_at);

alter table public.job_variations enable row level security;
grant select, insert on public.job_variations to authenticated;

-- Anyone who can see the job can read its variation trail.
drop policy if exists job_variations_select on public.job_variations;
create policy job_variations_select on public.job_variations
  for select to authenticated
  using (public.can_access_job(job_id));

-- Anyone who can access the job may append a variation (the action gates WHO
-- and WHEN; this just keeps inserts scoped to accessible jobs).
drop policy if exists job_variations_insert on public.job_variations;
create policy job_variations_insert on public.job_variations
  for insert to authenticated
  with check (public.can_access_job(job_id));

-- Immutable: no update/delete policies (history can't be rewritten); rows are
-- removed only when the parent job is deleted (cascade).
