# Studio product model (P5-16, Phase 1 foundation)

The Studio now designs the actual product (stake, head, light ring, nozzle, tube, reservoir…) instead of one enclosure. Phase 1 (this doc) is the foundation: schema, form-part kit, 12 archetype defaults, solver, manifold-3d kernel in the worker, CAD adapter. Phase 2a (AI design route + vision loop, budgeted per press — see `vision-budget.ts` below) and Phase 2b (viewer/scene, preview pictures, "Create my CAD" gate, Try another, Print / Get it made) build on the interfaces below. No UI uses it yet; the current Enclosure step is unchanged.

```
spec + parts ─► defaultProductFor()  (or the AI, Phase 2a)  ─► ProductModel
ProductModel + parts ─► solveProduct() ─► SolvedProduct (+ issues, hash)      pure, main thread or server
SolvedProduct ─► worker "product" request ─► BuiltProduct (pieces, tubes)      manifold-3d, in the worker
```

## Files

| File | What |
|---|---|
| `lib/studio/product/schema.ts` | zod `ProductModelSchema`, `Body`, `Link`, `Feature`, `Attach`, `FormPartSchema`; enums `ARCHETYPES` (12), `SCENES` (8), `BODY_ROLES`, `PRODUCT_MATERIALS`, `FEATURE_KINDS`, `SHELLS`; `PRODUCT_LIMITS`; `clampProductModel(input, log?)` (never throws); `PATCHABLE_PATHS`, `isPatchAllowed(op, path)`, `applyPatches(model, patches)`; `parseProductModel(v)`; `ARCHETYPE_SCENE` |
| `lib/studio/product/forms/params.ts` | the form-part kit: `FORM_KINDS` (17), `FORM_PARAMS` table `[min, max, default]` (the one place a range lives), `FormPart` / `FormPartOf<K>` types, `defaultForm(kind)`, `HOLLOW_FORMS`, `ROUND_TEMPLATES` |
| `lib/studio/product/forms/clamp.ts` | `clampForm(input, log?, path?)`, `clampProfile()` (cross-parameter rules: radius ≤ half side, fillet ≤ half height…) |
| `lib/studio/product/forms/geometry.ts` | what the solver knows without a mesh: `formFrame` (size + raw→local shift), `anchorPoint(form, anchor, du, dv)` (surface-aware), `sectionAt`, `fitHeight`, `boxFits`, `insideSection`, `scaleForm`, `stackOutline` / `matchOutline`, `overhangDeg(form, pose)`, `solidVolume`, `topAt`, `radiusAt`, `templateProfile` / `lathedOutline` (round enclosure templates), `ANCHORS`, `ANCHOR_NORMAL` |
| `lib/studio/product/shapes.ts` | pure maths shared by solver and kernel: `latheOutline` (filleted profile), `rrectOutline`, `ellipseOutline`, `superellipseOutline`, `nozzlePath`, `tubeBodyPath`, `catmullRom`, rotation helpers (`rotationMatrix`, `eulerFromMatrix`, `matMul`, `transformBox`), box helpers |
| `lib/studio/product/scene.ts` | `SCENE_METRICS`, `plantPot(radius)`, `POT`, `obstacleHit()` |
| `lib/studio/product/parts.ts` | `isPump`, `isSoilProbe`, `isLight`, `isButtonPart`, `POWER_PORTS` |
| `lib/studio/product/archetypes.ts` | `rankArchetypes(spec)`, `archetypeFor(spec)`, `archetypeDefault(archetype, spec, parts)`, `defaultProductFor(spec, parts, { archetype? })`, `productVariants(spec, parts, current, n = 3)` ("Try another"), `needsOf(spec, parts)`, `archetypeWhyKey(a)` |
| `lib/studio/product/solve.ts` | `solveProduct(model, parts, { spec?, log? }) → SolvedProduct`, `solvedHash()`, `MK4_BED`, output types |
| `lib/studio/product/stl.ts` | `pieceSTL(piece)`, `printReadyPositions(positions, matrix)`, `binarySTL(mesh)`, `meshIsWatertight(mesh)` |
| `lib/studio/geometry/product-kernel.ts` | `buildProductMeshes(mf, solved) → BuiltProduct`, `measureOverlaps(mf, solved, minVolume)`, `productTransferables()` |
| `lib/studio/geometry/product-job.ts` | worker side: `buildProduct(solved)` (cache by hash, 6), `getBuiltProduct(hash)`, `packProduct(built, withGeometry)`, `handleProductRequest(req)` |
| `lib/studio/geometry/manifold-loader.ts` | `loadManifold()` — the only import of `manifold-3d` (lazy) |
| `lib/studio/geometry/client.ts` | `getProductGeometry(solved, { geometry? }) → ProductGeometry`, `productKey()` |
| `lib/studio/cad-adapter.ts` | `CadBackend.buildProduct(model, { parts, spec, geometry })` → `{ solved, geometry }` |
| `lib/studio/product/__fixtures__/golden.ts` | the 5 acceptance ideas (spec JSON + parts), `goldenParts()` |

## Schema in short

`ProductModel { archetype, scene, rationale (≤ 160), bodies (2–8), electronicsHost, links (≤ 4) }`

`Body { id /^[a-z][a-z0-9_]{0,23}$/, role, form: FormPart, attach: { to: bodyId | "ground" | "scene", anchor, offset [x,y,z] (±300), rotate? [rx,ry,rz] (±180°) }, material, colour (palette), finish, features?, wall? (1.6–4), shell? }`

Local frame of every form: x, y centred on its bounding box, z from 0, −y = front. A stake's tip is at z = 0; a nozzle's flange is on its +y side.

Attach rules: `anchor` names a face of the PARENT (in its local frame, so it turns with the parent). The child touches it with its own opposite-facing anchor (chosen after the child's `rotate`), so bodies always touch. The offset slides along the face (top/bottom: x, y; front/back: x, z; left/right: y, z); any push off the face is snapped away (issue `snapped_offset`). Round faces keep the child on the surface; flat-bottomed children on a dome rest on its highest point under them. `ground` = scene ground (soil in a pot): only a `stake` may go below it (negative z offset). `scene` + `bottom` = the floor beside (reservoir next to the pot); `scene` + `back` = the wall plane.

Form kinds: lathe_profile, rounded_extrude, loft_rounded, stake, prongs, tube_sweep, nozzle, ring, tank, button_cap, knob, grille_disc, foot, clip_arm, hook, hinge_lid, enclosure (template = the 8 Studio templates + stake_pod; round ones are lathed from `templateProfile`).

## Patches (Phase 2a vision loop)

`applyPatches(model, patches)` takes JSON Patch ops `replace | add | remove` on `PATCHABLE_PATHS` only (body ids and unknown keys never). Each op is applied to a copy; an op that fails or leaves < 2 / > 8 bodies is skipped and listed in `rejected` (`path_not_allowed`, `op_not_allowed`, `missing`, `body_count`, `malformed`…). The result is re-clamped, so it is always valid. Removing a parent re-attaches its children to the ground. Give Gemini the list of paths (e.g. `/bodies/2/form/w`, `/bodies/0/attach/offset/1`, `/bodies/-`, `/links/0/diameter`) in the prompt.

## Archetypes

12: stake_device, planter_insert, desk_object, lamp, wall_mount, handheld, wearable_band, pet_feeder, dispenser, vehicle_mount, outdoor_box, tabletop_robot. `rankArchetypes()` reuses the W6 `shapeSignals` (plant, wall, wearable, handheld, lamp, outdoor, size) plus product words (pet/feeder, dispenser, robot, car/dash, door/doorbell, remote). Defaults scale with `sizeHint` (pocket 0.8 … large 1.6), take 2 colours from the palette by style / plant / outdoor, and add bodies from the needs: pump → nozzle + reservoir + tube, soil probe → blade stake + probe tips, LED → clear light ring / halo / lens, button → button cap, speaker → grille feature. The default `rationale` is English; Phase 2b should show `Studio.product.<archetypeWhyKey(a)>` (EN + AR, to be added) for defaults and the AI's line otherwise.

## Solver (`solveProduct`)

Pure + deterministic (same input → same output and `hash`; part order does not matter). Steps: clamp → homes (pump → reservoir, soil probe → stake, LEDs → clear ring (only between the host and a stacked layer) or lens, button → cap) → fit electronics with `layoutComponents` (turned so USB faces the archetype's side: back, or bottom for wall / car / outdoor) and grow the host (`scaleForm`, up to the form maxima ≤ MK4); host grown > 1.5× → battery moves to a base / handle → stack outlines (a ring / lid stacked on the host takes its outline) → place → top ports clear of bodies sitting on the cover (parts slide in the cavity) → button caps over their switches (stem + seat), halos round the caps, lenses over the LED → place again → cut-outs (side ports through the wall at the part, top ports through the cover, stems, tube inlets, soil-probe pass) → tubes (Catmull-Rom control points) → checks → print plans → explode.

`SolvedProduct { version, model (store this), scene, stage (scene metrics as solved: a plant pot widened to fit), bodies: SolvedBody[], links: SolvedLink[] (with world control points + length), electronics: PlacedElectronic[], unplaced, bbox, issues, hash }`

`SolvedBody { id, role, form (final), material, colour, finish, features, parent, anchor, position, rotation (deg, X→Y→Z), matrix (3×3 row-major), box (world AABB), wall, shell, joints {top,bottom}, split {z, joint} | null, lip {inset,height} | null, cutouts[], pockets[], printable, pieces[{ id, piece, print: { pose, matrix (world→bed), size, fits, overhangDeg }, explode }], estGrams, explode, hosts[] }`

`PlacedElectronic { instanceId, partId, body, pos (world; where the part's own origin = bottom centre goes), rot (Euler deg applied X then Y then Z — three.js order "ZYX"), matrix, dims, explode }`. Render the library part model with `position = pos`, rotation from `matrix` (or Euler `rot`, order ZYX).

Issue codes (Engineer view): errors `floating`, `overlap`, `scene_overlap`, `electronics_dont_fit`, `part_not_placed`, `too_big_for_printer`; warnings `host_grown`, `usb_unreachable`, `port_blocked`, `overhang`, `nozzle_off_target`, `light_missing`, `body_limit`, `window_crowded`; info `body_added`, `link_added`, `part_moved`, `snapped_offset`, `pot_widened`.

Printability: every printable body has 1–2 pieces; poses tried upright / upside down / on its side, the first that fits the MK4 (250 × 210 × 220) with ≤ 45° outside overhang wins (else the best that fits, with an `overhang` warning). Split shells: bottom upright; a flat-topped top half upside down; a lathed top upright (its inside has a 45° tent roof). Walls 1.6–4 (default 2, reservoir 2.4), features ≥ 1.2, fillets ≥ 1 (form ranges). Grams = `estGrams` (35 % fill) of the estimated volume; the kernel recomputes from the real mesh volume.

## Worker messages

```ts
// request (lib/studio/geometry/protocol.ts)
{ id, kind: "product", key, input: { solved: SolvedProduct, geometry: boolean } }
// reply
{ id, ok: true, kind: "product", ms, result: PackedProduct }   |   { id, ok: false, error }
PackedProduct = { hash, ms, geometry, pieces: PieceMeta[], links: LinkMeta[], electronics, bbox }
PieceMeta = { id, bodyId, piece, role, material, colour, colourHex, finish, triangles, volumeMm3, grams,
              printable, print, explode, watertight } (+ positions / normals: Float32Array, indices: Uint32Array
              — WORLD coordinates, transferred — only when geometry: true)
```

Main thread: `getProductGeometry(solved, { geometry })` (lib/studio/geometry/client.ts) → `ProductGeometry` with `THREE.BufferGeometry` per piece / tube when geometry is true; cached by `productKey(solved, geometry)` (LRU 4). The worker caches built products by `solved.hash` (6) — a second request (e.g. meta first, meshes after payment) does not rebuild. Measured: Plant Waterer cold build 0.3 s in node and in a production browser worker (incl. WASM load), cached reply 1 ms.

## Rendering + the payment gate (Phase 2b)

- Before "Create my CAD": request `geometry: false` — no vertex leaves the worker. Render the 2–3 preview PNGs INSIDE the worker: add a `"render"` request to protocol.ts / the worker that takes `{ hash, views, size: 512, scene }`, reads `getBuiltProduct(hash)` (product-job.ts), draws with three.js on an `OffscreenCanvas` (pieces at `position`, colours `colourHex`, finishes from `FINISH_PBR`, clear resin transparent, scene props from `solved.stage`) and posts back only PNG `ArrayBuffer`s. Views: front, side, 3/4, in scene (the vision check uses the same three).
- After payment: `getProductGeometry(solved, { geometry: true })` (cached) for the interactive viewer; "Take it apart" = move each piece by `explode × t` and each part by `electronics[].explode × t`.
- STL per piece: `pieceSTL(piece)` (print pose applied, on the bed, mm). "Get it made" sends all printable pieces (`printable: true`; aluminium probe tips are bought).
- Store `model` (+ `hash`) in `projects.studio` (no migration).

## Known limits

- One electronics host per product (plus pump → reservoir, soil probe → stake, battery → base/handle when the host would grow > 1.5×); parts are not split across other bodies.
- Overlap checks in the solver are on bounding boxes (with exemptions for parent/child contact, button stems and halo rings); the true check is `measureOverlaps()` (solid intersection) in tests. Tubes / cables are not checked against bodies.
- Overhang is judged on the outside surface; insides are built printable by construction (tent roofs ≤ 40 mm bridge, flat tops printed upside down), not measured.
- A flat child on a sloped side face (a loft that leans) can dig in slightly; defaults avoid it.
- `emboss_label` is accepted but not built (the enclosure label path stays on the old template builder). The water-level "window" is a thin groove, not a clear insert.
- The stacked-layer snap lip adds 3 mm above a cup's top; the piece's print size in `print.size` does not include it.
- `rationale` of archetype defaults is English only (see Archetypes).
- manifold-3d 3.5.4 (Apache-2.0, 541 kB WASM, 206 kB gzip) loads only in the worker on the first product build. next.config.mjs maps its `node:module` import to an empty module for client bundles.

## Tests

`lib/studio/product/{schema,forms,archetypes,solve,golden}.test.ts` (pure) and `lib/studio/geometry/product-kernel.test.ts` (heavy, real WASM in node: 5 goldens + 12 archetypes + seeded fuzz: every piece watertight by manifold status AND by `meshIsWatertight`, on the MK4 bed, no body intersections > 0.5 mm³; STL; worker cache). If the heavy file times out on a loaded machine, run it alone: `npx vitest run lib/studio/geometry/product-kernel.test.ts`.

## Phase 2a — AI designer, vision check, product API (server side)

The worker (Phase 2b) talks to `app/api/studio/product/*`; the page only ever gets pictures + public metadata.

| File | What |
|---|---|
| `lib/studio/schema.ts` | page-safe `StudioDoc.product` (`ProductDocSchema`: designs `{id, archetype, why {en, ar}, previewPath, status}`, `chosenId`, `unlockedId`, `specHash`) |
| `lib/studio/product/private.ts` | server-only `projects.studio.productPrivate` (`{designs: [{id, model, solvedHash, score, loops, looksLike, missing, issues, source, best}]}`), `serverOwnedOf`, `mergeServerOwned`, `trimPrivate` (192 kB), `finalModel` (= best checked version) |
| `lib/studio/server/doc.ts` | every doc parse drops `productPrivate`; `saveDoc` writes the STORED `product` + `productPrivate` back (read together with the version, so a page save can neither erase, forge nor unlock); `loadDocPrivate` / `updateProductDoc` for the product routes only |
| `lib/studio/product/ai/prompt.ts` | designer system prompt (job → use → functional parts → archetype + proportions → look, one line each in `thinking`), Gemini `responseSchema` (one design per asked archetype; `form` = flat object of all kit params) |
| `lib/studio/product/ai/design.ts` | `pickArchetypes` (rankArchetypes minus `exclude`), `runProductDesign` (one call for all designs, starts from each archetype default; strict check, one retry with the problems, lenient on the retry; failure / no key → defaults), cache by spec + parts + archetypes (`productDesignCache`, 10 min, one instance only — the durable reuse is the request fingerprint below) |
| `lib/studio/product/ai/physical.ts` | `ensurePhysical`: opaque light ring / window → resin_clear; soil probe on a non-grounded head → its own stake + cable; then the Phase 1 solver homes (pump → reservoir + tube + nozzle, probe → stake + prongs, LED → clear ring / lens, button → cap, USB to a reachable side); returns the solver's model, issues, hash |
| `lib/studio/product/ai/why.ts` | "Why this design" EN + AR ≤ 160: the AI's lines when usable, else `Studio.product.why_<archetype>` |
| `lib/studio/product/ai/vision.ts` | vision prompt ("does this look like <product> at a glance, are all functional parts visible"), strict JSON `{score, looksLike, missing, patches}`; patch values come as `valueJson` strings; only `PATCHABLE_PATHS`, ≤ 8; `final` asks for no patches on a design's last round |
| `lib/studio/geometry/vision-budget.ts` | the press's vision budget: one check per design plus `MAX_REFINEMENTS` (2) refinement loops **shared by the press**, not per design. `maxVisionCalls(3)` = 5, so one press costs at most 1 designer call + 5 vision calls (it was 1 + 9). Designs are built in archetype-ranking order, so the pool goes to the strongest candidate that needs it; each design still keeps its own best-scoring version. |
| `lib/studio/product/ai/concept.ts` | `store_settings.studio_concept_image` reader (default off) + a STUB generator: image-output Gemini models are not on the free tier, so nothing is generated and nothing calls it yet |
| `lib/studio/product/store.ts` | pure state transforms: `addDesigns` (a new spec keeps only chosen / unlocked; cap 9), `applyCheck` (best-scoring checked version kept), `applyPreview` (ready + final model), `applyChoose`, `applyUnlock` |
| `lib/studio/server/product.ts` | bodies, no-store JSON, guest limit, preview upload, `isSuperAdmin` |
| `lib/studio/server/preview-url.ts` | `chosenPreviewPath`, `previewUrl(s)`, `projectPreviewUrl` — signed with the viewer's own session; used by My projects, `/projects/[id]/request`, `/dashboard/leads/[id]` (`components/projects/product-picture.tsx`) |

Endpoints (JSON, `Cache-Control: no-store`; a session is required, guest sessions own their projects; the project is read under RLS = owner check):

- `POST design {projectId, count 1–3 (default 3), exclude?}` → `{designs: [{id, model, why, archetype}]}`; 409 `no_parts` (doc without parts) / `run_0068`. Guests: 429 `guest_limit` after 3 builds per Qatar day per guest session or per hashed IP (`ipHash`, the bom_rate_check salt), counted in the existing `ai_rate_limits` table via the service client (keys `studio:u:<uid>`, `studio:ip:<hash>`) — not in `ai_usage` (no IP / per-build column there). The AI calls themselves are metered in `ai_usage` (feature studio, step product / vision).
- `POST check {projectId, designId, images {front, side, iso}, loop 0–2, final?}` → `{score, looksLike, missing, model, changed}`; `{skipped: "no_key", model}` without a key; `{skipped: "quota", model}` on quota / rate limit / outage / two unreadable answers.
- `POST preview {projectId, designId, png}` → `{previewPath}`; existing private bucket `project-images`, path `studio-previews/<projectId>/<designId>.png`, uploaded with the service client after the owner check (its insert policy wants the user id as first folder); read back by the owner / super_admin through 0045 `owns_storage_project` (folder 2 = project id). 503 `storage_unavailable` without the service key.
- `POST choose {projectId, designId}` → `{chosenId}` (free).
- `POST unlock {projectId, designId}` → `{unlockedId, model, charged, changesLeft}`; same cad flow as the enclosure route (`credit_can_use` → `cad_begin` "studio product: …" (parent = last delivered `studio %` generation while versions are left) → `cad_set_code` (model JSON) → `cad_deliver`); 403 `sign_in` (guests), 402 `no_credits`; the unlocked design answers again without a charge.
- `GET model?projectId&designId` → `{model}` only when `product.unlockedId === designId` or super_admin, else 403 `locked`.
- `GET engineer?projectId` → super_admin only: `{product, productPrivate}`.

What one press costs: 1 designer call + one vision call per design + the press's shared refinement pool = **6 model calls at most, 4 when the first round already scores 7+** (it was 10 and 4+6 wasted). Every studio step also goes through `validatedCall`'s request fingerprint (`lib/prototyping/call-fingerprint.ts`, stored in `analysis_runs.request_hash`, migration 0099): an identical step — same spec, same parts, same pictures — is answered from its stored run, so pressing the same button twice costs nothing the second time. The stored RAW answer is re-validated by the step's own `validate`, so a row written by an older shape of the step is paid for again rather than trusted. `studioCall` turns this on for every studio step; a reuse writes no `ai_usage` and no `analysis_runs` row, because it spent nothing.

Known limits: the owner can still read `projects.studio` (incl. `productPrivate`) with their own session straight through PostgREST — hiding it needs a column privilege (a migration); page code never reads it. Previews of deleted projects stay in the bucket. Tests: `lib/studio/product/ai/{design,vision}.test.ts`, `lib/studio/product/private.test.ts`, `lib/studio/server/{product,product-routes}.test.ts` (mocked Supabase `lib/studio/server/fake-supabase.ts` + mocked Gemini).

## Phase 2d — looks, real-AI tuning (P5-16d)

Defaults (`archetypes.ts`): plant products are warm white with a water-blue accent (never sage — leaves are green); the stake device has a graphite stake, a 10 mm glowing halo, an ocean nozzle and a clear reservoir (the scene draws water in it). The lamp is base + touch pad (a `cover`, no switch) + slim stem + head (host, LED ring inside) + frosted `light_ring` shade (`shell: open_bottom`, sits on the head's snap lip). The feeder has a clear hopper (the scene draws kibble in it), a chute over the bowl and no second prop bowl. The remote has one cap per switch plus a red power key. The solver now adds one cap per button part (`ensureHomes`).

Looks (`scene/stage.ts`, `scene/props.ts`): glowing clear parts use a saturated light colour at emissive 0.85 (ACES kept washing the old 0.9 × pale glow to cream); clear non-glowing parts (hopper, tank) are see-through. `buildSceneProps(scene, stage, bbox, hints)` takes `sceneHintsFromPieces(pieces)` (one box per body): water in clear reservoirs (plant pot), kibble in a clear hopper and in the product's own bowl (pet bowl). The "hand" scene is now a sofa seat + cushion (the open palm read as blobs). The plant is sized from the product's height above the soil.

Deterministic rules after the AI (`ai/physical.ts`, all in `ensurePhysical`, so vision patches get them too; tests `ai/physical-rules.test.ts`): `dropDeadLights` (no LED → no glowing body), `archetypeScene` (stake / planter / feeder / doorbell keep their scene), `printableMaterials` (aluminium only for probe pins), `wallFacing` (wall layers face out of the wall), `contrastWithScene` (no sage in a plant pot), `lensSize` (a window ≤ 3 mm proud, ≤ 70 % of its face), `signatureBodies` (feeder: open bowl in front, chute lifted over it, base deep enough for the button). `design.ts`: bodies of the default the AI dropped are put back (`restoreDefaultBodies`, no extra call). Prompts: designer keeps every default body and must stand out from its scene; vision is told USB sockets are on the back/underside.

Real Gemini run (free tier, 2026-10-11, top archetype per idea, local harness answering the worker's endpoints, nothing written): Plant Waterer 8–9, desk lamp 8–9, cat feeder 9 (5–6 before the feeder rules), doorbell 9 (3–4 before `wallFacing`), TV remote 8–9 (3–5 before `lensSize`). Fixture flag `?productremote=1` sends the worker's product endpoints to `/__e2e/studio-product/*` (answered only by a Playwright harness).
