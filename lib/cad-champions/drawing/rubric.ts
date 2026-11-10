// Drawing check rubric (Prompt 8 Step A, COMPETITION_ALIGNMENT section E).
// PURE data + helpers; tested in rubric.test.ts.
//
// A rubric lives in cc_test_tasks.rubric as { version: 1, kind, items }.
// Migration 0082 writes the default part rubric to the diagnostic drawing task
// and cc_sync_rubric_aspects() turns every item into one cc_task_aspects row
// (check_key "rubric:<id>"). Items stay editable (Prompt 11 admin).
//
// Rules from section E:
//   - first OR third angle projection is accepted; the symbol must be present
//     AND agree with the view layout. Never fail a drawing for third angle.
//   - measurement items are pass/fail; "ai" items get an AI first pass that a
//     trainer confirms, "manual" items are checked by the trainer only.
//   - judgement items are scored 0-3 by the trainer.
//   - student hints explain the rule without giving the answer.

export type RubricCheckType = "ai" | "manual";
export type RubricApplies = "part" | "assembly" | "both";
export type RubricItemType = "measurement" | "judgement";

export interface RubricItem {
  /** Stable id; the aspect check_key is `rubric:<id>`. */
  id: string;
  type: RubricItemType;
  text_en: string;
  text_ar: string;
  /** Shown to the student when the item failed: the rule, never the answer. */
  student_hint_en: string;
  student_hint_ar: string;
  points: number;
  check_type: RubricCheckType;
  applies: RubricApplies;
  /**
   * "Where required" items (limits and fits, surface texture, GD&T, exploded
   * view). true = the task requires it; false = not required (pass when
   * absent); null/undefined = unknown (absent -> "unclear", the trainer decides).
   */
  required?: boolean | null;
  /** Extra English guidance for the AI only (never shown to students). */
  ai_guidance?: string;
}

export interface Rubric {
  version: 1;
  kind: "part" | "assembly";
  items: RubricItem[];
}

export const RUBRIC_CHECK_PREFIX = "rubric:";

export function rubricCheckKey(id: string): string {
  return `${RUBRIC_CHECK_PREFIX}${id}`;
}

/** "rubric:title_block" -> "title_block"; anything else -> null. */
export function rubricIdFromCheckKey(checkKey: string | null | undefined): string | null {
  if (!checkKey || !checkKey.startsWith(RUBRIC_CHECK_PREFIX)) return null;
  const id = checkKey.slice(RUBRIC_CHECK_PREFIX.length).trim();
  return /^[a-z0-9_]{1,40}$/.test(id) ? id : null;
}

export const DEFAULT_DRAWING_RUBRIC: readonly RubricItem[] = [
  {
    id: "title_block",
    type: "measurement",
    text_en: "Title block complete (name, title, scale, material, date, sheet size, drawing number)",
    text_ar: "جدول العنوان مكتمل (الاسم، العنوان، المقياس، المادة، التاريخ، مقاس الورقة، رقم الرسمة)",
    student_hint_en: "A manufacturer reads the title block first. Every field in it needs a value.",
    student_hint_ar: "أول ما يقرؤه المصنّع هو جدول العنوان. يحتاج كل حقل فيه إلى قيمة.",
    points: 2,
    check_type: "ai",
    applies: "both",
    ai_guidance:
      "Pass only if a title block is visible and each of these fields has a value: drawer name, drawing title, scale, material, date, sheet size, drawing number. Name the missing fields in the evidence.",
  },
  {
    id: "projection",
    type: "measurement",
    text_en: "Projection symbol present and consistent with the view layout (first or third angle)",
    text_ar: "رمز الإسقاط موجود ويتفق مع ترتيب المناظر (الزاوية الأولى أو الثالثة)",
    student_hint_en: "Both first and third angle are accepted. The symbol you show must match how your views are arranged.",
    student_hint_ar: "الزاويتان الأولى والثالثة مقبولتان. يجب أن يطابق الرمز الذي تضعه طريقة ترتيب مناظرك.",
    points: 2,
    check_type: "ai",
    applies: "both",
    ai_guidance:
      "First-angle and third-angle are BOTH correct. Pass when a projection symbol is visible AND the arrangement of the orthographic views agrees with it (first angle: the top view sits below the front view and the left view sits to the right; third angle: the top view sits above and the left view sits to the left). Fail when the symbol is missing or contradicts the layout. Never fail because third angle is used.",
  },
  {
    id: "views",
    type: "measurement",
    text_en: "Required views present (as the task asks)",
    text_ar: "المناظر المطلوبة موجودة (كما تطلب المهمة)",
    student_hint_en: "Read the task again and check that every view it asks for is on the sheet.",
    student_hint_ar: "اقرأ المهمة مرة أخرى وتأكد أن كل منظر تطلبه موجود على الورقة.",
    points: 2,
    check_type: "ai",
    applies: "both",
    ai_guidance:
      "Use the task brief to know which views are required. If the brief lists no views, pass when the views shown are enough to define the part completely, otherwise answer unclear.",
  },
  {
    id: "no_extra_views",
    type: "measurement",
    text_en: "No unnecessary views",
    text_ar: "لا مناظر غير ضرورية",
    student_hint_en: "Each view should add information. A view that only repeats what another view shows can go.",
    student_hint_ar: "يجب أن يضيف كل منظر معلومة جديدة. المنظر الذي يكرر ما يظهره منظر آخر يمكن حذفه.",
    points: 1,
    check_type: "ai",
    applies: "both",
    ai_guidance: "Fail only when a view clearly adds no information that the other views do not already show.",
  },
  {
    id: "sections",
    type: "measurement",
    text_en: "Section views hatched, with labelled cutting planes",
    text_ar: "مناظر المقاطع مهشّرة، مع مستويات قطع معنونة",
    student_hint_en: "A section view needs hatching, and its cutting plane needs the same letters as the section's label.",
    student_hint_ar: "يحتاج منظر المقطع إلى تهشير، ويحتاج مستوى القطع إلى الحروف نفسها التي تحملها تسمية المقطع.",
    points: 2,
    check_type: "ai",
    applies: "both",
    ai_guidance:
      "If the drawing has section views: pass when each is hatched and its cutting plane line is drawn and labelled with matching letters (for example A-A). If the brief requires a section and none is shown, fail. If there is no section view and the brief does not ask for one, pass.",
  },
  {
    id: "dimensions",
    type: "measurement",
    text_en: "Every feature dimensioned",
    text_ar: "كل الملامح لها أبعاد",
    student_hint_en: "A machinist must be able to make every feature from the drawing alone, without measuring the model.",
    student_hint_ar: "يجب أن يتمكن الفنّي من تصنيع كل ملمح من الرسمة وحدها، دون الرجوع إلى النموذج.",
    points: 2.5,
    check_type: "ai",
    applies: "part",
    ai_guidance:
      "Check that every visible feature (holes, pockets, fillets, chamfers, steps, overall sizes) has a size and a position. Do NOT judge whether any value is correct.",
  },
  {
    id: "no_over_dimensioning",
    type: "measurement",
    text_en: "No over-dimensioning (no duplicate or redundant dimensions)",
    text_ar: "لا أبعاد زائدة (لا أبعاد مكررة أو فائضة)",
    student_hint_en: "Each size should appear once. A chain that closes a loop also counts as a repeat.",
    student_hint_ar: "يجب أن يظهر كل بُعد مرة واحدة. سلسلة الأبعاد التي تُغلق حلقة تُعد تكرارًا أيضًا.",
    points: 2,
    check_type: "ai",
    applies: "part",
    ai_guidance:
      "Fail when the same size is dimensioned twice (also across views) or when a chain of dimensions plus an overall dimension over-defines a length.",
  },
  {
    id: "no_overlap",
    type: "measurement",
    text_en: "No overlapping dimensions or text",
    text_ar: "لا أبعاد أو نصوص متداخلة",
    student_hint_en: "Space dimensions out so no line, arrow or text crosses another.",
    student_hint_ar: "باعد بين الأبعاد بحيث لا يتقاطع خط أو سهم أو نص مع آخر.",
    points: 1,
    check_type: "ai",
    applies: "both",
  },
  {
    id: "symbols",
    type: "measurement",
    text_en: "Correct ISO symbols and abbreviations, dimensions in mm",
    text_ar: "رموز واختصارات ISO صحيحة، والأبعاد بالمليمتر",
    student_hint_en: "Use the ISO symbols for diameters, radii and threads, and millimetres throughout.",
    student_hint_ar: "استخدم رموز ISO للأقطار وأنصاف الأقطار والأسنان، والمليمتر في كل الرسمة.",
    points: 1.5,
    check_type: "ai",
    applies: "both",
    ai_guidance:
      "Check the notation only (for example the diameter sign for diameters, R for radii, M for metric threads, no inch marks). Do NOT judge the values.",
  },
  {
    id: "tolerance_note",
    type: "measurement",
    text_en: "General tolerance note present (for example ISO 2768-m)",
    text_ar: "ملاحظة التفاوت العام موجودة (مثل ISO 2768-m)",
    student_hint_en: "Dimensions without their own tolerance need a general tolerance note on the sheet.",
    student_hint_ar: "الأبعاد التي ليس لها تفاوت خاص تحتاج إلى ملاحظة تفاوت عام على الورقة.",
    points: 1,
    check_type: "ai",
    applies: "part",
  },
  {
    id: "limits_fits",
    type: "measurement",
    text_en: "Limits and fits notation where required (for example H7/g6)",
    text_ar: "رموز الحدود والتوافقات حيث تلزم (مثل H7/g6)",
    student_hint_en: "Features that must fit another part need a fit or limit tolerance, written in ISO form.",
    student_hint_ar: "الملامح التي يجب أن تتوافق مع قطعة أخرى تحتاج إلى تفاوت توافق أو حدود بصيغة ISO.",
    points: 1,
    check_type: "ai",
    applies: "both",
    required: null,
  },
  {
    id: "surface_texture",
    type: "measurement",
    text_en: "Surface texture symbols where required",
    text_ar: "رموز خشونة السطح حيث تلزم",
    student_hint_en: "Surfaces with a finishing requirement need the ISO surface texture symbol with its Ra value.",
    student_hint_ar: "الأسطح التي لها متطلب تشطيب تحتاج إلى رمز خشونة السطح بمعيار ISO مع قيمة Ra.",
    points: 1,
    check_type: "ai",
    applies: "part",
    required: null,
  },
  {
    id: "gdt",
    type: "measurement",
    text_en: "GD&T frames and datums present where required",
    text_ar: "إطارات التفاوتات الهندسية (GD&T) والمراجع موجودة حيث تلزم",
    student_hint_en: "A geometric tolerance needs a feature control frame, and the datums it refers to must be marked.",
    student_hint_ar: "يحتاج التفاوت الهندسي إلى إطار تحكم، ويجب تحديد المراجع التي يشير إليها.",
    points: 1,
    check_type: "ai",
    applies: "part",
    required: null,
    ai_guidance:
      "Check presence and form only (frame with symbol, value and datum letters; datum triangles drawn). Do NOT judge whether the tolerance suits the function.",
  },
  {
    id: "parts_list",
    type: "measurement",
    text_en: "Parts list with more than one column, and balloons",
    text_ar: "قائمة قطع بأكثر من عمود، مع فقاعات الترقيم",
    student_hint_en: "An assembly drawing needs a parts list and a balloon on every part that points to its row.",
    student_hint_ar: "تحتاج رسمة التجميع إلى قائمة قطع، وإلى فقاعة على كل قطعة تشير إلى سطرها.",
    points: 2,
    check_type: "ai",
    applies: "assembly",
  },
  {
    id: "exploded_view",
    type: "measurement",
    text_en: "Exploded isometric view (when required)",
    text_ar: "منظر متفجّر أيزومتري (عند الطلب)",
    student_hint_en: "When the task asks for an exploded view, show every part pulled apart along its assembly direction.",
    student_hint_ar: "عندما تطلب المهمة منظرًا متفجّرًا، اعرض كل القطع مفصولة على اتجاه تجميعها.",
    points: 1,
    check_type: "ai",
    applies: "assembly",
    required: null,
  },
  {
    id: "key_dimensions",
    type: "measurement",
    text_en: "Key dimension values correct",
    text_ar: "قيم الأبعاد الرئيسية صحيحة",
    student_hint_en: "Compare your key sizes with the model you made in the earlier task.",
    student_hint_ar: "قارن أبعادك الرئيسية مع النموذج الذي صممته في المهمة السابقة.",
    points: 3,
    check_type: "manual",
    applies: "part",
  },
  {
    id: "presentation",
    type: "judgement",
    text_en: "Presentation and view selection",
    text_ar: "العرض واختيار المناظر",
    student_hint_en: "A trainer scores this from 0 to 3.",
    student_hint_ar: "يقيّم المدرّب هذا من 0 إلى 3.",
    points: 1,
    check_type: "manual",
    applies: "both",
  },
  {
    id: "readability",
    type: "judgement",
    text_en: "Overall readability for manufacture",
    text_ar: "سهولة القراءة للتصنيع عمومًا",
    student_hint_en: "A trainer scores this from 0 to 3.",
    student_hint_ar: "يقيّم المدرّب هذا من 0 إلى 3.",
    points: 1,
    check_type: "manual",
    applies: "both",
  },
];

/** The default rubric for a part or an assembly drawing. */
export function defaultRubric(kind: "part" | "assembly"): Rubric {
  return {
    version: 1,
    kind,
    items: DEFAULT_DRAWING_RUBRIC.filter((i) => i.applies === "both" || i.applies === kind).map((i) => ({ ...i })),
  };
}

export function rubricTotal(items: readonly Pick<RubricItem, "points">[]): number {
  return Math.round(items.reduce((s, i) => s + (Number(i.points) || 0), 0) * 100) / 100;
}

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads cc_test_tasks.rubric (any shape) into items; invalid items are dropped. Never throws. */
export function parseRubric(json: unknown): Rubric | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.items)) return null;
  const seen = new Set<string>();
  const items: RubricItem[] = [];
  for (const raw of o.items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id, 40);
    if (!/^[a-z0-9_]{1,40}$/.test(id) || seen.has(id)) continue;
    const points = Number(r.points);
    if (!Number.isFinite(points) || points < 0) continue;
    const type: RubricItemType = r.type === "judgement" ? "judgement" : "measurement";
    seen.add(id);
    const guidance = str(r.ai_guidance, 1200);
    items.push({
      id,
      type,
      text_en: str(r.text_en) || id,
      text_ar: str(r.text_ar) || str(r.text_en) || id,
      student_hint_en: str(r.student_hint_en),
      student_hint_ar: str(r.student_hint_ar),
      points,
      check_type: type === "judgement" ? "manual" : r.check_type === "manual" ? "manual" : "ai",
      applies: r.applies === "part" || r.applies === "assembly" ? r.applies : "both",
      ...(typeof r.required === "boolean" ? { required: r.required } : "required" in r ? { required: null } : {}),
      ...(guidance ? { ai_guidance: guidance } : {}),
    });
  }
  return { version: 1, kind: o.kind === "assembly" ? "assembly" : "part", items };
}

/** The aspect method an item maps to. */
export function aspectMethodFor(item: Pick<RubricItem, "type" | "check_type">): "ai_drawing" | "trainer" {
  return item.type === "measurement" && item.check_type === "ai" ? "ai_drawing" : "trainer";
}
