# Code-quality audit: structure (Gestaltung, main 88a6473)

Read-only. Raw data: `scratchpad/baseline/eslint-complexity.json` (ESLint run with `--rule complexity=1, max-lines-per-function=1`, app+components+lib, tests excluded), `scratchpad/baseline/asunknown.txt`, `scratchpad/baseline/tsc-files.txt`. Correction to BASELINE: `package.json` now lists `@electric-sql/pglite` 0.5.11 (file changed 11:23 during this audit); baseline said it was missing.

## 1. Complexity hot spots

Thresholds hit (non-test functions): complexity >=15: **323**; >=25: **140**; >=40: **45**. max-lines-per-function >=120: **166**; >=300: **31**.

### 1a. Top 40 functions by cyclomatic complexity

| # | CC | file:line | function |
|---|---|---|---|
| 1 | 176 | lib/studio/schematic.ts:147 | renderSchematicSVG |
| 2 | 157 | lib/studio/wiring-drawing.ts:272 | renderWiringSVG |
| 3 | 151 | lib/studio/product/solve.ts:651 | solveProduct |
| 4 | 124 | components/prototyping/workspace.tsx:138 | PrototypingWorkspace |
| 5 | 111 | app/api/store-lead/route.ts:141 | POST |
| 6 | 100 | lib/studio/plain-checks.ts:246 | studioChecks |
| 7 | 92 | lib/prototyping/electronics-rules.ts:170 | deriveElectronics |
| 8 | 92 | components/prototyping/bom-table.tsx:651 | Row |
| 9 | 88 | lib/studio/netlist.ts:573 | buildNetlist |
| 10 | 82 | app/[locale]/dashboard/customers/[id]/page.tsx:24 | CustomerPage |
| 11 | 79 | lib/admin/project-export.ts:81 | buildProjectExport |
| 12 | 71 | lib/admin/customer-export.ts:155 | buildCustomerExport |
| 13 | 70 | lib/studio/sim/step.ts:142 | step |
| 14 | 70 | components/studio/StudioShell.tsx:122 | StudioShellInner |
| 15 | 70 | app/api/admin/youtube/upload/route.ts:70 | POST |
| 16 | 66 | lib/prototyping/bom-match.ts:279 | matchLine |
| 17 | 64 | components/studio/steps/EnclosureProduct.tsx:54 | EnclosureProduct |
| 18 | 63 | components/studio/steps/EnclosureTemplate.tsx:82 | EnclosureTemplateFlow |
| 19 | 63 | components/prototyping/idea-stage.tsx:101 | IdeaStage |
| 20 | 59 | lib/sourcing/spec-map.ts:48 | parametersToAttributes |
| 21 | 57 | app/[locale]/store/[sku]/page.tsx:93 | PartDetailPage |
| 22 | 56 | app/[locale]/projects/[id]/engineering/page.tsx:54 | EngineeringPage |
| 23 | 55 | lib/studio/wiring3d/route.ts:298 | (anonymous) |
| 24 | 55 | lib/studio/ai/spec-guards.ts:189 | guardSpec |
| 25 | 55 | lib/studio/ai/pick.ts:161 | enforcePick |
| 26 | 54 | app/api/design-quote/route.ts:29 | POST |
| 27 | 51 | lib/studio/wiring3d/layout.ts:239 | layoutMat |
| 28 | 51 | app/[locale]/store/checkout/checkout-client.tsx:37 | CheckoutClient |
| 29 | 50 | components/credits/cad-card.tsx:90 | CadCard |
| 30 | 49 | lib/studio/wiring3d/breadboard.ts:176 | plugFor |
| 31 | 46 | app/api/analyse/route.ts:80 | start |
| 32 | 45 | lib/prototyping/readiness.ts:110 | projectReadiness |
| 33 | 45 | components/parts/part-form.tsx:25 | PartForm |
| 34 | 45 | app/[locale]/store/checkout/checkout-client.tsx:132 | handleSubmit |
| 35 | 44 | lib/studio/card-parts.ts:121 | cardItems |
| 36 | 43 | lib/studio/sim/model.ts:214 | simModel |
| 37 | 43 | components/studio/steps/PartsStep.tsx:609 | PartsPicturePane |
| 38 | 42 | app/[locale]/dashboard/usage/page.tsx:39 | UsagePage |
| 39 | 41 | components/studio/steps/IdeaStep.tsx:56 | IdeaStep |
| 40 | 41 | components/admin/videos-youtube.tsx:210 | ClipRow |

### 1b. Longest functions (top 25 by lines, blanks/comments skipped)

| lines | file:line | function |
|---|---|---|
| 1081 | components/prototyping/workspace.tsx:138 | PrototypingWorkspace |
| 638 | lib/studio/product/solve.ts:651 | solveProduct |
| 620 | components/studio/steps/wiring/Wiring3DView.tsx:486 | Scene |
| 608 | app/[locale]/dashboard/customers/[id]/page.tsx:24 | CustomerPage |
| 561 | lib/studio/schematic.ts:147 | renderSchematicSVG |
| 561 | components/studio/StudioShell.tsx:122 | StudioShellInner |
| 462 | app/[locale]/store/checkout/checkout-client.tsx:37 | CheckoutClient |
| 443 | components/prototyping/idea-stage.tsx:101 | IdeaStage |
| 432 | components/studio/steps/EnclosureTemplate.tsx:82 | EnclosureTemplateFlow |
| 428 | components/credits/cad-card.tsx:90 | CadCard |
| 412 | app/[locale]/projects/[id]/engineering/page.tsx:54 | EngineeringPage |
| 396 | components/admin/studio-library/part-form.tsx:42 | StudioPartForm |
| 395 | lib/prototyping/electronics-rules.ts:170 | deriveElectronics |
| 382 | lib/studio/wiring-drawing.ts:272 | renderWiringSVG |
| 372 | app/[locale]/pricing/page.tsx:49 | PricingPage |
| 361 | components/admin/fix-list.tsx:53 | FixList |
| 357 | components/studio/steps/PartsStep.tsx:154 | PartsStep |
| 356 | components/design/quote-request.tsx:43 | QuoteRequest |
| 354 | components/prototyping/tree-nav.tsx:73 | TreeNav |
| 346 | app/[locale]/dashboard/store/orders/[id]/page.tsx:29 | OrderDetailPage |
| 344 | components/studio/GetItMade.tsx:38 | GetItMade |
| 337 | components/parts/cart-provider.tsx:110 | CartProvider |
| 333 | app/[locale]/dashboard/usage/page.tsx:39 | UsagePage |
| 330 | components/studio/steps/EnclosureProduct.tsx:54 | EnclosureProduct |
| 330 | components/projects/new-project-form.tsx:36 | NewProjectForm |

### 1c. Top 25 files by lines (app, components, lib; tests excluded)

| lines | file |
|---|---|
| 1402 | components/studio/steps/wiring/Wiring3DView.tsx |
| 1387 | lib/studio/product/solve.ts |
| 1370 | components/prototyping/workspace.tsx |
| 1080 | components/projects/project-workspace.tsx |
| 1008 | lib/studio/netlist.ts |
| 965 | components/prototyping/bom-table.tsx |
| 889 | lib/studio/schema.ts |
| 856 | components/studio/StudioShell.tsx |
| 841 | components/studio/steps/PartsStep.tsx |
| 829 | lib/studio/wiring3d/layout.ts |
| 776 | components/studio/viewer/Viewer.tsx |
| 758 | lib/studio/schematic.ts |
| 741 | lib/studio/geometry/product-kernel.ts |
| 698 | lib/studio/wiring-drawing.ts |
| 693 | components/admin/videos-youtube.tsx |
| 691 | app/[locale]/dashboard/customers/[id]/page.tsx |
| 661 | components/studio/steps/IdeaStep.tsx |
| 655 | lib/studio/enclosure/build.ts |
| 638 | lib/prototyping/electronics-rules.ts |
| 637 | components/admin/fix-list.tsx |
| 628 | lib/studio/product/forms/geometry.ts |
| 619 | components/prototyping/idea-stage.tsx |
| 594 | components/admin/quick-entry.tsx |
| 575 | components/studio/steps/EnclosureTemplate.tsx |
| 563 | app/[locale]/store/checkout/checkout-client.tsx |

Duplication that cuts across these files (jscpd): Wiring3DView.tsx:497-519 = Viewer.tsx:242-264 (23 lines); Wiring3DView.tsx:1376 = Viewer.tsx:720 (21 lines); `KEY_DIR/FILL_DIR/RIM_DIR`, `BG`, `EXPOSURE`, `ENV_INTENSITY`, `PCB_ENV_INTENSITY`, `CONTENT_ROT`, `Lights`, `CameraRig`, `OrbitControlsImpl` exist twice (Viewer.tsx:62-80,524-750; Wiring3DView.tsx:96-100,1241-1306). EnclosureProduct.tsx:216 = EnclosureTemplate.tsx:404 (22); EnclosureTemplate.tsx:94 = PrintStep.tsx:130 (19). api/admin/customers/[id]/export/route.ts:3 = api/admin/projects/[id]/export/route.ts:3 (29 lines).

### 1d. Proposed splits (14 files)

Rule for every split: the original path stays as a thin barrel / entry component that re-exports the public API, so importers do not change in the first pass. Importers: schema.ts 61 `@/` importers, netlist.ts 16 (+ relative importers), others 0-1.

**1. components/studio/steps/wiring/Wiring3DView.tsx (1402)** (public: `Wiring3DView({doc, locale})`, line 172)
| new module | moves |
|---|---|
| wiring/wiring3d-constants.ts | consts L95-115, `movesKey/loadMoves/saveMoves` L117-144 |
| wiring/WireMaterials.ts | `wireMaterial`, `sleeveGeometry`, `hitMaterial`, `noRaycast` L414-450 |
| wiring/WiringScene.tsx | `Scene` L486-1172 split further into hooks: `useWires` (L571-661), `useBuildGuide` (L663-690), `usePinDecals` (L691-739), `useSimOverlay` (L740-771), `useMatDrag` (L974-1105), `usePointerHover` (L952-973); `Scene` keeps the useFrame loop L882 |
| wiring/WiringRig.tsx | `Mat`, `BreadboardModel`, `Lights`, `CameraRig` L1192-end. `Lights`/`CameraRig`/light consts are identical to viewer/Viewer.tsx, so move them to `viewer/rig.tsx` and import from both |
| stays | `Wiring3DView.tsx`: component L172-398, `EndLabel`, `CanvasBoundary`, `hasWebGL` |

**2. lib/studio/product/solve.ts (1387)** (public: `solveProduct`, `solvedHash`, `MK4_BED`, 19 exports)
| new module | moves |
|---|---|
| product/solve-types.ts | types L83-208 (SolvedProduct, SolverIssue, PrintPlan, ...) |
| product/solve-geometry.ts | `localBox`, `fitsMk4`, `poseSize`, `gramsFor`, `contactAnchor`, `splitOffset`, `isStacked`, `unionBoxes`, `toLocal/toWorld` L240-313, L381-382, L1355 |
| product/solve-place.ts | `placeBodies` L321-380 + pass 1/pass 2 placement blocks of solveProduct (L776-966) |
| product/solve-fit.ts | `fitInside`, `pushToWalls`, `widestSection`, `ensureHomes`, `resolveShell` L384-646 |
| product/solve-checks.ts | floating/overlap/USB/outlet checks (solveProduct body ~L1097-1200), printability+explode (~L1207-1355), `dedupeIssues` |
| stays | `solve.ts`: `solveProduct` orchestrator (~150 lines), `solvedHash`, re-exports of types |

**3. components/prototyping/workspace.tsx (1370)** (public: `PrototypingWorkspace`)
| new module | moves |
|---|---|
| prototyping/use-workspace-data.ts | `load`, `loadMatches`, project/parts/items state, L165-380 |
| prototyping/use-workspace-actions.ts | `patchProject`, `goTo`, `saveSpec`, `setBranch`, `acceptRoute`, `chooseProduct`, `dismissLines`, `chooseRoute` (L428-534) |
| prototyping/use-panels.ts | `PANELS_KEY`, `savedPanels`, `togglePanel`, view mode (L119-137, L254-290) |
| prototyping/workspace-stages.tsx | `designStage`, `bomTable`, `stageAction`, `fixButton`, node switch (L538-1370 render) |
| stays | `workspace.tsx`: shell, header bar, not-available state |

**4. components/projects/project-workspace.tsx (1080)**
| new module | moves |
|---|---|
| projects/use-project-data.ts | `useBomMatches` (L80), `load` L138-233 |
| projects/project-header.tsx | `ProjectHeader`, `PrototypingCard`, `ProjectSkeleton` L328-434 |
| projects/brief-card.tsx | `BriefCard` L440-506 |
| projects/blocks-card.tsx | `BlocksCard`, `IconBtn` L509-724 |
| projects/items-card.tsx | `ItemsCard`, `ItemStatusTags` L727-977 |
| projects/danger-zone-card.tsx | `DangerZoneCard` L981-end |
| stays | `ProjectWorkspace` L114-327 |

**5. lib/studio/netlist.ts (1008)** (public: 47 exports, 16 external importers; re-export everything)
| new module | moves |
|---|---|
| studio/netlist-parts.ts | role/part predicates L27-111, `splitRef`, `chargerPins`, `shifterChannels`, `RAIL_RANGE`, `DEV_TO_MCU/MCU_TO_DEV`, `servoSupplyRail` (this breaks the cycle with plain-checks, see section 2) |
| studio/netlist-power.ts | `Rail`, `planPower`, `railFor`, `effectiveLogic` L159-338 |
| studio/netlist-required.ts | `resolveRequired`, `ADDED_REASON` L339-458 |
| studio/netlist-build.ts | `NetBook`, `PinPool`, `netCodes`, `buildNetlist` L459-834 |
| studio/netlist-legacy.ts | `toLegacyNetlist`, `legacyFunction`, `buildWiring` L835-1008 |
| stays | `netlist.ts` barrel |

**6. components/prototyping/bom-table.tsx (965)**
| new module | moves |
|---|---|
| prototyping/bom-cost-summary.tsx | `CostSummary` L98-165 |
| prototyping/bom-quote-request.tsx | `QuoteRequest` L166-338 (also name-clashes with components/design/quote-request.tsx; rename `BomQuoteRequest`) |
| prototyping/use-is-super-admin.ts | `useIsSuperAdmin` L339-364, which also calls Supabase from a component (see section 3) |
| prototyping/bom-row.tsx | `Row` L651-953 (CC 92), `Why` L954 |
| prototyping/use-bom-actions.ts | `add`, `buyKit`, order status effect L427-485 |
| stays | `BomTable` L365-650 |

**7. lib/studio/schema.ts (889)** (113 exports, 61 importers)
| new module | moves |
|---|---|
| studio/schema-enums.ts | enum arrays and derived types L18-123 + `LIMITS` L129 |
| studio/schema-zod.ts | Zod schemas L154-445 (spec, part, enclosure, mech, component, doc) |
| studio/schema-clamp.ts | `ClampLog`, `pickEnum`, `clampNum/Str`, `clampSpec`, `clampActuators`, `clampUnderstanding`, `clampEnclosure`, `clampMechPart(s)` L446-870 |
| studio/schema-defaults.ts | `DEFAULT_SPEC`, `DEFAULT_ENCLOSURE`, `PHASE_TEMPLATES`, `THROUGH_LID`, `MECH_PARAMS`, `emptyStudioDoc`, `parseStudioDoc` |
| stays | `schema.ts` barrel with `export *` from the four. Also moves `ARCHETYPES/Archetype` to a leaf (cycle fix) |

**8. components/studio/StudioShell.tsx (856)** (public: `StudioShell`, `StudioCtx`)
| new module | moves |
|---|---|
| studio/studio-ctx.ts | `StudioCtx` L69-78 (cycle fix, section 2) |
| studio/use-studio-save.ts | refs, `refreshStatus`, `flush`, `commit`, retry effect L132-250 |
| studio/use-studio-navigation.ts | `go`, `next`, `furthest`, URL/step effects L251-345 |
| studio/use-studio-handlers.ts | `docForCard`, `onIdeaConfirmed`, `onIdeaDraft`, `onComponents`, `onWiring`, `onEnclosure`, `onMech`, `onFirmware`, `showIn*`, `onProduct*` L370-540 |
| studio/studio-banners.tsx | `FadedBanner`, `ClassBanner`, `StepSlide`, `sameBoard` L761-856 |
| stays | `StudioShell` / `StudioShellInner` render |

**9. components/studio/steps/PartsStep.tsx (841)**
| new module | moves |
|---|---|
| steps/parts/PartTile.tsx | `CATEGORY_ICON`, `PartTile`, `PartPopover` L60-153 |
| steps/parts/PartChoices.tsx | `PartChoices` L538-582 |
| steps/parts/PartsPicturePane.tsx | `usePictureSize`, `PartsPicturePane` (CC 43; imported by MakeStep.tsx:30), `PartsSpots` L583-841 |
| steps/parts/use-parts-actions.ts | `pick`, `swap`, `add`, `edit`, colour-backfill effect L185-260 |
| stays | `PartsStep` |

**10. lib/studio/wiring3d/layout.ts (829)**
| new module | moves |
|---|---|
| wiring3d/types.ts | `MatItem`, `PlacedHole`, `Placement`, `MatLayout`, `Rot` L54-92 (cycle fix with rails.ts) |
| wiring3d/pose.ts | `GAP..FIRST_COL` consts, `rotXY`, `poseLocal`, `pinWorld`, `footprint` L94-148 |
| wiring3d/layout-mat.ts | `linksOf`, `pinNetMap`, `helperLegs`, `occupantOf`, `plugged`, `unplugged`, `layoutMat` (CC 51), `servoGroup`, `rotToward`, `boundsOf` L149-694 |
| wiring3d/move.ts | `MatMoves`, `obstacles`, `resolveMove`, `snapToBreadboard`, `settleMove`, `movePart`, `applyMoves`, `apartLift` L695-829 |
| stays | `layout.ts` barrel (1 importer via `@/`) |

**11. components/studio/viewer/Viewer.tsx (776)**
| new module | moves |
|---|---|
| viewer/rig.tsx | `Lights`, `placeLights`, `CameraRig`, `boundsAt`, light constants L524-750 (shared with Wiring3DView) |
| viewer/Plate.tsx | `Plate` L750-776 |
| viewer/use-viewer-placements.ts | placements/explode/enclosure keys L263-343 of `Scene` |
| viewer/ViewerScene.tsx | `Scene` L225-523 |
| stays | `Viewer` L84-224 (default export), type re-exports |

**12. lib/studio/schematic.ts (758)** (`renderSchematicSVG` CC 176, 561 lines)
| new module | moves |
|---|---|
| studio/schematic-style.ts | look/size consts L47-81, `KIND_TEXT`, `POWER_TEXT`, `ENV_TEXT`, `CHIP`, `summaryLine` L66-110 |
| studio/schematic-model.ts | entries, net kinds/colours, inline chains, board pin sides (renderSchematicSVG L147-420) as a pure `buildSchematicModel()` returning items/columns |
| studio/schematic-layout.ts | column order, vertical + horizontal layout, wire routing, `clash` |
| studio/schematic-svg.ts | string emission only |
| stays | `schematic.ts`: `SchematicOpts`, `renderSchematicSVG` = model -> layout -> svg |
Same shape applies to lib/studio/wiring-drawing.ts (CC 157).

**13. app/[locale]/dashboard/customers/[id]/page.tsx (691)**
| new module | moves |
|---|---|
| lib/admin/customer-data.ts | the 14 queries L48-100 + `soft()`; `lib/admin/customer-export.ts:172-197` runs the same 13 queries, so both use one `loadCustomerBundle(db, id)` |
| app/.../customers/[id]/sections/*.tsx | one server component per `Panel` (profile, projects, orders, items, leads, ledger, payments, pass, sessions, ai, jobs, cad, signals, outbox; L212-660) |
| app/.../customers/[id]/panel.tsx | `Panel` L666-691 |
| stays | `page.tsx`: auth, bundle load, header (L198), section list (under 120 lines) |

**14. app/[locale]/store/checkout/checkout-client.tsx (563)**
| new module | moves |
|---|---|
| lib/store/checkout-totals.ts | `priceOf`, `splitExtraQar`, `creditQar`, `grandTotal`, `placedTotal` (L62-97, L232) as pure functions + test |
| lib/store/place-order.ts | `handleSubmit` core L132-300: validation (L141-165), RPC call with PGRST202 fallbacks (L183-215), `redeem_credits`, `set_order_payment_method`, `LAST_ORDER_KEY` snapshot; takes a supabase client, returns `{ok, orderId} or {error key}` |
| app/.../checkout/order-summary.tsx | right-hand summary and tier picker markup |
| app/.../checkout/customer-fields.tsx | form fields, `label`, `mono` |
| stays | `CheckoutClient` state + submit wiring |

Note: line ranges for function-internal blocks (solveProduct, Scene, StudioShellInner, checkout handleSubmit) are approximate, taken from comment markers and hook positions; module-level ranges come from top-level declarations. Confirm when splitting.

## 2. Import cycles (madge, 20)

Pattern A (12 cycles, #7, 9-19): every step file does `import type { StudioCtx } from "../StudioShell"` while StudioShell imports the step. Type-only, erased at build, so no runtime bug, but it makes madge red and blocks splitting StudioShell. One fix for all 12: create `components/studio/studio-ctx.ts` exporting `StudioCtx` (defined at StudioShell.tsx:69-78; needs only `StudioApi`, `Locale`, `FlowStep`), re-export it from StudioShell, change 12 imports. Files: steps/CodeStep.tsx:20, EnclosureStep.tsx:19, EnclosureProduct.tsx:42, ProductEngineer.tsx:15, share.tsx:16, EnclosureTemplate.tsx:51, IdeaStep.tsx:48, MakeStep.tsx:26, PartsStep.tsx:44, PrintStep.tsx:43, PrintProduct.tsx:18, WiringStep.tsx:24. (BASELINE says x13; madge output lists 12.)

| # | cycle | edge that closes it | cheapest fix |
|---|---|---|---|
| 1 | lib/prototyping/bom.ts <> electronics-rules.ts | bom.ts:51 `import("./electronics-rules").LevelFlag[]` (type) vs electronics-rules.ts:35 `import type { ProjectLine } from "./bom"` | move `LevelFlag` (electronics-rules.ts:53) to `lib/prototyping/analysis.ts` (bom.ts already imports from it); re-export from electronics-rules (plain-safety.ts:9 imports it) |
| 2 | lib/supabase/types.ts <> prototyping/bom.ts | types.ts:4 `import type { ProjectBom }` vs bom.ts:22 `import type { Part }` | create `lib/prototyping/bom-types.ts` with `ProjectLine/ProjectBom/LineOrigin/Fulfilled` (bom.ts:28-56); types.ts imports from there |
| 3 | lib/studio/schema.ts > product/schema.ts > forms/clamp.ts > forms/params.ts | schema.ts:16 `import type { Archetype } from "./product/schema"` (used once, schema.ts:397) | move `ARCHETYPES/Archetype` (product/schema.ts:26-31) to leaf `lib/studio/product/archetype-names.ts`; schema.ts imports the leaf; product/schema re-exports |
| 4 | schema.ts > product/schema.ts > forms/clamp.ts | same edge (clamp.ts:7 and params.ts:16 import `../../schema`) | same fix as #3 |
| 5 | schema.ts > product/schema.ts | same edge | same fix as #3 (one edge closes #3, #4, #5) |
| 6 | lib/youtube-upload.ts <> youtube-retire.ts | youtube-upload.ts:23 `parseRetireList` (runtime) vs youtube-retire.ts:14 `import type { YoutubeMeta }` | move `YoutubeMeta/UploadRecord/QuotaState` (youtube-upload.ts:124-131) into youtube-retire.ts or new `lib/youtube-types.ts`; re-export from youtube-upload |
| 7, 9-19 | StudioShell <> 12 step files | see pattern A | `studio-ctx.ts` |
| 8 | lib/studio/netlist.ts <> plain-checks.ts | netlist.ts:24,1006 `studioChecks` (runtime) vs plain-checks.ts:13-38 imports 13 runtime helpers (`isMcu`, `splitRef`, `RAIL_RANGE`, `DEV_TO_MCU`, ...) from `./netlist`. Only real runtime cycle; works today because consumers only use functions at call time, but a top-level const read would hit TDZ | extract predicates/consts (netlist.ts:27-111, 117, 134, 185, 300-303, 841) to `studio/netlist-parts.ts`; both files import it; netlist.ts re-exports |
| 20 | lib/studio/wiring3d/layout.ts <> rails.ts | layout.ts:52 `railNets` (runtime) vs rails.ts:12 `import type { MatLayout }` | move `MatItem/Placement/MatLayout` (layout.ts:56-92) to `wiring3d/types.ts`, or type rails.ts's parameter structurally (it only uses `placements` and `breadboard`) |

Net: 5 small edits remove all 20 cycles (studio-ctx, archetype-names, bom-types/LevelFlag, YoutubeMeta, netlist-parts, wiring3d types). Add `madge --circular --extensions ts,tsx --ts-config tsconfig.json app components lib` as a CI script after.

## 3. Layering

### 3a. Data-access styles (count of call sites, non-test)

| style | evidence | size |
|---|---|---|
| 1 server component / page, RLS client (`lib/supabase/server`) | `.from(`/`.rpc(` in 49 `page.tsx` (app/[locale]), 3 async components (components/dashboard/admin-overview.tsx 18 calls, admin-home.tsx, continue-card.tsx) | app/[locale]: 229 `.from` + 30 `.rpc` in 76 files |
| 2 server component, service-role client | `supabase/service` imported by 5 pages | with routes 17, actions 1, lib 5 |
| 3 server action | 26 `"use server"` files, 25 query the DB | all under app/[locale]/dashboard, inventory, schools |
| 4 API route + browser `fetch("/api/...")` | 62 routes (91 `.from`, 27 `.rpc` in 34 files); 33 client files fetch `/api` (lib/studio/client/api.ts 3, components/engineering/step-panel.tsx 3, prototyping/workspace.tsx 2, projects/new-project-form.tsx 2, admin/voltaat-sync.tsx 2) | |
| 5 browser Supabase client direct | 33 files in components/ + app/[locale]/store/checkout/checkout-client.tsx import `supabase/client`; 134 `.from` + 10 `.rpc` sites in 30 component files | project-workspace.tsx 21, cart-provider.tsx 19, workspace.tsx 10, my-inventory.tsx 7, your-work-strip.tsx 7, project-list.tsx 6 |
| 6 RPC (SECURITY DEFINER) from any of the above | 105 `.rpc(` sites: app/api 27, app/[locale] 30, components 10, lib 38 | create_part_order called from the browser (checkout-client.tsx:183) |
| 7 lib data modules | 49 lib files, 151 `.from` + 38 `.rpc` (lib/store/public-catalog.ts cached anon reads, lib/studio/server/*, lib/credits/server.ts) | the only layer with a clear boundary |
| 8 raw PostgREST fetch | middleware.ts site_v2 flag; lib/supabase/middleware.ts | 1 place |

8 styles; 44 distinct tables hit through `.from()`, 12 have hand types (section 5). Same query is written 2-3 times: customer detail page (page.tsx:48-100) vs lib/admin/customer-export.ts:172-197; admin-overview.tsx:61 open-order statuses vs lib/orders/status.ts:36 `OPEN_ORDER_STATUSES` vs lib/admin/home-tiles.ts:13 `ORDER_STATUSES_TO_HANDLE` (three different lists; the first omits "shipped").

### 3b. Business rules sitting in pages/components

| rule | where | belongs in |
|---|---|---|
| order total = goods - credit + shipping + handling, rounded | app/[locale]/store/checkout/checkout-client.tsx:62-90 (`priceOf`, `splitExtraQar`, `creditQar`, `grandTotal`), :232 `placedTotal` | lib/store/checkout-totals.ts (+ test). Server RPC is the authority; client mirrors it, so a test pinning both is valuable |
| cart total with kit discount | components/parts/cart-provider.tsx:479-482 (`cartTotal`, `kitDiscountQar` in lib/parts/cart.ts, untested) | lib/parts/cart.ts + test |
| landed cost and suggested price (FX, overhead, markup, ceil to 0.5) | components/admin/supplier-lookup.tsx:107-108 | lib/sourcing or lib/pricing |
| estimated revenue | app/[locale]/dashboard/store/restock/page.tsx:91 | lib/store/restock.ts (exists, tested) |
| fixed price write rounding | app/[locale]/dashboard/store/fix/actions.ts:156, usage/actions.ts:17 | lib/pricing |
| "open order" status set | components/dashboard/admin-overview.tsx:61 | lib/orders/status.ts (use `OPEN_ORDER_STATUSES`) |
| ETA / overdue minutes | app/[locale]/dashboard/engineering-jobs/page.tsx:63,146-153 | lib/engineering/view.ts (untested) |
| week/month windows | admin-overview.tsx:33-34, store/overview/page.tsx:66, engineering-jobs/page.tsx:63, usage/page.tsx:58,118 (`86400000`, `864e5`) | lib/dates |
| credit redeemable-until check | app/[locale]/dashboard/credits/page.tsx:275-276 | lib/credits/redeem-window.ts (exists) |
| "order confirmation allowed within 60 minutes" | app/api/orders/confirmation/route.ts:26 | lib/orders |
| form validation (required, phone, email, totals) | checkout-client.tsx:141-165; components/design/quote-request.tsx; components/projects/new-project-form.tsx | lib/*/validate.ts, ideally zod |
| super_admin check | inline `role === "super_admin"` 79 times in 129 files; 8 copy-pasted local `requireAdmin()` helpers (dashboard/store/*/actions.ts, e.g. suppliers/voltaat/actions.ts:22) | one `lib/auth/require-admin.ts` |

### 3c. Components that call Supabase directly (33 files)

admin/studio-library/part-form.tsx; auth/{forgot-password,reset-password,sign-in,sign-out,sign-up,social-sign-in}; credits/cad-card.tsx; dashboard/{admin-home,admin-overview,continue-card} (server); design/quote-request.tsx; inventory/my-inventory.tsx; parts/add-to-project-button.tsx; projects/{new-project-chat,new-project-form,project-cad-card,project-list,project-parts-list,project-workspace}.tsx; prototyping/{bom-table,client/client-wiring,client/client-workspace,idea-stage,netlist-view,part-dialogs,parts-list,parts-stage,payment-card,schematics-stage,use-project-boards,workspace}; schools/join-form.tsx; search/unified-search.tsx; studio/DeleteProject.tsx. Auth forms are expected. The rest (project/prototyping/inventory/cart) are the candidates to move behind lib hooks or actions. Six more component files run `.from(` without a static `supabase/client` import (home/your-work-strip.tsx, pricing/invite-price.tsx, projects/phone-prompt.tsx, payments/fawran-checkout.tsx, parts/cart-provider.tsx, parts/add-to-project-button.tsx); likely via lib/supabase/lazy.ts (unverified).

### 3d. Impure lib/

| module | issue |
|---|---|
| lib/credits/use-credits.ts:16, lib/pricing/use-price-quote.ts:10, lib/schools/client.ts:16, lib/store/use-delivery-quote.ts:3 | React hooks in lib/ (belong in components/hooks or `lib/*/client`) |
| lib/contact-phone-server.ts:13, lib/store/shipping-settings.ts:7 | `react` `cache()` (server-only, fine, but not marked `server-only`) |
| lib/meta.ts:6, lib/admin/project-export.ts:12, lib/prototyping/electronics-build.ts:18, lib/prototyping/providers/rules.ts:7 | `next-intl/server` `getTranslations` inside domain logic: export/rules code cannot be unit-tested without Next |
| lib/supabase/server.ts:1 | `next/headers` (expected) |
| lib/supabase/middleware.ts:1 | `next/server` types (expected) |
| `next/cache` `unstable_cache`: lib/site-v2-server.ts:8, contact-phone-server.ts:14, turnstile-server.ts:1, studio/cad-setting.ts:6, studio/library/remote.ts:7, auth/providers-server.ts:10, cad/engine-server.ts:6, store/public-catalog.ts:13, store/shipping-settings.ts:8, cache/storefront.ts:29 | caching in lib is acceptable; only 10 lib files carry `server-only` |
| 14 lib files with `"use client"` (lib/studio/client/*, lib/supabase/{lazy,guest}.ts, lib/google/drive-picker.ts, lib/cad/render.ts, ...) | client code in lib/ |

### 3e. API routes with logic that belongs in lib/

| route | lines / CC | logic inside |
|---|---|---|
| app/api/store-lead/route.ts | 388 / 111 | `SOURCES` label table (:27-66), STL path validation `printFiles` (:74), `leadAllowed` (Turnstile, :108), `quoteItems` (:123), lead insert, owner email; -> lib/leads/{sources,parse,save}.ts |
| app/api/admin/youtube/upload/route.ts | 309 / 70 | YouTube resumable upload, captions, thumbnails, store_settings writes (:108-290); -> lib/integrations/youtube-server.ts (exists, untested) |
| app/api/analyse/route.ts | 235 / 46 | credit gate, daily guard, provider call, metering stream, analysis_runs writes; -> lib/prototyping/analyse-run.ts |
| app/api/design-quote/route.ts | 191 / 54 | validation, signed upload paths, inquiry insert |
| app/api/orders/review/route.ts | 162 | HTML page rendering, token check, RPC |
| app/api/cron/delivery-promises/route.ts | 116 | re-quote delivery date with holidays/handling/transit/buffer (:37-101); -> lib/store/delivery-promises.ts (working-days.ts exists and is tested) |
| app/api/orders/confirmation/route.ts | 58 | 60-minute window, claim-then-send idempotency, Arabic name lookup, holidays flag |
| app/api/admin/{customers,projects}/[id]/export/route.ts | 29 duplicated lines | shared admin-gate + zip response helper |
Good pattern to copy: app/api/studio/* thin routes over lib/studio/server/* (tested in lib/studio/server/product-routes.test.ts).

## 4. Consistency

### 4a. File naming in components/ (258 files)
kebab-case 213, PascalCase 45. Every folder is pure kebab except `components/studio/**` (Pascal 42, kebab 11): studio 9 Pascal + 4 kebab; steps 13 + 2; steps/code 3 + 0; steps/wiring 9 + 4; viewer 11 + 5. lib/ is kebab (406) except 47 snake_case + 18 camelCase part-definition files in lib/studio/library/parts (data, named after part ids). app/ is 100 % kebab. Structure collisions: `lib/email.ts` next to `lib/email/`; `lib/youtube*.ts` x4 at root; `lib/store`, `lib/parts`, `lib/sourcing`, `lib/inventory` overlap; `components/payment/` and `components/payments/`; `lib/studio/client/` etc.

### 4b. Error-handling shapes

| context | shape (count) |
|---|---|
| API routes | `Response.json({ error: "code" }, {status})` 119; `NextResponse.json({ error })` 16 (mixed class use); empty `new Response(null,{status})` 45; success bodies `{ ok: true }` 11+8, `{ sent }` 9, bespoke (`{tokens}`, `{doc}`, `{job}`...); error values include `r.error`, `cur.error`, `denied.error` passthroughs (30+) |
| server actions | `{ ok: false, error: "code" }` 64; `{ ok: false, message }` 8; `{ ok: false, errors: [...] }` 8; `{ ok: false, error, bad }`; `{ ok: false, checks }`; `{ error?: string }` (PartFormState, ItemFormState); `{ ok } | null` (OrderStatusState); ~30 named result types (SaveResult, ClassActionResult, ...) |
| lib | `{ ok: false ... }` 168 sites; `throw new Error` 47 (lib), 14 (actions), 2 (routes) |
| redirects | `redirect(` 30 in actions |
Distinct shapes: 5 for routes, 7 for actions. No shared `Result<T,E>` type.

### 4c. Loading / empty / error states
- `loading.tsx`: **0**. `error.tsx` / `global-error.tsx`: **0**. `not-found.tsx`: 2 (app/not-found.tsx, app/[locale]/not-found.tsx); `notFound()` called in 24 pages.
- `<Suspense>` used in 6 files only. Class-based error boundaries: 2 (components/studio/viewer/LeanCanvas.tsx, Wiring3DView.tsx). A thrown server error on any of 104 pages shows Next's default error page; 137 files carry `force-dynamic`.

### 4d. Server/client boundary
- `"use client"`: 219 files (components 200, app 5, lib 14). app pages that are client: store/cart/page.tsx, store/checkout/success/page.tsx.
- Likely server-capable (no hooks except next-intl, no handlers, no browser APIs): components/prototyping/client/step-card.tsx, client/client-make.tsx, studio/steps/code/WireSnippet.tsx, feature-video-client.tsx (its parent is likely already a server component; unverified). The other 7 flagged by heuristic need the directive (useActionState, `dynamic(ssr:false)` wrappers).

### 4e. Validation: zod vs hand-written
zod in 22 non-test files (8 routes: studio/doc, studio/product/engineer, cad, engineering/jobs, engineering/jobs/[id]/return, billing/{service,proof,checkout}). 62 routes, 26 call `request.json()`, 21 of those cast the result with `as {...}` instead of parsing. Server actions: 10 read `FormData.get` by hand. So 54 of 62 routes use hand checks (`typeof x === "string"`, regex, `clamp*`).

### 4f. Formatters (callers = references outside the definition, non-test)

| helper | defined | refs / files |
|---|---|---|
| formatPrice (QAR, 2 dp, "ر.ق") | lib/parts/format.ts:4 | 107 / 30 |
| formatQar (en-US grouping) | lib/pricing/plans.ts:100 | 56 / 17 |
| qar (email; int-or-2dp) | lib/email/templates/layout.ts:87 | 8 / lib/email |
| qarAmount | lib/store/shipping.ts:88 | 4 / 3 |
| qarFormatter / usdFormatter | app/[locale]/dashboard/ai-costs/format.ts:62,7 | 10 / 6 and 6 / 4 |
| local `qar()` | components/studio/RequestReceived.tsx:42 | 1 |
| local `fmt()` | components/admin/quote-form.tsx:16, quote-calc-card.tsx:12, quote-accuracy.tsx:11 | 3 copies |
| local `money` | app/.../schools/classes/[id]/page.tsx:41 (`toFixed(2)`), dashboard/store/discounts/page.tsx:77, kit-money.ts:11, services-panel.tsx:45 | 4 |
| formatDeliveryDate | lib/store/delivery.ts:64 | 29 / 8 |
| formatOccasionDate / formatReviewDate / email `formatDate` | lib/occasions.ts:255, lib/reviews/reviews.ts:113, lib/email/templates/layout.ts:93 | 6 / 4 / 7 |
| `Intl.DateTimeFormat(` inline | 46 sites in 37 files; locale tags `en-GB` x51, `ar-QA-u-nu-latn` x46, `ar-QA` x5, `en-US` x6 | |
| `Intl.NumberFormat(` inline | 17 | |
| `toLocale*String` | 8 | |
| formatPhoneDisplay / toWhatsAppDigits / normalizePhone / isValidPhone | lib/phone.ts | 27 / 19 / 22 / 32 (one module, consistent) |
| formatFileSize | lib/format-bytes.ts:8 | 8 / 5 |
| arabicCountForm | lib/text/count.ts | 43 / 20 |
| `Math.round(x*100)/100` hand-rounding | 19 sites (5 in app/components) | |
Result: 7 money formatters with 3 different outputs ("QAR 12.50", "12.50 ر.ق", "12.5", grouped), none uses Intl currency. Date format strings are re-declared in 37 files.

### 4g. Locale handling
Locale union type declared 13 times (i18n/routing.ts:8 `Locale`, plus app/api/orders/rate/route.ts:20, unsubscribe/route.ts:15, lib/seo.ts:15, studio/netlist.ts:28, studio/client/api.ts:22, prototyping/plain-names.ts:16, orders/rating-page.ts:10, email/brand-layout.ts:16, studio/ai/spec-guards.ts:18, reviews/reviews.ts:5, email/templates/layout.ts:10, orders/review/route.ts:21). `locale === "ar"` appears 254 times; `isRtl/isAr` re-derived in 102 places. Helpers: i18n/{routing,request,navigation}.ts, lib/i18n/{scopes,pick-messages}.ts, lib/text/bidi.ts; no shared `isRtl(locale)`, `dir()` or `pick(locale, {en, ar})` helper. `setRequestLocale` in 111 files, `useLocale` in 61.

## 5. Types

### 5a. `any`
BASELINE's 15 is a regex false positive (8 are the word "any" in comments/CSS/identifiers such as `anyToConfirm`). Real typed `any`: **7**.
| file:line | use | reason |
|---|---|---|
| lib/google/drive-picker.ts:12 (`eslint-disable no-explicit-any`), :15 `gapi?: any`, :16 `google?: any`, :83 `(data: any)`, :87 `(d: any)` | Google Picker globals | no @types/google.picker installed; fix with a local interface for the 4 fields used |
| lib/projects/uses-ai.test.ts:12, :15, :17 | test fixtures (`spec: any`, `{} as any`) | partial objects; use `as unknown as Spec` or a factory |
`@ts-ignore/@ts-expect-error`: 0.

### 5b. `as unknown as` (97 = 62 production + 35 tests)

| group | count (prod) | sites | reason it exists |
|---|---|---|---|
| Supabase untyped select rows cast to a row type | 35 | app: dashboard/store/actions.ts:373, suppliers/lookup/actions.ts:80,235, suppliers/voltaat/page.tsx:65, suppliers/import/actions.ts:106, gaps/page.tsx:60, orders/page.tsx:45, orders/[id]/page.tsx:92, [id]/edit/page.tsx:87, inventory/page.tsx:63, projects/[id]/page.tsx:34; api: admin/store-cleanup/route.ts:258, cron/delivery-promises/route.ts:63; components: home/your-work-strip.tsx:81,89,107,191,203, projects/project-list.tsx:113,149, project-workspace.tsx:208, prototyping/part-dialogs.tsx:141, parts/cart-provider.tsx:168; lib: studio/client/api.ts:335, admin/order-lines.ts:79, admin/continue-projects.ts:63, prototyping/bom-server.ts:42, sourcing/voltaat-sync.ts:97, sourcing/api-refresh.ts:92, store/public-catalog.ts:193,215,399,454,500, schools/server.ts:61 | no generated `Database` type, clients are `createClient()` with no generic, so joined selects come back as `any`-ish; a generated type would remove all 35 |
| window / self / globalThis casts | 10 | StudioFixture.tsx:237, Wiring3DView.tsx:1109,1120, TryItPanel.tsx:269, prototyping/dictation.tsx:50, studio/client/mock.ts:397, lib/cad/cloud.ts:110, studio-geometry.worker.ts:13, cad/render.worker.ts:21 | test hooks and vendor-prefixed browser APIs; declare `Window` augmentation once |
| three/r3f controls and canvas | 4 | Wiring3DView.tsx:999,1122; studio/geometry/product-render.ts:51 (OffscreenCanvas); StudioFixture.tsx:191 | drei OrbitControls type does not expose `enabled/target` through `get().controls`; offscreen canvas |
| zod / clamp typing | 6 | studio/product/schema.ts:95,96,497; product/forms/clamp.ts:107; enclosure/shape-pick.ts:104; dashboard/store/actions.ts:126 | recursive discriminated union built from FORM_KINDS.map; records indexed by key |
| JSON message files typed as shape | 3 | studio/product/ai/why.ts:16,17; TryItPanel.tsx:49 | next-intl messages are untyped (no `global.d.ts` IntlMessages) |
| geometry job result vs BuiltProduct | 2 | studio/geometry/product-job.ts:78,126 | worker transfer of a packed product |
| fake Supabase client | 1 | studio/ai/fake-model.ts:32 | test double |
| `e.target.value as unknown as number` | 2 | admin/shipping-settings.tsx:29, admin/restock-dashboard.tsx:362 | real typing bug: state holds strings in `number` slots; fix state type |
Tests (35): lib/cad/cloud.test.ts 13, studio/product/ai/design.test.ts 5, prototyping/spec.test.ts 3, and 14 singles (mock clients, partial rows).

### 5c. Non-null assertions
`!` on env: **5** (lib/supabase/server.ts:11,12; lib/supabase/client.ts:7,8; lib/sourcing/adapters/digikey.ts:66). `process.env.X` is read in 56 files / 98 sites with no central validated env module. Other `!` (rough regex, non-test): ~242, concentrated in geometry code (lib/studio/product/solve.ts 27, schematic.ts 19, wiring3d/layout.ts 11, netlist.ts 11, wiring-drawing.ts 7).

### 5d. lib/supabase/types.ts (316 lines) vs migrations
No generated `Database` type anywhere (grep of `Database`, `supabase gen`: none); `supabase/` has no config.toml. The header says "Kept hand-written for now". 44 tables are queried via `.from()` and only 12 have a type; of the 12, 7 have drifted. Columns checked by replaying `create table` + `alter table` across all 86 migrations (parser: scratchpad/cols.py).

| table (type) | final SQL cols | missing from TS type | other |
|---|---|---|---|
| profiles (Profile) | 9 | `email` (0042), `price_cohort` (0060) | |
| parts (Part) | 39 | `attributes` (0025), `pack_size` (0025), `pinned_offer_id`, `preferred_offer_id`, `landed_cost_qar`, `expected_income_qar` (0028), `images` (0029), `is_test` (0031), `datasheet_url`, `specs`, `backup_for` (0041), `specs_ar`, `details_ar_at` (0047) = 13 | `tags, pricing_mode, income_pct, below_floor, lead_time_class, name_key, merged_into, store_category*, in_own_stock` typed optional though SQL is NOT NULL default (deliberate pre-migration tolerance) |
| part_orders (PartOrder) | 28 | `discount_qar` (0025), `shipping_tier, split_shipments, shipping_qar, handling_fee_qar, promised_date, early_promised_date, held_by, confirmation_emailed_at, delay_notified_at` (0029), `is_test` (0031), `has_on_request` (0032), `payment_method` (0039), `credit_discount_qar` (0042), `class_id, class_breakdown` (0097) = 16 | `status` union excludes legacy pending/processing (intentional, see lib/orders/status.ts) |
| part_order_items (PartOrderItem) | 13 | `project_id, kit_id, bom_lines` (0025), `lead_time_class, promised_date` (0029) = 5 | |
| cart_items (CartRow) | 9 | `bom_lines, kit_id` (0025) | |
| projects (Project) | 26 | `is_test` (0031), `status, free_wiring_used, cad_tier, cad_regens_remaining` (0042), `contact_email, recovery_token, recovery_emailed_at` (0045), `studio, studio_version` (0068) = 10 | `disciplines, spec, bom, netlist, build_route, firmware` optional vs NOT NULL for `disciplines` |
| client_inventory_items (ClientInventoryItem) | 10 | `attributes` (0025) | |
| inquiries (Inquiry) | 15 | none | `final_quote_qar: number \| string \| null` looser than numeric |
| project_items | 7 | none | |
| project_parts | 29 | none | `source` optional vs NOT NULL default |
| project_blocks / project_materials / project_schematics / project_schematic_revisions / tenants / inventory_items | | none (inventory_items.quantity retyped integer->numeric in 0007, TS `number` is fine) | |
Total 49 columns missing across 7 of 10 core tables checked (profiles, parts, part_orders, part_order_items, cart_items, projects, client_inventory_items); tables with no drift: inquiries, project_items, project_parts. Everything else (credits_ledger, payments, school_classes, engineering_jobs, ...) is typed ad hoc per call site (the 35 casts above).
Fix: `supabase gen types typescript --local > lib/supabase/database.types.ts` run against a local PGlite/Supabase applying the migrations (no prod access needed), `createClient<Database>()` in the four factories, delete hand types or derive them with `Tables<"parts">`.

## 6. Tests

### 6a. Count per area (232 files; vitest `lib/**/*.test.ts` only; counts are `it/test(` call sites, `it.each` expands to 3246 reported tests)
| area | files | cases |
|---|---|---|
| lib/studio | 75 | 782 |
| lib/prototyping | 28 | 294 |
| lib/store | 25 | 292 |
| lib (root) | 20 | 234 |
| lib/admin | 14 | 145 |
| lib/projects | 9 | 73 |
| lib/schools | 8 | 54 |
| lib/sourcing | 6 | 40 |
| lib/credits | 6 | 33 |
| lib/auth | 5 | 45 |
| lib/orders | 4 | 46 |
| lib/pricing | 4 | 38 |
| lib/cad | 3 | 55 |
| lib/notifications | 3 | 34 |
| lib/email | 2 | 47 |
| lib/billing | 1 | 8 |
| others (text, reviews, parts, i18n, home, design, supabase, integrations, cleanup, inventory, legal, services, analytics) | 17 | ~120 |
Tests in `app/`, `components/`, `e2e/` (other than Playwright specs): **0**. No component tests, no route-handler tests (62 routes), no jsdom environment. 272 lib modules have no sibling `*.test.ts` (156 of them in lib/studio, mostly library part data files).

### 6b. Important logic with no test that imports it (checked by scanning every test file for the module path; indirect coverage through another module is possible but unverified)
| priority | module | lines | why it matters |
|---|---|---|---|
| money | lib/parts/cart.ts (`cartTotal`, `kitDiscountQar`, `cartItemCount`) | 100 | cart total shown to buyer; cart-provider.tsx:479 rounds on top |
| money | lib/parts/format.ts `formatPrice` | 58 | 107 callers |
| money | lib/store/public-catalog.ts | 557 | every storefront price/stock read |
| money | lib/admin/order-lines.ts, lib/admin/fix-delivery.ts, stock-data.ts | 112 / 197 / 157 | admin order maths |
| money | lib/ai/{usage,limits,prices}.ts | 110 / 90 / 66 | AI cost metering and daily guard |
| money | no test of checkout totals (they live in checkout-client.tsx), no test pinning TS mirrors against SQL RPCs (`create_part_order`, `order_delivery_quote`, `order_status_transition_ok`); PGlite is used only by lib/schools/db/schools-migration.test.ts | | |
| credits | lib/credits/use-credits.ts (redeemable_qar fetch), lib/credits/constants.ts partly covered via credits.test.ts; `spend/canUse` covered | 102 | checkout credit discount |
| auth/permissions | lib/auth/get-session.ts (62), claim-guest-server.ts (34), providers-server.ts (42), redirects.ts (20); no test for the 79 inline `super_admin` checks or the 8 `requireAdmin` copies; no RLS test | | role resolution |
| delivery dates | lib/store/working-days.ts, delivery.ts, shipping.ts, checkout.ts have tests. Untested: cron/delivery-promises route logic (app/api/cron/delivery-promises/route.ts:37-101), lib/store/shipping-settings.ts, use-delivery-quote.ts | | |
| status transitions | lib/orders/status.ts, admin-rules.ts tested; the admin-overview open-status list (components/dashboard/admin-overview.tsx:61) differs from `OPEN_ORDER_STATUSES` and is untested | | |
| email | lib/email/templates/index.ts + templates.test.ts exist; untested directly: order-status.ts (125), layout.ts (215), first-circuit, credits-admin-grant, engineering-job-ready, credits-order-delivered, discount-ready, first-project, html-to-text, lead-email.ts (99) | | |
| notifications | decide.test.ts, links.test.ts, kinds-sync.test.ts (passes on main, checks decide.ts vs templates/index.ts); lib/notifications/drain.ts (117) untested | | outbox drain |
| other | lib/billing/{server,verify,config}.ts are imported by billing.test.ts (only 8 cases); lib/cache/storefront.ts (revalidateStorefront, 75), lib/engineering/view.ts, lib/projects/allocation.ts (150), lib/sourcing adapters (digikey, mouser), voltaat-sync.ts (252), api-refresh.ts (206), lib/cad/cloud-flow.ts (268), lib/supabase/{guest,middleware,fetch-all}.ts | | |

### 6c. e2e (36 spec/fixture files, 4710 lines; Playwright desktop + mobile-375)
- playwright.config.ts: `retries: 1`, `fullyParallel`, 3 workers, `reuseExistingServer: true`, `trace: on-first-retry`, no `forbidOnly`. Suite runs against `npm run start` and relies on `.env.local` pointing at production Supabase (e2e/fixtures.ts header), write-guarded.
- Fixed sleeps: `waitForTimeout` 54 across 8 files (studio-wiring-views.spec.ts 22, studio.spec.ts 12, studio-product.spec.ts 5, studio-parts-flipbook 4, studio-enclosure 4, studio-engine 3, home-w7.spec.ts:103 `waitForTimeout(6_500)`, pricing.spec.ts:30 3 s race). `networkidle`: 0. `toPass`: 21. `test.setTimeout` 90-400 s in 20+ places (studio-product.spec.ts:183 400 s).
- Production-data dependence: store.spec.ts:22-26 scrapes the first product link from the live catalog; case-studies, social-sign-in.spec.ts:22-25 (throws without Supabase env), guest-claim/speed/projects-open-studio skip without `NEXT_PUBLIC_SUPABASE_URL`; they read production catalog/auth settings, so results change when the catalog or provider flags change.
- Env-gated shots (`P517_SHOTS`, `STUDIO_PERF`) are test.skip'd by default; they are screenshots, not assertions.
- Likeliest flaky: studio-wiring-views.spec.ts (22 sleeps, 3D camera timing), studio.spec.ts:182 `waitForTimeout(1200)` waiting on a 650 ms animation, home-w7.spec.ts:103.

## 7. Docs: CLAUDE.md (1624 lines, 280,643 bytes)

### 7a. Current map
1-28 header/business/roles/requirements/build style; 29 `## PROGRESS` with 30-1416 of chronological history (1,387 lines, 85 % of the file); 1417-1437 owner decisions D1-D13; 1438-1491 build-sequence status; 1492-1498 prompt-file list; 1499-1503 what's next; 1504-1602 pending migrations log; 1603-1618 permanent notes; 1619-1624 environment notes.
Durable rules currently buried inside history (must be hoisted into the index): caching/ISR policy (:1026, :1138, :1107, :1603), messages scopes (:1028), expression-bodied `useEffect` ban (:1206 + eslint.config.mjs), i18n parity script (:1010), legal pages generated from LEGAL_PAGES_DRAFT.md (:1014, :1144, :1428), e2e write guard (:1075), "no invented numbers" (:512), readiness single source (:495), AliExpress dropped (:809), no paid services (:1613), email layout rule (:1604), 24 h cache expiry (:1603). Not stated anywhere in CLAUDE.md: "every store write calls `revalidateStorefront()`" (documented only in lib/cache/storefront.ts and mentioned incidentally at :1163).
Stale: :1619-1624 describes a Windows/PowerShell machine; :1499-1503 points to `C:\Users\mmamr\...`; :1492-1498 lists 5 of the 9 prompt files; the Supabase project id and Vercel project id are in :1613-1616 (not secrets, but move to docs/ENVIRONMENT.md).

### 7b. Proposed layout (nothing deleted; every range moves verbatim)
| lines | destination | notes |
|---|---|---|
| 1-28 | CLAUDE.md (kept) | |
| 29 | CLAUDE.md heading "History" + pointer | |
| 30-224 | docs/history/01-platform-stages-1-8b.md | Stage 1-8b (original workshop platform) |
| 225-472 | docs/history/02-parts-store.md | Parts Store (225), Store-first rebuild 1-5 (258-432), signed-in chrome (433), website fixes + public quote (442) |
| 473-934 | docs/history/03-prototyping.md | Prototyping, BOM/netlist, site-audit phases 1-5, Voltaat/Mouser/DigiKey, restock, payments, sourcing |
| 935-1031 | docs/history/04-ai-credits-cad-site-review.md | AI access + credits (935), CAD generation (955), Site review phases A-I (999-1031) |
| 1032-1232 | docs/history/05-qrdi-phases-0-4.md | feature videos, phases 0-4, hotfix at 1206 |
| 1233-1308 | docs/history/06-design-studio-phase-5.md | P5-01..P5-17, studio walkthroughs, admin home + stock |
| 1309-1416 | docs/history/07-edu-credits-school-projects.md | edu credits, school projects, personal number removed |
| 1417-1437 | docs/DECISIONS.md | D1-D13 + phase notes (keep a 5-line digest in CLAUDE.md) |
| 1438-1491 | docs/history/08-build-sequence-status.md | |
| 1492-1503 | docs/history/09-prompts-and-next.md; move the 9 root prompt files into docs/history/prompts/ | |
| 1504-1602 | docs/MIGRATIONS.md | run log; add "next = 0100" |
| 1603-1618 | split: rules (1603-1605, 1612-1613 owner rule) back into the CLAUDE.md index; env ids (1606-1611, 1614-1618) to docs/ENVIRONMENT.md | |
| 1619-1624 | docs/ENVIRONMENT.md, rewritten for macOS | |
New CLAUDE.md (~250 lines): lines 1-28 (28); "Hard rules" (~60: static/ISR storefront, revalidateStorefront, i18n parity + scopes, useEffect ban, legal generated, no paid services, write guard, never edit migrations, migration numbering); "Architecture map" (~40: dirs, Supabase clients, auth/roles, money path, credits, AI paths from AGENT_CONTEXT.md); "Commands" (~15: lint, typecheck, test, e2e, parity, legal check); "Owner decisions in force" digest of D1-D13 (~20); "Pointers" table to docs/*.md and docs/history (~40); "Environment" short (~15); "Maintenance rule": new stage notes go to docs/history/NN-*.md, handoff stays out of CLAUDE.md (~10). Total < 300.

### 7c. Root-level planning files
| file | size | CLAUDE.md refs | other refs | action |
|---|---|---|---|---|
| STAGE_6A_PROMPT.md | 73 L | :1493 | none | docs/history/prompts/ |
| STAGE_6B_PROMPT.md | 52 L | :1494 | none | same |
| STAGE_8A_PROMPT.md | 103 L | :1496 | none | same |
| STAGE_8B_PROMPT.md | 154 L | :1497 | none | same |
| STAGE_PARTS_STORE_PROMPT.md | 287 L | :1495 | none | same |
| STAGE_SITE_REVIEW_FIXES_PROMPT.md | 245 L, 30 KB | :1000, :1419 (not in the list at :1492) | none | same |
| STAGE_WIRING_VIEWS_PROMPT.md | 34 L | :1276 only | none | same |
| STAGES_STORE_FIRST.md | 126 L | :259 only | none | same |
| FIX_ALL_PROMPT.md | 164 L, 17 KB | none | none | unreferenced: needs owner decision |
| Gestaltung_Build_Plan.md | 867 L, 226 KB | none (README.md points to it) | README.md | archive to docs/history/ |
| LEGAL_PAGES_DRAFT.md | 346 L | :1014,:1144,:1145,:1212,:1428 | scripts/split-legal-draft.mjs, lib/legal/markdown.ts | stays (source of generated content/legal/**) |
| DESIGN.md | 89 L | :1134 | app/apple-icon.tsx, manifest.ts, opengraph-image.tsx | stays |
| SITE_AUDIT.md, CHANGELOG-audit.md, SECURITY_REVIEW.md, FINDINGS.md | 225/238/158/166 L | 4/7/2/0 | FINDINGS: lib/supabase/guest.ts | move to docs/audit-history/ after this audit, update refs |
README.md is a Stage-1 stub (21 lines, says "Stage 1 ... single landing page").

## 8. Lint / config

### 8a. eslint.config.mjs
Only `next/core-web-vitals` + `next/typescript` (via FlatCompat) and one `no-restricted-syntax` (effect expression body). Missing:
| gap | evidence | suggested level |
|---|---|---|
| `complexity`, `max-lines-per-function`, `max-lines` | 323 functions CC>=15; 166 >120 lines; 25 files >575 lines | warn at 25 / 200 / 800 with a baseline file, ratchet down |
| `import/order` or `no-restricted-imports` | no import rule; cycles (20) | add `import/no-cycle` (needs eslint-plugin-import; or keep madge in CI) |
| `no-console` | 102 `console.error`, 58 `console.warn`, 4 `console.log` in app/components/lib (BASELINE's 77 `console.log` are mostly scripts/) | `no-console: ["warn", {allow:["warn","error"]}]` |
| layering rule | components import `supabase/client` 33 times; lib imports React 6x | `no-restricted-imports` per folder (lib/** may not import react / next/headers except `*-server.ts`, `use-*.ts`) |
| `@typescript-eslint/no-non-null-assertion` | 242 `!`, 5 on env | warn |
| `@typescript-eslint/consistent-type-imports` | many `import type` already; cycles #1-5 are type-only | warn |
| `eqeqeq`, `no-restricted-syntax` for `as unknown as` | 97 casts | warn on production code |
65 `eslint-disable`: `@next/next/no-img-element` 31, `react-hooks/exhaustive-deps` 26, `no-explicit-any` 4, `no-unused-vars` 2, `prefer-rest-params` 1, jsx-a11y 1. Lint passes with 1 warning (unused disable at app/[locale]/opengraph-image.tsx:101).
Lint scope: `eslint .` also lints e2e/ and scripts/*.mjs; ignores services/**.

### 8b. tsconfig.json
- `target: ES2017` with `lib: esnext` (Next/SWC transpiles, so no runtime effect; raise to ES2022 to match Node 24 and drop downlevel assumptions). `allowJs: true` but include globs only `*.ts/*.tsx`, so allowJs does nothing; scripts/*.mjs and postcss/next config are not type-checked.
- `include: **/*.ts, **/*.tsx` pulls in e2e/ (36 files), playwright.config.ts, tailwind.config.ts, and `.next/types` (183 files when a build exists, so a typecheck result depends on whether `next build` ran). `exclude` lists `node_modules`, "Design that I like", `services`; add `.next` (keep `.next/types/**` include explicit), `_archive`, `playwright-report`, `test-results`.
- `strict: true` only; add `noUncheckedIndexedAccess` (large change; geometry code has ~240 `!`), `noFallthroughCasesInSwitch`, `noImplicitOverride`. `incremental: true` leaves `tsconfig.tsbuildinfo` in the repo root (check .gitignore).
- No `tsc` split between app and e2e/tests.

### 8c. vitest.config.mts
`include: ["lib/**/*.test.ts"]`, `environment: node`, no coverage, no setupFiles, no `.test.tsx`. Tests outside lib: none exist today (checked app/, components/, e2e/, scripts/), so nothing is silently skipped, but any new component or route test would never run. Recommend `include: ["{lib,app,components}/**/*.test.{ts,tsx}"]`, a second `jsdom` project for components, and `coverage` (v8) with thresholds on lib/pricing, lib/credits, lib/orders, lib/store.

### 8d. playwright.config.ts
See 6c. Additionally: `webServer.command: npm run start` (needs prior build, not enforced), `testMatch **/*.spec.ts`, no `forbidOnly`/`workers` split for CI beyond 2, no `globalSetup`, single `retries: 1` hides flaky waits.

### 8e. Dependencies (knip)
| package | importer | state | action |
|---|---|---|---|
| @electric-sql/pglite | lib/schools/db/schools-migration.test.ts:9 | now in devDependencies 0.5.11 (package.json:42; changed after baseline) | done; confirm lockfile has it (3 hits) |
| three-stdlib | components/studio/viewer/ProductViewer.tsx:18 (`OrbitControls`) | only transitive via @react-three/drei (`^2.35.6`); installed 2.36.1 | add `"three-stdlib": "^2.36.1"` to dependencies (or import OrbitControls from drei/three examples) |
| @eslint/eslintrc | eslint.config.mjs:3 (FlatCompat) | transitive via eslint; installed 3.3.7 | add `"@eslint/eslintrc": "^3.3.7"` to devDependencies |
| postcss-load-config | postcss.config.mjs:1 (JSDoc type only) | transitive via tailwindcss; installed 6.0.1 | no dependency needed: drop the `@type` comment, or add as devDependency |
| eslint-config-next | eslint.config.mjs via FlatCompat | knip false positive | keep |
Also: `outputFileTracingRoot` comment in next.config.mjs still describes `C:\Users\<user>` (stale).

## Summary (10 lines)
1. Complexity: 323 functions CC>=15, 140 >=25, 45 >=40; worst `renderSchematicSVG` 176, `renderWiringSVG` 157, `solveProduct` 151; 166 functions >120 lines, 31 >300 (`PrototypingWorkspace` 1081).
2. Splits proposed for all 14 files (3-5 modules each); highest payoff: checkout totals + place-order out of checkout-client.tsx, customer bundle shared with customer-export, shared viewer rig for Viewer/Wiring3DView.
3. Cycles: 20 confirmed (12 are StudioShell<>steps type-only, not 13); 6 small edits clear all; only netlist<>plain-checks is a true runtime cycle.
4. Layering: 8 data-access styles; 33 component files hit Supabase directly (134 `.from` + 10 `.rpc`); money rounded in 19 places; 79 inline super_admin checks plus 8 copy-pasted `requireAdmin`; 6 hooks and 4 `next-intl/server` users in lib/; 7 routes carry business logic (store-lead 388 lines, CC 111).
5. Consistency: 0 loading.tsx, 0 error.tsx, 2 not-found.tsx; 5 route and 7 action error shapes; 7 money formatters, 46 inline `Intl.DateTimeFormat`, Locale type declared 13 times; components/ is 213 kebab / 45 Pascal (Pascal only in components/studio).
6. Types: real `any` = 7 (BASELINE 15 was a regex artefact); 97 `as unknown as` (62 prod, 35 tests), 35 prod ones exist only because there is no generated Database type; 5 env `!`; 7 of 10 core hand-written tables have drifted (49 columns missing).
7. Tests: 232 files / 3246 cases, all in lib/; 0 component, 0 route, 0 RLS/RPC tests; untested money/auth: lib/parts/cart.ts, public-catalog.ts, lib/ai/*, lib/auth/get-session.ts, cron delivery-promises logic, 8 email templates, notifications/drain.ts.
8. e2e: 54 `waitForTimeout` in 8 files, 21 `toPass`, retries 1, several specs depend on the live catalog / production Supabase env.
9. Docs: CLAUDE.md is 85 % history (lines 30-1416); plan moves it into 9 files under docs/history + DECISIONS/MIGRATIONS/ENVIRONMENT and leaves a ~250-line rules index; 8 root prompt/plan files referenced only from CLAUDE.md, FIX_ALL_PROMPT.md and Gestaltung_Build_Plan.md (226 KB) unreferenced.
10. Config: eslint has no complexity/no-console/layering rules; vitest only globs lib/**/*.test.ts; tsconfig target ES2017 and includes e2e + .next/types; add `three-stdlib` and `@eslint/eslintrc` to package.json (pglite already added; postcss-load-config needs no dep).
