-- ============================================================================
-- 0082_cc_drawing_rubric.sql  -  CAD Champions: drawing check rubric (Prompt 8)
-- ============================================================================
-- RUN AFTER 0081 (needs cc_test_tasks / cc_task_aspects from 0077 and the
-- diagnostic-v1 seed from 0080).
--
-- What it does
--   1. cc_sync_rubric_aspects(p_task uuid) -> integer
--        Turns cc_test_tasks.rubric ({ version, kind, items: [...] }) into
--        cc_task_aspects rows, one per item, check_key 'rubric:<item id>':
--          measurement + check_type 'ai'      -> method 'ai_drawing'
--          measurement + check_type 'manual'  -> method 'trainer'
--          judgement (0-3)                    -> method 'trainer'
--        Existing rows are matched by check_key and updated (their ids, and so
--        any aspect results, are kept). Rubric aspects whose item was removed
--        from the rubric are deleted (their aspect results go with them).
--        Non-rubric aspects of the task are never touched. Returns the number
--        of rubric items. Service role only (the admin editor in Prompt 11
--        calls it after saving a rubric).
--   2. Writes the default PART drawing rubric (COMPETITION_ALIGNMENT section E,
--      lib/cad-champions/drawing/rubric.ts defaultRubric("part")) to the
--      diagnostic-v1 drawing task cc080000-...-000000000104 and syncs its
--      aspects: 14 measurement items (13 AI first pass + "key dimension values
--      correct", trainer only) and 2 judgement items (0-3), 25 points in total
--      = the task's max_points. Judgement share: 2 of 25 points (8%).
--      The ten aspects seeded by 0080 keep their ids (title_block, projection,
--      views, sections, dimensions, no_overlap, symbols, tolerance_note,
--      presentation, readability) with new texts and points.
--
-- Safe to re-run: create or replace; the rubric is rewritten and the sync is
-- idempotent. NOTE: re-running resets the task's rubric to this default, so
-- after the owner edits the rubric in admin (Prompt 11), do not re-run 0082.
--
-- Rollback (comments):
--   drop function if exists public.cc_sync_rubric_aspects(uuid);
--   (the 0080 aspects can be restored by re-running 0080)
-- ============================================================================

create or replace function public.cc_sync_rubric_aspects(p_task uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_task   record;
  v_item   jsonb;
  v_key    text;
  v_keys   text[] := '{}';
  v_pos    integer := 0;
  v_type   text;
  v_method text;
begin
  select id, skill_area_id, competition_module, rubric
    into v_task
    from public.cc_test_tasks
   where id = p_task;
  if not found or v_task.rubric is null or jsonb_typeof(v_task.rubric -> 'items') is distinct from 'array' then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(v_task.rubric -> 'items') loop
    if coalesce(v_item ->> 'id', '') !~ '^[a-z0-9_]{1,40}$' then
      continue;
    end if;
    v_key := 'rubric:' || (v_item ->> 'id');
    if v_key = any (v_keys) then
      continue;
    end if;
    v_keys := v_keys || v_key;
    v_pos := v_pos + 1;
    v_type := case when v_item ->> 'type' = 'judgement' then 'judgement' else 'measurement' end;
    v_method := case when v_type = 'measurement' and coalesce(v_item ->> 'check_type', 'ai') = 'ai' then 'ai_drawing' else 'trainer' end;

    update public.cc_task_aspects
       set position           = v_pos,
           description_en     = coalesce(nullif(v_item ->> 'text_en', ''), v_item ->> 'id'),
           description_ar     = coalesce(nullif(v_item ->> 'text_ar', ''), nullif(v_item ->> 'text_en', ''), v_item ->> 'id'),
           skill_area_id      = v_task.skill_area_id,
           competition_module = v_task.competition_module,
           type               = v_type,
           max_points         = greatest(coalesce((v_item ->> 'points')::numeric, 0), 0),
           method             = v_method,
           partial_rule       = null,
           student_hint_en    = nullif(v_item ->> 'student_hint_en', ''),
           student_hint_ar    = nullif(v_item ->> 'student_hint_ar', ''),
           updated_at         = now()
     where task_id = p_task
       and check_key = v_key;

    if not found then
      insert into public.cc_task_aspects
        (task_id, position, description_en, description_ar, skill_area_id, competition_module,
         type, max_points, method, partial_rule, check_key, student_hint_en, student_hint_ar)
      values
        (p_task, v_pos,
         coalesce(nullif(v_item ->> 'text_en', ''), v_item ->> 'id'),
         coalesce(nullif(v_item ->> 'text_ar', ''), nullif(v_item ->> 'text_en', ''), v_item ->> 'id'),
         v_task.skill_area_id, v_task.competition_module,
         v_type, greatest(coalesce((v_item ->> 'points')::numeric, 0), 0), v_method, null, v_key,
         nullif(v_item ->> 'student_hint_en', ''), nullif(v_item ->> 'student_hint_ar', ''));
    end if;
  end loop;

  delete from public.cc_task_aspects
   where task_id = p_task
     and check_key like 'rubric:%'
     and not (check_key = any (v_keys));

  return v_pos;
end
$$;

revoke all on function public.cc_sync_rubric_aspects(uuid) from public, anon, authenticated;
grant execute on function public.cc_sync_rubric_aspects(uuid) to service_role;

-- ---------------------------------------------------------------- default rubric
update public.cc_test_tasks
   set rubric = $rubric${
  "version": 1,
  "kind": "part",
  "items": [
    {
      "id": "title_block",
      "type": "measurement",
      "text_en": "Title block complete (name, title, scale, material, date, sheet size, drawing number)",
      "text_ar": "جدول العنوان مكتمل (الاسم، العنوان، المقياس، المادة، التاريخ، مقاس الورقة، رقم الرسمة)",
      "student_hint_en": "A manufacturer reads the title block first. Every field in it needs a value.",
      "student_hint_ar": "أول ما يقرؤه المصنّع هو جدول العنوان. يحتاج كل حقل فيه إلى قيمة.",
      "points": 2,
      "check_type": "ai",
      "applies": "both",
      "ai_guidance": "Pass only if a title block is visible and each of these fields has a value: drawer name, drawing title, scale, material, date, sheet size, drawing number. Name the missing fields in the evidence."
    },
    {
      "id": "projection",
      "type": "measurement",
      "text_en": "Projection symbol present and consistent with the view layout (first or third angle)",
      "text_ar": "رمز الإسقاط موجود ويتفق مع ترتيب المناظر (الزاوية الأولى أو الثالثة)",
      "student_hint_en": "Both first and third angle are accepted. The symbol you show must match how your views are arranged.",
      "student_hint_ar": "الزاويتان الأولى والثالثة مقبولتان. يجب أن يطابق الرمز الذي تضعه طريقة ترتيب مناظرك.",
      "points": 2,
      "check_type": "ai",
      "applies": "both",
      "ai_guidance": "First-angle and third-angle are BOTH correct. Pass when a projection symbol is visible AND the arrangement of the orthographic views agrees with it (first angle: the top view sits below the front view and the left view sits to the right; third angle: the top view sits above and the left view sits to the left). Fail when the symbol is missing or contradicts the layout. Never fail because third angle is used."
    },
    {
      "id": "views",
      "type": "measurement",
      "text_en": "Required views present (as the task asks)",
      "text_ar": "المناظر المطلوبة موجودة (كما تطلب المهمة)",
      "student_hint_en": "Read the task again and check that every view it asks for is on the sheet.",
      "student_hint_ar": "اقرأ المهمة مرة أخرى وتأكد أن كل منظر تطلبه موجود على الورقة.",
      "points": 2,
      "check_type": "ai",
      "applies": "both",
      "ai_guidance": "Use the task brief to know which views are required. If the brief lists no views, pass when the views shown are enough to define the part completely, otherwise answer unclear."
    },
    {
      "id": "no_extra_views",
      "type": "measurement",
      "text_en": "No unnecessary views",
      "text_ar": "لا مناظر غير ضرورية",
      "student_hint_en": "Each view should add information. A view that only repeats what another view shows can go.",
      "student_hint_ar": "يجب أن يضيف كل منظر معلومة جديدة. المنظر الذي يكرر ما يظهره منظر آخر يمكن حذفه.",
      "points": 1,
      "check_type": "ai",
      "applies": "both",
      "ai_guidance": "Fail only when a view clearly adds no information that the other views do not already show."
    },
    {
      "id": "sections",
      "type": "measurement",
      "text_en": "Section views hatched, with labelled cutting planes",
      "text_ar": "مناظر المقاطع مهشّرة، مع مستويات قطع معنونة",
      "student_hint_en": "A section view needs hatching, and its cutting plane needs the same letters as the section's label.",
      "student_hint_ar": "يحتاج منظر المقطع إلى تهشير، ويحتاج مستوى القطع إلى الحروف نفسها التي تحملها تسمية المقطع.",
      "points": 2,
      "check_type": "ai",
      "applies": "both",
      "ai_guidance": "If the drawing has section views: pass when each is hatched and its cutting plane line is drawn and labelled with matching letters (for example A-A). If the brief requires a section and none is shown, fail. If there is no section view and the brief does not ask for one, pass."
    },
    {
      "id": "dimensions",
      "type": "measurement",
      "text_en": "Every feature dimensioned",
      "text_ar": "كل الملامح لها أبعاد",
      "student_hint_en": "A machinist must be able to make every feature from the drawing alone, without measuring the model.",
      "student_hint_ar": "يجب أن يتمكن الفنّي من تصنيع كل ملمح من الرسمة وحدها، دون الرجوع إلى النموذج.",
      "points": 2.5,
      "check_type": "ai",
      "applies": "part",
      "ai_guidance": "Check that every visible feature (holes, pockets, fillets, chamfers, steps, overall sizes) has a size and a position. Do NOT judge whether any value is correct."
    },
    {
      "id": "no_over_dimensioning",
      "type": "measurement",
      "text_en": "No over-dimensioning (no duplicate or redundant dimensions)",
      "text_ar": "لا أبعاد زائدة (لا أبعاد مكررة أو فائضة)",
      "student_hint_en": "Each size should appear once. A chain that closes a loop also counts as a repeat.",
      "student_hint_ar": "يجب أن يظهر كل بُعد مرة واحدة. سلسلة الأبعاد التي تُغلق حلقة تُعد تكرارًا أيضًا.",
      "points": 2,
      "check_type": "ai",
      "applies": "part",
      "ai_guidance": "Fail when the same size is dimensioned twice (also across views) or when a chain of dimensions plus an overall dimension over-defines a length."
    },
    {
      "id": "no_overlap",
      "type": "measurement",
      "text_en": "No overlapping dimensions or text",
      "text_ar": "لا أبعاد أو نصوص متداخلة",
      "student_hint_en": "Space dimensions out so no line, arrow or text crosses another.",
      "student_hint_ar": "باعد بين الأبعاد بحيث لا يتقاطع خط أو سهم أو نص مع آخر.",
      "points": 1,
      "check_type": "ai",
      "applies": "both"
    },
    {
      "id": "symbols",
      "type": "measurement",
      "text_en": "Correct ISO symbols and abbreviations, dimensions in mm",
      "text_ar": "رموز واختصارات ISO صحيحة، والأبعاد بالمليمتر",
      "student_hint_en": "Use the ISO symbols for diameters, radii and threads, and millimetres throughout.",
      "student_hint_ar": "استخدم رموز ISO للأقطار وأنصاف الأقطار والأسنان، والمليمتر في كل الرسمة.",
      "points": 1.5,
      "check_type": "ai",
      "applies": "both",
      "ai_guidance": "Check the notation only (for example the diameter sign for diameters, R for radii, M for metric threads, no inch marks). Do NOT judge the values."
    },
    {
      "id": "tolerance_note",
      "type": "measurement",
      "text_en": "General tolerance note present (for example ISO 2768-m)",
      "text_ar": "ملاحظة التفاوت العام موجودة (مثل ISO 2768-m)",
      "student_hint_en": "Dimensions without their own tolerance need a general tolerance note on the sheet.",
      "student_hint_ar": "الأبعاد التي ليس لها تفاوت خاص تحتاج إلى ملاحظة تفاوت عام على الورقة.",
      "points": 1,
      "check_type": "ai",
      "applies": "part"
    },
    {
      "id": "limits_fits",
      "type": "measurement",
      "text_en": "Limits and fits notation where required (for example H7/g6)",
      "text_ar": "رموز الحدود والتوافقات حيث تلزم (مثل H7/g6)",
      "student_hint_en": "Features that must fit another part need a fit or limit tolerance, written in ISO form.",
      "student_hint_ar": "الملامح التي يجب أن تتوافق مع قطعة أخرى تحتاج إلى تفاوت توافق أو حدود بصيغة ISO.",
      "points": 1,
      "check_type": "ai",
      "applies": "both",
      "required": null
    },
    {
      "id": "surface_texture",
      "type": "measurement",
      "text_en": "Surface texture symbols where required",
      "text_ar": "رموز خشونة السطح حيث تلزم",
      "student_hint_en": "Surfaces with a finishing requirement need the ISO surface texture symbol with its Ra value.",
      "student_hint_ar": "الأسطح التي لها متطلب تشطيب تحتاج إلى رمز خشونة السطح بمعيار ISO مع قيمة Ra.",
      "points": 1,
      "check_type": "ai",
      "applies": "part",
      "required": null
    },
    {
      "id": "gdt",
      "type": "measurement",
      "text_en": "GD&T frames and datums present where required",
      "text_ar": "إطارات التفاوتات الهندسية (GD&T) والمراجع موجودة حيث تلزم",
      "student_hint_en": "A geometric tolerance needs a feature control frame, and the datums it refers to must be marked.",
      "student_hint_ar": "يحتاج التفاوت الهندسي إلى إطار تحكم، ويجب تحديد المراجع التي يشير إليها.",
      "points": 1,
      "check_type": "ai",
      "applies": "part",
      "required": null,
      "ai_guidance": "Check presence and form only (frame with symbol, value and datum letters; datum triangles drawn). Do NOT judge whether the tolerance suits the function."
    },
    {
      "id": "key_dimensions",
      "type": "measurement",
      "text_en": "Key dimension values correct",
      "text_ar": "قيم الأبعاد الرئيسية صحيحة",
      "student_hint_en": "Compare your key sizes with the model you made in the earlier task.",
      "student_hint_ar": "قارن أبعادك الرئيسية مع النموذج الذي صممته في المهمة السابقة.",
      "points": 3,
      "check_type": "manual",
      "applies": "part"
    },
    {
      "id": "presentation",
      "type": "judgement",
      "text_en": "Presentation and view selection",
      "text_ar": "العرض واختيار المناظر",
      "student_hint_en": "A trainer scores this from 0 to 3.",
      "student_hint_ar": "يقيّم المدرّب هذا من 0 إلى 3.",
      "points": 1,
      "check_type": "manual",
      "applies": "both"
    },
    {
      "id": "readability",
      "type": "judgement",
      "text_en": "Overall readability for manufacture",
      "text_ar": "سهولة القراءة للتصنيع عمومًا",
      "student_hint_en": "A trainer scores this from 0 to 3.",
      "student_hint_ar": "يقيّم المدرّب هذا من 0 إلى 3.",
      "points": 1,
      "check_type": "manual",
      "applies": "both"
    }
  ]
}$rubric$::jsonb
 where id = 'cc080000-0000-4000-8000-000000000104';

do $$
declare
  v_n     integer;
  v_sum   numeric;
  v_max   numeric;
begin
  if not exists (select 1 from public.cc_test_tasks where id = 'cc080000-0000-4000-8000-000000000104') then
    raise notice '0082: diagnostic drawing task not found (run 0080 first); rubric not applied';
    return;
  end if;
  v_n := public.cc_sync_rubric_aspects('cc080000-0000-4000-8000-000000000104');
  select coalesce(sum(max_points), 0) into v_sum from public.cc_task_aspects where task_id = 'cc080000-0000-4000-8000-000000000104';
  select max_points into v_max from public.cc_test_tasks where id = 'cc080000-0000-4000-8000-000000000104';
  raise notice '0082: % rubric aspects, % points (task max %)', v_n, v_sum, v_max;
  if v_sum <> v_max then
    raise notice '0082: WARNING aspect points (%) differ from the task max_points (%)', v_sum, v_max;
  end if;
end
$$;
