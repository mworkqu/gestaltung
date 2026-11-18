-- ============================================================================
-- 0080_cc_diagnostic_seed.sql  -  CAD Champions: seed tests for the test flow
-- ============================================================================
-- RUN AFTER 0079 (needs the tables from 0077_cc_core.sql and the buckets from
-- 0078_cc_storage.sql).
--
-- What it does
--   1. Test "diagnostic-v1" (the free test): 90 minutes, retake cooldown 14
--      days, per_task uploads, published. Four tasks:
--        1. Plate from a drawing                 STEP, auto_step  (skill 3, M3)
--        2. Part with a hole, pocket and fillets  STEP, auto_step  (skill 3, M3)
--        3. Assemble 3 given parts                STEP, auto_step  (skill 3, M3)
--        4. ISO detail drawing of part 2          PDF,  ai_drawing (skill 6, M3)
--      Briefs are placeholders "[TODO-MO: ...]", reference_data is '{}' (the
--      owner builds it from the answer STEP files), material steel 7850 kg/m3.
--      The drawings and the 3 part files are expected in bucket cc-task-files
--      at the paths listed in attachments (upload them; see docs/CONTENT_TODO.md).
--   2. Test "diagnostic-timeout-check": 3 minutes, admin_only (staff see it,
--      students never do), for checking auto-submit.
--   3. Test "practice-cube": practice, untimed, one task (50 mm steel cube),
--      the same task as the Get Ready practice upload.
--   4. Marking aspects (cc_task_aspects) for every task: measurement aspects
--      volume / area / inertia / solids for STEP tasks (all-or-nothing), and
--      drawing-rubric items (measurement, AI first pass) plus two judgement
--      items (trainer, 0-3) for the drawing task.
--   5. cc-submissions bucket: limit raised to 300 MB and ZIP types allowed, for
--      module_package tests (one Results ZIP). Per-task files stay limited to
--      50 MB by the app (lib/cad-champions/upload/validate.ts). NOTE: the
--      Supabase project's own global upload limit (Storage settings) must also
--      be at least 300 MB for ZIP uploads to work.
--
-- Points: 25 per task (100 in total) are DEFAULTS [TODO-MO: confirm points].
-- Re-runnable: fixed uuids + "on conflict ... do update". Tests are matched
-- by slug, so a test created earlier by hand keeps its id; its tasks are
-- attached by slug lookup.
--
-- Rollback (comments):
--   delete from public.cc_tests where slug in ('diagnostic-v1', 'diagnostic-timeout-check', 'practice-cube');
--   (tasks and aspects cascade; attempts block the delete on purpose.)
-- ============================================================================

-- ---------------------------------------------------------------- 1. tests
insert into public.cc_tests
  (id, slug, title_en, title_ar, type, time_limit_minutes, grace_seconds, is_published, admin_only,
   intro_en, intro_ar, rules_en, rules_ar, retake_cooldown_days, upload_mode, package_expectations)
values
  ('cc080000-0000-4000-8000-000000000001', 'diagnostic-v1',
   'Free skills test', 'اختبار المهارات المجاني',
   'diagnostic', 90, 60, true, false,
   $t$This free test shows where you stand in 3D modelling and technical drawing. It has 4 tasks and takes 90 minutes. You model in your own CAD software and upload one file per task.$t$,
   $t$يوضّح لك هذا الاختبار المجاني مستواك في النمذجة ثلاثية الأبعاد والرسم الفني. فيه 4 مهام ومدته 90 دقيقة. تصمّم في برنامجك وترفع ملفًا واحدًا لكل مهمة.$t$,
   null, null, 14, 'per_task', '{}'::jsonb),
  ('cc080000-0000-4000-8000-000000000002', 'diagnostic-timeout-check',
   'Timeout check (staff)', 'فحص انتهاء الوقت (للفريق)',
   'diagnostic', 3, 60, true, true,
   $t$Staff only. Start it, upload a file or not, and let the 3-minute timer run out to check that the test is submitted automatically.$t$,
   $t$للفريق فقط. ابدأه، وارفع ملفًا أو لا، ثم اترك المؤقت (3 دقائق) ينتهي للتأكد من أن الاختبار يُسلَّم تلقائيًا.$t$,
   null, null, 0, 'per_task', '{}'::jsonb),
  ('cc080000-0000-4000-8000-000000000003', 'practice-cube',
   'Practice: 50 mm cube', 'تدريب: مكعب 50 مم',
   'practice', null, 60, true, false,
   $t$A practice task with no timer. Nothing counts and you can try as often as you like.$t$,
   $t$مهمة تدريبية بلا مؤقت. لا يُحتسب شيء، ويمكنك المحاولة كما تشاء.$t$,
   null, null, 0, 'per_task', '{}'::jsonb)
on conflict (slug) do update set
  title_en = excluded.title_en,
  title_ar = excluded.title_ar,
  type = excluded.type,
  time_limit_minutes = excluded.time_limit_minutes,
  grace_seconds = excluded.grace_seconds,
  is_published = excluded.is_published,
  admin_only = excluded.admin_only,
  intro_en = excluded.intro_en,
  intro_ar = excluded.intro_ar,
  retake_cooldown_days = excluded.retake_cooldown_days,
  upload_mode = excluded.upload_mode;

-- ---------------------------------------------------------------- 2. tasks
insert into public.cc_test_tasks
  (id, test_id, position, skill_area_id, competition_module, title_en, title_ar, brief_en, brief_ar,
   attachments, expected_upload, max_points, grading_mode, grader_mode, reference_data, rubric, tolerances,
   density_kg_m3, material_name_en, material_name_ar)
select v.id::uuid, t.id, v.position, v.skill_area_id, v.competition_module, v.title_en, v.title_ar, v.brief_en, v.brief_ar,
       v.attachments::jsonb, v.expected_upload, v.max_points, v.grading_mode, v.grader_mode, v.reference_data::jsonb,
       null, null, v.density, v.material_en, v.material_ar
  from (values
    -- diagnostic-v1 ----------------------------------------------------------
    ('cc080000-0000-4000-8000-000000000101', 'diagnostic-v1', 1, 3::smallint, 'M3',
     'Plate from a drawing', 'لوح من رسمة',
     $b$[TODO-MO: Task 1 brief - the plate to model and what to watch for.]

1. Open the plate drawing under **Files for this task**.
2. Model the plate in millimetres, exactly as drawn.
3. Set the material to steel, density 7850 kg/m³.
4. Export one STEP file and upload it below.$b$,
     $b$[TODO-MO: Task 1 brief - the plate to model and what to watch for.]

1. افتح رسمة اللوح من **ملفات هذه المهمة**.
2. صمّم اللوح بالمليمتر كما في الرسمة تمامًا.
3. اضبط المادة على الفولاذ بكثافة 7850 kg/m³.
4. صدّر ملف STEP واحدًا وارفعه أدناه.$b$,
     '[{"path": "diagnostic-v1/task-1/plate-drawing.pdf", "label_en": "Plate drawing (PDF)", "label_ar": "رسمة اللوح (PDF)", "kind": "drawing"}]',
     'step', 25.00, 'auto_step', 'part', '{}', 7850.000, 'Steel', 'فولاذ'),
    ('cc080000-0000-4000-8000-000000000102', 'diagnostic-v1', 2, 3::smallint, 'M3',
     'Part with a hole, pocket and fillets', 'قطعة بثقب وجيب وتدويرات',
     $b$[TODO-MO: Task 2 brief - the part with a hole, a pocket and fillets.]

1. Open the part drawing under **Files for this task**.
2. Model the part in millimetres, with every hole, pocket and fillet.
3. Set the material to steel, density 7850 kg/m³.
4. Export one STEP file and upload it below. You will draw this part in task 4.$b$,
     $b$[TODO-MO: Task 2 brief - the part with a hole, a pocket and fillets.]

1. افتح رسمة القطعة من **ملفات هذه المهمة**.
2. صمّم القطعة بالمليمتر، مع كل ثقب وجيب وتدوير.
3. اضبط المادة على الفولاذ بكثافة 7850 kg/m³.
4. صدّر ملف STEP واحدًا وارفعه أدناه. سترسم هذه القطعة في المهمة 4.$b$,
     '[{"path": "diagnostic-v1/task-2/part-drawing.pdf", "label_en": "Part drawing (PDF)", "label_ar": "رسمة القطعة (PDF)", "kind": "drawing"}]',
     'step', 25.00, 'auto_step', 'part', '{}', 7850.000, 'Steel', 'فولاذ'),
    ('cc080000-0000-4000-8000-000000000103', 'diagnostic-v1', 3, 3::smallint, 'M3',
     'Assemble 3 given parts', 'تجميع 3 قطع معطاة',
     $b$[TODO-MO: Task 3 brief - how the three parts fit together.]

1. Download the three part files under **Files for this task**.
2. Open them in your CAD software and assemble them as described.
3. Keep the material steel, density 7850 kg/m³.
4. Export the assembly as one STEP file and upload it below.$b$,
     $b$[TODO-MO: Task 3 brief - how the three parts fit together.]

1. نزّل ملفات القطع الثلاث من **ملفات هذه المهمة**.
2. افتحها في برنامجك وجمّعها كما هو موضّح.
3. أبقِ المادة فولاذًا بكثافة 7850 kg/m³.
4. صدّر التجميع في ملف STEP واحد وارفعه أدناه.$b$,
     '[{"path": "diagnostic-v1/task-3/part-1.step", "label_en": "Part 1 (STEP)", "label_ar": "القطعة 1 (STEP)", "kind": "part"}, {"path": "diagnostic-v1/task-3/part-2.step", "label_en": "Part 2 (STEP)", "label_ar": "القطعة 2 (STEP)", "kind": "part"}, {"path": "diagnostic-v1/task-3/part-3.step", "label_en": "Part 3 (STEP)", "label_ar": "القطعة 3 (STEP)", "kind": "part"}]',
     'step', 25.00, 'auto_step', 'assembly', '{}', 7850.000, 'Steel', 'فولاذ'),
    ('cc080000-0000-4000-8000-000000000104', 'diagnostic-v1', 4, 6::smallint, 'M3',
     'ISO detail drawing of part 2', 'رسمة تفصيلية بمعيار ISO للقطعة 2',
     $b$[TODO-MO: Task 4 brief - the detail drawing of part 2: sheet size, views, scale.]

1. Make a detail drawing for manufacture of your part from task 2.
2. Use first-angle or third-angle projection, with the projection symbol.
3. Fill in the title block, dimension every feature, and add the general tolerance note.
4. Export the drawing as one PDF file and upload it below.$b$,
     $b$[TODO-MO: Task 4 brief - the detail drawing of part 2: sheet size, views, scale.]

1. أنشئ رسمة تفصيلية للتصنيع لقطعتك من المهمة 2.
2. استخدم الإسقاط بالزاوية الأولى أو الثالثة، مع رمز الإسقاط.
3. املأ جدول العنوان، وضع أبعاد كل الملامح، وأضف ملاحظة التفاوت العام.
4. صدّر الرسمة في ملف PDF واحد وارفعه أدناه.$b$,
     '[]',
     'pdf', 25.00, 'ai_drawing', null, '{}', null, null, null),
    -- diagnostic-timeout-check --------------------------------------------------
    ('cc080000-0000-4000-8000-000000000201', 'diagnostic-timeout-check', 1, 3::smallint, null,
     'Any STEP file', 'أي ملف STEP',
     $b$Staff check. Upload any STEP file (or nothing), then wait for the 3-minute timer to end. The test must be submitted with reason "timeout".$b$,
     $b$فحص للفريق. ارفع أي ملف STEP (أو لا شيء)، ثم انتظر انتهاء المؤقت (3 دقائق). يجب أن يُسلَّم الاختبار بسبب "انتهاء الوقت".$b$,
     '[]', 'step', 10.00, 'auto_step', 'part', '{}', 7850.000, 'Steel', 'فولاذ'),
    -- practice-cube ------------------------------------------------------------
    ('cc080000-0000-4000-8000-000000000301', 'practice-cube', 1, 3::smallint, null,
     'Model a 50 mm cube', 'صمّم مكعبًا بضلع 50 مم',
     $b$Model a 50 × 50 × 50 mm cube in steel (7850 kg/m³) and upload it as one STEP file.$b$,
     $b$صمّم مكعبًا بأبعاد 50 × 50 × 50 مم من الفولاذ (7850 kg/m³) وارفعه في ملف STEP واحد.$b$,
     '[]', 'step', 10.00, 'auto_step', 'practice', '{"volume_mm3": 125000, "solids": 1}', 7850.000, 'Steel', 'فولاذ')
  ) as v(id, slug, position, skill_area_id, competition_module, title_en, title_ar, brief_en, brief_ar,
         attachments, expected_upload, max_points, grading_mode, grader_mode, reference_data, density, material_en, material_ar)
  join public.cc_tests t on t.slug = v.slug
on conflict (id) do update set
  test_id = excluded.test_id,
  position = excluded.position,
  skill_area_id = excluded.skill_area_id,
  competition_module = excluded.competition_module,
  title_en = excluded.title_en,
  title_ar = excluded.title_ar,
  brief_en = excluded.brief_en,
  brief_ar = excluded.brief_ar,
  attachments = excluded.attachments,
  expected_upload = excluded.expected_upload,
  max_points = excluded.max_points,
  grading_mode = excluded.grading_mode,
  grader_mode = excluded.grader_mode,
  density_kg_m3 = excluded.density_kg_m3,
  material_name_en = excluded.material_name_en,
  material_name_ar = excluded.material_name_ar;
-- reference_data is NOT overwritten on re-run: the owner fills it from the answer files.

-- ---------------------------------------------------------------- 3. aspects
insert into public.cc_task_aspects
  (id, task_id, position, description_en, description_ar, skill_area_id, competition_module, type, max_points,
   method, partial_rule, check_key, student_hint_en, student_hint_ar)
select v.id::uuid, tt.id, v.position, v.description_en, v.description_ar, tt.skill_area_id, tt.competition_module,
       v.type, v.max_points, v.method, null, v.check_key, v.hint_en, v.hint_ar
  from (values
    -- task 1: plate --------------------------------------------------------------
    ('cc080000-0000-4000-8000-000000001101', 'cc080000-0000-4000-8000-000000000101', 1, 'Part volume matches the reference', 'حجم القطعة يطابق المرجع', 'measurement', 10.00, 'auto_step', 'volume',
     'Check every size against the drawing and that your units are mm.', 'طابق كل بُعد مع الرسمة وتأكد أن الوحدات بالمليمتر.'),
    ('cc080000-0000-4000-8000-000000001102', 'cc080000-0000-4000-8000-000000000101', 2, 'Surface area matches the reference', 'مساحة السطح تطابق المرجع', 'measurement', 5.00, 'auto_step', 'area',
     'Look for missing or extra holes, chamfers and fillets.', 'ابحث عن ثقوب أو شطفات أو تدويرات ناقصة أو زائدة.'),
    ('cc080000-0000-4000-8000-000000001103', 'cc080000-0000-4000-8000-000000000101', 3, 'Principal moments of inertia match the reference', 'عزوم القصور الذاتي الرئيسية تطابق المرجع', 'measurement', 7.50, 'auto_step', 'inertia',
     'Check that features sit in the right place, not just the right size.', 'تأكد أن الملامح في أماكنها الصحيحة، لا بالحجم الصحيح فقط.'),
    ('cc080000-0000-4000-8000-000000001104', 'cc080000-0000-4000-8000-000000000101', 4, 'One single solid body', 'جسم صلب واحد', 'measurement', 2.50, 'auto_step', 'solids',
     'Combine all bodies into one solid before you export.', 'ادمج كل الأجسام في جسم صلب واحد قبل التصدير.'),
    -- task 2: part with hole, pocket, fillets ---------------------------------------
    ('cc080000-0000-4000-8000-000000001201', 'cc080000-0000-4000-8000-000000000102', 1, 'Part volume matches the reference', 'حجم القطعة يطابق المرجع', 'measurement', 10.00, 'auto_step', 'volume',
     'Check every size against the drawing and that your units are mm.', 'طابق كل بُعد مع الرسمة وتأكد أن الوحدات بالمليمتر.'),
    ('cc080000-0000-4000-8000-000000001202', 'cc080000-0000-4000-8000-000000000102', 2, 'Surface area matches the reference', 'مساحة السطح تطابق المرجع', 'measurement', 5.00, 'auto_step', 'area',
     'Look for missing or extra holes, pockets and fillets.', 'ابحث عن ثقوب أو جيوب أو تدويرات ناقصة أو زائدة.'),
    ('cc080000-0000-4000-8000-000000001203', 'cc080000-0000-4000-8000-000000000102', 3, 'Principal moments of inertia match the reference', 'عزوم القصور الذاتي الرئيسية تطابق المرجع', 'measurement', 7.50, 'auto_step', 'inertia',
     'Check that the hole and the pocket sit in the right place.', 'تأكد أن الثقب والجيب في مكانهما الصحيح.'),
    ('cc080000-0000-4000-8000-000000001204', 'cc080000-0000-4000-8000-000000000102', 4, 'One single solid body', 'جسم صلب واحد', 'measurement', 2.50, 'auto_step', 'solids',
     'Combine all bodies into one solid before you export.', 'ادمج كل الأجسام في جسم صلب واحد قبل التصدير.'),
    -- task 3: assembly -----------------------------------------------------------
    ('cc080000-0000-4000-8000-000000001301', 'cc080000-0000-4000-8000-000000000103', 1, 'Assembly volume matches the reference', 'حجم التجميع يطابق المرجع', 'measurement', 10.00, 'auto_step', 'volume',
     'Use the given part files without changing them.', 'استخدم ملفات القطع المعطاة دون تعديلها.'),
    ('cc080000-0000-4000-8000-000000001302', 'cc080000-0000-4000-8000-000000000103', 2, 'Assembly surface area matches the reference', 'مساحة سطح التجميع تطابق المرجع', 'measurement', 5.00, 'auto_step', 'area',
     'Make sure no part is missing or added twice.', 'تأكد أنه لا توجد قطعة ناقصة أو مكررة.'),
    ('cc080000-0000-4000-8000-000000001303', 'cc080000-0000-4000-8000-000000000103', 3, 'Parts are in the right positions (moments of inertia)', 'القطع في أماكنها الصحيحة (عزوم القصور الذاتي)', 'measurement', 7.50, 'auto_step', 'inertia',
     'Check every constraint: faces that should touch must touch.', 'راجع كل قيد: الأوجه التي يجب أن تتلامس يجب أن تتلامس.'),
    ('cc080000-0000-4000-8000-000000001304', 'cc080000-0000-4000-8000-000000000103', 4, 'The assembly contains the 3 given parts', 'يضم التجميع القطع الثلاث المعطاة', 'measurement', 2.50, 'auto_step', 'solids',
     'Export the whole assembly, not a single part.', 'صدّر التجميع كاملًا، لا قطعة واحدة.'),
    -- task 4: drawing rubric (placeholders, see COMPETITION_ALIGNMENT section E) -----
    ('cc080000-0000-4000-8000-000000001401', 'cc080000-0000-4000-8000-000000000104', 1, 'Title block complete (name, title, scale, material, date, sheet size, drawing number)', 'جدول العنوان مكتمل (الاسم، العنوان، المقياس، المادة، التاريخ، مقاس الورقة، رقم الرسمة)', 'measurement', 3.00, 'ai_drawing', 'rubric:title_block',
     'Every field of the title block needs a value.', 'يحتاج كل حقل في جدول العنوان إلى قيمة.'),
    ('cc080000-0000-4000-8000-000000001402', 'cc080000-0000-4000-8000-000000000104', 2, 'Projection symbol present and matching the view layout (first or third angle)', 'رمز الإسقاط موجود ويطابق ترتيب المناظر (الزاوية الأولى أو الثالثة)', 'measurement', 3.00, 'ai_drawing', 'rubric:projection',
     'Either projection is fine; the symbol and the view layout must agree.', 'أي إسقاط مقبول؛ المهم أن يتفق الرمز مع ترتيب المناظر.'),
    ('cc080000-0000-4000-8000-000000001403', 'cc080000-0000-4000-8000-000000000104', 3, 'Required views present, no unnecessary views', 'المناظر المطلوبة موجودة دون مناظر زائدة', 'measurement', 3.00, 'ai_drawing', 'rubric:views',
     'Show every feature clearly with as few views as possible.', 'أظهر كل الملامح بوضوح بأقل عدد ممكن من المناظر.'),
    ('cc080000-0000-4000-8000-000000001404', 'cc080000-0000-4000-8000-000000000104', 4, 'Section views hatched with labelled cutting planes', 'مناظر المقاطع مهشّرة مع مستويات قطع معنونة', 'measurement', 2.00, 'ai_drawing', 'rubric:sections',
     'Label each cutting plane and its section view with the same letters.', 'سمِّ كل مستوى قطع ومنظر مقطعه بالحروف نفسها.'),
    ('cc080000-0000-4000-8000-000000001405', 'cc080000-0000-4000-8000-000000000104', 5, 'Every feature dimensioned, no duplicate or redundant dimensions', 'كل الملامح لها أبعاد، دون أبعاد مكررة أو زائدة', 'measurement', 4.00, 'ai_drawing', 'rubric:dimensions',
     'Each size should appear exactly once.', 'يجب أن يظهر كل بُعد مرة واحدة فقط.'),
    ('cc080000-0000-4000-8000-000000001406', 'cc080000-0000-4000-8000-000000000104', 6, 'No overlapping dimensions or text', 'لا أبعاد أو نصوص متداخلة', 'measurement', 2.00, 'ai_drawing', 'rubric:no_overlap',
     'Move dimensions so no line or text crosses another.', 'حرّك الأبعاد بحيث لا يتقاطع خط أو نص مع آخر.'),
    ('cc080000-0000-4000-8000-000000001407', 'cc080000-0000-4000-8000-000000000104', 7, 'Correct ISO symbols and abbreviations, dimensions in mm', 'رموز واختصارات ISO صحيحة والأبعاد بالمليمتر', 'measurement', 2.00, 'ai_drawing', 'rubric:symbols',
     'Use ISO symbols such as Ø and R, and mm throughout.', 'استخدم رموز ISO مثل Ø وR، والمليمتر في كل الرسمة.'),
    ('cc080000-0000-4000-8000-000000001408', 'cc080000-0000-4000-8000-000000000104', 8, 'General tolerance note present (for example ISO 2768-m)', 'ملاحظة التفاوت العام موجودة (مثل ISO 2768-m)', 'measurement', 2.00, 'ai_drawing', 'rubric:tolerance_note',
     'Add the general tolerance note near the title block.', 'أضف ملاحظة التفاوت العام قرب جدول العنوان.'),
    ('cc080000-0000-4000-8000-000000001409', 'cc080000-0000-4000-8000-000000000104', 9, 'Presentation and view selection', 'العرض واختيار المناظر', 'judgement', 2.00, 'trainer', 'rubric:presentation',
     'A trainer scores this from 0 to 3.', 'يقيّم المدرّب هذا من 0 إلى 3.'),
    ('cc080000-0000-4000-8000-000000001410', 'cc080000-0000-4000-8000-000000000104', 10, 'Overall readability for manufacture', 'سهولة القراءة للتصنيع عمومًا', 'judgement', 2.00, 'trainer', 'rubric:readability',
     'A trainer scores this from 0 to 3.', 'يقيّم المدرّب هذا من 0 إلى 3.'),
    -- timeout check --------------------------------------------------------------
    ('cc080000-0000-4000-8000-000000002101', 'cc080000-0000-4000-8000-000000000201', 1, 'A valid single-solid STEP file', 'ملف STEP صالح بجسم صلب واحد', 'measurement', 10.00, 'auto_step', 'solids',
     null, null),
    -- practice cube --------------------------------------------------------------
    ('cc080000-0000-4000-8000-000000003101', 'cc080000-0000-4000-8000-000000000301', 1, 'Cube volume is 125,000 mm³', 'حجم المكعب 125,000 mm³', 'measurement', 7.00, 'auto_step', 'volume',
     'A 50 mm cube has a volume of 125,000 mm³. Check your units.', 'حجم مكعب ضلعه 50 مم هو 125,000 mm³. تحقق من الوحدات.'),
    ('cc080000-0000-4000-8000-000000003102', 'cc080000-0000-4000-8000-000000000301', 2, 'One single solid body', 'جسم صلب واحد', 'measurement', 3.00, 'auto_step', 'solids',
     'Export one solid only.', 'صدّر جسمًا صلبًا واحدًا فقط.')
  ) as v(id, task_id, position, description_en, description_ar, type, max_points, method, check_key, hint_en, hint_ar)
  join public.cc_test_tasks tt on tt.id = v.task_id::uuid
on conflict (id) do update set
  task_id = excluded.task_id,
  position = excluded.position,
  description_en = excluded.description_en,
  description_ar = excluded.description_ar,
  skill_area_id = excluded.skill_area_id,
  competition_module = excluded.competition_module,
  type = excluded.type,
  max_points = excluded.max_points,
  method = excluded.method,
  check_key = excluded.check_key,
  student_hint_en = excluded.student_hint_en,
  student_hint_ar = excluded.student_hint_ar;

-- ---------------------------------------------------------------- 4. bucket
-- module_package: one Results ZIP of up to 300 MB. Per-task files stay 50 MB in the app.
update storage.buckets
   set file_size_limit = greatest(coalesce(file_size_limit, 0), 314572800),
       allowed_mime_types = (
         select array_agg(distinct m order by m)
           from unnest(coalesce(allowed_mime_types, '{}'::text[])
                       || array['application/zip', 'application/x-zip-compressed', 'application/x-zip']) as m
       )
 where id = 'cc-submissions';
