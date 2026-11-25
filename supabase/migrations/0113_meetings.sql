-- ============================================================================
-- 0113 — Paid meetings with the engineer (chat plugin Phase 2, website too)
--
-- WHY: a client who designed something in Claude (or on the website) can book
-- one paid hour with our engineer — online (Google Meet link sent on WhatsApp)
-- or at the studio in Rafal Tower, Lusail. QAR 150, invoiced AFTER the meeting
-- and only if the client is happy; free to move or cancel up to 24 h before;
-- the 150 comes off a manufacturing order placed within 30 days.
--
-- 1. store_settings.meetings        seeded once (on conflict do nothing) — owner edits survive.
-- 2. public.meeting_bookings        service_role writes; super_admin reads/updates.
-- 3. meeting_settings()             defaults merged with the owner's row.
-- 4. meeting_slot_on_grid(ts)       weekday / time / holiday / horizon only (no notice, no bookings).
-- 5. meeting_free_slots(from, days) anon + authenticated; free slot START TIMES only, never names.
-- 6. book_meeting(...)              service_role only; RAISES slot_taken | too_soon | bad_slot | too_many.
-- 7. cancel_meeting(token)          anon; returns {ok:false, reason:too_late|bad_token} (page-facing).
-- 8. move_meeting(token, ts)        anon; same checks as book, returns jsonb.
-- 9. set_meeting_status(id, st, n)  super_admin; forward-only transitions.
-- 10. apply_meeting_credit(m, o)    super_admin; once per meeting, order within order_credit_days.
--
-- Shape note: book_meeting RAISES (the MCP tool and /api/meetings/book map the
-- message to copy), while the token RPCs the public manage page calls RETURN
-- jsonb, like claim_plugin_handoff (0112) — a page must render a reason, not a 500.
--
-- One live meeting per slot is enforced by a PARTIAL UNIQUE INDEX on starts_at
-- where status not in ('cancelled','no_show'): a cancelled slot can be rebooked.
--
-- BEFORE IT RUNS: the MCP tools list_meeting_slots / book_meeting answer "not
-- set up yet", the website booking UI shows the same, and the manage page shows
-- a not-ready error. Nothing else changes. Needs 0011 (part_orders), 0025
-- (store_settings), 0112 (plugin_handoffs). Safe to re-run.
--
-- Rollback:
--   drop function if exists public.apply_meeting_credit(uuid, uuid);
--   drop function if exists public.set_meeting_status(uuid, text, text);
--   drop function if exists public.move_meeting(text, timestamptz);
--   drop function if exists public.cancel_meeting(text);
--   drop function if exists public.book_meeting(timestamptz, text, text, text, text, text, text, uuid, uuid, text, text, boolean);
--   drop function if exists public.meeting_free_slots(date, integer);
--   drop function if exists public.meeting_slot_on_grid(timestamptz);
--   drop function if exists public.meeting_settings();
--   drop table if exists public.meeting_bookings;
--   delete from public.store_settings where key = 'meetings';
-- ============================================================================

-- ── settings ─────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value)
values (
  'meetings',
  '{"timezone":"Asia/Qatar","weekdays":[1,3],"start":"16:00","end":"18:00","slot_minutes":60,
    "price_qar":150,"min_notice_hours":24,"horizon_days":21,"cancel_free_hours":24,
    "order_credit_days":30,"modes":["online","studio"]}'::jsonb
)
on conflict (key) do nothing;

-- ── bookings ─────────────────────────────────────────────────────────────────
create table if not exists public.meeting_bookings (
  id                uuid primary key default gen_random_uuid(),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  mode              text not null check (mode in ('online', 'studio')),
  status            text not null default 'booked'
                      check (status in ('booked', 'cancelled', 'done', 'no_show', 'invoiced', 'paid')),
  name              text not null check (char_length(name) between 1 and 60),
  phone             text not null check (phone ~ '^\+[0-9]{8,15}$'),
  email             text check (email is null or char_length(email) <= 160),
  locale            text not null default 'en' check (locale in ('en', 'ar')),
  topic             text check (topic is null or char_length(topic) <= 400),
  project_id        uuid references public.projects (id) on delete set null,
  handoff_id        uuid references public.plugin_handoffs (id) on delete set null,
  source            text not null default 'website' check (source in ('plugin', 'website')),
  manage_token_hash text not null unique check (char_length(manage_token_hash) = 64),
  meet_link         text check (meet_link is null or char_length(meet_link) <= 500),
  owner_note        text check (owner_note is null or char_length(owner_note) <= 1000),
  invoice_qar       numeric(10, 2) not null default 150,
  credit_order_id   uuid references public.part_orders (id) on delete set null,
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  invoiced_at       timestamptz,
  paid_at           timestamptz,
  is_test           boolean not null default false
);

-- One LIVE meeting per slot; a cancelled / no-show slot is free again.
create unique index if not exists meeting_bookings_live_slot_idx
  on public.meeting_bookings (starts_at)
  where status not in ('cancelled', 'no_show');

create index if not exists meeting_bookings_starts_idx on public.meeting_bookings (starts_at desc);
create index if not exists meeting_bookings_phone_idx on public.meeting_bookings (phone);
create index if not exists meeting_bookings_handoff_idx on public.meeting_bookings (handoff_id) where handoff_id is not null;
create index if not exists meeting_bookings_credit_idx on public.meeting_bookings (credit_order_id) where credit_order_id is not null;

comment on table public.meeting_bookings is
  'Paid engineer meetings (0113): QAR 150 per hour, online or at the studio. Only the sha256 of the manage token is stored. service_role writes through book_meeting(); super_admin reads and updates.';

alter table public.meeting_bookings enable row level security;
revoke all on table public.meeting_bookings from public, anon, authenticated;
grant all on table public.meeting_bookings to service_role;
grant select, update on table public.meeting_bookings to authenticated; -- RLS: super_admin only

drop policy if exists meeting_bookings_admin_select on public.meeting_bookings;
create policy meeting_bookings_admin_select on public.meeting_bookings
  for select to authenticated using (public.is_super_admin());

drop policy if exists meeting_bookings_admin_update on public.meeting_bookings;
create policy meeting_bookings_admin_update on public.meeting_bookings
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ── settings reader ──────────────────────────────────────────────────────────
-- Defaults first, the owner's row on top, so a partial row still works.
create or replace function public.meeting_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"timezone":"Asia/Qatar","weekdays":[1,3],"start":"16:00","end":"18:00","slot_minutes":60,
           "price_qar":150,"min_notice_hours":24,"horizon_days":21,"cancel_free_hours":24,
           "order_credit_days":30,"modes":["online","studio"]}'::jsonb
         || coalesce((select value from public.store_settings where key = 'meetings'), '{}'::jsonb)
$$;

revoke all on function public.meeting_settings() from public;
grant execute on function public.meeting_settings() to anon, authenticated, service_role;

comment on function public.meeting_settings() is
  'store_settings.meetings merged over the built-in defaults (0113).';

-- ── is this timestamp an allowed slot? ───────────────────────────────────────
-- Weekday, time-of-day on the grid, not a holiday, inside the horizon.
-- Deliberately NOT: the notice window and existing bookings (callers check
-- those separately so they can tell too_soon from slot_taken).
create or replace function public.meeting_slot_on_grid(p_starts_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := public.meeting_settings();
  v_tz    text  := v_cfg ->> 'timezone';
  v_local timestamp;
  v_mins  integer;
  v_start integer;
  v_end   integer;
  v_slot  integer := greatest(1, (v_cfg ->> 'slot_minutes')::integer);
begin
  if p_starts_at is null then
    return false;
  end if;

  v_local := p_starts_at at time zone v_tz;
  v_mins  := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_start := extract(hour from (v_cfg ->> 'start')::time)::integer * 60
             + extract(minute from (v_cfg ->> 'start')::time)::integer;
  v_end   := extract(hour from (v_cfg ->> 'end')::time)::integer * 60
             + extract(minute from (v_cfg ->> 'end')::time)::integer;

  -- whole minute, on the slot grid, and the whole hour fits before closing
  if extract(second from v_local) <> 0 then return false; end if;
  if v_mins < v_start or v_mins + v_slot > v_end then return false; end if;
  if (v_mins - v_start) % v_slot <> 0 then return false; end if;

  -- allowed weekday (ISO: Mon 1 … Sun 7)
  if not (extract(isodow from v_local)::integer in
          (select jsonb_array_elements_text(v_cfg -> 'weekdays')::integer)) then
    return false;
  end if;

  -- public holiday (store_settings.holidays.dates, same list the store uses)
  if exists (
    select 1
      from public.store_settings s,
           jsonb_array_elements_text(coalesce(s.value -> 'dates', '[]'::jsonb)) d
     where s.key = 'holidays'
       and d = to_char(v_local, 'YYYY-MM-DD')
  ) then
    return false;
  end if;

  -- inside the booking horizon
  if p_starts_at > now() + make_interval(days => (v_cfg ->> 'horizon_days')::integer) then
    return false;
  end if;

  return true;
end $$;

revoke all on function public.meeting_slot_on_grid(timestamptz) from public;
grant execute on function public.meeting_slot_on_grid(timestamptz) to anon, authenticated, service_role;

comment on function public.meeting_slot_on_grid(timestamptz) is
  'True when the timestamp is an allowed meeting slot by weekday, time, holiday and horizon (0113). Does not consider the notice window or existing bookings.';

-- ── free slots (anon-safe: start times only) ─────────────────────────────────
create or replace function public.meeting_free_slots(p_from date default null, p_days integer default null)
returns setof timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := public.meeting_settings();
  v_tz      text  := v_cfg ->> 'timezone';
  v_horizon integer := greatest(1, (v_cfg ->> 'horizon_days')::integer);
  v_slot    integer := greatest(1, (v_cfg ->> 'slot_minutes')::integer);
  v_days    integer;
  v_from    date;
begin
  v_from := coalesce(p_from, (now() at time zone v_tz)::date);
  -- clamp: never more than the horizon, never zero or negative
  v_days := least(greatest(coalesce(p_days, v_horizon), 1), v_horizon);

  return query
  with grid as (
    -- generate_series over integers: a date series with an interval step would
    -- come back as timestamptz and break the concatenation below.
    select (((v_from + off)::text || ' ' || to_char(make_interval(mins => m), 'HH24:MI'))::timestamp
             at time zone v_tz) as ts
      from generate_series(0, v_days - 1) off,
           generate_series(
             extract(hour from (v_cfg ->> 'start')::time)::integer * 60
               + extract(minute from (v_cfg ->> 'start')::time)::integer,
             extract(hour from (v_cfg ->> 'end')::time)::integer * 60
               + extract(minute from (v_cfg ->> 'end')::time)::integer - v_slot,
             v_slot
           ) m
  )
  select g.ts
    from grid g
   where public.meeting_slot_on_grid(g.ts)
     and g.ts >= now() + make_interval(hours => (v_cfg ->> 'min_notice_hours')::integer)
     and not exists (
       select 1 from public.meeting_bookings b
        where b.starts_at = g.ts
          and b.status not in ('cancelled', 'no_show')
     )
   order by g.ts;
end $$;

revoke all on function public.meeting_free_slots(date, integer) from public;
grant execute on function public.meeting_free_slots(date, integer) to anon, authenticated, service_role;

comment on function public.meeting_free_slots(date, integer) is
  'Free meeting slot START TIMES (0113), clamped to the horizon. Returns no personal data; safe for anon.';

-- ── book (server only) ───────────────────────────────────────────────────────
create or replace function public.book_meeting(
  p_starts_at   timestamptz,
  p_mode        text,
  p_name        text,
  p_phone       text,
  p_token_hash  text,
  p_email       text default null,
  p_locale      text default 'en',
  p_topic       text default null,
  p_project_id  uuid default null,
  p_handoff_id  uuid default null,
  p_source      text default 'website',
  p_is_test     boolean default false
)
returns public.meeting_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg  jsonb := public.meeting_settings();
  v_slot integer := greatest(1, (v_cfg ->> 'slot_minutes')::integer);
  v_row  public.meeting_bookings;
begin
  if not public.meeting_slot_on_grid(p_starts_at) then
    raise exception 'bad_slot';
  end if;
  if p_starts_at < now() + make_interval(hours => (v_cfg ->> 'min_notice_hours')::integer) then
    raise exception 'too_soon';
  end if;
  if not (p_mode in (select jsonb_array_elements_text(v_cfg -> 'modes'))) then
    raise exception 'bad_slot';
  end if;

  -- at most 2 future LIVE meetings per phone
  if (select count(*)
        from public.meeting_bookings b
       where b.phone = p_phone
         and b.starts_at > now()
         and b.status not in ('cancelled', 'no_show')) >= 2 then
    raise exception 'too_many';
  end if;

  begin
    insert into public.meeting_bookings
      (starts_at, ends_at, mode, name, phone, email, locale, topic,
       project_id, handoff_id, source, manage_token_hash, invoice_qar, is_test)
    values
      (p_starts_at, p_starts_at + make_interval(mins => v_slot), p_mode,
       left(btrim(p_name), 60), p_phone, nullif(btrim(coalesce(p_email, '')), ''),
       coalesce(p_locale, 'en'), nullif(btrim(coalesce(p_topic, '')), ''),
       p_project_id, p_handoff_id, coalesce(p_source, 'website'), p_token_hash,
       (v_cfg ->> 'price_qar')::numeric, coalesce(p_is_test, false))
    returning * into v_row;
  exception when unique_violation then
    -- the partial unique index on starts_at: someone took it first
    raise exception 'slot_taken';
  end;

  return v_row;
end $$;

revoke all on function public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean)
  to service_role;

comment on function public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean) is
  'Books one meeting (0113, service_role only). Re-checks weekday/time/holiday/horizon, the notice window, the mode and a 2-future-meetings-per-phone cap. Raises bad_slot | too_soon | slot_taken | too_many.';

-- ── cancel (public manage page) ──────────────────────────────────────────────
create or replace function public.cancel_meeting(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg  jsonb := public.meeting_settings();
  v_row  public.meeting_bookings;
  v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  select * into v_row from public.meeting_bookings where manage_token_hash = v_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;
  if v_row.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_row.status <> 'booked' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  if now() > v_row.starts_at - make_interval(hours => (v_cfg ->> 'cancel_free_hours')::integer) then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;

  update public.meeting_bookings
     set status = 'cancelled', cancelled_at = now()
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'already', false);
end $$;

revoke all on function public.cancel_meeting(text) from public;
grant execute on function public.cancel_meeting(text) to anon, authenticated, service_role;

comment on function public.cancel_meeting(text) is
  'Cancels a meeting by its manage token (0113), allowed until cancel_free_hours before the start. Returns {ok} or {ok:false, reason: bad_token|too_late}. No invoice follows a cancelled meeting.';

-- ── move (public manage page) ────────────────────────────────────────────────
create or replace function public.move_meeting(p_token text, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg  jsonb := public.meeting_settings();
  v_slot integer := greatest(1, (v_cfg ->> 'slot_minutes')::integer);
  v_row  public.meeting_bookings;
  v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  select * into v_row from public.meeting_bookings where manage_token_hash = v_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;
  if v_row.status <> 'booked' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  -- the same window that governs cancelling governs moving
  if now() > v_row.starts_at - make_interval(hours => (v_cfg ->> 'cancel_free_hours')::integer) then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;

  if not public.meeting_slot_on_grid(p_starts_at) then
    return jsonb_build_object('ok', false, 'reason', 'bad_slot');
  end if;
  if p_starts_at < now() + make_interval(hours => (v_cfg ->> 'min_notice_hours')::integer) then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;
  if exists (
    select 1 from public.meeting_bookings b
     where b.starts_at = p_starts_at
       and b.status not in ('cancelled', 'no_show')
       and b.id <> v_row.id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end if;

  begin
    update public.meeting_bookings
       set starts_at = p_starts_at, ends_at = p_starts_at + make_interval(mins => v_slot)
     where id = v_row.id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'starts_at', p_starts_at);
end $$;

revoke all on function public.move_meeting(text, timestamptz) from public;
grant execute on function public.move_meeting(text, timestamptz) to anon, authenticated, service_role;

comment on function public.move_meeting(text, timestamptz) is
  'Moves a meeting by its manage token (0113) to another free slot, under the same window and checks as booking. Returns {ok, starts_at} or {ok:false, reason: bad_token|too_late|bad_slot|too_soon|slot_taken}.';

-- ── owner: status ────────────────────────────────────────────────────────────
-- Forward only: booked -> done | no_show | cancelled, done -> invoiced, invoiced -> paid.
create or replace function public.set_meeting_status(p_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.meeting_bookings;
  v_ok  boolean;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_row from public.meeting_bookings where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_ok := (v_row.status = 'booked'   and p_status in ('done', 'no_show', 'cancelled'))
       or (v_row.status = 'done'     and p_status = 'invoiced')
       or (v_row.status = 'invoiced' and p_status = 'paid');
  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'bad_transition', 'from', v_row.status, 'to', p_status);
  end if;

  update public.meeting_bookings
     set status       = p_status,
         owner_note   = coalesce(nullif(btrim(coalesce(p_note, '')), ''), owner_note),
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
         invoiced_at  = case when p_status = 'invoiced'  then now() else invoiced_at  end,
         paid_at      = case when p_status = 'paid'      then now() else paid_at      end
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

revoke all on function public.set_meeting_status(uuid, text, text) from public, anon;
grant execute on function public.set_meeting_status(uuid, text, text) to authenticated, service_role;

comment on function public.set_meeting_status(uuid, text, text) is
  'Super-admin status change on a meeting (0113), forward only: booked -> done|no_show|cancelled, done -> invoiced, invoiced -> paid. The owner invoices only after the meeting, and only if the client is happy.';

-- ── owner: order credit ──────────────────────────────────────────────────────
-- QAR 150 off a manufacturing order placed within order_credit_days of a PAID
-- meeting. Recorded here only; checkout totals are untouched (the owner
-- confirms the price on WhatsApp).
create or replace function public.apply_meeting_credit(p_meeting uuid, p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := public.meeting_settings();
  v_row   public.meeting_bookings;
  v_made  timestamptz;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_row from public.meeting_bookings where id = p_meeting for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'not_paid');
  end if;
  if v_row.credit_order_id is not null then
    return jsonb_build_object(
      'ok', v_row.credit_order_id = p_order,
      'reason', case when v_row.credit_order_id = p_order then null else 'already_used' end,
      'already', true
    );
  end if;

  select created_at into v_made from public.part_orders where id = p_order;
  if v_made is null then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;
  if v_made < v_row.starts_at
     or v_made > v_row.starts_at + make_interval(days => (v_cfg ->> 'order_credit_days')::integer) then
    return jsonb_build_object('ok', false, 'reason', 'out_of_window');
  end if;

  update public.meeting_bookings set credit_order_id = p_order where id = p_meeting;

  return jsonb_build_object('ok', true, 'credit_qar', (v_cfg ->> 'price_qar')::numeric, 'order_id', p_order);
end $$;

revoke all on function public.apply_meeting_credit(uuid, uuid) from public, anon;
grant execute on function public.apply_meeting_credit(uuid, uuid) to authenticated, service_role;

comment on function public.apply_meeting_credit(uuid, uuid) is
  'Records the QAR 150 meeting credit against one order (0113): only a paid meeting, only an order created within order_credit_days after it, once per meeting. Changes no order total.';
