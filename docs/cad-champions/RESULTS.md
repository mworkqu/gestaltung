# CAD Champions: scoring, results and reports (Prompt 7)

## Scoring (`lib/cad-champions/scoring/`)
| File | What |
|---|---|
| `config.ts` | Level thresholds (L1 0-19 … L6 90+), bands (Beginner 0-39, Developing 40-64, Competitive 65-84, Competition-ready 85+), fallback official weights 10/5/30/10/15/30, where unassessed areas are covered. |
| `core.ts` | Pure math, tested in `core.test.ts`. Aspect marking (COMPETITION_ALIGNMENT §D): measurement = full or zero (grader's `points_awarded` counts only when the aspect has a `partial_rule`); judgement = max × score / 3. A task without aspects uses its task-result score. Skill-area % per aspect's own area; overall % = official weights re-normalised over covered areas; module readiness per M1-M4; training path ranked by weight × (100 − %). |
| `server.ts` | `computeAttemptScores(attemptId)` (service role). Loads tasks, aspects, results, aspect results; writes `cc_skill_scores` for all 6 areas (`assessed=false` when uncovered); updates the attempt (`total_score`, `max_score`, `percent`, `band`, `status`, `graded_at`); sends the result emails once. Safe to call repeatedly. |
| `emails.ts` | "Your results are ready" / "Your final score is confirmed": bilingual (Arabic first), one button, plain text. Idempotent via `cc_attempts.results_email_sent_at` / `final_email_sent_at` (claimed before sending, released on failure). |
| `load.ts` | Results view model for the page, report and list (service role; the caller checks owner/staff). Also the free-preview lesson and the plan offer (empty until Prompts 9/10). |
| `radar.ts` | Skill-map geometry + static SVG markup (page, share page and report draw the same chart). |
| `report-html.ts` | The one-page report as self-contained HTML. |

### Attempt status written by computeAttemptScores
| Status | When |
|---|---|
| `grading` | An auto-checked (STEP) file still has a `pending` result. No email. |
| `provisional` | A trainer still has to confirm something: AI drawing check `ai_pending_review`, a manual / AI task still `pending` with a file, an unscored judgement aspect, or an `error` with `needs_manual_review`. "Results ready" email (provisional wording) and `provisional_percent` stored. |
| `graded` | Everything final. "Results ready" email if not sent yet; if a provisional email was sent earlier, "Final score confirmed" with the change. |
| `expired` | No file was uploaded for any task. No email. |

The results page also self-heals: when every task has a result row, nothing is left for the grader, but the attempt still says `submitted`/`grading`, it calls `computeAttemptScores` itself.

## Pages and routes
- `/results` — the student's finished attempts, newest first (empty state links to `/test`).
- `/results/[attemptId]` — owner or staff. States: still grading (polls `/api/cad-champions/attempts/[id]/status` every 5 s, refreshes when done), grading error ("We're checking a file manually"), expired with no files (+ retake date from `retake_cooldown_days`), in progress, full results. Marks `results_viewed_at` on the owner's first view of a finished result.
- `/results/share/[token]` — public, noindex. Only first name, band and the skill map, via `cc_shared_result(token)` (0081). Turning sharing off clears the token, so old links stop working.
- `/api/cad-champions/results/[attemptId]/report?lang=en|ar` — session-checked report download.
- Dashboard: "Your progress" card (`components/cad-champions/results/progress-card.tsx`) under the test / training / profile row.
- "Question this result" inserts `cc_lesson_questions` (`kind = 'grade_query'`) with the student's own RLS client; one open question per task result.

## Report PDF: known limitation
The route prints the HTML to PDF with headless Chromium **only when `playwright` can be loaded at runtime**. `playwright` (1.64, via `@playwright/test`) is a devDependency, so:
- **Local / dev** (`npm run dev` / `npm start` on a machine that ran `npx playwright install chromium`): a real A4 PDF, Arabic shaped by Chromium with IBM Plex Sans Arabic from Google Fonts.
- **Vercel production**: playwright is not deployed, so the route returns the same page as an `.html` download (Content-Disposition attachment) with a note and a "Print or save as PDF" button. The browser's print dialog shapes Arabic correctly.
- Set `CC_REPORT_PDF=off` to force the HTML fallback.

`[TODO-MO: choose a PDF renderer for Vercel — e.g. @sparticuz/chromium + puppeteer-core, or Browserless free tier]`. No heavy dependency was added on purpose.

## Migration 0081 (`supabase/migrations/0081_cc_results.sql`, RUN AFTER 0080)
Adds `cc_attempts.results_email_sent_at`, `final_email_sent_at`, `provisional_percent`, an index on shared tokens, and `cc_shared_result(text)` (SECURITY DEFINER, anon ok, shared and finished attempts only). Re-runnable. Before it runs: scoring and the results page work, but no result emails are sent (no way to stay idempotent) and the share page shows "This link is not active".

## Seed for checking
`node scripts/cc-seed-results.mjs <student email>` prints the plan (dry run). `--write` inserts three graded attempts (≈25 / 55 / 88 %), one provisional and one expired for that student on `diagnostic-v1`, with fake submission rows (no files), and logs the attempt ids in `docs/TEST_DATA_CLEANUP.md`. `.env.local` is production: only run `--write` with a test account, when the owner asks.
