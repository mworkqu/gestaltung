// CAD Champions glossary. Short, technically correct definitions in EN and AR.
// Acronyms (STEP, GD&T, ISO 2768) stay in Latin script in Arabic.

import type { Locale } from "@/i18n/routing";

export type GlossaryId =
  | "step-file"
  | "step-ap214"
  | "step-ap242"
  | "units-mm"
  | "material-density"
  | "mass-properties"
  | "volume"
  | "solid-body"
  | "part"
  | "assembly"
  | "sub-assembly"
  | "constraint"
  | "first-angle-projection"
  | "third-angle-projection"
  | "iso-standard"
  | "detail-drawing"
  | "section-view"
  | "hatching"
  | "title-block"
  | "parts-list"
  | "balloon"
  | "dimension"
  | "tolerance"
  | "general-tolerance-iso-2768"
  | "gdt"
  | "datum"
  | "render"
  | "animation"
  | "reverse-engineering"
  | "caliper"
  | "3d-scan";

export interface GlossaryText {
  term: string;
  definition: string;
}

export interface GlossaryEntry {
  en: GlossaryText;
  ar: GlossaryText;
  /** Help Center article slug, only where an article is planned. */
  helpSlug?: string;
}

export const GLOSSARY: Record<GlossaryId, GlossaryEntry> = {
  "step-file": {
    en: {
      term: "STEP file",
      definition:
        "A neutral 3D file format (.step or .stp, ISO 10303) that moves a model between different CAD programs without losing its shape.",
    },
    ar: {
      term: "ملف STEP",
      definition:
        "صيغة ملف ثلاثية الأبعاد محايدة (.step أو .stp، معيار ISO 10303) تنقل النموذج بين برامج CAD المختلفة دون أن يتغير شكله.",
    },
    helpSlug: "how-to-export-step",
  },
  "step-ap214": {
    en: {
      term: "STEP AP214",
      definition:
        "An application protocol of STEP made for the automotive industry. It stores 3D geometry, colours and assembly structure.",
    },
    ar: {
      term: "STEP AP214",
      definition:
        "بروتوكول تطبيقي ضمن STEP صُمّم لصناعة السيارات. يحفظ الشكل ثلاثي الأبعاد والألوان وبنية التجميعة.",
    },
  },
  "step-ap242": {
    en: {
      term: "STEP AP242",
      definition:
        "A newer STEP protocol for managed model-based 3D engineering. On top of geometry it can carry PMI, such as dimensions and tolerances, inside the 3D model.",
    },
    ar: {
      term: "STEP AP242",
      definition:
        "بروتوكول STEP أحدث للهندسة ثلاثية الأبعاد المعتمدة على النموذج. يحمل مع الشكل معلومات PMI، مثل الأبعاد والتفاوتات، داخل النموذج نفسه.",
    },
  },
  "units-mm": {
    en: {
      term: "Units: millimetres",
      definition:
        "Set your CAD document to millimetres (mm) before you model. Wrong units make the part ten, a hundred or a thousand times too big or too small.",
    },
    ar: {
      term: "الوحدات: ملّيمتر",
      definition:
        "اضبط ملف CAD على الملّيمتر (mm) قبل أن تبدأ النمذجة. الوحدات الخاطئة تجعل القطعة أكبر أو أصغر بعشر أو مئة أو ألف مرة.",
    },
    helpSlug: "set-units-to-mm",
  },
  "material-density": {
    en: {
      term: "Material density",
      definition:
        "Mass per unit of volume, in kg/m³. For example, steel is about 7850 kg/m³ and aluminium about 2700 kg/m³. CAD uses it to calculate the mass of a part.",
    },
    ar: {
      term: "كثافة المادة",
      definition:
        "الكتلة في وحدة الحجم، بوحدة kg/m³. مثلًا كثافة الفولاذ نحو 7850 kg/m³ والألمنيوم نحو 2700 kg/m³. يستخدمها CAD لحساب كتلة القطعة.",
    },
    helpSlug: "set-material-and-density",
  },
  "mass-properties": {
    en: {
      term: "Mass properties",
      definition:
        "Values CAD calculates from the shape and the material: mass, volume, surface area, centre of mass and moments of inertia.",
    },
    ar: {
      term: "الخصائص الكتلية",
      definition:
        "قيم يحسبها CAD من الشكل والمادة: الكتلة والحجم ومساحة السطح ومركز الكتلة وعزوم القصور الذاتي.",
    },
  },
  volume: {
    en: {
      term: "Volume",
      definition:
        "The amount of space a solid part fills, usually in mm³ or cm³. Mass equals volume multiplied by density.",
    },
    ar: {
      term: "الحجم",
      definition:
        "مقدار الفراغ الذي يشغله الجسم الصلب، عادةً بوحدة mm³ أو cm³. الكتلة = الحجم × الكثافة.",
    },
  },
  "solid-body": {
    en: {
      term: "Solid body",
      definition:
        "A closed 3D shape with real volume and no gaps in its surface. Open surfaces or gaps are not solid and can break mass and manufacturing calculations.",
    },
    ar: {
      term: "جسم صلب",
      definition:
        "شكل ثلاثي الأبعاد مغلق له حجم حقيقي وبلا فجوات في سطحه. الأسطح المفتوحة ليست أجسامًا صلبة وقد تفسد حسابات الكتلة والتصنيع.",
    },
  },
  part: {
    en: {
      term: "Part",
      definition:
        "A single component modelled as one piece, such as a bracket or a shaft. It is not made of other parts.",
    },
    ar: {
      term: "قطعة",
      definition: "مكوّن واحد يُنمذج كقطعة واحدة، مثل حامل أو عمود. لا يتكوّن من قطع أخرى.",
    },
  },
  assembly: {
    en: {
      term: "Assembly",
      definition:
        "A set of parts and sub-assemblies placed together in one file, with constraints that define how they fit and move.",
    },
    ar: {
      term: "تجميعة",
      definition:
        "مجموعة قطع وتجميعات فرعية موضوعة معًا في ملف واحد، مع قيود تحدد كيف تتركّب وتتحرك.",
    },
  },
  "sub-assembly": {
    en: {
      term: "Sub-assembly",
      definition:
        "An assembly used as one component inside a larger assembly, for example a gearbox inside a machine.",
    },
    ar: {
      term: "تجميعة فرعية",
      definition: "تجميعة تُستخدم كمكوّن واحد داخل تجميعة أكبر، مثل علبة التروس داخل آلة.",
    },
  },
  constraint: {
    en: {
      term: "Constraint (mate)",
      definition:
        "A rule that fixes how two parts sit relative to each other, such as coincident faces or concentric holes. It removes degrees of freedom.",
    },
    ar: {
      term: "قيد (Mate)",
      definition:
        "قاعدة تحدد موضع قطعتين بالنسبة لبعضهما، مثل تطابق وجهين أو تمركز ثقبين. تُزيل درجات الحرية.",
    },
  },
  "first-angle-projection": {
    en: {
      term: "First-angle projection",
      definition:
        "A way to lay out drawing views where the object sits between you and the projection plane. The top view is placed below the front view, and the right view is placed on the left.",
    },
    ar: {
      term: "الإسقاط من الزاوية الأولى",
      definition:
        "طريقة لترتيب المساقط يكون فيها الجسم بينك وبين مستوى الإسقاط. يوضع المنظر العلوي تحت المنظر الأمامي، ويوضع المنظر الجانبي الأيمن على اليسار.",
    },
  },
  "third-angle-projection": {
    en: {
      term: "Third-angle projection",
      definition:
        "A way to lay out drawing views where the projection plane sits between you and the object. The top view is placed above the front view, and the right view is placed on the right.",
    },
    ar: {
      term: "الإسقاط من الزاوية الثالثة",
      definition:
        "طريقة لترتيب المساقط يكون فيها مستوى الإسقاط بينك وبين الجسم. يوضع المنظر العلوي فوق المنظر الأمامي، ويوضع المنظر الجانبي الأيمن على اليمين.",
    },
  },
  "iso-standard": {
    en: {
      term: "ISO standard",
      definition:
        "A rule set from the International Organization for Standardization. In technical drawing it fixes line types, symbols, lettering and dimensioning so everyone reads a drawing the same way.",
    },
    ar: {
      term: "معيار ISO",
      definition:
        "مجموعة قواعد من المنظمة الدولية للتقييس. في الرسم الفني تحدد أنواع الخطوط والرموز والكتابة وطريقة وضع الأبعاد ليقرأ الجميع الرسم بالطريقة نفسها.",
    },
  },
  "detail-drawing": {
    en: {
      term: "Detail drawing",
      definition:
        "A 2D drawing of one part with all the views, dimensions, tolerances and notes needed to make it.",
    },
    ar: {
      term: "رسم تفصيلي",
      definition:
        "رسم ثنائي الأبعاد لقطعة واحدة، فيه كل المناظر والأبعاد والتفاوتات والملاحظات اللازمة لتصنيعها.",
    },
  },
  "section-view": {
    en: {
      term: "Section view",
      definition:
        "A view that shows the inside of a part as if it were cut along a cutting plane. The cut faces are shown with hatching.",
    },
    ar: {
      term: "منظر مقطعي",
      definition:
        "منظر يُظهر داخل القطعة كأنها قُطعت عند مستوى قطع. تظهر الأوجه المقطوعة بخطوط التهشير.",
    },
  },
  hatching: {
    en: {
      term: "Hatching",
      definition:
        "Thin parallel lines, usually at 45°, drawn on faces cut in a section view. Different materials can use different patterns.",
    },
    ar: {
      term: "تهشير",
      definition:
        "خطوط رفيعة متوازية، عادةً بزاوية 45°، تُرسم على الأوجه المقطوعة في المنظر المقطعي. يمكن استخدام أنماط مختلفة للمواد المختلفة.",
    },
  },
  "title-block": {
    en: {
      term: "Title block",
      definition:
        "The box in the corner of a drawing with its key data: part name, drawing number, scale, material, units, author, date and revision.",
    },
    ar: {
      term: "لوحة العنوان",
      definition:
        "المربع في زاوية الرسم الذي يضم بياناته الأساسية: اسم القطعة ورقم الرسم والمقياس والمادة والوحدات والرسّام والتاريخ والمراجعة.",
    },
  },
  "parts-list": {
    en: {
      term: "Parts list (BOM)",
      definition:
        "A table of every part in an assembly with its item number, name, quantity and material. It is also called a bill of materials.",
    },
    ar: {
      term: "قائمة القطع (BOM)",
      definition:
        "جدول بكل قطعة في التجميعة مع رقم البند والاسم والكمية والمادة. تُسمّى أيضًا قائمة المواد.",
    },
  },
  balloon: {
    en: {
      term: "Balloon",
      definition:
        "A numbered circle with a leader line that points to a part in an assembly drawing. The number matches the item in the parts list.",
    },
    ar: {
      term: "بالون ترقيم",
      definition:
        "دائرة مرقّمة بخط إشارة تشير إلى قطعة في رسم التجميعة. يطابق الرقم البند في قائمة القطع.",
    },
  },
  dimension: {
    en: {
      term: "Dimension",
      definition:
        "A value on a drawing that gives the size or position of a feature, such as a length, a diameter or an angle.",
    },
    ar: {
      term: "بُعد",
      definition: "قيمة على الرسم تحدد حجم عنصر أو موضعه، مثل الطول أو القطر أو الزاوية.",
    },
  },
  tolerance: {
    en: {
      term: "Tolerance",
      definition:
        "The total amount a dimension is allowed to vary. For example, 20 ±0.1 mm means anything from 19.9 to 20.1 mm is acceptable.",
    },
    ar: {
      term: "تفاوت",
      definition:
        "المقدار الذي يُسمح للبُعد أن يتغيّره. مثلًا 20 ±0.1 mm تعني أن أي قيمة من 19.9 إلى 20.1 mm مقبولة.",
    },
  },
  "general-tolerance-iso-2768": {
    en: {
      term: "General tolerances (ISO 2768-m)",
      definition:
        "A standard that sets default tolerances for linear and angular dimensions that have no individual tolerance. The letter m means the medium class.",
    },
    ar: {
      term: "التفاوتات العامة (ISO 2768-m)",
      definition:
        "معيار يحدد تفاوتات افتراضية للأبعاد الطولية والزاوية التي ليس لها تفاوت خاص. الحرف m يعني الفئة المتوسطة.",
    },
  },
  gdt: {
    en: {
      term: "GD&T",
      definition:
        "Geometric Dimensioning and Tolerancing. A symbol language that controls form, orientation, location and runout of features, for example flatness or position.",
    },
    ar: {
      term: "GD&T",
      definition:
        "الأبعاد والتفاوتات الهندسية (Geometric Dimensioning and Tolerancing). لغة رموز تتحكم في شكل العناصر واتجاهها وموضعها وانحرافها، مثل الاستواء والموضع.",
    },
  },
  datum: {
    en: {
      term: "Datum",
      definition:
        "A reference surface, axis or point, labelled A, B, C, that other features are measured from. It gives a part a fixed starting frame.",
    },
    ar: {
      term: "مرجع (Datum)",
      definition:
        "سطح أو محور أو نقطة مرجعية، تُسمّى A وB وC، تُقاس منها العناصر الأخرى. تعطي القطعة إطار قياس ثابتًا.",
    },
  },
  render: {
    en: {
      term: "Render",
      definition:
        "A realistic image of a 3D model, made by setting material, lighting and camera. It shows how the product looks before it is built.",
    },
    ar: {
      term: "تصيير (Render)",
      definition:
        "صورة واقعية لنموذج ثلاثي الأبعاد، تُنتج بضبط المادة والإضاءة والكاميرا. تُظهر شكل المنتج قبل تصنيعه.",
    },
  },
  animation: {
    en: {
      term: "Animation",
      definition:
        "A short video of a model in motion, such as an assembly being put together or a mechanism running.",
    },
    ar: {
      term: "رسوم متحركة",
      definition: "فيديو قصير لنموذج يتحرك، مثل تركيب تجميعة خطوة بخطوة أو تشغيل آلية.",
    },
  },
  "reverse-engineering": {
    en: {
      term: "Reverse engineering",
      definition:
        "Rebuilding a CAD model of an existing physical part by measuring it, with a caliper or a 3D scanner.",
    },
    ar: {
      term: "هندسة عكسية",
      definition:
        "إعادة بناء نموذج CAD لقطعة موجودة فعليًا عن طريق قياسها بالمقياس المنزلق أو الماسح ثلاثي الأبعاد.",
    },
  },
  caliper: {
    en: {
      term: "Caliper",
      definition:
        "A hand tool that measures outside sizes, inside sizes and depths. A digital caliper typically reads to 0.01 mm.",
    },
    ar: {
      term: "مقياس منزلق (Caliper)",
      definition:
        "أداة يدوية تقيس الأبعاد الخارجية والداخلية والأعماق، وتصل دقة النوع الرقمي عادةً إلى 0.01 mm.",
    },
  },
  "3d-scan": {
    en: {
      term: "3D scan",
      definition:
        "A digital copy of a real object captured by a scanner as millions of points or a mesh. It can be used as a reference to rebuild the part in CAD.",
    },
    ar: {
      term: "مسح ثلاثي الأبعاد",
      definition:
        "نسخة رقمية من جسم حقيقي يلتقطها ماسح على شكل ملايين النقاط أو شبكة. يمكن استخدامها مرجعًا لإعادة بناء القطعة في CAD.",
    },
  },
};

export const GLOSSARY_IDS = Object.keys(GLOSSARY) as GlossaryId[];

export function getGlossaryEntry(
  id: GlossaryId,
  locale: Locale,
): GlossaryText & { helpSlug?: string } {
  const entry = GLOSSARY[id];
  return { ...entry[locale === "ar" ? "ar" : "en"], helpSlug: entry.helpSlug };
}
