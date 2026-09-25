-- ============================================================================
-- Gestaltung — 0031: is_test flag (SITE_AUDIT #7)
-- ============================================================================
-- ROLLBACK (manual, only if this must be undone — nothing here deletes data):
--   begin;
--   drop trigger if exists projects_is_test_to_usage on public.projects;
--   drop function if exists public.propagate_project_is_test();
--   -- then re-run the function bodies from 0023 (log_sourcing_gap,
--   -- log_ai_usage, ai_usage_totals) and 0029 (record_demand,
--   -- record_bom_demand) to restore the previous versions;
--   alter table public.ai_usage     drop column if exists is_test;
--   alter table public.parts        drop column if exists is_test;
--   alter table public.part_orders  drop column if exists is_test;
--   alter table public.inquiries    drop column if exists is_test;
--   alter table public.projects     drop column if exists is_test;
--   commit;
--
-- Test records were live in production and fed Sourcing gaps, demand signals,
-- AI usage and the admin project list. This marks them instead of guessing:
--
-- 1. is_test boolean not null default false on projects, inquiries,
--    part_orders and parts. Nothing is flagged here; the owner flags rows by
--    id through supabase/scripts/test_data_delete.sql.
--
-- 2. Derived, not stored:
--      sourcing_gaps  — always has a project (cascade delete), so a gap is a
--                       test gap when its project is.
--      demand_signals — test when its part or project is. zero_search rows
--                       carry neither and are always real.
--
-- 3. Stored on ai_usage (tagged at write time) because project_id there is
--    `on delete set null`: once a test project is deleted its usage rows
--    would otherwise look real. A trigger keeps the tag in step when a
--    project's flag changes later.
--
-- 4. Write paths:
--      log_sourcing_gap  — skips test projects.
--      record_demand     — skips test parts (view / add_to_cart / request).
--      record_bom_demand — skips test projects.
--      log_ai_usage      — still logs (the provider call happened) but tags
--                          the row is_test when its project is.
--      ai_usage_totals   — the daily guard no longer counts is_test rows.
--
-- Bodies are 0023 / 0029 unchanged apart from the is_test checks.
--
-- Run after 0029 (it does not depend on 0030). Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Columns ───────────────────────────────────────────────────────────────
alter table public.projects    add column if not exists is_test boolean not null default false;
alter table public.inquiries   add column if not exists is_test boolean not null default false;
alter table public.part_orders add column if not exists is_test boolean not null default false;
alter table public.parts       add column if not exists is_test boolean not null default false;
alter table public.ai_usage    add column if not exists is_test boolean not null default false;

-- Test rows are few; partial indexes keep "is_test = false" lists cheap.
create index if not exists projects_is_test_idx    on public.projects (id)    where is_test;
create index if not exists inquiries_is_test_idx   on public.inquiries (id)   where is_test;
create index if not exists part_orders_is_test_idx on public.part_orders (id) where is_test;
create index if not exists parts_is_test_idx       on public.parts (id)       where is_test;
create index if not exists ai_usage_is_test_idx    on public.ai_usage (created_at) where is_test;

-- ── 2. Keep ai_usage in step with its project ────────────────────────────────
create or replace function public.propagate_project_is_test()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.ai_usage set is_test = new.is_test
   where project_id = new.id and is_test is distinct from new.is_test;
  return new;
end $$;

revoke all on function public.propagate_project_is_test() from public;

drop trigger if exists projects_is_test_to_usage on public.projects;
create trigger projects_is_test_to_usage
  after update of is_test on public.projects
  for each row when (old.is_test is distinct from new.is_test)
  execute function public.propagate_project_is_test();

-- ── 3. Sourcing gaps: skip test projects ─────────────────────────────────────
create or replace function public.log_sourcing_gap(
  p_project uuid, p_function text, p_spec text, p_kind text, p_quantity integer
) returns void
language plpgsql security definer set search_path = ''
as $$
declare k text := lower(regexp_replace(trim(p_function), '\s+', ' ', 'g'));
begin
  if not public.owns_project(p_project) then return; end if;
  if exists (select 1 from public.projects where id = p_project and is_test) then return; end if;
  if k = '' then return; end if;
  insert into public.sourcing_gaps (project_id, user_id, function, function_key, spec, kind, quantity)
  values (p_project, auth.uid(), left(trim(p_function), 120), left(k, 120), left(p_spec, 300), p_kind, p_quantity)
  on conflict (project_id, function_key) do update
    set last_seen = now(), spec = excluded.spec, kind = excluded.kind, quantity = excluded.quantity;
end $$;

revoke all on function public.log_sourcing_gap(uuid, text, text, text, integer) from public;
grant execute on function public.log_sourcing_gap(uuid, text, text, text, integer) to authenticated;

-- ── 4. AI usage: tag test projects; the guard ignores them ───────────────────
create or replace function public.log_ai_usage(
  p_provider text, p_model text, p_project uuid, p_feature text,
  p_prompt_tokens integer, p_completion_tokens integer, p_total_tokens integer,
  p_audio_seconds numeric, p_latency_ms integer, p_outcome text, p_error_code text,
  p_remaining_requests integer, p_remaining_tokens integer
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid := case when p_project is not null and public.owns_project(p_project) then p_project end;
begin
  insert into public.ai_usage (
    provider, model, project_id, user_id, feature, prompt_tokens, completion_tokens,
    total_tokens, audio_seconds, latency_ms, outcome, error_code, remaining_requests, remaining_tokens,
    is_test
  ) values (
    left(p_provider, 40), left(p_model, 80),
    -- Only attribute usage to a project the caller owns.
    v_project,
    auth.uid(), p_feature, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_audio_seconds, p_latency_ms, p_outcome, left(p_error_code, 60),
    p_remaining_requests, p_remaining_tokens,
    coalesce((select p.is_test from public.projects p where p.id = v_project), false)
  );
end $$;

revoke all on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer) from public;
grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer) to authenticated;

create or replace function public.ai_usage_totals(p_provider text, p_since timestamptz)
returns table (requests bigint, tokens bigint, audio_seconds numeric)
language sql security definer set search_path = '' stable
as $$
  select count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(u.audio_seconds), 0)
    from public.ai_usage u
   where u.provider = p_provider and u.created_at >= p_since and u.outcome in ('ok', 'error')
     and not u.is_test;
$$;

revoke all on function public.ai_usage_totals(text, timestamptz) from public;
grant execute on function public.ai_usage_totals(text, timestamptz) to authenticated;

-- ── 5. Demand signals: skip test parts and projects ──────────────────────────
create or replace function public.record_demand(
  p_kind        text,
  p_part_id     uuid default null,
  p_source_page text default null,
  p_email       text default null,
  p_quantity    integer default null,
  p_note        text default null,
  p_search_term text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_kind not in ('view', 'add_to_cart', 'request', 'zero_search') then raise exception 'bad kind'; end if;
  if p_kind in ('view', 'add_to_cart', 'request') then
    if p_part_id is null or not exists (select 1 from public.parts where id = p_part_id) then return; end if;
    -- A test product is not demand.
    if exists (select 1 from public.parts where id = p_part_id and is_test) then return; end if;
  end if;
  if p_kind = 'request' and (p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'email required';
  end if;
  if p_kind = 'zero_search' and coalesce(btrim(p_search_term), '') = '' then return; end if;

  -- A reload is not a second view: one view per signed-in user and product per 30 minutes.
  if p_kind = 'view' and v_uid is not null and exists (
    select 1 from public.demand_signals
    where kind = 'view' and part_id = p_part_id and user_id = v_uid and created_at > now() - interval '30 minutes'
  ) then return; end if;
  if p_kind = 'zero_search' and exists (
    select 1 from public.demand_signals
    where kind = 'zero_search' and lower(search_term) = lower(btrim(p_search_term))
      and user_id is not distinct from v_uid and created_at > now() - interval '30 minutes'
  ) then return; end if;

  insert into public.demand_signals (kind, part_id, user_id, source_page, email, quantity, note, search_term)
  values (
    p_kind, p_part_id, v_uid,
    left(p_source_page, 300),
    case when p_kind = 'request' then left(lower(btrim(p_email)), 200) end,
    case when p_kind = 'request' then least(greatest(coalesce(p_quantity, 1), 1), 100000) end,
    case when p_kind = 'request' then nullif(left(btrim(coalesce(p_note, '')), 1000), '') end,
    case when p_kind = 'zero_search' then left(btrim(p_search_term), 200) end
  );
end $$;

revoke all on function public.record_demand(text, uuid, text, text, integer, text, text) from public;
grant execute on function public.record_demand(text, uuid, text, text, integer, text, text) to anon, authenticated;

create or replace function public.record_bom_demand(p_project uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare l jsonb;
begin
  if not public.owns_project(p_project) then return; end if;
  if exists (select 1 from public.projects where id = p_project and is_test) then return; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    continue when coalesce(l ->> 'id', '') = '';
    insert into public.demand_signals (kind, user_id, project_id, bom_line_id, bom_label, quantity, source_page)
    values ('bom_unmatched', auth.uid(), p_project, left(l ->> 'id', 120), left(l ->> 'label', 200),
            greatest(1, coalesce((l ->> 'quantity')::integer, 1)), 'prototyping')
    on conflict (project_id, bom_line_id) where kind = 'bom_unmatched' do update
      set bom_label = excluded.bom_label, quantity = excluded.quantity;
  end loop;
end $$;

grant execute on function public.record_bom_demand(uuid, jsonb) to authenticated;

-- ── 6. Verify ────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and column_name = 'is_test'
     and table_name in ('projects', 'inquiries', 'part_orders', 'parts', 'ai_usage');
  if n <> 5 then raise exception '0031 incomplete: is_test on % of 5 tables', n; end if;
  raise notice '0031 applied: is_test on projects, inquiries, part_orders, parts, ai_usage; gap, demand and usage writers skip or tag test rows';
end $$;

commit;
