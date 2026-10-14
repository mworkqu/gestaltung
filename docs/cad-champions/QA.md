# CAD Champions QA

## Content and language QA

(Written by the content QA agent.)

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
