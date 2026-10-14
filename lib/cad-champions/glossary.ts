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
  | "3d-scan"
  | "sheet-metal"
  | "flat-pattern"
  | "bend-allowance"
  | "frame-generator"
  | "weldment"
  | "weld-symbol"
  | "bolted-connection"
  | "tube-and-pipe"
  | "cable-and-harness"
  | "content-centre"
  | "design-accelerator"
  | "inventor-studio"
  | "ipart"
  | "physical-simulation"
  | "exploded-view"
  | "collapsing-animation"
  | "nomenclature"
  | "mbd"
  | "3d-annotation"
  | "limits-and-fits"
  | "surface-texture-ra"
  | "offset-centerline-caliper"
  | "radius-gauge"
  | "thread-pitch-gauge"
  | "depth-gauge"
  | "3d-pdf"
  | "stl"
  | "design-brief";

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
  "sheet-metal": {
    en: {
      term: "Sheet metal",
      definition:
        "Thin, flat metal sheet that is cut and bent into parts such as brackets, covers and enclosures. Sheet-metal tools in CAD model the bends and can unfold the part.",
    },
    ar: {
      term: "الصفائح المعدنية (Sheet metal)",
      definition:
        "ألواح معدنية رقيقة ومسطّحة تُقصّ وتُثنى لتصبح قطعًا مثل الحوامل والأغطية والعلب. أدوات الصفائح في CAD ترسم الثنيات ويمكنها فرد القطعة على مستوٍ واحد.",
    },
  },
  "flat-pattern": {
    en: {
      term: "Flat pattern",
      definition:
        "The unfolded, flat shape of a bent sheet-metal part. It is what the laser or punch cuts before the part goes to the bending machine.",
    },
    ar: {
      term: "الشكل المفرود (Flat pattern)",
      definition:
        "الشكل المسطّح لقطعة صفائح مثنية بعد فردها. هذا هو الشكل الذي يقصّه الليزر أو المثقب قبل أن تذهب القطعة إلى آلة الثني.",
    },
  },
  "bend-allowance": {
    en: {
      term: "Bend allowance",
      definition:
        "The length of metal used up in a bend, measured along the middle of the sheet. You need it to work out how long the flat pattern must be so the bent part ends up the right size.",
    },
    ar: {
      term: "سماحية الثني (Bend allowance)",
      definition:
        "طول المعدن الذي تستهلكه الثنية، ويُقاس على امتداد منتصف سماكة الصفيحة. تحتاجه لحساب طول الشكل المفرود المطلوب حتى تخرج القطعة المثنية بالمقاس الصحيح.",
    },
  },
  "frame-generator": {
    en: {
      term: "Frame Generator",
      definition:
        "An Autodesk Inventor feature that builds a frame of steel or aluminium profiles from a simple skeleton of lines and cuts the ends for you. The closest idea in SOLIDWORKS is Structural Members, and in Fusion it is a profile sweep.",
    },
    ar: {
      term: "Frame Generator",
      definition:
        "ميزة في Autodesk Inventor تبني هيكلًا من مقاطع الفولاذ أو الألمنيوم انطلاقًا من هيكل بسيط من الخطوط، وتقصّ الأطراف عنك. أقرب فكرة لها في SOLIDWORKS هي Structural Members، وفي Fusion هي سحب المقطع على مسار.",
    },
  },
  weldment: {
    en: {
      term: "Weldment",
      definition:
        "An assembly of metal pieces joined permanently by welding and treated as one unit. In CAD it usually also carries the weld details and the cut list of the pieces.",
    },
    ar: {
      term: "تجميعة ملحومة (Weldment)",
      definition:
        "تجميعة من قطع معدنية تُوصَل ببعضها بشكل دائم عن طريق اللحام وتُعامل كوحدة واحدة. في CAD تحمل عادةً تفاصيل اللحام وقائمة قصّ القطع.",
    },
  },
  "weld-symbol": {
    en: {
      term: "Weld symbol",
      definition:
        "A standard mark on a drawing that tells the welder the type, size and position of a weld. It sits on a reference line with an arrow pointing to the joint.",
    },
    ar: {
      term: "رمز اللحام (Weld symbol)",
      definition:
        "علامة قياسية على الرسم تخبر اللحّام بنوع اللحام وحجمه وموضعه. توضع على خط مرجعي وسهم يشير إلى الوصلة.",
    },
  },
  "bolted-connection": {
    en: {
      term: "Bolted connection",
      definition:
        "A joint where parts are held together by a bolt, a nut and usually washers, which can be taken apart again. Inventor can generate one for you, and in other CAD you add the screws and nuts as parts.",
    },
    ar: {
      term: "وصلة مسمارية (Bolted connection)",
      definition:
        "وصلة تُثبَّت فيها القطع بمسمار قلاووظ وصامولة وعادةً حلقات، ويمكن فكّها لاحقًا. يستطيع Inventor توليدها لك، وفي برامج CAD الأخرى تضيف المسامير والصواميل كقطع.",
    },
  },
  "tube-and-pipe": {
    en: {
      term: "Tube & Pipe",
      definition:
        "An Autodesk Inventor feature for routing pipes, hoses and fittings through an assembly. SOLIDWORKS has a similar tool called Routing, and in Fusion you usually sweep a pipe along a path.",
    },
    ar: {
      term: "Tube & Pipe",
      definition:
        "ميزة في Autodesk Inventor لتمرير الأنابيب والخراطيم والوصلات داخل التجميعة. في SOLIDWORKS أداة مشابهة اسمها Routing، وفي Fusion تسحب الأنبوب عادةً على مسار.",
    },
  },
  "cable-and-harness": {
    en: {
      term: "Cable & Harness",
      definition:
        "An Autodesk Inventor feature for routing electrical wires and cables through an assembly and bundling them into a harness. SOLIDWORKS Routing has an electrical version of the same idea.",
    },
    ar: {
      term: "Cable & Harness",
      definition:
        "ميزة في Autodesk Inventor لتمرير الأسلاك والكوابل الكهربائية داخل التجميعة وتجميعها في حزمة واحدة (harness). في SOLIDWORKS Routing نسخة كهربائية من الفكرة نفسها.",
    },
  },
  "content-centre": {
    en: {
      term: "Content Centre",
      definition:
        "The built-in library of standard parts in Autodesk Inventor, such as screws, nuts, washers and bearings, which you insert at the size you need. SOLIDWORKS has Toolbox for the same job.",
    },
    ar: {
      term: "Content Centre",
      definition:
        "مكتبة القطع القياسية المدمجة في Autodesk Inventor، مثل المسامير والصواميل والحلقات والمحامل، وتُدرجها بالمقاس الذي تحتاجه. في SOLIDWORKS تؤدي Toolbox الوظيفة نفسها.",
    },
  },
  "design-accelerator": {
    en: {
      term: "Design Accelerator",
      definition:
        "A set of Autodesk Inventor generators that build common machine parts, such as gears, shafts and bolted joints, from a few inputs and check the calculations. SOLIDWORKS has no single match, but its Toolbox and add-ins cover parts of it.",
    },
    ar: {
      term: "Design Accelerator",
      definition:
        "مجموعة مولّدات في Autodesk Inventor تبني أجزاء الآلات الشائعة، مثل التروس والأعمدة والوصلات المسمارية، من مدخلات قليلة وتتحقق من الحسابات. لا يوجد مقابل واحد لها في SOLIDWORKS، لكن Toolbox والإضافات تغطي جزءًا منها.",
    },
  },
  "inventor-studio": {
    en: {
      term: "Inventor Studio",
      definition:
        "The Autodesk Inventor environment for making renders and animations of a model, with lights, cameras and moving parts. The closest idea in SOLIDWORKS is Visualize, and in Fusion it is the Render and Animation workspaces.",
    },
    ar: {
      term: "Inventor Studio",
      definition:
        "بيئة في Autodesk Inventor لإنتاج صور تصيير ورسوم متحركة للنموذج، مع إضاءة وكاميرات وأجزاء متحركة. أقرب فكرة لها في SOLIDWORKS هي Visualize، وفي Fusion هي بيئتا Render وAnimation.",
    },
  },
  ipart: {
    en: {
      term: "iPart",
      definition:
        "An Autodesk Inventor part that holds a table of sizes, so one file gives you a whole family of versions such as bolts of different lengths. SOLIDWORKS calls this a configuration, and Fusion calls it a configured design.",
    },
    ar: {
      term: "iPart",
      definition:
        "قطعة في Autodesk Inventor تحمل جدولًا بالمقاسات، فيعطيك ملف واحد عائلة كاملة من النسخ مثل مسامير بأطوال مختلفة. يسمّي SOLIDWORKS هذا Configuration، ويسمّيه Fusion تصميمًا مهيَّأً (configured design).",
    },
  },
  "physical-simulation": {
    en: {
      term: "Physical simulation",
      definition:
        "A test run in CAD that shows how a mechanism moves or how a part reacts to forces, before anything is built. It helps you catch collisions and weak spots early.",
    },
    ar: {
      term: "المحاكاة الفيزيائية",
      definition:
        "تجربة داخل CAD تُظهر كيف تتحرك الآلية أو كيف تتصرف القطعة تحت القوى قبل تصنيع أي شيء. تساعدك على اكتشاف التصادمات ونقاط الضعف مبكرًا.",
    },
  },
  "exploded-view": {
    en: {
      term: "Exploded view",
      definition:
        "A view of an assembly with the parts pulled apart along straight lines so you can see each one and how they fit together. It is common in assembly instructions.",
    },
    ar: {
      term: "منظر مفكَّك (Exploded view)",
      definition:
        "منظر للتجميعة تُبعَّد فيه القطع عن بعضها على خطوط مستقيمة ليظهر كل جزء وكيف تتركّب معًا. شائع في تعليمات التركيب.",
    },
  },
  "collapsing-animation": {
    en: {
      term: "Collapsing animation",
      definition:
        "An animation where an exploded assembly moves back together, so the parts slide into their final positions. It shows the assembly order step by step.",
    },
    ar: {
      term: "رسم متحرك للتجميع",
      definition:
        "رسم متحرك تعود فيه التجميعة المفكَّكة لتتجمّع، فتنزلق القطع إلى أماكنها النهائية. يعرض ترتيب التركيب خطوة بخطوة.",
    },
  },
  nomenclature: {
    en: {
      term: "Nomenclature",
      definition:
        "The agreed system of names and numbers for parts and drawings, so everyone calls the same part by the same name. It keeps files and parts lists clear and easy to find.",
    },
    ar: {
      term: "التسمية والترقيم (Nomenclature)",
      definition:
        "نظام متفق عليه لأسماء وأرقام القطع والرسومات، ليُسمّي الجميع القطعة نفسها بالاسم نفسه. يُبقي الملفات وقوائم القطع واضحة وسهلة البحث.",
    },
  },
  mbd: {
    en: {
      term: "MBD (model-based definition)",
      definition:
        "Putting dimensions, tolerances and notes directly on the 3D model instead of a 2D drawing, so the model alone defines the part.",
    },
    ar: {
      term: "MBD (التعريف المعتمد على النموذج)",
      definition:
        "وضع الأبعاد والتفاوتات والملاحظات مباشرةً على النموذج ثلاثي الأبعاد بدل الرسم ثنائي الأبعاد، فيكفي النموذج وحده لتعريف القطعة.",
    },
  },
  "3d-annotation": {
    en: {
      term: "3D annotation",
      definition:
        "A dimension, tolerance, note or symbol attached to the faces and edges of a 3D model. It is how MBD stores manufacturing information in the model.",
    },
    ar: {
      term: "تعليق توضيحي ثلاثي الأبعاد",
      definition:
        "بُعد أو تفاوت أو ملاحظة أو رمز مرتبط بأوجه النموذج ثلاثي الأبعاد وحوافه. هكذا يخزّن MBD معلومات التصنيع داخل النموذج.",
    },
  },
  "limits-and-fits": {
    en: {
      term: "Limits and fits",
      definition:
        "A system that sets how tight or loose a shaft sits in a hole, using tolerance codes such as H7/g6. It tells you if the parts slide, press together or stay fixed.",
    },
    ar: {
      term: "الحدود والتوافقات (Limits and fits)",
      definition:
        "نظام يحدد مدى إحكام أو ارتخاء العمود داخل الثقب باستخدام رموز تفاوت مثل H7/g6. يخبرك هل ستنزلق القطعتان أو تُكبسان معًا أو تبقيان ثابتتين.",
    },
  },
  "surface-texture-ra": {
    en: {
      term: "Surface texture (Ra)",
      definition:
        "How rough or smooth a surface is. Ra is the average height of its tiny bumps in micrometres, so a lower Ra means a smoother finish.",
    },
    ar: {
      term: "خشونة السطح (Ra)",
      definition:
        "مدى خشونة السطح أو نعومته. Ra هو متوسط ارتفاع نتوءاته الصغيرة بالميكرومتر، وكلما قلّ Ra كان السطح أنعم.",
    },
  },
  "offset-centerline-caliper": {
    en: {
      term: "Offset centerline caliper",
      definition:
        "A caliper with offset jaws that measures the distance from a hole or edge to the centre of another hole. It is useful for hole spacing and for steps that a normal caliper cannot reach.",
    },
    ar: {
      term: "مقياس منزلق بفكّين مزاحين (Offset centerline caliper)",
      definition:
        "مقياس منزلق بفكّين مزاحين يقيس المسافة من ثقب أو حافة إلى مركز ثقب آخر. مفيد لقياس المسافات بين الثقوب والدرجات التي لا يصل إليها المقياس العادي.",
    },
  },
  "radius-gauge": {
    en: {
      term: "Radius gauge",
      definition:
        "A set of thin blades with curved edges of known sizes. You hold the blade against a rounded corner until it fits with no gap to read the radius.",
    },
    ar: {
      term: "مقياس نصف القطر (Radius gauge)",
      definition:
        "مجموعة شفرات رقيقة بحواف منحنية بمقاسات معروفة. تضع الشفرة على الزاوية المستديرة حتى تنطبق دون فراغ، فتقرأ نصف القطر.",
    },
  },
  "thread-pitch-gauge": {
    en: {
      term: "Thread pitch gauge",
      definition:
        "A set of small blades with teeth that you match against a thread to find its pitch, the distance from one thread crest to the next, such as 1.5 mm.",
    },
    ar: {
      term: "مقياس خطوة السنّ (Thread pitch gauge)",
      definition:
        "مجموعة شفرات صغيرة ذات أسنان تطابقها مع السنّ القلاووظ لمعرفة خطوته، أي المسافة من قمة سنّ إلى قمة السنّ التالي، مثل 1.5 mm.",
    },
  },
  "depth-gauge": {
    en: {
      term: "Depth gauge",
      definition:
        "A tool that measures how deep a hole, slot or step is. A caliper's depth rod does the same job.",
    },
    ar: {
      term: "مقياس العمق (Depth gauge)",
      definition:
        "أداة تقيس عمق الثقب أو المجرى أو الدرجة. وساق العمق في المقياس المنزلق تؤدي الوظيفة نفسها.",
    },
  },
  "3d-pdf": {
    en: {
      term: "3D PDF",
      definition:
        "A PDF file that contains a 3D model you can rotate, zoom and section. It is handy for sharing a design with someone who has no CAD program.",
    },
    ar: {
      term: "ملف PDF ثلاثي الأبعاد (3D PDF)",
      definition:
        "ملف PDF يحتوي على نموذج ثلاثي الأبعاد يمكنك تدويره وتكبيره وعمل مقطع فيه. مناسب لمشاركة التصميم مع من لا يملك برنامج CAD.",
    },
  },
  stl: {
    en: {
      term: "STL file",
      definition:
        "A 3D file format (.stl) that describes a shape as a mesh of small triangles. It is the standard input for 3D printers, but it has no colours, units or dimensions.",
    },
    ar: {
      term: "ملف STL",
      definition:
        "صيغة ملف ثلاثية الأبعاد (.stl) تصف الشكل كشبكة من مثلثات صغيرة. هي المدخل المعتاد للطابعات ثلاثية الأبعاد، لكنها لا تحمل ألوانًا ولا وحدات ولا أبعادًا.",
    },
  },
  "design-brief": {
    en: {
      term: "Design brief",
      definition:
        "A short written description of what a product must do, who uses it and what limits apply, such as size, material or cost. You read it first and design to meet it.",
    },
    ar: {
      term: "وصف التصميم (Design brief)",
      definition:
        "وصف مكتوب مختصر لما يجب أن يفعله المنتج ومن سيستخدمه والقيود المفروضة عليه، مثل الحجم والمادة والتكلفة. تقرؤه أولًا وتصمّم بحيث تحققه.",
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
