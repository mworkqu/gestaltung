-- CAD Champions Help Center: seed articles (32 articles, English + Arabic).
--
-- What it does: inserts the Help Center content into public.cc_help_articles,
-- in five categories (getting-started, files-and-export, the-test,
-- training-and-payment, account) plus the competition guide articles.
-- Bodies are Markdown. Items marked [TODO-MO: ...] are facts the owner must confirm.
--
-- RUN AFTER 0078 (needs the table from 0077_cc_core.sql).
-- Safe to re-run: "on conflict (slug) do update" refreshes title, body, category,
-- sort, related terms and is_published, and leaves helpful_yes / helpful_no alone.

insert into public.cc_help_articles
  (slug, category, title_en, title_ar, body_en, body_ar, related_glossary_terms, sort, is_published)
values
('how-the-free-test-works', 'getting-started', 'How the free test works', 'كيف يعمل الاختبار المجاني',
$body$The free test shows you where you stand. It takes about 90 minutes and you do it in your own CAD software.

## Before you start
1. Finish the **Get Ready** steps (software installed, units and export practised).
2. Pick a quiet time. The timer cannot be paused.

## During the test
1. Open the test and read each task.
2. Model in your own software, in millimetres.
3. Export each answer and upload it. Models go up as STEP files. Drawings go up as PDF.
4. Submit when you finish, or let the timer submit for you.

## After the test
- 3D models are checked automatically within minutes.
- Drawings get a first check by our AI checklist, then a trainer reviews them.
- You get a score per skill area and a level from L1 to L6.

> Tip: do the practice upload first. It takes five minutes and removes most surprises.$body$,
$body$الاختبار المجاني يوضّح لك مستواك الحالي. يستغرق نحو 90 دقيقة، وتنفّذه في برنامج التصميم الخاص بك.

## قبل أن تبدأ
1. أكمل خطوات **استعد للاختبار** (تثبيت البرنامج وتجربة الوحدات والتصدير).
2. اختر وقتًا هادئًا. لا يمكن إيقاف المؤقت.

## أثناء الاختبار
1. افتح الاختبار واقرأ كل مهمة.
2. صمّم في برنامجك بوحدة المليمتر.
3. صدّر كل إجابة وارفعها. النماذج ثلاثية الأبعاد تُرفع بصيغة STEP، والرسومات بصيغة PDF.
4. سلّم عند الانتهاء، أو دع المؤقت يسلّم عنك.

## بعد الاختبار
- تُفحص النماذج ثلاثية الأبعاد تلقائيًا خلال دقائق.
- تُفحص الرسومات أولًا بقائمة تحقق بالذكاء الاصطناعي، ثم يراجعها مدرّب.
- تحصل على درجة لكل مهارة ومستوى من L1 إلى L6.

> نصيحة: جرّب الرفع التدريبي أولًا. يستغرق خمس دقائق ويجنّبك أغلب المفاجآت.$body$,
array['step-file', 'units-mm']::text[], 1, true),
('what-you-need-before-the-test', 'getting-started', 'What you need before the test', 'ما تحتاجه قبل الاختبار',
$body$You need very little, but check it before you press Start.

## Checklist
1. A computer with CAD software. Windows 10/11 with 16 GB RAM is recommended. 8 GB is the minimum.
2. A three-button mouse. It makes rotating and panning much easier.
3. A stable internet connection for uploads.
4. Your software installed and opened at least once.
5. The practice upload passed.
6. About 90 minutes with no interruptions.

## Which software?
- **Inventor**: recommended for the competition. Windows only.
- **Fusion**: the choice for Mac.
- **SOLIDWORKS**: fine if you or your school already use it.

Any software that exports STEP AP214 or AP242 in millimetres works for the tests.

## Also useful
- Pen and paper for quick sketches.
- A charged laptop or the charger plugged in.$body$,
$body$تحتاج إلى القليل، لكن تأكد منه قبل الضغط على «ابدأ».

## قائمة التحقق
1. حاسوب عليه برنامج تصميم. يُنصح بنظام Windows 10/11 مع ذاكرة 16 جيجابايت، والحد الأدنى 8 جيجابايت.
2. فأرة بثلاثة أزرار. تسهّل التدوير والتحريك كثيرًا.
3. اتصال إنترنت مستقر للرفع.
4. برنامج مثبّت وقد فتحته مرة واحدة على الأقل.
5. اجتياز الرفع التدريبي.
6. نحو 90 دقيقة بلا مقاطعة.

## أي برنامج؟
- **Inventor**: موصى به للمسابقة. يعمل على Windows فقط.
- **Fusion**: خيار مستخدمي Mac.
- **SOLIDWORKS**: مناسب إن كنت أنت أو مدرستك تستخدمونه.

أي برنامج يصدّر STEP AP214 أو AP242 بالمليمتر يصلح للاختبارات.

## مفيد أيضًا
- ورقة وقلم للرسم السريع.
- حاسوب محمول مشحون أو شاحن موصول.$body$,
array['step-ap214', 'units-mm']::text[], 2, true),
('free-autodesk-software-for-students', 'getting-started', 'Free Autodesk software for students', 'برامج Autodesk المجانية للطلاب',
$body$Autodesk gives Inventor and Fusion free to eligible students and educators through the Autodesk Education plan.

## Good to know
- The license lasts 1 year and can be renewed while you are still eligible.
- You must verify your student status. Verification can take time, so **start early**, ideally days before your test.

## Steps
1. Have your student ID or enrollment letter ready (photo or scan).
2. Go to autodesk.com/education and create or sign in to an Autodesk account.
3. Choose **Get started** and pick your product (Inventor Professional or Fusion).
4. Enter your school details and upload your proof if asked.
5. Wait for the confirmation email.
6. Download and install the software, then sign in with the same account.

## If verification is slow
- Check your spam folder.
- Ask your instructor. Your school may already have licenses.
- Contact us on WhatsApp from the Need help button.$body$,
$body$تقدّم Autodesk برنامجي Inventor وFusion مجانًا للطلاب والمعلمين المؤهلين عبر خطة Autodesk Education.

## معلومات مهمة
- مدة الترخيص سنة واحدة، وتتجدد ما دمت مؤهلًا.
- يجب إثبات أنك طالب. قد يستغرق التحقق وقتًا، لذلك **ابدأ مبكرًا**، قبل الاختبار بأيام.

## الخطوات
1. جهّز بطاقتك الجامعية أو خطاب القيد (صورة أو مسح ضوئي).
2. افتح autodesk.com/education وأنشئ حساب Autodesk أو سجّل الدخول.
3. اختر **ابدأ** ثم اختر المنتج (Inventor Professional أو Fusion).
4. أدخل بيانات مدرستك وارفع الإثبات إن طُلب.
5. انتظر رسالة التأكيد.
6. نزّل البرنامج وثبّته، وسجّل الدخول بالحساب نفسه.

## إن تأخّر التحقق
- راجع مجلد الرسائل غير المرغوبة.
- اسأل مدرّبك. قد تملك مدرستك تراخيص جاهزة.
- تواصل معنا عبر واتساب من زر المساعدة.$body$,
array['step-file']::text[], 3, true),
('i-only-have-a-mac', 'getting-started', 'I only have a Mac', 'لدي جهاز Mac فقط',
$body$Inventor and SOLIDWORKS run only on Windows. On a Mac, use **Autodesk Fusion**. It is free for eligible students and it is allowed in the competition.

## Steps
1. Choose the **Fusion** track in your profile.
2. Install Fusion from autodesk.com/education (see the free software article).
3. Open Fusion and set units to millimetres.
4. Export your work as STEP and drawings as PDF.
5. Do the practice upload.

## Other options
- Run Windows on your Mac with a virtual machine or Boot Camp (Intel Macs only). This needs plenty of RAM and disk space.
- Use a Windows computer at your school or the studio [TODO-MO: confirm studio computer access].

## Good to know
Fusion can export all the files the tests need. Inventor-only tools are explained in the lessons, with the closest Fusion workflow shown where one exists.$body$,
$body$برنامجا Inventor وSOLIDWORKS يعملان على Windows فقط. على جهاز Mac استخدم **Autodesk Fusion**. وهو مجاني للطلاب المؤهلين ومسموح به في المسابقة.

## الخطوات
1. اختر مسار **Fusion** في ملفك الشخصي.
2. ثبّت Fusion من autodesk.com/education (انظر مقال البرامج المجانية).
3. افتح Fusion واضبط الوحدات على المليمتر.
4. صدّر عملك بصيغة STEP والرسومات بصيغة PDF.
5. جرّب الرفع التدريبي.

## خيارات أخرى
- شغّل Windows على جهازك بآلة افتراضية أو Boot Camp (لأجهزة Intel فقط). يحتاج ذلك ذاكرة ومساحة كبيرتين.
- استخدم حاسوب Windows في مدرستك أو في الاستوديو [TODO-MO: confirm studio computer access].

## معلومة
يستطيع Fusion تصدير كل الملفات التي تحتاجها الاختبارات. أدوات Inventor الخاصة نشرحها في الدروس، مع أقرب طريقة في Fusion إن وُجدت.$body$,
array['step-file', 'units-mm']::text[], 4, true),
('i-dont-have-a-computer', 'getting-started', 'I don''t have a computer', 'ليس لدي حاسوب',
$body$You need a computer to model and upload files, but there are ways forward.

## Options
1. **Ask your school.** Many technical schools have CAD labs. Ask your instructor if you can use one.
2. **Borrow a computer** from family or friends for the 90 minutes. Install the software in advance.
3. **Studio computers.** We may be able to offer a computer at the studio [TODO-MO: can students use studio computers?].
4. **Tell us.** Mark "no computer" in your profile or message us on WhatsApp. We will help you find a solution.

## Minimum computer
- Windows 10, 64-bit.
- 8 GB RAM.
- A mouse.

## Tip
Phones and tablets cannot run Inventor, Fusion or SOLIDWORKS well enough for the test, so please do not rely on them.$body$,
$body$تحتاج إلى حاسوب للتصميم ورفع الملفات، لكن هناك حلول.

## الخيارات
1. **اسأل مدرستك.** كثير من المدارس التقنية لديها معامل تصميم. اسأل مدرّبك إن كان بإمكانك استخدام أحدها.
2. **استعر حاسوبًا** من العائلة أو الأصدقاء لمدة 90 دقيقة. ثبّت البرنامج قبل ذلك.
3. **حواسيب الاستوديو.** قد نوفّر لك حاسوبًا في الاستوديو [TODO-MO: can students use studio computers?].
4. **أخبرنا.** اختر «لا أملك حاسوبًا» في ملفك الشخصي أو راسلنا على واتساب، وسنساعدك في إيجاد حل.

## الحد الأدنى للحاسوب
- Windows 10 بنظام 64 بت.
- ذاكرة 8 جيجابايت.
- فأرة.

## نصيحة
الهواتف واللوحيات لا تشغّل Inventor أو Fusion أو SOLIDWORKS بما يكفي للاختبار، فلا تعتمد عليها.$body$,
array['units-mm']::text[], 5, true),
('export-step-inventor', 'files-and-export', 'Export a STEP file from Inventor', 'تصدير ملف STEP من Inventor',
$body$Export each answer as one STEP file (AP214 or AP242) in millimetres. The file must end in .step or .stp.

## Steps
1. Finish the model and check it is one solid.
2. Check units are millimetres.
3. Use the export command (below).
4. Choose **STEP AP214** or **AP242** if asked.
5. Name the file clearly, for example task-1.step.
6. Note where it is saved, then upload it.

### Inventor
File > Export > CAD Format. Choose **STEP File (*.stp, *.step)**. In Options select AP214 or AP242. Save.

### Fusion
File > Export. Under Type choose **STEP File (*.step, *.stp)**. Pick a location and press Export. Fusion may send the file by email or download it. Use Download.

### SOLIDWORKS
File > Save As. Under Save as type choose **STEP AP214 (*.step)**. Open Options to check the version, then Save.

## Common mistake
Exporting an assembly when the task asks for one part.$body$,
$body$صدّر كل إجابة كملف STEP واحد (AP214 أو AP242) بوحدة المليمتر. يجب أن ينتهي اسم الملف بـ .step أو .stp.

## الخطوات
1. أنهِ النموذج وتأكد أنه جسم صلب واحد.
2. تأكد أن الوحدات بالمليمتر.
3. استخدم أمر التصدير (أدناه).
4. اختر **STEP AP214** أو **AP242** إن طُلب.
5. سمِّ الملف بوضوح، مثل task-1.step.
6. تذكّر مكان الحفظ ثم ارفع الملف.

### Inventor
ملف > تصدير > صيغة CAD. اختر **STEP File (*.stp, *.step)**. من الخيارات اختر AP214 أو AP242. احفظ.

### Fusion
ملف > تصدير. من النوع اختر **STEP File (*.step, *.stp)**. حدّد المكان واضغط تصدير. قد يرسل Fusion الملف بالبريد أو ينزّله. استخدم التنزيل.

### SOLIDWORKS
ملف > حفظ باسم. من نوع الملف اختر **STEP AP214 (*.step)**. افتح الخيارات للتأكد من الإصدار ثم احفظ.

## خطأ شائع
تصدير تجميع كامل بينما تطلب المهمة قطعة واحدة.$body$,
array['step-file', 'step-ap214', 'step-ap242']::text[], 6, true),
('export-step-fusion', 'files-and-export', 'Export STEP from Fusion', 'تصدير STEP من Fusion',
$body$Fusion is the choice for Mac and is allowed in the competition. Here is how to export a clean STEP file.

## Steps
1. Check the design is one solid body in the Browser panel.
2. Check units: Document Settings > Units should be **Millimeter**.
3. Choose **File > Export**.
4. Under **Type**, pick **STEP File (*.step, *.stp)**.
5. Choose a name and a location on your computer.
6. Press **Export**.
7. If Fusion says the file is being prepared, wait for the download link, then choose Download.
8. Find the file and upload it.

## Check before uploading
- The file ends in .step or .stp.
- The size is under 50 MB.
- It opens when you re-import it (File > Open).

## Common mistake
Exporting from the cloud only and forgetting to download. The file stays in Fusion's online storage and never reaches your computer.$body$,
$body$Fusion هو خيار مستخدمي Mac ومسموح به في المسابقة. إليك طريقة تصدير ملف STEP سليم.

## الخطوات
1. تأكد في لوحة المتصفح أن التصميم جسم صلب واحد.
2. تأكد من الوحدات: إعدادات المستند > الوحدات يجب أن تكون **Millimeter**.
3. اختر **File > Export**.
4. من **Type** اختر **STEP File (*.step, *.stp)**.
5. اختر اسمًا ومكانًا على جهازك.
6. اضغط **Export**.
7. إن ظهرت رسالة تجهيز الملف، انتظر رابط التنزيل ثم اختر التنزيل.
8. ابحث عن الملف وارفعه.

## افحص قبل الرفع
- ينتهي الملف بـ .step أو .stp.
- حجمه أقل من 50 ميجابايت.
- يُفتح عند إعادة استيراده (ملف > فتح).

## خطأ شائع
التصدير إلى السحابة فقط ونسيان التنزيل. يبقى الملف في تخزين Fusion ولا يصل إلى جهازك.$body$,
array['step-file', 'units-mm', 'solid-body']::text[], 7, true),
('export-step-solidworks', 'files-and-export', 'Export STEP from SOLIDWORKS', 'تصدير STEP من SOLIDWORKS',
$body$SOLIDWORKS exports STEP through Save As. Use AP214 unless the task says otherwise.

## Steps
1. Check the part is a single solid body (Solid Bodies folder in the tree shows 1).
2. Check units: Tools > Options > Document Properties > Units should be **MMGS**.
3. Choose **File > Save As**.
4. In **Save as type**, pick **STEP AP214 (*.step)**.
5. Press **Options** and check the output is solid bodies, not surfaces.
6. Name the file and press **Save**.
7. Note the folder, then upload the file.

## Check before uploading
- The file ends in .step or .stp.
- The size is under 50 MB.
- Re-open it in SOLIDWORKS to confirm it loads as one solid.

## Common mistakes
- Saving as a .sldprt file. The test needs STEP.
- Leaving the units as inches, so the part is 25 times too small or too large.$body$,
$body$يصدّر SOLIDWORKS ملف STEP عبر «حفظ باسم». استخدم AP214 ما لم تطلب المهمة غير ذلك.

## الخطوات
1. تأكد أن القطعة جسم صلب واحد (مجلد Solid Bodies يعرض 1).
2. تأكد من الوحدات: Tools > Options > Document Properties > Units يجب أن تكون **MMGS**.
3. اختر **File > Save As**.
4. من **Save as type** اختر **STEP AP214 (*.step)**.
5. اضغط **Options** وتأكد أن الناتج أجسام صلبة وليس أسطحًا.
6. سمِّ الملف واضغط **Save**.
7. تذكّر المجلد ثم ارفع الملف.

## افحص قبل الرفع
- ينتهي الملف بـ .step أو .stp.
- حجمه أقل من 50 ميجابايت.
- أعد فتحه في SOLIDWORKS للتأكد أنه جسم صلب واحد.

## أخطاء شائعة
- الحفظ بصيغة .sldprt. الاختبار يحتاج STEP.
- ترك الوحدات بالبوصة، فيصبح الحجم أصغر أو أكبر بكثير.$body$,
array['step-file', 'step-ap214', 'solid-body']::text[], 8, true),
('set-units-to-mm', 'files-and-export', 'Set units to millimetres', 'ضبط الوحدات على المليمتر',
$body$The grader reads your file in millimetres. If your units are different, your volume will be wrong and the task fails.

## Why it matters
A part drawn in inches and exported without conversion looks 25.4 times off. Set units **before** you model.

## Steps
1. Open a new file.
2. Open the units settings (below).
3. Choose millimetres for length.
4. Model, then re-check before exporting.

### Inventor
Tools > Document Settings > Units. Set Length to **mm**. Better: start from the Standard (mm).ipt template.

### Fusion
Right-click the document name in the Browser > Document Settings > Units > **Millimeter**.

### SOLIDWORKS
Tools > Options > Document Properties > Units. Choose **MMGS (millimeter, gram, second)**.

## Common mistake
Changing units after modelling. Dimensions you typed may not convert the way you expect.$body$,
$body$يقرأ المصحّح ملفك بالمليمتر. إذا كانت وحداتك مختلفة سيكون الحجم خاطئًا وتفشل المهمة.

## لماذا هذا مهم
قطعة رُسمت بالبوصة وصُدّرت بلا تحويل تبدو أكبر أو أصغر بمقدار 25.4 مرة. اضبط الوحدات **قبل** التصميم.

## الخطوات
1. افتح ملفًا جديدًا.
2. افتح إعدادات الوحدات (أدناه).
3. اختر المليمتر للطول.
4. صمّم، ثم أعد الفحص قبل التصدير.

### Inventor
Tools > Document Settings > Units. اضبط Length على **mm**. الأفضل أن تبدأ من قالب Standard (mm).ipt.

### Fusion
انقر بزر الفأرة الأيمن على اسم المستند في المتصفح > Document Settings > Units > **Millimeter**.

### SOLIDWORKS
Tools > Options > Document Properties > Units. اختر **MMGS (millimeter, gram, second)**.

## خطأ شائع
تغيير الوحدات بعد التصميم. قد لا تتحول الأبعاد التي كتبتها كما تتوقع.$body$,
array['units-mm', 'volume']::text[], 9, true),
('set-material-and-density', 'files-and-export', 'Set the material and density', 'ضبط الخامة والكثافة',
$body$The grader checks mass properties, so material and density matter. The test tells you the density to use. Examples: steel 7850 kg/m3, aluminium 2700 kg/m3.

## Steps
1. Read the task. Find the material and density it gives.
2. Open the material settings (below).
3. Pick the matching material, or create a custom one with the given density.
4. Check the mass shown in the properties window looks sensible.

### Inventor
Right-click the part > iProperties > Physical tab. Choose a material from the list. For a custom value, Manage > Styles Editor > Material, then set Density.

### Fusion
Right-click the body > Physical Material. Pick one, or copy a material and edit its Density in the Material Browser.

### SOLIDWORKS
Right-click Material in the tree > Edit Material. Pick a material, or make a custom one in Custom Materials with the given density.

## Common mistake
Using the software's default material. Its density may differ from the one in the task.$body$,
$body$يفحص المصحّح الخصائص الكتلية، لذلك تهم الخامة والكثافة. يذكر الاختبار الكثافة التي تستخدمها. أمثلة: الفولاذ 7850 كجم/م³، الألومنيوم 2700 كجم/م³.

## الخطوات
1. اقرأ المهمة وابحث عن الخامة والكثافة المذكورتين.
2. افتح إعدادات الخامة (أدناه).
3. اختر الخامة المناسبة، أو أنشئ خامة مخصصة بالكثافة المعطاة.
4. تأكد أن الكتلة الظاهرة في نافذة الخصائص منطقية.

### Inventor
انقر بزر الفأرة الأيمن على القطعة > iProperties > تبويب Physical. اختر خامة من القائمة. لقيمة مخصصة: Manage > Styles Editor > Material ثم عدّل Density.

### Fusion
انقر بزر الفأرة الأيمن على الجسم > Physical Material. اختر خامة، أو انسخ خامة وعدّل Density في Material Browser.

### SOLIDWORKS
انقر بزر الفأرة الأيمن على Material في الشجرة > Edit Material. اختر خامة، أو أنشئ خامة مخصصة في Custom Materials بالكثافة المعطاة.

## خطأ شائع
استخدام الخامة الافتراضية للبرنامج. قد تختلف كثافتها عن كثافة المهمة.$body$,
array['material-density', 'mass-properties']::text[], 10, true),
('export-drawing-pdf', 'files-and-export', 'Export a drawing as PDF', 'تصدير رسم هندسي بصيغة PDF',
$body$Drawings are uploaded as PDF. The PDF must show the whole sheet, at the right size, with every page.

## Steps
1. Open the drawing and check the sheet size (A3 or A4 as the task says).
2. Check the title block, views and dimensions are all inside the sheet.
3. Export as PDF (below).
4. Open the PDF and look at every page.
5. Upload the PDF.

### Inventor
File > Export > PDF. In Options, choose **All sheets** and keep the sheet size. Save.

### Fusion
In the drawing: File > Export > **PDF**. Check Sheets is set to all, then Export.

### SOLIDWORKS
File > Save As. Choose **PDF (*.pdf)**. Press Options and select **All sheets**. Save.

## Check before uploading
- Lines are crisp and text can be read when zoomed.
- The size is under 50 MB.
- The projection symbol is visible.

## Common mistake
Exporting only the first sheet when the drawing has several.$body$,
$body$تُرفع الرسومات بصيغة PDF. يجب أن يعرض الملف الورقة كاملة، بالحجم الصحيح، وبكل الصفحات.

## الخطوات
1. افتح الرسم وتأكد من حجم الورقة (A3 أو A4 حسب المهمة).
2. تأكد أن الجدول التعريفي والمناظير والأبعاد كلها داخل الورقة.
3. صدّر بصيغة PDF (أدناه).
4. افتح الملف وراجع كل الصفحات.
5. ارفع ملف PDF.

### Inventor
ملف > تصدير > PDF. من الخيارات اختر **All sheets** وأبقِ حجم الورقة. احفظ.

### Fusion
من الرسم: File > Export > **PDF**. تأكد أن الأوراق كلها محددة ثم اضغط Export.

### SOLIDWORKS
File > Save As. اختر **PDF (*.pdf)**. اضغط Options واختر **All sheets**. احفظ.

## افحص قبل الرفع
- الخطوط واضحة ويمكن قراءة النص عند التكبير.
- الحجم أقل من 50 ميجابايت.
- رمز المسقط ظاهر.

## خطأ شائع
تصدير الورقة الأولى فقط بينما للرسم عدة أوراق.$body$,
array['title-block', 'dimension', 'first-angle-projection']::text[], 11, true),
('my-file-was-rejected', 'files-and-export', 'My file was rejected', 'تم رفض ملفي',
$body$A rejected file means the checker could not read it or found a problem. The message tells you which one. Fix it and upload again.

## Steps
1. Read the message shown under your upload.
2. Find it in the list below.
3. Fix the file and export again.
4. Upload the new file.

## Common reasons
- **Not a STEP file.** The name must end in .step or .stp. Do not rename another format; export as STEP.
- **Empty file.** Export again and check the size is not zero.
- **More than one body.** The task wants one solid. Combine bodies or export only the part asked for.
- **Wrong units.** The size looks 25.4 times off. Set the document to millimetres.
- **Too large.** The limit is 50 MB. See the article on large files.
- **Wrong format for the task.** Drawings must be PDF.

## Still stuck?
Use **Need help** and send us the file name and the message you saw. During the timed test you may re-upload until the timer ends.$body$,
$body$رفض الملف يعني أن الفاحص لم يستطع قراءته أو وجد مشكلة. الرسالة تخبرك بالسبب. أصلح الملف وارفعه مجددًا.

## الخطوات
1. اقرأ الرسالة الظاهرة تحت الملف المرفوع.
2. ابحث عنها في القائمة أدناه.
3. أصلح الملف وصدّره من جديد.
4. ارفع الملف الجديد.

## الأسباب الشائعة
- **ليس ملف STEP.** يجب أن ينتهي الاسم بـ .step أو .stp. لا تغيّر الامتداد بل صدّر بصيغة STEP.
- **ملف فارغ.** صدّر من جديد وتأكد أن الحجم ليس صفرًا.
- **أكثر من جسم.** المهمة تطلب جسمًا صلبًا واحدًا. ادمج الأجسام أو صدّر القطعة المطلوبة فقط.
- **وحدات خاطئة.** يبدو الحجم أكبر أو أصغر بمقدار 25.4 مرة. اضبط المستند على المليمتر.
- **حجم كبير.** الحد 50 ميجابايت. اقرأ مقال الملفات الكبيرة.
- **صيغة لا تناسب المهمة.** الرسومات يجب أن تكون PDF.

## لا تزال عالقًا؟
استخدم **أحتاج مساعدة** وأرسل لنا اسم الملف والرسالة التي رأيتها. في الاختبار المؤقت يمكنك إعادة الرفع حتى ينتهي الوقت.$body$,
array['step-file', 'solid-body', 'units-mm']::text[], 12, true),
('my-file-is-too-large', 'files-and-export', 'My file is too large', 'ملفي كبير جدًا',
$body$The upload limit is 50 MB per file. Most single parts are far smaller, so a big file usually has extra content.

## Steps
1. Check you are exporting one part, not a whole assembly.
2. Remove extra bodies, sketches and construction geometry you do not need.
3. Export again and check the new size.
4. For a PDF, export at standard quality and avoid embedding photos.
5. Upload again.

## For STEP files
- Delete hidden or unused bodies before export.
- Do not include assemblies of standard parts unless asked.
- If your software offers a tolerance or quality setting, use the default.

## For PDF drawings
- Use "vector" output, not a scanned picture.
- Remove large images from the sheet.

## Still too large?
Do not zip the file; zipped files are not accepted. Use **Need help** and tell us the file name and size.$body$,
$body$حد الرفع 50 ميجابايت للملف الواحد. معظم القطع المفردة أصغر بكثير، لذا الملف الكبير يعني عادة وجود محتوى زائد.

## الخطوات
1. تأكد أنك تصدّر قطعة واحدة وليس تجميعًا كاملًا.
2. احذف الأجسام والرسومات الإضافية والهندسة المساعدة غير اللازمة.
3. صدّر من جديد وافحص الحجم الجديد.
4. لملف PDF صدّر بجودة عادية وتجنّب تضمين الصور.
5. ارفع من جديد.

## لملفات STEP
- احذف الأجسام المخفية أو غير المستخدمة قبل التصدير.
- لا تضمّن تجميعات القطع القياسية إلا إذا طُلب ذلك.
- إن وفّر برنامجك إعداد جودة أو تفاوت فاستخدم الافتراضي.

## لرسومات PDF
- استخدم ناتجًا متجهيًا لا صورة ممسوحة.
- احذف الصور الكبيرة من الورقة.

## لا يزال كبيرًا؟
لا تضغط الملف، فالملفات المضغوطة غير مقبولة. استخدم **أحتاج مساعدة** وأخبرنا باسم الملف وحجمه.$body$,
array['step-file', 'solid-body']::text[], 13, true),
('i-uploaded-the-wrong-file', 'files-and-export', 'I uploaded the wrong file', 'رفعت الملف الخطأ',
$body$Don't worry. You can replace a file before you submit.

## During the timed test
1. Go to the task where you uploaded the wrong file.
2. Choose **Replace file** and pick the right one.
3. Wait for the progress bar to finish and the tick to appear.
4. Check the file name shown matches what you meant to send.

The newest file you upload for a task is the one that counts.

## After you submit
- Once you submit, or the timer auto-submits, you cannot change files.
- If the time ended less than 60 seconds ago, the upload grace period may still accept your file.
- Otherwise message us with **Need help**. We cannot promise a change, but we will look at it.

## Tip
Give files clear names like task-2-bracket.step. It is much easier to spot a wrong one.$body$,
$body$لا تقلق. يمكنك استبدال الملف قبل التسليم.

## أثناء الاختبار المؤقت
1. اذهب إلى المهمة التي رفعت فيها الملف الخطأ.
2. اختر **استبدال الملف** وحدّد الملف الصحيح.
3. انتظر اكتمال شريط التقدم وظهور علامة الصح.
4. تأكد أن اسم الملف الظاهر هو ما تقصده.

آخر ملف ترفعه للمهمة هو المعتمد.

## بعد التسليم
- بعد التسليم، أو التسليم التلقائي عند انتهاء المؤقت، لا يمكن تغيير الملفات.
- إن كان الوقت قد انتهى قبل أقل من 60 ثانية، فقد تقبل مهلة الرفع ملفك.
- غير ذلك راسلنا عبر **أحتاج مساعدة**. لا نعدك بالتغيير، لكننا سنراجع الحالة.

## نصيحة
سمِّ ملفاتك بأسماء واضحة مثل task-2-bracket.step. يسهل عندها اكتشاف الخطأ.$body$,
array['step-file']::text[], 14, true),
('timer-rules', 'the-test', 'Timer rules', 'قواعد المؤقت',
$body$The test is timed so every student has the same conditions. The timer is simple, but a few rules are worth knowing.

## How it works
1. The timer starts when you press **Start test**.
2. It runs on our server, not on your device. Closing the tab, refreshing or switching computers does not stop it.
3. The test is about 90 minutes.
4. When time ends, your test is **submitted automatically**.

## Upload grace
If a file is uploading when time runs out, you get a 60-second grace period to finish that upload. You cannot start new uploads after that.

## Tips
- Upload as you go, not all at the end.
- Keep the test tab open.
- If your own clock and ours differ by a few seconds, trust the one on the screen.

## Can I pause?
No. Choose a time when you will not be interrupted.$body$,
$body$المؤقت يضمن أن يختبر الجميع بالظروف نفسها. هو بسيط، لكن هناك قواعد تستحق المعرفة.

## كيف يعمل
1. يبدأ المؤقت عند الضغط على **ابدأ الاختبار**.
2. يعمل على خادمنا وليس على جهازك. إغلاق الصفحة أو تحديثها أو تغيير الحاسوب لا يوقفه.
3. مدة الاختبار نحو 90 دقيقة.
4. عند انتهاء الوقت يُسلَّم اختبارك **تلقائيًا**.

## مهلة الرفع
إذا كان ملف قيد الرفع عند انتهاء الوقت، تحصل على مهلة 60 ثانية لإكمال هذا الرفع. لا يمكنك بدء رفع جديد بعدها.

## نصائح
- ارفع أولًا بأول، لا تؤجل كل شيء للنهاية.
- أبقِ صفحة الاختبار مفتوحة.
- إن اختلفت ساعتك عن ساعتنا بثوانٍ فالمعتمد هو ما يظهر على الشاشة.

## هل يمكن الإيقاف المؤقت؟
لا. اختر وقتًا لا تتعرض فيه للمقاطعة.$body$,
array['step-file']::text[], 15, true),
('what-if-my-internet-drops', 'the-test', 'What if my internet drops?', 'ماذا لو انقطع الإنترنت؟',
$body$Your test keeps running on our server, so a drop does not cost you your work. It can cost you time, so act quickly.

## What to do
1. Keep working in your CAD software. It does not need internet.
2. Try to reconnect: switch to mobile data or a hotspot from your phone if your Wi-Fi is down.
3. Open the test page again. You will return to the same attempt.
4. Upload the files that did not go through. Check each task shows a tick.

## Good to know
- The timer does not stop while you are offline.
- Files that had finished uploading are saved.
- A file that was half uploaded must be uploaded again.
- The 60-second grace period only covers an upload that was already in progress when time ended.

## Prepare ahead
- Export files as you finish each task, so they are ready to upload.
- Keep your phone charged as a backup connection.

If you lost a lot of time because of a real outage, use **Need help** after the test and tell us what happened.$body$,
$body$يستمر اختبارك في العمل على خادمنا، فانقطاع الإنترنت لا يضيّع عملك. لكنه قد يضيّع وقتك، فتصرّف بسرعة.

## ماذا تفعل
1. واصل العمل في برنامجك. فهو لا يحتاج إنترنت.
2. حاول إعادة الاتصال: انتقل إلى بيانات الجوال أو نقطة اتصال من هاتفك إن تعطل الواي فاي.
3. افتح صفحة الاختبار من جديد. ستعود إلى المحاولة نفسها.
4. ارفع الملفات التي لم تكتمل. تأكد أن كل مهمة تظهر عليها علامة صح.

## معلومات مهمة
- لا يتوقف المؤقت أثناء انقطاعك.
- الملفات التي اكتمل رفعها محفوظة.
- الملف الذي توقف رفعه في المنتصف يجب رفعه من جديد.
- مهلة الـ 60 ثانية تشمل فقط رفعًا كان جاريًا عند انتهاء الوقت.

## استعد مسبقًا
- صدّر الملفات فور إنهاء كل مهمة لتكون جاهزة للرفع.
- أبقِ هاتفك مشحونًا كاتصال احتياطي.

إن خسرت وقتًا كبيرًا بسبب انقطاع حقيقي، استخدم **أحتاج مساعدة** بعد الاختبار وأخبرنا بما حدث.$body$,
array['step-file']::text[], 16, true),
('can-i-retake-the-test', 'the-test', 'Can I retake the test?', 'هل يمكنني إعادة الاختبار؟',
$body$Yes. You can retake the free test **14 days** after your last attempt.

## Why the wait?
Practice makes you better, and 14 days gives you time to learn from your results before trying again.

## Steps
1. Open your results and read the feedback on each skill area.
2. Practise the weak areas.
3. After 14 days, open the test page. The **Start test** button becomes available.
4. Press Start. You get a new set of tasks if one is available.

## Good to know
- Your earlier results stay in your history so you can see your progress.
- Your newest level is shown on your dashboard.
- The practice upload in Get Ready is not part of this rule. You can repeat it as often as you like.

## Want to improve faster?
The training course is designed to move you up the levels. See the training articles for what is included.$body$,
$body$نعم. يمكنك إعادة الاختبار المجاني بعد **14 يومًا** من آخر محاولة.

## لماذا الانتظار؟
التدريب يحسّن مستواك، و14 يومًا تمنحك وقتًا للتعلم من نتائجك قبل المحاولة التالية.

## الخطوات
1. افتح نتائجك واقرأ الملاحظات على كل مهارة.
2. تدرّب على المهارات الضعيفة.
3. بعد 14 يومًا افتح صفحة الاختبار. سيتاح زر **ابدأ الاختبار**.
4. اضغط ابدأ. ستحصل على مهام جديدة إن توفرت.

## معلومات مهمة
- تبقى نتائجك السابقة في سجلك لترى تقدمك.
- يظهر مستواك الأحدث في لوحتك.
- الرفع التدريبي في خطوات الاستعداد ليس جزءًا من هذه القاعدة. يمكنك تكراره كما تشاء.

## تريد التحسن أسرع؟
صُممت الدورة التدريبية لترفع مستواك. اقرأ مقالات التدريب لمعرفة ما تتضمنه.$body$,
array['step-file']::text[], 17, true),
('how-grading-works', 'the-test', 'How grading works', 'كيف يتم التصحيح',
$body$Your test has two kinds of tasks, and each is graded in its own way.

## 3D models (automatic)
1. You upload a STEP file.
2. Our system reads it and measures the **volume**, **surface area**, **mass properties** and **principal moments** of your part.
3. It compares them with the reference answer, with a small allowed difference.
4. You see the result within minutes.

This is why units, material and density matter. See the articles on setting them.

## Drawings (checklist, then trainer)
1. You upload a PDF.
2. An AI checklist checks the drawing against the rules: title block, views, dimensions, sections, tolerances and more. First or third angle projection is accepted.
3. A trainer reviews the result and adds comments, usually within 48 hours [TODO-MO: confirm 48h].

## After grading
You get a score for each skill area and an overall level. A score can be **provisional** until the trainer finishes. See the article on provisional scores.

The hint on each failed item explains the rule without giving the answer.$body$,
$body$يحتوي اختبارك على نوعين من المهام، ولكل نوع طريقة تصحيح.

## النماذج ثلاثية الأبعاد (تلقائي)
1. ترفع ملف STEP.
2. يقرؤه نظامنا ويقيس **الحجم** و**مساحة السطح** و**الخصائص الكتلية** و**العزوم الرئيسية** لقطعتك.
3. يقارنها بالإجابة المرجعية مع فارق صغير مسموح.
4. تظهر النتيجة خلال دقائق.

لهذا تهم الوحدات والخامة والكثافة. اقرأ المقالات الخاصة بضبطها.

## الرسومات (قائمة تحقق ثم مدرّب)
1. ترفع ملف PDF.
2. تفحص قائمة تحقق بالذكاء الاصطناعي الرسم وفق القواعد: الجدول التعريفي والمناظير والأبعاد والمقاطع والتفاوتات وغيرها. يُقبل المسقط الأول أو الثالث.
3. يراجع مدرّب النتيجة ويضيف ملاحظات، غالبًا خلال 48 ساعة [TODO-MO: confirm 48h].

## بعد التصحيح
تحصل على درجة لكل مهارة ومستوى عام. قد تكون الدرجة **مؤقتة** حتى ينهي المدرّب مراجعته. اقرأ مقال الدرجات المؤقتة.

التلميح على كل بند فاشل يشرح القاعدة دون أن يعطيك الإجابة.$body$,
array['mass-properties', 'volume', 'title-block']::text[], 18, true),
('what-does-my-skill-level-mean', 'the-test', 'What does my skill level mean?', 'ماذا يعني مستواي؟',
$body$Your level shows how close you are to competition standard. It comes from your overall percentage score.

## Levels
| Score | Level | Band |
|---|---|---|
| 0 - 19% | L1 | Beginner |
| 20 - 39% | L2 | Beginner |
| 40 - 59% | L3 | Developing |
| 60 - 74% | L4 | Competitive |
| 75 - 89% | L5 | Competition-ready |
| 90% and above | L6 | Competition-ready |

## What to do with it
1. Look at your skill areas to find the weakest ones.
2. Read the feedback on each failed item.
3. Practise those areas, then retake the test after 14 days.

## Good to know
- A level is a snapshot of one test, not a judgement of you.
- You see a separate score for each skill area as well as the overall level.
- Levels in the training are linked to these, so you can start where you need to.$body$,
$body$يوضّح مستواك مدى قربك من معيار المسابقة. ويُحسب من نسبة درجتك الإجمالية.

## المستويات
| الدرجة | المستوى | الفئة |
|---|---|---|
| 0 - 19% | L1 | مبتدئ |
| 20 - 39% | L2 | مبتدئ |
| 40 - 59% | L3 | في طور التطور |
| 60 - 74% | L4 | منافس |
| 75 - 89% | L5 | جاهز للمسابقة |
| 90% فأكثر | L6 | جاهز للمسابقة |

## ماذا تفعل به
1. انظر إلى مهاراتك لتعرف الأضعف.
2. اقرأ الملاحظات على كل بند فاشل.
3. تدرّب على تلك المهارات ثم أعد الاختبار بعد 14 يومًا.

## معلومات مهمة
- المستوى صورة عن اختبار واحد، وليس حكمًا عليك.
- ترى درجة منفصلة لكل مهارة إضافة إلى المستوى العام.
- ترتبط مستويات التدريب بهذه المستويات لتبدأ من حيث تحتاج.$body$,
array['mass-properties']::text[], 19, true),
('why-is-my-score-provisional', 'the-test', 'Why is my score provisional?', 'لماذا درجتي مؤقتة؟',
$body$A **provisional** score means part of your test is still waiting for a trainer.

## Why it happens
3D models are graded automatically, so their points appear at once. Drawings need a trainer to confirm the AI checklist and judge things a computer cannot, like layout and readability. Until that is done, your total is not final.

## What to do
1. Nothing. You do not need to resubmit.
2. We email you when your final score is ready, usually within 48 hours [TODO-MO: confirm 48h].
3. Open your results to see the updated score and trainer comments.

## Good to know
- Your final score can go up or down a little once the trainer reviews your drawings.
- Your level may change when the score becomes final.
- You cannot start another attempt until the 14-day wait ends, even while a score is provisional.

## Waiting longer than expected?
Use **Need help** and tell us your test date.$body$,
$body$الدرجة **المؤقتة** تعني أن جزءًا من اختبارك لا يزال ينتظر مدرّبًا.

## لماذا يحدث ذلك
تُصحَّح النماذج ثلاثية الأبعاد تلقائيًا فتظهر نقاطها فورًا. أما الرسومات فيؤكد المدرّب فيها قائمة التحقق ويقيّم ما لا يقيّمه الحاسوب، مثل التنسيق ووضوح القراءة. وحتى يتم ذلك لا يكون مجموعك نهائيًا.

## ماذا تفعل
1. لا شيء. لا تحتاج إلى إعادة التسليم.
2. سنراسلك عندما تجهز درجتك النهائية، غالبًا خلال 48 ساعة [TODO-MO: confirm 48h].
3. افتح نتائجك لترى الدرجة المحدثة وملاحظات المدرّب.

## معلومات مهمة
- قد ترتفع درجتك النهائية أو تنخفض قليلًا بعد مراجعة المدرّب لرسوماتك.
- قد يتغير مستواك عندما تصبح الدرجة نهائية.
- لا يمكنك بدء محاولة جديدة قبل انتهاء مدة الـ 14 يومًا، حتى لو كانت الدرجة مؤقتة.

## تأخرت أكثر من المتوقع؟
استخدم **أحتاج مساعدة** وأخبرنا بتاريخ اختبارك.$body$,
array['mass-properties', 'title-block']::text[], 20, true),
('whats-included-in-the-training', 'training-and-payment', 'What''s included in the training', 'ما الذي يتضمنه التدريب',
$body$The training takes you from your test level up to competition standard, one level at a time.

## What you get
- Video lessons in Arabic and English for your software track.
- Practice exercises with instant feedback on 3D models.
- Drawing practice with checklist feedback and trainer review.
- Mock tests that follow the real competition modules.
- Certificates as you complete each level.

## How it works
1. Choose your software track. Inventor is recommended for the competition.
2. Start at the level your test recommends.
3. Finish the lessons and exercises to unlock the next level.

## Tracks
- **Inventor**, **Fusion** and **SOLIDWORKS**. Some tools exist only in Inventor, and lessons say so.

## Details to be confirmed
Full list of lessons, number of levels, trainer support and duration: [TODO-MO: training contents].

See the payment articles to learn how to join.$body$,
$body$يأخذك التدريب من مستواك في الاختبار إلى معيار المسابقة، مستوىً بعد مستوى.

## ما ستحصل عليه
- دروس فيديو بالعربية والإنجليزية لمسار برنامجك.
- تمارين عملية مع تقييم فوري للنماذج ثلاثية الأبعاد.
- تدريب على الرسم الهندسي مع ملاحظات قائمة التحقق ومراجعة المدرّب.
- اختبارات تجريبية تتبع وحدات المسابقة الحقيقية.
- شهادات عند إكمال كل مستوى.

## كيف يعمل
1. اختر مسار برنامجك. يُنصح بـ Inventor للمسابقة.
2. ابدأ من المستوى الذي يقترحه اختبارك.
3. أكمل الدروس والتمارين لفتح المستوى التالي.

## المسارات
- **Inventor** و**Fusion** و**SOLIDWORKS**. بعض الأدوات موجودة في Inventor فقط، وتذكر الدروس ذلك.

## تفاصيل قيد التأكيد
قائمة الدروس الكاملة وعدد المستويات والدعم من المدرّب والمدة: [TODO-MO: training contents].

اقرأ مقالات الدفع لتعرف كيف تنضم.$body$,
array[]::text[], 21, true),
('how-to-pay-with-fawran', 'training-and-payment', 'How to pay with Fawran', 'كيف تدفع عبر فوري',
$body$Fawran is the instant bank transfer in Qatar. You pay from your own bank app and upload proof.

## Steps
1. Choose your plan and press **Pay with Fawran**.
2. Note the amount, our account details and your **reference code**.
3. Open your bank app and make an instant transfer with that amount.
4. Put the reference code in the transfer notes, so we can match it.
5. Take a screenshot of the confirmation screen.
6. Return to the payment page and upload the screenshot.
7. Press **Send proof**. Your payment shows as **Waiting for approval**.

## Check before sending
- The amount is exactly what the page shows.
- The reference code is visible in the screenshot.
- The date, time and status "successful" are visible.

## After you send
We check your transfer and approve it. You will get an email when your access opens. See the article on approval times.

## Problem?
If you paid the wrong amount or lost the reference, use **Need help** and send your screenshot.$body$,
$body$فوري هو التحويل البنكي الفوري في قطر. تدفع من تطبيق بنكك وترفع إثبات الدفع.

## الخطوات
1. اختر خطتك واضغط **الدفع عبر فوري**.
2. دوّن المبلغ وبيانات حسابنا و**رمز المرجع** الخاص بك.
3. افتح تطبيق بنكك وأجرِ تحويلًا فوريًا بهذا المبلغ.
4. اكتب رمز المرجع في ملاحظات التحويل لنطابقه بسهولة.
5. التقط صورة شاشة لصفحة تأكيد التحويل.
6. ارجع إلى صفحة الدفع وارفع الصورة.
7. اضغط **إرسال الإثبات**. ستظهر دفعتك **بانتظار الموافقة**.

## تحقق قبل الإرسال
- المبلغ مطابق تمامًا لما تعرضه الصفحة.
- رمز المرجع ظاهر في الصورة.
- التاريخ والوقت وحالة «ناجح» ظاهرة.

## بعد الإرسال
نراجع تحويلك ونوافق عليه. ستصلك رسالة بريدية عند فتح الوصول. اقرأ مقال مدة الموافقة.

## مشكلة؟
إن دفعت مبلغًا خاطئًا أو فقدت المرجع، استخدم **أحتاج مساعدة** وأرسل صورتك.$body$,
array[]::text[], 22, true),
('how-long-until-payment-is-approved', 'training-and-payment', 'How long until my payment is approved?', 'كم تستغرق الموافقة على دفعتي؟',
$body$Fawran payments are approved by a person, not automatically. Approval usually happens within working hours [TODO-MO: confirm approval time and working hours].

## What to expect
1. You send your proof.
2. Your payment shows **Waiting for approval**.
3. We check the transfer against your reference code.
4. When approved, you get an email and your access opens.

## Tips for a faster approval
- Include the reference code in the transfer notes.
- Send a clear, full screenshot.
- Send it during working hours.

## If it takes longer
1. Check your email and spam folder.
2. Check the payment status on your account page.
3. If the status has not changed after a full working day, use **Need help** with your reference code.

## If it was rejected
You will see the reason. The most common ones are an unclear screenshot or a wrong amount. Fix it and send the proof again.$body$,
$body$تُعتمد دفعات فوري يدويًا من شخص، وليس تلقائيًا. تتم الموافقة عادةً خلال ساعات العمل [TODO-MO: confirm approval time and working hours].

## ما المتوقع
1. ترسل الإثبات.
2. تظهر دفعتك **بانتظار الموافقة**.
3. نطابق التحويل مع رمز المرجع.
4. عند الموافقة تصلك رسالة بريدية ويُفتح الوصول.

## نصائح لموافقة أسرع
- اكتب رمز المرجع في ملاحظات التحويل.
- أرسل صورة شاشة واضحة وكاملة.
- أرسلها خلال ساعات العمل.

## إن تأخر الأمر
1. راجع بريدك والرسائل غير المرغوبة.
2. راجع حالة الدفعة في صفحة حسابك.
3. إن لم تتغير الحالة بعد يوم عمل كامل، استخدم **أحتاج مساعدة** مع رمز المرجع.

## إن رُفضت الدفعة
سترى السبب. أكثر الأسباب شيوعًا صورة غير واضحة أو مبلغ خاطئ. صحّح الأمر وأرسل الإثبات من جديد.$body$,
array[]::text[], 23, true),
('refunds', 'training-and-payment', 'Refunds', 'الاسترداد',
$body$We want you to feel safe when you join. Our refund policy is described here.

[TODO-MO: refund policy - eligibility window, conditions, how the refund is paid, and who to contact]

## How to ask for a refund
1. Open **Need help** from your account.
2. Tell us the email you used and your payment reference code.
3. Explain why you are asking.
4. We reply with the next step.

## Before you ask
- Check that your access opened. Sometimes a refund is not needed, only a fix.
- Check the plan details on your payment page.

## Good to know
- Refunds are decided case by case under the policy above.
- Refunds go back by the same method you used, normally a bank transfer.
- Keep your payment screenshot until the refund arrives.

We cannot promise a refund before the policy is confirmed, but we will always answer you.$body$,
$body$نريدك أن تشعر بالأمان عند الانضمام. تجد هنا سياسة الاسترداد.

[TODO-MO: refund policy - eligibility window, conditions, how the refund is paid, and who to contact]

## كيف تطلب الاسترداد
1. افتح **أحتاج مساعدة** من حسابك.
2. أخبرنا بالبريد الذي استخدمته ورمز مرجع دفعتك.
3. اشرح سبب طلبك.
4. نرد عليك بالخطوة التالية.

## قبل أن تطلب
- تأكد أن وصولك قد فُتح. أحيانًا تكفي المعالجة ولا يلزم الاسترداد.
- راجع تفاصيل الخطة في صفحة الدفع.

## معلومات مهمة
- يُبتّ في الاسترداد لكل حالة وفق السياسة أعلاه.
- يعود المبلغ بالطريقة نفسها التي دفعت بها، عادةً بتحويل بنكي.
- احتفظ بصورة الدفع حتى يصلك المبلغ.

لا نعد بالاسترداد قبل اعتماد السياسة، لكننا نرد عليك دائمًا.$body$,
array[]::text[], 24, true),
('changing-my-email-or-password', 'account', 'Changing my email or password', 'تغيير بريدي أو كلمة المرور',
$body$You can change both from your account settings.

## Change your password
1. Open **Account settings**.
2. Choose **Security**.
3. Enter your new password twice and press **Save**.
4. Pick a strong password you do not use elsewhere.

## Forgot your password?
1. On the sign-in page press **Forgot password**.
2. Enter your email.
3. Open the email we send and follow the link.
4. Choose a new password.

## Change your email
1. Open **Account settings** and choose **Email**.
2. Enter the new address.
3. Open the confirmation email sent to the new address and press the link.
4. Your email changes only after you confirm.

## Good to know
- If you signed in with Google or another provider, change your password with that provider.
- Our emails go to the address on your account, so keep it current.$body$,
$body$يمكنك تغيير الاثنين من إعدادات حسابك.

## تغيير كلمة المرور
1. افتح **إعدادات الحساب**.
2. اختر **الأمان**.
3. أدخل كلمة المرور الجديدة مرتين واضغط **حفظ**.
4. اختر كلمة مرور قوية لا تستخدمها في موقع آخر.

## نسيت كلمة المرور؟
1. في صفحة الدخول اضغط **نسيت كلمة المرور**.
2. أدخل بريدك.
3. افتح الرسالة التي نرسلها واتبع الرابط.
4. اختر كلمة مرور جديدة.

## تغيير البريد
1. افتح **إعدادات الحساب** واختر **البريد**.
2. أدخل العنوان الجديد.
3. افتح رسالة التأكيد المرسلة إلى العنوان الجديد واضغط الرابط.
4. لا يتغير بريدك إلا بعد التأكيد.

## معلومات مهمة
- إن دخلت عبر Google أو مزوّد آخر فغيّر كلمة المرور لدى ذلك المزوّد.
- تصل رسائلنا إلى العنوان المسجل في حسابك، فأبقِه محدّثًا.$body$,
array[]::text[], 25, true),
('i-didnt-get-the-verification-email', 'account', 'I didn''t get the verification email', 'لم تصلني رسالة التحقق',
$body$Verification emails usually arrive in a minute or two. If yours has not, try these steps.

## Steps
1. Wait 5 minutes.
2. Check your **spam** or **junk** folder, and the Promotions tab in Gmail.
3. Check the address. A typo is the most common cause.
4. Press **Resend verification email** on the sign-in page.
5. Add info@gestaltung360.com to your contacts, then resend.
6. Open the link on the same device where you signed up, if you can.

## Still nothing?
- Try a different email address you can read right now.
- Some school or company email systems block new senders. A personal address usually works.
- Use **Need help** or write to info@gestaltung360.com with the email you used.

## Good to know
- The link works for a limited time. If it has expired, request a new one.
- Do not create several accounts. Use the one you made first.$body$,
$body$تصل رسائل التحقق عادةً خلال دقيقة أو دقيقتين. إن لم تصلك رسالتك فجرّب الخطوات التالية.

## الخطوات
1. انتظر 5 دقائق.
2. افحص مجلد **الرسائل غير المرغوبة (Spam)**، وتبويب الترويجات في Gmail.
3. تأكد من العنوان. الخطأ الإملائي هو السبب الأشيع.
4. اضغط **إعادة إرسال رسالة التحقق** في صفحة الدخول.
5. أضف info@gestaltung360.com إلى جهات اتصالك ثم أعد الإرسال.
6. افتح الرابط على الجهاز نفسه الذي سجلت منه إن أمكن.

## ولا شيء بعد؟
- جرّب بريدًا آخر تستطيع قراءته الآن.
- بعض أنظمة بريد المدارس والشركات تحجب المرسلين الجدد. البريد الشخصي يعمل غالبًا.
- استخدم **أحتاج مساعدة** أو راسل info@gestaltung360.com مع البريد الذي استخدمته.

## معلومات مهمة
- الرابط صالح لمدة محدودة. إن انتهت فاطلب رابطًا جديدًا.
- لا تنشئ عدة حسابات. استخدم أول حساب أنشأته.$body$,
array[]::text[], 26, true),
('deleting-my-account', 'account', 'Deleting my account', 'حذف حسابي',
$body$You can ask us to delete your account and personal data. This cannot be undone, so read this first.

## What is deleted
- Your profile and sign-in.
- Your uploaded files and test submissions.
- Your progress in the training.

## What we may keep
Payment records may need to be kept for accounting. Data kept after deletion is held for [TODO-MO: retention days] days.

## Steps
1. Open **Account settings**.
2. Choose **Delete my account**.
3. Read the warning and confirm.
4. Your data is deleted after the retention period.

## Before you delete
- Download any certificates you want to keep.
- If you have a paid plan, ask about it first with **Need help**. Deleting does not itself give a refund.
- You can sign up again later, but your old progress will not come back.

## Changed your mind?
Contact us before the retention period ends and we can cancel the request.$body$,
$body$يمكنك أن تطلب منا حذف حسابك وبياناتك الشخصية. لا يمكن التراجع عن ذلك، فاقرأ ما يلي أولًا.

## ما الذي يُحذف
- ملفك الشخصي وبيانات الدخول.
- ملفاتك المرفوعة وتسليمات الاختبار.
- تقدمك في التدريب.

## ما قد نحتفظ به
قد يلزم الاحتفاظ بسجلات الدفع لأغراض المحاسبة. تُحفظ البيانات بعد الحذف لمدة [TODO-MO: retention days] يومًا.

## الخطوات
1. افتح **إعدادات الحساب**.
2. اختر **حذف حسابي**.
3. اقرأ التحذير وأكّد.
4. تُحذف بياناتك بعد انتهاء مدة الاحتفاظ.

## قبل أن تحذف
- نزّل الشهادات التي تريد الاحتفاظ بها.
- إن كانت لديك خطة مدفوعة فاسأل عنها أولًا عبر **أحتاج مساعدة**. الحذف وحده لا يعني استرداد المبلغ.
- يمكنك التسجيل من جديد لاحقًا، لكن تقدمك القديم لن يعود.

## غيّرت رأيك؟
راسلنا قبل انتهاء مدة الاحتفاظ ويمكننا إلغاء الطلب.$body$,
array[]::text[], 27, true),
('privacy', 'account', 'Privacy: how we use your data', 'الخصوصية: كيف نستخدم بياناتك',
$body$We collect only what we need to run your test and training.

## What we collect
- Your name, email and phone, if you give them.
- Your software choice and test results.
- The files you upload for grading.
- Payment proof you send for Fawran.

## How we use it
1. To grade your work and show your results.
2. To send you emails about your account and results.
3. To improve the tests and lessons, using results without your name.

## Who can see it
- You.
- Our trainers and admins, when they review your work or help you.
- Service providers that run the site for us, under their own privacy rules.

[TODO-MO: privacy policy - review this summary against the full privacy policy]

## Your choices
- Update your details in **Account settings**.
- Ask for a copy or deletion of your data with **Need help**. See the delete account article.

## Questions?
Write to info@gestaltung360.com.$body$,
$body$نجمع فقط ما نحتاجه لتشغيل اختبارك وتدريبك.

## ما الذي نجمعه
- اسمك وبريدك وهاتفك إن قدمتها.
- اختيارك للبرنامج ونتائج الاختبار.
- الملفات التي ترفعها للتصحيح.
- إثبات الدفع الذي ترسله لفوري.

## كيف نستخدمه
1. لتصحيح عملك وعرض نتائجك.
2. لإرسال رسائل عن حسابك ونتائجك.
3. لتحسين الاختبارات والدروس باستخدام نتائج بلا اسمك.

## من يستطيع رؤيته
- أنت.
- مدرّبونا ومشرفونا حين يراجعون عملك أو يساعدونك.
- مزوّدو الخدمات الذين يشغّلون الموقع لنا، وفق سياسات الخصوصية الخاصة بهم.

[TODO-MO: privacy policy - review this summary against the full privacy policy]

## خياراتك
- حدّث بياناتك في **إعدادات الحساب**.
- اطلب نسخة من بياناتك أو حذفها عبر **أحتاج مساعدة**. اقرأ مقال حذف الحساب.

## أسئلة؟
راسل info@gestaltung360.com.$body$,
array[]::text[], 28, true),
('how-the-real-competition-works', 'competition', 'How the real competition works', 'كيف تجري المسابقة الحقيقية',
$body$The world competition in Mechanical Engineering CAD has four separate modules, one on each of four days. This is a plain summary. Gestaltung360 is an independent training provider and is not affiliated with or endorsed by any competition organiser.

## The four modules
1. **M1 Mechanical fabrication (6 hours).** You get finished drawings and models. You build sheet metal and frame parts, welded and bolted connections, tubes and cables, make detail drawings, and finish with one animation.
2. **M2 Mechanical design challenge (6 hours).** You get assemblies and a design change. You build a working assembly, apply the change, and produce an assembly drawing, exploded views, a motion animation and photo renders.
3. **M3 Assemblies and detail drawings (6 hours).** You model parts from detail drawings, assemble them, add standard parts and make manufacturing drawings.
4. **M4 Reverse engineering (4 hours).** You measure a real part with allowed instruments. The part is taken away after 2 hours, so your sketches matter. You model it, annotate it and draw it.

## Other skills tested
3D printing, 3D scanning, model-based definition, limits and fits, surface texture and GD&T.

## Conduct
No internet, phones, smartwatches or USB sticks. Your training mock tests copy these rules.$body$,
$body$للمسابقة العالمية في التصميم الميكانيكي بالحاسوب أربع وحدات منفصلة، واحدة في كل يوم من أربعة أيام. هذا ملخص مبسّط. Gestaltung360 جهة تدريب مستقلة وليست تابعة لأي جهة منظمة للمسابقة ولا معتمدة منها.

## الوحدات الأربع
1. **M1 التصنيع الميكانيكي (6 ساعات).** تتسلم رسومات ونماذج جاهزة. تبني قطع صفائح وإطارات ووصلات لحام ومسامير وأنابيب وكابلات، وتعدّ رسومات تفصيلية، وتنتهي برسم متحرك واحد.
2. **M2 تحدي التصميم الميكانيكي (6 ساعات).** تتسلم تجميعات وتغييرًا مطلوبًا. تبني تجميعًا يعمل وتطبق التغيير وتنتج رسم تجميع ومناظير مفككة ورسمًا متحركًا وصورًا مصيّرة.
3. **M3 التجميعات والرسومات التفصيلية (6 ساعات).** تنمذج القطع من الرسومات التفصيلية وتجمّعها وتضيف قطعًا قياسية وتعدّ رسومات التصنيع.
4. **M4 الهندسة العكسية (4 ساعات).** تقيس قطعة حقيقية بأدوات مسموحة. تُسحب القطعة بعد ساعتين، فتصبح رسوماتك اليدوية مهمة. تنمذجها وتضيف التوصيفات وترسمها.

## مهارات أخرى
الطباعة ثلاثية الأبعاد والمسح ثلاثي الأبعاد والتوصيف المبني على النموذج والحدود والتوافقات وخشونة السطح وGD&T.

## السلوك
لا إنترنت ولا هواتف ولا ساعات ذكية ولا وحدات USB. اختباراتنا التجريبية تحاكي هذه القواعد.$body$,
array['design-brief', 'mbd', 'reverse-engineering']::text[], 29, true),
('results-folder-structure', 'competition', 'The results folder structure', 'هيكل مجلد النتائج',
$body$In the competition you deliver your files in a fixed folder layout. Practise it in our mock tests so it becomes a habit.

## The layout
Each competition day has two main folders:
- **Results** is what the judges collect. It has these subfolders:
  - 2D Drawings
  - 3D Scannings
  - Animations
  - Parts and Assemblies
  - PDF files
  - Rendered Images
  - Reports
  - STL files
- **Workspace** is for your working files. It is not collected.

Your competitor code sits at the top, then the day, then these folders.

## Steps to practise
1. Create the folders at the start, before you model.
2. Save each file in the right subfolder as soon as it is ready.
3. Export drawings as PDF (or 3D-PDF) into **PDF files**.
4. Keep working files in **Workspace**.
5. Check Results before time runs out.

## Why it matters
A file saved in the wrong place can be missed, and a missed file scores no points.$body$,
$body$في المسابقة تسلّم ملفاتك في هيكل مجلدات ثابت. تدرّب عليه في اختباراتنا التجريبية ليصبح عادة.

## الهيكل
لكل يوم مسابقة مجلدان رئيسيان:
- **Results** هو ما يجمعه الحكام، وفيه المجلدات الفرعية:
  - 2D Drawings
  - 3D Scannings
  - Animations
  - Parts and Assemblies
  - PDF files
  - Rendered Images
  - Reports
  - STL files
- **Workspace** لملفات عملك. ولا تُجمع.

يأتي رمز المتسابق في الأعلى، ثم اليوم، ثم هذه المجلدات.

## خطوات التدرّب
1. أنشئ المجلدات في البداية قبل التصميم.
2. احفظ كل ملف في مجلده الصحيح فور جاهزيته.
3. صدّر الرسومات بصيغة PDF (أو 3D-PDF) إلى **PDF files**.
4. أبقِ ملفات العمل في **Workspace**.
5. افحص Results قبل انتهاء الوقت.

## لماذا هذا مهم
قد يضيع الملف المحفوظ في مكان خاطئ، والملف الضائع لا ينال أي نقاط.$body$,
array['stl', '3d-pdf', '3d-scan']::text[], 30, true),
('first-vs-third-angle-projection', 'competition', 'First vs third angle projection', 'المسقط الأول مقابل المسقط الثالث',
$body$Both ways of laying out a drawing are accepted. What matters is that your symbol matches your layout.

## The difference
- **First angle:** the object sits between you and the plane. The top view goes **below** the front view, and the right-side view goes on the **left**. Common in Europe.
- **Third angle:** the plane sits between you and the object. The top view goes **above** the front view, and the right-side view goes on the **right**. Common in the USA.

## Steps to get it right
1. Check which one your task drawing uses. Competition drawings are given in first angle.
2. Choose first or third angle for your own drawing. You may use either.
3. Set it in your software's drawing standard or template.
4. Put the matching projection symbol on the sheet.
5. Check that the views are arranged to match the symbol.

### Inventor
Drawing Resources > Styles and Standards. Set the projection type in the standard.

### Fusion
In the drawing, use the Projection setting for First or Third angle.

### SOLIDWORKS
Tools > Options > Document Properties > Drafting > Projection type.

## Common mistake
A third-angle symbol on a first-angle layout. That is marked as an error.$body$,
$body$الطريقتان في ترتيب الرسم مقبولتان. المهم أن يطابق رمزك ترتيب المناظير.

## الفرق
- **المسقط الأول:** يقع الجسم بينك وبين المستوى. يوضع منظر الأعلى **تحت** المنظر الأمامي، ومنظر الجانب الأيمن على **اليسار**. شائع في أوروبا.
- **المسقط الثالث:** يقع المستوى بينك وبين الجسم. يوضع منظر الأعلى **فوق** المنظر الأمامي، ومنظر الجانب الأيمن على **اليمين**. شائع في الولايات المتحدة.

## خطوات لتضبطه
1. انظر أيهما يستخدمه رسم مهمتك. رسومات المسابقة تُعطى بالمسقط الأول.
2. اختر المسقط الأول أو الثالث لرسمك. يجوز أي منهما.
3. اضبطه في معيار الرسم أو القالب في برنامجك.
4. ضع رمز المسقط المطابق على الورقة.
5. تأكد أن ترتيب المناظير يطابق الرمز.

### Inventor
Drawing Resources > Styles and Standards. اضبط نوع المسقط في المعيار.

### Fusion
في الرسم استخدم إعداد Projection لاختيار المسقط الأول أو الثالث.

### SOLIDWORKS
Tools > Options > Document Properties > Drafting > Projection type.

## خطأ شائع
رمز المسقط الثالث على ترتيب مسقط أول. يُحتسب هذا خطأً.$body$,
array['first-angle-projection', 'third-angle-projection', 'iso-standard']::text[], 31, true),
('allowed-measuring-instruments', 'competition', 'Allowed measuring instruments', 'أدوات القياس المسموحة',
$body$In the reverse engineering module (M4) you measure a real part by hand. Competitors may bring their own instruments from this list.

## Instruments
1. **Digital caliper**, 0-150 or 0-200 mm.
2. **Offset centerline caliper.**
3. **Digital or universal protractor.**
4. **Radius gauges**, 0.4-25 mm.
5. **Thread pitch gauges**, external and internal metric, 0.35-6 mm, with M6, M8, M10 and M12 plugs.
6. **Surface roughness (Ra) comparator.**
7. **Steel ruler**, 0-300 mm.
8. **Depth gauge caliper**, 0-150 mm.

## Also allowed
A 3D mouse, your own keyboard and mouse, a standards compendium and manuals.

## Not allowed
Photos, putty, ink pads or any method that memorises the shape of the part.

## Steps to prepare
1. Learn what each tool measures. See the glossary and the instruments lesson.
2. Practise on real objects at home.
3. Check your calipers are zeroed before you start.

Kit contents and prices from Gestaltung360: [TODO-MO: kit contents and price].$body$,
$body$في وحدة الهندسة العكسية (M4) تقيس قطعة حقيقية يدويًا. يجوز للمتسابقين إحضار أدواتهم من هذه القائمة.

## الأدوات
1. **قدمة رقمية**، 0-150 أو 0-200 مم.
2. **قدمة بمركز مُزاح (Offset centerline caliper).**
3. **منقلة رقمية أو عامة.**
4. **مقاييس أنصاف الأقطار**، 0.4-25 مم.
5. **مقاييس خطوة اللولب**، خارجية وداخلية متريّة، 0.35-6 مم، مع سدادات M6 وM8 وM10 وM12.
6. **مقارن خشونة السطح (Ra).**
7. **مسطرة فولاذية**، 0-300 مم.
8. **قدمة قياس العمق**، 0-150 مم.

## مسموح أيضًا
فأرة ثلاثية الأبعاد، ولوحة مفاتيح وفأرة خاصتان بك، ومرجع المعايير والأدلة.

## غير مسموح
الصور أو المعجون أو وسائد الحبر أو أي طريقة تحفظ شكل القطعة.

## خطوات الاستعداد
1. تعرّف على ما يقيسه كل أداة. اقرأ المسرد ودرس الأدوات.
2. تدرّب على أشياء حقيقية في البيت.
3. تأكد من تصفير القدمة قبل البدء.

محتويات الطقم وأسعاره من Gestaltung360: [TODO-MO: kit contents and price].$body$,
array['caliper', 'offset-centerline-caliper', 'radius-gauge', 'thread-pitch-gauge']::text[], 32, true)
on conflict (slug) do update set
  category = excluded.category,
  title_en = excluded.title_en,
  title_ar = excluded.title_ar,
  body_en = excluded.body_en,
  body_ar = excluded.body_ar,
  related_glossary_terms = excluded.related_glossary_terms,
  sort = excluded.sort,
  is_published = excluded.is_published;
