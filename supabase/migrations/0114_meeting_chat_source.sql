-- ============================================================================
-- 0114 — Which AI chat booked a meeting (chat plugin Phase 4c, ChatGPT)
--
-- WHY: 0113 records WHERE a booking came from (`source` = 'plugin' | 'website')
-- but not WHICH chat, so the owner cannot tell a Claude booking from a ChatGPT
-- one. plugin_handoffs has carried that since 0112 (`source` = 'claude' |
-- 'chatgpt' | 'other'); this gives meetings the same.
--
-- Kept as its own column rather than widening 0113's `source` check, so
-- "booked from the website" and "booked from ChatGPT" stay separate facts.
--
-- 1. meeting_bookings.chat_source  nullable; null = not from a chat (the website).
-- 2. book_meeting(...)             replaced, with p_chat_source appended.
--
-- The old 12-argument book_meeting is dropped so there is no overload for
-- PostgREST to choose between. Everything else about it is unchanged.
--
-- BEFORE IT RUNS: bookings work exactly as in 0113 and the admin page shows no
-- chat name for a meeting. RUN AFTER 0113. Safe to re-run.
--
-- Rollback:
--   drop function if exists public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean, text);
--   -- then re-run 0113's book_meeting block to restore the 12-argument version
--   alter table public.meeting_bookings drop column if exists chat_source;
-- ============================================================================

alter table public.meeting_bookings
  add column if not exists chat_source text
    check (chat_source is null or chat_source in ('claude', 'chatgpt', 'other'));

comment on column public.meeting_bookings.chat_source is
  'Which AI chat booked it (0114): claude | chatgpt | other, or null when it came from the website.';

-- The 0113 signature, dropped so only the new one remains.
drop function if exists public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean);

create or replace function public.book_meeting(
  p_starts_at    timestamptz,
  p_mode         text,
  p_name         text,
  p_phone        text,
  p_token_hash   text,
  p_email        text default null,
  p_locale       text default 'en',
  p_topic        text default null,
  p_project_id   uuid default null,
  p_handoff_id   uuid default null,
  p_source       text default 'website',
  p_is_test      boolean default false,
  p_chat_source  text default null
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
       project_id, handoff_id, source, manage_token_hash, invoice_qar, is_test, chat_source)
    values
      (p_starts_at, p_starts_at + make_interval(mins => v_slot), p_mode,
       left(btrim(p_name), 60), p_phone, nullif(btrim(coalesce(p_email, '')), ''),
       coalesce(p_locale, 'en'), nullif(btrim(coalesce(p_topic, '')), ''),
       p_project_id, p_handoff_id, coalesce(p_source, 'website'), p_token_hash,
       (v_cfg ->> 'price_qar')::numeric, coalesce(p_is_test, false),
       case when p_chat_source in ('claude', 'chatgpt', 'other') then p_chat_source else null end)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'slot_taken';
  end;

  return v_row;
end $$;

revoke all on function public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean, text)
  to service_role;

comment on function public.book_meeting(timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, boolean, text) is
  'Books one meeting (0113, chat_source added in 0114; service_role only). Re-checks weekday/time/holiday/horizon, the notice window, the mode and a 2-future-meetings-per-phone cap. Raises bad_slot | too_soon | slot_taken | too_many.';
