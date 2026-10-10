# CAD worker (CadQuery on Cloud Run)

The server path for AI-written 3D models. The Next.js app sends CadQuery code;
this service checks it, runs it in a locked-down child process, measures the
result and returns STEP + STL files and an isometric SVG preview. Today's
browser OpenSCAD path (`lib/cad/*`) is unchanged.

## Contract

`POST /build`

```json
{
  "code": "import cadquery as cq\nLENGTH = 80\n...\nresult = body",
  "units": "mm",
  "checks": { "min_wall_mm": 1.2, "must_contain_box": { "x": 70, "y": 50, "z": 20 } }
}
```

`checks` is optional (`min_wall_mm` defaults to 1.2, `must_contain_box` to null).

Response (always this shape):

```json
{
  "ok": true,
  "step_b64": "...", "stl_b64": "...", "preview_svg": "<svg ...>",
  "bbox": { "x": 80.0, "y": 60.0, "z": 30.0 },
  "volume_mm3": 24832.0,
  "checks": [
    { "name": "valid_solid", "pass": true, "detail": "One closed, valid solid." },
    { "name": "positive_volume", "pass": true, "detail": "Volume about 24,832 mm³ (24.8 cm³)." },
    { "name": "must_contain_box", "pass": true, "detail": "Fits your board (70 × 50 × 20 mm) with room to spare: ..." },
    { "name": "min_wall", "pass": true, "detail": "Walls about 2.0 mm (minimum 1.2 mm)." }
  ],
  "log": "cadquery 2.6.1 loaded in 2.3 s\nmodel ran in 0.1 s\n...",
  "error": "only when ok is false"
}
```

- `ok` is true when the model built, is a valid closed solid with volume, and
  its files were written. `must_contain_box` and `min_wall` can fail while
  `ok` is true: the model exists, the check tells the client what to repair.
- Rejected code, timeouts, build errors, an invalid or empty solid: HTTP 200,
  `ok: false`, a plain-English `error`, empty files, `bbox` zeros.
- Malformed request (wrong `units`, negative box): HTTP 422, same shape.
- HTTP 500 only for a true internal failure (same shape, generic `error`).
- Optional auth: when the env var `CAD_WORKER_TOKEN` is set, `/build` needs
  `X-Cad-Worker-Token: <token>` (401 otherwise; Authorization carries the Google ID token). `/health` stays open.

`GET /health` → `{"ok": true, "cadquery": "2.6.1"}` (`ok: false` when cadquery is missing).

The model code: CadQuery, millimetres, named dimensions at the top, the final
shape in one variable `result` (`cq.Workplane`, `cq.Shape` or `cq.Assembly`).
It may import only `cadquery`, `math` and `cadhelpers` (`app/cadhelpers.py`:
`open_box`, `rounded_plate`, `standoffs`, `clearance`).

## Sandbox (the code is AI-written)

1. **Static check** (`app/sandbox.py`, pure, unit-tested): source ≤ 20 KB and
   ≤ 8,000 AST nodes; imports only `cadquery` / `math` / `cadhelpers` (no
   submodules, no `*`, no relative); no `exec eval compile open input
   __import__ globals locals vars getattr setattr delattr breakpoint type
   object super dir help exit quit memoryview ...`; no reference (name or
   attribute) to `os sys subprocess socket pathlib importlib shutil builtins
   ctypes io pickle marshal`; no dunder names/attributes/arguments; no private
   `_x` attributes; no frame/code attributes (`f_*`, `gi_*`, `tb_*`, `co_*` ...);
   no cadquery file I/O or code runner (`export*`, `import*`, `save`,
   `exporters`, `importers`, `cqgi`, `occ_impl`, `OCP`); no `.format` (it reads
   attributes by name); no classes, `with`, `global`, async. Must assign `result`.
   Lambdas are allowed.
2. **Child process** (`app/executor.py` → `python -I app/runner.py`): fresh
   temp working dir (always deleted), minimal environment (no secrets, no
   `CAD_WORKER_TOKEN`), own process group, killed after 45 s wall time.
3. **Resource limits** in the child (Linux, after cadquery loads): CPU 40 s,
   address space 1.5 GB above what the engine needs to load, 64 open files,
   100 MB per file, no core dumps.
4. **No network** in the child: `socket.socket`, `create_connection`,
   `getaddrinfo` etc. raise before the model runs.
5. **Restricted exec**: the static check runs again in the child; the model
   runs with a small builtins whitelist, `print` goes to `log`, and an import
   hook that returns only the three allowed modules.
6. **Files are written by the runner**, never by model code (cadquery exporters).

True isolation comes from Cloud Run's gVisor sandbox plus these layers. Run
the service with a dedicated service account that has **no roles** (so the
metadata server hands out a useless token), `--no-allow-unauthenticated` or
`CAD_WORKER_TOKEN`, and `--concurrency` equal to `CAD_MAX_CONCURRENT_BUILDS`.

## Geometry checks (`app/geometry.py`)

- **valid_solid**: `shape.isValid()`, at least one solid, every shell of
  every solid closed, no loose faces outside the solids.
- **positive_volume**: volume > 0.
- **bbox**: x/y/z size, rounded to 0.1 mm.
- **must_contain_box**: a vertical ray through the model's centre (and each
  separate piece's centre) finds the empty gaps above a floor; horizontal rays
  measure the cavity width there and re-centre on it. The board box is placed
  on that floor, centred, and an exact boolean (board ∩ model) must have
  ~zero volume. If material only touches the lower half of the board box
  (standoffs, bosses) the board is lifted onto it and tested again. The board
  is tried flat in both orientations (0° and 90° about Z). Fails with the
  measured inner size when nothing fits.
- **min_wall**: ~300 points spread over the faces by area; from each point a
  ray goes along the inward normal and measures the distance through
  material. The thinnest reading is the wall. Approximate: features smaller
  than the sample spacing can be missed, and a ray leaving through an edge
  can read slightly thin.
- **preview_svg**: cadquery SVG export, projection (1, −1, 0.8), hidden lines
  off, 600 × 600 px, grey stroke.

## Run locally (Windows dev machine)

The pure tests need no cadquery (keep cadquery off the dev machine — it is
several GB):

```bash
python -m venv .venv && .venv/Scripts/pip install fastapi==0.115.12 pydantic==2.11.4 pytest==8.3.5 httpx==0.28.1
.venv/Scripts/python -m pytest
```

That runs the sandbox rejections and the API contract (build step mocked);
`tests/test_build_cadquery.py` is skipped. To run the server with real builds
you need the full `requirements.txt` (Linux/Docker recommended):

```bash
pip install -r requirements.txt
uvicorn app.main:app --port 8080
curl localhost:8080/health
```

On Windows the child process runs without rlimits (the timeout still applies).

## Tests in the cloud build

`cloudbuild.yaml` builds the Dockerfile's `runtime` stage, which depends on the
`test` stage: `pytest -v` runs inside the image with cadquery installed (all
tests, including the 45 s timeout test). A failing test fails the build and
nothing is pushed.

```bash
gcloud builds submit services/cad-worker \
  --config services/cad-worker/cloudbuild.yaml \
  --substitutions=_REGION=me-central1,_REPO=gestaltung
```

Needs an Artifact Registry Docker repository `gestaltung` in `me-central1`.
Deploy afterwards, for example:

```bash
gcloud run deploy cad-worker \
  --image me-central1-docker.pkg.dev/PROJECT_ID/gestaltung/cad-worker:latest \
  --region me-central1 --memory 2Gi --cpu 2 --concurrency 1 --timeout 120 \
  --no-allow-unauthenticated --service-account cad-worker-runtime@PROJECT_ID.iam.gserviceaccount.com
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | Cloud Run port |
| `CAD_WORKER_TOKEN` | unset | When set, `/build` requires `X-Cad-Worker-Token: <token>` |
| `CAD_MAX_CONCURRENT_BUILDS` | 1 | Builds at once per instance (match `--concurrency`) |
| `CAD_QUEUE_WAIT_S` | 50 | How long a request waits for a free slot before "busy" |
| `CAD_BUILD_TIMEOUT_S` | 45 | Wall timeout per build |
