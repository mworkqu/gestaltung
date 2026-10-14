# CAD Champions QA

## Content and language QA

Static review, 2026-10-14 (code, message files and migrations read; no browser run).

### 1. Strings export and import

- `npm run cc:strings:export` writes `docs/cad-champions/strings.csv` (columns `key,en,ar,file,used_in`; key = `<message file>.<dotted path>`, for example `get-ready.welcome.title`; RFC 4180 quoting; UTF-8 with BOM for Excel). Last run: 4,347 rows from 19 message files. `used_in` lists the first 3 CC source files that contain the key as a quoted literal (best effort; keys built from template strings show empty).
- `npm run cc:strings:import [file.csv] [--dry-run]` updates only changed values in `messages/cad-champions/{en,ar}/*.json` (key order kept, 2-space JSON, original CRLF or LF kept), refuses unknown keys and emptied values, then checks en/ar key parity and ICU `{placeholder}` parity. Any problem prints the list, writes nothing and exits 1. Tested: no-change dry run (0 changes), one edited value (1 change), unknown key (refused).
- A file with hand-formatted one-line objects (for example `ar/review.json`) is reformatted to plain 2-space JSON the first time the import changes it.

### 2. Visible `[TODO-MO` placeholders

Message files (the same text exists in `en` and `ar`; the Arabic copies keep the English tag inside the Arabic sentence). Each is also tracked in `docs/CONTENT_TODO.md`.

| File | Key (under the file's top-level section) | Visible on |
|---|---|---|
| account.json | `deletion.retention`, `deletion.dialogBody` ("retention days") | /account, delete-account section and dialog |
| dashboard.json | `training.bullets.one` ("training contents") | /dashboard, training card |
| dashboard.json | eligibility `help` ("confirm the local selection rule") | /dashboard, eligibility help tip |
| get-ready.json | `computer.findSpecs.illustration` (screenshot of Settings > System > About) | /get-ready, computer step |
| get-ready.json | `noComputerText` ("can students use studio computers") | /get-ready, computer step |
| get-ready.json | `software.autodesk.solidworksOffer` ("confirm offer") | /get-ready, software step |
| landing.json | `stats.one/two/three` (years of experience, students trained, third fact) | /, stats strip |
| landing.json | `trainerName`, `trainerRole`, `bio` | /, trainer section |
| landing.json | FAQ answer on age and local rules ("confirm ...") | /, FAQ |
| pages.json | `privacy.body`, `terms.body` | /privacy, /terms (another agent owns these pages) |
| payments.json | `faq.pending.a2`, `faq.pending.refundLink` | FAQ on /training/join and /account/payments |
| payments.json | `checkout.noCohorts.confirmBody` | /training/join/checkout after proof upload |
| payments.json | `statusPage.errors.proof` | payment status page |
| results.json | `path.offer.todoPlan` ("plan contents/price") | /results/[attemptId], next-steps offer |
| shell.json | `footer.addressTodo` (full address / PO box) | footer of every CC page |
| test.json | `submitted.reason.next2` ("confirm 48h") | test hand-in screen |
| training.json | `instruments.kitText` ("kit contents and price") | /training/instruments |
| training.json | `inPerson.schedule`, `inPerson.qualify` | /training/in-person |
| training.json | `join.plans` | /training/join |
| admin.json | `retentionTodo` | staff only, /admin/operations/deletions |

20 distinct rows above (27 English values counting the dialog and FAQ repeats; each mirrored in Arabic). `admin.json` lines 276, 316 and 320 only mention the word "TODO-MO" in help text; they are not placeholders.

Database seeds (shown through help articles, the diagnostic test and training pages once the migration is run): `0079_cc_help_articles_seed.sql` 21 tags, 10 distinct (articles i-only-have-a-mac, i-dont-have-a-computer, how-grading-works, why-is-my-score-provisional, whats-included-in-the-training, how-long-until-payment-is-approved, refunds, deleting-my-account, privacy, allowed-measuring-instruments); `0080_cc_diagnostic_seed.sql` 10 tags, 6 distinct (task briefs 1 to 4 on /test/[slug] and the points line); `0083_cc_training_seed.sql` 41 tags, 8 distinct (drawings, size tables, part files and one record-video marker in lessons and exercises under /training); `0084_cc_payments.sql` 5 tags, 3 distinct (plan price and days, kit contents); `0085_cc_admin.sql` 1 tag (retention policy, staff only).

Code comments with `[TODO-MO` (not visible to users): in-person and instruments page headers, cc-mark.tsx, tokens.ts, deletion.ts, ai-prices.ts, skipcash.ts, eligibility.ts, bunny.ts, receipts.ts, auth/schema.ts (institution list).

### 3. Explanation standard, page by page

Legend: ok = present, gap = missing, fixed = added in this pass, n/a = not applicable. Header = PageHeader with a purpose sentence. Help = HelpTip or Term on technical terms. Empty = empty state for lists. Loading = loading.tsx or Suspense skeleton. Error = friendly error state (the shared `error.tsx` catches the rest and never shows the raw message). Confirm = ConfirmDialog on irreversible actions. Need help = NeedHelpButton: it is not global; each signed-in page renders `SignedInExtras`, and the admin layout renders it once for all /admin pages.

| Route | Header | Help | Empty | Loading | Error | Confirm | Need help |
|---|---|---|---|---|---|---|---|
| / (landing) | n/a (hero) | ok | n/a | n/a (static) | ok | n/a | n/a (public) |
| /sign-in, /sign-up, /forgot-password, /reset-password, /check-email | ok | ok (sign-up), else n/a | n/a | n/a (button spinners) | ok | n/a | n/a (public) |
| /onboarding | ok | ok | n/a | n/a (client wizard) | ok | n/a | n/a (wizard) |
| /dashboard | ok | ok | ok | fixed (new loading.tsx, plus Suspense cards) | ok | n/a | ok |
| /get-ready | ok | ok | n/a | ok | ok | n/a | ok |
| /test, /test/[slug], /test/[slug]/attempt | ok | ok | ok | ok | ok | ok (submit) | ok |
| /results | ok | fixed (status HelpTip) | ok | fixed (new loading.tsx) | ok | n/a | ok |
| /results/[attemptId] | ok | ok | ok | fixed (inherits results/loading.tsx) | ok | n/a | ok |
| /results/share/[token] | ok | n/a (public, read-only) | ok | n/a | ok | n/a | n/a (public) |
| /training, /training/[module], /training/lessons/[slug], /training/exercises/[slug] | ok | ok | ok | ok (training/loading.tsx) | ok | n/a | ok |
| /training/instruments | ok | ok | ok | ok | ok | n/a | ok |
| /training/in-person | ok | fixed (HelpTip on "Module 4 conditions") | ok | ok | ok | n/a | ok |
| /training/certificates/[code] | ok | n/a | ok | ok | ok | n/a | ok |
| /verify/[code] | ok | n/a | ok | n/a | ok | n/a | n/a (public) |
| /training/join, /training/join/checkout, /training/join/return | ok | ok (return: n/a) | ok | ok | ok | ok (Fawran submit, checkout) | ok |
| /account, /account/payments, /account/payments/[id] | ok | n/a (settings) | ok | ok (account/loading.tsx) | ok | ok (delete account, in account-forms.tsx) | ok |
| /help, /help/[slug] | ok (list), own article header | n/a | ok | fixed (new help/loading.tsx) | ok | n/a | ok |
| /privacy, /terms | not touched (policies agent) | | | | | | |
| /admin home and every /admin/* page | ok | ok | ok on list pages, n/a on forms | fixed (new admin/loading.tsx fallback; 8 pages already had their own) | ok | ok (delete, publish, approve, reject use ConfirmDialog) | ok (admin layout) |
| /admin/review/[taskResultId] | ok | ok | n/a | fixed (admin fallback) | ok | fixed (Finalize now asks first) | ok |
| [...rest] (404) | n/a | n/a | n/a | n/a | ok (friendly not-found) | n/a | n/a |
| dev/ui, e2e-fixtures | skipped | | | | | | |

Fixed in this pass (CC folders only):
- New skeleton pages `dashboard/loading.tsx`, `results/loading.tsx`, `help/loading.tsx`, `admin/loading.tsx` (existing `SkeletonCard`).
- `/results` header gets a HelpTip explaining Provisional vs Final (`results.list.helpLabel/help`, en+ar).
- `/training/in-person` gets a HelpTip on Module 4 (`training.inPerson.m4HelpLabel/m4Help`, en+ar).
- Staff "Finalize" in the review workspace now opens a ConfirmDialog first, also for the Enter shortcut (`review.finalize.confirmTitle/confirmBody`, en+ar).

Open, minor, left as they are: public marketing pages have no HelpTip by design; auth forms have no skeleton; admin lists are not paginated (small data at launch).

### 4. Error codes

- Grader (`lib/cad-champions/grader/error-codes.ts`): all 11 codes (E_NOT_STEP, E_EMPTY, E_PARSE_FAILED, E_MULTIPLE_SOLIDS, E_NO_SOLID, E_WRONG_UNITS, E_INVALID_GEOMETRY, E_TOO_LARGE, E_TIMEOUT, E_NO_FILE, E_DOWNLOAD_FAILED) have English and Arabic text saying what happened and what to do, plus a help slug (`my-file-was-rejected`, `set-units-to-mm`, `my-file-is-too-large`, `results-folder-structure`). All four slugs exist in the 0079 seed. Unknown codes fall back to a generic bilingual message. Nothing to add.
- Upload validation (`upload/validate.ts`): wrong_extension (with and without an extension), too_large, empty, not_step, interrupted, failed, signed_out and the server check error all have en and ar in `upload.errors`. Help links show for too_large, not_step, empty and wrong_extension. interrupted, failed, signed_out and server have no link by design (the message already says what to do).
- Package check (`package-check.ts`, `zip-manifest.ts`): warnings missing_folder, wrong_type, no_step, missing_file, outside_results and errors unsafe_path, too_many_files, too_large, empty, unreadable, not_zip all have en and ar in `test.package.*`. Checked by script across both locales: nothing missing.

### 5. RTL pass

- Directional icons: every ArrowRight, ArrowLeft, Chevron and ExternalLink in the CC folders already had `rtl:-scale-x-100` except two `ExternalLink` icons in `review/question-card.tsx` and `review/review-workspace.tsx` (fixed). Literal "→" characters in `test/package-panel.tsx` and `admin/operations/audit/page.tsx` are now mirrored the same way (fixed).
- Numbers, emails, codes, file names: already wrapped in `<Ltr>` almost everywhere (emails, file names, reference codes, certificate codes, receipt numbers). Fixed the clear leftovers: percent values in the admin students table (two cells) and the review zoom indicator, and the QAR amount in the admin student payment list. Plain counts without a unit are left alone: Western digits alone read correctly in RTL.
- Stepper (`ui/stepper.tsx`): flex with logical order, so it mirrors by itself (step 1 on the right). OK.
- Skill-map radar: intentionally drawn left-to-right in both languages (the SVG forces `direction: ltr`; Arabic labels still shape correctly; the same numbers are in a table below it). Bar chart: bars grow from the start edge, the SVG is flipped in RTL and labels are HTML. OK.
- Printable documents: the results report (`scoring/report-html.ts`) and certificate (`training/certificate.ts`) output `<html lang=... dir="rtl">` for Arabic. The receipt is bilingual, with `dir="rtl" lang="ar"` on every Arabic block and `<bdi dir="ltr">` around numbers and codes. All three are already covered by tests (`scoring/render.test.ts`, `training/training.test.ts`, `payments/render.test.ts`), so no new test was added.

### 6. Checks run

`npx tsc --noEmit -p .` clean, `npm run lint` (including the RTL check) clean, `npm run i18n:check` OK (4,347 keys), `npx vitest run lib/cad-champions` 85 files passed.

## Accessibility and performance

Static review, 2026-10-14. No browser or screen reader was run: everything below is from reading the code. The owner runs the Lighthouse commands at the end on the live site.

### What was checked and what was fixed

| Area | Finding | Status |
|---|---|---|
| Test timer (`components/cad-champions/test/workspace.tsx`) | The clock had `aria-live="assertive"` during the last minute, so a screen reader would announce every second. | Fixed: `aria-live="off"` at every level, and the element now has an accessible name (`aria-labelledby` the "Time left" label). The 15-minute, 5-minute and 1-minute warnings are `Alert`s (`role="status"`, `role="alert"` for the 1-minute one), so they are announced once each when they appear. |
| Task list (same file) | `role="tablist"` sat on a `<ul>` whose `<li>` children had no role (invalid ARIA structure), every tab was in the tab order, and arrow keys did nothing. | Fixed: `<li role="presentation">`, roving `tabIndex` (selected tab 0, others -1), Arrow keys / Home / End move between tasks (left/right flipped in Arabic). Tab then moves into the task panel. |
| Keyboard order of the test workspace | Order is: sticky bar (timer help, save state, Submit, Preview), warnings, task list (one stop), then the active task panel (brief, download links, upload button, status). The hidden panels use the `hidden` attribute, so they are skipped. The upload "Choose a file" `Button` is a real button; the `<input type="file">` is `sr-only` with `tabIndex=-1` so it is not a second stop. | OK |
| Upload box (`components/cad-champions/upload/upload-box.tsx`) | The drop zone is mouse-only by nature; the keyboard path is the "Choose a file" button, which opens the file picker. The input is labelled (`aria-labelledby`), the zone points to the accepted-types line (`aria-describedby`), progress is a `role="progressbar"` with value and name inside an `aria-live="polite"` block, errors are `role="alert"`. | OK |
| Skill map (`results/radar-chart.tsx`) | SVG has `role="img"` + `aria-label`, and the results page renders a full `<table>` (with `<caption>`) of the same numbers right under it. | OK |
| Progress chart (`results/progress-card.tsx`) | SVG `role="img"` + `aria-label`, plus an `sr-only` list of the points. | OK |
| Admin bar chart, split meter, training ring (`admin/bar-chart.tsx`, `admin/tests/split-meter.tsx`, `training/visuals.tsx`) | Each is `role="img"` with a label that carries the numbers, or the numbers are in a list beside it. | OK |
| Grading poller (`results/grading-poller.tsx`) | Status list is `aria-live="polite"`; spinner icon is `aria-hidden`. | OK |
| Motion | Pulse and spin animations use `motion-safe:` / `motion-reduce:`; the 3D hero only loads when there is no reduced-motion, no Save-Data, not 2G, 4 GB+ memory and WebGL (`landing/hero-visual.tsx`). | OK |

### Not changed, for the owner to know

- The task list uses the tabs pattern. A screen reader says "tab, 2 of 4"; this is intended. If real users find it confusing, the simpler alternative is a plain list of buttons with `aria-current`.
- Colour contrast was not measured. Run the Lighthouse accessibility audit below and read the "Contrast" lines.
- The pulsing red ring on the sticky bar in the last minute is decorative and stops under reduced motion.

### Performance notes (static)

- The 3D landing scene is a separate chunk loaded only on capable devices (see above); the rest of the landing is server-rendered.
- Content images use `<img loading="lazy">` only in help articles and the admin proof viewer (admin only). No large `/public` images belong to CC (see the "keep /public lean" rule).
- The attempt status route allows 300 s (`maxDuration`) because it can trigger grading; it is not on the page load path.
- Expect the signed-in pages to be slower than the landing (database reads on each request). If Lighthouse performance is under 90 on the test workspace, the usual causes are the number of task panels rendered at once and the font loading; check "Reduce unused JavaScript" first.

### Lighthouse commands for the owner

Target 90 or more in performance, accessibility and SEO on every page below, mobile first. Run each in English and Arabic (change `en` to `ar`). Replace the output name per page.

Public pages (can be run from the command line):

```powershell
npx lighthouse https://gestaltung360.com/cad-champions/en --only-categories=performance,accessibility,seo --form-factor=mobile --output=html --output-path=./lh-landing-en.html
npx lighthouse https://gestaltung360.com/cad-champions/ar --only-categories=performance,accessibility,seo --form-factor=mobile --output=html --output-path=./lh-landing-ar.html
npx lighthouse https://gestaltung360.com/cad-champions/en/get-ready --only-categories=performance,accessibility,seo --form-factor=mobile --output=html --output-path=./lh-getready-en.html
npx lighthouse https://gestaltung360.com/cad-champions/en/training --only-categories=performance,accessibility,seo --form-factor=mobile --output=html --output-path=./lh-training-en.html
```

Signed-in pages (test workspace `/cad-champions/en/test/<slug>/attempt`, results `/cad-champions/en/results/<attemptId>`, and the training lesson pages) cannot be reached by the command-line tool because it has no session. Use Chrome instead:

1. Sign in as a test student in Chrome (use the pilot or test account).
2. Open the page, press F12, open the **Lighthouse** tab.
3. Choose Mobile, tick Performance, Accessibility and SEO, press **Analyze page load**.
4. Repeat after switching the language with the switcher in the header.

The test workspace only exists while an attempt is running. Start a test, run Lighthouse in the first minutes, and note the attempt for the test-data cleanup (`docs/TEST_DATA_CLEANUP.md`).

SEO will be penalised by `noindex` until launch: every CC page sends `X-Robots-Tag: noindex, nofollow` and a robots meta tag, and Lighthouse reports "Page is blocked from indexing". Ignore that one line (it lowers the SEO score on its own). After the noindex removal (see `DEPLOY.md`) re-run and expect 90+.

Record the scores in the table below.

| Page | Language | Perf | A11y | SEO | Notes |
|---|---|---|---|---|---|
| Landing | en | | | | |
| Landing | ar | | | | |
| Get ready | en / ar | | | | |
| Test workspace | en / ar | | | | |
| Results | en / ar | | | | |
| Training | en / ar | | | | |
