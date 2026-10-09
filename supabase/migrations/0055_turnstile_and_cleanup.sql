-- ============================================================================
-- Gestaltung — 0055: Turnstile switch + anonymous-user cleanup
--                    (P2-08 / P2-09, 2026-10-09)
-- ============================================================================
-- Run AFTER 0054. Safe to re-run: settings rows are inserted with
-- `on conflict (key) do nothing` (the owner's values survive), the table is
-- `create table if not exists`, the function is `create or replace`.
--
-- WHAT CHANGES
-- 1. store_settings.turnstile = {"enabled": false}. The switch for Cloudflare
--    Turnstile (lib/turnstile.ts). OFF: no widget anywhere, no server check —
--    the site behaves exactly as before this migration.
-- 2. store_settings.anonymous_cleanup = {"enabled": true, "dry_run": true,
--    "days": 30}. Read by the weekly cron /api/cron/anonymous-cleanup (Sunday
--    05:00 UTC). dry_run TRUE = count only, delete nothing (FINDINGS #7).
-- 3. public.cleanup_runs: one row per run (dry or real).
-- 4. public.cleanup_anonymous_users(p_dry_run, p_days): SECURITY DEFINER,
--    EXECUTE for service_role only.
--
-- CANDIDATE = auth.users row with is_anonymous = true, created (and last
-- signed in) more than p_days ago (minimum 7), that owns NOTHING:
--   no projects (user_id), no part_orders (profile_id), no cart_items,
--   no client_inventory_items, no credits_ledger rows (user_id), no
--   project_kits (user_id), no storage.objects (owner). inquiries has no user
--   column (0002), so it cannot hold a guest's row.
--
-- FOREIGN KEYS TO auth.users / profiles CHECKED (migrations 0001–0054; no
-- later migration alters any of them; none is NO ACTION / RESTRICT, so no FK
-- can block the delete and no FK is altered here):
--   profiles.id                       -> auth.users  ON DELETE CASCADE  (0001)
--   projects.user_id                  -> auth.users  CASCADE   (0015)  [excluded: owner]
--   cart_items.user_id                -> auth.users  CASCADE   (0016)  [excluded: owner]
--   client_inventory_items.user_id    -> auth.users  CASCADE   (0017)  [excluded: owner]
--   sourcing_gaps.user_id             -> auth.users  SET NULL  (0023)
--   ai_usage.user_id                  -> auth.users  SET NULL  (0023)
--   analysis_runs.user_id             -> auth.users  SET NULL  (0024)
--   project_kits.user_id              -> auth.users  CASCADE   (0025)  [excluded: owner]
--   demand_signals.user_id            -> auth.users  SET NULL  (0029)
--   restock_receipts.created_by       -> auth.users  SET NULL  (0037)
--   credits_ledger.user_id            -> auth.users  CASCADE   (0042)  [excluded: owner]
--   credits_ledger.created_by         -> auth.users  SET NULL  (0042)
--   cad_generations.user_id           -> auth.users  CASCADE   (0043)  (needs a project → excluded via projects)
--   notification_outbox.user_id       -> auth.users  CASCADE   (0046)  (emails to a guest: none; cascade is fine)
--   notification_prefs.user_id        -> auth.users  CASCADE   (0046)
--   order_status_history.changed_by   -> auth.users  SET NULL  (0053)
--   part_orders.profile_id            -> profiles    SET NULL  (0011)  [excluded: owner]
--   (job_events.actor / job_variations.changed_by -> profiles were dropped
--    with their tables in 0013.)
-- Not FKs, left as they are: ai_usage.anon_key text ('anon:<uuid>', for rate
-- counting), project_events.actor (goes with its project). storage.objects
-- has no FK in current Supabase, hence the explicit owner check.
--
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   select count(*) as anonymous_users,
--          count(*) filter (where created_at < now() - interval '30 days') as older_than_30_days
--     from auth.users where is_anonymous = true;
--   select key, value from public.store_settings where key in ('turnstile', 'anonymous_cleanup');
--
-- AFTER (checks; the first call is a dry run and deletes nothing):
--   select public.cleanup_anonymous_users(true, 30);   -- {"dry_run":true,"candidates":N,"sample":[…]}
--   select * from public.cleanup_runs order by ran_at desc limit 5;
--   -- must FAIL for the browser roles:
--   --   set role authenticated; select public.cleanup_anonymous_users(true, 30);  -- permission denied
--
-- ROLLBACK (manual):
--   drop function if exists public.cleanup_anonymous_users(boolean, integer);
--   drop table if exists public.cleanup_runs;
--   delete from public.store_settings where key in ('turnstile', 'anonymous_cleanup');
--   (With the turnstile row gone the code reads the switch as OFF.)
--
-- OPERATIONS (Turnstile): the Supabase dashboard switch Authentication →
-- Attack Protection → CAPTCHA must be turned on ONLY after the code is
-- deployed, both keys are set in Vercel and store_settings.turnstile.enabled
-- is true — otherwise every auth call fails (FINDINGS #8, 2026-09-18).
-- ============================================================================

-- ── 1. Settings ─────────────────────────────────────────────────────────────
insert into public.store_settings (key, value)
values ('turnstile', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

insert into public.store_settings (key, value)
values ('anonymous_cleanup', '{"enabled": true, "dry_run": true, "days": 30}'::jsonb)
on conflict (key) do nothing;

-- ── 2. Run log ──────────────────────────────────────────────────────────────
create table if not exists public.cleanup_runs (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  dry_run     boolean not null,
  days        integer not null,
  candidates  integer not null default 0,
  deleted     integer not null default 0
);

alter table public.cleanup_runs enable row level security;
revoke all on public.cleanup_runs from anon, authenticated;
grant select on public.cleanup_runs to authenticated;

drop policy if exists cleanup_runs_select on public.cleanup_runs;
create policy cleanup_runs_select on public.cleanup_runs
  for select to authenticated using (public.is_super_admin());

-- ── 3. The cleanup ──────────────────────────────────────────────────────────
create or replace function public.cleanup_anonymous_users(p_dry_run boolean default true, p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_dry     boolean := coalesce(p_dry_run, true);
  v_days    integer := greatest(coalesce(p_days, 30), 7);
  v_cutoff  timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 7));
  v_ids     uuid[];
  v_count   integer;
  v_deleted integer := 0;
  -- Bounded per run so one call never holds a long transaction.
  c_max     constant integer := 5000;
begin
  select coalesce(array_agg(c.id order by c.created_at), '{}'::uuid[])
    into v_ids
    from (
      select u.id, u.created_at
        from auth.users u
       where u.is_anonymous = true
         and u.created_at < v_cutoff
         and coalesce(u.last_sign_in_at, u.created_at) < v_cutoff
         and not exists (select 1 from public.projects p where p.user_id = u.id)
         and not exists (select 1 from public.part_orders o where o.profile_id = u.id)
         and not exists (select 1 from public.cart_items ci where ci.user_id = u.id)
         and not exists (select 1 from public.client_inventory_items ii where ii.user_id = u.id)
         and not exists (select 1 from public.credits_ledger cl where cl.user_id = u.id)
         and not exists (select 1 from public.project_kits pk where pk.user_id = u.id)
         and not exists (select 1 from storage.objects so where so.owner = u.id)
       order by u.created_at
       limit c_max
    ) c;

  v_count := coalesce(array_length(v_ids, 1), 0);

  if not v_dry and v_count > 0 then
    -- The ownership test is repeated inside the delete, so a guest who
    -- started something between the two statements is kept.
    with gone as (
      delete from auth.users u
       where u.id = any (v_ids)
         and u.is_anonymous = true
         and not exists (select 1 from public.projects p where p.user_id = u.id)
         and not exists (select 1 from public.part_orders o where o.profile_id = u.id)
         and not exists (select 1 from public.cart_items ci where ci.user_id = u.id)
         and not exists (select 1 from public.client_inventory_items ii where ii.user_id = u.id)
         and not exists (select 1 from public.credits_ledger cl where cl.user_id = u.id)
         and not exists (select 1 from public.project_kits pk where pk.user_id = u.id)
         and not exists (select 1 from storage.objects so where so.owner = u.id)
      returning 1
    )
    select count(*) into v_deleted from gone;
  end if;

  insert into public.cleanup_runs (dry_run, days, candidates, deleted)
  values (v_dry, v_days, v_count, v_deleted);

  return jsonb_build_object(
    'dry_run', v_dry,
    'days', v_days,
    'candidates', v_count,
    'deleted', v_deleted,
    'sample', to_jsonb(v_ids[1:20])
  );
end;
$$;

revoke all on function public.cleanup_anonymous_users(boolean, integer) from public, anon, authenticated;
grant execute on function public.cleanup_anonymous_users(boolean, integer) to service_role;

do $$ begin raise notice '0055 applied: store_settings.turnstile (off), store_settings.anonymous_cleanup (dry run), cleanup_runs, cleanup_anonymous_users (service_role only)'; end $$;
