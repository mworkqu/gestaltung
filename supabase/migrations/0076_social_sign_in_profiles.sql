-- Gestaltung — 0076: profiles for social sign-in (Google, Apple, Microsoft)
-- (2026-10-11). NOT RUN YET. Run AFTER 0075. Safe to re-run.
--
-- The app works before this runs: handle_new_user (0003) already copes with
-- missing metadata (every field is nullif(...) / coalesce(...), so an Apple
-- user with no name, or a private-relay email, still gets a profile row with
-- role 'client'). This migration only fills the profile better:
--
-- 1. handle_new_user: full_name falls back to the provider's `name`
--    (Microsoft and some Google accounts send `name` but not `full_name`);
--    locale is reduced to 'en' | 'ar' (Google may send "ar-QA" / "en-GB"; the
--    app only knows en and ar; the sign-up form already sends 'en' | 'ar').
-- 2. A guest who links Google/Apple/Microsoft keeps the SAME auth.users row
--    (linkIdentity), so the insert trigger never runs again and their profile
--    has no name. New trigger on auth.users UPDATE OF raw_user_meta_data
--    copies full_name / name into profiles.full_name when it is still empty.
--    It never overwrites a name, never touches role / tenant / phone, and
--    never blocks an auth write (errors are swallowed).
--
-- Email: profiles.email is already kept in sync by 0042
-- (on_auth_user_email_sync, insert + update of email), so a linked guest's
-- new email lands there too. ai_role() (0042) treats a social sign-in as
-- 'user' because Supabase sets email_confirmed_at for provider-verified
-- emails and is_anonymous becomes false after linking.
--
-- Rollback: re-run the handle_new_user body from 0003 and
--   drop trigger if exists on_auth_user_meta_name on auth.users;
--   drop function if exists public.fill_profile_name_from_meta();

create or replace function public.profile_locale_from_meta(p_meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_meta ->> 'locale', '')) like 'ar%' then 'ar'
    else 'en'
  end;
$$;

revoke all on function public.profile_locale_from_meta(jsonb) from public;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, locale)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
    ), 200),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    public.profile_locale_from_meta(coalesce(new.raw_user_meta_data, '{}'::jsonb))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.fill_profile_name_from_meta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
  ), 200);
  if v_name is not null then
    update public.profiles
       set full_name = v_name
     where id = new.id
       and (full_name is null or btrim(full_name) = '');
  end if;
  return new;
exception when others then
  -- Never block sign-in / linking because of the profile name.
  return new;
end;
$$;

revoke all on function public.fill_profile_name_from_meta() from public;

drop trigger if exists on_auth_user_meta_name on auth.users;
create trigger on_auth_user_meta_name
  after update of raw_user_meta_data on auth.users
  for each row
  when (new.raw_user_meta_data is distinct from old.raw_user_meta_data)
  execute function public.fill_profile_name_from_meta();
