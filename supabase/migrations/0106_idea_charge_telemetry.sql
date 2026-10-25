-- Gestaltung — 0106: ideation-charge telemetry, estimated vs actual (owner, 2026-10-25).
--
-- WHY: from 2026-10-25 an idea is paid for UPFRONT at its complexity tier
-- (Tier 1 free / Tier 2 7 / Tier 3 14 ideation tokens, lib/studio/tiers.ts) and
-- chat edits are free. Once the visitor approves an estimated deduction, EXACTLY
-- that amount is charged even if the model's own consumption turns out higher or
-- lower. So the agreed amount and the real consumption have to be recorded side
-- by side, or unit economics cannot be checked.
--
-- WHAT: one row per priced decision. `stage` says which half of it:
--   'quoted'   the checkpoint was SHOWN at that price and the visitor had not
--              answered yet. One row per distinct quote per project, so a quote
--              shown again does not pile up rows;
--   'charged'  the visitor approved and the tokens moved.
-- Quoted minus charged, per project and tier, is how often people decline (or walk
-- away) and at what price — the question this table exists for. The two halves are
-- separate rows on purpose: linking them would mean letting the page claim a quote
-- as paid, and the quote is written before anyone has agreed to anything.
--
-- Per row (a new idea, an approved escalation, or an approved switch to a different
-- product):
--   * estimated_tokens — what the visitor was shown and agreed to;
--   * charged_tokens   — what idea_token_charge actually took (0 for an admin,
--                        and 0 while filled_at is null: quoted, not yet charged);
--   * actual_*         — the provider tokens and USD that turn really consumed.
-- Readable by super admins only; written by the project's own owner (no service key
-- needed): idea_charge_claim() writes the quote when the checkpoint is shown and
-- again (stage 'charged') when the tokens are about to move, and
-- idea_charge_fill() records what really happened.
--
-- The claim is also the IDEMPOTENCY guard for "this message starts a different
-- product" (lib/studio/identity.ts): such a charge carries an idea_key, the key is
-- unique per project, and a second claim for the same key returns null — so an
-- approval replayed by a double click or a retried request cannot charge twice.
-- A tier escalation needs no key: raising idea_sessions.tier already makes it
-- single-shot.
--
-- This file adds NOTHING to the money path: idea_token_charge (0088) is
-- untouched, and a failed telemetry write never fails a charge (the app logs it
-- and moves on). Nothing here can grant or move tokens.
--
-- Run AFTER 0105. Safe to re-run.
--
-- Check queries (as a super admin):
--   select * from public.admin_idea_charge_summary(30);
--   select stage, kind, from_tier, to_tier, estimated_tokens, charged_tokens,
--          actual_total_tokens, actual_cost_usd, source, filled_at, created_at
--     from public.idea_charge_telemetry order by created_at desc limit 20;
--
-- Rollback:
--   drop function if exists public.admin_idea_charge_summary(integer);
--   drop function if exists public.idea_charge_fill(uuid, integer, integer, integer, numeric, text, text);
--   drop function if exists public.idea_charge_claim(uuid, text, text, text, integer, text, text);
--   drop table if exists public.idea_charge_telemetry;

-- ─── Table ──────────────────────────────────────────────────────────────────
create table if not exists public.idea_charge_telemetry (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid references public.projects (id) on delete cascade,
  user_id             uuid references auth.users (id) on delete set null,
  -- 'new_idea'    the project's first paid-for turn;
  -- 'escalation'  the same idea grew into a higher tier;
  -- 'new_product' the message replaced the product with a different one.
  kind                text not null check (kind in ('new_idea', 'escalation', 'new_product')),
  from_tier           text not null check (from_tier in ('explorer', 'maker', 'engineer')),
  to_tier             text not null check (to_tier in ('explorer', 'maker', 'engineer')),
  -- What the visitor agreed to, and what was really taken (an admin is never charged).
  estimated_tokens    integer not null check (estimated_tokens between 0 and 1000),
  charged_tokens      integer not null check (charged_tokens between 0 and 1000),
  -- What the model consumed on that turn (both attempts of a retried call together).
  actual_prompt_tokens     integer check (actual_prompt_tokens >= 0),
  actual_completion_tokens integer check (actual_completion_tokens >= 0),
  actual_total_tokens      integer check (actual_total_tokens >= 0),
  actual_cost_usd     numeric(12, 6) check (actual_cost_usd >= 0),
  model               text,
  -- 'quoted' = the checkpoint was shown at this price; 'charged' = the visitor
  -- approved and the tokens moved. A quote is never turned into a charge in place.
  stage               text not null default 'quoted' check (stage in ('quoted', 'charged')),
  -- What makes a row single-shot per project: the idea's identity hash for a
  -- 'new_product' charge, and 'q:<hash of the quote>' for a quoted row (so showing
  -- the same checkpoint again writes nothing). null = no guard needed.
  idea_key            text,
  -- Set by idea_charge_fill once the charge really happened; null = quoted only.
  filled_at           timestamptz,
  -- 'model' | 'default' | 'cache' | 'rules': where the answer came from.
  source              text,
  created_at          timestamptz not null default now()
);

create index if not exists idea_charge_telemetry_created_idx on public.idea_charge_telemetry (created_at desc);
create index if not exists idea_charge_telemetry_user_idx on public.idea_charge_telemetry (user_id, created_at desc);
-- One row per project per key: this is what makes an approval replay free and keeps
-- a repeatedly shown quote to a single row.
create unique index if not exists idea_charge_telemetry_idea_once
  on public.idea_charge_telemetry (project_id, idea_key)
  where idea_key is not null;

-- Admin-only reading; no session may write a row directly.
alter table public.idea_charge_telemetry enable row level security;
revoke all on public.idea_charge_telemetry from anon, authenticated;
grant select on public.idea_charge_telemetry to authenticated;

drop policy if exists idea_charge_telemetry_select on public.idea_charge_telemetry;
create policy idea_charge_telemetry_select on public.idea_charge_telemetry
  for select to authenticated
  using (public.is_super_admin());

-- ─── Claim a row (before anything moves) ──────────────────────────
-- p_stage 'quoted'  the checkpoint was shown at this price; the caller ignores the
--                   answer and charges nothing.
-- p_stage 'charged' (the default) the visitor approved and the tokens are about to
--                   move. Returns the row id to fill in, or NULL when p_idea_key
--                   was already used on this project - then the caller charges
--                   NOTHING and simply hands the answer over.
-- Raises 'sign_in' / 'not_found'.
create or replace function public.idea_charge_claim(
  p_project uuid,
  p_kind text,
  p_from_tier text,
  p_to_tier text,
  p_estimated integer,
  p_idea_key text default null,
  p_stage text default 'charged'
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $f$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'sign_in'; end if;
  if p_project is null or not public.owns_project(p_project) then raise exception 'not_found'; end if;

  insert into public.idea_charge_telemetry (
    project_id, user_id, kind, from_tier, to_tier, estimated_tokens, charged_tokens, idea_key, stage
  ) values (
    p_project, v_uid,
    case when p_kind in ('new_idea', 'escalation', 'new_product') then p_kind else 'new_idea' end,
    case when p_from_tier in ('explorer', 'maker', 'engineer') then p_from_tier else 'explorer' end,
    case when p_to_tier in ('explorer', 'maker', 'engineer') then p_to_tier else 'explorer' end,
    greatest(0, least(coalesce(p_estimated, 0), 1000)),
    0,
    nullif(btrim(left(coalesce(p_idea_key, ''), 64)), ''),
    case when p_stage = 'quoted' then 'quoted' else 'charged' end
  )
  on conflict (project_id, idea_key) where idea_key is not null do nothing
  returning id into v_id;
  return v_id;
end $f$;

revoke all on function public.idea_charge_claim(uuid, text, text, text, integer, text, text) from public, anon;
grant execute on function public.idea_charge_claim(uuid, text, text, text, integer, text, text) to authenticated;

-- ─── Fill in what really happened (after the tokens moved) ─────────────
-- Estimated vs actual: `p_charged` is what idea_token_charge took (the agreed
-- amount, or 0 for an admin) and the actual_* columns are what the model consumed
-- on that turn. Only the owner of the row's project may fill it, and only once.
create or replace function public.idea_charge_fill(
  p_id uuid,
  p_charged integer,
  p_prompt_tokens integer default null,
  p_completion_tokens integer default null,
  p_cost_usd numeric default null,
  p_model text default null,
  p_source text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $f$
declare
  v_in  integer := greatest(0, least(coalesce(p_prompt_tokens, 0), 10000000));
  v_out integer := greatest(0, least(coalesce(p_completion_tokens, 0), 10000000));
begin
  if auth.uid() is null then raise exception 'sign_in'; end if;
  update public.idea_charge_telemetry t
     set charged_tokens           = greatest(0, least(coalesce(p_charged, 0), 1000)),
         actual_prompt_tokens     = v_in,
         actual_completion_tokens = v_out,
         actual_total_tokens      = v_in + v_out,
         actual_cost_usd          = case when p_cost_usd is null then null else greatest(0, least(p_cost_usd, 100)) end,
         model                    = left(p_model, 80),
         source                   = left(p_source, 20),
         filled_at                = now()
   where t.id = p_id
     and t.filled_at is null
     and t.stage = 'charged'
     and public.owns_project(t.project_id);
end $f$;

revoke all on function public.idea_charge_fill(uuid, integer, integer, integer, numeric, text, text) from public, anon;
grant execute on function public.idea_charge_fill(uuid, integer, integer, integer, numeric, text, text) to authenticated;

-- ─── Admin report: quoted vs charged vs what it cost us ─────────────────
-- One row per tier in the window:
--   quoted / quoted_tokens    checkpoints shown at that tier, and the tokens asked for;
--   charges / charged_tokens  the ones that were approved, and the tokens really taken;
--   actual_cost_usd           what those approved turns cost us with the provider.
-- quoted - charges is how often the price was declined or walked away from, so the
-- two columns beside each other are the ideation funnel and its margin.
create or replace function public.admin_idea_charge_summary(p_days integer default 30)
returns table (
  to_tier text,
  quoted bigint,
  quoted_tokens bigint,
  charges bigint,
  estimated_tokens bigint,
  charged_tokens bigint,
  actual_total_tokens bigint,
  actual_cost_usd numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return query
    select t.to_tier,
           count(*) filter (where t.stage = 'quoted')::bigint,
           coalesce(sum(t.estimated_tokens) filter (where t.stage = 'quoted'), 0)::bigint,
           count(*) filter (where t.stage = 'charged')::bigint,
           coalesce(sum(t.estimated_tokens) filter (where t.stage = 'charged'), 0)::bigint,
           coalesce(sum(t.charged_tokens), 0)::bigint,
           coalesce(sum(t.actual_total_tokens), 0)::bigint,
           coalesce(sum(t.actual_cost_usd), 0)
      from public.idea_charge_telemetry t
     where t.created_at >= now() - make_interval(days => v_days)
     group by t.to_tier
     order by t.to_tier;
end $$;

revoke all on function public.admin_idea_charge_summary(integer) from public, anon;
grant execute on function public.admin_idea_charge_summary(integer) to authenticated;

do $$ begin raise notice '0106 applied: idea_charge_telemetry (admin read only), idea_charge_claim(), idea_charge_fill(), admin_idea_charge_summary()'; end $$;
