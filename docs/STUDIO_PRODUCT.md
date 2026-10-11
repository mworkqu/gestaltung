# Studio product model (P5-16, Phase 1 foundation)

The Studio now designs the actual product (stake, head, light ring, nozzle, tube, reservoir…) instead of one enclosure. Phase 1 (this doc) is the foundation: schema, form-part kit, 12 archetype defaults, solver, manifold-3d kernel in the worker, CAD adapter. Phase 2a (AI design route + vision loop) and Phase 2b (viewer/scene, preview pictures, "Create my CAD" gate, Try another, Print / Get it made) build on the interfaces below. No UI uses it yet; the current Enclosure step is unchanged.

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
