# CAD Champions STEP grader (`/grader`)

A small Python service (FastAPI + CadQuery) that checks a student's STEP file against the answer and returns a score plus bilingual feedback. It runs on Google Cloud Run as its own service, `cad-grader`, separate from `services/cad-worker`.

A student can model the part anywhere and rotated any way. So the grader only compares numbers that stay the same however the part is placed:
- volume
- surface area
- the three principal moments of inertia about the centre of mass (the part's "rotational fingerprint")

A wrong hole, a missing fillet or a wrong length changes these numbers.

## Endpoints

Every POST needs the header `X-Grader-Secret: <GRADER_SECRET>`. The compare is constant-time (`hmac.compare_digest`).
- Wrong or missing header: 401.
- `GRADER_SECRET` not set on the server: every POST gets 503 (fail closed).

`GET /health` (open) returns `{"ok": true, "cadquery": "2.6.1", "service": "cad-grader"}`. `ok` is false when CadQuery is missing.

### `POST /grade`

```json
{
  "submission_id": "task-result-uuid",
  "file_url": "https://<supabase>/storage/v1/object/sign/...",
  "mode": "part",
  "scoring": "aspects",
  "reference_data": { "...": "from /reference or tools/make_reference.py" },
  "density_kg_m3": 7850,
  "tolerances": { "volume": 0.005, "area": 0.01, "moment": 0.01 },
  "max_points": 10,
  "aspects": [
    { "aspect_key": "<cc_task_aspects.id>", "check": "volume", "max_points": 4 },
    { "aspect_key": "<id>", "check": "principal_moments", "max_points": 3 }
  ]
}
```

Request fields:
- `mode`: `part` (default), `assembly` or `practice`.
- `scoring`: `aspects` or `practice`. It defaults to `practice` when `mode` is `practice`, else `aspects`.
- `tolerances`, `aspects`: optional.
- `file_url`: signed, short-lived, `https://` only. Optional env `GRADER_ALLOWED_URL_PREFIXES` (comma list) restricts it further, for example to the Supabase storage URL.
- `file_path`: a local file, for tests only. It is accepted only when `GRADER_ALLOW_LOCAL_FILES=1`, else 422.

Response (HTTP 200 for every student-file outcome, including error codes):

```json
{
  "score": 6.0,
  "max_points": 10.0,
  "checks": [
    { "name": "volume", "measured": 10582.4, "expected_hidden": true, "passed": false, "partial": 0.0,
      "aspect_key": "volume", "points": 0.0, "max_points": 4.0 }
  ],
  "error_code": null,
  "warnings": [],
  "feedback_en": "Your part's volume is 1.5% higher than expected. Check hole diameters, pocket depths and wall thicknesses.",
  "feedback_ar": "حجم قطعتك أكبر من المتوقع بنسبة 1.5%. ...",
  "help_slug": null,
  "timing_ms": 2140,
  "mode": "part",
  "scoring": "aspects",
  "passed": false,
  "practice_score": null,
  "details": { "measured": {}, "rel_errors": {}, "tolerances": {} }
}
```

`details` holds reference-relative data (relative errors, the full measurement, unit detection, assembly matching). **The site stores it server-side and never shows it to students.**

Everything else is safe to show. `checks[].measured` is the student's own number, and `expected_hidden` is always true: reference values never appear outside `details`.

Other status codes:
- 422: bad request or `reference_data` (with `{"error": "..."}`).
- 500: internal error (generic, never the stack).

### `POST /reference` (admin, Task 11)

Request: `{"file_url": "...", "density_kg_m3": 7850, "part_names": ["base", "post", "pin"]}`. `part_names` is optional, in the order the solids appear in the file.

Response: `{"reference_data": {...}, "warnings": [], "timing_ms": 1800}`. It returns 422 with an `error_code` if the answer file itself is rejected.

`reference_data`:
```json
{
  "version": 1, "units": "mm", "density_kg_m3": 7850, "solids": 1, "valid": true,
  "volume_mm3": 10429.2, "area_mm2": 5485.8, "mass_kg": 0.0818,
  "principal_moments_mm5": [1.3e6, 2.9e6, 4.2e6], "principal_moments_kg_mm2": [10.2, 22.8, 33.0],
  "principal_box_mm": [5, 40, 60],
  "parts": [ { "name": "part_1", "volume_mm3": 10429.2, "area_mm2": 5485.8, "mass_kg": 0.0818,
               "principal_moments_mm5": [...], "principal_moments_kg_mm2": [...], "principal_box_mm": [...] } ]
}
```

The same JSON from the command line (needs CadQuery, so run it in the image or a Linux venv):
```bash
python tools/make_reference.py answer.step --density 7850
python tools/make_reference.py assembly.step --density 7850 --assembly part_names.json
```
`part_names.json` is `["base", "post", "pin"]` (or `{"parts": [...]}`).

### `POST /grade-package` (module_package mode, alignment section F)

```json
{
  "submission_id": "attempt-uuid",
  "density_kg_m3": 7850,
  "files": [
    { "name": "A12/DAY 01/Results/Parts and Assemblies/Part_03.step", "file_url": "https://..." },
    { "name": "A12/DAY 01/Results/Parts and Assemblies/Part_03.ipt", "file_url": "https://..." }
  ],
  "tasks": [
    { "task_id": "uuid", "patterns": ["Parts and Assemblies/Part_03.*"], "mode": "part",
      "reference_data": {}, "max_points": 10, "aspects": [], "tolerances": {} }
  ]
}
```

Matching works in two passes:
1. **By name.** `patterns` are globs, case-insensitive, matched against the end of the path inside the ZIP, or `re:<regex>`. Only `.step`/`.stp` files are graded; other files are listed in `ignored_files`.
2. **By volume.** A task with no name match gets the remaining STEP file whose volume is closest to its reference volume (Hungarian assignment, within 25 %). The result is flagged: `matched_by_volume: true`, the warning `MATCHED_BY_VOLUME` and a feedback line asking the student to name files as the task says.

Each file is measured once. At most 40 STEP files per call (`GRADER_MAX_PACKAGE_FILES`).

Response: `{"submission_id", "results": [ <grade response> + "task_id", "file_name", "matched_by" ("name"|"volume"|null), "matched_by_volume" ], "unmatched_files": [...], "ignored_files": [...], "timing_ms"}`.

A task with no file at all gets `E_NO_FILE`. If a name pattern matched more than one file, the extra matches are listed in `details.also_matched_by_name`.

## How scoring maps to aspects

Every check is one **measurement aspect** (docs/COMPETITION_ALIGNMENT.md section D).

| Check (`checks[].name`) | Passes when |
|---|---|
| `volume` | volume within ±0.5 % |
| `surface_area` | area within ±1 % |
| `principal_moments` | each of the three principal moments within ±1 % |
| `solid_count_validity` | solid count equals the reference and the geometry is valid |
| `part:<name>` (assembly) | that part's volume, area and moments all within tolerance |
| `parts_count` (assembly) | no missing and no extra parts |
| `assembly_position` (assembly) | the whole assembly's principal moments within ±1 %, which means the parts sit in the right places relative to each other |

There are two scoring modes:
- **`scoring: "aspects"`** (competition; default for `part` and `assembly`). Inside tolerance = the aspect's full points, outside = 0.
  - Pass `aspects` to map checks to `cc_task_aspects` ids and their `max_points`. Checks you do not list are still reported, with 0 points and `aspect_key: null`. `max_points` in the response is then the sum of the listed aspects.
  - Without `aspects`, `max_points` is split 40 / 20 / 30 / 10 (part) or 70 parts / 10 count / 20 position (assembly), and `aspect_key` = the check name.
- **`scoring: "practice"`** (practice tests and exercises; default for `mode: "practice"`). This is the partial-credit curve: full inside tolerance, decaying linearly to 0 at 5× tolerance, weighted 40 % volume, 20 % area, 30 % moments, 10 % solids + validity.
  - The response adds `practice_score` (0–100), shown as the "practice score".
  - `passed` is the practice pass/fail: valid geometry, a single solid, units right, volume within 1 %.

Tolerances can be set per task (`volume`, `area`, `moment`, `assembly_match` = 10 % pairing window, `practice_volume` = 1 %). Each must be > 0 and ≤ 0.5.

**Assembly mode** pairs each solid with a reference part by volume (Hungarian assignment via `scipy.optimize.linear_sum_assignment`, within 10 %).
- Missing parts are named; extra solids are counted.
- Then the whole assembly's principal moments confirm the positions. All parts right but positions wrong gives "All parts are correct, but their positions don't match - check your constraints."

Density only scales the reported mass. The comparison uses unit-density moments (mm⁵), so a wrong density never changes a score.

## Error codes

The help slugs are the same as in `lib/cad-champions/grader/error-codes.ts`.

| Code | When | Score | Help slug |
|---|---|---|---|
| `E_NOT_STEP` | The file does not start with `ISO-10303-21` (after an optional BOM or whitespace), e.g. a PDF renamed `.step`. | 0 | `my-file-was-rejected` |
| `E_EMPTY` | 0 bytes, or only whitespace. | 0 | `my-file-was-rejected` |
| `E_PARSE_FAILED` | The STEP reader failed, or crashed in OpenCascade (damaged or truncated file). | 0 | `my-file-was-rejected` |
| `E_TIMEOUT` | Parsing took longer than 60 s, or ran over the memory cap. The child process is killed. Also returned when the service stayed busy for 50 s. | 0 | `my-file-was-rejected` |
| `E_NO_SOLID` | The file has only sketches, surfaces or shells. | 0 | `my-file-was-rejected` |
| `E_MULTIPLE_SOLIDS` | Part/practice mode and more solids than the reference ("Your file contains N separate bodies; this task expects 1"). | 0 | `my-file-was-rejected` |
| `E_WRONG_UNITS` | Volume ratio to the reference ≈ 1e3, 1e6, 1e9 or 25.4³, or the inverse, within 5 %. The message names the scale (10 = cm, 100 = dm, 1000 = m, 25.4 = inches) and the direction (too big / too small); `details.units` has it. | 0 | `set-units-to-mm` |
| `E_TOO_LARGE` | Over 50 MB (declared or streamed). | 0 | `my-file-is-too-large` |
| `E_INVALID_GEOMETRY` | **A warning, not an error.** `isValid()` is false. The file is still measured and scored, but `solid_count_validity` fails. Listed in `warnings`. | measured | `my-file-was-rejected` |
| `E_NO_FILE` | `/grade-package` only: no STEP file matched the task by name or volume. | 0 | `my-file-was-rejected` |
| `E_DOWNLOAD_FAILED` | The signed URL could not be fetched (not https, HTTP error, network error, 20 s download limit). This is not the student's fault: the site should retry once, then mark the result for manual review. | 0 | `my-file-was-rejected` |

`E_NO_FILE` and `E_DOWNLOAD_FAILED` are grader-side codes that the site's `error-codes.ts` does not list yet. Unknown codes fall back to its generic message.

Other warnings: `MATCHED_BY_VOLUME` (package matching, see above).

## Limits and safety

- **Download:** https only, 50 MB, 20 s total (`GRADER_MAX_FILE_MB`, `GRADER_DOWNLOAD_TIMEOUT_S`).
- **Parse:** `cadquery.importers.importStep` runs in a separate process.
  - On Linux it uses a forkserver that preloads CadQuery once, so each child starts warm.
  - Wall-clock limit 60 s (`GRADER_PARSE_TIMEOUT_S`).
  - Memory: `RLIMIT_AS` = the child's size after CadQuery is loaded + 1200 MB (`GRADER_CHILD_MEMORY_MB`).
  - On overrun the child is killed and the result is `E_TIMEOUT`.
- **Concurrency:** at most `GRADER_MAX_PARALLEL` (default 2) parses at a time per instance, matching Cloud Run concurrency 2.
- **Logging:** structured JSON lines on stdout with only whitelisted fields (event, submission_id, mode, error_code, score, timing...). No file contents, no URLs, no reference values.

## Tests

```powershell
cd grader
python -m venv .venv
.venv\Scripts\pip install fastapi==0.115.12 pydantic==2.11.4 uvicorn==0.34.2 httpx==0.28.1 numpy==2.2.6 scipy==1.15.3 pytest==8.3.5
.venv\Scripts\python -m pytest
```

`tests/test_cadquery_fixtures.py` builds the STEP fixtures with CadQuery and **skips itself when CadQuery is not installed**:
- plate; plate with hole; the same rotated 37° + translated (100 %)
- scaled 1000× (`E_WRONG_UNITS`); in inches (detected); hole 1 mm too small (loses points, right message)
- two disjoint bodies (`E_MULTIPLE_SOLIDS`); a PDF renamed `.step`; an empty file
- 3-part assembly: correct / one missing / shuffled / one moved (position message)
- the `make_reference.py` CLI

On Windows, `pip install cadquery` fails in this repo folder: its long path goes past Windows' 260-character limit. Those tests run in the Docker `test` stage on every Cloud Build.

Everything else runs anywhere: secret check, messages, package matching, scoring maths with hand-made measurements, header checks, and the pathological-file timeout (a monkeypatched slow parse child is killed after 2 s).

## Deploy (Windows PowerShell, no local Docker)

Cloud Build builds the Dockerfile in the cloud. The build runs every test, CadQuery ones included, and nothing is deployed if a test fails.

1. **Install gcloud** (once), then open a new PowerShell:
   ```powershell
   winget install --id Google.CloudSDK -e
   ```
2. **Log in and pick the project** (the CAD worker's project is `gestaltung-cad`):
   ```powershell
   gcloud auth login
   gcloud config set project gestaltung-cad
   ```
3. **Enable the APIs:**
   ```powershell
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
   ```
4. **Region.** Doha is `me-central1`. Check that Cloud Run is offered there:
   ```powershell
   gcloud run regions list --format="value(locationId)" | Select-String "me-central"
   ```
   The CAD worker already runs in `me-central1`, so it should be listed. If not, use `me-central2` (Dammam) or `europe-west1` (Belgium) in every command below.
5. **Create the shared secret.** Pick a long random string; the site uses the same value as `GRADER_SECRET`.
   ```powershell
   $s = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
   $s | Out-File -NoNewline -Encoding ascii grader-secret.txt
   gcloud secrets create GRADER_SECRET --replication-policy=automatic --data-file=grader-secret.txt
   Remove-Item grader-secret.txt
   $num = gcloud projects describe (gcloud config get-value project) --format="value(projectNumber)"
   gcloud secrets add-iam-policy-binding GRADER_SECRET --member="serviceAccount:$num-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
   ```
   Keep `$s` for the Vercel env var (`echo $s`), or read it back later:
   ```powershell
   gcloud secrets versions access latest --secret=GRADER_SECRET
   ```
6. **Deploy from the repo root:**
   ```powershell
   gcloud run deploy cad-grader --source ./grader --region me-central1 --memory 2Gi --cpu 1 --concurrency 2 --min-instances 0 --max-instances 3 --timeout 120 --allow-unauthenticated --set-secrets GRADER_SECRET=GRADER_SECRET:latest --set-env-vars GRADER_ALLOWED_URL_PREFIXES=https://jgwuafubtmpaonsznfyw.supabase.co/storage/v1/object/sign/
   ```
   - `--allow-unauthenticated` is needed because the site authenticates with the `X-Grader-Secret` header, not a Google ID token. Every POST without the secret is refused.
   - The first `--source` deploy asks to create an Artifact Registry repo named `cloud-run-source-deploy`; answer Y.
   - The command prints the service URL. That URL is `GRADER_URL` on the site.
7. **Check it:**
   ```powershell
   curl.exe https://<service-url>/health
   ```
8. **Logs:**
   ```powershell
   gcloud run services logs read cad-grader --region me-central1 --limit 100
   gcloud beta run services logs tail cad-grader --region me-central1
   ```
9. **Redeploy after a code change:** run the same command as step 6. To rotate the secret, add a new version, then redeploy and update Vercel:
   ```powershell
   gcloud secrets versions add GRADER_SECRET --data-file=new-secret.txt
   ```

**Cold start.** With `--min-instances 0` there is no cost while idle. The first request after a quiet period waits roughly 10–20 s while the instance starts and loads CadQuery.

**Test days.** Keep one instance warm and switch back afterwards:
```powershell
gcloud run services update cad-grader --region me-central1 --min-instances 1
gcloud run services update cad-grader --region me-central1 --min-instances 0
```
A warm 1 vCPU / 2 GiB instance is billed all day: about USD 2–3 per day at idle (instance-based) rates. Check the Cloud Run pricing page for the region, and turn it back to 0 after the test.

### Fallback: micromamba image (only if pip wheels fail)

If `pip install cadquery` stops working on the slim image (for example, a missing wheel after a version bump), replace the `base` stage with conda-forge:

```dockerfile
FROM mambaorg/micromamba:1.5.10-bookworm-slim AS base
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxrender1 libxext6 && rm -rf /var/lib/apt/lists/*
RUN micromamba install -y -n base -c conda-forge python=3.12 cadquery=2.6.1 scipy=1.15.3 numpy=2.2.6 && micromamba clean -a -y
ENV PATH=/opt/conda/bin:$PATH
WORKDIR /srv
RUN pip install --no-cache-dir fastapi==0.115.12 pydantic==2.11.4 uvicorn==0.34.2 httpx==0.28.1
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin grader
COPY app ./app
COPY tools ./tools
```
Keep the `test` and `runtime` stages as they are.

## Files

- `app/main.py`: HTTP API, models, secret check, JSON logging
- `app/measure.py`: download, header check, parse child process, limits
- `app/geometry.py`: CadQuery/OCP measurements (child process only)
- `app/compare.py`: tolerances, units detection, aspects/practice scoring, assembly matching, reference builder
- `app/messages.py`: EN + AR feedback catalogue and help slugs
- `app/package.py`: module-package file matching
- `tools/make_reference.py`: reference_data from the answer STEP
