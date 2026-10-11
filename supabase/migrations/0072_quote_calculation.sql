-- ============================================================================
-- Gestaltung — 0072: the Studio quote calculation, the owner's quote, and the
--                    editable price rule (W2b, 2026-10-11)
-- ============================================================================
-- Run AFTER 0071 (does not depend on it). Safe to re-run: `if not exists`,
-- `create or replace`, `on conflict do nothing`, policies/triggers dropped and
-- re-created.
--
-- WHAT
-- 1. inquiries gains
--      project_id       uuid → projects (on delete set null): the Studio project
--                       a "Get it made" request is about
--      quote_calc       jsonb: the full estimate calculation, computed on the
--                       SERVER from the saved Studio doc when the request is
--                       sent (lib/studio/request-summary.ts quoteCalcSnapshot):
--                       rule version + base + rate per gram + spread, each
--                       printed part (grams × rate), each component (store SKU
--                       + price, or "we source"), parts subtotal, low, high,
--                       project link
--      final_quote_qar  numeric(10,2) ≥ 0: the price the owner actually quoted
--      quote_note       text ≤ 1000: optional note shown to the client
--      quoted_at, quoted_by: stamped by the trigger below
-- 2. Guard trigger inquiries_guard_quote:
--      INSERT by anon / authenticated (the public lead form, PostgREST): the
--        six columns above are forced to null — only the server (service_role,
--        /api/store-lead) may attach a project or a calculation, so nobody can
--        plant a fake "Your quote" on someone's project.
--      UPDATE by authenticated (RLS already limits updates to super_admin):
--        project_id and quote_calc never change (the snapshot is history);
--        a changed final_quote_qar / quote_note stamps quoted_at = now() and
--        quoted_by = auth.uid().
-- 3. project_quote(p_project) SECURITY DEFINER, EXECUTE authenticated: the
--    latest owner quote (final, note, date) for a project the CALLER owns
--    (or a super_admin). Returns nothing else (no phone, no calculation).
-- 4. store_settings.studio_quote_rule = {"base_qar": 100, "per_gram_qar": 0.7,
--    "spread": 1.5} (on conflict do nothing — owner edits survive re-runs).
--    Identical to DEFAULT_QUOTE_RULE in code. Edited in Dashboard → Leads →
--    Quote accuracy. Anon-readable like every store_settings key (it is the
--    published estimate rule; nothing secret).
--
-- RLS: unchanged. inquiries select/update/delete stay super_admin only
-- (0002); insert stays open (public lead capture) with the guard above.
--
-- UNTIL THIS RUNS: Studio requests are saved without the calculation (the
-- insert retries without the new columns), the admin lead page says "Run
-- migration 0072 first", the client keeps seeing the estimate range, and the
-- rule editor's first save creates the store_settings row anyway.
--
-- DRY RUN (read-only):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'inquiries';
--   select key, value from public.store_settings where key = 'studio_quote_rule';
--
-- AFTER (check):
--   select id, project_id, quote_calc->>'low' low, quote_calc->>'high' high,
--          final_quote_qar, quoted_at from public.inquiries
--    where quote_calc is not null order by created_at desc limit 5;
--
-- ROLLBACK (manual):
--   drop function if exists public.project_quote(uuid);
--   drop trigger if exists inquiries_guard_quote on public.inquiries;
--   drop function if exists public.inquiries_guard_quote();
--   alter table public.inquiries drop column if exists quoted_by,
--     drop column if exists quoted_at, drop column if exists quote_note,
--     drop column if exists final_quote_qar, drop column if exists quote_calc,
--     drop column if exists project_id;
--   delete from public.store_settings where key = 'studio_quote_rule';
-- ============================================================================

-- 1. Columns ------------------------------------------------------------------
alter table public.inquiries
  add column if not exists project_id uuid references public.projects (id) on delete set null,
  add column if not exists quote_calc jsonb,
  add column if not exists final_quote_qar numeric(10, 2),
  add column if not exists quote_note text,
  add column if not exists quoted_at timestamptz,
  add column if not exists quoted_by uuid references auth.users (id) on delete set null;

alter table public.inquiries drop constraint if exists inquiries_final_quote_check;
alter table public.inquiries add constraint inquiries_final_quote_check
  check (final_quote_qar is null or (final_quote_qar >= 0 and final_quote_qar <= 1000000));

alter table public.inquiries drop constraint if exists inquiries_quote_note_check;
alter table public.inquiries add constraint inquiries_quote_note_check
  check (quote_note is null or char_length(quote_note) <= 1000);

alter table public.inquiries drop constraint if exists inquiries_quote_calc_check;
alter table public.inquiries add constraint inquiries_quote_calc_check
  check (quote_calc is null or (jsonb_typeof(quote_calc) = 'object' and pg_column_size(quote_calc) <= 65536));

create index if not exists inquiries_project_id_idx
  on public.inquiries (project_id) where project_id is not null;
create index if not exists inquiries_quoted_idx
  on public.inquiries (quoted_at desc) where final_quote_qar is not null;

-- 2. Guard trigger --------------------------------------------------------------
create or replace function public.inquiries_guard_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- service_role (the server) and the SQL editor are trusted
  end if;

  if tg_op = 'INSERT' then
    new.project_id := null;
    new.quote_calc := null;
    new.final_quote_qar := null;
    new.quote_note := null;
    new.quoted_at := null;
    new.quoted_by := null;
    return new;
  end if;

  -- UPDATE (super_admin only, by RLS): the snapshot is history.
  new.project_id := old.project_id;
  new.quote_calc := old.quote_calc;
  if new.final_quote_qar is distinct from old.final_quote_qar
     or new.quote_note is distinct from old.quote_note then
    new.quoted_at := now();
    new.quoted_by := auth.uid();
  else
    new.quoted_at := old.quoted_at;
    new.quoted_by := old.quoted_by;
  end if;
  return new;
end;
$$;

drop trigger if exists inquiries_guard_quote on public.inquiries;
create trigger inquiries_guard_quote
  before insert or update on public.inquiries
  for each row execute function public.inquiries_guard_quote();

-- 3. The client's view of the owner's quote ------------------------------------
create or replace function public.project_quote(p_project uuid)
returns table (final_quote_qar numeric, quote_note text, quoted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.final_quote_qar, i.quote_note, i.quoted_at
    from public.inquiries i
    join public.projects p on p.id = i.project_id
   where i.project_id = p_project
     and i.final_quote_qar is not null
     and (p.user_id = auth.uid() or public.is_super_admin())
   order by i.quoted_at desc nulls last, i.created_at desc
   limit 1;
$$;

revoke all on function public.project_quote(uuid) from public;
grant execute on function public.project_quote(uuid) to authenticated;

-- 4. The editable rule ---------------------------------------------------------
insert into public.store_settings (key, value)
values ('studio_quote_rule', '{"base_qar": 100, "per_gram_qar": 0.7, "spread": 1.5}'::jsonb)
on conflict (key) do nothing;

do $$
begin
  raise notice '0072 applied: inquiries project_id/quote_calc/final_quote_qar/quote_note/quoted_at/quoted_by, guard trigger, project_quote(), store_settings.studio_quote_rule';
end;
$$;
