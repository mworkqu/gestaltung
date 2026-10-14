# CAD Champions database

Schema: `supabase/migrations/0077_cc_core.sql`. Storage: `supabase/migrations/0078_cc_storage.sql`.
Row types: `lib/cad-champions/db/types.ts`. RLS tests: `lib/cad-champions/db/rls.test.ts`.

## Run order (owner, Supabase SQL editor)
1. `0077_cc_core.sql` (after 0076)
2. `0078_cc_storage.sql`
3. `0079_cc_help_articles_seed.sql` (Help Center articles)
4. `0080_cc_diagnostic_seed.sql` (tests `diagnostic-v1`, `diagnostic-timeout-check` (staff only), `practice-cube`, their tasks and marking aspects; raises `cc-submissions` to 300 MB and allows ZIP for module_package tests)

Both files are safe to re-run. The tests apply each file twice to prove it.

## Make yourself an admin
```sql
update public.cc_profiles set role = 'admin' where email = 'you@example.com';
```
Site super_admins (`public.profiles.role = 'super_admin'`) are CC admins automatically. Only a CC admin can change `role`.

## Tables
| Table | One line |
|---|---|
| `cc_profiles` | One row per CC user (id = auth user id): personal details, guardian consent, track software (inventor default, fusion, solidworks), locale, role. The app creates it at CC sign-up. |
| `cc_journey_progress` | Journey timestamps (profile → enrolled) for the dashboard "next step" card and the admin funnel. Created automatically with each profile. |
| `cc_get_ready_steps` | Get Ready steps a student has completed (`user_id` + `step_key`). |
| `cc_skill_areas` | The 6 skill areas with weights 10/5/30/10/15/30 and descriptions in EN + AR (seeded, id = code). |
| `cc_competition_modules` | The 4 competition modules M1-M4 (6/6/6/4 hours) with paraphrased summary, what is given and what to deliver, EN + AR (seeded, readable by anyone). |
| `cc_tests` | Tests (practice, diagnostic, exercise, mock, qualifier): time limit, cooldown, publish flag, `admin_only`, `upload_mode` (per_task / module_package) and `package_expectations`. |
| `cc_test_tasks` | Tasks of a test, tagged with skill area and competition module. Holds `reference_data`, `rubric`, `tolerances` (answers): staff only. |
| `cc_task_aspects` | Marking aspects of a task or an exercise: measurement (all-or-nothing unless `partial_rule`) or judgement (0-3), points, method, check key, hint. Staff only; students use the view. |
| `cc_attempts` | One test attempt: timer, status, scores, band, IP/user agent, share link, `in_person` flag, `session_id`, `phase_markers`. |
| `cc_submissions` | One uploaded file per attempt task, or one module package ZIP (`task_id` null) with its `package_manifest`. |
| `cc_task_results` | Grade per task: auto / AI / manual / final score, status, feedback EN + AR, student-safe details. |
| `cc_aspect_results` | Result per aspect: passed (measurement) or judgement score 0-3, points, feedback. Students read their own. |
| `cc_skill_scores` | Percent and level 1-6 per skill area per attempt. |
| `cc_grading_logs` | Grader and AI call log: duration, tokens, cost, raw response (staff only). |
| `cc_integrity_flags` | Quiet admin flags (same file hash, too fast). |
| `cc_help_articles` | Help Center articles EN + AR, with "Was this helpful?" counters. |
| `cc_help_searches` | Help searches, for "searched with no results" in admin. |
| `cc_courses` | Training course (empty until Prompt 9). |
| `cc_modules` | Modules, one per skill area plus orientation. |
| `cc_levels` | Levels 0-6 per module with goal and unlock rule. |
| `cc_lessons` | Lessons tagged with a competition module: objectives, video IDs per track (Inventor, Fusion, SOLIDWORKS, neutral) and language, notes, free preview flag. |
| `cc_exercises` | Exercises tagged with skill area and competition module: brief, grading mode, answers, hints, solution video (staff only; students use the view). |
| `cc_exercise_attempts` | Each exercise upload and its grade. |
| `cc_lesson_progress` | Video position and completion per lesson per student. |
| `cc_lesson_questions` | Lesson questions and grade queries, with the trainer's answer and a "show to everyone" flag. |
| `cc_level_unlocks` | Levels an admin unlocked by hand for a student. |
| `cc_certificates` | Module completion certificates with a verification code. |
| `cc_plans` | Training plans: price QAR, days, what is included, in-person flag. |
| `cc_coupons` | Coupon codes: percent or fixed, expiry, max uses, plans, institution (admin only). |
| `cc_cohorts` | In-person cohorts: dates, location, seats, status. |
| `cc_payments` | Payments (Fawran / SkipCash): amount, reference code, status, proof path, review, receipt number. |
| `cc_enrollments` | Training access: plan, cohort, start and end. |
| `cc_audit_log` | Who did what and when, before/after (admin only). |
| `cc_deletion_requests` | Account deletion requests and their status. |
| `cc_student_notes` | Private trainer notes about a student (staff only). |

Views: `cc_test_tasks_public`, `cc_exercises_public`, `cc_task_aspects_public` (no `partial_rule`). Sequence: `cc_receipt_number_seq`.

## Buckets (all private, served by signed URLs)
| Bucket | Path | Read | Write | Max |
|---|---|---|---|---|
| `cc-task-files` | free | signed-in users | admins | 50 MB |
| `cc-answer-files` | free | staff | admins | 50 MB |
| `cc-lesson-files` | free | signed-in users | admins | 50 MB |
| `cc-submissions` | `{user_id}/{attempt_id}/{task_id\|package}/{ts}_{name}` | owner + staff | owner inserts only (no overwrite/delete); admins all | 50 MB (300 MB after 0080, for the module_package ZIP; per-task files stay 50 MB in the app) |
| `cc-payment-proofs` | `{user_id}/{payment_id}/{ts}_{name}` | owner + admins | owner inserts; admins all | 10 MB |

Never put answer STEP files in `cc-task-files`: every signed-in user can read it. Use `cc-answer-files`.

## How RLS works
- Helpers (SECURITY DEFINER): `cc_current_role()`, `cc_is_staff()`, `cc_is_admin()`, `cc_is_minor(dob)`, `cc_has_active_enrollment(user)`.
- Students read their own rows. Staff (instructor + admin) read all student data. Admins write content (tests, tasks, lessons, plans, coupons, cohorts, help, skill areas).
- `cc_profiles`: a user inserts only their own row with role `student`. A trigger blocks non-admins from changing `role`, `get_ready_bypass`, `deletion_requested_at`, `created_at`. It also sets `is_minor` from `date_of_birth` and stamps `guardian_consent_at` with the server clock.
- **Answers are hidden.** Students get no rows from `cc_test_tasks` and `cc_exercises`. They read `cc_test_tasks_public` / `cc_exercises_public`, which leave out `reference_data`, `rubric`, `tolerances` (and for exercises the hints and solution video, exposed only as `hint_count` / `has_solution_video`). The views show only published content (staff see everything).
- **Server-written tables:** students can only read `cc_attempts`, `cc_submissions`, `cc_task_results`, `cc_aspect_results`, `cc_skill_scores`, `cc_exercise_attempts`, `cc_payments`, `cc_enrollments`, `cc_level_unlocks`, `cc_certificates` and `cc_journey_progress`. Server actions check auth and then write with the service role (`lib/supabase/service.ts`). This way timers, scores, payment status and journey dates cannot be forged.
- Students may write their own `cc_get_ready_steps`, `cc_lesson_progress`, new `cc_lesson_questions` (status open, private, no answer) and `cc_deletion_requests` (pending).
- Instructors may update `cc_task_results` / `cc_skill_scores` (finalize reviews), answer questions and add trainer notes.
- Anonymous visitors read `cc_skill_areas`, active `cc_competition_modules`, published `cc_help_articles` and active `cc_plans` only.
- Aspects: students read `cc_task_aspects_public` (aspects of published tests and exercises, without `partial_rule`). Admins write aspects. Students read their own `cc_aspect_results`; instructors score them.
- `cc_help_feedback(slug, helpful)` is service-role only; call it from a rate-limited server route.

## Notes for later prompts
- Prices are readable by anon through RLS. The "prices only after a submitted diagnostic" rule (Prompt 10) is an app rule.
- Lesson rows (notes included) are readable by every signed-in user. Prompt 9 must gate paid notes and videos on the server (`cc_has_active_enrollment`) or move notes behind a view.
- `cc_task_results.details` and `cc_exercise_attempts.details` must stay student-safe. Raw grader/AI output goes to `cc_grading_logs.response`.
- Seat counts per cohort and the `/verify/[code]` certificate lookup need RPCs (not built yet).

## Tests
`npx vitest run lib/cad-champions/db` boots PGlite (Postgres in WASM, in-process, no network), creates a small Supabase stub (roles, `auth.uid()`, `public.is_super_admin()`, storage tables, `storage.foldername()`), applies both migrations unchanged, and checks the policies as student A/B, an instructor, a CC admin, a site super_admin and anon.
