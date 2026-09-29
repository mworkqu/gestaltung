# SITE AUDIT — gestaltung360.com

Live walkthrough on 25 Sept 2026, signed in as super admin, EN + AR, desktop + mobile (375px).
Nothing was changed on the site during the audit.
Test project used: **TEST — Plant monitor** (`fdd2a6c7-397f-4ca7-adc5-f4dcbb45dd5f`).

Priority: **P0** = wrong data / broken promise / safety; **P1** = confusing, blocks a flow; **P2** = polish.
Fix one section at a time and re-test with the checklist at the bottom.

**Owner decisions (26 Sept 2026)** — fix branch `fix/site-audit`, log in CHANGELOG-audit.md.
- 1a — All work on branch fix/site-audit from main; the owner merges. Never push main.
- 2a — Project is the one spine: every "make a part" path (CAD drop, help-me-draw, quote form) creates or attaches to a project (#11, Phase 5).
- 3a — "Available on request" items can be ordered at the listed price; delivery date shows "to be confirmed" (#6).
- 4b — Admin stock_status is never shown or used on the storefront; delivery times come only from supplier offers (#6).
- 5b — Stay on the Gemini free tier for now; consent checkbox before the first analysis; notice text kept in messages/*.json so it's easy to change (#10).
- 6a — Customer pages show only the signed-in user's own projects, even for super admin; everyone's projects live in /dashboard/projects (#8).
- 7a — Western digits everywhere, in Arabic too (#51).
- 8a — Navigation: Shop parts · Make a part · How it works, plus My projects · Inventory after sign-in (#13).

---

## P0 — Wrong, broken or unsafe

### 1. Prototyping gives an electrically unsafe design and calls it "validated"
- Schematic (Electronics → Board → Circuit) drives the 5 V pump **directly from a GPIO** (`NET_PUMP`). No transistor/MOSFET in the netlist **or** in the BOM. Only a text note says "ensure a transistor is used".
- The store already sells **NPN Transistor 2N2222** — the matcher never adds it.
- LEDs in the schematic have **no series resistors**, but the BOM lists 4× 120 Ω "current limit for LED1–4". Schematic and BOM disagree.
- Wiring check reports "Two supplies drive net 5V: J1 and U1 — they would short together", yet the footer says "Drawn from a validated netlist" and this error is **not** in Next actions and does not lower Readiness (67 %).
- **Fix:** hard-fail rules in the netlist validator (inductive load on GPIO → require driver + flyback; LED without resistor; supply conflict). Any failure → blocking item in Next actions, Readiness capped, "validated" wording removed until clean. Schematic must be generated from the same BOM lines (resistors, driver) or both regenerated together.
- **Status:** Fixed in code (Phase 3, commit 2f40e2f — Card 3.1) — hard rules (inductive load on a GPIO, LED without resistor, shorted supplies, power budget) insert the driver transistor + base resistor + flyback diode and the LED resistors into the netlist, so schematic, wiring and BOM come from one model; each failing rule is a blocking item and lowers Readiness; the footer never says "validated" while flags exist. Pending: owner opens Plant monitor → Electronics › Board → Regenerate and re-tests checklist item 2; projects saved before this change show as blocking until regenerated.

### 2. Wrong part auto-matched and priced
- BOM line "Flyback diode — rectifier, 1 A, 400 V+" is matched to **Diode 1N4148** (small-signal, ~100 V / 200 mA). Needs 1N4004/1N4007-class.
- The UI even shows the debug reason: *"Weak match: product has no attributes · a diode by its name"*.
- Qty 1 needed, "sold in 100" → line total **QAR 30.00**, and that single wrong line is the entire "Available now QAR 30.00" in the cost panel.
- **Fix:** weak matches must never auto-select; show "No confident match" + suggestion. Hide matcher debug text from customers (admin only). For pack-size items show "you need 1, sold in packs of 100" clearly and don't count it as the project cost.
- **Status:** Fixed in code (Phase 3, commit ade6320) — weak matches show "No confident match" with a confirm button and are never pre-selected; matcher debug text is admin-only; pack lines read "need N · sold in packs of P · price per pack" with a "To buy now" summary. Pending: owner re-tests on Plant monitor.

### 3. Project page says parts are "in your cart" — cart is empty
- Project page, Parts: "Added to this project and to your cart. Nothing is ordered until you check out." Lists 7 items, QAR 366.
- Cart page: **"Your cart is empty"**. Header cart badge: 0.
- Cause: the parts were already checked out (admin → Store orders → `159b5246`, "TEST ORDER - please delete", 7 items, QAR 366). Checkout cleared `cart_items`; `project_items` kept them. The copy is simply stale.
- Prototyping BOM labels the same items **"Bought"** (they're only an unconfirmed pending order).
- **Fix:** project items need a status from the order: *In cart → Ordered (#159b5246, Pending) → Delivered*. Rename "Bought" accordingly. Link the order from the project.
- Related: `components/parts/cart-provider.tsx` `reload()` ignores both query errors and falls back to `[]` — a failed query silently shows an empty cart. Surface an error state.
- **Status:** Fixed in code (Phase 2, commits dbaea1d, 392ffa2, 88352d1) — cart keeps last good lines and shows an error + Retry; items read In cart / Ordered #id · status / Delivered / to buy; migration 0034 stops checkout doubling a project line's quantity (ESP32 × 2) and repairs doubled lines once. Pending: owner runs 0033 → 0034 → 0035, re-tests on Plant monitor, decides by hand on lines with cancelled orders.

### 4. Two "parts" lists in one project that disagree
- Project page → 7 store parts (ESP32, DHT11, button, motor, resistor, breadboard, jumpers).
- Prototyping → Parts ("**Every part in this project**") → only 4 to-design parts; **Catalog tab: "No parts match this filter."**
- Prototyping → Bill of materials shows the store parts again, with different quantities (ESP32 "1 · GR-011 × 2").
- **Fix:** one parts model per project. Prototyping "Parts" must include catalog/store lines, or be renamed "Parts to design".
- **Status:** Fixed in code (Phase 2, commit 81518ec) — prototyping Parts lists the project's store lines in one merged list; Catalog filter works. Pending: owner re-tests on Plant monitor.

### 5. The brief is contradicted by the generated design
- Brief: "…in a small **3D-printed case**… Powered from a **USB adapter**… desk…"
- Generated: Enclosure shell = **Stainless 304, laser cut, 30 × 30 mm, 1 mm** (an ESP32 dev board alone is ~52 × 28 mm). Status: **"Ready to make"**.
- "What we understood": Power source **Mains**, Mounting **Portable** — both labelled "From your brief", neither is what the brief says (USB 5 V, desk).
- Reservoir template text is from the cat-feeder parts library ("Holds the liquid side…"), shape set to **Shaft**.
- **Fix:** material/process suggestion must honour explicit words in the brief (3D-printed → FDM/PLA/PETG). Size sanity check against the electronics footprint. Facts the AI inferred must say "Inferred", not "From your brief". "Ready to make" only after dimensions are plausible and confirmed.
- **Status:** Fixed in code (Phase 3, commit e4e42c2) — process words in the part or brief win ("3D-printed case" → PLA + 3D printing); any fact the brief doesn't state is labelled "Inferred", for every AI provider; an enclosure smaller than its board is flagged too small and can't be kept; implausible dimensions block "Ready to make"; template descriptions attach only to matching part names. Pending: owner re-analyses Plant monitor and re-tests.

### 6. Store shows everything "Available on request" while claiming "In stock"
- Home: "Featured products — **In stock and ready to ship** across Qatar". Every card: "Available on request".
- Product page: "We don't have a supplier lined up for this yet, so we can't promise a date."
- Admin catalog: Stock = **In stock** for 119/121, Lead time = **Available on request** for 121/121.
- Cause: Admin → Suppliers: Alibaba, AliExpress, DigiKey, Mouser, Voltaat all have **0 offers**, so no product has a lead time.
- Checkout still accepted an order for these items at a fixed price (order `159b5246`).
- **Fix:** attach supplier offers (or treat admin "In stock" as ships in 1–2 days). Change the home copy until true. Decide whether "on request" items can be checked out at a fixed price or only requested.
- **Status:** Fixed in code (Phase 1, commits 4627347, a2fde3d) — pending: owner adds supplier offers; migration 0032 not run.

### 7. Catalog is 74 % duplicates + test data is live
- Admin catalog: **121 parts, 31 unique names, 90 duplicate rows** — 10 products × 10 copies each (9V Battery, AA Battery Holder, Capacitor 100uF, Diode 1N4148, Push Button, Slide Switch, DC Motor, Resistor 10K, Stepper 28BYJ-48, NPN 2N2222). Seed script ran 10×.
- BOM matched Diode **GR-024** while admin top row is **GR-114** — same product, different SKUs.
- Public store shows product **"aluminum"**, SKU **123** (a workshop test inventory item — check it isn't leaking from `inventory_items` into `parts`).
- Material filter lists both "Aluminum" and "aluminum".
- Test records in production: projects "TEST — …", "QA test — prototyping (delete me)", "1", "product"; leads "TEST contact/callback/LEAD (please ignore)"; order "TEST ORDER - please delete" (phone `00000000`). These also feed **Sourcing gaps** demand.
- **Fix:** migration to merge duplicates (repoint `project_items`/`cart_items`/order lines to the survivor), delete the test product, normalise material casing, add a unique constraint on normalised name+spec. Add an `is_test` flag or a cleanup script for test data.
- **Status:** Fixed in code (Phase 1, commits 4265b8b, 58874eb, 6b1b517) — pending: owner runs migrations 0030 and 0031, then approves the test-data id list before `test_data_delete.sql` runs.
- The 'aluminum'/SKU 123 product is matched by test_data_candidates.sql (sku = '123') and goes in the delete list once approved.

### 8. Admin browsing the customer pages sees and can edit everyone's projects
- Signed in as admin, **/projects "Your projects"** lists all 12 platform projects, including guests' and `mm099282@gmail.com`'s ("Swabery"). The admin can open, edit and **Delete** them from the customer UI.
- **Fix:** customer pages filter `user_id = auth.uid()` explicitly, even for super admin; admin-wide view lives only in /dashboard/projects (read-only, or an explicit "act as" mode).
- **Status:** Fixed in code (Phase 2, commits 81518ec, 392ffa2) — customer project pages and the prototyping workspace show only the signed-in user's own projects. Pending: owner re-tests signed in as admin.

### 9. Shared or cross-device project links show a false message
- Opening a project URL that belongs to another session shows *"No projects yet — start one and search the store to add parts."* with a "Your projects" button.
- **Fix:** "This project isn't available here. It may belong to another account or browser — sign in to see it." Encourage guests to sign up to save their project to an account.
- **Status:** Fixed in code (Phase 2, commits 81518ec, 392ffa2) — project page and prototyping show a real not-available state. Pending: owner re-tests with a link from another account.

### 10. Privacy: customer briefs go to the Gemini **free tier**
- Footer note says briefs are sent to Google Gemini. AI usage page confirms free-tier limits. Google's free tier may use prompts to improve its products — a problem for customers' unreleased product ideas.
- When the allowance runs out, the app "falls back to the basic reader" — check the customer is told the result is lower quality.
- **Fix:** move to a paid tier (or disclose clearly before analysis, with a checkbox). Show a notice when the fallback reader was used.
- **Status:** Fixed in code (Phase 1, commit 33792b2) — consent checkbox before the first analysis; fallback notice already existed. Pending: nothing.

---

## P1 — Confusing / blocks the flow

### Site structure (public)
11. **Six entry points for "make me a part"** that don't connect: Home "New project", Home CAD drop (→ `/design/quote`, never becomes a project), Design page (two cards → quote / drawing), Contact form, Request callback, and "Request this item" on each product. FINDINGS.md #1 is still open. → Make **project** the one spine: CAD drop creates a project with the file attached; "help me draw it" creates a project with a brief; the quote form saves into a project or is retired.
    - **Status:** Fixed in code (Phase 5) — the /design/quote request creates a project with the file attached (cad-files + project_files) and links to it; "help me draw it" opens /projects/new?for=drawing (project + brief + drawing_request lead). Pending: owner sends one test request.
12. **Home hero has ~20 equal-weight actions** (search, New project, 13 category chips, dropzone, "explore custom manufacturing"). "New project" is the primary button, but new visitors don't know what a project is. "Start without an account" looks like a link but isn't one. → Three clear choices: *Buy parts* / *Make my part (I have a file)* / *Turn an idea into a product (prototyping)*.
    - **Status:** Fixed in code (Phase 5) — home hero is three choices: Buy parts (search) · Make my part (file drop) · Turn an idea into a product (Start a project); category chips moved under Featured.
13. **Menu wording:** "Design" means *get a part made*; "Projects" is jargon; "My inventory" is a sign-up wall for visitors. → *Shop parts · Make a part · How it works*; show My projects / Inventory after sign-in.
    - **Status:** Fixed in code (Phase 5) — Shop parts · Make a part · How it works; My projects when a session exists; Inventory + account menu (Dashboard, Sign out) when signed in.
14. **How it works** explains only the upload path — nothing about projects, prototyping or the store.
    - **Status:** Fixed in code (Phase 5) — How it works covers all three paths, four steps each, with a button per path.
15. **Store heading** "Mechanical Parts Store — screws, nuts, washers, bolts…" but it sells electronics + construction (Masonry, Glazing, Acoustic Ceiling Tile). There are **no screws**: the BOM reports M3 screws/nuts as "Not in our store". → Fix heading; hide empty categories; stock M3 hardware (demand already in Sourcing gaps).
    - **Status:** Fixed in code (Phase 1, commit 4627347) — new heading and intro, empty categories hidden. Pending: owner stocks M3 hardware.
16. **Product page has no "Add to project"**, although the projects empty state tells users to "search the store to add parts".
    - **Status:** Fixed in code (Phase 5) — product page "Add to project": pick one of your projects or start a new one with the part.
17. No product photos anywhere — every card is the same gear icon.
    - **Status:** Partly in code (Phase 1, commit 33792b2) — GearPlaceholder takes a label, not yet used by callers. Pending: owner uploads product photos at /dashboard/store/quick.

### Project page
18. **"Delete project"** sits right next to the title at the top — move it to a settings/danger area at the bottom.
    - **Status:** Fixed in code (Phase 2, commit 392ffa2) — Delete moved to a danger zone; runs through delete_project() in one transaction (migration 0035; 0033 fixes the 0024 trigger bug). Pending: owner runs 0033 and 0035.
19. **Two brief fields:** project page "What are you building?" is **empty**, while prototyping Brief holds the 49-word brief. Pick one and show it in both places.
    - **Status:** Fixed in code (Phase 2, commits dbaea1d, 392ffa2) — one brief shared by the project page and prototyping; 0033 copies notes into empty briefs. Pending: owner runs 0033.
20. Project page "Materials" chips (PLA, PETG…) are separate from each part's material in prototyping — unclear what they do.
21. Signed-in user still sees "Start one without an account — it stays with you when you sign up."
    - **Status:** Fixed in code (Phase 2, commit 392ffa2) — guest line hidden for signed-in users. Pending: nothing.
22. Project cards on /projects show only the name — no status, stage, date, part count or thumbnail. Two projects are both called "saoud"; one is called "1".
    - **Status:** Fixed in code (Phase 2, commit 392ffa2) — cards show date, part count and status. Pending: no thumbnail; duplicate/test names go with the Phase 1 test-data cleanup.
23. Project page `<title>` is the generic site title; no breadcrumb back to Projects.
    - **Status:** Fixed in code (Phase 2, commit 392ffa2) — per-project `<title>` and breadcrumb. Pending: nothing.

### Prototyping workspace
24. **Four navigation layers** (site header, back bar, left tree, right Next-actions panel) leave a narrow centre column; tables need horizontal scroll and the Status column is cut off (Parts, BOM).
    - **Status:** Fixed in code (Phase 4, e18104e — Card 4.4) — side panels start collapsed under 1440 px (saved choice wins); site header hidden inside the workspace, the workspace bar carries logo/back/cart/language/sign-in; page width up to 1760 px. Pending: owner checks for clipped tables at 1280 px and 1920 px.
25. **Three different "Parts" views** (Parts, Bill of materials, Mechanical → Parts) plus Electronics → Components, which repeats the whole BOM. In Components "Build consumables" = **7** lines, in BOM = **8** (a USB cable disappears).
    - **Status:** Fixed in code (Phase 4, 4.3/4.4) — Components and BOM share one selector so their counts match; the USB cable is deduped across sources. Pending: owner checks Components count = BOM count on Plant monitor.
26. **Cost panel mixes units:** "Available now QAR 30.00 · Not stocked **11** · Fabrication **0** · 7 bought" — money next to line counts. The project page says QAR 366 for the same project. → One total, with counts labelled as counts.
    - **Status:** Fixed in code (Phase 4, 55f2c7d — Card 4.3) — one QAR figure ("To buy now") and a separate counts line. Pending: the project page's QAR total and the BOM's "To buy now" are still different figures (documented, later phase).
27. BOM group subtotals show **QAR 0.00** for groups whose items are "Bought", and unit prices show "—" even though the store price is known (ESP32 QAR 35).
    - **Status:** Fixed in code (Phase 3, commit ade6320; Phase 4, 55f2c7d — Card 4.3) — unit prices show whenever the product is known; group headers show the to-buy subtotal and "ordered: QAR Y", never QAR 0.00 for priced lines. Pending: owner re-tests on Plant monitor.
28. **11 separate "Request a quote" buttons**, one per not-stocked line, plus "Buy as project kit" and "Add all to cart" side by side. → One "Request quote for 11 unstocked items".
    - **Status:** Fixed in code (Phase 4, 55f2c7d — Card 4.3) — one "Request a quote for N unstocked items" button sends one bom_quote lead with the item list and project link; one kit button replaces "Buy as project kit" + "Add all to cart". Pending: owner re-tests on Plant monitor.
29. The BOM lists both a breadboard **and** a perfboard/hookup wire/heat-shrink for a single unit — choose one build route. The **USB cable is listed twice**.
    - **Status:** Fixed in code (Phase 4, 55f2c7d — Card 4.3) — consumables follow one build route (breadboard for prototype; perfboard/hookup wire/heat-shrink for custom PCB); USB cable deduped. Pending: owner re-tests on Plant monitor.
30. **Locked steps look clickable:** Quote / Production / Scope in the sidebar do nothing when clicked ("needs confirmed parts"). "Continue to Scope" is disabled with no explanation. → Tooltip or inline "Keep a concept first", or navigate and show the blocker.
    - **Status:** Fixed in code (Phase 4, commit fb94ef1 — Card 4.1; e18104e — Card 4.4) — blocked rows show the reason inline + tooltip and a click goes to the fix, scrolls to the control, or opens the node; blocked node views show a banner with a fix link; Continue buttons show their reason inline. Pending: owner checks for dead clicks at 1280 px, 1920 px and in /ar.
31. **Quote stage contradicts itself:** the landing view shows an active **"Request a quote"** button while the sidebar says Quote "needs confirmed parts" and the text says "Priced from confirmed parts only".
    - **Status:** Fixed in code (Phase 4, e18104e — Card 4.4) — Quote/Production buttons are disabled with the reason inline when the sidebar says blocked. Pending: owner re-tests on Plant monitor.
32. The workspace opens on "How this gets made" + Quote rather than where the user left off (or on Brief for a new project).
    - **Status:** Fixed in code (Phase 4, e18104e — Card 4.4) — opens on Brief for a new project, otherwise where the user left off (unit-tested). Pending: nothing.
33. The Readiness badge (67 % = "6 of 9 requirements met") ignores the P0 electrical and dimension problems above.
    - **Status:** Fixed in code (Phase 3, commits e4e42c2, 2f40e2f — Card 3.1) — new "Circuit passes our checks" requirement plus one blocking item per failing rule; implausible dimensions block "Ready to make". Pending: owner regenerates Plant monitor and checks Readiness drops while any rule fails.
34. **Software concept P-04** shows as a *Suggestion* (not kept) but already appears in Parts with qty 1 and "To design". Its name is a raw id, **`monitor_firmware`**. "What it must do" sits in a 3-line textarea you have to scroll.
    - **Status:** Fixed in code (Phase 4, commit 787ab03 — Card 4.2) — suggested concepts stay under Concepts until Keep; snake_case ids display as human names ("Monitor firmware"); "What it must do" grows 3–16 rows. Pending: Readiness labels still show raw concept ids (later phase).
35. **Material & process** page shows processes only, no materials, and no "Accept this route" button, even though "Manufacturing route not accepted" is an open item. The button only appears on the landing view.
    - **Status:** Fixed in code (Phase 4, e18104e — Card 4.4) — the leaf shows each part's material and process with "Accept this route". Pending: owner re-tests on Plant monitor.
36. **Power** page is a single line ("Power source: Mains") — no power budget (pump current vs adapter rating), which is the key check for this project.
    - **Status:** Fixed in code (Phase 3, commit 2f40e2f — Card 3.1) — Power shows a budget per rail: source, loads, total, headroom, and an over-budget flag. Pending: owner regenerates Plant monitor and re-tests.
37. **Drawings:** the label collision "FLAT PAT**Material thickness: 1 mm**" overlaps. The "Outline only…not a cut file" warning is printed twice per drawing. P-03 renders an empty frame.
    - **Status:** Fixed in code (Phase 4, commit 787ab03 — Card 4.2) — one "not a cut file" warning per drawing; title, view name and thickness on separate baselines (unit-tested); parts without drawable dimensions get a link instead of an empty frame. Pending: title-block values clip at ~26+ chars (pre-existing, later phase).
38. **Circuit wiring view** is too small to read at normal width (tiny labels, overlapping wires). Every block says **"No store product"** although the text above says "Each part is the store product its line matched" and the BOM did match GR-011/012/029.
    - **Status:** Partly in code (Phase 3, commit ade6320) — bought lines now carry their product, so wiring blocks show name + SKU (the cause was server-side). Pending: the wiring view is still small at normal width.
39. The Brief hint says "nothing is analysed until you press **Analyse brief**", but the button is labelled "**Re-analyse**".
    - **Status:** Fixed in code (Phase 4, commits fb94ef1 — Card 4.1, 787ab03 — Card 4.2) — button reads "Analyse brief" / "Re-analyse brief" and the hints match. Pending: nothing.
40. The **"×" next to Mechanical / Electronics / Software** removes the whole discipline in one tap. It sits beside the count badge and has no confirm or undo.
    - **Status:** Fixed in code (Phase 4, commit fb94ef1 — Card 4.1; e18104e — Card 4.4) — "×" moved to the row end with an inline confirm and a 6-second Undo; Undo restores detected branches properly. Pending: owner re-tests on Plant monitor.

### Admin dashboard
41. The dashboard drops the site header (no logo or link back except the footer). **Sign out exists only inside the dashboard**; the public header has no account menu.
42. **Overview** shows tenants / workshop inventory / low stock, which belong to the dormant tenant system (FINDINGS #3, #4). → Show new leads, pending orders, open quote requests, active projects, sourcing gaps.
43. **Inventory** tab opens a different layout (dashboard tabs vanish). The tenant filter lists "Client A" and "Workshop B" **twice**. Admin "Inventory" vs customer "My inventory" are two unrelated systems with the same name.
44. **Projects (admin):** the Owner filter is 10 identical "Guest (no account)" rows. Guest projects have no contact details, so you can't follow up.
45. **Leads:** a quote request's CAD file shows only as a storage path (`433c184e…/smalhaj_safety_helmet.stl`), not a download link. Closed leads show both "Reopen" and "Mark contacted"; contacted leads show "Reopen" too. There's no filter by status or source, and leads don't link to a project.
46. **Phone validation:** leads accepted `+97497466567410` (duplicated prefix) and `66567410`, and checkout accepted `00000000`. → Validate and normalise to E.164 (+974 + 8 digits) on every form.
47. **Store orders:** there's no link from an order to its project, and no order-detail view in the list.
    - **Status:** Fixed in code (Phase 2, commit dbaea1d) — admin side fixed in code (dbaea1d), order detail links each line to its project; customer side shows order id + status, no customer order page exists yet. Pending: customer order page.
48. **Sourcing gaps:** mixes short names ("USB adapter") with sentence-style names ("Seals the enclosure against dust…") from older analyses. The 120 Ω resistor demand (4 units) is missing — only 4.7 kΩ shows. Two tabs are highlighted at once (Store + Sourcing gaps).

### Arabic
49. **Store category chips stay in English** on /ar (Components, Fasteners, Masonry…).
50. **AI-generated content isn't translated:** part names and descriptions ("Enclosure shell — The outer body. Cut flat, then bent…") and field units "(MM)" appear in English inside the Arabic UI. Bidi punctuation breaks (the full stop lands at the start of English lines).
51. **Mixed numerals:** "٥٠ ميجابايت" (Eastern Arabic) next to "35.00 ر.ق" (Western). Pick one.
52. Brand spelling: "جِشتالتُونج" in AR vs "GESTALTUNG" — fine if intentional, but "Gestaltung360" appears nowhere on the site even though it's the domain.

### Mobile (375 px)
53. **No navigation at all:** the header shows only the logo, cart and language toggle. There's no menu button, so no Projects, Store, Design, Dashboard, Sign in or Sign out.
    - **Status:** Fixed in code (Phase 5) — menu button under 768 px opens every link plus Sign in / Dashboard / Sign out. Verified live at 375 px.
54. The prototyping sidebar stacks full-height **above** the content, so you scroll a whole screen before seeing anything. It should be a drawer or dropdown.
    - **Status:** Fixed in code (Phase 5) — under 1024 px the project tree opens from a "Project sections" button. Pending: owner checks on a phone.
55. The project title in the prototyping bar is truncated to a single character.
    - **Status:** Fixed in code (Phase 5) — on phones the project title takes its own row. Pending: owner checks on a phone.

---

## P2 — Polish

56. Page titles: Store, How it works, About, Contact, product pages, cart and dashboard all share *"Gestaltung — Manufacturing, made simple in Qatar"*. Give each page its own (SEO and tabs).
    - **Status:** Fixed in code (Phase 5) — every public page and each product has its own title and description (Meta namespace; lib/meta.ts).
57. The decorative labels **FIG·01 / FIG·02 / GRID V4.1 / "Method: Auto-matched · Network: Qatar · Output: Finished part"** repeat across Home, Design, How it works and About, and read like placeholders. FIG·02 is used on two pages.
    - **Status:** Fixed in code (Phase 5) — FIG·0x labels and the "Method / Network / Output" spec chips removed; the blueprint panels stay (DESIGN.md brand motif).
58. **Accessibility:** project cards on /projects are links with no accessible name. Prototyping sidebar items are non-semantic `div`s (not reachable by keyboard; screen readers get unnamed buttons). Add names and roles.
    - **Status:** Fixed in code (Phase 2, commit 392ffa2 — Card 2.2: /projects cards carry aria-label = project name; Phase 4, commit fb94ef1 — Card 4.1: sidebar rows are named buttons with arrow-key navigation). Pending: owner checks with a screen reader.
59. **Loading states:** the prototyping cost panel briefly shows **QAR 0.00 / 0 / 0** before real values arrive. The project page shows a bare spinner. Use skeletons instead of fake zeros.
60. `/my-inventory` list doesn't show quantities; user data like "M3 scroews" / "klj" suggests there's no edit/delete affordance, or it's hard to find.
61. Orphaned i18n keys (FINDINGS #2) — still pending the step-16 sweep.

---

## Suggested fix order

1. **Data cleanup** (P0 #6, #7): merge duplicate parts, remove test product and test data, attach supplier offers, fix the "In stock" copy. *(Low risk, big trust gain.)*
2. **Project ↔ order truth** (P0 #3, #4, #8, #9): item status from orders, one parts model, admin sees only own projects on customer pages, correct not-found message.
3. **Prototyping correctness** (P0 #1, #2, #5, then P1 24–40): validator hard-fails, no weak auto-matches, brief-honouring materials, one cost total.
4. **Entry points and navigation** (P1 11–17, 53–54): project as the single spine, a three-choice home page, renamed menu, mobile menu.
5. **Admin and Arabic** (P1 41–52), then P2.

## Re-test checklist

- [ ] Store: no duplicate names; no "aluminum/123"; home copy matches item availability.
- [ ] Plant monitor BOM: pump has transistor + flyback (1N400x); LEDs have resistors in **both** schematic and BOM; no supply short; Readiness drops while any rule fails.
- [ ] Project page parts show "Ordered #…" after checkout; cart badge matches.
- [ ] Prototyping Parts includes catalog items; the cost panel equals the project page total.
- [ ] Admin on /projects sees only own projects.
- [ ] A foreign project URL shows "not available here", not "No projects yet".
- [ ] /ar: categories and AI part names in Arabic; one numeral system.
- [ ] 375 px: menu reachable; prototyping content visible without scrolling past the sidebar.
