# CAD Champions: content to supply

Each `[TODO-MO: …]` placeholder below needs real content from Mo. Remove the line once the content is in.

| # | Placeholder | Where it shows | File | Added |
|---|---|---|---|---|
| 1 | `[TODO-MO: brand colors and logo]` | Header mark on every CC page; design tokens | `components/cad-champions/shell/cc-mark.tsx`, `lib/cad-champions/tokens.ts` | Prompt 1 |
| 2 | `[TODO-MO: full address / PO box]` | Footer of every CC page (the visible line under "Rafal Tower, Lusail, Qatar") | `messages/cad-champions/{en,ar}/shell.json` → `footer.addressTodo` | Prompt 1 |
| 3 | `[TODO-MO: privacy policy text]` | `/cad-champions/{en,ar}/privacy` (drafted in Prompt 12) | `messages/cad-champions/{en,ar}/pages.json` → `privacy.body` | Prompt 1 |
| 4 | `[TODO-MO: terms of use text]` | `/cad-champions/{en,ar}/terms` (drafted in Prompt 12) | `messages/cad-champions/{en,ar}/pages.json` → `terms.body` | Prompt 1 |
| 2D-1 | `[TODO-MO: training contents]` | Dashboard Training card, "What you get" bullet | `messages/cad-champions/{en,ar}/dashboard.json` → `training.bullets.one` | Prompt 2 |
| 2D-2 | `[TODO-MO: confirm the local Qatar rule]` | Tooltip on "Competition age-eligible until <year>" (birth year + 22) | `messages/cad-champions/{en,ar}/dashboard.json` → `eligibility.help` | Prompt 2 |
| 2C-1 | `[TODO-MO: confirm institution list]` | Sign-up "School or university" dropdown (`/cad-champions/{en,ar}/sign-up`): QU, HBKU, UDST (CNA-Q), Texas A&M Qatar, CMU-Q, Georgetown Q, Northwestern Q, VCUarts Q, Qatar Academy, "A secondary school", Other | `lib/cad-champions/auth/schema.ts` → `CC_INSTITUTIONS`; labels `messages/cad-champions/{en,ar}/auth.json` → `options.institution` | Prompt 2 |
| 2D-3 | `[TODO-MO: retention days]` | Account settings, delete-account text and confirm dialog | `messages/cad-champions/{en,ar}/account.json` → `deletion.retention`, `deletion.dialogBody` | Prompt 2 |
| 3-1 | `[TODO-MO: years of experience]`, `[TODO-MO: students trained]`, `[TODO-MO: third fact]` | Landing trust strip, under "By Gestaltung360…" (`/cad-champions/{en,ar}`) | `messages/cad-champions/{en,ar}/landing.json` → `trust.facts.one/two/three` | Prompt 3 |
| 3-2 | `[TODO-MO: trainer name]`, `[TODO-MO: trainer role]` | Landing "Your trainer and studio" card | `messages/cad-champions/{en,ar}/landing.json` → `studio.trainerName`, `studio.trainerRole` | Prompt 3 |
| 3-3 | `[TODO-MO: trainer bio]` | Landing "Your trainer and studio" card | `messages/cad-champions/{en,ar}/landing.json` → `studio.bio` | Prompt 3 |
| 3-4 | Trainer photo + studio photo (placeholder boxes "photo coming soon") | Landing "Your trainer and studio" | `app/[locale]/cad-champions/page.tsx` section 8 (replace the dashed boxes with next/image) | Prompt 3 |
| 3-5 | `[TODO-MO: confirm the local Qatar rule]` (age 22 or younger) | Landing FAQ "Who can take part?" | `messages/cad-champions/{en,ar}/landing.json` → `faq.items.eligibility.a` | Prompt 3 |
| 3-6 | Equipment list (3D printers, 3D scanner, CNC, laser cutter) taken from the plan: confirm the studio really has a 3D scanner | Landing "In the studio" list | `messages/cad-champions/{en,ar}/landing.json` → `studio.equipment.*` | Prompt 3 |
| 4-1 | `[TODO-MO: can students use studio computers?]` | Get Ready step 2 "Check your computer": alert shown when the profile says "no computer" (`/cad-champions/{en,ar}/get-ready`) | `messages/cad-champions/{en,ar}/get-ready.json` → `computer.noComputerText` | Prompt 4 |
| 4-2 | `[TODO-MO: confirm offer]` ("Contact us for help getting a SOLIDWORKS licence") | Get Ready step 3, SOLIDWORKS tab | `messages/cad-champions/{en,ar}/get-ready.json` → `software.solidworksOffer` | Prompt 4 |
| 4-3 | `[TODO-MO: screenshot of Settings > System > About]` | Get Ready step 2, illustration box under "How to find your RAM and Windows version" | `messages/cad-champions/{en,ar}/get-ready.json` → `computer.illustration`; box in `components/cad-champions/get-ready/step-computer.tsx` | Prompt 4 |
| 4-4 | `[TODO-MO: record video: What is the competition and what is this test?]` | Get Ready step 1 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `get_ready_welcome` (set provider + providerId) | Prompt 4 |
| 4-5 | `[TODO-MO: record video: Install Autodesk Inventor with a free education licence]` | Get Ready step 3, Inventor tab (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `install_inventor` (set provider + providerId) | Prompt 4 |
| 4-6 | `[TODO-MO: record video: Install Autodesk Fusion with a free education licence]` | Get Ready step 3, Fusion tab (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `install_fusion` (set provider + providerId) | Prompt 4 |
| 4-7 | `[TODO-MO: record video: Getting SOLIDWORKS as a student]` | Get Ready step 3, SOLIDWORKS tab (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `install_solidworks` (set provider + providerId) | Prompt 4 |
| 4-8 | `[TODO-MO: record video: Set your units to millimetres]` | Get Ready step 4, action 1 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_units_mm` (set provider + providerId) | Prompt 4 |
| 4-9 | `[TODO-MO: record video: Set the material and density]` | Get Ready step 4, action 2 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_material_density` (set provider + providerId) | Prompt 4 |
| 4-10 | `[TODO-MO: record video: Export a STEP file]` | Get Ready step 4, action 3 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_export_step` (set provider + providerId) | Prompt 4 |
| 4-11 | `[TODO-MO: record video: Export a drawing as PDF]` | Get Ready step 4, action 4 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_export_pdf` (set provider + providerId) | Prompt 4 |
| 4-12 | `[TODO-MO: record video: Find your exported files and upload them]` | Get Ready step 4, action 5 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_find_upload` (set provider + providerId) | Prompt 4 |
| 5-1 | `[TODO-MO: Task 1 brief - the plate to model and what to watch for.]` | Free test, task 1 brief (`/cad-champions/{en,ar}/test/diagnostic-v1/attempt`) | `supabase/migrations/0080_cc_diagnostic_seed.sql` → `cc_test_tasks` `cc080000-…-000000000101` `brief_en` / `brief_ar` (edit in the DB or the admin test builder, Prompt 11) | Prompt 5 |
| 5-2 | `[TODO-MO: Task 2 brief - the part with a hole, a pocket and fillets.]` | Free test, task 2 brief | `0080_cc_diagnostic_seed.sql` → task `…0102` brief | Prompt 5 |
| 5-3 | `[TODO-MO: Task 3 brief - how the three parts fit together.]` | Free test, task 3 brief | `0080_cc_diagnostic_seed.sql` → task `…0103` brief | Prompt 5 |
| 5-4 | `[TODO-MO: Task 4 brief - the detail drawing of part 2: sheet size, views, scale.]` | Free test, task 4 brief | `0080_cc_diagnostic_seed.sql` → task `…0104` brief | Prompt 5 |
| 5-5 | Drawing PDFs: upload `diagnostic-v1/task-1/plate-drawing.pdf` and `diagnostic-v1/task-2/part-drawing.pdf` | Free test, "Files for this task" (Open / Download) on tasks 1 and 2 | Supabase Storage bucket `cc-task-files` (paths are in the tasks' `attachments`) | Prompt 5 |
| 5-6 | The 3 given part files: upload `diagnostic-v1/task-3/part-1.step`, `part-2.step`, `part-3.step` | Free test, task 3 downloads | Bucket `cc-task-files` | Prompt 5 |
| 5-7 | Reference STEP files (answers) for tasks 1–3, and `reference_data` built from them (volume, area, inertia, solids) + `tolerances` | Grading of tasks 1–3 (Prompt 6) | Bucket `cc-answer-files` (never `cc-task-files`); `cc_test_tasks.reference_data` / `tolerances` (left `{}` / empty by 0080) | Prompt 5 |
| 5-8 | Points per task (default 25 each, 100 in total) and the aspect points (volume 10, area 5, inertia 7.5, solids 2.5; drawing rubric 21 measurement + 4 judgement) | Test intro summary table, results | `0080_cc_diagnostic_seed.sql` → `cc_test_tasks.max_points`, `cc_task_aspects.max_points` | Prompt 5 |
| 5-9 | Drawing rubric items for task 4 (8 measurement items from COMPETITION_ALIGNMENT §E + 2 judgement items): confirm which items apply to this drawing | Task 4 marking (Prompt 8) | `0080_cc_diagnostic_seed.sql` → aspects `…1401`–`…1410` | Prompt 5 |
| 5-10 | `[TODO-MO: confirm 48h]` (trainer confirms drawings within 48 hours) | "Test submitted" screen, What happens next (`/cad-champions/{en,ar}/test/<slug>/attempt` after submitting) | `messages/cad-champions/{en,ar}/test.json` → `submitted.next2` | Prompt 5 |
| 7-1 | `[TODO-MO: plan contents/price]` | Results page, "Join the training" offer block, shown until an active `cc_plans` row exists (Prompt 10) (`/cad-champions/{en,ar}/results/<attemptId>`) | `messages/cad-champions/{en,ar}/results.json` → `path.offer.todoPlan` | Prompt 7 |
| 7-2 | `[TODO-MO: confirm "We'll reply by email within 2 working days"]` (grade query reply time) | Results page, "Question this result" success text + toast | `messages/cad-champions/{en,ar}/results.json` → `tasks.ask.sent`, `tasks.ask.already`, `tasks.ask.toast` | Prompt 7 |
| 7-3 | `[TODO-MO: choose a PDF renderer for Vercel — e.g. @sparticuz/chromium + puppeteer-core, or Browserless free tier]` (production serves the report as printable HTML) | Results page "Download my report" | `app/api/cad-champions/results/[attemptId]/report/route.ts`, `docs/cad-champions/RESULTS.md` | Prompt 7 |
| 7-4 | Band meanings and "where unassessed areas are covered" lines (written by Claude; confirm the wording, e.g. "Reverse engineering is assessed in person at the studio") | Results page header + skill map | `messages/cad-champions/{en,ar}/results.json` → `band.*.meaning`, `skillMap.coverage.*` | Prompt 7 |

## Prompt 8: AI drawing check and review
| # | Placeholder | Page | File | Prompt |
|---|---|---|---|---|
| 8-1 | [TODO-MO: confirm prices] Anthropic price table used for the AI cost estimate (USD per million tokens) | Admin AI cost (cc_grading_logs.cost_estimate) | `lib/cad-champions/drawing/ai-prices.ts` | Prompt 8 |
| 8-2 | [TODO-MO: confirm which "where required" items apply to the diagnostic drawing (limits and fits, surface texture, GD&T)] Until set, the AI answers "unclear" when they are absent and the trainer decides | Review screen, results checklist | rubric item `required` in `cc_test_tasks.rubric` (task 0104, migration 0082) | Prompt 8 |
| 8-3 | [TODO-MO: confirm rubric points] Default part rubric: 25 points, judgement 2 points (8%) | Review screen, results | `lib/cad-champions/drawing/rubric.ts`, migration 0082 | Prompt 8 |
| 8-4 | [TODO-MO: confirm 48h] "A trainer will confirm and check your dimensions within 48 hours." | Results task card (drawing) | `messages/cad-champions/{en,ar}/review.json` → `student.checklistHelp` | Prompt 8 |

## Settings to provide (not placeholders)
- `ANTHROPIC_API_KEY` (and optional `ANTHROPIC_MODEL`, default claude-sonnet-5-5): turns on the AI drawing check and comment translation. Without it every drawing goes straight to trainer review with the reason "AI check off".
- `WHATSAPP_NUMBER`: digits only, for example 974XXXXXXXX. Until it is set, the "Need help?" sheet falls back to `NEXT_PUBLIC_WHATSAPP_NUMBER`. If neither is set, the WhatsApp row is hidden.
- `SUPPORT_EMAIL`: defaults to info@gestaltung360.com.

## Help articles (0079 seed)
- Help articles: [TODO-MO: confirm studio computer access] in i-only-have-a-mac
- Help articles: [TODO-MO: can students use studio computers?] in i-dont-have-a-computer
- Help articles: [TODO-MO: confirm 48h] in how-grading-works
- Help articles: [TODO-MO: confirm 48h] in why-is-my-score-provisional
- Help articles: [TODO-MO: training contents] in whats-included-in-the-training
- Help articles: [TODO-MO: confirm approval time and working hours] in how-long-until-payment-is-approved
- Help articles: [TODO-MO: refund policy - eligibility window, conditions, how the refund is paid, and who to contact] in refunds
- Help articles: [TODO-MO: retention days] in deleting-my-account
- Help articles: [TODO-MO: privacy policy - review this summary against the full privacy policy] in privacy
- Help articles: [TODO-MO: kit contents and price] in allowed-measuring-instruments

## Storage setting (Prompt 5)
- Supabase → Storage → Settings → global upload file size limit must be at least 300 MB for module_package ZIP uploads (migration 0080 raises the `cc-submissions` bucket to 300 MB; the project limit caps it).
