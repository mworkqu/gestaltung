-- ============================================================================
-- Gestaltung — 0101: AI usage is logged by the server only
--                    (security audit 2026-10, finding DB-02)
-- ============================================================================
-- Problem: log_ai_usage (13-arg 0031 form and 15-arg 0088 form) was callable
-- by any session (guests included; anon too through Supabase's default
-- privileges) and stored token counts verbatim. One
--   rpc('log_ai_usage', {p_provider:'gemini', p_total_tokens: 2000000000, …})
-- made ai_usage_totals report the provider as over its daily limit, so
-- lib/ai/usage.ts quota() paused every AI feature for every user until the
-- provider's day reset, and polluted the admin cost pages.
--
-- This migration:
--   1. Revokes EXECUTE on BOTH log_ai_usage overloads from public, anon and
--      authenticated (service_role keeps it). The bodies are unchanged.
--   2. Adds public.log_ai_usage_server(p_user, … same 15 args …):
--      SECURITY DEFINER, service_role only. Writes p_user as user_id (the app
--      passes the id it verified with auth.getUser()), refuses a null p_user
--      (every AI route requires a session — guests are anonymous *users* with
--      an id — so there is no anonymous feature to allow), attributes the
--      project only when p_user owns it (or is a super_admin, as
--      owns_project() did), and clamps every number:
--        prompt/completion/total tokens 0 … 2,000,000 per row
--        audio_seconds                  0 … 3,600 per row
--        cost_usd                       0 … 50 per row
--        latency_ms                     0 … 600,000
--      is_test is copied from the project again (0031 did this; the 0088
--      overload had dropped it), so test-project calls stay out of the quota.
--   3. Revokes ai_usage_totals from anon. authenticated keeps it: quota() runs
--      with the caller's own session (lib/ai/usage.ts) and every AI route
--      requires a session.
--
-- App side (same commit): lib/ai/usage.ts and lib/cad/cloud-flow.ts log
-- through createServiceClient().rpc('log_ai_usage_server', {p_user, …}).
-- Until this migration runs the app falls back to the old log_ai_usage (user
-- session) when log_ai_usage_server does not exist, so metering keeps working.
--
-- RUN AFTER 0099 (and 0100). Safe to re-run (create or replace, revoke/grant).
--
-- ROLLBACK (manual):
--   grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer) to authenticated;
--   grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric) to authenticated;
--   grant execute on function public.ai_usage_totals(text, timestamptz) to anon;
--   drop function if exists public.log_ai_usage_server(uuid, text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric);
--   (the app then falls back to log_ai_usage by itself)
-- ============================================================================

-- ── 1. The old client-callable logger: server only ──────────────────────────
revoke all on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric)
  from public, anon, authenticated;
grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer)
  to service_role;
grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric)
  to service_role;

-- ── 2. The server logger ────────────────────────────────────────────────────
create or replace function public.log_ai_usage_server(
  p_user uuid,
  p_provider text, p_model text, p_project uuid, p_feature text,
  p_prompt_tokens integer, p_completion_tokens integer, p_total_tokens integer,
  p_audio_seconds numeric, p_latency_ms integer, p_outcome text, p_error_code text,
  p_remaining_requests integer, p_remaining_tokens integer,
  p_step text, p_cost_usd numeric
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if p_user is null then
    raise exception 'user_required';
  end if;

  select p.id into v_project
    from public.projects p
   where p.id = p_project
     and (p.user_id = p_user
          or exists (select 1 from public.profiles pr where pr.id = p_user and pr.role = 'super_admin'));

  insert into public.ai_usage (
    provider, model, project_id, user_id, feature, prompt_tokens, completion_tokens,
    total_tokens, audio_seconds, latency_ms, outcome, error_code, remaining_requests, remaining_tokens,
    step, cost_usd, is_test
  ) values (
    left(p_provider, 40), left(p_model, 80), v_project, p_user, p_feature,
    case when p_prompt_tokens     is null then null else greatest(0, least(p_prompt_tokens, 2000000)) end,
    case when p_completion_tokens is null then null else greatest(0, least(p_completion_tokens, 2000000)) end,
    case when p_total_tokens      is null then null else greatest(0, least(p_total_tokens, 2000000)) end,
    case when p_audio_seconds     is null then null else greatest(0, least(p_audio_seconds, 3600)) end,
    case when p_latency_ms        is null then null else greatest(0, least(p_latency_ms, 600000)) end,
    p_outcome, left(p_error_code, 60),
    p_remaining_requests, p_remaining_tokens,
    left(p_step, 40),
    case when p_cost_usd is null then null else greatest(0, least(p_cost_usd, 50)) end,
    coalesce((select p.is_test from public.projects p where p.id = v_project), false)
  );
end $$;

revoke all on function public.log_ai_usage_server(uuid, text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric)
  from public, anon, authenticated;
grant execute on function public.log_ai_usage_server(uuid, text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric)
  to service_role;

-- ── 3. The quota read: sessions only ────────────────────────────────────────
revoke all on function public.ai_usage_totals(text, timestamptz) from public, anon;
grant execute on function public.ai_usage_totals(text, timestamptz) to authenticated, service_role;

do $$ begin raise notice '0101 applied: log_ai_usage server-only, log_ai_usage_server (clamped), ai_usage_totals not for anon'; end $$;
