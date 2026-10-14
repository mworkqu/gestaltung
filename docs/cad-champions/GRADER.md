# STEP grader (Prompt 6)

The auto-grader is its own Python service in `/grader` (FastAPI + CadQuery), deployed to Google Cloud Run as `cad-grader`. Everything about it lives in `grader/README.md`:
- endpoints and JSON shapes (`/health`, `/grade`, `/reference`, `/grade-package`)
- every error code and its help slug
- how checks map to measurement aspects (all-or-nothing) and the practice score
- tests
- PowerShell deploy steps

## Env vars for the site (Step D, server-only)

| Name | Value |
|---|---|
| `GRADER_URL` | The Cloud Run URL printed by `gcloud run deploy cad-grader ...` (no trailing slash). |
| `GRADER_SECRET` | The same string stored in Secret Manager as `GRADER_SECRET`. Sent as header `X-Grader-Secret`. |

Neither may be `NEXT_PUBLIC_*`. Without them STEP tasks go to manual review (see below) and the practice upload does a header-only check.

## Site-side flow (Step D)

Code: `lib/cad-champions/grader/`.

| File | Job |
|---|---|
| `http.ts` | `callGrader(path, body)`: POST with `X-Grader-Secret`, 120 s timeout, one retry on a network error or 5xx (a timeout is not retried), zod-checked response. `graderConfigured()`. |
| `mapping.ts` | Pure. `check_key` of `cc_task_aspects` -> grader checks (`volume`/`area`/`inertia`/`solids` -> `volume`/`surface_area`/`principal_moments`/`solid_count_validity`; assembly: `inertia` -> `assembly_position`, `solids` -> `parts_count`, `volume`/`area` -> every `part:*`). Per-aspect pass/fail (all-or-nothing; practice keeps partial credit). `toStudentResult()` is the only student shape: score, max, passed, practice score, error code, feedback EN/AR, help slug, warnings, checks (name, passed, partial). No `measured`, no `details`. |
| `service.ts` | `gradeSubmissionNow({ submissionId` or `file: {bucket, path}, mode, task })`: 10-minute signed URL -> `/grade`. If the grader answers `E_DOWNLOAD_FAILED`, it signs a fresh URL and tries once more. Returns the student-safe result + aspect outcomes, and the raw response for the log. |
| `plan.ts` | Pure queue decisions (`planGrading`, `readyForScoring`, `mapLimit`, `selectPackageSteps`). |
| `queue.ts` | `enqueueGrading(attemptId)`. |
| `zip-extract.ts` | Reads one STEP entry out of a package ZIP (ranged reads + inflate). |
| `client.ts` | Practice upload (`gradeSubmission`). |

### enqueueGrading(attemptId)

Runs from Next `after()` in `finalizeAttempt` (`lib/cad-champions/test/server.ts`), so the submit returns at once. The attempt page and the status route allow 300 s (`maxDuration`).

1. Loads the attempt, test, tasks, aspects, submissions and existing results.
2. Per task (`planGrading`):
   - already `auto` / `final` / `ai_pending_review` -> skipped (calling it twice is safe; `pending` and `error` are graded again);
   - `auto_step` + file -> pending row, then graded;
   - `ai_drawing` + file -> `ai_pending_review` placeholder (Prompt 8);
   - `manual` -> `pending` (waiting for a trainer);
   - no file -> `auto`, 0 points, every auto aspect failed.
3. per_task: `/grade`, at most 4 at a time. module_package: the ZIP's STEP files (safe paths, max 40, each at most 50 MB) are copied to `cc-submissions/<user>/<attempt>/package-step/`, signed, and sent to `/grade-package` with each task's name patterns from `cc_tests.package_expectations`.
4. Writes `cc_task_results` (`auto`, `auto_score` = `final_score` = sum of aspect points, feedback, help slug, error code, student-safe `details`), `cc_aspect_results` (passed + points) and `cc_grading_logs` (kind `step`, duration, error, raw response incl. `details`: staff only).
5. When every task has a result (manual tasks may stay pending): `computeAttemptScores(attemptId)` from `lib/cad-champions/scoring/server` (Prompt 7) sets the scores and `graded` / `provisional`.

### Manual review fallback

A task gets `status = error`, `needs_manual_review = true` and `details.needs_manual_review = true` when:
- `GRADER_URL` / `GRADER_SECRET` are not set;
- the grader still fails after the retry (network, timeout, 5xx, a broken response);
- the grader cannot download the file twice (`E_DOWNLOAD_FAILED`);
- the task's `reference_data` is incomplete (it needs `volume_mm3`, `area_mm2` and `principal_moments_mm5`).

The student's "Your tasks" list then shows **Checking manually** and the note "We're checking this file manually - no action needed." The reason is in `cc_grading_logs.error`. A trainer scores the task, or an admin runs `enqueueGrading` again once the grader is back: it retries only the `pending` and `error` tasks.

Student file problems (`E_NOT_STEP`, `E_WRONG_UNITS`, `E_NO_FILE` in a package, ...) are NOT manual review: the task is `auto` with 0 points and the grader's feedback.

### Practice upload (Get Ready step 5)

`gradeSubmission()` first checks the stored file's header (empty / too large / not STEP). Then:
- grader configured and `practice-cube` has a complete `reference_data` -> real practice check (single solid, units, volume within 1 %);
- grader not configured -> header-only pass, as before;
- reference incomplete -> header-only pass with `referenceMissing: true`; the page adds "Basic check only ...". NOTE: the 0080 seed stores only `{"volume_mm3": 125000, "solids": 1}` for the cube, so the practice stays a basic check until the owner builds the full reference (`/reference` or `tools/make_reference.py` on the answer STEP).

## Notes for Step D

- Strip `details` from every response before anything reaches a student. It holds reference-relative data.
- Students see `checks[].passed`, `feedback_en` / `feedback_ar`, `help_slug` and `error_code`.
- `lib/cad-champions/grader/error-codes.ts` lists every grader code, including `E_NO_FILE` (package: no STEP for a task) and `E_DOWNLOAD_FAILED` (the signed URL could not be fetched; retried once, then manual review).
- `aspects` in the request maps grader checks (`volume`, `surface_area`, `principal_moments`, `solid_count_validity`, `part:<name>`, `parts_count`, `assembly_position`) to `cc_task_aspects` ids and points.
