<!--
README (this comment is not shown on the site)

One file per client story: content/case-studies/<slug>.md. The slug in the
frontmatter must equal the file name without ".md". Fields:
  slug         lowercase letters, digits and hyphens
  title_en / title_ar, summary_en / summary_ar     required
  persona / persona_ar   a short line such as "Hardware founder" (no names, unless the client agreed)
  sector       startup | college | school
  outcome_en / outcome_ar   list of short lines (use real, agreed numbers only)
  published    true | false. Missing means false.
  date         optional, YYYY-MM-DD, newest first
Body: the English text, then a line holding only the ar marker comment (see
lib/case-studies.ts), then the Arabic text. Markdown subset: paragraphs,
headings, lists, bold, links.

published must stay false until the client agrees in writing to this exact text,
their name (if used) and any numbers. Never publish an invented client or result.
This file is a template: it is skipped on the site while published is false.
-->
---
slug: example-startup
sector: startup
published: false
title_en: "EXAMPLE — replace with a real client story and their permission"
title_ar: "مثال — استبدله بقصة عميل حقيقي وبموافقته"
persona: "Hardware founder (EXAMPLE)"
persona_ar: "مؤسس شركة أجهزة (مثال)"
summary_en: "EXAMPLE — replace with a real client story and their permission. A short, honest summary of the project goes here."
summary_ar: "مثال — استبدله بقصة عميل حقيقي وبموافقته. ملخص قصير وصادق للمشروع يوضع هنا."
outcome_en:
  - "[days from idea to first unit]"
  - "[what the client decided or learned]"
  - "[parts and fabrication cost compared with the alternative the client had]"
outcome_ar:
  - "[عدد الأيام من الفكرة إلى أول وحدة]"
  - "[ما قرره العميل أو تعلمه]"
  - "[تكلفة القطع والتصنيع مقارنة بالبديل الذي كان لدى العميل]"
---

## EXAMPLE — replace with a real client story and their permission

This is an anonymous template, not a real project. No client, company or result is described here.

## The starting point

[Who the client is, in one line, and what they wanted to build. Use their words if they agree.]

## What we did

- [Describe the parts list the client received.]
- [Describe how the wiring or the model was checked, and by whom.]
- [Describe what was made in our Lusail studio and what was bought.]

## What happened next

[What the client did with the result. Only facts the client has agreed to.]

<!-- ar -->

## مثال — استبدله بقصة عميل حقيقي وبموافقته

هذا قالب مجهول وليس مشروعًا حقيقيًا. لا يوصف هنا أي عميل أو شركة أو نتيجة.

## نقطة البداية

[من هو العميل في سطر واحد، وماذا أراد أن يبني. استخدم كلماته إذا وافق.]

## ماذا فعلنا

- [صف قائمة القطع التي حصل عليها العميل.]
- [صف كيف فُحصت التوصيلات أو النموذج، ومن فحصها.]
- [صف ما صُنع في استوديو لوسيل وما تم شراؤه.]

## ماذا حدث بعد ذلك

[ماذا فعل العميل بالنتيجة. فقط الوقائع التي وافق عليها العميل.]
