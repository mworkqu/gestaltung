# CAD Champions: launch checklist (owner)

Everything you must do by hand, in order. Tick a box when it is done. Technical detail for steps 2, 3 and 7 is in `DEPLOY.md`. Nothing here is done for you: accounts, keys and payments stay yours.

## 1. Accounts you need (create only the ones you want)

- [ ] Supabase: the existing site project (you already have it). Check which plan it is on (affects backups, see `DEPLOY.md` 2.3).
- [ ] Vercel: existing project (you already have it).
- [ ] Resend: existing (sends all emails).
- [ ] Google Cloud (project `gestaltung-cad`): needed for the STEP grader. Billing must be enabled for Cloud Run.
- [ ] Bunny Stream: needed for lesson videos. Paid per use; your decision.
- [ ] Anthropic console: optional, only for the AI drawing check. Paid per use; your decision. Without it every drawing goes to a trainer.
- [ ] Cloudflare (free): optional, Turnstile bot check (`docs/TURNSTILE.md`).
- [ ] SkipCash: NOT needed now. Card payments stay off. Skip.
- [ ] Sentry and an uptime checker: optional (`DEPLOY.md` 4.3 and 4.4).

## 2. Keys and settings in Vercel

- [ ] Add the variables from `DEPLOY.md` section 1 (at least rows 1 to 8: Supabase, Resend, `CRON_SECRET`, `GRADER_URL`, `GRADER_SECRET`).
- [ ] Set `CC_ALERT_EMAIL` to the inbox you read daily.
- [ ] Add the two CC cron lines to `vercel.json` (`DEPLOY.md` 4.1) and redeploy. Check your Vercel plan allows hourly crons; otherwise use the daily line or the free fallback.
- [ ] Deploy the grader on Cloud Run and test `/health` (`DEPLOY.md` 3).

## 3. Fawran and payment details

- [ ] Fill `FAWRAN_ALIAS`, `FAWRAN_IBAN`, `FAWRAN_ACCOUNT_NAME`, `FAWRAN_BANK_NAME` (and `FAWRAN_MOBILE` if you want it shown).
- [ ] Fill `CC_RECEIPT_CR_NUMBER` and the two receipt address lines, or confirm the fallback (C.R. 236988, Rafal Tower, Lusail) is right.
- [ ] Set the plans: price and days for "online" and "online-in-person" in `cc_plans` (the page shows "Price coming soon" and checkout is blocked until you do). See `docs/CONTENT_TODO.md` row 10-1 for the SQL.
- [ ] Add at least one open cohort for the in-person plan (Admin, or `cc_cohorts`); without one it cannot be checked out.
- [ ] Decide the refund policy wording (step 8) and the approval time you promise ("usually a few hours").

## 4. Bunny uploads (lesson videos)

- [ ] Create the Bunny Stream library; put `BUNNY_LIBRARY_ID` and `BUNNY_TOKEN_KEY` in Vercel.
- [ ] Turn on Embed view token authentication in the library's Security settings.
- [ ] Record and upload the videos (65 lessons, plus the Get Ready videos and exercise solution videos). Store each video's id in the lesson (`cc_lessons.video_<track>_<lang>`), or use the admin lesson editor.
- [ ] Open one lesson in English and in Arabic and confirm it plays.

## 5. Test content and files

- [ ] Write the four diagnostic task briefs, upload the task PDFs, the three given part files, and the answer STEP files with their reference data (rows 5-1 to 5-9 in `docs/CONTENT_TODO.md`).
- [ ] Storage: Supabase, Storage, Settings, upload limit at least 300 MB.
- [ ] Publish the free diagnostic test only after a full dry run (step 10).

## 6. Help article review

- [ ] Admin, Help: read all 32 articles, English and Arabic. Resolve the `[TODO-MO]` lines in them (studio computers, 48 hours, training contents, approval time, refunds, retention days, privacy summary, measuring-kit contents).
- [ ] Publish the articles you approve (unpublished articles show up in Admin, Content health).
- [ ] Admin, Content health: the list of open items should be empty or accepted.

## 7. Arabic review

- [ ] Run `npm run cc:strings:export` from the project folder. It writes `docs/cad-champions/strings.csv` (key, English, Arabic, page).
- [ ] Give the CSV to a native Arabic reader. They correct only the Arabic column.
- [ ] Put the corrected CSV back at `docs/cad-champions/strings.csv` and run `npm run cc:strings:import`.
- [ ] Run `npm run i18n:check` and look through the Arabic pages once on a phone (digits are Western 0 to 9, file names and emails stay left-to-right).

## 8. Policies approval

- [ ] Read the three drafts in `content/cad-champions/` (`privacy`, `terms`, `refunds`, English and Arabic) or on the pages `/cad-champions/en/privacy`, `/terms`, `/refunds`. They show a DRAFT banner until approved.
- [ ] Fill every `[TODO-MO]` in them (22 items: company legal name, effective date, governing law, retention periods, analytics tools, providers, AI provider wording and whether files train models, legal retention duties, prices, refund window and amounts, reply times). Have a lawyer read the limit-of-liability and the minors and guardian-consent parts.
- [ ] Approve them in Admin: policies approval flag `<<POLICY_KEY>>` (the final name and place are being set by the orchestrator; see the SECURITY policies section).
- [ ] Check the DRAFT banner disappears on all three pages in both languages.

## 9. Run migrations

- [ ] In Supabase SQL editor run `0077` to `0085` in order (`DEPLOY.md` 2.1), then any CC migration with a higher number.
- [ ] Check the five private buckets exist (`DEPLOY.md` 2.2) and backups are on (2.3).
- [ ] Auth email templates and SMTP sender (`DEPLOY.md` 2.4).

## 10. Pilot students

- [ ] Choose 3 to 5 pilot students (include one on a phone, one in Arabic, one who is a minor so guardian consent is exercised).
- [ ] Give each the sign-up link and ask them to do: sign up, Get Ready, the free test, one upload, and read the results.
- [ ] Watch the first run live: Admin, Operations, and the Vercel logs. Expect the alert emails (`DEPLOY.md` 4.2) to stay quiet.
- [ ] On the day of a scheduled test with many students, set the grader to min-instances 1 the day before and back to 0 after (`DEPLOY.md` 3).
- [ ] Collect feedback, fix, and re-run Lighthouse (`QA.md`, scores in the table there).

## 11. Smoke test from your phone (production URL)

- [ ] Open `https://gestaltung360.com/cad-champions` on your phone, mobile data, private tab.
- [ ] Switch to Arabic and back. Sign up with a real address, confirm the email, finish onboarding.
- [ ] Get Ready practice upload passes. Start the free test, upload a file, submit, open the results.
- [ ] Open a free lesson and play the video.
- [ ] Make a real Fawran checkout up to the proof upload with a tiny test plan price, approve it in Admin, check the training unlocks and the receipt email arrives. (Mark this payment as test data, step 13.)
- [ ] Check every page you opened for a visible `[TODO-MO]` placeholder.

## 12. Announcement

- [ ] Remove noindex when you want search engines to find the public pages (`DEPLOY.md` section 6) and submit the sitemap in Search Console.
- [ ] Write the announcement (WhatsApp, Instagram, the studio, schools). Keep the competition disclaimer: this is practice for the competition, not an official result.
- [ ] Post it only after steps 1 to 11 are ticked.

## 13. Test data cleanup (after all phases, once)

Rule: do not delete test rows one by one. Everything is logged in `docs/TEST_DATA_CLEANUP.md`, and you delete it all at once after launch testing is finished.

CC-relevant items already logged there:

- [ ] Test student `gestaltung.co+cctest1@gmail.com` ("Test Student CC", minor, guardian "Test Guardian"): delete in Supabase, Authentication, Users. This cascades to `cc_profiles`, `cc_journey_progress` and the rows below.
- [ ] Seeded results attempts (script `scripts/cc-seed-results.mjs`): five `cc_attempts` rows (weak, medium, strong, provisional, expired; ids in the cleanup file). Deleting them cascades to submissions, task results, aspect results and skill scores. The seed used fake file paths, so no storage files exist for them.
- [ ] Anything you create in the pilot and smoke test: test sign-ups, the test Fawran payment and its proof file in `cc-payment-proofs`, the receipt number, test attempts and their files in `cc-submissions`, any test coupon or cohort. Add each to `docs/TEST_DATA_CLEANUP.md` as you create it.
- [ ] After deleting rows, empty the matching files in the `cc-submissions` and `cc-payment-proofs` buckets (deleting database rows does not delete Storage files).
- [ ] Re-run the admin counts (students, payments, attempts) and confirm they match reality.

## Content still needed (`[TODO-MO]` items)

`docs/CONTENT_TODO.md` is the full list (90 `[TODO-MO]` mentions today). Open them by area; this is only the count and where to find it.

| Area | Open items | Where in `docs/CONTENT_TODO.md` |
|---|---|---|
| Landing, sign-up, account (brand, address, trainer name/bio/photos, years and student numbers, institution list, age rule, retention days, equipment list) | about 12 | first table, rows 1 to 4, 2C/2D, 3-1 to 3-6 |
| Get Ready (studio computers, SOLIDWORKS licence offer, screenshot, 9 videos to record) | 12 | rows 4-1 to 4-12 |
| Diagnostic test (task briefs, drawings, part files, answer files, points, rubric, 48 h) | 10 | rows 5-1 to 5-10 |
| Results (plan contents, reply time, PDF renderer, band meanings) | 4 | rows 7-1 to 7-4 |
| AI drawing check (price table, required items, rubric points, 48 h) | 4 | rows 8-1 to 8-4 |
| Training (65 lesson videos, notes, exercise briefs and files, hints and solutions, mini-project, durations, instrument photos, kit, schedule, qualifier score, cohorts, certificate wording) | 15 | rows 9-1 to 9-15 |
| Payments (plan price and days, includes, kit price, approval time, refund page, receipt details, SkipCash check, cohorts, reject reasons) | 9 | rows 10-1 to 10-9 |
| Help articles (0079 seed) | 10 | "Help articles" section |
| Admin (retention policy) | 1 | "Admin panel" section |
| Policies (privacy, terms, refunds) | 22 | "Policies" section |

Settings that are not placeholders (`WHATSAPP_NUMBER`, `SUPPORT_EMAIL`, `ANTHROPIC_API_KEY`, `BUNNY_*`, `FAWRAN_*`, `CC_RECEIPT_*`) are covered in steps 2 to 4.
