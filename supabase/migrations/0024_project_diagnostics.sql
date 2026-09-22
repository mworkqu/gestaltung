-- ============================================================================
-- Gestaltung — 0024: project diagnostics — raw analysis runs + event log
-- ============================================================================
-- 1. analysis_runs — every provider answer for a project, RAW (exactly the
--    text the provider sent) beside PARSED (what survived our validation).
--    When output is wrong, the pair shows whether the model or our parsing
--    caused it. Written by /api/analyse and /api/netlist through the caller's
--    session (owns_project), one row per attempt.
--
-- 2. project_events — the event log: every state change, when, and by whom
--    (auth.uid(); null when made from the SQL editor or a service job).
--    Filled by TRIGGERS on projects, project_parts and analysis_runs, so no
--    screen can change a project without leaving a record. Nothing inserts
--    into it directly.
--      projects      created, renamed, brief edited, answer given, understanding
--                    (un)confirmed, branches changed, BOM updated / product
--                    chosen, circuit generated, route (un)accepted
--      project_parts added, edited (field by field), status changed, removed
--      analysis_runs an analysis or circuit run, with its outcome
--
-- Both are read by the project owner and super_admin (owns_project). The
-- owner-only diagnostic export (/api/admin/projects/<id>/export) reads them.
--
-- Run after 0023. Safe to re-run.
-- ============================================================================

create table if not exists public.analysis_runs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null default auth.uid(),
  feature         text not null check (feature in ('analyse', 'netlist')),
  provider        text not null,
  model           text,
  attempt         integer not null default 1,
  -- The provider's reply exactly as received (text), and as JSON when it parsed.
  raw_text        text,
  raw_response    jsonb,
  -- What our validation produced from it; null when validation rejected it.
  parsed_response jsonb,
  -- ok | fallback (basic reader used) | invalid (rejected by validation) | error
  outcome         text not null check (outcome in ('ok', 'fallback', 'invalid', 'error')),
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists analysis_runs_project_idx on public.analysis_runs (project_id, created_at);

alter table public.analysis_runs enable row level security;
grant select, insert on public.analysis_runs to authenticated;

drop policy if exists analysis_runs_select on public.analysis_runs;
create policy analysis_runs_select on public.analysis_runs
  for select to authenticated using (public.owns_project(project_id));

drop policy if exists analysis_runs_insert on public.analysis_runs;
create policy analysis_runs_insert on public.analysis_runs
  for insert to authenticated
  with check (public.owns_project(project_id) and (user_id is null or user_id = auth.uid()));

create table if not exists public.project_events (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  actor      uuid,
  type       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_events_project_idx on public.project_events (project_id, created_at);

alter table public.project_events enable row level security;
grant select on public.project_events to authenticated;

drop policy if exists project_events_select on public.project_events;
create policy project_events_select on public.project_events
  for select to authenticated using (public.owns_project(project_id));

-- ── Triggers ─────────────────────────────────────────────────────────────────

create or replace function public.log_project_event(p_project uuid, p_type text, p_detail jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.project_events (project_id, actor, type, detail)
  values (p_project, auth.uid(), p_type, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.log_project_event(uuid, text, jsonb) from public;

create or replace function public.projects_event_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r      jsonb;
  prev   jsonb;
  l      jsonb;
  pl     jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_project_event(new.id, 'project_created', jsonb_build_object('name', new.name));
    return new;
  end if;

  if new.name is distinct from old.name then
    perform public.log_project_event(new.id, 'project_renamed', jsonb_build_object('from', old.name, 'to', new.name));
  end if;

  if new.brief is distinct from old.brief then
    perform public.log_project_event(new.id, 'brief_edited', jsonb_build_object(
      'charsBefore', coalesce(char_length(old.brief), 0),
      'charsAfter',  coalesce(char_length(new.brief), 0)));
  end if;

  if new.disciplines is distinct from old.disciplines then
    perform public.log_project_event(new.id, 'disciplines_changed', jsonb_build_object(
      'from', old.disciplines, 'to', new.disciplines));
  end if;

  if new.stages -> 'manufacturing' is distinct from old.stages -> 'manufacturing' then
    perform public.log_project_event(new.id,
      case when new.stages ->> 'manufacturing' = 'complete' then 'route_accepted' else 'route_unaccepted' end,
      '{}'::jsonb);
  end if;

  if new.spec is distinct from old.spec then
    -- Confirmation of "What we understood".
    if coalesce((new.spec ->> 'confirmed')::boolean, false) is distinct from coalesce((old.spec ->> 'confirmed')::boolean, false) then
      perform public.log_project_event(new.id,
        case when coalesce((new.spec ->> 'confirmed')::boolean, false) then 'understanding_confirmed' else 'understanding_unconfirmed' end,
        '{}'::jsonb);
    end if;
    -- Every answer or edit the client made: a row that is edited now and was
    -- not, or whose value changed.
    for r in select * from jsonb_array_elements(coalesce(new.spec -> 'rows', '[]'::jsonb)) loop
      if coalesce((r ->> 'edited')::boolean, false) then
        prev := null;  -- SELECT INTO leaves the old value when nothing matches
        select x into prev from jsonb_array_elements(coalesce(old.spec -> 'rows', '[]'::jsonb)) x
         where x ->> 'id' = r ->> 'id' limit 1;
        if prev is null or not coalesce((prev ->> 'edited')::boolean, false)
           or (prev -> 'value') is distinct from (r -> 'value') then
          perform public.log_project_event(new.id, 'answer_given', jsonb_build_object(
            'id', r ->> 'id', 'label', r ->> 'label', 'value', r -> 'value', 'previous', prev -> 'value'));
        end if;
      end if;
    end loop;
  end if;

  if new.bom is distinct from old.bom then
    if (new.bom ->> 'analysedAt') is distinct from (old.bom ->> 'analysedAt') then
      perform public.log_project_event(new.id, 'bom_updated', jsonb_build_object(
        'lines', jsonb_array_length(coalesce(new.bom -> 'lines', '[]'::jsonb))));
    else
      for l in select * from jsonb_array_elements(coalesce(new.bom -> 'lines', '[]'::jsonb)) loop
        pl := null;
        select x into pl from jsonb_array_elements(coalesce(old.bom -> 'lines', '[]'::jsonb)) x
         where x ->> 'id' = l ->> 'id' limit 1;
        if (l -> 'choice') is distinct from (pl -> 'choice') then
          perform public.log_project_event(new.id, 'bom_product_chosen', jsonb_build_object(
            'line', l ->> 'id', 'function', l ->> 'function', 'productId', l -> 'choice', 'previous', pl -> 'choice'));
        end if;
      end loop;
    end if;
  end if;

  if (new.netlist ->> 'generatedAt') is distinct from (old.netlist ->> 'generatedAt') and new.netlist is not null then
    perform public.log_project_event(new.id, 'circuit_generated', jsonb_build_object(
      'components', jsonb_array_length(coalesce(new.netlist -> 'components', '[]'::jsonb)),
      'nets', jsonb_array_length(coalesce(new.netlist -> 'nets', '[]'::jsonb))));
  end if;
  return new;
end $$;

drop trigger if exists projects_events on public.projects;
create trigger projects_events
  after insert or update on public.projects
  for each row execute function public.projects_event_trigger();

create or replace function public.project_parts_event_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  changes jsonb := '{}'::jsonb;
  k text;
  o jsonb;
  n jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_project_event(new.project_id, 'part_added', jsonb_build_object(
      'partId', new.id, 'code', new.code, 'name', new.name, 'source', new.source, 'kind', new.kind, 'status', new.status));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_project_event(old.project_id, 'part_removed', jsonb_build_object(
      'partId', old.id, 'code', old.code, 'name', old.name));
    return old;
  end if;

  if new.status is distinct from old.status then
    perform public.log_project_event(new.project_id,
      case when new.status = 'confirmed' then 'part_confirmed' else 'part_status_changed' end,
      jsonb_build_object('partId', new.id, 'code', new.code, 'from', old.status, 'to', new.status));
  end if;

  o := to_jsonb(old);
  n := to_jsonb(new);
  foreach k in array array['name', 'description', 'quantity', 'material', 'process', 'shape',
    'length_mm', 'width_mm', 'height_mm', 'diameter_mm', 'thickness_mm', 'kind', 'source'] loop
    if (o -> k) is distinct from (n -> k) then
      changes := changes || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    end if;
  end loop;
  if changes <> '{}'::jsonb then
    perform public.log_project_event(new.project_id, 'part_edited', jsonb_build_object(
      'partId', new.id, 'code', new.code, 'changes', changes));
  end if;
  return new;
end $$;

drop trigger if exists project_parts_events on public.project_parts;
create trigger project_parts_events
  after insert or update or delete on public.project_parts
  for each row execute function public.project_parts_event_trigger();

create or replace function public.analysis_runs_event_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.log_project_event(new.project_id,
    case when new.feature = 'netlist' then 'circuit_run' else 'analysis_run' end,
    jsonb_build_object('runId', new.id, 'provider', new.provider, 'model', new.model,
      'attempt', new.attempt, 'outcome', new.outcome, 'error', new.error));
  return new;
end $$;

drop trigger if exists analysis_runs_events on public.analysis_runs;
create trigger analysis_runs_events
  after insert on public.analysis_runs
  for each row execute function public.analysis_runs_event_trigger();

do $$
begin
  raise notice '0024 applied: analysis_runs, project_events + triggers on projects, project_parts, analysis_runs';
end $$;
