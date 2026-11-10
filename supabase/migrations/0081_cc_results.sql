-- ============================================================================
-- 0081_cc_results.sql  -  CAD Champions: results emails + share link (Prompt 7)
-- ============================================================================
-- RUN AFTER 0080 (needs cc_attempts from 0077_cc_core.sql).
--
-- What it does
--   1. cc_attempts.results_email_sent_at  - "Your results are ready" was sent
--      (claimed before sending, so it goes out once per attempt).
--   2. cc_attempts.final_email_sent_at    - "Your final score is confirmed" was
--      sent (after a provisional attempt became graded).
--   3. cc_attempts.provisional_percent    - the percent shown in the first,
--      provisional email, so the final email can show the change.
--   4. share_enabled / share_token already exist (0077); this adds a
--      SECURITY DEFINER read cc_shared_result(token) that returns ONLY the
--      first name, the band and the six skill-area scores (the skill map) of
--      a shared attempt, for the public share page. It returns nothing when
--      sharing is off.
--
-- All writes stay server-side (service role); RLS is unchanged.
-- Safe to re-run: add column if not exists, create or replace.
--
-- Rollback (comments):
--   drop function if exists public.cc_shared_result(text);
--   alter table public.cc_attempts drop column if exists results_email_sent_at,
--     drop column if exists final_email_sent_at, drop column if exists provisional_percent;
-- ============================================================================

alter table public.cc_attempts add column if not exists results_email_sent_at timestamptz;
alter table public.cc_attempts add column if not exists final_email_sent_at  timestamptz;
alter table public.cc_attempts add column if not exists provisional_percent  numeric(5, 2);

create index if not exists cc_attempts_share_token_idx
  on public.cc_attempts (share_token) where share_enabled;

create or replace function public.cc_shared_result(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'first_name', nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 1), ''),
    'first_name_ar', nullif(split_part(trim(coalesce(p.full_name_ar, '')), ' ', 1), ''),
    'band', a.band,
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.skill_area_id, 'percent', s.percent, 'level', s.level, 'assessed', s.assessed)
             order by s.skill_area_id)
        from public.cc_skill_scores s
       where s.attempt_id = a.id), '[]'::jsonb)
  )
  from public.cc_attempts a
  join public.cc_profiles p on p.id = a.user_id
  where p_token is not null
    and length(p_token) between 20 and 80
    and a.share_token = p_token
    and a.share_enabled
    and a.status in ('provisional', 'graded')
  limit 1;
$$;

revoke all on function public.cc_shared_result(text) from public;
grant execute on function public.cc_shared_result(text) to anon, authenticated, service_role;
