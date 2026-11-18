// Landing page reference data (pure). The page reads cc_skill_areas and
// cc_competition_modules (anon-readable, migration 0077); these are verbatim
// copies of that seed so the page never breaks when the query fails or the
// migration has not run yet. Keep in step with supabase/migrations/0077_cc_core.sql.

import type { Locale } from "@/i18n/routing";

import type { CcCompetitionModuleCode, CcSkillAreaId } from "../db/types";

export type LandingSkillArea = {
  id: CcSkillAreaId;
  slug: string;
  name_en: string;
  name_ar: string;
  weight_percent: number;
  description_en: string;
  description_ar: string;
};

export type LandingModule = {
  code: CcCompetitionModuleCode;
  position: number;
  name_en: string;
  name_ar: string;
  hours: number;
  summary_en: string;
  summary_ar: string;
};

export const FALLBACK_SKILL_AREAS: readonly LandingSkillArea[] = [
  {
    id: 1,
    slug: "work_organization",
    name_en: "Work organization and standards",
    name_ar: "تنظيم العمل والمعايير",
    weight_percent: 10,
    description_en:
      "How you plan your time, name and organise your files, and follow the rules of each task. Good organisation means nothing is lost or late, and your work meets the standards the judges expect.",
    description_ar:
      "كيف تخطط لوقتك، وتسمّي ملفاتك وترتّبها، وتلتزم بتعليمات كل مهمة. التنظيم الجيد يعني ألا يضيع شيء أو يتأخر، وأن يطابق عملك المعايير التي يتوقعها الحكّام.",
  },
  {
    id: 2,
    slug: "software_hardware",
    name_en: "Software and hardware",
    name_ar: "البرمجيات والأجهزة",
    weight_percent: 5,
    description_en:
      "How well you know your CAD software and your computer: settings, units, file formats and exporting. These skills stop technical problems from slowing you down on test day.",
    description_ar:
      "مدى معرفتك ببرنامج التصميم وبجهاز الحاسوب: الإعدادات والوحدات وصيغ الملفات والتصدير. هذه المهارات تمنع المشكلات التقنية من تعطيلك يوم الاختبار.",
  },
  {
    id: 3,
    slug: "3d_modelling",
    name_en: "3D modelling",
    name_ar: "النمذجة ثلاثية الأبعاد",
    weight_percent: 30,
    description_en:
      "Building accurate 3D parts and assemblies from drawings, using features such as extrudes, holes, fillets and patterns. It carries the most marks, so precise models matter a lot.",
    description_ar:
      "بناء قطع وتجميعات ثلاثية الأبعاد دقيقة من الرسومات، باستخدام أدوات مثل البثق والثقوب وتدوير الحواف والأنماط. لهذا الجزء أكبر نصيب من الدرجات، لذلك تهمّ دقة النموذج كثيرًا.",
  },
  {
    id: 4,
    slug: "rendering_animation",
    name_en: "Rendering and animation",
    name_ar: "الإظهار والتحريك",
    weight_percent: 10,
    description_en:
      "Turning your models into realistic images and short animations that show how a product looks and moves. Good renders explain a design clearly to people who do not read drawings.",
    description_ar:
      "تحويل نماذجك إلى صور واقعية ومقاطع تحريك قصيرة توضّح شكل المنتج وطريقة حركته. الإظهار الجيد يشرح التصميم بوضوح لمن لا يقرأ الرسومات الهندسية.",
  },
  {
    id: 5,
    slug: "reverse_engineering",
    name_en: "Reverse engineering",
    name_ar: "الهندسة العكسية",
    weight_percent: 15,
    description_en:
      "Measuring a real object with tools such as callipers and rebuilding it as an accurate 3D model. You learn to take careful measurements and turn them into a model that could be manufactured.",
    description_ar:
      "قياس قطعة حقيقية بأدوات مثل القدمة ذات الورنية، ثم إعادة بنائها كنموذج ثلاثي الأبعاد دقيق. تتعلّم أخذ قياسات دقيقة وتحويلها إلى نموذج يمكن تصنيعه.",
  },
  {
    id: 6,
    slug: "technical_drawing",
    name_en: "Technical drawing (ISO, first-angle, GD&T)",
    name_ar: "الرسم الفني (ISO، الإسقاط الأول، GD&T)",
    weight_percent: 30,
    description_en:
      "Creating clear engineering drawings that follow ISO rules, with first-angle views, dimensions, tolerances and GD&T. A good drawing lets anyone make the part exactly as you intended.",
    description_ar:
      "إعداد رسومات هندسية واضحة تتبع قواعد ISO، بمساقط بطريقة الإسقاط الأول وأبعاد وتفاوتات ورموز GD&T. الرسم الجيد يتيح لأي شخص تصنيع القطعة تمامًا كما أردت.",
  },
];

export const FALLBACK_MODULES: readonly LandingModule[] = [
  {
    code: "M1",
    position: 1,
    name_en: "Mechanical fabrication",
    name_ar: "التصنيع الميكانيكي",
    hours: 6,
    summary_en:
      "You build sheet metal parts, welded frames and bolted assemblies, then prepare the drawings a workshop needs to make them. The day ends with a short exploded animation of the assembly.",
    summary_ar:
      "تبني قطعًا من الصفائح المعدنية وهياكل ملحومة وتجميعات بالبراغي، ثم تُعدّ الرسومات التي تحتاجها الورشة لتصنيعها. ويُختتم اليوم بمقطع تحريك قصير يُظهر التجميع مفككًا.",
  },
  {
    code: "M2",
    position: 2,
    name_en: "Mechanical design challenge",
    name_ar: "تحدي التصميم الميكانيكي",
    hours: 6,
    summary_en:
      "You receive an existing assembly and a design brief, and change the design so it does the new job. You show your solution with drawings, renders and a motion simulation, and some parts may be 3D printed.",
    summary_ar:
      "تستلم تجميعًا جاهزًا وموجز تصميم، وتعدّل التصميم ليؤدي المهمة الجديدة. تعرض حلّك برسومات وصور واقعية ومحاكاة للحركة، وقد تُطبع بعض القطع بالطباعة ثلاثية الأبعاد.",
  },
  {
    code: "M3",
    position: 3,
    name_en: "Assemblies and detail drawings for manufacture",
    name_ar: "التجميعات ورسومات التفاصيل للتصنيع",
    hours: 6,
    summary_en:
      "You model parts quickly and accurately from detail drawings and put them together into an assembly with standard parts. Then you produce clear drawings that are ready for manufacture.",
    summary_ar:
      "تنمذج القطع بسرعة ودقة من رسومات التفاصيل، وتجمعها في تجميع واحد مع قطع قياسية. ثم تُعدّ رسومات واضحة جاهزة للتصنيع.",
  },
  {
    code: "M4",
    position: 4,
    name_en: "Reverse engineering",
    name_ar: "الهندسة العكسية",
    hours: 4,
    summary_en:
      "You measure a real part with hand instruments and sketch it on paper, then rebuild it as an accurate 3D model with drawings. The part is taken away after two hours, so you finish from your own sketches.",
    summary_ar:
      "تقيس قطعة حقيقية بأدوات قياس يدوية وترسمها على الورق، ثم تعيد بناءها كنموذج ثلاثي الأبعاد دقيق مع الرسومات. تُسحب القطعة بعد ساعتين، فتُكمل العمل من رسوماتك.",
  },
];

const MODULE_CODES = new Set(["M1", "M2", "M3", "M4"]);

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validated skill areas from a cc_skill_areas query, sorted by id. Returns the
 * fallback unless all six areas arrive with names, descriptions and weights.
 */
export function normaliseSkillAreas(rows: unknown): readonly LandingSkillArea[] {
  if (!Array.isArray(rows)) return FALLBACK_SKILL_AREAS;
  const out: LandingSkillArea[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const id = Number(r?.id);
    const weight = Number(r?.weight_percent);
    if (!Number.isInteger(id) || id < 1 || id > 6 || !Number.isFinite(weight) || weight < 0) continue;
    if (![r.slug, r.name_en, r.name_ar, r.description_en, r.description_ar].every(isText)) continue;
    out.push({
      id: id as CcSkillAreaId,
      slug: String(r.slug),
      name_en: String(r.name_en),
      name_ar: String(r.name_ar),
      weight_percent: weight,
      description_en: String(r.description_en),
      description_ar: String(r.description_ar),
    });
  }
  const unique = new Set(out.map((a) => a.id));
  if (out.length !== 6 || unique.size !== 6) return FALLBACK_SKILL_AREAS;
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Validated, active competition modules from a cc_competition_modules query,
 * sorted by position. Falls back when none are usable.
 */
export function normaliseModules(rows: unknown): readonly LandingModule[] {
  if (!Array.isArray(rows)) return FALLBACK_MODULES;
  const out: LandingModule[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || !MODULE_CODES.has(String(r.code)) || r.is_active === false) continue;
    const hours = Number(r.hours);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    if (![r.name_en, r.name_ar, r.summary_en, r.summary_ar].every(isText)) continue;
    out.push({
      code: String(r.code) as CcCompetitionModuleCode,
      position: Number(r.position) || 0,
      name_en: String(r.name_en),
      name_ar: String(r.name_ar),
      hours,
      summary_en: String(r.summary_en),
      summary_ar: String(r.summary_ar),
    });
  }
  if (out.length === 0) return FALLBACK_MODULES;
  return out.sort((a, b) => a.position - b.position || a.code.localeCompare(b.code));
}

/** Total competition hours (e.g. 22 for 6 + 6 + 6 + 4). */
export function totalHours(modules: readonly LandingModule[]): number {
  return modules.reduce((sum, m) => sum + m.hours, 0);
}

export function skillAreaText(a: LandingSkillArea, locale: Locale): { name: string; description: string } {
  return locale === "ar"
    ? { name: a.name_ar, description: a.description_ar }
    : { name: a.name_en, description: a.description_en };
}

export function moduleText(m: LandingModule, locale: Locale): { name: string; summary: string } {
  return locale === "ar" ? { name: m.name_ar, summary: m.summary_ar } : { name: m.name_en, summary: m.summary_en };
}
