-- ============================================================================
-- 0085_cc_admin.sql  -  CAD Champions: admin panel (Prompt 11)
-- ============================================================================
-- RUN AFTER 0084 (0084_cc_payments.sql). Needs 0077_cc_core.sql
-- (cc_profiles, cc_audit_log, cc_deletion_requests, helpers cc_is_admin /
-- cc_is_staff, set_updated_at). Safe to re-run.
--
-- What it does
--   1. cc_content_overrides (key, locale, value): admin-edited copy that wins
--      over the message files (Get Ready texts, intro video ids, landing FAQ,
--      glossary definitions). Readable by everyone (it is public copy);
--      admins write. Keys:
--        msg:<file>.<path>              a CC message, e.g. msg:get-ready.welcome.autoNote
--        video:<slot key>               an intro video id ("youtube:<id>" or a Bunny GUID)
--        glossary:<id>.term|definition  a glossary term / definition
--        faq:<id>.hidden                "1" hides a landing FAQ item
--   2. cc_testimonials: landing testimonials (EN + AR). Anyone reads the
--      published ones; the landing shows the section only when >= 1 is
--      published. Admins write.
--   3. cc_announcements + cc_announcement_deliveries: the bilingual
--      announcement email log. One delivery row per recipient (primary key),
--      so a batch that is re-run never emails anyone twice. Admin only.
--   4. cc_anonymise_profile(user, actor, note): service_role only. Approves a
--      deletion request: blanks personal data on cc_profiles, deletes trainer
--      notes, blanks question text and payment proof references, marks the
--      request approved, writes the audit log. Stored files are deleted by
--      the app (storage API) per policy [TODO-MO: retention policy].
--   5. Indexes for the admin insights and the student table.
-- ============================================================================

-- ------------------------------------------------------------ 1. overrides
create table if not exists public.cc_content_overrides (
  key         text not null check (char_length(key) between 3 and 200),
  locale      text not null check (locale in ('en', 'ar')),
  value       text not null check (char_length(value) <= 20000),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (key, locale)
);

drop trigger if exists cc_content_overrides_set_updated_at on public.cc_content_overrides;
create trigger cc_content_overrides_set_updated_at
  before update on public.cc_content_overrides
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ 2. testimonials
create table if not exists public.cc_testimonials (
  id            uuid primary key default gen_random_uuid(),
  quote_en      text not null default '',
  quote_ar      text not null default '',
  name_en       text not null default '',
  name_ar       text not null default '',
  role_en       text,                      -- e.g. "Student, Qatar University"
  role_ar       text,
  sort          integer not null default 0,
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists cc_testimonials_published_idx on public.cc_testimonials (sort) where is_published;

drop trigger if exists cc_testimonials_set_updated_at on public.cc_testimonials;
create trigger cc_testimonials_set_updated_at
  before update on public.cc_testimonials
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ 3. announcements
create table if not exists public.cc_announcements (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'marketing' check (kind in ('marketing', 'essential')),
  subject_en       text not null,
  subject_ar       text not null,
  body_en          text not null,
  body_ar          text not null,
  filters          jsonb not null default '{}'::jsonb,
  status           text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  recipient_count  integer not null default 0,
  sent_count       integer not null default 0,
  failed_count     integer not null default 0,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz
);

create index if not exists cc_announcements_created_idx on public.cc_announcements (created_at desc);

drop trigger if exists cc_announcements_set_updated_at on public.cc_announcements;
create trigger cc_announcements_set_updated_at
  before update on public.cc_announcements
  for each row execute function public.set_updated_at();

create table if not exists public.cc_announcement_deliveries (
  announcement_id  uuid not null references public.cc_announcements (id) on delete cascade,
  user_id          uuid not null references public.cc_profiles (id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error            text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists cc_announcement_deliveries_pending_idx
  on public.cc_announcement_deliveries (announcement_id) where status = 'pending';

-- ------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['cc_content_overrides', 'cc_testimonials', 'cc_announcements', 'cc_announcement_deliveries']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.cc_is_admin()) with check (public.cc_is_admin())',
                   t || '_admin_all', t);
  end loop;
end;
$$;

-- Public copy: everyone (anon too) reads overrides and published testimonials.
grant select on public.cc_content_overrides to anon;
grant select on public.cc_testimonials to anon;

drop policy if exists cc_content_overrides_read on public.cc_content_overrides;
create policy cc_content_overrides_read on public.cc_content_overrides
  for select to anon, authenticated using (true);

drop policy if exists cc_testimonials_read_published on public.cc_testimonials;
create policy cc_testimonials_read_published on public.cc_testimonials
  for select to anon, authenticated using (is_published or public.cc_is_staff());

-- ------------------------------------------------------------ 4. anonymise
create or replace function public.cc_anonymise_profile(p_user uuid, p_actor uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _fields jsonb;
  _req uuid;
begin
  select jsonb_agg(k) into _fields
    from public.cc_profiles p, jsonb_object_keys(to_jsonb(p)) k
   where p.id = p_user;
  if _fields is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.cc_profiles set
    email = null,
    full_name = 'Deleted user',
    full_name_ar = null,
    phone = null,
    institution = null,
    institution_other = null,
    date_of_birth = null,
    guardian_name = null,
    guardian_phone = null,
    marketing_consent = false,
    weekly_progress_email = false
  where id = p_user;

  delete from public.cc_student_notes where student_id = p_user;
  update public.cc_lesson_questions set body = '[deleted]', image_path = null where user_id = p_user;
  update public.cc_payments set payer_name = null, proof_storage_path = null, raw_payload = null where user_id = p_user;

  update public.cc_deletion_requests
     set status = 'approved', processed_by = p_actor, processed_at = now(), admin_note = coalesce(p_note, admin_note)
   where user_id = p_user and status = 'pending'
  returning id into _req;

  insert into public.cc_audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (p_actor, 'account.anonymise', 'cc_profiles', p_user::text,
          jsonb_build_object('fields_cleared', _fields),
          jsonb_build_object('request_id', _req));

  return jsonb_build_object('ok', true, 'request_id', _req);
end;
$$;

revoke all on function public.cc_anonymise_profile(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cc_anonymise_profile(uuid, uuid, text) to service_role;

-- ------------------------------------------------------------ 5. indexes
create index if not exists cc_profiles_created_idx on public.cc_profiles (created_at desc);
create index if not exists cc_profiles_last_active_idx on public.cc_profiles (last_active_at desc nulls last);
create index if not exists cc_profiles_institution_idx on public.cc_profiles (institution);
create index if not exists cc_journey_progress_created_idx on public.cc_journey_progress (created_at);
create index if not exists cc_attempts_submitted_idx on public.cc_attempts (submitted_at desc) where submitted_at is not null;
create index if not exists cc_attempts_test_status_idx on public.cc_attempts (test_id, status);
create index if not exists cc_grading_logs_kind_created_idx on public.cc_grading_logs (kind, created_at desc);
create index if not exists cc_help_searches_zero_idx on public.cc_help_searches (created_at desc) where results_count = 0;
create index if not exists cc_deletion_requests_status_idx on public.cc_deletion_requests (status, created_at);
create index if not exists cc_student_notes_student_idx on public.cc_student_notes (student_id, created_at desc);
