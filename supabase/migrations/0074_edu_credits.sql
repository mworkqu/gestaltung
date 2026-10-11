-- 0074_edu_credits.sql
-- Owner request: accounts with an educational email get 2 credits.
--
-- Rule: an account whose CONFIRMED, non-anonymous email is educational gets
-- 2 credits (1 wiring + 1 cad = one circuit and one 3D model, matching the UI
-- copy "each wiring diagram or 3D model costs one credit") ONCE per account and
-- ONCE per email address. Ledger reason 'edu_grant' (not 'admin_grant', so the
-- 0061 price funnel does not count it as bought, and no admin email is queued).
-- Rows are plain positive ledger rows, so spending / oldest-first / 30-day
-- redemption (0052/0053) treat them like any other grant.
--
-- Educational = domain ends with .edu, or ends with .edu.<cc> / .ac.<cc>
-- (<cc> = two letters) with a label before edu/ac: qu.edu.qa, hbku.edu.qa,
-- udst.edu.qa, ox.ac.uk, qatar.cmu.edu. "edu.qa" or "ac.uk" alone do not count.
-- Mirrors lib/credits/edu.ts (isEduEmail / eduEmailKey) - keep identical.
--
-- Hook: AFTER INSERT/UPDATE OF email, email_confirmed_at on auth.users. Covers
-- signup + confirm, and a later change to an edu address (the email column
-- changes when the change is confirmed). Failures never block auth.
-- Safe to re-run. Rollback (comments):
--   drop trigger if exists on_auth_user_edu_credits on auth.users;
--   drop function if exists public.edu_credit_trigger();
--   drop function if exists public.edu_credit_grant(uuid, text);
--   drop function if exists public.edu_email_key(text);
--   drop function if exists public.is_edu_email(text);
--   drop table if exists public.edu_credit_grants;

create or replace function public.is_edu_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
     and length(btrim(p_email)) - length(replace(btrim(p_email), '@', '')) = 1
     and position('@' in btrim(p_email)) > 1
     and lower(split_part(btrim(p_email), '@', 2)) ~ '^([a-z0-9-]+\.)+(edu|(edu|ac)\.[a-z]{2})$';
$$;

-- lowercase, "+tag" dropped from the local part (stops a+1@x.edu farming).
create or replace function public.edu_email_key(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1) || '@' || split_part(lower(btrim(p_email)), '@', 2);
$$;

create table if not exists public.edu_credit_grants (
  email_key  text primary key,
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.edu_credit_grants enable row level security;
revoke all on public.edu_credit_grants from anon, authenticated;
-- no policies: only SECURITY DEFINER code and the service role touch it.

-- Grants once; returns true when credits were added.
create or replace function public.edu_credit_grant(p_user uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_user is null or not public.is_edu_email(p_email) then return false; end if;

  insert into public.edu_credit_grants (email_key, user_id)
  values (public.edu_email_key(p_email), p_user)
  on conflict do nothing;                 -- same email OR same account already granted
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;

  insert into public.credits_ledger (user_id, kind, delta, reason, note) values
    (p_user, 'wiring', 1, 'edu_grant', 'Educational email'),
    (p_user, 'cad',    1, 'edu_grant', 'Educational email');
  return true;
end $$;

revoke all on function public.edu_credit_grant(uuid, text) from public, anon, authenticated;

create or replace function public.edu_credit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.email_confirmed_at is not null
       and coalesce(new.is_anonymous, false) = false
       and new.email is not null then
      perform public.edu_credit_grant(new.id, new.email);
    end if;
  exception when others then
    raise warning 'edu_credit_trigger skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.edu_credit_trigger() from public, anon, authenticated;

drop trigger if exists on_auth_user_edu_credits on auth.users;
create trigger on_auth_user_edu_credits
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.edu_credit_trigger();

-- One-time back-fill of existing confirmed edu accounts (idempotent: the
-- grants table blocks a second run). Oldest account wins when two share a key.
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, email from auth.users
     where email_confirmed_at is not null
       and coalesce(is_anonymous, false) = false
       and public.is_edu_email(email)
     order by created_at
  loop
    if public.edu_credit_grant(r.id, r.email) then n := n + 1; end if;
  end loop;
  raise notice '0074 applied: edu_credit_grants + edu_grant trigger; back-filled % account(s)', n;
end $$;
