-- ============================================================================
-- 0077_cc_core.sql  -  CAD Champions: core schema, helpers, RLS, seeds
-- ============================================================================
-- RUN AFTER 0076 (0076_social_sign_in_profiles.sql). Then run 0078_cc_storage.sql.
--
-- What it does
--   * Creates every CAD Champions table (all prefixed cc_): profiles, journey,
--     Get Ready, skill areas (seeded), competition modules M1-M4 (seeded),
--     tests/tasks/aspects/attempts/submissions/results/aspect results,
--     grading logs, help articles, and the "create now, fill later" tables for
--     training (courses..lesson questions), payments (plans, coupons, cohorts,
--     enrollments, payments), audit log, deletion requests, integrity flags,
--     trainer notes, level unlocks and certificates.
--   * Helpers (SECURITY DEFINER, search_path ''):
--       public.cc_current_role()  -> 'admin' | 'instructor' | 'student' | null
--       public.cc_is_staff()      -> admin or instructor
--       public.cc_is_admin()      -> admin (site super_admins are admin automatically)
--       public.cc_is_minor(date)  -> under 18 today (Asia/Qatar)
--       public.cc_has_active_enrollment(uuid)
--   * Turns RLS ON for every cc_ table with explicit policies.
--   * Hides answers: students can NOT select cc_test_tasks or cc_exercises at
--     all (select policy is staff-only). They read the views
--     public.cc_test_tasks_public / public.cc_exercises_public, which omit
--     reference_data, rubric, tolerances (and, for exercises, hints and the
--     solution video). Marking aspects are read through
--     public.cc_task_aspects_public (partial_rule hidden).
--   * Competition alignment (docs/COMPETITION_ALIGNMENT.md, Update 1): three
--     training tracks (inventor default, fusion, solidworks), competition
--     modules M1-M4, marking aspects (measurement / judgement 0-3), per_task vs
--     module_package uploads, in-person attempts with phase markers.
--
-- It does NOT touch public.profiles, its role constraint, its RLS or the
-- auth.users triggers. A cc_profiles row is created by the app (server action
-- with the user's session) at CC sign-up, never by an auth.users trigger, so
-- main-site users do not get CC profiles.
--
-- Safe to re-run: create table/index if not exists, create or replace
-- function/view, drop trigger/policy if exists, seeds use on conflict.
-- (Column changes after a first run need a new migration.)
--
-- Make yourself a CC admin (one line; run in the Supabase SQL editor):
--   update public.cc_profiles set role = 'admin' where email = 'you@example.com';
-- Site super_admins (public.profiles.role = 'super_admin') are CC admins
-- automatically through cc_current_role(); they still need a cc_profiles row
-- only if they also want to use the student side.
--
-- Rollback (comments; destroys CC data):
--   drop table if exists public.cc_profiles cascade;  -- and every other cc_ table
--   drop function if exists public.cc_current_role(), public.cc_is_staff(),
--     public.cc_is_admin(), public.cc_is_minor(date),
--     public.cc_has_active_enrollment(uuid);
-- ============================================================================

-- updated_at helper (already created by 0004; repeated so this file stands alone)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. Profiles and journey
-- ============================================================================

create table if not exists public.cc_profiles (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    text,
  full_name                text,
  full_name_ar             text,
  phone                    text,                     -- E.164, e.g. +97455551234
  institution              text,                     -- key from the app's list, or 'other'
  institution_other        text,                     -- free text when institution = 'other'
  study_level              text check (study_level in ('secondary', 'diploma', 'bachelor', 'graduate', 'working')),
  date_of_birth            date,
  is_minor                 boolean not null default false,   -- maintained by trigger from date_of_birth
  guardian_name            text,
  guardian_phone           text,
  guardian_consent         boolean not null default false,
  guardian_consent_at      timestamptz,              -- maintained by trigger
  cad_software_used        text check (cad_software_used in ('inventor', 'fusion', 'solidworks', 'other', 'none')),
  track_software           text default 'inventor' check (track_software in ('inventor', 'fusion', 'solidworks')),  -- Inventor = competition software
  cad_experience           text check (cad_experience in ('none', 'lt_6m', '6_24m', 'gt_2y')),
  has_windows_pc           text check (has_windows_pc in ('yes', 'mac_only', 'no_computer')),
  preferred_locale         text not null default 'en' check (preferred_locale in ('en', 'ar')),
  role                     text not null default 'student' check (role in ('student', 'instructor', 'admin')),
  marketing_consent        boolean not null default false,
  weekly_progress_email    boolean not null default true,
  onboarding_step          smallint not null default 0 check (onboarding_step between 0 and 10),
  onboarding_completed_at  timestamptz,
  get_ready_bypass         boolean not null default false,   -- admin-only (Prompt 4 Step C)
  deletion_requested_at    timestamptz,              -- set by trigger on cc_deletion_requests
  last_active_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists cc_profiles_email_idx on public.cc_profiles (lower(email));
create index if not exists cc_profiles_role_idx on public.cc_profiles (role) where role <> 'student';

-- Role helpers. SECURITY DEFINER so policies on cc_profiles can call them
-- without recursing into cc_profiles' own policies.
create or replace function public.cc_current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_super_admin() then 'admin'
    else (select p.role from public.cc_profiles p where p.id = auth.uid())
  end;
$$;

create or replace function public.cc_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.cc_current_role() in ('admin', 'instructor'), false);
$$;

create or replace function public.cc_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.cc_current_role() = 'admin', false);
$$;

-- Under 18 today in Qatar. is_minor on the row is a snapshot taken at the last
-- write; use cc_is_minor(date_of_birth) for a live answer.
create or replace function public.cc_is_minor(p_dob date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_dob is not null
     and p_dob > ((now() at time zone 'Asia/Qatar')::date - interval '18 years');
$$;

-- Guard: non-admin callers (the student's own session) cannot change role or
-- admin-controlled columns; is_minor and guardian_consent_at are derived.
-- SECURITY INVOKER on purpose: current_user is the caller's DB role
-- ('authenticated'/'anon'); service_role / postgres / definer functions pass.
create or replace function public.cc_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_privileged boolean := current_user not in ('authenticated', 'anon') or public.cc_is_admin();
begin
  new.is_minor := public.cc_is_minor(new.date_of_birth);

  if tg_op = 'INSERT' then
    if not v_privileged then
      if new.role is distinct from 'student' then
        raise exception 'cc_profiles: new accounts are students' using errcode = '42501';
      end if;
      new.get_ready_bypass := false;
      new.deletion_requested_at := null;
      new.created_at := now();
    end if;
    new.guardian_consent_at := case
      when not new.guardian_consent then null
      when v_privileged then coalesce(new.guardian_consent_at, now())
      else now()
    end;
  else
    if not v_privileged then
      if new.role is distinct from old.role then
        raise exception 'cc_profiles.role can only be changed by an admin' using errcode = '42501';
      end if;
      if new.id is distinct from old.id
         or new.get_ready_bypass is distinct from old.get_ready_bypass
         or new.deletion_requested_at is distinct from old.deletion_requested_at
         or new.created_at is distinct from old.created_at then
        raise exception 'cc_profiles: this field is managed by CAD Champions staff' using errcode = '42501';
      end if;
    end if;
    if new.guardian_consent and not coalesce(old.guardian_consent, false) then
      new.guardian_consent_at := now();
    elsif not new.guardian_consent then
      new.guardian_consent_at := null;
    elsif not v_privileged then
      new.guardian_consent_at := old.guardian_consent_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cc_profiles_guard on public.cc_profiles;
create trigger cc_profiles_guard
  before insert or update on public.cc_profiles
  for each row execute function public.cc_profiles_guard();

drop trigger if exists cc_profiles_set_updated_at on public.cc_profiles;
create trigger cc_profiles_set_updated_at
  before update on public.cc_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.cc_journey_progress (
  user_id                    uuid primary key references public.cc_profiles (id) on delete cascade,
  profile_completed_at       timestamptz,
  get_ready_completed_at     timestamptz,
  practice_passed_at         timestamptz,
  first_test_submitted_at    timestamptz,
  results_viewed_at          timestamptz,
  sample_lesson_watched_at   timestamptz,
  enrolled_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

drop trigger if exists cc_journey_progress_set_updated_at on public.cc_journey_progress;
create trigger cc_journey_progress_set_updated_at
  before update on public.cc_journey_progress
  for each row execute function public.set_updated_at();

-- A journey row is created with every profile.
create or replace function public.cc_create_journey_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cc_journey_progress (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists cc_profiles_create_journey on public.cc_profiles;
create trigger cc_profiles_create_journey
  after insert on public.cc_profiles
  for each row execute function public.cc_create_journey_row();

create table if not exists public.cc_get_ready_steps (
  user_id       uuid not null references public.cc_profiles (id) on delete cascade,
  step_key      text not null check (step_key ~ '^[a-z0-9_]{1,64}$'),
  completed_at  timestamptz not null default now(),
  primary key (user_id, step_key)
);

-- ============================================================================
-- 2. Skill areas (seeded)
-- ============================================================================

create table if not exists public.cc_skill_areas (
  id              smallint primary key check (id between 1 and 6),  -- = code
  code            smallint not null unique check (code between 1 and 6),
  slug            text not null unique,
  name_en         text not null,
  name_ar         text not null,
  weight_percent  numeric(5, 2) not null check (weight_percent >= 0 and weight_percent <= 100),
  description_en  text not null,
  description_ar  text not null
);

insert into public.cc_skill_areas (id, code, slug, name_en, name_ar, weight_percent, description_en, description_ar) values
  (1, 1, 'work_organization', 'Work organization and standards', 'تنظيم العمل والمعايير', 10,
   'How you plan your time, name and organise your files, and follow the rules of each task. Good organisation means nothing is lost or late, and your work meets the standards the judges expect.',
   'كيف تخطط لوقتك، وتسمّي ملفاتك وترتّبها، وتلتزم بتعليمات كل مهمة. التنظيم الجيد يعني ألا يضيع شيء أو يتأخر، وأن يطابق عملك المعايير التي يتوقعها الحكّام.'),
  (2, 2, 'software_hardware', 'Software and hardware', 'البرمجيات والأجهزة', 5,
   'How well you know your CAD software and your computer: settings, units, file formats and exporting. These skills stop technical problems from slowing you down on test day.',
   'مدى معرفتك ببرنامج التصميم وبجهاز الحاسوب: الإعدادات والوحدات وصيغ الملفات والتصدير. هذه المهارات تمنع المشكلات التقنية من تعطيلك يوم الاختبار.'),
  (3, 3, '3d_modelling', '3D modelling', 'النمذجة ثلاثية الأبعاد', 30,
   'Building accurate 3D parts and assemblies from drawings, using features such as extrudes, holes, fillets and patterns. It carries the most marks, so precise models matter a lot.',
   'بناء قطع وتجميعات ثلاثية الأبعاد دقيقة من الرسومات، باستخدام أدوات مثل البثق والثقوب وتدوير الحواف والأنماط. لهذا الجزء أكبر نصيب من الدرجات، لذلك تهمّ دقة النموذج كثيرًا.'),
  (4, 4, 'rendering_animation', 'Rendering and animation', 'الإظهار والتحريك', 10,
   'Turning your models into realistic images and short animations that show how a product looks and moves. Good renders explain a design clearly to people who do not read drawings.',
   'تحويل نماذجك إلى صور واقعية ومقاطع تحريك قصيرة توضّح شكل المنتج وطريقة حركته. الإظهار الجيد يشرح التصميم بوضوح لمن لا يقرأ الرسومات الهندسية.'),
  (5, 5, 'reverse_engineering', 'Reverse engineering', 'الهندسة العكسية', 15,
   'Measuring a real object with tools such as callipers and rebuilding it as an accurate 3D model. You learn to take careful measurements and turn them into a model that could be manufactured.',
   'قياس قطعة حقيقية بأدوات مثل القدمة ذات الورنية، ثم إعادة بنائها كنموذج ثلاثي الأبعاد دقيق. تتعلّم أخذ قياسات دقيقة وتحويلها إلى نموذج يمكن تصنيعه.'),
  (6, 6, 'technical_drawing', 'Technical drawing (ISO, first-angle, GD&T)', 'الرسم الفني (ISO، الإسقاط الأول، GD&T)', 30,
   'Creating clear engineering drawings that follow ISO rules, with first-angle views, dimensions, tolerances and GD&T. A good drawing lets anyone make the part exactly as you intended.',
   'إعداد رسومات هندسية واضحة تتبع قواعد ISO، بمساقط بطريقة الإسقاط الأول وأبعاد وتفاوتات ورموز GD&T. الرسم الجيد يتيح لأي شخص تصنيع القطعة تمامًا كما أردت.')
on conflict (id) do nothing;

-- ============================================================================
-- 2b. Competition modules (seeded). Paraphrased summaries; never copy the
--     Technical Description text.
-- ============================================================================

create table if not exists public.cc_competition_modules (
  code             text primary key check (code in ('M1', 'M2', 'M3', 'M4')),
  position         smallint not null,
  name_en          text not null,
  name_ar          text not null,
  hours            numeric(4, 1) not null check (hours > 0),
  summary_en       text not null,
  summary_ar       text not null,
  given_en         text,
  given_ar         text,
  deliverables_en  text,
  deliverables_ar  text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

insert into public.cc_competition_modules
  (code, position, name_en, name_ar, hours, summary_en, summary_ar, given_en, given_ar, deliverables_en, deliverables_ar) values
  ('M1', 1, 'Mechanical fabrication', 'التصنيع الميكانيكي', 6,
   'You build sheet metal parts, welded frames and bolted assemblies, then prepare the drawings a workshop needs to make them. The day ends with a short exploded animation of the assembly.',
   'تبني قطعًا من الصفائح المعدنية وهياكل ملحومة وتجميعات بالبراغي، ثم تُعدّ الرسومات التي تحتاجها الورشة لتصنيعها. ويُختتم اليوم بمقطع تحريك قصير يُظهر التجميع مفككًا.',
   'Component drawings, 3D models and a parts list.',
   'رسومات القطع ونماذج ثلاثية الأبعاد وقائمة القطع.',
   'Part and assembly files, assembly and detail drawings, parts list, animation.',
   'ملفات القطع والتجميعات، ورسومات التجميع والتفاصيل، وقائمة القطع، ومقطع التحريك.'),
  ('M2', 2, 'Mechanical design challenge', 'تحدي التصميم الميكانيكي', 6,
   'You receive an existing assembly and a design brief, and change the design so it does the new job. You show your solution with drawings, renders and a motion simulation, and some parts may be 3D printed.',
   'تستلم تجميعًا جاهزًا وموجز تصميم، وتعدّل التصميم ليؤدي المهمة الجديدة. تعرض حلّك برسومات وصور واقعية ومحاكاة للحركة، وقد تُطبع بعض القطع بالطباعة ثلاثية الأبعاد.',
   'Existing 3D assemblies, a layout, a specification of the change and a design brief.',
   'تجميعات ثلاثية الأبعاد جاهزة، ومخطط، ومواصفات التعديل، وموجز التصميم.',
   'Modified files, assembly drawing, animations, renders, parts list, printable parts.',
   'الملفات المعدّلة، ورسم التجميع، ومقاطع التحريك، والصور الواقعية، وقائمة القطع، والقطع القابلة للطباعة.'),
  ('M3', 3, 'Assemblies and detail drawings for manufacture', 'التجميعات ورسومات التفاصيل للتصنيع', 6,
   'You model parts quickly and accurately from detail drawings and put them together into an assembly with standard parts. Then you produce clear drawings that are ready for manufacture.',
   'تنمذج القطع بسرعة ودقة من رسومات التفاصيل، وتجمعها في تجميع واحد مع قطع قياسية. ثم تُعدّ رسومات واضحة جاهزة للتصنيع.',
   'Drawings, 3D models and a parts list.',
   'رسومات ونماذج ثلاثية الأبعاد وقائمة القطع.',
   'Part and assembly files, assembly and detail drawings, parts list, exploded views, simulation.',
   'ملفات القطع والتجميعات، ورسومات التجميع والتفاصيل، وقائمة القطع، والمساقط المفككة، والمحاكاة.'),
  ('M4', 4, 'Reverse engineering', 'الهندسة العكسية', 4,
   'You measure a real part with hand instruments and sketch it on paper, then rebuild it as an accurate 3D model with drawings. The part is taken away after two hours, so you finish from your own sketches.',
   'تقيس قطعة حقيقية بأدوات قياس يدوية وترسمها على الورق، ثم تعيد بناءها كنموذج ثلاثي الأبعاد دقيق مع الرسومات. تُسحب القطعة بعد ساعتين، فتُكمل العمل من رسوماتك.',
   'A physical part or assembly and some files.',
   'قطعة أو تجميع حقيقي وبعض الملفات.',
   '3D models with 3D annotation, manufacturing drawings, volume figures, renders.',
   'نماذج ثلاثية الأبعاد مع التوصيف ثلاثي الأبعاد، ورسومات التصنيع، وأرقام الحجم، والصور الواقعية.')
on conflict (code) do nothing;

drop trigger if exists cc_competition_modules_set_updated_at on public.cc_competition_modules;
create trigger cc_competition_modules_set_updated_at
  before update on public.cc_competition_modules
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. Tests, tasks, attempts, submissions, results
-- ============================================================================

create table if not exists public.cc_tests (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  title_en              text not null,
  title_ar              text not null,
  type                  text not null check (type in ('practice', 'diagnostic', 'exercise', 'mock', 'qualifier')),
  time_limit_minutes    integer check (time_limit_minutes is null or time_limit_minutes > 0),  -- null = untimed
  grace_seconds         integer not null default 60 check (grace_seconds >= 0),
  is_published          boolean not null default false,
  admin_only            boolean not null default false,   -- e.g. diagnostic-timeout-check
  intro_en              text,
  intro_ar              text,
  rules_en              text,
  rules_ar              text,
  retake_cooldown_days  integer not null default 0 check (retake_cooldown_days >= 0),
  upload_mode           text not null default 'per_task' check (upload_mode in ('per_task', 'module_package')),
  -- module_package: expected files per task, e.g. {"<task_id>": ["Parts and Assemblies/Part_03.*"]}
  package_expectations  jsonb not null default '{}'::jsonb,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists cc_tests_set_updated_at on public.cc_tests;
create trigger cc_tests_set_updated_at
  before update on public.cc_tests
  for each row execute function public.set_updated_at();

create table if not exists public.cc_test_tasks (
  id                uuid primary key default gen_random_uuid(),
  test_id           uuid not null references public.cc_tests (id) on delete cascade,
  position          integer not null default 0,           -- "order" in the plan
  skill_area_id     smallint not null references public.cc_skill_areas (id),
  competition_module text references public.cc_competition_modules (code),
  title_en          text not null,
  title_ar          text not null,
  brief_en          text,                                  -- markdown
  brief_ar          text,
  attachments       jsonb not null default '[]'::jsonb,    -- [{path, label_en, label_ar, kind}] in bucket cc-task-files
  expected_upload   text not null check (expected_upload in ('step', 'pdf', 'image', 'video', 'none')),
  max_points        numeric(8, 2) not null default 0 check (max_points >= 0),
  grading_mode      text not null check (grading_mode in ('auto_step', 'ai_drawing', 'manual')),
  grader_mode       text check (grader_mode in ('part', 'assembly', 'practice')),
  reference_data    jsonb,     -- ANSWERS: staff only
  rubric            jsonb,     -- ANSWERS: staff only
  tolerances        jsonb,     -- staff only
  density_kg_m3     numeric(10, 3),
  material_name_en  text,
  material_name_ar  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists cc_test_tasks_test_idx on public.cc_test_tasks (test_id, position);

drop trigger if exists cc_test_tasks_set_updated_at on public.cc_test_tasks;
create trigger cc_test_tasks_set_updated_at
  before update on public.cc_test_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.cc_attempts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.cc_profiles (id) on delete cascade,
  test_id            uuid not null references public.cc_tests (id) on delete restrict,
  started_at         timestamptz not null default now(),
  deadline_at        timestamptz,                      -- null = untimed
  submitted_at       timestamptz,
  submit_reason      text check (submit_reason in ('manual', 'timeout', 'admin')),
  status             text not null default 'in_progress'
                       check (status in ('in_progress', 'submitted', 'grading', 'provisional', 'graded', 'expired')),
  total_score        numeric(8, 2),
  max_score          numeric(8, 2),
  percent            numeric(5, 2),
  band               text check (band in ('beginner', 'developing', 'competitive', 'competition_ready')),
  graded_at          timestamptz,
  start_ip           text,
  start_user_agent   text,
  submit_ip          text,
  submit_user_agent  text,
  share_enabled      boolean not null default false,
  share_token        text unique,
  in_person          boolean not null default false,   -- admin-only flag: trainer-run studio session
  session_id         uuid,                             -- future cc_sessions (group session)
  phase_markers      jsonb not null default '[]'::jsonb,  -- [{"key": "part_collected", "at": "..."}]
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cc_attempts_user_idx on public.cc_attempts (user_id, test_id, started_at desc);
-- Only one active attempt per test per student.
create unique index if not exists cc_attempts_one_active_idx
  on public.cc_attempts (user_id, test_id) where status = 'in_progress';

drop trigger if exists cc_attempts_set_updated_at on public.cc_attempts;
create trigger cc_attempts_set_updated_at
  before update on public.cc_attempts
  for each row execute function public.set_updated_at();

create table if not exists public.cc_submissions (
  id              uuid primary key default gen_random_uuid(),
  attempt_id      uuid not null references public.cc_attempts (id) on delete cascade,
  task_id         uuid references public.cc_test_tasks (id) on delete restrict,  -- null = module_package ZIP
  user_id         uuid not null references public.cc_profiles (id) on delete cascade,
  storage_path    text not null,     -- cc-submissions/{user_id}/{attempt_id}/{task_id|package}/{ts}_{name}
  file_name       text not null,
  file_size       bigint not null check (file_size >= 0),
  mime_type       text,
  sha256          text check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_at     timestamptz not null default now(),
  replaced_count  integer not null default 0 check (replaced_count >= 0),
  package_manifest jsonb,            -- module_package: folders/files found, per-task matches, warnings
  unique (attempt_id, task_id)
);

-- One package ZIP per attempt (task_id is null for it).
create unique index if not exists cc_submissions_one_package_idx
  on public.cc_submissions (attempt_id) where task_id is null;

create index if not exists cc_submissions_user_idx on public.cc_submissions (user_id);
create index if not exists cc_submissions_sha_idx on public.cc_submissions (task_id, sha256);

create table if not exists public.cc_task_results (
  id                   uuid primary key default gen_random_uuid(),
  submission_id        uuid references public.cc_submissions (id) on delete cascade,  -- null = nothing uploaded
  attempt_id           uuid not null references public.cc_attempts (id) on delete cascade,
  task_id              uuid not null references public.cc_test_tasks (id) on delete restrict,
  user_id              uuid not null references public.cc_profiles (id) on delete cascade,
  auto_score           numeric(8, 2),
  ai_score             numeric(8, 2),
  manual_score         numeric(8, 2),
  final_score          numeric(8, 2),
  max_points           numeric(8, 2),
  status               text not null default 'pending'
                         check (status in ('pending', 'auto', 'ai_pending_review', 'final', 'error')),
  needs_manual_review  boolean not null default false,
  error_code           text,
  help_slug            text,
  feedback_en          text,
  feedback_ar          text,
  details              jsonb,   -- STUDENT-SAFE ONLY (check names, pass/fail, rubric item status). Raw grader output goes to cc_grading_logs.response.
  reviewer_comment_en  text,
  reviewer_comment_ar  text,
  graded_by            uuid references auth.users (id) on delete set null,
  graded_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (attempt_id, task_id)
);

create index if not exists cc_task_results_review_idx
  on public.cc_task_results (status, created_at) where status in ('ai_pending_review', 'error');

drop trigger if exists cc_task_results_set_updated_at on public.cc_task_results;
create trigger cc_task_results_set_updated_at
  before update on public.cc_task_results
  for each row execute function public.set_updated_at();

create table if not exists public.cc_skill_scores (
  attempt_id     uuid not null references public.cc_attempts (id) on delete cascade,
  skill_area_id  smallint not null references public.cc_skill_areas (id),
  user_id        uuid not null references public.cc_profiles (id) on delete cascade,
  earned_points  numeric(8, 2),
  max_points     numeric(8, 2),
  percent        numeric(5, 2),
  level          smallint check (level between 1 and 6),
  assessed       boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (attempt_id, skill_area_id)
);

create table if not exists public.cc_grading_logs (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('step', 'ai_drawing', 'ai_translate')),
  submission_id        uuid references public.cc_submissions (id) on delete set null,
  exercise_attempt_id  uuid,      -- FK added below (table created later)
  task_result_id       uuid references public.cc_task_results (id) on delete set null,
  model                text,
  duration_ms          integer,
  tokens_in            integer,
  tokens_out           integer,
  cost_estimate        numeric(10, 4),  -- USD
  error                text,
  error_code           text,
  response             jsonb,     -- raw grader / AI output incl. measured values: staff only
  created_at           timestamptz not null default now()
);

create index if not exists cc_grading_logs_created_idx on public.cc_grading_logs (created_at desc);

create table if not exists public.cc_integrity_flags (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.cc_attempts (id) on delete cascade,
  task_id      uuid references public.cc_test_tasks (id) on delete set null,
  user_id      uuid references public.cc_profiles (id) on delete cascade,
  kind         text not null check (kind in ('duplicate_sha256', 'too_fast', 'ip_change', 'other')),
  details      jsonb not null default '{}'::jsonb,
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists cc_integrity_flags_open_idx on public.cc_integrity_flags (created_at) where resolved_at is null;

-- ============================================================================
-- 4. Help Center
-- ============================================================================

create table if not exists public.cc_help_articles (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique check (slug ~ '^[a-z0-9-]{1,120}$'),
  category                text not null,   -- getting_started | files_export | the_test | training_payment | account
  title_en                text not null,
  title_ar                text not null,
  body_en                 text not null default '',   -- markdown
  body_ar                 text not null default '',
  related_glossary_terms  text[] not null default '{}',
  related_slugs           text[] not null default '{}',
  video_id                text,
  sort                    integer not null default 0,
  is_published            boolean not null default false,
  helpful_yes             integer not null default 0 check (helpful_yes >= 0),
  helpful_no              integer not null default 0 check (helpful_no >= 0),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists cc_help_articles_set_updated_at on public.cc_help_articles;
create trigger cc_help_articles_set_updated_at
  before update on public.cc_help_articles
  for each row execute function public.set_updated_at();

-- Search log (Prompt 11 "most-searched terms with no results"). Written by the server.
create table if not exists public.cc_help_searches (
  id             uuid primary key default gen_random_uuid(),
  query          text not null,
  locale         text not null check (locale in ('en', 'ar')),
  results_count  integer not null default 0,
  user_id        uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- "Was this helpful?" counter. Called by the server route (rate-limited) with
-- the service role; not granted to anon/authenticated.
create or replace function public.cc_help_feedback(p_slug text, p_helpful boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.cc_help_articles
     set helpful_yes = helpful_yes + case when p_helpful then 1 else 0 end,
         helpful_no  = helpful_no  + case when p_helpful then 0 else 1 end
   where slug = p_slug and is_published;
$$;

-- ============================================================================
-- 5. Training (create now, filled by Prompt 9)
-- ============================================================================

create table if not exists public.cc_courses (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title_en        text not null,
  title_ar        text not null,
  description_en  text,
  description_ar  text,
  sort            integer not null default 0,
  is_published    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.cc_modules (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references public.cc_courses (id) on delete cascade,
  skill_area_id      smallint references public.cc_skill_areas (id),   -- null = orientation (module 0)
  slug               text not null,
  title_en           text not null,
  title_ar           text not null,
  description_en     text,
  description_ar     text,
  why_it_matters_en  text,
  why_it_matters_ar  text,
  icon               text,
  is_orientation     boolean not null default false,
  sort               integer not null default 0,
  is_published       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (course_id, slug)
);

create table if not exists public.cc_levels (
  id            uuid primary key default gen_random_uuid(),
  module_id     uuid not null references public.cc_modules (id) on delete cascade,
  level_number  smallint not null check (level_number between 0 and 6),
  title_en      text not null,
  title_ar      text not null,
  goal_en       text,      -- "By the end of this level you can..."
  goal_ar       text,
  unlock_rule   jsonb not null default '{"type": "previous_level_passed", "pass_mark": 80}'::jsonb,
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (module_id, level_number)
);

create table if not exists public.cc_lessons (
  id                     uuid primary key default gen_random_uuid(),
  level_id               uuid not null references public.cc_levels (id) on delete cascade,
  competition_module     text references public.cc_competition_modules (code),
  slug                   text not null unique,
  sort                   integer not null default 0,
  title_en               text not null,
  title_ar               text not null,
  objectives_en          text[] not null default '{}',
  objectives_ar          text[] not null default '{}',
  duration_minutes       integer,
  video_inventor_en      text,     -- Bunny video IDs
  video_inventor_ar      text,
  video_fusion_en        text,
  video_fusion_ar        text,
  video_solidworks_en    text,
  video_solidworks_ar    text,
  video_neutral_en       text,     -- software-neutral lessons (one shared pair)
  video_neutral_ar       text,
  notes_en               text,     -- markdown
  notes_ar               text,
  common_mistakes_en     text,
  common_mistakes_ar     text,
  downloads              jsonb not null default '[]'::jsonb,   -- [{path, label_en, label_ar}] in cc-lesson-files
  glossary_terms         text[] not null default '{}',
  is_free_preview        boolean not null default false,
  is_published           boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists cc_lessons_level_idx on public.cc_lessons (level_id, sort);

create table if not exists public.cc_exercises (
  id                 uuid primary key default gen_random_uuid(),
  level_id           uuid not null references public.cc_levels (id) on delete cascade,
  slug               text not null unique,
  sort               integer not null default 0,
  skill_area_id      smallint references public.cc_skill_areas (id),
  competition_module text references public.cc_competition_modules (code),
  title_en           text not null,
  title_ar           text not null,
  brief_en           text,
  brief_ar           text,
  attachments        jsonb not null default '[]'::jsonb,
  expected_upload    text not null default 'step' check (expected_upload in ('step', 'pdf', 'image', 'video', 'none')),
  grading_mode       text not null default 'auto_step' check (grading_mode in ('auto_step', 'ai_drawing', 'manual')),
  grader_mode        text check (grader_mode in ('part', 'assembly', 'practice')),
  reference_data     jsonb,     -- ANSWERS: staff only
  rubric             jsonb,     -- ANSWERS: staff only
  tolerances         jsonb,
  density_kg_m3      numeric(10, 3),
  material_name_en   text,
  material_name_ar   text,
  max_points         numeric(8, 2) not null default 100,
  estimated_minutes  integer,
  pass_mark          numeric(5, 2) not null default 80,
  hints_en           text[] not null default '{}',   -- revealed one per failed attempt (server)
  hints_ar           text[] not null default '{}',
  solution_video_id  text,                           -- unlocks after pass or 5 attempts (server)
  is_free_sample     boolean not null default false, -- usable without enrollment (3D modelling L1)
  test_id            uuid references public.cc_tests (id) on delete set null,  -- L6 timed mini-project
  is_published       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cc_exercises_level_idx on public.cc_exercises (level_id, sort);

create table if not exists public.cc_exercise_attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.cc_profiles (id) on delete cascade,
  exercise_id    uuid not null references public.cc_exercises (id) on delete cascade,
  storage_path   text,
  file_name      text,
  file_size      bigint,
  sha256         text,
  status         text not null default 'pending'
                   check (status in ('pending', 'auto', 'ai_pending_review', 'final', 'error')),
  score          numeric(8, 2),
  percent        numeric(5, 2),
  passed         boolean,
  error_code     text,
  help_slug      text,
  feedback_en    text,
  feedback_ar    text,
  details        jsonb,       -- student-safe only
  graded_at      timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists cc_exercise_attempts_user_idx on public.cc_exercise_attempts (user_id, exercise_id, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cc_grading_logs_exercise_attempt_fk') then
    alter table public.cc_grading_logs
      add constraint cc_grading_logs_exercise_attempt_fk
      foreign key (exercise_attempt_id) references public.cc_exercise_attempts (id) on delete set null;
  end if;
end;
$$;

-- Marking aspects (COMPETITION_ALIGNMENT section D). Each belongs to exactly
-- one test task OR one exercise. Measurement = all-or-nothing unless
-- partial_rule says otherwise; judgement = trainer score 0-3,
-- points = max_points x score / 3.
create table if not exists public.cc_task_aspects (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid references public.cc_test_tasks (id) on delete cascade,
  exercise_id         uuid references public.cc_exercises (id) on delete cascade,
  position            integer not null default 0,
  description_en      text not null,
  description_ar      text not null,
  skill_area_id       smallint not null references public.cc_skill_areas (id),
  competition_module  text references public.cc_competition_modules (code),
  type                text not null check (type in ('measurement', 'judgement')),
  max_points          numeric(8, 2) not null check (max_points >= 0),
  method              text not null check (method in ('auto_step', 'ai_drawing', 'trainer')),
  partial_rule        jsonb,    -- null = all-or-nothing; staff only
  check_key           text,     -- 'volume' | 'area' | 'inertia' | 'solids' | 'rubric:<item>'
  student_hint_en     text,
  student_hint_ar     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint cc_task_aspects_one_parent check (num_nonnulls(task_id, exercise_id) = 1)
);

create index if not exists cc_task_aspects_task_idx on public.cc_task_aspects (task_id, position) where task_id is not null;
create index if not exists cc_task_aspects_exercise_idx on public.cc_task_aspects (exercise_id, position) where exercise_id is not null;

-- Result per aspect for a test task result OR an exercise attempt.
create table if not exists public.cc_aspect_results (
  id                   uuid primary key default gen_random_uuid(),
  task_result_id       uuid references public.cc_task_results (id) on delete cascade,
  exercise_attempt_id  uuid references public.cc_exercise_attempts (id) on delete cascade,
  aspect_id            uuid not null references public.cc_task_aspects (id) on delete cascade,
  user_id              uuid not null references public.cc_profiles (id) on delete cascade,
  passed               boolean,                                           -- measurement
  judgement_score      smallint check (judgement_score between 0 and 3),  -- judgement
  points_awarded       numeric(8, 2) not null default 0 check (points_awarded >= 0),
  feedback_en          text,
  feedback_ar          text,
  graded_by            uuid references auth.users (id) on delete set null,
  graded_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint cc_aspect_results_one_parent check (num_nonnulls(task_result_id, exercise_attempt_id) = 1)
);

create unique index if not exists cc_aspect_results_task_idx
  on public.cc_aspect_results (task_result_id, aspect_id) where task_result_id is not null;
create unique index if not exists cc_aspect_results_exercise_idx
  on public.cc_aspect_results (exercise_attempt_id, aspect_id) where exercise_attempt_id is not null;

create table if not exists public.cc_lesson_progress (
  user_id          uuid not null references public.cc_profiles (id) on delete cascade,
  lesson_id        uuid not null references public.cc_lessons (id) on delete cascade,
  last_second      integer not null default 0 check (last_second >= 0),
  watched_percent  numeric(5, 2) not null default 0 check (watched_percent between 0 and 100),
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists public.cc_lesson_questions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.cc_profiles (id) on delete cascade,
  kind            text not null check (kind in ('lesson', 'grade_query')),
  lesson_id       uuid references public.cc_lessons (id) on delete set null,
  attempt_id      uuid references public.cc_attempts (id) on delete set null,
  task_result_id  uuid references public.cc_task_results (id) on delete set null,
  body            text not null check (length(body) between 1 and 4000),
  image_path      text,      -- in cc-submissions/{user_id}/questions/...
  locale          text not null default 'en' check (locale in ('en', 'ar')),
  status          text not null default 'open' check (status in ('open', 'answered')),
  answer          text,
  answered_by     uuid references auth.users (id) on delete set null,
  answered_at     timestamptz,
  public          boolean not null default false,   -- "Show to everyone" (lesson FAQ)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cc_lesson_questions_status_idx on public.cc_lesson_questions (status, created_at);
create index if not exists cc_lesson_questions_lesson_idx on public.cc_lesson_questions (lesson_id) where public;

create table if not exists public.cc_level_unlocks (
  user_id      uuid not null references public.cc_profiles (id) on delete cascade,
  level_id     uuid not null references public.cc_levels (id) on delete cascade,
  unlocked_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (user_id, level_id)
);

create table if not exists public.cc_certificates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.cc_profiles (id) on delete cascade,
  module_id  uuid not null references public.cc_modules (id) on delete restrict,
  code       text not null unique,      -- /verify/[code]
  pdf_path   text,
  issued_at  timestamptz not null default now(),
  unique (user_id, module_id)
);

-- ============================================================================
-- 6. Plans, coupons, cohorts, enrollments, payments (filled by Prompt 10)
-- ============================================================================

create table if not exists public.cc_plans (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name_en             text not null,
  name_ar             text not null,
  who_for_en          text,
  who_for_ar          text,
  includes_en         text[] not null default '{}',
  includes_ar         text[] not null default '{}',
  price_qar           numeric(10, 2) not null check (price_qar >= 0),
  duration_days       integer not null check (duration_days > 0),
  includes_in_person  boolean not null default false,
  is_featured         boolean not null default false,
  is_active           boolean not null default false,
  sort                integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.cc_coupons (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code = upper(code)),
  discount_type   text not null check (discount_type in ('percent', 'fixed')),
  discount_value  numeric(10, 2) not null check (discount_value > 0),
  expires_at      timestamptz,
  max_uses        integer check (max_uses is null or max_uses > 0),
  used_count      integer not null default 0 check (used_count >= 0),
  plan_ids        uuid[],          -- null = every plan
  institution     text,            -- null = any institution
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.cc_cohorts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name_en      text not null,
  name_ar      text not null,
  starts_on    date,
  ends_on      date,
  schedule_en  text,
  schedule_ar  text,
  location_en  text,
  location_ar  text,
  seats_total  integer not null default 0 check (seats_total >= 0),
  status       text not null default 'draft' check (status in ('draft', 'open', 'full', 'closed', 'completed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create sequence if not exists public.cc_receipt_number_seq start 1001;

create table if not exists public.cc_payments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.cc_profiles (id) on delete restrict,
  plan_id              uuid not null references public.cc_plans (id) on delete restrict,
  cohort_id            uuid references public.cc_cohorts (id) on delete set null,
  coupon_id            uuid references public.cc_coupons (id) on delete set null,
  list_price_qar       numeric(10, 2),
  discount_qar         numeric(10, 2) not null default 0,
  amount_qar           numeric(10, 2) not null check (amount_qar >= 0),
  currency             text not null default 'QAR' check (currency = 'QAR'),
  method               text not null check (method in ('fawran', 'skipcash')),
  reference_code       text not null unique,       -- e.g. CAD-7K3P
  status               text not null default 'awaiting_transfer'
                         check (status in ('awaiting_transfer', 'proof_submitted', 'paid', 'rejected', 'refunded', 'expired', 'cancelled')),
  proof_storage_path   text,                        -- cc-payment-proofs/{user_id}/...
  payer_name           text,
  payer_bank           text,
  transfer_reference   text,
  transferred_at       timestamptz,
  provider_payment_id  text unique,
  reviewed_by          uuid references auth.users (id) on delete set null,
  reviewed_at          timestamptz,
  reject_reason        text,
  reject_reason_ar     text,
  receipt_number       bigint unique,               -- nextval('cc_receipt_number_seq') on paid
  raw_payload          jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  expires_at           timestamptz
);

create index if not exists cc_payments_user_idx on public.cc_payments (user_id, created_at desc);
create index if not exists cc_payments_status_idx on public.cc_payments (status, created_at);

create table if not exists public.cc_enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.cc_profiles (id) on delete cascade,
  plan_id     uuid references public.cc_plans (id) on delete restrict,
  cohort_id   uuid references public.cc_cohorts (id) on delete set null,
  payment_id  uuid unique references public.cc_payments (id) on delete set null,
  source      text not null default 'payment' check (source in ('payment', 'admin')),
  status      text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists cc_enrollments_user_idx on public.cc_enrollments (user_id, ends_at desc);

create or replace function public.cc_has_active_enrollment(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cc_enrollments e
     where e.user_id = p_user and e.status = 'active'
       and e.starts_at <= now() and e.ends_at > now()
  );
$$;

-- ============================================================================
-- 7. Admin / operations
-- ============================================================================

create table if not exists public.cc_audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users (id) on delete set null,
  action       text not null,         -- e.g. payment.approve, score.override, level.unlock, plan.price_change
  entity_type  text not null,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists cc_audit_log_created_idx on public.cc_audit_log (created_at desc);

create table if not exists public.cc_deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.cc_profiles (id) on delete cascade,
  reason        text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note    text,
  processed_by  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

create unique index if not exists cc_deletion_requests_one_pending_idx
  on public.cc_deletion_requests (user_id) where status = 'pending';

create or replace function public.cc_mark_deletion_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cc_profiles set deletion_requested_at = new.created_at where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists cc_deletion_requests_mark_profile on public.cc_deletion_requests;
create trigger cc_deletion_requests_mark_profile
  after insert on public.cc_deletion_requests
  for each row execute function public.cc_mark_deletion_requested();

-- Private trainer notes (Prompt 11). Staff only; never readable by students.
create table if not exists public.cc_student_notes (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.cc_profiles (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- updated_at triggers for the remaining tables
do $$
declare t text;
begin
  foreach t in array array['cc_courses', 'cc_modules', 'cc_levels', 'cc_lessons', 'cc_exercises',
                           'cc_lesson_progress', 'cc_lesson_questions', 'cc_plans', 'cc_coupons',
                           'cc_cohorts', 'cc_payments', 'cc_enrollments', 'cc_task_aspects',
                           'cc_aspect_results']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end;
$$;

-- ============================================================================
-- 8. Answer-free views for students
-- ============================================================================
-- Owner-rights views (security_invoker = false): they read the base tables as
-- the view owner, so they bypass the staff-only policies, and expose ONLY the
-- safe columns of published content. security_barrier stops leaky predicates.

create or replace view public.cc_test_tasks_public
with (security_invoker = false, security_barrier = true) as
select tt.id, tt.test_id, tt.position, tt.skill_area_id, tt.competition_module,
       tt.title_en, tt.title_ar, tt.brief_en, tt.brief_ar, tt.attachments,
       tt.expected_upload, tt.max_points, tt.grading_mode,
       tt.density_kg_m3, tt.material_name_en, tt.material_name_ar,
       tt.created_at, tt.updated_at
  from public.cc_test_tasks tt
  join public.cc_tests t on t.id = tt.test_id
 where (t.is_published and not t.admin_only)
    or public.cc_is_staff();

create or replace view public.cc_exercises_public
with (security_invoker = false, security_barrier = true) as
select e.id, e.level_id, e.slug, e.sort, e.skill_area_id, e.competition_module,
       e.title_en, e.title_ar, e.brief_en, e.brief_ar, e.attachments,
       e.expected_upload, e.grading_mode, e.density_kg_m3,
       e.material_name_en, e.material_name_ar, e.max_points,
       e.estimated_minutes, e.pass_mark,
       coalesce(array_length(e.hints_en, 1), 0) as hint_count,
       (e.solution_video_id is not null) as has_solution_video,
       e.is_free_sample, e.test_id, e.created_at, e.updated_at
  from public.cc_exercises e
 where (e.is_published and auth.uid() is not null)
    or public.cc_is_staff();

-- Aspects of published tests / exercises, without partial_rule.
create or replace view public.cc_task_aspects_public
with (security_invoker = false, security_barrier = true) as
select a.id, a.task_id, a.exercise_id, a.position, a.description_en, a.description_ar,
       a.skill_area_id, a.competition_module, a.type, a.max_points, a.method,
       a.check_key, a.student_hint_en, a.student_hint_ar, a.created_at, a.updated_at
  from public.cc_task_aspects a
  left join public.cc_test_tasks tt on tt.id = a.task_id
  left join public.cc_tests t on t.id = tt.test_id
  left join public.cc_exercises e on e.id = a.exercise_id
 where coalesce(t.is_published and not t.admin_only, false)
    or coalesce(e.is_published and auth.uid() is not null, false)
    or public.cc_is_staff();

-- ============================================================================
-- 9. Row Level Security
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'cc_profiles', 'cc_journey_progress', 'cc_get_ready_steps', 'cc_skill_areas',
    'cc_tests', 'cc_test_tasks', 'cc_attempts', 'cc_submissions', 'cc_task_results',
    'cc_skill_scores', 'cc_grading_logs', 'cc_integrity_flags', 'cc_help_articles',
    'cc_help_searches', 'cc_courses', 'cc_modules', 'cc_levels', 'cc_lessons',
    'cc_exercises', 'cc_exercise_attempts', 'cc_lesson_progress', 'cc_lesson_questions',
    'cc_level_unlocks', 'cc_certificates', 'cc_plans', 'cc_coupons', 'cc_cohorts',
    'cc_payments', 'cc_enrollments', 'cc_audit_log', 'cc_deletion_requests',
    'cc_student_notes', 'cc_competition_modules', 'cc_task_aspects', 'cc_aspect_results']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- Base privileges: RLS narrows rows. anon gets nothing unless granted below.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- Public content readable signed-out too.
grant select on public.cc_skill_areas, public.cc_help_articles, public.cc_plans,
  public.cc_competition_modules to anon;

-- Views
revoke all on public.cc_test_tasks_public, public.cc_exercises_public, public.cc_task_aspects_public from anon, public;
grant select on public.cc_test_tasks_public, public.cc_exercises_public, public.cc_task_aspects_public
  to authenticated, service_role;

-- Functions
grant execute on function public.cc_current_role() to authenticated, anon, service_role;
grant execute on function public.cc_is_staff() to authenticated, anon, service_role;
grant execute on function public.cc_is_admin() to authenticated, anon, service_role;
grant execute on function public.cc_is_minor(date) to authenticated, anon, service_role;
grant execute on function public.cc_has_active_enrollment(uuid) to authenticated, service_role;
revoke execute on function public.cc_help_feedback(text, boolean) from public, anon, authenticated;
grant execute on function public.cc_help_feedback(text, boolean) to service_role;
grant usage, select on sequence public.cc_receipt_number_seq to service_role;

-- ---------------------------------------------------------------- cc_profiles
drop policy if exists cc_profiles_select on public.cc_profiles;
create policy cc_profiles_select on public.cc_profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.cc_is_staff());

drop policy if exists cc_profiles_insert_own on public.cc_profiles;
create policy cc_profiles_insert_own on public.cc_profiles
  for insert to authenticated
  with check (id = (select auth.uid()) and role = 'student');

drop policy if exists cc_profiles_update_own on public.cc_profiles;
create policy cc_profiles_update_own on public.cc_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));   -- role & admin fields guarded by trigger

drop policy if exists cc_profiles_admin_all on public.cc_profiles;
create policy cc_profiles_admin_all on public.cc_profiles
  for all to authenticated
  using (public.cc_is_admin()) with check (public.cc_is_admin());

-- -------------------------------------------------------- cc_journey_progress
-- Students read their own; timestamps are written by the server (service role)
-- or an admin.
drop policy if exists cc_journey_progress_select on public.cc_journey_progress;
create policy cc_journey_progress_select on public.cc_journey_progress
  for select to authenticated
  using (user_id = (select auth.uid()) or public.cc_is_staff());

drop policy if exists cc_journey_progress_admin_all on public.cc_journey_progress;
create policy cc_journey_progress_admin_all on public.cc_journey_progress
  for all to authenticated
  using (public.cc_is_admin()) with check (public.cc_is_admin());

-- --------------------------------------------------------- cc_get_ready_steps
drop policy if exists cc_get_ready_steps_select on public.cc_get_ready_steps;
create policy cc_get_ready_steps_select on public.cc_get_ready_steps
  for select to authenticated
  using (user_id = (select auth.uid()) or public.cc_is_staff());

drop policy if exists cc_get_ready_steps_insert_own on public.cc_get_ready_steps;
create policy cc_get_ready_steps_insert_own on public.cc_get_ready_steps
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists cc_get_ready_steps_update_own on public.cc_get_ready_steps;
create policy cc_get_ready_steps_update_own on public.cc_get_ready_steps
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists cc_get_ready_steps_delete_own on public.cc_get_ready_steps;
create policy cc_get_ready_steps_delete_own on public.cc_get_ready_steps
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists cc_get_ready_steps_admin_all on public.cc_get_ready_steps;
create policy cc_get_ready_steps_admin_all on public.cc_get_ready_steps
  for all to authenticated
  using (public.cc_is_admin()) with check (public.cc_is_admin());

-- ------------------------------------------- public content: read + admin write
drop policy if exists cc_skill_areas_read on public.cc_skill_areas;
create policy cc_skill_areas_read on public.cc_skill_areas
  for select to anon, authenticated using (true);

drop policy if exists cc_help_articles_read on public.cc_help_articles;
create policy cc_help_articles_read on public.cc_help_articles
  for select to anon, authenticated using (is_published or public.cc_is_staff());

drop policy if exists cc_plans_read on public.cc_plans;
create policy cc_plans_read on public.cc_plans
  for select to anon, authenticated using (is_active or public.cc_is_staff());

drop policy if exists cc_competition_modules_read on public.cc_competition_modules;
create policy cc_competition_modules_read on public.cc_competition_modules
  for select to anon, authenticated using (is_active or public.cc_is_staff());

drop policy if exists cc_tests_read on public.cc_tests;
create policy cc_tests_read on public.cc_tests
  for select to authenticated using ((is_published and not admin_only) or public.cc_is_staff());

drop policy if exists cc_courses_read on public.cc_courses;
create policy cc_courses_read on public.cc_courses
  for select to authenticated using (is_published or public.cc_is_staff());

drop policy if exists cc_modules_read on public.cc_modules;
create policy cc_modules_read on public.cc_modules
  for select to authenticated using (is_published or public.cc_is_staff());

drop policy if exists cc_levels_read on public.cc_levels;
create policy cc_levels_read on public.cc_levels
  for select to authenticated using (is_published or public.cc_is_staff());

drop policy if exists cc_lessons_read on public.cc_lessons;
create policy cc_lessons_read on public.cc_lessons
  for select to authenticated using (is_published or public.cc_is_staff());

drop policy if exists cc_cohorts_read on public.cc_cohorts;
create policy cc_cohorts_read on public.cc_cohorts
  for select to authenticated using (status <> 'draft' or public.cc_is_staff());

-- Answer tables: staff only. Students use cc_test_tasks_public / cc_exercises_public.
drop policy if exists cc_test_tasks_staff_read on public.cc_test_tasks;
create policy cc_test_tasks_staff_read on public.cc_test_tasks
  for select to authenticated using (public.cc_is_staff());

drop policy if exists cc_task_aspects_staff_read on public.cc_task_aspects;
create policy cc_task_aspects_staff_read on public.cc_task_aspects
  for select to authenticated using (public.cc_is_staff());

drop policy if exists cc_exercises_staff_read on public.cc_exercises;
create policy cc_exercises_staff_read on public.cc_exercises
  for select to authenticated using (public.cc_is_staff());

-- Admin-only tables (readable and writable by admins only)
drop policy if exists cc_coupons_admin_read on public.cc_coupons;
create policy cc_coupons_admin_read on public.cc_coupons
  for select to authenticated using (public.cc_is_admin());

do $$
declare t text;
begin
  foreach t in array array['cc_skill_areas', 'cc_help_articles', 'cc_plans', 'cc_tests', 'cc_test_tasks',
                           'cc_courses', 'cc_modules', 'cc_levels', 'cc_lessons', 'cc_exercises',
                           'cc_cohorts', 'cc_coupons', 'cc_competition_modules', 'cc_task_aspects']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.cc_is_admin())',
                   t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.cc_is_admin()) with check (public.cc_is_admin())',
                   t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.cc_is_admin())',
                   t || '_admin_delete', t);
  end loop;
end;
$$;

-- --------------------------------- student-owned, server-written (read own; staff read; admin write)
-- attempts, submissions, task results, skill scores, exercise attempts,
-- enrollments, payments, level unlocks, certificates.
-- Students never insert/update these directly: server actions validate and
-- write with the service role (timer, scores, payment status cannot be forged).
do $$
declare t text;
begin
  foreach t in array array['cc_attempts', 'cc_submissions', 'cc_task_results', 'cc_skill_scores',
                           'cc_exercise_attempts', 'cc_enrollments', 'cc_payments',
                           'cc_level_unlocks', 'cc_certificates', 'cc_aspect_results']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) or public.cc_is_staff())',
                   t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.cc_is_admin()) with check (public.cc_is_admin())',
                   t || '_admin_all', t);
  end loop;
end;
$$;

-- Trainers (instructors) finalize drawing reviews: they may update task
-- results and skill scores (Prompt 8 review screen).
drop policy if exists cc_task_results_staff_update on public.cc_task_results;
create policy cc_task_results_staff_update on public.cc_task_results
  for update to authenticated
  using (public.cc_is_staff()) with check (public.cc_is_staff());

drop policy if exists cc_aspect_results_staff_write on public.cc_aspect_results;
create policy cc_aspect_results_staff_write on public.cc_aspect_results
  for all to authenticated
  using (public.cc_is_staff()) with check (public.cc_is_staff());

drop policy if exists cc_skill_scores_staff_write on public.cc_skill_scores;
create policy cc_skill_scores_staff_write on public.cc_skill_scores
  for all to authenticated
  using (public.cc_is_staff()) with check (public.cc_is_staff());

-- ------------------------------------------------------- cc_lesson_progress
drop policy if exists cc_lesson_progress_select on public.cc_lesson_progress;
create policy cc_lesson_progress_select on public.cc_lesson_progress
  for select to authenticated
  using (user_id = (select auth.uid()) or public.cc_is_staff());

drop policy if exists cc_lesson_progress_insert_own on public.cc_lesson_progress;
create policy cc_lesson_progress_insert_own on public.cc_lesson_progress
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists cc_lesson_progress_update_own on public.cc_lesson_progress;
create policy cc_lesson_progress_update_own on public.cc_lesson_progress
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists cc_lesson_progress_admin_all on public.cc_lesson_progress;
create policy cc_lesson_progress_admin_all on public.cc_lesson_progress
  for all to authenticated
  using (public.cc_is_admin()) with check (public.cc_is_admin());

-- ------------------------------------------------------ cc_lesson_questions
-- Students ask (open, unanswered, private) and read their own + public answered
-- FAQs. Staff read all and answer.
drop policy if exists cc_lesson_questions_select on public.cc_lesson_questions;
create policy cc_lesson_questions_select on public.cc_lesson_questions
  for select to authenticated
  using (user_id = (select auth.uid())
         or (public and status = 'answered' and kind = 'lesson')
         or public.cc_is_staff());

drop policy if exists cc_lesson_questions_insert_own on public.cc_lesson_questions;
create policy cc_lesson_questions_insert_own on public.cc_lesson_questions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open' and answer is null
              and answered_by is null and answered_at is null and not public);

drop policy if exists cc_lesson_questions_staff_update on public.cc_lesson_questions;
create policy cc_lesson_questions_staff_update on public.cc_lesson_questions
  for update to authenticated
  using (public.cc_is_staff()) with check (public.cc_is_staff());

drop policy if exists cc_lesson_questions_admin_delete on public.cc_lesson_questions;
create policy cc_lesson_questions_admin_delete on public.cc_lesson_questions
  for delete to authenticated using (public.cc_is_admin());

-- ----------------------------------------------------- cc_deletion_requests
drop policy if exists cc_deletion_requests_select on public.cc_deletion_requests;
create policy cc_deletion_requests_select on public.cc_deletion_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.cc_is_admin());

drop policy if exists cc_deletion_requests_insert_own on public.cc_deletion_requests;
create policy cc_deletion_requests_insert_own on public.cc_deletion_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending'
              and processed_at is null and processed_by is null);

drop policy if exists cc_deletion_requests_admin_all on public.cc_deletion_requests;
create policy cc_deletion_requests_admin_all on public.cc_deletion_requests
  for all to authenticated
  using (public.cc_is_admin()) with check (public.cc_is_admin());

-- ------------------------------------------------- staff-only operational tables
-- grading logs, integrity flags, trainer notes: staff read; admin write
-- (the server writes logs/flags with the service role).
drop policy if exists cc_grading_logs_staff_read on public.cc_grading_logs;
create policy cc_grading_logs_staff_read on public.cc_grading_logs
  for select to authenticated using (public.cc_is_staff());

drop policy if exists cc_integrity_flags_staff_read on public.cc_integrity_flags;
create policy cc_integrity_flags_staff_read on public.cc_integrity_flags
  for select to authenticated using (public.cc_is_staff());

drop policy if exists cc_integrity_flags_admin_update on public.cc_integrity_flags;
create policy cc_integrity_flags_admin_update on public.cc_integrity_flags
  for update to authenticated using (public.cc_is_admin()) with check (public.cc_is_admin());

drop policy if exists cc_student_notes_staff_read on public.cc_student_notes;
create policy cc_student_notes_staff_read on public.cc_student_notes
  for select to authenticated using (public.cc_is_staff());

drop policy if exists cc_student_notes_staff_insert on public.cc_student_notes;
create policy cc_student_notes_staff_insert on public.cc_student_notes
  for insert to authenticated
  with check (public.cc_is_staff() and author_id = (select auth.uid()));

drop policy if exists cc_student_notes_admin_delete on public.cc_student_notes;
create policy cc_student_notes_admin_delete on public.cc_student_notes
  for delete to authenticated using (public.cc_is_admin());

drop policy if exists cc_help_searches_staff_read on public.cc_help_searches;
create policy cc_help_searches_staff_read on public.cc_help_searches
  for select to authenticated using (public.cc_is_staff());

-- ------------------------------------------------------------ cc_audit_log
-- Admin read; admins may append entries as themselves; no update/delete.
drop policy if exists cc_audit_log_admin_read on public.cc_audit_log;
create policy cc_audit_log_admin_read on public.cc_audit_log
  for select to authenticated using (public.cc_is_admin());

drop policy if exists cc_audit_log_admin_insert on public.cc_audit_log;
create policy cc_audit_log_admin_insert on public.cc_audit_log
  for insert to authenticated
  with check (public.cc_is_staff() and actor_id = (select auth.uid()));
