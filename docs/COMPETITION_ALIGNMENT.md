## Update 1 — Competition alignment (paste into Claude Code now)

This update aligns the whole platform with the official Mechanical Engineering CAD Technical Descriptions (WorldSkills 2026 and EuroSkills 2025). Paste it into the running Claude Code session now. It finishes its current step, saves the brief as a project file, applies the small part that affects Prompt 1, and follows the rest in every later prompt.

Before pasting, put the two PDFs in the repo at docs/reference/ (WSC2026_TD05_en.pdf and ES2025_TD05_en.pdf).

### UPDATE 1 - COMPETITION ALIGNMENT (read fully before continuing)

Do not abandon or restart your current work. Finish the step you are on, then:
1. Save this entire message as docs/COMPETITION_ALIGNMENT.md.
2. Add a line to docs/ARCHITECTURE.md: "docs/COMPETITION_ALIGNMENT.md overrides any older task text where they conflict."
3. Apply section P1 (the only part that affects Task 1) now.
4. Read docs/COMPETITION_ALIGNMENT.md at the start of every later task and apply it. If a later task's text conflicts with it, this file wins; tell me about the conflict in your plan.

Sources: docs/reference/WSC2026_TD05_en.pdf (WorldSkills 2026 Technical Description, Mechanical Engineering CAD, Skill 05) and docs/reference/ES2025_TD05_en.pdf (EuroSkills 2025). Never copy text from them into the site; paraphrase and describe.

### A. SOFTWARE TRACKS (replaces the Inventor/SOLIDWORKS decision)
- The competitions are built on Autodesk Inventor (tasks name Frame Generator, Design Accelerator, Inventor Studio, Content Centre). EuroSkills allows only Inventor Professional and/or Autodesk Fusion, and competitors must use the provided software.
- Training tracks, in priority order: "inventor" (1st, primary, default, labelled "Recommended for the competition"), "fusion" (2nd, for Mac users and Fusion schools, also allowed at EuroSkills), "solidworks" (3rd, for students and schools already on SOLIDWORKS). cc_profiles.track_software = inventor | fusion | solidworks, default inventor.
- SOLIDWORKS track honesty note, shown at onboarding when chosen and on the training overview: "The competition uses Autodesk Inventor or Fusion. The SOLIDWORKS track builds the same skills, and we recommend switching to Inventor before competition mocks." Mock competitions and the qualifier are offered in Inventor/Fusion only; SOLIDWORKS students see that note on those pages.
- Content priority: produce Inventor content first, then Fusion, then SOLIDWORKS. A lesson may launch with only some tracks recorded.
- Video slots per lesson: inventor_ar, inventor_en, fusion_ar, fusion_en, solidworks_ar, solidworks_en (software-neutral lessons use one shared pair). Fallback order: same track other language -> Inventor same language -> any available, each with a note.
- Track switcher on lessons: "Showing: Inventor - switch to Fusion / SOLIDWORKS".
- Inventor-specific competition tools (Frame Generator, Design Accelerator, Inventor Studio, Content Centre, Tube & Pipe, Cable & Harness): Fusion and SOLIDWORKS tracks show the closest equivalent workflow where one exists (e.g. SOLIDWORKS sheet metal, weldments/structure system, Toolbox, motion studies, Visualize; Fusion sheet metal, rendering, animation), otherwise a note "This tool exists only in Inventor. Competitors use Inventor for this module."

### B. THE REAL COMPETITION STRUCTURE (drives training and mock tests)
The Test Project is 4 standalone modules on 4 days. Store this as data (cc_competition_modules table, seeded) and use it everywhere:

M1 Mechanical fabrication - 6 h
  Given: finished component drawings, 3D models, nomenclature (parts list).
  Work: sheet metal parts and assemblies; frame parts and assemblies (Inventor Frame Generator); welded connections; bolted connections; sheet metal and welding detail drawings; tubes, pipes, cabling and wires; one exploded/collapsing animation (.avi).
  Deliver: part and assembly files, assembly drawing(s), detail drawings for manufacture, nomenclature, animation.
M2 Mechanical design challenge - 6 h
  Given: assemblies (3D), layout, technical specification of a design change, design brief.
  Work: build a functional assembly; implement the design change; Design Accelerator allowed; assembly drawing of the change; exploded views; physical simulation and photo renders in Inventor Studio.
  Deliver: modified files, assembly drawing, animation (exploded/collapsing + physical simulation), photo renders up to A3, nomenclature, 3D printed parts as solution.
M3 Mechanical assemblies and detail drawing for manufacture - 6 h
  Given: finished drawings, 3D models, nomenclature.
  Work: model components from detail drawings; build the assembly; detail drawings for manufacture; insert standard parts from Content Centre.
  Deliver: part and assembly files, assembly drawing(s), detail drawings, nomenclature, exploded view(s), physical simulation animation.
M4 Reverse engineering from a physical model - 4 h
  Given: physical component(s)/assembly, some files.
  Work: measure the physical part with allowed instruments; freehand paper sketches allowed; photos, putty, ink pads or any shape-memorizing method forbidden; the physical part is available for 2 hours then taken away; work continues from own sketches; computer allowed throughout.
  Deliver: 3D models, 3D annotation (MBD), manufacturing and detail drawings, volume specifications, rendered images.
Also tested across modules: 3D printing, 3D scanning, MBD (model-based definition), limits and fits, surface texture, GD&T.

Competition delivery folder (students must build this habit):
`<CODE>\DAY 01\Results\  with subfolders: 2D Drawings, 3D Scannings, Animations, Parts and Assemblies, PDF files, Rendered Images, Reports, STL files`
`<CODE>\DAY 01\Workspace\`
Result drawings delivered as PDF (or 3D-PDF).

Other facts to reflect in copy:
- Drawings are supplied in first-angle projection; competitors must know both first and third angle and may answer in either.
- World competition age limit: not older than 22 in the year of the competition. [TODO-MO: confirm the local Qatar rule.]
- Competition conduct: no internet, no phones, no smartwatches or wireless headphones, no USB sticks, no communication with experts during the day.
- Competitors may bring measuring instruments: digital caliper (0-150 or 0-200 mm), offset centerline caliper, digital/universal protractor, radius gauges (0.4-25 mm), external and internal metric thread pitch gauges (0.35-6 mm; M6/M8/M10/M12 plugs), surface roughness (Ra) comparator, steel ruler (0-300 mm), depth gauge caliper (0-150 mm); also a 3D mouse, own keyboard/mouse, standards compendium and manuals.

### C. TRAINING STRUCTURE (replaces the 6-skill-module catalog in Task 9)
Course = Orientation + Foundations + 4 Competition Modules + Mock Competitions. Every lesson and exercise is tagged with ONE skill area (1-6) AND (if relevant) ONE competition module (M1-M4), so the skill map and module readiness can both be shown.

0. Orientation: How this training works; How the real competition works (4 modules, times, folder structure, rules, marking: measurement vs judgement 0-3); How to study.
1. Foundations (levels 1-6, the ladder already planned): L1 extrude; L2 holes, pockets, fillets, chamfers; L3 revolve, sweep, loft, shell, patterns; L4 parameters and part families (iParts in Inventor); L5 assemblies, constraints, sub-assemblies; L6 drawing fundamentals: first vs third angle, views, sections, dimensioning rules, title block, parts list and balloons, ISO general tolerances, limits and fits, surface texture symbols, GD&T basics, exploded isometric views.
2. M1 Fabrication track: sheet metal (flanges, bends, unfold/flat pattern, sheet metal drawings with bend notes); Frame Generator (frames, end treatments, trim/extend); weldments (weld beads, weld symbols on drawings); bolted connections; Tube & Pipe; Cable & Harness; exploded/collapsing animation export (.avi); fabrication drawing presentation.
3. M2 Design challenge track: reading a design brief and specification; modifying existing assemblies parametrically; Design Accelerator (shafts, gears, bearings, bolted connections); Inventor Studio: renders (lighting, scenes, materials, decals, camera, A3 output) and animations (physical simulation, exploded/collapsing); designing parts for 3D printing and exporting STL.
4. M3 Assemblies and detail drawing track: modelling from detail drawings fast and accurately; Content Centre standard parts; detail drawings for manufacture; GD&T and limits/fits in practice; nomenclature with multi-column parts lists; exploded views; simulation animation.
5. M4 Reverse engineering track: using each allowed instrument (one short lesson each); measuring strategy under a 2-hour limit; freehand dimensioned sketching on paper; thread and radius identification; surface roughness estimation; turning sketches into models; MBD/3D annotation; 3D scanning basics (in person).
6. Mock Competitions: full-length module mocks (M1-M3 6 h, M4 4 h), in the competition folder structure, with the real rules.
Online vs in-person: Foundations and M1-M3 tracks are online. M4 measuring practice, 3D scanning, 3D printing, and full-length mocks are in person (online mocks allowed for M1-M3 with honour rules).

### D. MARKING MODEL (applies to scoring, grader, review, results)
- Every gradable task is made of ASPECTS (cc_task_aspects): id, task_id, description_en/ar, skill_area_id, competition_module (nullable), type (measurement | judgement), max_points, method (auto_step | ai_drawing | trainer), partial_rule (null = all-or-nothing).
- Measurement aspects: full marks or zero by default; partial marks only when partial_rule defines it. The STEP grader's volume/area/inertia checks each map to measurement aspects (e.g. "Part volume correct within 0.5%" -> max_points or 0). Keep the current graded partial-credit logic only for practice exercises, and show it there as "practice score".
- Judgement aspects: scored 0-3 by the trainer: 0 below industry standard, 1 meets industry standard, 2 meets and in some respects exceeds, 3 wholly exceeds/excellent. Points = max_points x score / 3. Show the scale with these meanings in the review screen and to students.
- Typical balance to mirror: most marks are measurement (EuroSkills used about 93 measurement / 7 judgement). The admin test builder shows the measurement/judgement split per test and a warning if judgement exceeds 20%.
- Skill area totals and the overall % still use the 6 official weights, as before.
- Results page additionally shows "Competition module readiness" (M1-M4) when a test covered those modules.

### E. DRAWING CHECK RUBRIC (replaces the default rubric in Task 8)
Projection: accept first OR third angle; check the projection symbol is present AND the view arrangement matches it. Never fail a drawing for using third angle.
Measurement-type items (AI first pass, trainer confirms; each pass/fail):
  title block complete (name, title, scale, material, date, sheet size, drawing number)
  projection symbol present and consistent with view layout
  required views present (per task)
  section views hatched with labelled cutting planes
  every feature dimensioned; no over-dimensioning (no duplicate or redundant dimensions)
  no overlapping dimensions or text
  no unnecessary views
  correct symbols and abbreviations (ISO), dimensions in mm
  general tolerance note present (e.g. ISO 2768-m)
  limits and fits notation where required (e.g. H7/g6)
  surface texture symbols where required
  GD&T frames and datums present where required
  parts list with more than one column and balloons (assembly drawings)
  exploded isometric view (when required)
  key dimension values correct (trainer only)
Judgement items (trainer, 0-3): presentation and view selection; overall readability for manufacture.
The student-facing hint for each failed item explains the rule without giving the answer.

### F. SUBMISSIONS (extends Task 5 and the grader)
Two upload modes per test:
1. per_task (diagnostic, practice, exercises): one file per task, as already planned.
2. module_package (mock competitions and the qualifier): ONE ZIP of the Results folder structure from section B.
   - Show the required structure on the test intro page with a downloadable empty template ZIP ("CAD-Champions-Results-Template.zip") and a one-click explanation.
   - Validate after upload: required folders present (case-insensitive), file types per folder: Parts and Assemblies (.step/.stp REQUIRED for auto-grading, plus native .ipt/.iam/.ipn/.f3d/.f3z allowed), 2D Drawings (.idw/.dwg/.f3d drawings), PDF files (.pdf), Rendered Images (.png/.jpg/.bmp), Animations (.avi/.mp4/.wmv), STL files (.stl), 3D Scannings (.stl/.obj/.ply), Reports (.pdf/.docx/.xlsx). Show a checklist of what was found vs expected per task, with clear warnings ("No STEP file found for Part 03 - only the .ipt. We can't auto-check native files; export STEP too.").
   - Each task declares expected files by name pattern (e.g. Parts and Assemblies/Part_03.*). Unmatched files are listed for the trainer.
   - ZIP limit 300 MB, resumable upload; extract server-side safely (zip-slip protection, max 500 files, max 2 GB uncompressed).
Grader: accepts a list of STEP files from the package; matching per task by the expected name pattern, then by closest volume if names don't match (flagged).
Native CAD files, animations and renders are stored for trainer judgement and download; never executed.

### G. TESTS AND IN-PERSON SUPPORT
- Diagnostic test: keep 90 minutes, per_task mode, mixed tasks; tag each task with skill area and competition module.
- Mock tests: one per competition module, competition timing (6 h / 6 h / 6 h / 4 h), module_package mode, competition rules shown and agreed.
- Qualifier: chosen mock(s) with module_package mode and trainer judgement.
- In-person session mode (admin-only flag on an attempt): the trainer starts the timer for a group; for M4 the timer shows a phase marker at 2:00 "Physical part collected" and records when it was collected; integrity checks relaxed (shared studio IPs).
- Instruments page (/training/instruments): each allowed instrument with photo slot [TODO-MO], what it measures, a short lesson link; "Get a student measuring kit from Gestaltung360" [TODO-MO: kit contents and price].

### H. COPY, ELIGIBILITY AND CONDUCT
- Landing "What you need": a Windows PC for Inventor (recommended for competition); Mac users -> Fusion; SOLIDWORKS users are welcome (third track).
- Landing + FAQ: eligibility note "The world competition is for competitors aged 22 or younger in the competition year. Check your local selection rules." [TODO-MO]. Training is open to everyone. Profile shows "Competition age-eligible until <year>" computed from date of birth (informational only).
- Mock-test rules text mirrors competition conduct (no internet beyond this site, no phone, no help, no USB on in-person machines).
- Glossary additions (en + ar): sheet metal, flat pattern, bend allowance, Frame Generator, weldment, weld symbol, bolted connection, Tube & Pipe, Cable & Harness, Content Centre, Design Accelerator, Inventor Studio, iPart, physical simulation, exploded view, collapsing animation, nomenclature, MBD, 3D annotation, limits and fits, surface texture (Ra), offset centerline caliper, radius gauge, thread pitch gauge, depth gauge, 3D-PDF, STL, design brief.

### P. WHAT CHANGES IN EACH TASK
P1 (Task 1, apply now): add the glossary terms in section H; nothing else changes in Task 1.
Task 2: track_software enum inventor|fusion|solidworks (default inventor); add cc_competition_modules (seed M1-M4 with name_en/ar, hours, summary), cc_task_aspects, competition_module column on tasks/lessons/exercises, upload_mode on tests (per_task | module_package), attempt.in_person flag and phase markers; onboarding software screen = three cards in order Inventor (Recommended for the competition) / Fusion / SOLIDWORKS, with the SOLIDWORKS honesty note when chosen.
Task 3: landing copy per section H; competition section shows the 4 modules with times; FAQ adds eligibility and "Which software does the competition use?".
Task 4: Get Ready software tabs: Inventor (recommended), Fusion, SOLIDWORKS, Other; add Help articles: "How the real competition works", "The results folder structure", "First vs third angle projection", "Allowed measuring instruments".
Task 5: add module_package mode (section F) and in-person session mode (section G).
Task 6: grader accepts multiple STEP files and maps checks to measurement aspects (section D); add package matching (section F).
Task 7: scoring by aspects (measurement all-or-nothing, judgement 0-3); results show skill map + module readiness; per-aspect feedback.
Task 8: rubric per section E; review screen uses 0-3 for judgement items with the scale meanings; trainer can open native files list and download.
Task 9: catalog per section C; lesson video slots per section A; instruments page; in-person cohort page describes M4 conditions.
Task 10: plan descriptions reference online tracks vs in-person (M4, scanning, printing, full mocks); an optional add-on product "Student measuring kit" [TODO-MO].
Task 11: test builder edits aspects (type, points, method, partial rule), shows measurement/judgement split; package expectations editor; admin can run a module_package test in in-person mode; insights show readiness per competition module.
Task 12: E2E tests include a module_package upload with a valid and an invalid folder structure, and a judgement review using the 0-3 scale.

Confirm you saved docs/COMPETITION_ALIGNMENT.md, list the glossary terms you added for P1, then continue Task 1.
