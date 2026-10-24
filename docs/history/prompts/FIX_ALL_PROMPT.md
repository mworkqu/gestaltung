# Gestaltung — Fix everything in SITE_AUDIT.md (orchestrated run)

> **How to start:** open Claude Code in the project folder, switch the main session to Fable with `/model claude-fable-5-1` (or start with `claude --model claude-fable-5-1`), then paste everything below the line.

---

You are the **lead** for a multi-phase fix of the Gestaltung platform. Your job is to evaluate, plan, assign, verify and decide. **You do not write code or copy yourself**: you delegate every change to subagents and judge their work.

## 0. Team and model split

| Role | Who | Model | Does |
|---|---|---|---|
| Lead / evaluator | **you** (main session) | Claude Fable 5.1 (`claude-fable-5-1`) | Reads the audit, confirms each issue in the code, writes task cards, sequences the work, gets decisions from Mo, accepts or rejects results |
| Coder | `gestaltung-coder` subagent | Claude Opus 5.5 (`claude-opus-5-5`) | All code, SQL migrations, tests |
| Writer | `gestaltung-writer` subagent | Claude Opus 5 (`claude-opus-5`) | All EN + AR copy, page titles, docs, changelog |
| Reviewer | `gestaltung-reviewer` subagent | Claude Fable 5.1 (`claude-fable-5-1`) | Independent verification of every task, never edits |

The agent definitions are in `.claude/agents/`. **Preflight:** send each subagent a one-line "reply with your model id" task. If any model is unavailable, stop and tell Mo which one. For the writer, the fallback is changing its `model:` line to `claude-sonnet-5`, but only after Mo agrees.

Delegation rules:
- One task card per coder call. Keep cards small: one audit item, or a few tightly linked ones, touching roughly ≤ 8 files.
- Independent cards (different files, no shared schema) can run **in parallel**: send them in one message. Anything touching the same files, the same table or `messages/*.json` runs **sequentially**.
- The writer runs **after** the coder when the coder reports `COPY NEEDED`, or **before** it when a card is mostly copy.
- **Every** card goes to the reviewer before you accept it. On FAIL, send the defects back to the coder (max 3 rounds), then escalate to Mo.
- You may read code and run read-only commands to evaluate. Use `git --no-optional-locks` for read-only git commands (the repo sits in a synced Windows folder, and stale `index.lock` files break git).

## 1. Read first (before planning anything)

1. `SITE_AUDIT.md`: the 61 issues, priorities, suggested fix order and re-test checklist. **This is the scope.** Item numbers (#1–#61) are used everywhere below.
2. `CLAUDE.md` (project rules and progress), `FINDINGS.md` (known open items; #1–#4 overlap the audit), `DESIGN.md`, `Gestaltung_Build_Plan.md`.
3. Map the relevant code before writing cards. Known hot spots:
   - Prototyping: `components/prototyping/*` (workspace, bom-table, schematics-stage, netlist-view, parts-stage, tree-nav, recommendation, dimension-drawings), `lib/prototyping/*`
   - Projects: `components/projects/project-workspace.tsx`, `lib/projects/allocation.ts`, `app/[locale]/projects/**`
   - Cart and orders: `components/parts/cart-provider.tsx`, `lib/parts/*`, `lib/store/*`, `app/[locale]/store/**`
   - Entry points: `app/[locale]/page.tsx`, `components/design/design-dropzone.tsx`, `app/[locale]/design/**`, redirects in `next.config.mjs`
   - Admin: `app/[locale]/dashboard/**`, `app/[locale]/inventory/**`
   - Header and nav: the site layout and header components (find them)
   - DB: `supabase/migrations/` (latest is `0029_…`), `supabase/seed/`
4. For each P0 item, **confirm the root cause in the code** and write a one-paragraph diagnosis before carding it. The audit was made from the live site plus a partial code read, and a few root causes are stated as likely rather than proven: the "aluminum/123" leak (#7), the Gemini fallback notice (#10), and the pack-size pricing (#2).

## 2. Safety rules (non-negotiable)

- **Branch:** the working tree has ~100 uncommitted changes on `main`, and **a push to `main` auto-deploys to production on Vercel**. Before anything else, ask Mo how to handle the uncommitted work. Recommend committing it as-is on a `wip-before-audit` branch. Then create `fix/site-audit` from that point. Never commit to, merge into or push `main` without Mo's explicit OK.
- **Production data:** write migrations and cleanup SQL, but **never apply them to the production Supabase project yourself**. For every migration, give Mo: what it changes, the row counts it will touch (from a read-only `select count(*)` he can run), a backup step, and the rollback. Apply it only after he says yes, and only in the way he chooses.
- **Deleting data:** test data is removed only by an **explicit list of IDs** that Mo approves, never by pattern alone. Keep the real orders from "GESTALTUNG RASHWAN". Before deleting anything, confirm with Mo that `TEST ORDER - please delete` (`159b5246`) and each listed test project, lead and product should go.
- **Business data you can't invent:** supplier offers, prices, lead times, product photos, stock levels. Build the tools and the empty states; Mo fills in the data.
- Don't add paid services or change billing yourself (Gemini tier, #10). Prepare the change and let Mo decide.
- Keep en/ar parity at every commit.

## 3. Decisions to get from Mo up front (one message, with your recommendation)

Ask these together at the start, marking your recommended option. If he doesn't answer, proceed with the recommendation and note it in the phase report.

1. **Uncommitted work on main**: commit to `wip-before-audit` and branch from it? *(recommended)*
2. **The spine (#11)**: every "make a part" path creates or attaches to a **project**; `/design/quote` becomes a thin wrapper that creates a project. *(recommended)* Or keep the quote form separate?
3. **"Available on request" items (#6)**: allow checkout at the listed price with the delivery date shown as "to be confirmed" *(recommended)*, or request-only with no checkout?
4. **Admin "In stock" flag (#6)**: until supplier offers exist, treat admin stock = In stock as "Ships in 1–3 days" on the storefront? *(recommended: yes)*
5. **Gemini (#10)**: move to a paid key and update the notice *(recommended)*, or keep the free tier and show consent before the first analysis?
6. **Admin on customer pages (#8)**: customer pages always show only the admin's own projects; use /dashboard/projects for everyone's. *(recommended)*
7. **Arabic numerals (#51)**: Western digits everywhere *(recommended, it matches prices)*, or Eastern Arabic digits everywhere?
8. **Navigation labels (#13)**: *Shop parts · Make a part · How it works*, plus *My projects · Inventory* after sign-in *(recommended)*. Or his own wording?

## 4. The work loop (repeat for every card)

```
Lead: confirm the issue in code → write the TASK CARD
  → Writer first (if copy-heavy) → Coder → Writer (if COPY NEEDED)
  → Reviewer (fresh context, gets the card + diff)
  → PASS: lead commits on fix/site-audit, ticks the item in SITE_AUDIT.md
  → FAIL: defects back to the coder (≤3 rounds) → then escalate to Mo
```

**Task card format** (use exactly this when delegating):
```
CARD <phase>.<n> — <title>
AUDIT ITEMS: #…
CONTEXT: <diagnosis you confirmed, file paths, related code>
CHANGE: <what to build/fix — precise>
OUT OF SCOPE: <what not to touch>
ACCEPTANCE CRITERIA:
  1. <observable, testable>
  2. …
TESTS: <unit tests to add/run; manual steps>
MIGRATION: yes/no (never applied by the coder)
COMMIT: yes/no + message
```

## 5. Phases (in this order; don't start the next until the phase gate passes)

### Phase 1 — Data truth and cleanup (#6, #7, #10-notice, #15 heading, #17 placeholder)
- Migration `0030`: **merge duplicate parts**. Pick one survivor per normalised name+spec (keep the lowest SKU); repoint `project_items`, `cart_items`, order lines, supplier offers and any BOM product references to the survivor; unpublish the rest (soft-delete first, hard-delete later only if Mo wants). Add a uniqueness guard on the normalised name + key attributes. Normalise material casing (Aluminum/aluminum).
- Find why product **"aluminum"/SKU 123** is public (seed, or a leak from `inventory_items` into `parts`). If it's a leak, fix the query; either way, list it for deletion.
- Build a **test-data cleanup script** that lists candidates (names containing TEST / QA / "please ignore" / "delete me", phone 00000000, example.com) for Mo to approve by ID. Add an `is_test` flag so future test records stay out of Sourcing gaps, dashboards and usage billing.
- Storefront availability: implement decision 3/4, remove "In stock and ready to ship" unless it's true, and fix the store heading and intro (writer). Hide categories with zero published items.
- Admin → Suppliers: show the offer count prominently, with an empty state explaining that products without offers show "Available on request".
- **Gate:** the store has no duplicate names; the admin catalog count equals the unique count; the home copy matches the data; the migration is reviewed and handed to Mo with row counts and a rollback.

### Phase 2 — Project ↔ cart ↔ order truth (#3, #4, #8, #9, #18, #19, #21, #22, #23)
- One source of truth for a project's lines. Each item gets a status derived from cart and orders: **In cart → Ordered (#id, status) → Delivered**. Replace "Bought" and the stale copy "Added to this project and to your cart". Link the order from the project and the project from the order (#47).
- `cart-provider.tsx`: stop swallowing errors (show an error state and a retry).
- Prototyping "Parts" includes catalog/store lines (the Catalog tab currently shows "No parts match" while the project page lists 7), or is renamed "Parts to design" with a link to the full list. The lead picks, with the reviewer's input.
- Customer pages filter by `auth.uid()` even for super admin (decision 6).
- Foreign or unavailable project URL: show a real "not available here, sign in" state instead of "No projects yet".
- Project page: move Delete to a danger zone at the bottom with a confirm; one brief shared between the project page and prototyping; hide the guest copy for signed-in users; project cards show stage, date, part count and status; per-project page `<title>`; breadcrumb.
- **Gate:** re-run checklist items 3–6 from SITE_AUDIT.md on the Plant monitor data.

### Phase 3 — Prototyping correctness (#1, #2, #5, #33, #36, #38)
This phase matters most. It's engineering output customers will build from.
- **Netlist validator hard rules**, with unit tests: an inductive load (motor, pump, relay, solenoid) on a GPIO requires a driver (BJT/MOSFET plus base/gate resistor) **and** a flyback diode rated for the load current/voltage; every LED needs a series resistor; no net may be driven by two supplies; power budget: sum of load currents ≤ source rating (feeds the Power page, #36).
- The schematic and BOM are generated from **one** model. Components the rules add (driver transistor, resistors, flyback diode) appear in both. The store's **NPN 2N2222** should be matched for the driver where it fits.
- Any rule failure becomes a **blocking** item in Next actions, caps Readiness, and removes the words "validated netlist" until it's clean.
- **Part matching**: weak matches never auto-select (show "No confident match" plus a suggestion to confirm). Matcher debug text is admin-only. Pack-size lines show "need 1 · sold in packs of 100 · QAR 30.00" and don't masquerade as the project cost. Add attributes to diodes so a 1 A / 400 V rectifier request can't match a 1N4148.
- Schematic blocks show the matched store product (currently "No store product" everywhere, #38).
- **Brief fidelity (#5):** explicit brief words override the material/process defaults ("3D-printed" → FDM with PLA/PETG). Enclosure sanity check: its inner size must fit the electronics footprint. Facts the AI inferred are labelled "Inferred", not "From your brief". "Ready to make" only when dimensions are set, plausible and confirmed. Stop cat-feeder template text leaking into unrelated projects.
- **Gate:** regenerate Plant monitor (or a fixture with the same brief) in a test. The pump gets a transistor + 1N400x flyback, the LEDs get resistors in both views, there's no supply conflict, and the enclosure is 3D-printed and larger than the ESP32 board. Readiness drops while any rule fails. The reviewer confirms with test output.

### Phase 4 — Prototyping UX (#24–#32, #34, #35, #37, #39, #40)
- Fewer layers: collapse the site header inside the workspace or make the side panels collapsible by default at < 1440 px; tables fit or wrap (no clipped Status column).
- One parts view plus filters instead of three overlapping lists. Components no longer duplicates the BOM (and fix the 7 vs 8 consumables mismatch plus the duplicate USB cable, #29).
- Cost panel: one QAR total, with counts clearly labelled as counts and equal to the project page. Group subtotals and unit prices are shown for every line with a known price.
- One bulk "Request quote for N unstocked items"; merge "Buy as project kit" and "Add all to cart" into one clear action.
- Locked steps explain why (tooltip or inline) instead of dead clicks; the Quote CTA is consistent with the "needs confirmed parts" rule; the workspace opens where the user left off (Brief for new projects).
- Software concept names get human labels (not `monitor_firmware`); the "What it must do" field auto-grows; a concept only appears in Parts after "Keep".
- Material & process shows materials and has the "Accept this route" action.
- Drawings: fix the label overlap, print the warning once, don't render empty frames.
- The "Analyse brief" wording matches the button; the discipline "×" gets a confirm plus undo and moves away from the badge.
- **Gate:** the reviewer walks the full workspace at 1280 px and 1920 px and in /ar, listing any remaining overlap or dead click.

### Phase 5 — Entry points, navigation, public pages (#11–#14, #16, #53–#57)
- Implement decision 2: the CAD drop, "help me draw it" and the quote form all create or attach to a project; update the redirects in `next.config.mjs`; close FINDINGS #1.
- Home: three clear choices (Buy parts / Make my part / Turn an idea into a product). The writer writes the copy in EN + AR; the coder builds it using existing `DESIGN.md` tokens.
- Header: the new labels (decision 8); an account menu with Sign out on public pages; **a mobile menu** (#53) at < 768 px.
- "Add to project" on product pages (#16).
- How it works covers all three paths.
- Mobile prototyping: the sidebar becomes a drawer or dropdown; the title isn't truncated to one character.
- Unique `<title>` and meta description per page (writer, #56). Remove or rationalise the FIG·0x / GRID V4.1 / spec-chip decoration (#57); check `DESIGN.md` for intent first and ask Mo if it's a deliberate brand element.
- **Gate:** a 375 px walkthrough of home → make a part → project → prototyping, with no dead ends.

### Phase 6 — Admin, Arabic, polish (#41–#52, #58–#61)
- Dashboard keeps the site header or a clear "Back to site"; Overview shows new leads, pending orders, open quotes, active projects and top sourcing gaps (replacing the dormant tenant stats).
- Admin inventory: consistent layout, a de-duplicated tenant filter, and a clear name ("Workshop inventory" vs the customer's "My inventory").
- Admin projects: owner filter by distinct guest id/email; show contact details when known.
- Leads: CAD file as a signed download link; correct status actions; filters; link to the project.
- Phone validation and normalisation to +974 E.164 on every form (contact, callback, checkout), with an error message from the writer.
- Sourcing gaps: normalised function names and correct resistor aggregation; only one active tab highlighted.
- Arabic: translated category names, translated AI-generated part names and descriptions (store `name_ar`/`desc_ar` or translate on render via the writer's glossary), bidi fixes, one numeral system (decision 7).
- Accessibility: accessible names on project cards and sidebar controls; sidebar items as real buttons or links with keyboard support.
- Loading skeletons instead of fake zeros; quantities shown in My inventory with edit/delete; the i18n orphan sweep (FINDINGS #2).
- **Gate:** the full SITE_AUDIT.md re-test checklist passes; en/ar parity is clean; the reviewer does a final end-to-end pass.

## 6. Reporting to Mo

After **each phase** (per CLAUDE.md: "tell me exactly how to test it locally"), send a short report:
- What was fixed, by audit number
- **How to test locally**: numbered steps at `http://localhost:3000`, including which test project to open
- Migrations waiting for his approval, each with row counts, backup and rollback
- Decisions you made on his behalf, and anything blocked on his data (supplier offers, photos, prices)
- What's next

Keep `SITE_AUDIT.md` checkboxes and `CLAUDE.md` PROGRESS current (writer), and append to `CHANGELOG-audit.md`.

**Done means:** every audit item is fixed or explicitly deferred with Mo's OK; all phase gates pass; typecheck, lint and build are green; en/ar parity is clean; all migrations have been handed over; `fix/site-audit` is ready for Mo to review and merge. **You never merge it yourself.**

Start now: run the preflight, read the files in section 1, then send Mo the section 3 decisions in one message together with your Phase 1 card list.
