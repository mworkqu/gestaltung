-- ============================================================================
-- Gestaltung — 0046: notification outbox for credit and milestone emails
--                    (2026-10-03, site review Phase I)
-- ============================================================================
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   -- what this adds (expect 0 rows before; 2 tables, 1 setting, 9 functions after)
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name in ('notification_outbox', 'notification_prefs');
--   select key, value from public.store_settings where key = 'notifications';
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('notification_enqueue', 'notify_credits_ledger', 'notify_projects',
--                        'claim_notifications', 'mark_notification', 'notification_unsubscribe',
--                        'notification_prefs_token');
--
--   -- what the triggers will start reacting to (nothing is back-filled:
--   -- only rows written AFTER this migration create emails)
--   select reason ~ '^purchase:' as order_grant, reason = 'admin_grant' as admin_grant,
--          reason ~ '^spend:' as spend, count(*)
--     from public.credits_ledger group by 1, 2, 3;
--
--   -- profiles.locale already exists (0001, text not null default 'en', no check);
--   -- values other than 'ar' are sent in English
--   select locale, count(*) from public.profiles group by 1;
--
-- ROLLBACK (manual, run as one transaction):
--   drop trigger  if exists credits_ledger_notify on public.credits_ledger;
--   drop trigger  if exists projects_notify_insert on public.projects;
--   drop trigger  if exists projects_notify_update on public.projects;
--   drop function if exists public.notify_credits_ledger();
--   drop function if exists public.notify_projects();
--   drop function if exists public.claim_notifications(integer);
--   drop function if exists public.mark_notification(uuid, text, text);
--   drop function if exists public.notification_unsubscribe(uuid, text);
--   drop function if exists public.notification_prefs_token(uuid);
--   drop function if exists public.notification_enqueue(uuid, text, jsonb);
--   drop table    if exists public.notification_outbox;
--   drop table    if exists public.notification_prefs;
--   delete from public.store_settings where key = 'notifications';
--   (Nothing else is touched: credits_ledger, projects and profiles keep their
--   columns and behaviour. Remove the /api/cron/notifications entry from
--   vercel.json too, or the cron answers 500 on every run.)
--
-- WHAT CHANGES
-- 1. notification_outbox — one row per email we intend to send. Unique index
--    on (user_id, kind, payload->>'ref') so the same event is never queued
--    twice (this is the dedupe; there is no unit test for it). Status
--    queued → sent | failed | skipped. attempts counts claims; claimed_at is
--    the double-send guard (see 4). email/locale are SNAPSHOTS of the profile
--    at the moment of the event.
--
-- 2. notification_prefs — per-user unsubscribe state + a random token used in
--    the List-Unsubscribe link (no login needed). Created lazily: by the
--    enqueue function when a row is queued and again by claim_notifications,
--    so a token always exists when an email is sent.
--
-- 3. Triggers (SECURITY DEFINER, search_path ''; each wraps its enqueue in an
--    exception handler, so a notification problem can NEVER break the ledger
--    or project write that fired it):
--      credits_ledger AFTER INSERT
--        reason 'purchase:<order id>' and delta > 0  → credits_order_delivered
--          (written by grant_credits_for_order_internal, called from the
--          part_orders "delivered" trigger and from grant_for_order). One
--          order writes TWO rows (wiring + cad) in one statement; ref = the
--          order id, so the second row hits the unique index and is dropped.
--          The payload sums every purchase:<id> row of the user — AFTER ROW
--          triggers fire at the end of the statement, so both rows are
--          visible to the first trigger call.
--        reason 'admin_grant' and delta > 0          → credits_admin_grant
--          (admin_grant(); negative corrections send nothing). ref = ledger id.
--        reason 'spend:<project id>' and redeemable_until is not null
--                                                    → discount_ready
--          (spend_credit(); every paid credit spend is redeemable as QAR 20
--          for 30 days). ref = ledger id, valid_until = redeemable_until,
--          i.e. what redeem_credits actually honours. The kind starts
--          DISABLED in store_settings.notifications: 0042 counts the 30 days
--          from the SPEND, the owner rule says from the day the credit was
--          EARNED, and the ledger has no link from a spend to the grant it
--          used. See the Phase I report before enabling it.
--      projects AFTER INSERT                          → first_project
--          only when the owner has no other project and has never had a
--          first_project row queued. ref = project id.
--      projects AFTER UPDATE OF free_wiring_used (false → true)
--                                                    → first_circuit
--          (spend_credit's free first circuit of a project). Sent once per
--          USER (the first project whose free circuit is used), not once per
--          project. ref = project id. Balances come from credit_balance_of.
--    No confirmed email (guest / phone-only / unconfirmed sign-up) → the row
--    is stored as skipped, last_error 'no_email'. Opted out → skipped,
--    'unsubscribed'. Nothing is back-filled for past events.
--
-- 4. claim_notifications(p_limit) — service_role only. Picks up to p_limit
--    rows with status queued or failed, attempts < 3, and not claimed in the
--    last 10 minutes, FOR UPDATE SKIP LOCKED; sets claimed_at = now() and
--    attempts + 1; returns them with the user's unsubscribe token and opt-out
--    state. Double-send protection: SKIP LOCKED stops two overlapping drains
--    from taking the same row inside their claim transactions, and claimed_at
--    (a 10-minute visibility timeout) stops a second drain from re-taking a
--    row the first has claimed but not yet marked. A drain that dies mid-way
--    leaves its rows claimed; they become claimable again after 10 minutes.
--    The cron also sends a Resend Idempotency-Key (the outbox id), so a
--    re-send of the same row inside Resend's 24 h window is dropped by Resend.
--    mark_notification(id, status, error) records sent (sent_at) / failed
--    (last_error) / skipped and clears claimed_at.
--
-- 5. notification_unsubscribe(token, kind) — service_role only. kind 'all' sets
--    all_off; a known kind is added to unsubscribed_kinds. Returns whether the
--    token matched (the page shows the same neutral text either way).
--
-- 6. store_settings.notifications — owner on/off per kind (insert … on conflict
--    do nothing, so an owner edit survives a re-run). The drainer marks rows
--    of a disabled kind skipped with last_error 'disabled'.
--
-- RLS: both tables have RLS on and no policies for anon/authenticated; the
-- service role bypasses RLS; super admin may SELECT the outbox (admin page).
--
-- Run after 0045. Safe to re-run.
-- ============================================================================

begin;

-- ─── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  locale      text not null default 'en',
  email       text,
  status      text not null default 'queued',
  attempts    integer not null default 0,
  last_error  text,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

alter table public.notification_outbox add column if not exists claimed_at timestamptz;

do $$ begin
  alter table public.notification_outbox add constraint notification_outbox_status_check
    check (status in ('queued', 'sent', 'failed', 'skipped'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.notification_outbox add constraint notification_outbox_kind_check
    check (kind in ('credits_order_delivered', 'credits_admin_grant', 'first_project', 'first_circuit', 'discount_ready'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.notification_outbox add constraint notification_outbox_locale_check
    check (locale in ('en', 'ar'));
exception when duplicate_object then null; end $$;

create unique index if not exists notification_outbox_dedupe
  on public.notification_outbox (user_id, kind, (payload ->> 'ref'));
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at)
  where status in ('queued', 'failed');
create index if not exists notification_outbox_created_idx
  on public.notification_outbox (created_at desc);

create table if not exists public.notification_prefs (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  unsubscribed_kinds text[] not null default '{}',
  all_off            boolean not null default false,
  token              uuid not null default gen_random_uuid() unique,
  updated_at         timestamptz not null default now()
);

alter table public.notification_outbox enable row level security;
alter table public.notification_prefs  enable row level security;

revoke all on public.notification_outbox from anon, authenticated;
revoke all on public.notification_prefs  from anon, authenticated;
grant select on public.notification_outbox to authenticated;

drop policy if exists notification_outbox_admin_select on public.notification_outbox;
create policy notification_outbox_admin_select on public.notification_outbox
  for select to authenticated
  using (public.is_super_admin());

-- ─── Owner switches ─────────────────────────────────────────────────────────
insert into public.store_settings (key, value)
values ('notifications',
        '{"credits_order_delivered": true, "credits_admin_grant": true, "first_project": true, "first_circuit": true, "discount_ready": false}'::jsonb)
on conflict (key) do nothing;

-- ─── Enqueue (used by the triggers) ─────────────────────────────────────────
-- Snapshots the email (confirmed, non-anonymous accounts only) and locale.
-- Returns the outbox id, or null when the event was already queued.
create or replace function public.notification_enqueue(p_user uuid, p_kind text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text;
  v_locale text;
  v_prefs  record;
  v_status text := 'queued';
  v_error  text;
  v_id     uuid;
begin
  if p_user is null or coalesce(p_payload ->> 'ref', '') = '' then return null; end if;

  select case when u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
              then nullif(btrim(coalesce(p.email, u.email)), '') end,
         case when p.locale = 'ar' then 'ar' else 'en' end
    into v_email, v_locale
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = p_user;
  if not found then return null; end if;

  select all_off, unsubscribed_kinds into v_prefs from public.notification_prefs where user_id = p_user;
  if found and (v_prefs.all_off or p_kind = any (v_prefs.unsubscribed_kinds)) then
    v_status := 'skipped'; v_error := 'unsubscribed';
  elsif v_email is null then
    v_status := 'skipped'; v_error := 'no_email';
  else
    insert into public.notification_prefs (user_id) values (p_user) on conflict (user_id) do nothing;
  end if;

  insert into public.notification_outbox (user_id, kind, payload, locale, email, status, last_error)
  values (p_user, p_kind, p_payload, coalesce(v_locale, 'en'), v_email, v_status, v_error)
  on conflict (user_id, kind, (payload ->> 'ref')) do nothing
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.notification_enqueue(uuid, text, jsonb) from public, anon, authenticated;

-- ─── Trigger: credits_ledger ────────────────────────────────────────────────
create or replace function public.notify_credits_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   text;
  v_wiring  integer;
  v_cad     integer;
begin
  begin
    if new.reason like 'purchase:%' and new.delta > 0 then
      v_order := substring(new.reason from 10);
      select coalesce(sum(delta) filter (where kind = 'wiring'), 0)::integer,
             coalesce(sum(delta) filter (where kind = 'cad'), 0)::integer
        into v_wiring, v_cad
        from public.credits_ledger
       where user_id = new.user_id and reason = new.reason;
      perform public.notification_enqueue(new.user_id, 'credits_order_delivered', jsonb_build_object(
        'ref', v_order,
        'order_short', left(v_order, 8),
        'circuit_credits', v_wiring,
        'cad_credits', v_cad));

    elsif new.reason = 'admin_grant' and new.delta > 0 then
      perform public.notification_enqueue(new.user_id, 'credits_admin_grant', jsonb_build_object(
        'ref', new.id::text,
        'amount', new.delta,
        'credit_kind', new.kind,
        'note', new.note));

    elsif new.reason like 'spend:%' and new.redeemable_until is not null then
      perform public.notification_enqueue(new.user_id, 'discount_ready', jsonb_build_object(
        'ref', new.id::text,
        'amount_qar', 20,
        'valid_until', to_char(new.redeemable_until at time zone 'Asia/Qatar', 'YYYY-MM-DD'),
        'earned_at', to_char(new.created_at at time zone 'Asia/Qatar', 'YYYY-MM-DD'),
        'project_id', substring(new.reason from 7)));
    end if;
  exception when others then
    raise warning 'notify_credits_ledger skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.notify_credits_ledger() from public, anon, authenticated;

drop trigger if exists credits_ledger_notify on public.credits_ledger;
create trigger credits_ledger_notify
  after insert on public.credits_ledger
  for each row execute function public.notify_credits_ledger();

-- ─── Trigger: projects ──────────────────────────────────────────────────────
create or replace function public.notify_projects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.user_id is not null
         and not exists (select 1 from public.projects where user_id = new.user_id and id <> new.id)
         and not exists (select 1 from public.notification_outbox
                          where user_id = new.user_id and kind = 'first_project') then
        perform public.notification_enqueue(new.user_id, 'first_project', jsonb_build_object(
          'ref', new.id::text,
          'project_id', new.id::text,
          'project_name', new.name));
      end if;

    elsif tg_op = 'UPDATE' then
      if new.free_wiring_used and not coalesce(old.free_wiring_used, false)
         and new.user_id is not null
         and not exists (select 1 from public.projects
                          where user_id = new.user_id and id <> new.id and free_wiring_used)
         and not exists (select 1 from public.notification_outbox
                          where user_id = new.user_id and kind = 'first_circuit') then
        perform public.notification_enqueue(new.user_id, 'first_circuit', jsonb_build_object(
          'ref', new.id::text,
          'project_id', new.id::text,
          'project_name', new.name,
          'circuit_balance', public.credit_balance_of(new.user_id, 'wiring'),
          'cad_balance', public.credit_balance_of(new.user_id, 'cad')));
      end if;
    end if;
  exception when others then
    raise warning 'notify_projects skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.notify_projects() from public, anon, authenticated;

drop trigger if exists projects_notify_insert on public.projects;
create trigger projects_notify_insert
  after insert on public.projects
  for each row execute function public.notify_projects();

drop trigger if exists projects_notify_update on public.projects;
create trigger projects_notify_update
  after update of free_wiring_used on public.projects
  for each row execute function public.notify_projects();

-- ─── Drainer RPCs (service_role only) ───────────────────────────────────────
create or replace function public.claim_notifications(p_limit integer default 50)
returns table (
  id                 uuid,
  user_id            uuid,
  kind               text,
  payload            jsonb,
  locale             text,
  email              text,
  status             text,
  attempts           integer,
  created_at         timestamptz,
  token              uuid,
  unsubscribed_kinds text[],
  all_off            boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  with picked as (
    select o.id
      from public.notification_outbox o
     where o.status in ('queued', 'failed')
       and o.attempts < 3
       and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update skip locked
  ), claimed as (
    update public.notification_outbox o
       set attempts = o.attempts + 1, claimed_at = now()
      from picked
     where o.id = picked.id
    returning o.id
  )
  select coalesce(array_agg(claimed.id), '{}') into v_ids from claimed;

  insert into public.notification_prefs (user_id)
  select distinct o.user_id from public.notification_outbox o where o.id = any (v_ids)
  on conflict (user_id) do nothing;

  return query
    select o.id, o.user_id, o.kind, o.payload, o.locale, o.email, o.status, o.attempts, o.created_at,
           p.token, p.unsubscribed_kinds, p.all_off
      from public.notification_outbox o
      left join public.notification_prefs p on p.user_id = o.user_id
     where o.id = any (v_ids)
     order by o.created_at;
end $$;

revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

create or replace function public.mark_notification(p_id uuid, p_status text, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'bad_status'; end if;
  update public.notification_outbox
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         last_error = case when p_status = 'sent' then null else left(p_error, 500) end,
         claimed_at = null
   where id = p_id;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.mark_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_notification(uuid, text, text) to service_role;

-- ─── Unsubscribe (service_role only; called by /api/notifications/unsubscribe)
create or replace function public.notification_unsubscribe(p_token uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_token is null then return false; end if;
  if p_kind = 'all' then
    update public.notification_prefs set all_off = true, updated_at = now() where token = p_token;
  elsif p_kind in ('credits_order_delivered', 'credits_admin_grant', 'first_project', 'first_circuit', 'discount_ready') then
    update public.notification_prefs
       set unsubscribed_kinds = case when p_kind = any (unsubscribed_kinds) then unsubscribed_kinds
                                     else array_append(unsubscribed_kinds, p_kind) end,
           updated_at = now()
     where token = p_token;
  else
    return false;
  end if;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.notification_unsubscribe(uuid, text) from public, anon, authenticated;
grant execute on function public.notification_unsubscribe(uuid, text) to service_role;

-- Token for one user (creates the prefs row). For a future account page or
-- the admin page; service_role only.
create or replace function public.notification_prefs_token(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  insert into public.notification_prefs (user_id) values (p_user) on conflict (user_id) do nothing;
  select token into v_token from public.notification_prefs where user_id = p_user;
  return v_token;
end $$;

revoke all on function public.notification_prefs_token(uuid) from public, anon, authenticated;
grant execute on function public.notification_prefs_token(uuid) to service_role;

do $$ begin raise notice '0046 applied: notification_outbox + notification_prefs, ledger/project triggers (credits_order_delivered, credits_admin_grant, first_project, first_circuit, discount_ready [disabled]), claim_notifications, mark_notification, notification_unsubscribe, store_settings.notifications'; end $$;

commit;
