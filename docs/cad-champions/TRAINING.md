# CAD Champions training (Prompt 9)

## Run order
`0083_cc_training_seed.sql` runs AFTER `0082_cc_drawing_rubric.sql`. Safe to re-run (fixed ids, parents looked up by slug). Re-running resets seeded titles, objectives, briefs and hints; it never touches video ids, downloads, attachments, `reference_data` or `solution_video_id`. If 0077 is ever re-run, run 0083 again (it narrows the `cc_lessons` column grants).

## Structure (COMPETITION_ALIGNMENT §C)
| Module slug | What | Levels |
|---|---|---|
| `orientation` | Module 0: How this training works, How the real competition works, How to study (notes written, free) | 0 |
| `foundations` | L1 extrude … L5 assemblies, L6 drawing fundamentals + 60-min mini-project (test `foundations-mini-project`) | 1-6 |
| `m1-fabrication` … `m4-reverse-engineering` | Competition-module tracks, titled lessons with objectives | 4-5 each |
| `mock-competitions` | Describes the 4 mocks; lists published `cc_tests` with `type = 'mock'` | 1 |

Every lesson and exercise has ONE `skill_area_id` and (where relevant) ONE `competition_module`.

## Unlock rules (`cc_levels.unlock_rule`)
- `{"type":"open"}` — always open.
- `{"type":"previous_level_passed","pass_mark":80}` — every exercise of the previous level passed at its pass mark (best score); a level without exercises needs all its lessons completed.
- A `cc_level_unlocks` row (admin) opens a level for one student.
- An exercise linked to a test (`test_id`) counts the best `cc_attempts.percent` of that test.

## Access (lib/cad-champions/training/access.ts, enforced on the server)
| Who | Can |
|---|---|
| Not enrolled | See the whole catalog; watch + read Orientation and free-preview lessons (Foundations L1); upload to free-sample exercises (Foundations L1) |
| Enrolled (`cc_has_active_enrollment`) or staff | Everything |

Checked in: the video route, lesson page (notes/downloads/video are read with the service role only after the check; students can no longer select those `cc_lessons` columns), `gradeExerciseAction`, `revealHintAction` (hint N only after N failed attempts), solution video (after a pass or 5 attempts), `askLessonQuestionAction`, lesson progress actions.

## Videos (Bunny Stream)
- Store the Bunny video GUID (or `youtube:<11-char id>`) in `cc_lessons.video_<inventor|fusion|solidworks|neutral>_<en|ar>` and `cc_exercises.solution_video_id`. Intro/Get Ready slots: `lib/cad-champions/videos/registry.ts`.
- `GET /api/cad-champions/video/<ref>` with `lesson:<slug>:<slot>`, `solution:<exercise-slug>` or `intro:<key>` returns `{ embedUrl, expires, provider }` after the access check.
- Signing scheme implemented [TODO-MO: verify against Bunny docs]: `expires = now + 7200`; `token = hex(SHA256(BUNNY_TOKEN_KEY + videoId + expires))`; `https://iframe.mediadelivery.net/embed/<BUNNY_LIBRARY_ID>/<videoId>?token=<token>&expires=<expires>`. Turn on "Embed view token authentication" for the library in Bunny.
- Video pick: neutral same language → neutral other language → track same language → track other language → Inventor same language → any (each fallback shows a note). The switcher saves `cc_profiles.track_software`.
- Player: progress ping every 15 s, complete at 90 %, "Mark as complete" fallback. Bunny speed: player.js has no standard speed method, we send `setPlaybackRate` and point to the player's own menu.

## Gamification
- XP on the first pass of an exercise: 10 at Level 1, +5 per level (`cc_student_xp`).
- Weekly streak: consecutive Qatar weeks (Monday start) with a completed lesson or an exercise upload.
- Badge per completed level (`cc_badges`), inline SVG. No public leaderboard.
- Certificate (`cc_certificates`, code `CC-XXXX-XXXX`) when every level of Foundations or an M1-M4 track is completed. `/training/certificates/<code>` (PDF locally with Playwright, printable HTML on Vercel) and public `/verify/<code>` (noindex, `cc_verify_certificate`).

## Weekly progress email
`app/api/cron/cc-weekly-progress/route.ts` (Bearer `CRON_SECRET`). Not in `vercel.json` (Hobby plan cron limits). When the plan allows, add to the `crons` array:

```json
{ "path": "/api/cron/cc-weekly-progress", "schedule": "0 6 * * 0" }
```

(Sunday 06:00 UTC = 09:00 Qatar.) Sends once per student per Qatar week, only to students who started training and kept `weekly_progress_email` on (Account page).

## Known gaps
- Drawing / manual exercises are saved "with a trainer"; the review queue (Prompt 8) covers test drawings, not exercise attempts, so trainers mark exercise drawings passed by hand (set `cc_exercise_attempts.passed`) until an exercise review screen exists.
- Exercise aspects (`cc_task_aspects.exercise_id`) are optional; without them the practice score comes from the grader.
