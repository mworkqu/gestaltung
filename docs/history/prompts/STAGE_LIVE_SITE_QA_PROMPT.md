# Live website QA — gestaltung360.com (end-to-end, recorded, with full report)

Copy everything below this line into a new Claude session that can drive a browser
(Claude Code on a computer with Playwright, or Claude with the Chrome / built-in browser).
All test details are filled in (section 3).

---

## 1. Your role

You are a senior QA engineer and UX reviewer. Test the LIVE website https://gestaltung360.com
the way real customers in Qatar would use it: create accounts, use every main feature, record
the screen, take screenshots, and write a complete, honest evaluation report with every
comment you have — good and bad. You are testing, not fixing: do not change any code.

About the business (so you know what "correct" looks like):
- Gestaltung for Trading and Services W.L.L, C.R. 236988, Rafal Tower, Lusail, Qatar.
- Three paths: **Shop parts** (electronics store, prices in QAR), **Get a part made**
  (upload a CAD file or ask for a drawing; an engineer quotes), **Plan a product** (the
  "Design Studio": AI turns an idea into parts list → wiring → enclosure → print files → code
  → request to make it).
- Fully bilingual: English and Arabic (RTL). Every page has `/en/...` and `/ar/...`.
- Payments: cash on delivery, Fawran, bank transfer. No card payments.
- Credits: the parts list is free; each wiring diagram or 3D model costs 1 credit (QAR 20).
  New accounts start with 0 credits (educational emails get a few free).

## 2. Ground rules — this is PRODUCTION (read before you click anything)

Everything you create is real and lands in the live database and the owner's inbox.

1. **Label everything as a test.** Names start with `TEST QA —`, every message/notes field
   includes `TEST — please ignore`, every project name starts with `TEST QA —`.
2. **Write limits:** no new accounts (use only the two in section 3), maximum 4 projects,
   maximum 1 order in total, maximum 1 contact-form message, 1 quote request, 1 drawing request.
3. **The one order:** payment method **Cash on delivery only**, total under QAR 150, customer
   name `TEST QA — please cancel`. Never choose Fawran or bank transfer, never pay anything,
   never enter card or bank details.
4. **Do not** message or call the WhatsApp number, do not open admin pages (`/dashboard`),
   do not try attacks, injections, load tests or scraping, do not try to bypass the bot check.
5. **AI usage is on a free daily quota:** at most 2 regenerations per step. If you hit a daily
   limit or "out of credits", that IS a result — screenshot the message and move on.
6. **Write down every ID** you create (project URL / id, order number, emails sent) — they go in
   the cleanup list at the end of the report.
7. If something blocks you for more than ~10 minutes, record it as a finding and continue
   with the next step or test. Never stop the whole run because of one failure.

## 3. Test details (already prepared by the owner — use exactly these)

- **Account A** (desktop, English, Tests 1, 2 and 4): `techshack.orders@gmail.com`
- **Account B** (phone, Arabic, Test 3): `techshack.orders+qa-b@gmail.com`
- **Both accounts already exist and are email-confirmed.** You never type a password and you
  do not create accounts. The owner signs in for you in the browser you use. Whenever a step
  needs a different account (or signing out and back in), stop and send the owner a message
  like: *"Please sign in to Account B (techshack.orders+qa-b@gmail.com) in the browser and tell
  me when done."* Then wait. Sign-up and password-reset forms are tested by the owner by hand,
  not by you — just look at those pages and judge them.
- **Inbox:** both addresses deliver to the Gmail mailbox `techshack.orders@gmail.com`
  (Gmail ignores the "+qa-b" part). If you have a Gmail connector signed in to that mailbox,
  read the confirmation / reset emails with a search like `newer_than:1d from:gestaltung360.com`.
  If you don't, stop and ask the owner in chat to open the email and paste the link. Read only
  the Gestaltung emails in that mailbox, nothing else.
- **Phone number for forms:** `+974 3366 4265` (the company's own WhatsApp line).
- **Test files** (in the project folder `qa/assets/`, also in the Drive folder below):
  - `qa/assets/test-bracket.stl` — a 40 × 30 × 28 mm L-bracket (STL)
  - `qa/assets/test-sketch.png` — a hand-drawing of a wall bracket with dimensions
- **Credits:** wiring and the 3D model need credits. Before Test 2, check the balance shown on
  `/en/pricing#credits` while signed in as Account A. If it is 0, ask the owner: *"Please grant
  5 wiring and 3 CAD credits to techshack.orders@gmail.com in Dashboard → AI credits."* Do Test 3
  while you wait. If credits never arrive, run Test 2 anyway and record the "out of credits"
  screens as findings.
- **Where to share the results:** Google Drive folder "Gestaltung QA — live site test results"
  https://drive.google.com/drive/folders/1iauRQle2tF_mGTS_lPyqaO4TAtqiX1JV

## 4. Recording and evidence

**Use the browser the owner signs you in to** (Claude in Chrome, or the built-in browser),
because a separate Playwright browser would not have the signed-in session. Record each test
with the browser's GIF/screen recorder (capture extra frames before and after each action) and
take a screenshot at every step. For the phone test, resize the window to 375 × 812.
If you also have Playwright, you may use it for the GUEST-only parts (store browsing, quote
upload, 404, empty cart) to get MP4 videos, with these settings:
- Desktop context: viewport 1366×768. Phone context: 375×812, `isMobile: true`, `hasTouch: true`.
- Turn on video for every test: `recordVideo: { dir: "qa/videos/T<n>", size: { width: 1366, height: 768 } }`
  (phone: 375×812). One video per test. Close the context at the end of each test so the file
  is saved. Convert to MP4 afterwards: `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4`.
- Also save a Playwright trace per test (`context.tracing.start({ screenshots: true, snapshots: true })`).
- Slow down actions a little (`slowMo: 250`) so the video is watchable.
- If you script with Playwright, still LOOK at each screenshot yourself and judge it.


**Screenshots:** one at every step, plus every error, empty state and email.
Name them `T<test>-S<step 2 digits>-<short-slug>-<en|ar>-<desktop|phone>.png`,
e.g. `T2-S07-wiring-pin-list-en-desktop.png`. Full-page where useful.

**On every page also collect:** browser console errors/warnings, failed network requests
(status ≥ 400, with URL), and a rough load time (time until the main content is usable).

Folder layout:
```
qa/
  videos/T1.mp4 T2.mp4 T3.mp4 (T4.mp4)
  screenshots/T1/... T2/... T3/...
  traces/
  emails/          (screenshots of every email received)
  REPORT.md        (and REPORT.html — see section 8)
```

## 5. Map of the site (so you cover everything)

Public: `/` home · `/store` (search, categories, filters, sort) · `/store/<sku>` product ·
`/store/cart` · `/store/checkout` · `/store/collections/<id>` · `/design` (Get a part made) ·
`/design/quote` (upload a file) · `/design/drawing` (drawing service) · `/projects/new`
(Plan a product) · `/projects/<id>/studio` (Design Studio) · `/projects` (My projects) ·
`/orders` (My orders) · `/pricing` (plans, credits, invite code) · `/how-it-works` · `/about` ·
`/contact` · `/trust` · `/students` · `/institutions` (+ printable proposal) ·
`/partners/schools` · `/partners/accelerators` · `/case-studies` · `/delivery-returns` ·
`/warranty` · `/terms` · `/privacy` · `/sign-up` · `/sign-in` · `/forgot-password` · a 404 page.
Studio steps: Idea → Parts → Wiring (tabs: Wiring · 3D · Schematic · Pin list; Build guide;
Try it) → Enclosure (pictures, Try another, Create my CAD) → Print → Code → Make ("Get it made").

## 6. The tests (do at least Tests 1–3; do Test 4 if you have time)

For every step write: step no., URL, what you did, what you expected, what happened,
PASS / FAIL / PARTIAL, screenshot file, comments.

### Test 1 — Shopper buys parts (desktop, English, starts as a guest)
1. Open `/en`. First impression: is it clear in 5 seconds what the company does? Screenshot.
2. Use the home search (type "arduino" slowly — check the instant suggestions), open results.
3. On `/store`: try a category, the delivery-time filter, sort, and paging. Try a search that
   returns nothing ("xyzzy") — judge the empty state.
4. Open 3 different products. Check: photo, price in QAR, "Arrives by" date, specifications,
   datasheet link, source line, "Frequently bought together / You may also need", Arabic link.
5. Add 2–3 cheap items to the cart (keep total under QAR 150). Change a quantity, remove one.
6. Cart: check totals, delivery cost (QAR 50 flat; free on Standard over QAR 300), final-price line.
7. Go to checkout as a guest → note what is asked (do not fill it in). Look at the sign-up
   page and judge it (do not submit). Then ask the owner to sign in to **Account A** and check
   the cart is still there after sign-in.
8. Checkout: delivery area, delivery tier dates, payment method cards. Choose **Cash on
   delivery**, name `TEST QA — please cancel`, place the order. Screenshot the success page.
9. Check the confirmation email (branding, language, prices match, order number, no raw codes).
10. Open `/en/orders` and the order detail: status timeline, WhatsApp help link (do not send).
11. Open the account menu: My orders, My projects, Dashboard link (should not show admin items).

### Test 2 — Founder plans a product in the Design Studio (desktop, English, Account A)
Idea to type: *"An automatic plant waterer for my balcony. It checks if the soil is dry and
waters the plant with a small pump. Powered by USB. I want a light that shows when the water
tank is empty."*
1. From the home page click the main call-to-action ("Start a project" / "Plan a product").
2. Idea step: tick consent, send the idea. Have at least 3 chat turns: answer a question, ask a
   question ("what does the pump need?"), and request a change ("make it battery powered").
   Judge: are replies relevant, short, honest; does the spec card update only when it should?
3. Parts step: open the part popovers (photo, price, stock), check grouped quantities,
   "We'll source this" lines, add-all-to-cart button and its total. Do NOT buy.
4. Wiring step: try all 4 tabs; click a wire and check the same wire highlights in every tab;
   tick pins in the Pin list; step through the Build guide; open "Try it" and move the soil
   slider — does the pump/LED react? Zoom/pan the drawing. If the wiring needs a credit and
   you have none, screenshot the message and judge how clear it is.
5. Enclosure step: wait for the pictures, read "Why this design", press "Try another" once,
   then "Create my CAD" (or record the credit message). Rotate the 3D model, "Take it apart".
6. Print step: printable parts list, grams. Download EVERY STL (each part and the combined
   plate) and any STEP file offered, save them in `qa/models/`, and evaluate them as in
   section 7b.
7. Code step: read the code, click a pin line → "Show in wiring".
8. Make / "Get it made": fill the request (notes: `TEST — please ignore`). Check the estimate
   and the confirmation screen; open the request page.
9. Close the tab, open the project again from My projects, refresh: is everything saved?
10. Rename nothing; note the project URL for cleanup.

### Test 3 — Arabic customer on a phone gets a part made (375 px, Arabic, guest → then Account B)
1. Open `/ar` on the phone viewport. Check RTL layout, fonts, Western digits for prices,
   no horizontal scrolling, tap targets big enough, header menu.
2. `/ar/design` → upload the test STL on the quote page: method "Not sure", contact details
   with an invalid Qatar phone first (e.g. 1234) — check the error — then a valid-format
   number the owner approves `+974 3366 4265`, notes `TEST — please ignore`. Submit once.
3. `/ar/design/drawing` → request a drawing: pick a size tier, attach the sketch, submit once.
4. Ask the owner to sign in to **Account B**. Switch the site to Arabic and check the account
   pages (My projects, My orders, account menu) in Arabic on the phone.
5. Look at `/ar/sign-in`, `/ar/sign-up` and `/ar/forgot-password` and judge the Arabic layout
   and wording (do not submit them).
6. Open `/ar/pricing`, `/ar/how-it-works`, `/ar/about`, `/ar/contact` (send ONE contact message
   marked `TEST — please ignore`), `/ar/trust`, one legal page. Check every Arabic string reads
   naturally, nothing is left in English by mistake, no clipped text.
7. Open a product page and the cart in Arabic on the phone.

### Test 4 — Edge cases and robustness (any account, desktop + phone)
- Ask the owner to sign out. Start a project as a GUEST, get to the Parts step, then ask the
  owner to sign in to Account A: is the guest work kept?
- Open `/en/store/checkout` with an empty cart (should send you to the cart).
- Open a made-up URL (`/en/this-does-not-exist`) — branded 404?
- Browser back/forward and refresh in the middle of the Studio and checkout.
- Very long text in the idea chat; emoji-only message; a message in Arabic on the English page.
- Slow network (Playwright: throttle or `route` with delay) on the home and store pages.
- Keyboard only: can you reach and use the header menu, search, add to cart, checkout?
- `/en/pricing?code=TESTCODE` — invite-code box behaviour with an invalid code.
- If you want to check educational credits, read /pricing#credits and /students and judge if the rule is clear (do not create a third account).

## 7. How to evaluate

Judge every page and step on these areas, score each 1–5 with a reason:
1. **Works correctly** — features do what they say; data saved; no errors.
2. **Clarity & ease** — would a first-time founder or student know what to do next?
3. **Copy & language** — English and Arabic: natural, consistent names for the three paths,
   no jargon, no typos, no untranslated text, correct RTL.
4. **Visual design** — consistent spacing, typography, alignment, no broken images/layout.
5. **Mobile** — 375 px works with no sideways scrolling, readable text, 44 px tap targets.
6. **Speed** — how long pages and AI steps take; does the user see progress while waiting?
7. **Accessibility basics** — keyboard, visible focus, alt text, contrast, labels on inputs.
8. **Trust & Qatar compliance** — company name and C.R. 236988 visible; every price in QAR;
   the product price = cart = checkout = email; delivery date shown before ordering; legal
   pages exist and are linked; no misleading claims (the site must NOT promise partner
   workshops, automatic manufacturing-method detection, reprints/remakes, or "free" things that
   are not free).
9. **Emails** — arrive within minutes, branded, right language, links work.
10. **AI quality** — parts make sense for the idea, wiring is safe and sensible, enclosure looks
   like the actual product, code matches the wiring.

Severity for each finding: **Blocker** (stops a customer) · **High** (wrong data, money, trust,
or a broken main feature) · **Medium** (confusing or partly broken) · **Low** · **Polish**.

## 7b. Evaluating the downloaded 3D files (STL / STEP)

The owner will look closely at these files, so check each one properly:
1. **Open it:** load each STL with Python (`pip install trimesh numpy-stl`) or any viewer you
   have. If a file will not open or is empty, that is a High finding.
2. **Measure it:** bounding box in mm (X × Y × Z), volume (cm³), estimated weight in PLA
   (volume × 1.24 g/cm³), triangle count. Compare the weight with the grams shown on the
   Print step and the outside size shown on the Enclosure step — note any mismatch.
3. **Check it can be printed:** watertight / manifold (`mesh.is_watertight`), no inverted
   normals, no loose pieces (`mesh.split()` count), fits the studio printer bed (Prusa MK4:
   250 × 210 × 220 mm), wall thickness looks at least ~1.2 mm, a flat face to sit on.
4. **Check it fits the product:** the case is big enough for the board and parts picked in the
   Parts step; lid and base match (same outline, lip fits); openings where the ports and
   sensors are; mounting points line up.
5. **Look at it:** render 4 views of each part (front, side, top, isometric) to PNG
   (`trimesh` scene or matplotlib) and put them in `qa/models/renders/` and in the report.
   Say in plain words whether it looks like the real product or just a box.
6. Put the results in a table: file, size (mm), volume, weight (yours vs site), watertight,
   pieces, fits bed, verdict, comments.
Also run the same checks on `qa/assets/test-bracket.stl` before uploading it (it should be a
watertight 40 × 30 × 28 mm L-bracket) so the owner knows the test file itself was valid.

## 8. The report

Write `qa/REPORT.md` and an HTML version with the screenshots embedded (`qa/REPORT.html`).
Structure:
1. **Summary** — overall verdict in 5 lines, overall score, the top 10 issues (ranked).
2. **Scorecard** — table of the 10 areas × score × one-line reason.
3. **Test runs** — for each test: goal, account, device, language, video link, duration, and the
   step table (step, URL, action, expected, actual, result, screenshot, comment).
4. **All findings** — table: ID (F-001…), severity, area, page/URL, steps to reproduce, expected,
   actual, screenshot + video timestamp (mm:ss), suggested fix, and an empty **Owner comment**
   column for the owner to fill in.
5. **What works well** — be specific; the owner needs to know what to keep.
6. **AI evaluation** — chat answers, parts, wiring, enclosure, code: quality and examples,
   plus the 3D-file table and renders from section 7b.
7. **Arabic review** — list of strings that read badly, with your suggested wording.
8. **Emails received** — table with time sent, subject, language, problems.
9. **Console and network errors** — per page.
10. **Ideas to improve conversion** — max 10, ordered by impact.
11. **Cleanup list** — every account, project id/URL, order number, quote/drawing/contact
    request you created, so the owner can delete them.
12. **Open questions** for the owner.

Comment on everything you notice, even small things — "all comments" means all of them.
Be honest: do not mark something PASS if you did not actually see it work.

## 9. Sharing

- If a Google Drive connector is available: create a folder `Gestaltung QA — <date>` at
  the Drive folder from section 3, upload `REPORT.html`, `REPORT.md`, all MP4 videos and the screenshots folder,
  and give the share link.
- Otherwise: zip the `qa/` folder (`qa-<date>.zip`) and deliver it, plus the report file and each
  MP4 separately so they can be opened on a phone.
- Final message: 5-line summary, the top 5 issues, and the links/files.

## 10. Owner review round

The owner will read the report and add comments (in the "Owner comment" column, in the Drive
document, or in chat). When the comments arrive:
1. Answer every comment by its finding ID (F-001…): agree, explain, or give more evidence.
2. Re-test anything the owner asks you to check again, with new screenshots/video.
3. Update the report as **version 2** (keep version 1), mark each finding Confirmed / Changed /
   Withdrawn, and upload it to the same Drive folder.
