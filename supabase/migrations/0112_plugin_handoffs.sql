-- ============================================================================
-- 0112 — Chat-plugin hand-offs (Claude / ChatGPT -> a Studio project)
--
-- WHY: the MCP "send_project" tool lets someone design in Claude or ChatGPT and
-- hand the result to Gestaltung. The server stores the build + a ready Studio
-- document under a one-time token (only its sha256 is kept). The person opens
-- /<locale>/handoff/<token>, signs in, and claim_plugin_handoff() turns it into
-- ONE project of theirs (and links the lead inquiry the server created).
--
-- 1. public.plugin_handoffs        service_role writes; super_admin reads/marks is_test.
-- 2. claim_plugin_handoff(token)   authenticated (anon gets 'sign_in'); idempotent per user.
-- 3. plugin_handoff_set_phone()    authenticated owner of a claimed hand-off.
-- 4. plugin_rate_hit(key, limit)   service_role only; atomic counter on ai_rate_limits (0042).
--
-- inquiries.project_id: inquiries_guard_quote (0073) keeps project_id on UPDATE
-- only when current_user is anon/authenticated. A SECURITY DEFINER function
-- runs as its owner (postgres), so current_user is not in that list and the
-- guard returns early: claim_plugin_handoff() can set inquiries.project_id.
-- Likewise projects_guard_studio_server_keys (0100) and projects_enforce_limit
-- (0096, SECURITY DEFINER, raises 'project_limit') key on current_user.
--
-- BEFORE IT RUNS: the MCP send_project tool answers "not set up yet" and the
-- hand-off page shows a not-ready error; nothing else changes.
-- RUN AFTER 0111 (needs 0042 ai_rate_limits, 0073 inquiries.project_id, 0096
-- projects_enforce_limit). Safe to re-run.
--
-- Rollback:
--   drop function if exists public.plugin_rate_hit(text, integer);
--   drop function if exists public.plugin_handoff_set_phone(text, text);
--   drop function if exists public.claim_plugin_handoff(text);
--   drop table if exists public.plugin_handoffs;
-- ============================================================================

create table if not exists public.plugin_handoffs (
  id               uuid primary key default gen_random_uuid(),
  token_hash       text not null unique check (char_length(token_hash) = 64),
  source           text not null default 'other' check (source in ('claude', 'chatgpt', 'other')),
  build            jsonb not null check (pg_column_size(build) < 200000),
  studio_doc       jsonb not null,
  parts_total_qar  numeric(12, 2) not null default 0,
  contact_name     text check (contact_name is null or char_length(contact_name) <= 60),
  contact_phone    text check (contact_phone is null or char_length(contact_phone) <= 20),
  contact_email    text check (contact_email is null or char_length(contact_email) <= 160),
  locale           text not null default 'en' check (locale in ('en', 'ar')),
  ip_hash          text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 days',
  claimed_at       timestamptz,
  claimed_by       uuid references public.profiles (id) on delete set null,
  project_id       uuid references public.projects (id) on delete set null,
  inquiry_id       uuid references public.inquiries (id) on delete set null,
  is_test          boolean not null default false
);

create index if not exists plugin_handoffs_created_idx on public.plugin_handoffs (created_at desc);
create index if not exists plugin_handoffs_inquiry_idx on public.plugin_handoffs (inquiry_id) where inquiry_id is not null;
create index if not exists plugin_handoffs_project_idx on public.plugin_handoffs (project_id) where project_id is not null;

comment on table public.plugin_handoffs is
  'Chat-plugin hand-offs (0112): a build sent from Claude/ChatGPT, claimable once via claim_plugin_handoff(). Only the sha256 of the token is stored. service_role writes; super_admin reads.';

alter table public.plugin_handoffs enable row level security;
revoke all on table public.plugin_handoffs from public, anon, authenticated;
grant all on table public.plugin_handoffs to service_role;
grant select, update on table public.plugin_handoffs to authenticated; -- RLS: super_admin only

drop policy if exists plugin_handoffs_admin_select on public.plugin_handoffs;
create policy plugin_handoffs_admin_select on public.plugin_handoffs
  for select to authenticated using (public.is_super_admin());

drop policy if exists plugin_handoffs_admin_update on public.plugin_handoffs;
create policy plugin_handoffs_admin_update on public.plugin_handoffs
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ── claim ────────────────────────────────────────────────────────────────────
create or replace function public.claim_plugin_handoff(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_hash    text;
  v_h       public.plugin_handoffs;
  v_project uuid;
  v_phone   text;
  v_needs   boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'sign_in');
  end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select * into v_h from public.plugin_handoffs where token_hash = v_hash for update;
  if not found or v_h.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  select nullif(btrim(coalesce(phone, '')), '') into v_phone from public.profiles where id = v_uid;
  v_needs := coalesce(v_h.contact_phone, '') = '' and v_phone is null;

  if v_h.claimed_by = v_uid and v_h.project_id is not null then
    return jsonb_build_object('ok', true, 'project_id', v_h.project_id, 'needs_phone', v_needs, 'already', true);
  end if;
  if v_h.claimed_by is not null and v_h.claimed_by <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  begin
    insert into public.projects (user_id, name, studio, studio_version, spec)
    values (
      v_uid,
      coalesce(nullif(left(btrim(coalesce(v_h.build ->> 'name', '')), 60), ''), 'Project from chat'),
      v_h.studio_doc,
      1,
      jsonb_build_object('aiConsent', jsonb_build_object('at', now(), 'destination', 'studio', 'source', 'plugin'))
    )
    returning id into v_project;
  exception when raise_exception then
    if sqlerrm = 'project_limit' then
      return jsonb_build_object('ok', false, 'reason', 'project_limit');
    end if;
    raise;
  end;

  update public.plugin_handoffs
     set claimed_at = now(), claimed_by = v_uid, project_id = v_project
   where id = v_h.id;

  if v_h.inquiry_id is not null then
    update public.inquiries set project_id = v_project where id = v_h.inquiry_id;
  end if;

  return jsonb_build_object('ok', true, 'project_id', v_project, 'needs_phone', v_needs, 'already', false);
end $$;

revoke all on function public.claim_plugin_handoff(text) from public;
grant execute on function public.claim_plugin_handoff(text) to anon, authenticated;

comment on function public.claim_plugin_handoff(text) is
  'Turns a plugin hand-off token into one project of the signed-in caller (idempotent per user). Returns {ok, project_id, needs_phone, already} or {ok:false, reason: sign_in|bad_token|project_limit}.';

-- ── phone ────────────────────────────────────────────────────────────────────
create or replace function public.plugin_handoff_set_phone(p_token text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_h    public.plugin_handoffs;
  v_hash text;
begin
  if v_uid is null or p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select * into v_h from public.plugin_handoffs where token_hash = v_hash and claimed_by = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;
  if p_phone is null or p_phone !~ '^\+[0-9]{8,15}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;

  update public.plugin_handoffs set contact_phone = p_phone where id = v_h.id;
  if v_h.inquiry_id is not null then
    update public.inquiries set phone = p_phone where id = v_h.inquiry_id;
  end if;
  update public.profiles set phone = p_phone where id = v_uid and coalesce(phone, '') = '';

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.plugin_handoff_set_phone(text, text) from public, anon;
grant execute on function public.plugin_handoff_set_phone(text, text) to authenticated;

comment on function public.plugin_handoff_set_phone(text, text) is
  'Saves a +E.164 phone on a hand-off the caller claimed (and its inquiry; the profile only when empty). Returns {ok:true} or {ok:false, reason: bad_token|bad_phone}.';

-- ── rate limit ───────────────────────────────────────────────────────────────
create or replace function public.plugin_rate_hit(p_key text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.ai_rate_limits (key, day, hits)
  values (left(coalesce(p_key, ''), 160), (now() at time zone 'Asia/Qatar')::date, 1)
  on conflict (key, day) do update set hits = public.ai_rate_limits.hits + 1
  returning hits into v_hits;
  return jsonb_build_object('allowed', v_hits <= p_limit, 'hits', v_hits, 'limit', p_limit);
end $$;

revoke all on function public.plugin_rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.plugin_rate_hit(text, integer) to service_role;

comment on function public.plugin_rate_hit(text, integer) is
  'Atomic counter on ai_rate_limits for the MCP / plugin endpoints (service_role only). The caller encodes the window in the key. Returns {allowed, hits, limit}.';
