-- ============================================================================
-- 0083_cc_training_seed.sql  -  CAD Champions: training schema additions + seed
-- ============================================================================
-- RUN AFTER 0082 (0082_cc_drawing_rubric.sql). Needs the tables from
-- 0077_cc_core.sql and the buckets from 0078_cc_storage.sql.
--
-- What it does (Prompt 9, docs/COMPETITION_ALIGNMENT.md sections A, C, G)
--   1. Columns
--        cc_lessons.skill_area_id      ONE skill area per lesson (1-6)
--        cc_lessons.track_notes        per-track note for Inventor-only tools:
--                                      {"fusion": "inventor_only" | {"en","ar"},
--                                       "solidworks": ...}  ({"en","ar"} = the
--                                      closest equivalent workflow)
--        cc_modules.competition_module the competition module a track covers
--   2. Gamification: cc_student_xp (user_id, xp, streak_weeks,
--      last_active_week) and cc_badges (user_id, level_id, earned_at).
--      Students read their own rows; the server writes them (service role).
--   2b. Column privileges: students can no longer select cc_lessons notes,
--      common mistakes, downloads or video ids (served by the app after its
--      access check, with the service role).
--   3. RPCs
--        cc_verify_certificate(code) -> jsonb   public /verify/[code] (anon ok)
--        cc_cohort_seats()           -> table   seats taken per cohort
--   4. Seed (fixed uuids, re-runnable): course "cad-champions" with
--        Orientation (module 0, 3 lessons with notes written, free preview)
--        Foundations L1-L6 (lessons + the 3D-modelling exercise ladder; L1
--          lessons are free preview and L1 exercises are the free sample;
--          L6 = drawing fundamentals + the 60-minute mini-project test)
--        M1-M4 competition tracks (levels, titled lessons with objectives)
--        Mock Competitions (describes the 4 mocks; mock tests are listed
--          from cc_tests type 'mock' when they exist)
--      Every lesson / exercise has ONE skill area and, where relevant, ONE
--      competition module. Video slots, exercise briefs, reference data and
--      drawings are [TODO-MO] (see docs/CONTENT_TODO.md). Lesson durations
--      and exercise time estimates are planning values [TODO-MO: confirm].
--   5. Test "foundations-mini-project" (type exercise, 60 min, per_task,
--      NOT published until the owner adds its tasks).
--
-- Lesson questions keep using cc_lesson_questions (kind 'lesson'); the image
-- goes to the existing private bucket cc-submissions under
-- {user_id}/questions/... (0078 policies already cover it), so no new bucket.
--
-- Safe to re-run: add column if not exists, create table if not exists,
-- create or replace, on conflict ... do update. Parents are looked up by
-- slug, so rows created earlier by hand keep their ids.
-- NOTE: re-running resets the seeded titles/objectives/notes/briefs/hints to
-- this text (video ids, reference data and attachments are NOT overwritten).
--
-- Rollback (comments; destroys training content and progress):
--   delete from public.cc_courses where slug = 'cad-champions';  -- cascades
--   delete from public.cc_tests where slug = 'foundations-mini-project';
--   drop table if exists public.cc_badges, public.cc_student_xp;
--   drop function if exists public.cc_verify_certificate(text), public.cc_cohort_seats();
--   alter table public.cc_lessons drop column if exists skill_area_id, drop column if exists track_notes;
--   alter table public.cc_modules drop column if exists competition_module;
-- ============================================================================

-- ------------------------------------------------------------- 1. columns
alter table public.cc_lessons add column if not exists skill_area_id smallint references public.cc_skill_areas (id);
alter table public.cc_lessons add column if not exists track_notes jsonb not null default '{}'::jsonb;
alter table public.cc_modules add column if not exists competition_module text references public.cc_competition_modules (code);

create index if not exists cc_lesson_progress_user_idx on public.cc_lesson_progress (user_id, updated_at desc);
create index if not exists cc_lesson_questions_user_lesson_idx on public.cc_lesson_questions (user_id, lesson_id) where lesson_id is not null;

-- --------------------------------------------------------- 2. gamification
create table if not exists public.cc_student_xp (
  user_id           uuid primary key references public.cc_profiles (id) on delete cascade,
  xp                integer not null default 0 check (xp >= 0),
  streak_weeks      integer not null default 0 check (streak_weeks >= 0),
  last_active_week  date,          -- Monday (Asia/Qatar) of the last active week
  updated_at        timestamptz not null default now()
);

create table if not exists public.cc_badges (
  user_id    uuid not null references public.cc_profiles (id) on delete cascade,
  level_id   uuid not null references public.cc_levels (id) on delete cascade,
  earned_at  timestamptz not null default now(),
  primary key (user_id, level_id)
);

do $$
declare t text;
begin
  foreach t in array array['cc_student_xp', 'cc_badges']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) or public.cc_is_staff())',
                   t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.cc_is_admin()) with check (public.cc_is_admin())',
                   t || '_admin_all', t);
  end loop;
end;
$$;

-- ------------------------------------------- 2b. lesson content behind access
-- Lesson rows stay readable by every signed-in user (the catalog: titles,
-- objectives, tags), but the paid content columns (notes, common mistakes,
-- downloads, video ids) are no longer selectable with a student session.
-- The app reads them with the service role AFTER its access check
-- (lib/cad-champions/training/access.ts). NOTE: re-running 0077 re-grants
-- table-wide select; run 0083 again afterwards. Staff/admin tools must read
-- these columns with the service role too.
revoke select on public.cc_lessons from authenticated;
grant select (id, level_id, competition_module, skill_area_id, slug, sort, title_en, title_ar,
              objectives_en, objectives_ar, duration_minutes, glossary_terms, track_notes,
              is_free_preview, is_published, created_at, updated_at)
  on public.cc_lessons to authenticated;

-- ----------------------------------------------------------------- 3. RPCs
-- Public certificate check: only the name, the module title and the date of
-- one certificate, looked up by its exact code.
create or replace function public.cc_verify_certificate(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', c.code,
    'full_name', nullif(trim(coalesce(p.full_name, '')), ''),
    'full_name_ar', nullif(trim(coalesce(p.full_name_ar, '')), ''),
    'module_title_en', m.title_en,
    'module_title_ar', m.title_ar,
    'issued_at', c.issued_at
  )
  from public.cc_certificates c
  join public.cc_profiles p on p.id = c.user_id
  join public.cc_modules m on m.id = c.module_id
  where p_code is not null
    and length(p_code) between 6 and 40
    and c.code = upper(trim(p_code))
  limit 1;
$$;

revoke all on function public.cc_verify_certificate(text) from public;
grant execute on function public.cc_verify_certificate(text) to anon, authenticated, service_role;

-- Seats taken per cohort (active enrollments), without exposing who.
create or replace function public.cc_cohort_seats()
returns table (cohort_id uuid, seats_taken integer)
language sql
stable
security definer
set search_path = ''
as $$
  select e.cohort_id, count(*)::integer
    from public.cc_enrollments e
   where e.cohort_id is not null and e.status = 'active' and e.ends_at > now()
   group by e.cohort_id;
$$;

revoke all on function public.cc_cohort_seats() from public;
grant execute on function public.cc_cohort_seats() to authenticated, service_role;

-- ------------------------------------------------------------- 4a. course
insert into public.cc_courses (id, slug, title_en, title_ar, description_en, description_ar, sort, is_published)
values ('cc083000-0000-4000-8000-000000000001', 'cad-champions', 'CAD Champions training', 'تدريب CAD Champions',
  $t$Orientation, Foundations, four competition-module tracks and mock competitions.$t$,
  $t$التهيئة، ثم الأساسيات، ثم أربعة مسارات لوحدات المسابقة، ثم المسابقات التجريبية.$t$,
  0, true)
on conflict (slug) do update set
  title_en = excluded.title_en, title_ar = excluded.title_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  is_published = excluded.is_published;

-- ------------------------------------------------------------ 4b. modules
insert into public.cc_modules
  (id, course_id, skill_area_id, competition_module, slug, title_en, title_ar, description_en, description_ar,
   why_it_matters_en, why_it_matters_ar, icon, is_orientation, sort, is_published)
select v.id::uuid, c.id, v.skill::smallint, v.cm, v.slug, v.title_en, v.title_ar, v.desc_en, v.desc_ar,
       v.why_en, v.why_ar, v.icon, v.orientation, v.sort, true
from (values
  ('cc083000-0000-4000-8000-000000000100', null, null, 'orientation', 'Orientation', 'التهيئة',
   $t$Start here: how the training, the grading and the real competition work, and how to plan your study.$t$,
   $t$ابدأ من هنا: كيف يعمل التدريب والتصحيح والمسابقة الحقيقية، وكيف تخطط لدراستك.$t$,
   $t$Knowing the rules and the marking from day one saves you time and marks later.$t$,
   $t$معرفة القواعد وطريقة التصحيح من اليوم الأول توفر عليك الوقت والدرجات لاحقًا.$t$,
   'compass', true, 0),
  ('cc083000-0000-4000-8000-000000000101', 3, null, 'foundations', 'Foundations', 'الأساسيات',
   $t$Six levels from your first extrude to assemblies and drawing fundamentals, with an exercise ladder you can retry as often as you like.$t$,
   $t$ستة مستويات من أول عملية بثق حتى التجميعات وأساسيات الرسم الفني، مع سلّم تمارين تعيدها كما تشاء.$t$,
   $t$3D modelling and technical drawing together carry 60% of the marks (30% each). Every competition module builds on these skills.$t$,
   $t$النمذجة ثلاثية الأبعاد والرسم الفني معًا لهما 60% من الدرجات (30% لكل منهما). كل وحدات المسابقة تُبنى على هذه المهارات.$t$,
   'boxes', false, 1),
  ('cc083000-0000-4000-8000-000000000102', null, 'M1', 'm1-fabrication', 'M1 track: Mechanical fabrication', 'مسار M1: التصنيع الميكانيكي',
   $t$Sheet metal, frames, weldments, bolted connections, tubes and cables, and the animation and drawings a workshop needs.$t$,
   $t$الصفائح المعدنية والهياكل واللحامات ووصلات البراغي والأنابيب والكابلات، ومقطع التحريك والرسومات التي تحتاجها الورشة.$t$,
   $t$Module 1 is a full 6-hour competition day. Correct, complete fabrication drawings earn most of its marks.$t$,
   $t$الوحدة 1 يوم مسابقة كامل مدته 6 ساعات. الرسومات التصنيعية الصحيحة والكاملة تحقق معظم درجاته.$t$,
   'wrench', false, 2),
  ('cc083000-0000-4000-8000-000000000103', null, 'M2', 'm2-design-challenge', 'M2 track: Mechanical design challenge', 'مسار M2: تحدي التصميم الميكانيكي',
   $t$Read a design brief, change an existing assembly, use design generators, and present the result with renders, animations and printable parts.$t$,
   $t$اقرأ موجز التصميم، وعدّل تجميعًا جاهزًا، واستخدم مولّدات التصميم، واعرض النتيجة بصور واقعية ومقاطع تحريك وقطع قابلة للطباعة.$t$,
   $t$Module 2 is a full 6-hour day where you solve a real design problem and show it clearly.$t$,
   $t$الوحدة 2 يوم كامل مدته 6 ساعات تحل فيه مشكلة تصميم حقيقية وتعرضها بوضوح.$t$,
   'lightbulb', false, 3),
  ('cc083000-0000-4000-8000-000000000104', null, 'M3', 'm3-assemblies-drawings', 'M3 track: Assemblies and detail drawings', 'مسار M3: التجميعات ورسومات التفاصيل',
   $t$Model parts quickly from detail drawings, add standard parts, and produce drawings ready for manufacture.$t$,
   $t$نمذج القطع بسرعة من رسومات التفاصيل، وأضف القطع القياسية، وأعدّ رسومات جاهزة للتصنيع.$t$,
   $t$Module 3 is a full 6-hour day. Speed and accuracy in modelling and drawing decide the score.$t$,
   $t$الوحدة 3 يوم كامل مدته 6 ساعات. السرعة والدقة في النمذجة والرسم تحددان النتيجة.$t$,
   'ruler', false, 4),
  ('cc083000-0000-4000-8000-000000000105', 5, 'M4', 'm4-reverse-engineering', 'M4 track: Reverse engineering', 'مسار M4: الهندسة العكسية',
   $t$Use each allowed measuring instrument, sketch on paper under time pressure, and turn your sketches into accurate models with 3D annotation.$t$,
   $t$استخدم كل أداة قياس مسموحة، وارسم على الورق تحت ضغط الوقت، وحوّل رسوماتك إلى نماذج دقيقة مع التوصيف ثلاثي الأبعاد.$t$,
   $t$Reverse engineering carries 15% of the marks, and in Module 4 you have the physical part for only 2 hours.$t$,
   $t$للهندسة العكسية 15% من الدرجات، وفي الوحدة 4 تبقى القطعة الحقيقية معك ساعتين فقط.$t$,
   'scan', false, 5),
  ('cc083000-0000-4000-8000-000000000106', null, null, 'mock-competitions', 'Mock competitions', 'المسابقات التجريبية',
   $t$Four full-length mocks, one per competition module: M1, M2 and M3 take 6 hours each and M4 takes 4 hours. You work under the real rules and hand in one ZIP of the competition Results folder. Mocks run in Autodesk Inventor or Fusion. M1-M3 mocks can be taken online on your honour; full-length M4 mocks run in person.$t$,
   $t$أربع مسابقات تجريبية كاملة، واحدة لكل وحدة: M1 وM2 وM3 مدة كل منها 6 ساعات، وM4 مدتها 4 ساعات. تعمل وفق القواعد الحقيقية وتسلّم ملف ZIP واحدًا لمجلد النتائج. تُجرى التجارب في Autodesk Inventor أو Fusion. يمكن أداء تجارب M1 إلى M3 عبر الإنترنت بالتزام شخصي، أما تجربة M4 الكاملة فتكون حضوريًا.$t$,
   $t$A full day under real conditions is the best way to find out where you lose time before the qualifier.$t$,
   $t$خوض يوم كامل في ظروف حقيقية هو أفضل طريقة لاكتشاف أين يضيع وقتك قبل التصفيات.$t$,
   'timer', false, 6)
) as v(id, skill, cm, slug, title_en, title_ar, desc_en, desc_ar, why_en, why_ar, icon, orientation, sort)
cross join (select id from public.cc_courses where slug = 'cad-champions') c
on conflict (course_id, slug) do update set
  skill_area_id = excluded.skill_area_id, competition_module = excluded.competition_module,
  title_en = excluded.title_en, title_ar = excluded.title_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  why_it_matters_en = excluded.why_it_matters_en, why_it_matters_ar = excluded.why_it_matters_ar,
  icon = excluded.icon, is_orientation = excluded.is_orientation, sort = excluded.sort,
  is_published = excluded.is_published;

-- ------------------------------------------------------------- 4c. levels
-- unlock_rule: {"type":"open"} or {"type":"previous_level_passed","pass_mark":80}
--   previous_level_passed = every exercise of the previous level passed at its
--   pass mark (a level without exercises: every lesson completed). Admins can
--   unlock a level for one student with a cc_level_unlocks row.
insert into public.cc_levels (id, module_id, level_number, title_en, title_ar, goal_en, goal_ar, unlock_rule, is_published)
select v.id::uuid, m.id, v.n::smallint, v.title_en, v.title_ar, v.goal_en, v.goal_ar, v.rule::jsonb, true
from (values
  ('cc083000-0000-4000-8000-000000000200', 'orientation', 0, 'Start here', 'ابدأ من هنا',
   $t$By the end of this level you can explain how the training, the grading and the competition work, and you have a weekly study plan.$t$,
   $t$في نهاية هذا المستوى تستطيع شرح طريقة عمل التدريب والتصحيح والمسابقة، وتكون لديك خطة دراسة أسبوعية.$t$,
   '{"type": "open"}'),
  ('cc083000-0000-4000-8000-000000000211', 'foundations', 1, 'Level 1: Extrude basics', 'المستوى 1: أساسيات البثق',
   $t$By the end of this level you can sketch a fully constrained profile, extrude it, set units and material, and export a STEP file.$t$,
   $t$في نهاية هذا المستوى تستطيع رسم مقطع مقيّد بالكامل وبثقه، وضبط الوحدات والمادة، وتصدير ملف STEP.$t$,
   '{"type": "open"}'),
  ('cc083000-0000-4000-8000-000000000212', 'foundations', 2, 'Level 2: Holes and edges', 'المستوى 2: الثقوب والحواف',
   $t$By the end of this level you can add through holes, pockets, fillets and chamfers exactly where a drawing asks for them.$t$,
   $t$في نهاية هذا المستوى تستطيع إضافة الثقوب النافذة والجيوب وتدوير الحواف وشطفها في المكان الذي يطلبه الرسم بالضبط.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000213', 'foundations', 3, 'Level 3: More features', 'المستوى 3: أدوات أكثر',
   $t$By the end of this level you can build parts with revolve, sweep, loft, shell and patterns.$t$,
   $t$في نهاية هذا المستوى تستطيع بناء قطع بالدوران والسحب على مسار والانتقال بين المقاطع والتفريغ والأنماط.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000214', 'foundations', 4, 'Level 4: Smart parts', 'المستوى 4: القطع الذكية',
   $t$By the end of this level you can drive a part with parameters and make one part in several sizes.$t$,
   $t$في نهاية هذا المستوى تستطيع التحكم في القطعة بالمتغيرات وصنع قطعة واحدة بعدة مقاسات.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000215', 'foundations', 5, 'Level 5: Assemblies', 'المستوى 5: التجميعات',
   $t$By the end of this level you can constrain parts into assemblies and sub-assemblies, and build a simple mechanism that moves correctly.$t$,
   $t$في نهاية هذا المستوى تستطيع تقييد القطع في تجميعات وتجميعات فرعية، وبناء آلية بسيطة تتحرك بشكل صحيح.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000216', 'foundations', 6, 'Level 6: Drawing fundamentals', 'المستوى 6: أساسيات الرسم الفني',
   $t$By the end of this level you can produce an ISO detail drawing in first or third angle, with sections, dimensions, tolerances, surface texture and a parts list, and finish a 60-minute mini-project.$t$,
   $t$في نهاية هذا المستوى تستطيع إعداد رسم تفاصيل وفق ISO بالإسقاط الأول أو الثالث، مع المقاطع والأبعاد والتفاوتات وخشونة السطح وقائمة القطع، وإنهاء مشروع مصغّر في 60 دقيقة.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000221', 'm1-fabrication', 1, 'Sheet metal', 'الصفائح المعدنية',
   $t$By the end of this level you can model sheet metal parts with flanges and bends and draw their flat patterns with bend notes.$t$,
   $t$في نهاية هذا المستوى تستطيع نمذجة قطع الصفائح بالحواف والثنيات ورسم أشكالها المفرودة مع ملاحظات الثني.$t$,
   '{"type": "open"}'),
  ('cc083000-0000-4000-8000-000000000222', 'm1-fabrication', 2, 'Frames and weldments', 'الهياكل واللحامات',
   $t$By the end of this level you can build welded frames and show the welds correctly on drawings.$t$,
   $t$في نهاية هذا المستوى تستطيع بناء هياكل ملحومة وإظهار اللحامات بشكل صحيح على الرسومات.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000223', 'm1-fabrication', 3, 'Connections, tubes and cables', 'الوصلات والأنابيب والكابلات',
   $t$By the end of this level you can add bolted connections, route tubes and pipes, and lay out cables and wires.$t$,
   $t$في نهاية هذا المستوى تستطيع إضافة وصلات البراغي وتمديد الأنابيب وتوزيع الكابلات والأسلاك.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000224', 'm1-fabrication', 4, 'Presenting fabrication work', 'عرض أعمال التصنيع',
   $t$By the end of this level you can export an exploded animation and present a complete set of fabrication drawings.$t$,
   $t$في نهاية هذا المستوى تستطيع تصدير مقطع تحريك مفكك وعرض مجموعة كاملة من رسومات التصنيع.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000231', 'm2-design-challenge', 1, 'Briefs and design changes', 'الموجز وتعديلات التصميم',
   $t$By the end of this level you can turn a design brief into a list of changes and apply them to an existing assembly.$t$,
   $t$في نهاية هذا المستوى تستطيع تحويل موجز التصميم إلى قائمة تعديلات وتطبيقها على تجميع جاهز.$t$,
   '{"type": "open"}'),
  ('cc083000-0000-4000-8000-000000000232', 'm2-design-challenge', 2, 'Design generators', 'مولّدات التصميم',
   $t$By the end of this level you can generate shafts, bearings, gears and bolted connections from their design data.$t$,
   $t$في نهاية هذا المستوى تستطيع توليد الأعمدة والمحامل والتروس ووصلات البراغي من بيانات تصميمها.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000233', 'm2-design-challenge', 3, 'Renders', 'الصور الواقعية',
   $t$By the end of this level you can set up lighting, scenes, materials and a camera and output a render up to A3.$t$,
   $t$في نهاية هذا المستوى تستطيع ضبط الإضاءة والمشهد والمواد والكاميرا وإخراج صورة واقعية حتى مقاس A3.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000234', 'm2-design-challenge', 4, 'Animations', 'مقاطع التحريك',
   $t$By the end of this level you can make a physical simulation and an exploded or collapsing animation.$t$,
   $t$في نهاية هذا المستوى تستطيع إعداد محاكاة فيزيائية ومقطع تحريك للتفكيك أو التجميع.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000235', 'm2-design-challenge', 5, 'Parts for 3D printing', 'قطع للطباعة ثلاثية الأبعاد',
   $t$By the end of this level you can design a part that prints well and export it as STL.$t$,
   $t$في نهاية هذا المستوى تستطيع تصميم قطعة تُطبع جيدًا وتصديرها بصيغة STL.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000241', 'm3-assemblies-drawings', 1, 'Modelling from drawings', 'النمذجة من الرسومات',
   $t$By the end of this level you can read a detail drawing and model the part quickly and accurately.$t$,
   $t$في نهاية هذا المستوى تستطيع قراءة رسم التفاصيل ونمذجة القطعة بسرعة ودقة.$t$,
   '{"type": "open"}'),
  ('cc083000-0000-4000-8000-000000000242', 'm3-assemblies-drawings', 2, 'Standard parts', 'القطع القياسية',
   $t$By the end of this level you can insert the right standard parts from the library into an assembly.$t$,
   $t$في نهاية هذا المستوى تستطيع إدراج القطع القياسية الصحيحة من المكتبة في التجميع.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000243', 'm3-assemblies-drawings', 3, 'Drawings for manufacture', 'رسومات للتصنيع',
   $t$By the end of this level you can produce detail drawings with GD&T and limits and fits that a workshop can use.$t$,
   $t$في نهاية هذا المستوى تستطيع إعداد رسومات تفاصيل مع GD&T والحدود والتوافقات يمكن للورشة استخدامها.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000244', 'm3-assemblies-drawings', 4, 'Parts lists, exploded views and simulation', 'قوائم القطع والمساقط المفككة والمحاكاة',
   $t$By the end of this level you can add a multi-column parts list, exploded views and a simulation animation.$t$,
   $t$في نهاية هذا المستوى تستطيع إضافة قائمة قطع متعددة الأعمدة ومساقط مفككة ومقطع محاكاة.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000251', 'm4-reverse-engineering', 1, 'Measuring instruments', 'أدوات القياس',
   $t$By the end of this level you can use every allowed measuring instrument correctly.$t$,
   $t$في نهاية هذا المستوى تستطيع استخدام كل أداة قياس مسموحة بشكل صحيح.$t$,
   '{"type": "open"}'),
  ('cc083000-0000-4000-8000-000000000252', 'm4-reverse-engineering', 2, 'Measuring under time pressure', 'القياس تحت ضغط الوقت',
   $t$By the end of this level you can measure a part completely within 2 hours and record it in clear freehand sketches.$t$,
   $t$في نهاية هذا المستوى تستطيع قياس القطعة بالكامل خلال ساعتين وتسجيلها في رسومات يدوية واضحة.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000253', 'm4-reverse-engineering', 3, 'From sketch to model', 'من الرسم اليدوي إلى النموذج',
   $t$By the end of this level you can rebuild a part from your own sketches and annotate it in 3D.$t$,
   $t$في نهاية هذا المستوى تستطيع إعادة بناء القطعة من رسوماتك وتوصيفها ثلاثيًا.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000254', 'm4-reverse-engineering', 4, '3D scanning (in person)', 'المسح ثلاثي الأبعاد (حضوريًا)',
   $t$By the end of this level you know what a 3D scan can and cannot tell you, ready for the in-person session.$t$,
   $t$في نهاية هذا المستوى تعرف ما يمكن للمسح ثلاثي الأبعاد أن يخبرك به وما لا يمكنه، استعدادًا للجلسة الحضورية.$t$,
   '{"type": "previous_level_passed", "pass_mark": 80}'),
  ('cc083000-0000-4000-8000-000000000261', 'mock-competitions', 1, 'Full-length mocks', 'التجارب الكاملة',
   $t$By the end of this level you have worked through a full competition day under the real rules.$t$,
   $t$في نهاية هذا المستوى تكون قد خضت يوم مسابقة كاملًا وفق القواعد الحقيقية.$t$,
   '{"type": "open"}')
) as v(id, module_slug, n, title_en, title_ar, goal_en, goal_ar, rule)
join public.cc_modules m on m.slug = v.module_slug
join public.cc_courses c on c.id = m.course_id and c.slug = 'cad-champions'
on conflict (module_id, level_number) do update set
  title_en = excluded.title_en, title_ar = excluded.title_ar,
  goal_en = excluded.goal_en, goal_ar = excluded.goal_ar,
  unlock_rule = excluded.unlock_rule, is_published = excluded.is_published;

-- ------------------------------------------------------------ 4d. lessons
-- Video slots stay empty ([TODO-MO: record video]). A re-run never touches
-- video ids or downloads, and keeps notes / common mistakes the owner added
-- where this seed has none (coalesce).
insert into public.cc_lessons
  (id, level_id, competition_module, skill_area_id, slug, sort, title_en, title_ar, objectives_en, objectives_ar,
   duration_minutes, notes_en, notes_ar, common_mistakes_en, common_mistakes_ar, glossary_terms,
   is_free_preview, track_notes, is_published)
select v.id::uuid, lv.id, v.cm, v.skill::smallint, v.slug, v.sort, v.title_en, v.title_ar, v.obj_en, v.obj_ar,
       v.minutes, v.notes_en, v.notes_ar, v.mist_en, v.mist_ar, v.terms,
       v.free, v.notes::jsonb, true
from (values
  -- ===================================================== Orientation (level 0)
  ('cc083000-0000-4000-8000-000000000301', 'orientation', 0, 'how-this-training-works', 1, 1, null,
   'How this training works', 'كيف يعمل هذا التدريب',
   array[$t$Understand the ladder of levels and how a level unlocks$t$, $t$Know how exercises are checked and how hints and solution videos work$t$, $t$Know how to ask a trainer and how in-person sessions fit in$t$],
   array[$t$تفهم سلّم المستويات وكيف يُفتح كل مستوى$t$, $t$تعرف كيف تُصحَّح التمارين وكيف تعمل التلميحات وفيديوهات الحل$t$, $t$تعرف كيف تسأل المدرّب وأين تأتي الجلسات الحضورية$t$],
   10, true, '{}',
   $t$## The ladder
The course has four parts: **Orientation** (you are here), **Foundations**, four **competition-module tracks** (M1 to M4) and **mock competitions**.

Foundations is a ladder of 6 levels. Each level has short lessons and a few exercises. You climb one level at a time.

## How a level unlocks
- A level opens when you pass every exercise of the level before it at its pass mark (usually 80%).
- A level without exercises is done when you finish all its lessons.
- Stuck on a level? Ask a trainer. A trainer can unlock a level for you by hand.

## How exercises are checked
1. You model the part in your CAD software and export a STEP file.
2. You upload it on the exercise page. We check it within seconds and show your practice score with feedback.
3. You can try as often as you like. We keep your best score.
4. After each failed attempt you can open one more hint (up to 3).
5. The solution video opens when you pass, or after 5 attempts.

Drawing exercises are checked by a trainer, so their result takes longer.

## Questions
Every lesson has an **Ask a question** box. A trainer answers you under the lesson. Good answers can be shown to everyone as a short FAQ.

## In-person sessions and the qualifier
Foundations and the M1 to M3 tracks are online. Measuring practice for M4, 3D scanning, 3D printing and full-length mocks happen in person. See [In-person sessions](/training/in-person) for what happens there and who qualifies.$t$,
   $t$## السلّم
للتدريب أربعة أجزاء: **التهيئة** (أنت هنا)، ثم **الأساسيات**، ثم أربعة **مسارات لوحدات المسابقة** (من M1 إلى M4)، ثم **المسابقات التجريبية**.

الأساسيات سلّم من 6 مستويات. في كل مستوى دروس قصيرة وبعض التمارين. تصعد مستوى واحدًا في كل مرة.

## كيف يُفتح المستوى
- يُفتح المستوى عندما تنجح في كل تمارين المستوى الذي قبله بدرجة النجاح المطلوبة (عادةً 80%).
- المستوى الذي لا تمارين فيه يكتمل عندما تنهي كل دروسه.
- هل توقفت عند مستوى؟ اسأل المدرّب، فهو يستطيع فتح المستوى لك يدويًا.

## كيف تُصحَّح التمارين
1. تصمّم القطعة في برنامجك وتصدّرها بصيغة STEP.
2. ترفع الملف في صفحة التمرين، فنفحصه خلال ثوانٍ ونعرض لك درجة التدريب مع ملاحظات.
3. يمكنك المحاولة كما تشاء، ونحتفظ بأفضل درجة لك.
4. بعد كل محاولة غير ناجحة يمكنك فتح تلميح إضافي (حتى 3 تلميحات).
5. يُفتح فيديو الحل عندما تنجح، أو بعد 5 محاولات.

تمارين الرسم الفني يصححها مدرّب، لذلك تتأخر نتيجتها قليلًا.

## الأسئلة
في كل درس مربع **اطرح سؤالًا**. يجيبك المدرّب تحت الدرس نفسه، وقد تُعرض الإجابات المفيدة للجميع كأسئلة شائعة.

## الجلسات الحضورية والتصفيات
الأساسيات ومسارات M1 إلى M3 عبر الإنترنت. أما تدريب القياس في M4 والمسح ثلاثي الأبعاد والطباعة ثلاثية الأبعاد والتجارب الكاملة فتكون حضوريًا. اطّلع على [الجلسات الحضورية](/training/in-person) لتعرف ما يحدث فيها ومن يتأهل.$t$,
   null, null, array['step-file']),
  ('cc083000-0000-4000-8000-000000000302', 'orientation', 0, 'how-the-competition-works', 2, 1, null,
   'How the real competition works', 'كيف تجري المسابقة الحقيقية',
   array[$t$Know the 4 competition modules, their times and what you hand in$t$, $t$Set up the Results folder the way the judges expect$t$, $t$Understand measurement and judgement marking (0-3)$t$],
   array[$t$تعرف وحدات المسابقة الأربع ومدة كل منها وما تسلّمه$t$, $t$تجهّز مجلد النتائج بالشكل الذي يتوقعه الحكّام$t$, $t$تفهم التصحيح بالقياس والتصحيح بالتقدير (من 0 إلى 3)$t$],
   12, true, '{}',
   $t$## Four modules on four days
The test project has 4 separate modules, one per day. Each starts from scratch.

| Module | Time | What you do |
|---|---|---|
| M1 Mechanical fabrication | 6 hours | Sheet metal, welded frames and bolted assemblies, with drawings for the workshop and a short exploded animation |
| M2 Mechanical design challenge | 6 hours | Change an existing assembly to meet a design brief, then show it with drawings, renders and a simulation |
| M3 Assemblies and detail drawings | 6 hours | Model parts from detail drawings, add standard parts, and make drawings ready for manufacture |
| M4 Reverse engineering | 4 hours | Measure a real part, sketch it on paper, and rebuild it as a model with drawings |

In M4 the physical part stays with you for **2 hours only**. After that you work from your own paper sketches. Photos, putty, ink pads or any other way of copying the shape are not allowed.

## The software
The competition uses **Autodesk Inventor** (some events also allow **Autodesk Fusion**). You use the software provided on the day.

## The Results folder
Every day you hand in your work in a fixed folder structure, named with your competitor code:

- **CODE / DAY 01 / Results /** with the folders 2D Drawings, 3D Scannings, Animations, Parts and Assemblies, PDF files, Rendered Images, Reports and STL files
- **CODE / DAY 01 / Workspace /** for your working files

Result drawings are delivered as PDF. Build this habit now: our mocks use the same structure.

## Drawings
Drawings are supplied in **first-angle projection**. You must read both first and third angle, and you may answer in either.

## Conduct on the day
No internet, no phones, no smartwatches or wireless headphones, no USB sticks, and no talking with experts during the day. You may bring allowed measuring instruments, a 3D mouse, your own keyboard and mouse, and a standards book.

## How marks are given
- **Measurement** marks are right or wrong: full marks or zero (for example, "the part volume is correct").
- **Judgement** marks are scored 0 to 3 by judges: **0** below industry standard, **1** meets industry standard, **2** meets it and exceeds it in some respects, **3** excellent.

Most marks are measurement marks, so accuracy and complete deliverables matter more than style.$t$,
   $t$## أربع وحدات في أربعة أيام
مشروع الاختبار مكوّن من 4 وحدات منفصلة، وحدة في كل يوم، وكل وحدة تبدأ من الصفر.

| الوحدة | المدة | ماذا تفعل |
|---|---|---|
| M1 التصنيع الميكانيكي | 6 ساعات | صفائح معدنية وهياكل ملحومة وتجميعات بالبراغي، مع رسومات للورشة ومقطع تحريك قصير مفكك |
| M2 تحدي التصميم الميكانيكي | 6 ساعات | تعدّل تجميعًا جاهزًا ليطابق موجز التصميم، ثم تعرضه برسومات وصور واقعية ومحاكاة |
| M3 التجميعات ورسومات التفاصيل | 6 ساعات | تنمذج القطع من رسومات التفاصيل، وتضيف القطع القياسية، وتعدّ رسومات جاهزة للتصنيع |
| M4 الهندسة العكسية | 4 ساعات | تقيس قطعة حقيقية وترسمها على الورق، ثم تعيد بناءها كنموذج مع الرسومات |

في M4 تبقى القطعة معك **ساعتين فقط**، وبعدها تعمل من رسوماتك الورقية. التصوير والمعجون ووسائد الحبر وأي طريقة أخرى لنسخ الشكل غير مسموحة.

## البرنامج
تستخدم المسابقة **Autodesk Inventor** (وتسمح بعض المسابقات أيضًا بـ **Autodesk Fusion**). تعمل على البرنامج المتوفر في يوم المسابقة.

## مجلد النتائج
في كل يوم تسلّم عملك في هيكل مجلدات ثابت يحمل رمزك كمتسابق:

- **CODE / DAY 01 / Results /** وفيه المجلدات: 2D Drawings وَ 3D Scannings وَ Animations وَ Parts and Assemblies وَ PDF files وَ Rendered Images وَ Reports وَ STL files
- **CODE / DAY 01 / Workspace /** لملفات العمل

تُسلَّم رسومات النتائج بصيغة PDF. ابنِ هذه العادة من الآن، فتجاربنا تستخدم الهيكل نفسه.

## الرسومات
تأتي الرسومات بطريقة **الإسقاط الأول**. يجب أن تقرأ الإسقاطين الأول والثالث، ويمكنك أن تجيب بأي منهما.

## قواعد يوم المسابقة
لا إنترنت، ولا هواتف، ولا ساعات ذكية أو سماعات لاسلكية، ولا ذاكرات USB، ولا حديث مع الخبراء خلال اليوم. يمكنك إحضار أدوات القياس المسموحة، وفأرة ثلاثية الأبعاد، ولوحة مفاتيح وفأرة خاصة بك، وكتاب المعايير.

## كيف تُمنح الدرجات
- درجات **القياس** صحيحة أو خاطئة: درجة كاملة أو صفر (مثل: "حجم القطعة صحيح").
- درجات **التقدير** يمنحها الحكّام من 0 إلى 3: **0** أقل من معيار الصناعة، **1** يطابق معيار الصناعة، **2** يطابقه ويتجاوزه في بعض الجوانب، **3** ممتاز.

معظم الدرجات درجات قياس، لذلك تهمّ الدقة واكتمال المطلوب أكثر من الأسلوب.$t$,
   null, null, array['first-angle-projection', 'third-angle-projection', '3d-pdf']),
  ('cc083000-0000-4000-8000-000000000303', 'orientation', 0, 'how-to-study', 3, 1, null,
   'How to study', 'كيف تذاكر',
   array[$t$Plan a realistic study week$t$, $t$Practise exercises in a way that builds speed$t$, $t$Start timing yourself at the right moment$t$],
   array[$t$تخطط لأسبوع دراسة واقعي$t$, $t$تتدرب على التمارين بطريقة تبني السرعة$t$, $t$تبدأ بقياس وقتك في الوقت المناسب$t$],
   8, true, '{}',
   $t$## A suggested week
- **3 sessions** a week of **60 to 90 minutes** each work better than one long day.
- Each session: watch one or two lessons, then do the exercises straight away while the steps are fresh.

## Practise twice
Do every exercise **twice**: once to learn it (use the lesson and the hints), and once from memory a few days later. The second time is where speed comes from.

## Time yourself from Level 4
From **Foundations Level 4** onwards, write down how long each exercise takes you. The competition days are long, and most lost marks come from running out of time.

## Keep a mistakes list
When an exercise fails, write one line about why (wrong units, missed fillet, wrong origin). Read the list before your next session.

## Use the competition folder from day one
Save your work in a **Results** and **Workspace** folder structure, like the real competition (see "How the real competition works").

## Ask early
If you are stuck for more than 20 minutes, use **Ask a question** under the lesson. Asking is part of training.$t$,
   $t$## أسبوع مقترح
- **3 جلسات** في الأسبوع، مدة كل منها **من 60 إلى 90 دقيقة**، أفضل من يوم واحد طويل.
- في كل جلسة: شاهد درسًا أو درسين، ثم حلّ التمارين فورًا والخطوات ما زالت في ذهنك.

## تدرّب مرتين
حلّ كل تمرين **مرتين**: مرة لتتعلمه (استعن بالدرس والتلميحات)، ومرة من الذاكرة بعد بضعة أيام. في المرة الثانية تكتسب السرعة.

## قِس وقتك من المستوى 4
بدءًا من **المستوى 4 في الأساسيات**، سجّل كم يستغرق كل تمرين. أيام المسابقة طويلة، ومعظم الدرجات تضيع بسبب نفاد الوقت.

## دوّن أخطاءك
عندما لا ينجح تمرين، اكتب سطرًا واحدًا عن السبب (وحدات خاطئة، تدوير حافة منسي، نقطة أصل خاطئة). اقرأ القائمة قبل جلستك التالية.

## استخدم مجلد المسابقة من اليوم الأول
احفظ عملك في هيكل مجلدَي **Results** وَ **Workspace** كما في المسابقة الحقيقية (انظر درس "كيف تجري المسابقة الحقيقية").

## اسأل مبكرًا
إذا توقفت أكثر من 20 دقيقة، استخدم **اطرح سؤالًا** تحت الدرس. السؤال جزء من التدريب.$t$,
   null, null, array[]::text[]),

  -- ===================================================== Foundations L1 (free preview)
  ('cc083000-0000-4000-8000-000000000311', 'foundations', 1, 'f1-sketch-and-extrude', 1, 3, 'M3',
   'Sketch, constrain and extrude', 'ارسم وقيّد وابثق',
   array[$t$Draw a sketch and make it fully constrained$t$, $t$Extrude a profile to an exact depth$t$],
   array[$t$ترسم مقطعًا وتقيّده بالكامل$t$, $t$تبثق المقطع إلى عمق محدد بدقة$t$],
   15, true, '{}', null, null, null, null, array['part', 'dimension']),
  ('cc083000-0000-4000-8000-000000000312', 'foundations', 1, 'f1-units-material-step', 2, 2, null,
   'Units, material and STEP export', 'الوحدات والمادة وتصدير STEP',
   array[$t$Set millimetres and the right material and density$t$, $t$Export a clean STEP file ready to upload$t$],
   array[$t$تضبط المليمتر والمادة والكثافة الصحيحة$t$, $t$تصدّر ملف STEP سليمًا جاهزًا للرفع$t$],
   10, true, '{}', null, null, null, null, array['units-mm', 'material-density', 'step-file']),

  -- ===================================================== Foundations L2
  ('cc083000-0000-4000-8000-000000000321', 'foundations', 2, 'f2-holes-pockets', 1, 3, 'M3',
   'Holes and pockets', 'الثقوب والجيوب',
   array[$t$Place through holes from a drawing$t$, $t$Cut pockets to the right depth$t$],
   array[$t$تضع الثقوب النافذة كما في الرسم$t$, $t$تقطع الجيوب بالعمق الصحيح$t$],
   15, false, '{}', null, null, null, null, array['dimension']),
  ('cc083000-0000-4000-8000-000000000322', 'foundations', 2, 'f2-fillets-chamfers', 2, 3, 'M3',
   'Fillets and chamfers', 'تدوير الحواف وشطفها',
   array[$t$Add fillets and chamfers to the right edges$t$, $t$Choose the right order of features$t$],
   array[$t$تضيف التدوير والشطف للحواف الصحيحة$t$, $t$تختار الترتيب الصحيح للعمليات$t$],
   10, false, '{}', null, null, null, null, array[]::text[]),

  -- ===================================================== Foundations L3
  ('cc083000-0000-4000-8000-000000000331', 'foundations', 3, 'f3-revolve-sweep', 1, 3, 'M3',
   'Revolve and sweep', 'الدوران والسحب على مسار',
   array[$t$Revolve a profile around an axis$t$, $t$Sweep a profile along a path$t$],
   array[$t$تدير مقطعًا حول محور$t$, $t$تسحب مقطعًا على مسار$t$],
   15, false, '{}', null, null, null, null, array[]::text[]),
  ('cc083000-0000-4000-8000-000000000332', 'foundations', 3, 'f3-loft-shell', 2, 3, 'M3',
   'Loft and shell', 'الانتقال بين المقاطع والتفريغ',
   array[$t$Loft between two or more profiles$t$, $t$Shell a solid to a wall thickness$t$],
   array[$t$تنشئ انتقالًا بين مقطعين أو أكثر$t$, $t$تفرّغ المجسم بسماكة جدار محددة$t$],
   15, false, '{}', null, null, null, null, array[]::text[]),
  ('cc083000-0000-4000-8000-000000000333', 'foundations', 3, 'f3-patterns', 3, 3, 'M3',
   'Linear and circular patterns', 'الأنماط الخطية والدائرية',
   array[$t$Repeat features in a line or a grid$t$, $t$Repeat features around an axis$t$],
   array[$t$تكرر العناصر على خط أو شبكة$t$, $t$تكرر العناصر حول محور$t$],
   10, false, '{}', null, null, null, null, array[]::text[]),

  -- ===================================================== Foundations L4
  ('cc083000-0000-4000-8000-000000000341', 'foundations', 4, 'f4-parameters', 1, 3, 'M2',
   'Parameters and equations', 'المتغيرات والمعادلات',
   array[$t$Name key dimensions as parameters$t$, $t$Drive one dimension from another with an equation$t$],
   array[$t$تسمّي الأبعاد الأساسية كمتغيرات$t$, $t$تربط بُعدًا ببعد آخر بمعادلة$t$],
   15, false, '{}', null, null, null, null, array[]::text[]),
  ('cc083000-0000-4000-8000-000000000342', 'foundations', 4, 'f4-part-families', 2, 3, 'M2',
   'Part families (iParts)', 'عائلات القطع (iParts)',
   array[$t$Build one part that comes in several sizes$t$, $t$Export each size as its own STEP file$t$],
   array[$t$تبني قطعة واحدة بعدة مقاسات$t$, $t$تصدّر كل مقاس في ملف STEP مستقل$t$],
   15, false,
   $j${"fusion": {"en": "In Fusion, use configurations to make one design in several sizes.", "ar": "في Fusion استخدم الإعدادات (Configurations) لصنع تصميم واحد بعدة مقاسات."}, "solidworks": {"en": "In SOLIDWORKS, use configurations and a design table.", "ar": "في SOLIDWORKS استخدم الإعدادات (Configurations) وجدول التصميم."}}$j$,
   null, null, null, null, array['ipart']),

  -- ===================================================== Foundations L5
  ('cc083000-0000-4000-8000-000000000351', 'foundations', 5, 'f5-constraints', 1, 3, 'M3',
   'Assembly constraints and joints', 'قيود التجميع والمفاصل',
   array[$t$Ground the first part and constrain the rest$t$, $t$Check that nothing moves that should not$t$],
   array[$t$تثبّت القطعة الأولى وتقيّد بقية القطع$t$, $t$تتأكد أن لا شيء يتحرك إلا ما يجب أن يتحرك$t$],
   15, false, '{}', null, null, null, null, array['assembly', 'constraint']),
  ('cc083000-0000-4000-8000-000000000352', 'foundations', 5, 'f5-subassemblies', 2, 3, 'M3',
   'Sub-assemblies', 'التجميعات الفرعية',
   array[$t$Group parts into sub-assemblies$t$, $t$Keep a clean assembly tree$t$],
   array[$t$تجمع القطع في تجميعات فرعية$t$, $t$تحافظ على شجرة تجميع مرتبة$t$],
   10, false, '{}', null, null, null, null, array['sub-assembly']),
  ('cc083000-0000-4000-8000-000000000353', 'foundations', 5, 'f5-mechanisms', 3, 3, 'M2',
   'A simple mechanism', 'آلية بسيطة',
   array[$t$Leave the right degrees of freedom open$t$, $t$Drive a mechanism and check it for collisions$t$],
   array[$t$تترك درجات الحرية الصحيحة مفتوحة$t$, $t$تحرّك الآلية وتتحقق من عدم التصادم$t$],
   15, false, '{}', null, null, null, null, array['assembly']),

  -- ===================================================== Foundations L6 (drawing fundamentals)
  ('cc083000-0000-4000-8000-000000000361', 'foundations', 6, 'f6-projection', 1, 6, 'M3',
   'First and third angle projection', 'الإسقاط الأول والإسقاط الثالث',
   array[$t$Read and place views in first and third angle$t$, $t$Use the projection symbol correctly$t$],
   array[$t$تقرأ المساقط وترتبها بالإسقاط الأول والثالث$t$, $t$تستخدم رمز الإسقاط بشكل صحيح$t$],
   15, false, '{}', null, null, null, null, array['first-angle-projection', 'third-angle-projection']),
  ('cc083000-0000-4000-8000-000000000362', 'foundations', 6, 'f6-views-sections', 2, 6, 'M3',
   'Views and section views', 'المساقط والمقاطع',
   array[$t$Choose the fewest views that show the part fully$t$, $t$Add hatched section views with labelled cutting planes$t$],
   array[$t$تختار أقل عدد من المساقط يوضح القطعة بالكامل$t$, $t$تضيف مقاطع مهشّرة بمستويات قطع مسمّاة$t$],
   15, false, '{}', null, null, null, null, array['section-view', 'hatching']),
  ('cc083000-0000-4000-8000-000000000363', 'foundations', 6, 'f6-dimensioning', 3, 6, 'M3',
   'Dimensioning rules and the title block', 'قواعد الأبعاد وجدول العنوان',
   array[$t$Dimension every feature once, with no duplicates$t$, $t$Fill in a complete title block$t$],
   array[$t$تضع بُعدًا لكل عنصر مرة واحدة دون تكرار$t$, $t$تملأ جدول العنوان بالكامل$t$],
   15, false, '{}', null, null, null, null, array['dimension', 'title-block', 'iso-standard']),
  ('cc083000-0000-4000-8000-000000000364', 'foundations', 6, 'f6-parts-lists', 4, 6, 'M3',
   'Parts lists and balloons', 'قوائم القطع والأرقام الدائرية',
   array[$t$Add a parts list with more than one column$t$, $t$Balloon every part in the assembly drawing$t$],
   array[$t$تضيف قائمة قطع بأكثر من عمود$t$, $t$تضع رقمًا دائريًا لكل قطعة في رسم التجميع$t$],
   10, false, '{}', null, null, null, null, array['parts-list', 'balloon', 'nomenclature']),
  ('cc083000-0000-4000-8000-000000000365', 'foundations', 6, 'f6-tolerances', 5, 6, 'M3',
   'General tolerances, limits and fits', 'التفاوتات العامة والحدود والتوافقات',
   array[$t$Add a general tolerance note$t$, $t$Write limits and fits such as H7/g6 where needed$t$],
   array[$t$تضيف ملاحظة التفاوت العام$t$, $t$تكتب الحدود والتوافقات مثل H7/g6 عند الحاجة$t$],
   15, false, '{}', null, null, null, null, array['tolerance', 'general-tolerance-iso-2768', 'limits-and-fits']),
  ('cc083000-0000-4000-8000-000000000366', 'foundations', 6, 'f6-surface-gdt', 6, 6, 'M3',
   'Surface texture and GD&T basics', 'خشونة السطح وأساسيات GD&T',
   array[$t$Add surface texture symbols$t$, $t$Add datums and simple GD&T frames$t$],
   array[$t$تضيف رموز خشونة السطح$t$, $t$تضيف المراجع وإطارات GD&T البسيطة$t$],
   15, false, '{}', null, null, null, null, array['surface-texture-ra', 'gdt', 'datum']),
  ('cc083000-0000-4000-8000-000000000367', 'foundations', 6, 'f6-exploded-isometric', 7, 6, 'M3',
   'Exploded isometric views', 'المساقط المجسّمة المفككة',
   array[$t$Create an exploded view of an assembly$t$, $t$Place it on the drawing with balloons$t$],
   array[$t$تنشئ مسقطًا مفككًا للتجميع$t$, $t$تضعه في الرسم مع الأرقام الدائرية$t$],
   10, false, '{}', null, null, null, null, array['exploded-view'])
) as v(id, module_slug, n, slug, sort, skill, cm, title_en, title_ar, obj_en, obj_ar, minutes, free, notes,
       notes_en, notes_ar, mist_en, mist_ar, terms)
join public.cc_modules m on m.slug = v.module_slug
join public.cc_courses c on c.id = m.course_id and c.slug = 'cad-champions'
join public.cc_levels lv on lv.module_id = m.id and lv.level_number = v.n
on conflict (slug) do update set
  level_id = excluded.level_id, competition_module = excluded.competition_module,
  skill_area_id = excluded.skill_area_id, sort = excluded.sort,
  title_en = excluded.title_en, title_ar = excluded.title_ar,
  objectives_en = excluded.objectives_en, objectives_ar = excluded.objectives_ar,
  duration_minutes = excluded.duration_minutes,
  notes_en = coalesce(excluded.notes_en, public.cc_lessons.notes_en),
  notes_ar = coalesce(excluded.notes_ar, public.cc_lessons.notes_ar),
  common_mistakes_en = coalesce(excluded.common_mistakes_en, public.cc_lessons.common_mistakes_en),
  common_mistakes_ar = coalesce(excluded.common_mistakes_ar, public.cc_lessons.common_mistakes_ar),
  glossary_terms = excluded.glossary_terms, is_free_preview = excluded.is_free_preview,
  track_notes = excluded.track_notes, is_published = excluded.is_published;

-- Competition-module tracks: titled placeholder lessons with objectives.
-- track_notes: "inventor_only" = the tool exists only in Inventor; an
-- {"en","ar"} object = the closest equivalent workflow in that track.
insert into public.cc_lessons
  (id, level_id, competition_module, skill_area_id, slug, sort, title_en, title_ar, objectives_en, objectives_ar,
   duration_minutes, glossary_terms, is_free_preview, track_notes, is_published)
select v.id::uuid, lv.id, v.cm, v.skill::smallint, v.slug, v.sort, v.title_en, v.title_ar, v.obj_en, v.obj_ar,
       v.minutes, v.terms, false, v.notes::jsonb, true
from (values
  -- ===================================================== M1 Mechanical fabrication
  ('cc083000-0000-4000-8000-000000000401', 'm1-fabrication', 1, 'm1-sheet-metal-basics', 1, 3, 'M1',
   'Sheet metal: flanges and bends', 'الصفائح المعدنية: الحواف والثنيات',
   array[$t$Set sheet metal rules (thickness, bend radius)$t$, $t$Add faces, flanges and bends$t$],
   array[$t$تضبط قواعد الصفائح (السماكة ونصف قطر الثني)$t$, $t$تضيف الأوجه والحواف والثنيات$t$],
   20, array['sheet-metal', 'bend-allowance'],
   $j${"fusion": {"en": "Fusion has its own sheet metal tools (flange, bend, flat pattern). The steps match.", "ar": "في Fusion أدوات صفائح خاصة به (الحافة والثني والشكل المفرود)، والخطوات متشابهة."}, "solidworks": {"en": "Use SOLIDWORKS sheet metal (base flange, edge flange, flatten). The steps match.", "ar": "استخدم أدوات الصفائح في SOLIDWORKS (Base Flange وEdge Flange وFlatten)، والخطوات متشابهة."}}$j$),
  ('cc083000-0000-4000-8000-000000000402', 'm1-fabrication', 1, 'm1-flat-patterns', 2, 6, 'M1',
   'Flat patterns and bend notes', 'الأشكال المفرودة وملاحظات الثني',
   array[$t$Create the flat pattern of a sheet metal part$t$, $t$Put the flat pattern on a drawing with bend notes$t$],
   array[$t$تنشئ الشكل المفرود لقطعة الصفائح$t$, $t$تضع الشكل المفرود في الرسم مع ملاحظات الثني$t$],
   15, array['flat-pattern', 'sheet-metal'],
   $j${"fusion": {"en": "Fusion creates flat patterns and can place them on drawings.", "ar": "ينشئ Fusion الأشكال المفرودة ويمكنه وضعها في الرسومات."}, "solidworks": {"en": "SOLIDWORKS shows the flat pattern as a drawing view with bend notes.", "ar": "يعرض SOLIDWORKS الشكل المفرود كمسقط في الرسم مع ملاحظات الثني."}}$j$),
  ('cc083000-0000-4000-8000-000000000403', 'm1-fabrication', 2, 'm1-frame-generator', 1, 3, 'M1',
   'Frame Generator: frames, end treatments, trim and extend', 'Frame Generator: الهياكل ومعالجة الأطراف والقص والتمديد',
   array[$t$Insert frame members on a skeleton$t$, $t$Apply end treatments: miter, trim and extend$t$],
   array[$t$تُدرج أعضاء الهيكل على هيكل مرجعي$t$, $t$تعالج الأطراف: الزاوية المائلة والقص والتمديد$t$],
   25, array['frame-generator'],
   $j${"fusion": "inventor_only", "solidworks": {"en": "The closest SOLIDWORKS workflow is weldments (structure system).", "ar": "أقرب طريقة في SOLIDWORKS هي اللحامات (Weldments / Structure System)."}}$j$),
  ('cc083000-0000-4000-8000-000000000404', 'm1-fabrication', 2, 'm1-weldments', 2, 3, 'M1',
   'Weld beads and weld symbols', 'خطوط اللحام ورموز اللحام',
   array[$t$Add weld beads to a weldment$t$, $t$Show welds with the right symbols on drawings$t$],
   array[$t$تضيف خطوط اللحام إلى التجميع الملحوم$t$, $t$تُظهر اللحامات بالرموز الصحيحة في الرسومات$t$],
   20, array['weldment', 'weld-symbol'],
   $j${"fusion": "inventor_only", "solidworks": {"en": "Use SOLIDWORKS weldments with weld beads and weld symbols.", "ar": "استخدم اللحامات في SOLIDWORKS مع خطوط اللحام ورموزه."}}$j$),
  ('cc083000-0000-4000-8000-000000000405', 'm1-fabrication', 3, 'm1-bolted-connections', 1, 3, 'M1',
   'Bolted connections', 'وصلات البراغي',
   array[$t$Add bolts, washers and nuts in the right sizes$t$, $t$Match hole sizes to the fasteners$t$],
   array[$t$تضيف البراغي والحلقات والصواميل بالمقاسات الصحيحة$t$, $t$تطابق مقاسات الثقوب مع المثبتات$t$],
   15, array['bolted-connection', 'content-centre'],
   $j${"solidworks": {"en": "Use SOLIDWORKS Toolbox for standard fasteners.", "ar": "استخدم SOLIDWORKS Toolbox للمثبتات القياسية."}}$j$),
  ('cc083000-0000-4000-8000-000000000406', 'm1-fabrication', 3, 'm1-tube-pipe', 2, 3, 'M1',
   'Tube & Pipe', 'الأنابيب (Tube & Pipe)',
   array[$t$Route a pipe run with fittings$t$, $t$Keep routes clear of other parts$t$],
   array[$t$تمدّد خط أنابيب مع الوصلات$t$, $t$تُبعد المسارات عن القطع الأخرى$t$],
   20, array['tube-and-pipe'],
   $j${"fusion": "inventor_only", "solidworks": "inventor_only"}$j$),
  ('cc083000-0000-4000-8000-000000000407', 'm1-fabrication', 3, 'm1-cable-harness', 3, 3, 'M1',
   'Cable & Harness', 'الكابلات والأسلاك (Cable & Harness)',
   array[$t$Place wires and cables between connectors$t$, $t$Create a simple harness$t$],
   array[$t$تضع الأسلاك والكابلات بين الموصلات$t$, $t$تنشئ حزمة أسلاك بسيطة$t$],
   20, array['cable-and-harness'],
   $j${"fusion": "inventor_only", "solidworks": "inventor_only"}$j$),
  ('cc083000-0000-4000-8000-000000000408', 'm1-fabrication', 4, 'm1-exploded-animation', 1, 4, 'M1',
   'Exploded and collapsing animation (.avi)', 'مقطع التفكيك والتجميع (.avi)',
   array[$t$Build an exploded and collapsing animation$t$, $t$Export it as an .avi video$t$],
   array[$t$تبني مقطع تحريك للتفكيك والتجميع$t$, $t$تصدّره كفيديو .avi$t$],
   20, array['exploded-view', 'collapsing-animation', 'animation'],
   $j${"fusion": {"en": "Use the Fusion Animation workspace.", "ar": "استخدم مساحة Animation في Fusion."}, "solidworks": {"en": "Use a SOLIDWORKS motion study (Animation).", "ar": "استخدم دراسة الحركة في SOLIDWORKS (Animation)."}}$j$),
  ('cc083000-0000-4000-8000-000000000409', 'm1-fabrication', 4, 'm1-fabrication-drawings', 2, 6, 'M1',
   'Presenting fabrication drawings', 'عرض رسومات التصنيع',
   array[$t$Lay out assembly and detail drawings for the workshop$t$, $t$Check the set is complete before you hand in$t$],
   array[$t$ترتب رسومات التجميع والتفاصيل للورشة$t$, $t$تتأكد من اكتمال المجموعة قبل التسليم$t$],
   20, array['detail-drawing', 'parts-list'], '{}'),

  -- ===================================================== M2 Mechanical design challenge
  ('cc083000-0000-4000-8000-000000000411', 'm2-design-challenge', 1, 'm2-reading-brief', 1, 1, 'M2',
   'Reading a design brief and specification', 'قراءة موجز التصميم والمواصفات',
   array[$t$Turn a brief into a checklist of requirements$t$, $t$Plan your day around the deliverables$t$],
   array[$t$تحوّل الموجز إلى قائمة متطلبات$t$, $t$تخطط يومك حول ما يجب تسليمه$t$],
   15, array['design-brief'], '{}'),
  ('cc083000-0000-4000-8000-000000000412', 'm2-design-challenge', 1, 'm2-parametric-changes', 2, 3, 'M2',
   'Changing an existing assembly parametrically', 'تعديل تجميع جاهز بالمتغيرات',
   array[$t$Find the parameters that control a design$t$, $t$Change them without breaking the assembly$t$],
   array[$t$تجد المتغيرات التي تتحكم في التصميم$t$, $t$تعدّلها دون أن يتعطل التجميع$t$],
   20, array['assembly'], '{}'),
  ('cc083000-0000-4000-8000-000000000413', 'm2-design-challenge', 2, 'm2-shafts-bearings', 1, 3, 'M2',
   'Design Accelerator: shafts and bearings', 'Design Accelerator: الأعمدة والمحامل',
   array[$t$Generate a shaft with its sections and features$t$, $t$Select and place bearings$t$],
   array[$t$تولّد عمودًا بأقسامه وتفاصيله$t$, $t$تختار المحامل وتضعها$t$],
   20, array['design-accelerator'],
   $j${"fusion": "inventor_only", "solidworks": {"en": "The closest SOLIDWORKS workflow is Toolbox (bearings) with a modelled shaft.", "ar": "أقرب طريقة في SOLIDWORKS هي Toolbox للمحامل مع نمذجة العمود يدويًا."}}$j$),
  ('cc083000-0000-4000-8000-000000000414', 'm2-design-challenge', 2, 'm2-gears', 2, 3, 'M2',
   'Design Accelerator: gears', 'Design Accelerator: التروس',
   array[$t$Generate a gear pair from module and teeth$t$, $t$Check the centre distance$t$],
   array[$t$تولّد زوج تروس من الموديول وعدد الأسنان$t$, $t$تتحقق من المسافة بين المركزين$t$],
   20, array['design-accelerator'],
   $j${"fusion": "inventor_only", "solidworks": {"en": "The closest SOLIDWORKS workflow is Toolbox gears.", "ar": "أقرب طريقة في SOLIDWORKS هي تروس Toolbox."}}$j$),
  ('cc083000-0000-4000-8000-000000000415', 'm2-design-challenge', 2, 'm2-da-bolted', 3, 3, 'M2',
   'Design Accelerator: bolted connections', 'Design Accelerator: وصلات البراغي',
   array[$t$Generate a bolted connection through several parts$t$, $t$Let the generator size the holes$t$],
   array[$t$تولّد وصلة براغٍ عبر عدة قطع$t$, $t$تترك المولّد يحدد مقاسات الثقوب$t$],
   15, array['design-accelerator', 'bolted-connection'],
   $j${"fusion": "inventor_only", "solidworks": {"en": "The closest SOLIDWORKS workflow is Toolbox with the hole wizard.", "ar": "أقرب طريقة في SOLIDWORKS هي Toolbox مع معالج الثقوب."}}$j$),
  ('cc083000-0000-4000-8000-000000000416', 'm2-design-challenge', 3, 'm2-studio-scenes', 1, 4, 'M2',
   'Renders: lighting and scenes', 'الصور الواقعية: الإضاءة والمشهد',
   array[$t$Choose a lighting style and scene$t$, $t$Make the product the clear focus$t$],
   array[$t$تختار نمط الإضاءة والمشهد$t$, $t$تجعل المنتج محور الصورة بوضوح$t$],
   15, array['inventor-studio', 'render'],
   $j${"fusion": {"en": "Use the Fusion Render workspace.", "ar": "استخدم مساحة Render في Fusion."}, "solidworks": {"en": "Use SOLIDWORKS Visualize.", "ar": "استخدم SOLIDWORKS Visualize."}}$j$),
  ('cc083000-0000-4000-8000-000000000417', 'm2-design-challenge', 3, 'm2-studio-materials-camera', 2, 4, 'M2',
   'Renders: materials, decals, camera and A3 output', 'الصور الواقعية: المواد والملصقات والكاميرا وإخراج A3',
   array[$t$Apply materials and decals$t$, $t$Set the camera and render up to A3$t$],
   array[$t$تطبّق المواد والملصقات$t$, $t$تضبط الكاميرا وتُخرج الصورة حتى مقاس A3$t$],
   20, array['inventor-studio', 'render'],
   $j${"fusion": {"en": "Use the Fusion Render workspace.", "ar": "استخدم مساحة Render في Fusion."}, "solidworks": {"en": "Use SOLIDWORKS Visualize.", "ar": "استخدم SOLIDWORKS Visualize."}}$j$),
  ('cc083000-0000-4000-8000-000000000418', 'm2-design-challenge', 4, 'm2-physical-simulation', 1, 4, 'M2',
   'Animation: physical simulation', 'التحريك: المحاكاة الفيزيائية',
   array[$t$Simulate a mechanism moving under its joints$t$, $t$Export the simulation as a video$t$],
   array[$t$تحاكي حركة آلية وفق مفاصلها$t$, $t$تصدّر المحاكاة كفيديو$t$],
   20, array['physical-simulation', 'animation'],
   $j${"fusion": {"en": "Use Fusion motion studies and the Animation workspace.", "ar": "استخدم دراسات الحركة ومساحة Animation في Fusion."}, "solidworks": {"en": "Use SOLIDWORKS motion studies.", "ar": "استخدم دراسات الحركة في SOLIDWORKS."}}$j$),
  ('cc083000-0000-4000-8000-000000000419', 'm2-design-challenge', 4, 'm2-exploded-collapsing', 2, 4, 'M2',
   'Animation: exploded and collapsing', 'التحريك: التفكيك والتجميع',
   array[$t$Plan the order parts move in$t$, $t$Export a smooth exploded and collapsing animation$t$],
   array[$t$تخطط ترتيب حركة القطع$t$, $t$تصدّر مقطع تفكيك وتجميع سلسًا$t$],
   15, array['exploded-view', 'collapsing-animation'],
   $j${"fusion": {"en": "Use the Fusion Animation workspace.", "ar": "استخدم مساحة Animation في Fusion."}, "solidworks": {"en": "Use a SOLIDWORKS motion study (Animation).", "ar": "استخدم دراسة الحركة في SOLIDWORKS (Animation)."}}$j$),
  ('cc083000-0000-4000-8000-00000000041a', 'm2-design-challenge', 5, 'm2-3d-printing', 1, 2, 'M2',
   'Designing parts for 3D printing and exporting STL', 'تصميم القطع للطباعة ثلاثية الأبعاد وتصدير STL',
   array[$t$Design for printing: walls, overhangs and clearances$t$, $t$Export a clean STL file$t$],
   array[$t$تصمم للطباعة: الجدران والبروزات والخلوص$t$, $t$تصدّر ملف STL سليمًا$t$],
   20, array['stl'], '{}'),

  -- ===================================================== M3 Assemblies and detail drawings
  ('cc083000-0000-4000-8000-000000000421', 'm3-assemblies-drawings', 1, 'm3-model-from-drawings', 1, 3, 'M3',
   'Modelling from detail drawings, fast and accurate', 'النمذجة من رسومات التفاصيل بسرعة ودقة',
   array[$t$Read every dimension before you start$t$, $t$Build the part in the fewest clean features$t$],
   array[$t$تقرأ كل الأبعاد قبل أن تبدأ$t$, $t$تبني القطعة بأقل عدد من العمليات النظيفة$t$],
   20, array['detail-drawing', 'first-angle-projection'], '{}'),
  ('cc083000-0000-4000-8000-000000000422', 'm3-assemblies-drawings', 1, 'm3-time-strategy', 2, 1, 'M3',
   'Working fast: a modelling routine', 'العمل بسرعة: روتين للنمذجة',
   array[$t$Split a 6-hour day into time blocks$t$, $t$Save and name files the competition way$t$],
   array[$t$تقسم يوم الست ساعات إلى فترات زمنية$t$, $t$تحفظ الملفات وتسمّيها بطريقة المسابقة$t$],
   15, array[]::text[], '{}'),
  ('cc083000-0000-4000-8000-000000000423', 'm3-assemblies-drawings', 2, 'm3-content-centre', 1, 3, 'M3',
   'Standard parts from Content Centre', 'القطع القياسية من Content Centre',
   array[$t$Find the right standard part and size$t$, $t$Place it with the right constraints$t$],
   array[$t$تجد القطعة القياسية والمقاس الصحيح$t$, $t$تضعها بالقيود الصحيحة$t$],
   15, array['content-centre'],
   $j${"solidworks": {"en": "The closest SOLIDWORKS workflow is Toolbox.", "ar": "أقرب طريقة في SOLIDWORKS هي Toolbox."}}$j$),
  ('cc083000-0000-4000-8000-000000000424', 'm3-assemblies-drawings', 3, 'm3-detail-drawings', 1, 6, 'M3',
   'Detail drawings for manufacture', 'رسومات التفاصيل للتصنيع',
   array[$t$Make a drawing a workshop can make the part from$t$, $t$Check it against the drawing rubric$t$],
   array[$t$تعدّ رسمًا تستطيع الورشة تصنيع القطعة منه$t$, $t$تراجعه وفق معايير تقييم الرسم$t$],
   20, array['detail-drawing', 'title-block'], '{}'),
  ('cc083000-0000-4000-8000-000000000425', 'm3-assemblies-drawings', 3, 'm3-gdt-fits-practice', 2, 6, 'M3',
   'GD&T and limits and fits in practice', 'GD&T والحدود والتوافقات عمليًا',
   array[$t$Choose fits for mating parts$t$, $t$Add the GD&T a function really needs$t$],
   array[$t$تختار التوافقات للقطع المتلامسة$t$, $t$تضيف رموز GD&T التي تحتاجها الوظيفة فعلًا$t$],
   20, array['gdt', 'limits-and-fits', 'datum'], '{}'),
  ('cc083000-0000-4000-8000-000000000426', 'm3-assemblies-drawings', 4, 'm3-multi-column-parts-list', 1, 6, 'M3',
   'Nomenclature: multi-column parts lists', 'قائمة القطع متعددة الأعمدة',
   array[$t$Set up parts list columns (item, quantity, name, material, standard)$t$, $t$Keep part properties correct so the list fills itself$t$],
   array[$t$تضبط أعمدة قائمة القطع (الرقم والكمية والاسم والمادة والمعيار)$t$, $t$تضبط خصائص القطع لتمتلئ القائمة تلقائيًا$t$],
   15, array['nomenclature', 'parts-list'], '{}'),
  ('cc083000-0000-4000-8000-000000000427', 'm3-assemblies-drawings', 4, 'm3-exploded-views', 2, 6, 'M3',
   'Exploded views', 'المساقط المفككة',
   array[$t$Create exploded views with trails$t$, $t$Place them on the assembly drawing$t$],
   array[$t$تنشئ مساقط مفككة مع خطوط المسار$t$, $t$تضعها في رسم التجميع$t$],
   15, array['exploded-view'], '{}'),
  ('cc083000-0000-4000-8000-000000000428', 'm3-assemblies-drawings', 4, 'm3-simulation-animation', 3, 4, 'M3',
   'Simulation animation', 'مقطع المحاكاة',
   array[$t$Animate how the assembly moves$t$, $t$Export it in the required format$t$],
   array[$t$تحرّك التجميع كما يعمل فعلًا$t$, $t$تصدّره بالصيغة المطلوبة$t$],
   15, array['physical-simulation', 'animation'],
   $j${"fusion": {"en": "Use Fusion motion studies and the Animation workspace.", "ar": "استخدم دراسات الحركة ومساحة Animation في Fusion."}, "solidworks": {"en": "Use SOLIDWORKS motion studies.", "ar": "استخدم دراسات الحركة في SOLIDWORKS."}}$j$),

  -- ===================================================== M4 Reverse engineering
  ('cc083000-0000-4000-8000-000000000431', 'm4-reverse-engineering', 1, 'm4-digital-caliper', 1, 5, 'M4',
   'The digital caliper', 'القدمة الرقمية',
   array[$t$Measure outside, inside and step dimensions$t$, $t$Zero the caliper and avoid tilting it$t$],
   array[$t$تقيس الأبعاد الخارجية والداخلية والدرجات$t$, $t$تصفّر القدمة وتتجنب إمالتها$t$],
   10, array['caliper'], '{}'),
  ('cc083000-0000-4000-8000-000000000432', 'm4-reverse-engineering', 1, 'm4-offset-centerline-caliper', 2, 5, 'M4',
   'The offset centerline caliper', 'قدمة المسافة بين المراكز',
   array[$t$Measure hole centre distances$t$, $t$Measure from an edge to a hole centre$t$],
   array[$t$تقيس المسافة بين مراكز الثقوب$t$, $t$تقيس من حافة إلى مركز ثقب$t$],
   10, array['offset-centerline-caliper'], '{}'),
  ('cc083000-0000-4000-8000-000000000433', 'm4-reverse-engineering', 1, 'm4-protractor', 3, 5, 'M4',
   'The protractor', 'المنقلة',
   array[$t$Measure angles between faces$t$, $t$Read a digital or universal protractor$t$],
   array[$t$تقيس الزوايا بين الأوجه$t$, $t$تقرأ المنقلة الرقمية أو الشاملة$t$],
   10, array[]::text[], '{}'),
  ('cc083000-0000-4000-8000-000000000434', 'm4-reverse-engineering', 1, 'm4-radius-gauges', 4, 5, 'M4',
   'Radius gauges', 'مقاييس نصف القطر',
   array[$t$Find inside and outside radii$t$, $t$Check the gauge against the light$t$],
   array[$t$تجد أنصاف الأقطار الداخلية والخارجية$t$, $t$تتحقق من المقياس مقابل الضوء$t$],
   10, array['radius-gauge'], '{}'),
  ('cc083000-0000-4000-8000-000000000435', 'm4-reverse-engineering', 1, 'm4-thread-pitch-gauges', 5, 5, 'M4',
   'Thread pitch gauges', 'مقاييس خطوة السن',
   array[$t$Find the pitch of external and internal threads$t$, $t$Name a metric thread such as M8x1.25$t$],
   array[$t$تجد خطوة الأسنان الخارجية والداخلية$t$, $t$تسمّي السن المتري مثل M8x1.25$t$],
   10, array['thread-pitch-gauge'], '{}'),
  ('cc083000-0000-4000-8000-000000000436', 'm4-reverse-engineering', 1, 'm4-roughness-comparator', 6, 5, 'M4',
   'The surface roughness comparator', 'مقارن خشونة السطح',
   array[$t$Compare a surface with the reference samples$t$, $t$Write the Ra value on your sketch$t$],
   array[$t$تقارن السطح بالعينات المرجعية$t$, $t$تكتب قيمة Ra على رسمك$t$],
   10, array['surface-texture-ra'], '{}'),
  ('cc083000-0000-4000-8000-000000000437', 'm4-reverse-engineering', 1, 'm4-steel-ruler', 7, 5, 'M4',
   'The steel ruler', 'المسطرة الفولاذية',
   array[$t$Measure long lengths quickly$t$, $t$Avoid parallax errors$t$],
   array[$t$تقيس الأطوال الكبيرة بسرعة$t$, $t$تتجنب أخطاء زاوية النظر$t$],
   5, array[]::text[], '{}'),
  ('cc083000-0000-4000-8000-000000000438', 'm4-reverse-engineering', 1, 'm4-depth-gauge', 8, 5, 'M4',
   'The depth gauge caliper', 'قدمة قياس العمق',
   array[$t$Measure the depth of holes, pockets and steps$t$, $t$Keep the base flat on the reference face$t$],
   array[$t$تقيس عمق الثقوب والجيوب والدرجات$t$, $t$تبقي القاعدة مستوية على الوجه المرجعي$t$],
   10, array['depth-gauge'], '{}'),
  ('cc083000-0000-4000-8000-000000000441', 'm4-reverse-engineering', 2, 'm4-measuring-strategy', 1, 5, 'M4',
   'Measuring strategy under a 2-hour limit', 'خطة القياس خلال ساعتين',
   array[$t$Plan what to measure first$t$, $t$Check you have every dimension before the part is collected$t$],
   array[$t$تخطط لما تقيسه أولًا$t$, $t$تتأكد أن لديك كل الأبعاد قبل سحب القطعة$t$],
   15, array['reverse-engineering'], '{}'),
  ('cc083000-0000-4000-8000-000000000442', 'm4-reverse-engineering', 2, 'm4-freehand-sketching', 2, 5, 'M4',
   'Freehand dimensioned sketches on paper', 'الرسم اليدوي بالأبعاد على الورق',
   array[$t$Sketch clear views by hand$t$, $t$Write dimensions so nothing is missed$t$],
   array[$t$ترسم مساقط واضحة باليد$t$, $t$تكتب الأبعاد بحيث لا يفوتك شيء$t$],
   15, array[]::text[], '{}'),
  ('cc083000-0000-4000-8000-000000000443', 'm4-reverse-engineering', 2, 'm4-threads-radii', 3, 5, 'M4',
   'Identifying threads and radii', 'التعرف على الأسنان وأنصاف الأقطار',
   array[$t$Identify standard metric threads$t$, $t$Identify standard radii$t$],
   array[$t$تتعرف على الأسنان المترية القياسية$t$, $t$تتعرف على أنصاف الأقطار القياسية$t$],
   10, array['thread-pitch-gauge', 'radius-gauge'], '{}'),
  ('cc083000-0000-4000-8000-000000000444', 'm4-reverse-engineering', 2, 'm4-roughness-estimation', 4, 5, 'M4',
   'Estimating surface roughness', 'تقدير خشونة السطح',
   array[$t$Estimate Ra for machined surfaces$t$, $t$Choose the surface symbol for the drawing$t$],
   array[$t$تقدّر قيمة Ra للأسطح المشغولة$t$, $t$تختار رمز السطح المناسب للرسم$t$],
   10, array['surface-texture-ra'], '{}'),
  ('cc083000-0000-4000-8000-000000000451', 'm4-reverse-engineering', 3, 'm4-sketch-to-model', 1, 3, 'M4',
   'Turning sketches into models', 'تحويل الرسومات اليدوية إلى نماذج',
   array[$t$Model a part from your own sketches$t$, $t$Spot and fix missing dimensions$t$],
   array[$t$تنمذج القطعة من رسوماتك$t$, $t$تكتشف الأبعاد الناقصة وتعالجها$t$],
   20, array['reverse-engineering'], '{}'),
  ('cc083000-0000-4000-8000-000000000452', 'm4-reverse-engineering', 3, 'm4-mbd', 2, 6, 'M4',
   'MBD and 3D annotation', 'التعريف المعتمد على النموذج والتوصيف ثلاثي الأبعاد',
   array[$t$Add dimensions and tolerances on the 3D model$t$, $t$Export a 3D-PDF$t$],
   array[$t$تضيف الأبعاد والتفاوتات على النموذج ثلاثي الأبعاد$t$, $t$تصدّر ملف 3D-PDF$t$],
   20, array['mbd', '3d-annotation', '3d-pdf'], '{}'),
  ('cc083000-0000-4000-8000-000000000461', 'm4-reverse-engineering', 4, 'm4-3d-scanning', 1, 5, 'M4',
   '3D scanning basics (in person)', 'أساسيات المسح ثلاثي الأبعاد (حضوريًا)',
   array[$t$Know what a scan is good for$t$, $t$Prepare for the in-person scanning session$t$],
   array[$t$تعرف فيمَ يفيد المسح$t$, $t$تستعد لجلسة المسح الحضورية$t$],
   10, array['3d-scan'], '{}'),

  -- ===================================================== Mock competitions
  ('cc083000-0000-4000-8000-000000000471', 'mock-competitions', 1, 'mock-how-mocks-work', 1, 1, null,
   'How mock competitions work', 'كيف تجري المسابقات التجريبية',
   array[$t$Know the rules you agree to before a mock$t$, $t$Hand in one ZIP of the Results folder$t$],
   array[$t$تعرف القواعد التي توافق عليها قبل التجربة$t$, $t$تسلّم ملف ZIP واحدًا لمجلد النتائج$t$],
   10, array[]::text[], '{}')
) as v(id, module_slug, n, slug, sort, skill, cm, title_en, title_ar, obj_en, obj_ar, minutes, terms, notes)
join public.cc_modules m on m.slug = v.module_slug
join public.cc_courses c on c.id = m.course_id and c.slug = 'cad-champions'
join public.cc_levels lv on lv.module_id = m.id and lv.level_number = v.n
on conflict (slug) do update set
  level_id = excluded.level_id, competition_module = excluded.competition_module,
  skill_area_id = excluded.skill_area_id, sort = excluded.sort,
  title_en = excluded.title_en, title_ar = excluded.title_ar,
  objectives_en = excluded.objectives_en, objectives_ar = excluded.objectives_ar,
  duration_minutes = excluded.duration_minutes, glossary_terms = excluded.glossary_terms,
  is_free_preview = excluded.is_free_preview, track_notes = excluded.track_notes,
  is_published = excluded.is_published;

-- ------------------------------------------------- 5. mini-project test
-- Foundations L6 "Competition practice": a 60-minute timed test run by the
-- test engine (Prompt 5). Unpublished until the owner adds its tasks
-- (parts + assembly + one drawing) [TODO-MO].
insert into public.cc_tests
  (id, slug, title_en, title_ar, type, time_limit_minutes, grace_seconds, is_published, admin_only,
   intro_en, intro_ar, retake_cooldown_days, upload_mode)
values ('cc083000-0000-4000-8000-000000000601', 'foundations-mini-project',
  'Competition practice: 60-minute mini-project', 'تدريب المسابقة: مشروع مصغّر في 60 دقيقة',
  'exercise', 60, 60, false, false,
  $t$A timed mini-project: model the parts, build the assembly and make one drawing in 60 minutes. Upload one file per task. [TODO-MO: tasks and drawings]$t$,
  $t$مشروع مصغّر بمؤقت: نمذج القطع، وابنِ التجميع، وأعدّ رسمًا واحدًا خلال 60 دقيقة. ارفع ملفًا لكل مهمة. [TODO-MO: tasks and drawings]$t$,
  0, 'per_task')
on conflict (slug) do update set
  title_en = excluded.title_en, title_ar = excluded.title_ar, type = excluded.type,
  time_limit_minutes = excluded.time_limit_minutes, intro_en = excluded.intro_en, intro_ar = excluded.intro_ar;

-- ---------------------------------------------------------- 4e. exercises
-- Briefs are [TODO-MO] (drawings + reference STEP come from the owner):
-- reference_data stays empty, so uploads are saved and marked "waiting for
-- answer data" until the owner fills it. grader_mode 'practice' = practice
-- score (partial credit); 'assembly' = aspects scoring. A re-run keeps
-- reference_data, attachments, solution_video_id and tolerances.
insert into public.cc_exercises
  (id, level_id, slug, sort, skill_area_id, competition_module, title_en, title_ar, brief_en, brief_ar,
   expected_upload, grading_mode, grader_mode, density_kg_m3, material_name_en, material_name_ar,
   max_points, estimated_minutes, pass_mark, hints_en, hints_ar, is_free_sample, test_id, is_published)
select v.id::uuid, lv.id, v.slug, v.sort, v.skill::smallint, v.cm, v.title_en, v.title_ar, v.brief_en, v.brief_ar,
       v.upload, v.grading, v.grader, case when v.upload = 'step' then 7850 else null end,
       case when v.upload = 'step' then 'Steel' else null end, case when v.upload = 'step' then 'فولاذ' else null end,
       100, v.minutes, 80, v.hints_en, v.hints_ar, v.free,
       case when v.slug = 'e6-mini-project' then (select id from public.cc_tests where slug = 'foundations-mini-project') else null end,
       true
from (values
  -- L1 (free sample)
  ('cc083000-0000-4000-8000-000000000501', 1, 'e1-rectangle-plate', 1, 3, 'M3',
   'Extrude a rectangle plate', 'ابثق لوحًا مستطيلًا',
   $t$[TODO-MO: drawing] Model the rectangular plate shown in the drawing (sizes in mm), set the material to steel and upload it as a STEP file.$t$,
   $t$[TODO-MO: drawing] نمذج اللوح المستطيل الموضح في الرسم (الأبعاد بالمليمتر)، واضبط المادة على الفولاذ، وارفعه بصيغة STEP.$t$,
   'step', 'auto_step', 'practice', 15, true,
   array[$t$Check your units are millimetres before you start the sketch.$t$, $t$Read the plate thickness again: it is the extrude distance, not a sketch dimension.$t$],
   array[$t$تأكد أن الوحدات بالمليمتر قبل أن تبدأ الرسم.$t$, $t$اقرأ سماكة اللوح مرة أخرى: إنها مسافة البثق وليست بُعدًا في الرسم.$t$]),
  ('cc083000-0000-4000-8000-000000000502', 1, 'e1-profile-lines-arcs', 2, 3, 'M3',
   'Extrude a profile with lines and arcs', 'ابثق مقطعًا من خطوط وأقواس',
   $t$[TODO-MO: drawing] Sketch the profile made of lines and arcs, fully constrain it and extrude it to the thickness shown. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] ارسم المقطع المكوّن من خطوط وأقواس، وقيّده بالكامل، وابثقه بالسماكة الموضحة. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 20, true,
   array[$t$Use tangent constraints where an arc meets a line.$t$, $t$If the sketch is not fully constrained, a dimension is probably missing on an arc radius or centre.$t$],
   array[$t$استخدم قيد التماس حيث يلتقي القوس بالخط.$t$, $t$إذا لم يكن الرسم مقيّدًا بالكامل، فغالبًا ينقصه بُعد لنصف قطر قوس أو لمركزه.$t$]),
  -- L2
  ('cc083000-0000-4000-8000-000000000511', 2, 'e2-through-hole', 1, 3, 'M3',
   'Extrude with a through hole', 'بثق مع ثقب نافذ',
   $t$[TODO-MO: drawing] Model the block with the through hole exactly where the drawing places it. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] نمذج القطعة مع الثقب النافذ في المكان الذي يحدده الرسم بالضبط. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 15, false,
   array[$t$Measure the hole position from the edges the drawing uses, not from the centre.$t$, $t$A through hole must go all the way: use "through all", not a depth.$t$],
   array[$t$قِس موضع الثقب من الحواف التي يستخدمها الرسم، لا من المركز.$t$, $t$الثقب النافذ يجب أن يخترق القطعة كاملة: استخدم "عبر الكل" وليس عمقًا محددًا.$t$]),
  ('cc083000-0000-4000-8000-000000000512', 2, 'e2-pocket', 2, 3, 'M3',
   'Cut-extrude a pocket', 'اقطع جيبًا بالبثق',
   $t$[TODO-MO: drawing] Model the part and cut the pocket to the depth shown. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] نمذج القطعة واقطع الجيب بالعمق الموضح. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 20, false,
   array[$t$Check which face the pocket depth is measured from.$t$, $t$Look at the pocket corners: do they need a radius?$t$],
   array[$t$تحقق من الوجه الذي يُقاس منه عمق الجيب.$t$, $t$انظر إلى زوايا الجيب: هل تحتاج إلى نصف قطر؟$t$]),
  ('cc083000-0000-4000-8000-000000000513', 2, 'e2-fillets-chamfers', 3, 3, 'M3',
   'Fillets and chamfers', 'تدوير الحواف وشطفها',
   $t$[TODO-MO: drawing] Model the part and add every fillet and chamfer shown. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] نمذج القطعة وأضف كل تدوير وشطف موضح في الرسم. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 20, false,
   array[$t$Count the fillets and chamfers on the drawing and tick them off as you add them.$t$, $t$A chamfer "2 x 45°" is different from "2 x 2" on unequal faces: check the note.$t$],
   array[$t$عُدّ التدويرات والشطفات في الرسم وضع علامة على كل واحد تضيفه.$t$, $t$الشطف "2 x 45°" يختلف عن "2 x 2" على الأوجه غير المتساوية: راجع الملاحظة.$t$]),
  -- L3
  ('cc083000-0000-4000-8000-000000000521', 3, 'e3-revolve-shaft', 1, 3, 'M3',
   'Revolve a shaft or pulley', 'أنشئ عمودًا أو بكرة بالدوران',
   $t$[TODO-MO: drawing] Revolve the half-profile of the shaft or pulley shown. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] أنشئ العمود أو البكرة بتدوير نصف المقطع الموضح. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 25, false,
   array[$t$Sketch only half of the profile, on one side of the axis.$t$, $t$Diameters on the drawing are full sizes: use half of each for the profile, or dimension to the axis as a diameter.$t$],
   array[$t$ارسم نصف المقطع فقط على جانب واحد من المحور.$t$, $t$الأقطار في الرسم مقاسات كاملة: استخدم نصفها في المقطع، أو ضع البعد إلى المحور كقطر.$t$]),
  ('cc083000-0000-4000-8000-000000000522', 3, 'e3-sweep-handle', 2, 3, 'M3',
   'Sweep a handle', 'أنشئ مقبضًا بالسحب على مسار',
   $t$[TODO-MO: drawing] Sweep the profile along the handle path shown. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] اسحب المقطع على مسار المقبض الموضح. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 25, false,
   array[$t$The profile sketch must sit at the start of the path, at right angles to it.$t$, $t$If the sweep fails, look for a bend in the path that is tighter than the profile.$t$],
   array[$t$يجب أن يكون رسم المقطع عند بداية المسار وعموديًا عليه.$t$, $t$إذا فشل السحب، ابحث عن انحناء في المسار أضيق من المقطع.$t$]),
  ('cc083000-0000-4000-8000-000000000523', 3, 'e3-loft', 3, 3, 'M3',
   'Loft a transition', 'أنشئ انتقالًا بين مقطعين',
   $t$[TODO-MO: drawing] Loft between the profiles shown to make the transition piece. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] أنشئ انتقالًا بين المقاطع الموضحة لصنع قطعة الانتقال. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 25, false,
   array[$t$Put each profile on its own plane at the right distance.$t$, $t$A twisted loft usually means the start points of the profiles do not match.$t$],
   array[$t$ضع كل مقطع على مستواه الخاص بالمسافة الصحيحة.$t$, $t$الانتقال الملتوي يعني غالبًا أن نقاط بداية المقاطع غير متطابقة.$t$]),
  ('cc083000-0000-4000-8000-000000000524', 3, 'e3-shell', 4, 3, 'M3',
   'Shell a box', 'فرّغ صندوقًا',
   $t$[TODO-MO: drawing] Model the box and shell it to the wall thickness shown, with the right face open. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] نمذج الصندوق وفرّغه بسماكة الجدار الموضحة مع ترك الوجه الصحيح مفتوحًا. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 20, false,
   array[$t$Choose the face to remove before you set the thickness.$t$, $t$Add outside fillets before the shell if the drawing shows rounded inside corners too.$t$],
   array[$t$اختر الوجه الذي ستزيله قبل ضبط السماكة.$t$, $t$أضف التدوير الخارجي قبل التفريغ إذا أظهر الرسم زوايا داخلية مدوّرة أيضًا.$t$]),
  ('cc083000-0000-4000-8000-000000000525', 3, 'e3-patterns', 5, 3, 'M3',
   'Linear and circular patterns', 'الأنماط الخطية والدائرية',
   $t$[TODO-MO: drawing] Model the part and repeat the features with linear and circular patterns as shown. Upload a STEP file.$t$,
   $t$[TODO-MO: drawing] نمذج القطعة وكرر العناصر بأنماط خطية ودائرية كما في الرسم. ارفع ملف STEP.$t$,
   'step', 'auto_step', 'practice', 25, false,
   array[$t$Count the instances, including the first one.$t$, $t$Check whether the spacing is between instances or the total length.$t$],
   array[$t$عُدّ النسخ بما فيها النسخة الأولى.$t$, $t$تحقق هل المسافة بين النسخ أم الطول الكلي.$t$]),
  -- L4
  ('cc083000-0000-4000-8000-000000000531', 4, 'e4-family-small', 1, 3, 'M2',
   'Part family: size S', 'عائلة القطع: المقاس S',
   $t$[TODO-MO: drawing + size table] Build one parametric part and upload the S size as a STEP file.$t$,
   $t$[TODO-MO: drawing + size table] ابنِ قطعة واحدة بالمتغيرات وارفع المقاس S بصيغة STEP.$t$,
   'step', 'auto_step', 'practice', 20, false,
   array[$t$Name the parameters from the size table before you model.$t$, $t$Change one value and check the model rebuilds without errors.$t$],
   array[$t$سمِّ المتغيرات حسب جدول المقاسات قبل أن تبدأ النمذجة.$t$, $t$غيّر قيمة واحدة وتأكد أن النموذج يُعاد بناؤه دون أخطاء.$t$]),
  ('cc083000-0000-4000-8000-000000000532', 4, 'e4-family-medium', 2, 3, 'M2',
   'Part family: size M', 'عائلة القطع: المقاس M',
   $t$[TODO-MO: drawing + size table] Use the same parametric part and upload the M size as a STEP file.$t$,
   $t$[TODO-MO: drawing + size table] استخدم القطعة نفسها وارفع المقاس M بصيغة STEP.$t$,
   'step', 'auto_step', 'practice', 20, false,
   array[$t$Only the parameter values change: do not remodel.$t$, $t$Export the active size: check which member is active before exporting.$t$],
   array[$t$تتغير قيم المتغيرات فقط: لا تُعِد النمذجة.$t$, $t$صدّر المقاس النشط: تحقق أي مقاس نشط قبل التصدير.$t$]),
  ('cc083000-0000-4000-8000-000000000533', 4, 'e4-family-large', 3, 3, 'M2',
   'Part family: size L', 'عائلة القطع: المقاس L',
   $t$[TODO-MO: drawing + size table] Use the same parametric part and upload the L size as a STEP file.$t$,
   $t$[TODO-MO: drawing + size table] استخدم القطعة نفسها وارفع المقاس L بصيغة STEP.$t$,
   'step', 'auto_step', 'practice', 20, false,
   array[$t$If a feature breaks at the large size, a dimension is fixed that should follow a parameter.$t$, $t$Time yourself: aim to finish faster than the S size.$t$],
   array[$t$إذا تعطلت إحدى العمليات في المقاس الكبير، فهناك بُعد ثابت كان يجب أن يتبع متغيرًا.$t$, $t$قِس وقتك: حاول أن تنهي أسرع من المقاس S.$t$]),
  -- L5
  ('cc083000-0000-4000-8000-000000000541', 5, 'e5-three-part-assembly', 1, 3, 'M3',
   '3-part assembly with constraints', 'تجميع من 3 قطع بالقيود',
   $t$[TODO-MO: part files + drawing] Assemble the three given parts with constraints in the positions shown. Upload the assembly as one STEP file.$t$,
   $t$[TODO-MO: part files + drawing] جمّع القطع الثلاث المعطاة بالقيود في المواضع الموضحة. ارفع التجميع في ملف STEP واحد.$t$,
   'step', 'auto_step', 'assembly', 30, false,
   array[$t$Ground the base part at the origin first.$t$, $t$Check positions against the drawing: a flipped constraint puts a part on the wrong side.$t$],
   array[$t$ثبّت القطعة الأساسية عند نقطة الأصل أولًا.$t$, $t$طابق المواضع مع الرسم: القيد المعكوس يضع القطعة في الجهة الخطأ.$t$]),
  ('cc083000-0000-4000-8000-000000000542', 5, 'e5-subassemblies', 2, 3, 'M3',
   'Sub-assemblies', 'التجميعات الفرعية',
   $t$[TODO-MO: part files + drawing] Build the sub-assembly, then place it in the main assembly as shown. Upload the main assembly as one STEP file.$t$,
   $t$[TODO-MO: part files + drawing] ابنِ التجميع الفرعي، ثم ضعه في التجميع الرئيسي كما في الرسم. ارفع التجميع الرئيسي في ملف STEP واحد.$t$,
   'step', 'auto_step', 'assembly', 35, false,
   array[$t$Build and save the sub-assembly as its own file first.$t$, $t$Constrain the sub-assembly as one unit, not part by part.$t$],
   array[$t$ابنِ التجميع الفرعي واحفظه في ملف مستقل أولًا.$t$, $t$قيّد التجميع الفرعي كوحدة واحدة، لا قطعة قطعة.$t$]),
  ('cc083000-0000-4000-8000-000000000543', 5, 'e5-mechanism', 3, 3, 'M2',
   'A simple mechanism', 'آلية بسيطة',
   $t$[TODO-MO: part files + drawing] Assemble the mechanism so it moves as described, and set it to the position shown. Upload the assembly as one STEP file.$t$,
   $t$[TODO-MO: part files + drawing] جمّع الآلية بحيث تتحرك كما هو موصوف، واضبطها على الوضع الموضح. ارفع التجميع في ملف STEP واحد.$t$,
   'step', 'auto_step', 'assembly', 40, false,
   array[$t$Leave free only the movement the mechanism needs.$t$, $t$Set the final position with an angle or distance constraint before you export.$t$],
   array[$t$اترك حرة فقط الحركة التي تحتاجها الآلية.$t$, $t$اضبط الوضع النهائي بقيد زاوية أو مسافة قبل التصدير.$t$]),
  -- L6
  ('cc083000-0000-4000-8000-000000000551', 6, 'e6-detail-drawing', 1, 6, 'M3',
   'Detail drawing of a part', 'رسم تفاصيل لقطعة',
   $t$[TODO-MO: part file] Make an ISO detail drawing of the given part, in first or third angle, and upload it as a PDF. A trainer checks it with the drawing rubric.$t$,
   $t$[TODO-MO: part file] أعدّ رسم تفاصيل وفق ISO للقطعة المعطاة، بالإسقاط الأول أو الثالث، وارفعه بصيغة PDF. يراجعه المدرّب وفق معايير تقييم الرسم.$t$,
   'pdf', 'ai_drawing', null, 45, false,
   array[$t$Go through the title block fields one by one before you export.$t$, $t$Check that the projection symbol matches how you placed the views.$t$],
   array[$t$راجع حقول جدول العنوان واحدًا واحدًا قبل التصدير.$t$, $t$تأكد أن رمز الإسقاط يطابق طريقة ترتيبك للمساقط.$t$]),
  ('cc083000-0000-4000-8000-000000000552', 6, 'e6-mini-project', 2, 3, 'M3',
   'Competition practice: 60-minute mini-project', 'تدريب المسابقة: مشروع مصغّر في 60 دقيقة',
   $t$A timed mini-project in the test engine: parts, an assembly and one drawing in 60 minutes. Your best score counts for this level.$t$,
   $t$مشروع مصغّر بمؤقت في نظام الاختبارات: قطع وتجميع ورسم واحد خلال 60 دقيقة. تُحتسب أفضل نتيجة لك في هذا المستوى.$t$,
   'none', 'manual', null, 60, false,
   array[]::text[], array[]::text[])
) as v(id, n, slug, sort, skill, cm, title_en, title_ar, brief_en, brief_ar, upload, grading, grader, minutes, free, hints_en, hints_ar)
join public.cc_modules m on m.slug = 'foundations'
join public.cc_courses c on c.id = m.course_id and c.slug = 'cad-champions'
join public.cc_levels lv on lv.module_id = m.id and lv.level_number = v.n
on conflict (slug) do update set
  level_id = excluded.level_id, sort = excluded.sort,
  skill_area_id = excluded.skill_area_id, competition_module = excluded.competition_module,
  title_en = excluded.title_en, title_ar = excluded.title_ar,
  brief_en = excluded.brief_en, brief_ar = excluded.brief_ar,
  expected_upload = excluded.expected_upload, grading_mode = excluded.grading_mode,
  grader_mode = excluded.grader_mode, estimated_minutes = excluded.estimated_minutes,
  hints_en = excluded.hints_en, hints_ar = excluded.hints_ar,
  is_free_sample = excluded.is_free_sample, test_id = excluded.test_id,
  is_published = excluded.is_published;
