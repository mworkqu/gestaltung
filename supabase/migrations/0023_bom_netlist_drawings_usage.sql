-- ============================================================================
-- Gestaltung — 0023: bill of materials, netlist, part dimensions, AI metering
-- ============================================================================
-- 1. projects.bom — the analysis's bill of materials: functions and specs to
--    buy, never products. Shape (lib/prototyping/bom.ts):
--      { lines:[{id,function,spec,quantity,kind,critical,choice?}], analysedAt }
--    `choice` is the client's pick among matched store products; it survives
--    re-analysis. Products, prices and stock are never stored here — they are
--    read live from public.parts every time.
--
-- 2. projects.netlist — the electronics netlist (lib/prototyping/netlist.ts),
--    validated before it is saved. Both diagrams are drawn from it.
--
-- 3. project_parts dimensions — a shape and millimetre dimensions, so a
--    mechanical drawing is drawn from real numbers or shows a gap.
--
-- 4. parts.tags — free keywords on a store product ("servo", "5v", "m3"),
--    used by the deterministic BOM matcher. Filled from the Google Sheet.
--
-- 5. sourcing_gaps — every BOM line the store could not supply: the restocking
--    list, written by demand. Upserted through log_sourcing_gap() so a line is
--    one row per project however often it is matched. super_admin reads.
--
-- 6. ai_usage — one row per AI provider call. Written through log_ai_usage()
--    (SECURITY DEFINER, stamps auth.uid()); read by super_admin. The daily
--    guard reads totals through ai_usage_totals(), which returns counts only.
--
-- Run after 0022. Safe to re-run.
-- ============================================================================

alter table public.projects
  add column if not exists bom     jsonb,
  add column if not exists netlist jsonb;

alter table public.project_parts
  add column if not exists shape        text,
  add column if not exists length_mm    numeric(10, 2),
  add column if not exists width_mm     numeric(10, 2),
  add column if not exists height_mm    numeric(10, 2),
  add column if not exists diameter_mm  numeric(10, 2),
  add column if not exists thickness_mm numeric(10, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_parts_shape_check') then
    alter table public.project_parts
      add constraint project_parts_shape_check
      check (shape is null or shape in ('block', 'disc', 'shaft', 'sheet'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_parts_dims_positive') then
    alter table public.project_parts
      add constraint project_parts_dims_positive check (
        coalesce(length_mm, 1) > 0 and coalesce(width_mm, 1) > 0 and coalesce(height_mm, 1) > 0
        and coalesce(diameter_mm, 1) > 0 and coalesce(thickness_mm, 1) > 0
      );
  end if;
end $$;

alter table public.parts
  add column if not exists tags text[] not null default '{}';

-- ── Sourcing gaps ────────────────────────────────────────────────────────────
create table if not exists public.sourcing_gaps (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  function     text not null check (char_length(function) between 1 and 120),
  -- Lower-cased, space-collapsed function: what the admin view groups by.
  function_key text not null,
  spec         text,
  kind         text,
  quantity     integer,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  unique (project_id, function_key)
);

create index if not exists sourcing_gaps_key_idx on public.sourcing_gaps (function_key);

alter table public.sourcing_gaps enable row level security;
grant select on public.sourcing_gaps to authenticated;

drop policy if exists sourcing_gaps_select on public.sourcing_gaps;
create policy sourcing_gaps_select on public.sourcing_gaps
  for select to authenticated
  using (public.is_super_admin());

create or replace function public.log_sourcing_gap(
  p_project uuid, p_function text, p_spec text, p_kind text, p_quantity integer
) returns void
language plpgsql security definer set search_path = ''
as $$
declare k text := lower(regexp_replace(trim(p_function), '\s+', ' ', 'g'));
begin
  if not public.owns_project(p_project) then return; end if;
  if k = '' then return; end if;
  insert into public.sourcing_gaps (project_id, user_id, function, function_key, spec, kind, quantity)
  values (p_project, auth.uid(), left(trim(p_function), 120), left(k, 120), left(p_spec, 300), p_kind, p_quantity)
  on conflict (project_id, function_key) do update
    set last_seen = now(), spec = excluded.spec, kind = excluded.kind, quantity = excluded.quantity;
end $$;

revoke all on function public.log_sourcing_gap(uuid, text, text, text, integer) from public;
grant execute on function public.log_sourcing_gap(uuid, text, text, text, integer) to authenticated;

-- ── AI usage ─────────────────────────────────────────────────────────────────
create table if not exists public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  provider           text not null,
  model              text,
  project_id         uuid references public.projects (id) on delete set null,
  user_id            uuid references auth.users (id) on delete set null,
  feature            text not null check (feature in ('analyse', 'netlist', 'transcribe')),
  prompt_tokens      integer,
  completion_tokens  integer,
  total_tokens       integer,
  audio_seconds      numeric(10, 2),
  latency_ms         integer,
  -- ok: answered. error: the provider was called and failed.
  -- blocked: not called — the daily guard stopped it.
  outcome            text not null check (outcome in ('ok', 'error', 'blocked')),
  error_code         text,
  -- Straight from the provider's response headers when it sends them.
  remaining_requests integer,
  remaining_tokens   integer
);

create index if not exists ai_usage_provider_time_idx on public.ai_usage (provider, created_at);
create index if not exists ai_usage_project_idx on public.ai_usage (project_id);

alter table public.ai_usage enable row level security;
grant select on public.ai_usage to authenticated;

drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage
  for select to authenticated
  using (public.is_super_admin());

create or replace function public.log_ai_usage(
  p_provider text, p_model text, p_project uuid, p_feature text,
  p_prompt_tokens integer, p_completion_tokens integer, p_total_tokens integer,
  p_audio_seconds numeric, p_latency_ms integer, p_outcome text, p_error_code text,
  p_remaining_requests integer, p_remaining_tokens integer
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.ai_usage (
    provider, model, project_id, user_id, feature, prompt_tokens, completion_tokens,
    total_tokens, audio_seconds, latency_ms, outcome, error_code, remaining_requests, remaining_tokens
  ) values (
    left(p_provider, 40), left(p_model, 80),
    -- Only attribute usage to a project the caller owns.
    case when p_project is not null and public.owns_project(p_project) then p_project end,
    auth.uid(), p_feature, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_audio_seconds, p_latency_ms, p_outcome, left(p_error_code, 60),
    p_remaining_requests, p_remaining_tokens
  );
end $$;

revoke all on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer) from public;
grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer) to authenticated;

-- Totals since a moment, for the daily guard. Counts calls that reached the
-- provider (ok + error); blocked calls cost nothing.
create or replace function public.ai_usage_totals(p_provider text, p_since timestamptz)
returns table (requests bigint, tokens bigint, audio_seconds numeric)
language sql security definer set search_path = '' stable
as $$
  select count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(u.audio_seconds), 0)
    from public.ai_usage u
   where u.provider = p_provider and u.created_at >= p_since and u.outcome in ('ok', 'error');
$$;

revoke all on function public.ai_usage_totals(text, timestamptz) from public;
grant execute on function public.ai_usage_totals(text, timestamptz) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'projects' and column_name = 'bom')
  then raise exception '0023 incomplete: projects.bom missing'; end if;
  raise notice '0023 applied: bom, netlist, part dimensions, parts.tags, sourcing_gaps, ai_usage';
end $$;
