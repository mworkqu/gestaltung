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

Neither may be `NEXT_PUBLIC_*`. Without them the site should show the "we're checking this file manually" state.

## Notes for Step D

- Strip `details` from every response before anything reaches a student. It holds reference-relative data.
- Students see `checks[].passed`, `feedback_en` / `feedback_ar`, `help_slug` and `error_code`.
- The grader returns two codes that `lib/cad-champions/grader/error-codes.ts` does not list yet: `E_NO_FILE` (package: no STEP for a task) and `E_DOWNLOAD_FAILED` (the signed URL could not be fetched; retry once, then mark for manual review).
- `aspects` in the request maps grader checks (`volume`, `surface_area`, `principal_moments`, `solid_count_validity`, `part:<name>`, `parts_count`, `assembly_position`) to `cc_task_aspects` ids and points.
