# Proposed privacy paragraph: projects and meetings from Claude or ChatGPT

**For the owner to approve.** Claude does not touch the legal pages:
`content/legal/**` is generated from `LEGAL_PAGES_DRAFT.md` and the wording is
yours (decision D8). If you approve the text below, paste it into
`LEGAL_PAGES_DRAFT.md` under the privacy page, then run:

```bash
node scripts/split-legal-draft.mjs
```

and check it with `node scripts/split-legal-draft.mjs --check`.

Why it is needed: the Claude directory submission asks for a privacy policy URL
that actually describes what the plugin sends us, and a reviewer will look for
it. It is also simply true — we now receive projects and meeting bookings from
inside someone else's AI chat.

Both versions say the same thing. Western digits in the Arabic, as everywhere
else on the site.

---

## English

### Projects and meetings from Claude or ChatGPT

You can design a product inside your own AI assistant (such as Claude or
ChatGPT) using our plugin, and send the result to us. Nothing reaches us until
you tell your assistant to send it.

**What we receive.** A structured description of the product you designed: its
name, what it does, who it is for, where it will be used, how it is powered,
any size notes, the decisions you made, the parts you chose, wiring notes, any
code, the case you chose (shape, colour, finish, label) and a written brief for
the case. It also includes up to ten short quotes of your own words, each at
most 140 characters, for the key requirements. If you ask to be contacted or to
book a meeting, we receive the name, WhatsApp number and — if you give one —
the email address you chose to share, and for a meeting the time, whether it is
online or at our studio, and anything you wrote about what you want to discuss.
We also store a one-way hashed form of your network address, to limit how often
the service can be used from one place.

**What we never receive.** Your conversation with the assistant. We do not
receive the chat, a transcript, a summary of it, your assistant's instructions,
your account there, or anything else you did not put in the project or the
booking. Our tools have no field for a conversation, and anything longer than
the limits above is rejected.

**If you connect your account.** You can sign in to your Gestaltung360 account
from the assistant. The sign-in and the permission screen are on our own site,
your password is never shown to the assistant, and you can withdraw the
permission at any time. While it is connected, the assistant can save a project
to your account, put parts in your cart, and book a meeting using the name and
number already on your account. It cannot place an order, pay anything, or
reach anything outside your own projects, cart and bookings. You never have to
connect an account: everything except the cart works without one.

**Why we use it.** To quote the product, to buy and sell the parts, to make it,
to hold the meeting you booked, and to contact you about your own enquiry.

**How long we keep it.** A project link you never open expires after 30 days
and is deleted. Once you open it, the project belongs to your account and we
keep it, together with meetings and orders, as we keep other customer records,
for as long as we need it for the work and for Qatari accounting and tax
requirements.

**Your choices.** You can ask us to delete a project, a booking or your contact
details at any time by writing to info@gestaltung360.com. We delete what we are
not required to keep, and tell you what we must keep and why.

---

## العربية

### المشاريع والاجتماعات القادمة من Claude أو ChatGPT

يمكنك تصميم منتج داخل المساعد الذكي الخاص بك (مثل Claude أو ChatGPT) باستخدام
الإضافة الخاصة بنا، ثم إرسال النتيجة إلينا. ولا يصل إلينا أي شيء إلا عندما تطلب
من مساعدك إرساله.

**ما نستلمه.** وصف منظَّم للمنتج الذي صممته: اسمه، وما يفعله، ولمن هو، وأين
سيُستخدم، وكيف يُشغَّل، وأي ملاحظات عن المقاس، والقرارات التي اتخذتها، والقطع
التي اخترتها، وملاحظات التوصيل، وأي كود، والعلبة التي اخترتها (الشكل واللون
والتشطيب والكتابة عليها)، ووصفًا مكتوبًا للعلبة. ويشمل كذلك ما يصل إلى عشرة
اقتباسات قصيرة من كلماتك أنت، لا يزيد كل منها على 140 حرفًا، للمتطلبات
الأساسية. وإذا طلبت أن نتواصل معك أو حجزت اجتماعًا، فإننا نستلم الاسم ورقم
الواتساب — وعنوان البريد الإلكتروني إذا أعطيتنا واحدًا — أي ما اخترت مشاركته،
وللاجتماع نستلم الموعد وما إذا كان عبر الإنترنت أو في الاستوديو، وما كتبته عن
الموضوع الذي تريد مناقشته. ونحفظ أيضًا صيغة مشفّرة في اتجاه واحد من عنوان
شبكتك، للحد من عدد مرات استخدام الخدمة من مكان واحد.

**ما لا نستلمه أبدًا.** محادثتك مع المساعد. فنحن لا نستلم المحادثة، ولا نصها،
ولا ملخصًا لها، ولا تعليمات مساعدك، ولا حسابك هناك، ولا أي شيء آخر لم تضعه في
المشروع أو في الحجز. ولا تحتوي أدواتنا على أي حقل للمحادثة، ويُرفض كل ما يتجاوز
الحدود المذكورة أعلاه.

**إذا ربطت حسابك.** يمكنك تسجيل الدخول إلى حسابك في Gestaltung360 من المساعد
الذكي. يتم تسجيل الدخول وشاشة الموافقة على موقعنا نفسه، ولا تظهر كلمة المرور
للمساعد أبدًا، ويمكنك سحب الموافقة في أي وقت. وأثناء الربط يستطيع المساعد حفظ
مشروع في حسابك، وإضافة قطع إلى سلتك، وحجز اجتماع بالاسم والرقم الموجودين في
حسابك. ولا يمكنه تنفيذ طلب شراء، ولا الدفع، ولا الوصول إلى أي شيء خارج مشاريعك
وسلتك وحجوزاتك. ولست مضطرًا لربط حسابك: كل شيء ما عدا السلة يعمل بدون حساب.

**لماذا نستخدمها.** لتسعير المنتج، ولشراء القطع وبيعها، ولتصنيعه، ولعقد
الاجتماع الذي حجزته، وللتواصل معك بشأن طلبك أنت.

**مدة الحفظ.** رابط المشروع الذي لا تفتحه تنتهي صلاحيته بعد 30 يومًا ويُحذف.
وبعد أن تفتحه يصبح المشروع ملكًا لحسابك، ونحفظه — مع الاجتماعات والطلبات — كما
نحفظ سجلات العملاء الأخرى، طوال المدة التي نحتاجها للعمل ولمتطلبات المحاسبة
والضرائب في قطر.

**خياراتك.** يمكنك أن تطلب منا حذف مشروع أو حجز أو بيانات التواصل الخاصة بك في
أي وقت بالكتابة إلى info@gestaltung360.com. ونحذف ما لا يُطلب منا الاحتفاظ به،
ونخبرك بما يجب علينا الاحتفاظ به وسببه.

---

## Notes for the owner (not part of the text)

- The 30-day figure matches the code: `plugin_handoffs.expires_at` is
  `now() + interval '30 days'` (migration 0112).
- The ten-quotes / 140-character limits match `lib/plugin/build-file.ts`, which
  rejects anything longer — so the paragraph is accurate, not aspirational.
- "a one-way hashed form of your network address" is `ip_hash`: sha256 of a
  salt plus the address, used only for the rate limits.
- If you change the retention period or the quote limits, change this paragraph
  in the same release.
