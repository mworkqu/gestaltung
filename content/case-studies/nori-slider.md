---
slug: nori-slider
sector: startup
published: true
date: 2026-09-30
title_en: "Nori Slider: a printable replacement for a broken cup-holder cover"
title_ar: "Nori Slider: بديل قابل للطباعة لغطاء حامل الأكواب المكسور"
persona: "Nori - replacement car-part project"
persona_ar: "Nori - مشروع قطعة بديلة لسيارة"
summary_en: "The heat-damaged roller blind over a Mercedes W166 cup holder had to be replaced by a part that can be 3D printed and fitted without taking the console apart. We designed it as a parametric model with a spring-loaded pin mechanism, a hinge and three test coupons."
summary_ar: "غطاء حامل الأكواب الدوّار في مرسيدس W166 تضرر من الحرارة، وكان المطلوب بديلًا يمكن طباعته بالطباعة ثلاثية الأبعاد وتركيبه دون تفكيك الكونسول. صممناه كنموذج بارامتري بآلية دبابيس نابضية ومفصلة وثلاث قطع اختبار."
outcome_en:
  - "A parametric model of the full blind: 13 slats plus a handle slat, with print-ready files."
  - "Three small test coupons (about 18.5 g in total) designed to check the fits before printing the whole part."
  - "A native SolidWorks model started, with every dimension tunable from one equations file."
  - "Some key dimensions are still to be measured on the car, and no test-print result is recorded yet."
outcome_ar:
  - "نموذج بارامتري كامل للغطاء: 13 شريحة إضافة إلى شريحة المقبض، مع ملفات جاهزة للطباعة."
  - "ثلاث قطع اختبار صغيرة (نحو 18.5 غرام مجتمعة) لفحص التركيبات قبل طباعة القطعة كاملة."
  - "بدأ بناء نموذج SolidWorks أصلي، وكل بُعد فيه قابل للتعديل من ملف معادلات واحد."
  - "ما زالت بعض الأبعاد الأساسية بانتظار القياس على السيارة، ولم تُسجَّل بعد نتيجة طباعة تجريبية."
---

## The starting point

Nori had a broken roller blind from the centre console of a Mercedes W166 / X166 / C292 (OEM part 1666803814). The original is a chain of hinged slats whose end pins ride in a groove on each side of the console. Its thin, rubbery hinge web was destroyed by heat and the slats came apart.

The project started from ten photos of the broken part, taken with a ruler, a caliper and a printed checkerboard, plus a listing photo of the complete part that we used to count the slats and compare the spacing of the pins.

## The problem

The console track is closed. The original can only be fitted by removing the whole console. A replacement had to go in from above, into the closed track, and then stay put: a cup or a palm pressing on a slat must never push a pin back and drop the slat into the cup holder.

## What we designed

- **A parametric model.** Every dimension lives in one parameters file. After a test print, only that file changes and the model, the validation checks and the exports are rebuilt. The build stops with an error if a size or clearance check fails.
- **A spring-loaded pin on one end of each slat.** The other end has fixed pins. The sprung pins are pulled back by hand with a pick or a fingernail, the slat is lowered into the track and released. We rejected a ramped pin that retracts when pushed down, because it would retract under a cup as well. Every pin face that carries load is round or flat.
- **A knuckle hinge.** Interleaved barrels on a 1.5 mm steel wire replace the rubbery web. The design allows 45 degrees of bend one way, against the 35 degrees needed for the track curve on the figures we had.
- **A handle slat and a tail slat** that follow the original layout, with the changes listed in the project notes: a wider slat top plate, recessed instead of raised dashes, and a wider handle end block.
- **A fallback with no moving parts,** where each slat is bowed by hand and dropped in, plus a bend-test slat.
- **Print-ready outputs.** STEP, STL and DXF files, a 3D preview that opens in the browser, and parts already oriented for the slicer.

## How it is made and tested

Parts are meant to be printed in FDM, top face down. The notes record that PETG-CF is marginal at the roughly 80 degC a parked cabin can reach, and that ASA-CF or PA-CF is preferred.

Before printing the whole blind, three coupons are printed first: the end of a slat with its housing and sled, two hinge segments joined with a short wire, and a full slat for the fallback variant. They check the sliding fit, the press fits, the hinge clearance and the overhang quality.

## SolidWorks version

We also started a native SolidWorks model, driven from Python, where every dimension is a global variable in one equations file so it can be re-tuned inside SolidWorks after a test print. Reviewing the first idea showed that a very thin hinge web would be strained about 16 times more than first estimated. The plan changed to a rigid strip with a wider, thin flex band, which the calculations put at about 2.4 to 3.0 percent strain instead of about 20 percent.

The first slat has been built. Its volume matches the hand estimate within 0.04 percent and its bounding box matches the expected size. Changing the groove depth in the equations file lengthened the pin-tip to pin-tip span from 219.4 mm to 221.4 mm, as intended.

## Where it stands

Some key dimensions, such as the track width, groove depth and tightest curve, are placeholders until they are measured on the car. We have no test-print result to report yet, so this story ends where the work does: a validated model, print files, test coupons and a SolidWorks model under way.

<!-- ar -->

## نقطة البداية

كان لدى Nori غطاء دوّار مكسور من الكونسول الأوسط لمرسيدس W166 / X166 / C292 (رقم القطعة الأصلية 1666803814). الغطاء الأصلي سلسلة من الشرائح المفصلية تنزلق دبابيس طرفيها داخل مجرى في كل جانب من الكونسول. تلف شريط المفصل المطاطي الرقيق بسبب الحرارة فانفصلت الشرائح.

انطلق المشروع من عشر صور للقطعة المكسورة التُقطت مع مسطرة وقدمة قياس ولوحة شطرنج مطبوعة، إضافة إلى صورة من إعلان للقطعة الكاملة استخدمناها لعدّ الشرائح ومقارنة تباعد الدبابيس.

## المشكلة

مسار الكونسول مغلق. لا يمكن تركيب القطعة الأصلية إلا بفك الكونسول كاملًا. كان على البديل أن يدخل من الأعلى إلى المسار المغلق ثم يثبت في مكانه، فلا يدفع كوب أو كفّ يد يضغط على شريحة أي دبوس إلى الداخل فتسقط الشريحة في حامل الأكواب.

## ماذا صممنا

في جِشتالتُونج بنينا ما يلي:

- **نموذج بارامتري.** كل الأبعاد في ملف معاملات واحد. بعد أي طباعة تجريبية يتغير هذا الملف فقط، ثم يُعاد بناء النموذج وفحوصات التحقق والملفات المصدَّرة. يتوقف البناء بخطأ إذا فشل فحص مقاس أو خلوص.
- **دبوس نابضي في أحد طرفي كل شريحة.** الطرف الآخر فيه دبابيس ثابتة. تُسحب الدبابيس النابضية باليد بأداة دقيقة أو بالظفر، ثم تُنزَّل الشريحة في المسار وتُترك. رفضنا دبوسًا مائلًا ينسحب عند الضغط عليه من الأعلى، لأنه سينسحب تحت الكوب أيضًا. كل وجه دبوس يحمل حملًا إما مستدير أو مسطح.
- **مفصلة بأسطوانات متداخلة.** تحل أسطوانات متشابكة على سلك فولاذي قطره 1.5 مم محل الشريط المطاطي. يسمح التصميم بانحناء 45 درجة في اتجاه، مقابل 35 درجة مطلوبة لانحناء المسار بحسب الأرقام التي كانت لدينا.
- **شريحة مقبض وشريحة ذيل** تتبعان تخطيط القطعة الأصلية، مع التعديلات المذكورة في ملاحظات المشروع: سطح علوي أعرض للشريحة، وخطوط غائرة بدل البارزة، وكتلة نهاية أعرض للمقبض.
- **بديل احتياطي بلا أجزاء متحركة،** تُحنى فيه كل شريحة باليد وتُنزل في مكانها، مع شريحة لاختبار الانحناء.
- **ملفات جاهزة للطباعة.** ملفات STEP وSTL وDXF، ومعاينة ثلاثية الأبعاد تُفتح في المتصفح، وقطع موجَّهة مسبقًا للطابعة.

## كيف تُصنع وتُختبر

القطع معدّة للطباعة بتقنية FDM والوجه العلوي لأسفل. تسجّل الملاحظات أن خامة PETG-CF حدّية عند نحو 80 درجة مئوية، وهي حرارة قد تبلغها مقصورة سيارة متوقفة، وأن ASA-CF أو PA-CF أفضل.

قبل طباعة الغطاء كاملًا تُطبع ثلاث قطع اختبار أولًا: طرف شريحة مع حجرته والمنزلق، وقطعتا مفصلة موصولتان بسلك قصير، وشريحة كاملة للنسخة الاحتياطية. تفحص هذه القطع الانزلاق وتركيبات الكبس وخلوص المفصلة وجودة الأجزاء المعلقة.

## نسخة SolidWorks

بدأنا أيضًا نموذج SolidWorks أصليًا يُبنى عبر Python، وكل بُعد فيه متغير عام في ملف معادلات واحد ليمكن ضبطه داخل SolidWorks بعد أي طباعة تجريبية. أظهرت مراجعة الفكرة الأولى أن شريطًا رقيقًا جدًا للمفصلة سيتعرض لإجهاد أكبر بنحو 16 مرة مما قُدّر أولًا. فتغيرت الخطة إلى شريط صلب مع نطاق مرن أعرض وأرق، وتضعه الحسابات عند نحو 2.4 إلى 3.0 بالمئة إجهادًا بدل نحو 20 بالمئة.

بُنيت الشريحة الأولى. يطابق حجمها التقدير اليدوي بفارق أقل من 0.04 بالمئة، ويطابق صندوقها المحيط المقاس المتوقع. وعند تغيير عمق المجرى في ملف المعادلات ازدادت المسافة من طرف دبوس إلى طرف الدبوس الآخر من 219.4 مم إلى 221.4 مم، كما هو مقصود.

## أين وصل العمل

ما زالت بعض الأبعاد الأساسية، مثل عرض المسار وعمق المجرى وأضيق انحناء، قيمًا مؤقتة إلى أن تُقاس على السيارة. ليس لدينا بعد نتيجة طباعة تجريبية لنعرضها، لذلك تنتهي هذه القصة حيث ينتهي العمل: نموذج تم التحقق منه، وملفات طباعة، وقطع اختبار، ونموذج SolidWorks قيد البناء.
