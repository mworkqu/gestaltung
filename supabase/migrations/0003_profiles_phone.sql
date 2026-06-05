-- ============================================================================
-- Gestaltung — Stage 4 follow-up: store a phone number on each profile
-- ============================================================================
-- Run AFTER 0001_auth_roles_rls.sql. 100% free — no SMS/WhatsApp provider.
-- The phone is collected at sign-up and kept as plain profile data, reserved
-- for later use (a confirmation channel, or an alternative login). We do NOT
-- write auth.users.phone here, because that column drives Supabase's paid
-- phone-auth flows — this is just our own field.
-- ============================================================================

alter table public.profiles add column if not exists phone text;

-- Recreate the sign-up trigger so it also copies the phone from the sign-up
-- metadata into the auto-created profile row. (CREATE OR REPLACE keeps the
-- existing trigger pointing at this updated function.)
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
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
