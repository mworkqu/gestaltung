# Site audit fixes — changelog

Branch: `fix/site-audit` (not merged to main). Item numbers refer to SITE_AUDIT.md.

## Phase 1 — Data truth and cleanup

- 4265b8b — Card 1.1 — #7 — Migration 0030 merges duplicate products (lowest SKU survives, references repointed, material casing normalised); sheet import de-duplicates and lists skipped rows; vitest added.
- 58874eb — Card 1.2 — #7 — Migration 0031 adds `is_test`; read-only candidate list and a dry-run-by-default delete script for test data; admin views hide test rows unless `?test=1`.
- 33792b2 — Card 1.5 — #10, #17 — Consent checkbox before the first AI analysis; GearPlaceholder accepts a label (not yet used).
- 4627347 — Card 1.3 — #6, #15 — Migration 0032 lets on-request items be ordered at the listed price with "Date to be confirmed"; empty categories hidden; new store heading and home copy.
- a2fde3d — Card 1.4 — #6 — Suppliers page shows offer coverage and an empty state explaining "Available on request".
- 6b1b517 — Card 1.6 — #7 — Merged products hidden in the admin catalog, publish/delete errors shown, old SKUs redirect to the surviving product.

Pending owner steps: run 0030 → 0031 → 0032 (after 0029); approve the test-data id list; add supplier offers; upload product photos.

## Phase 2 — Project ↔ cart ↔ order truth

- 81518ec — Card 2.3 — #4, #8 — Prototyping Parts lists the project's store lines in one merged list (Catalog filter works); workspace scoped to the owner with a real not-available state.
- dbaea1d — Card 2.1 — #3, #47 — Cart keeps last good lines with an error + Retry; BOM lines read "Ordered #id · status" / "Delivered"; admin order detail links lines to projects; migration 0033 fixes project delete (0024 trigger) and copies notes into empty briefs.
- b05e618 — Copy — Phase 2 strings in en + ar (parity 1596/1596).
- 392ffa2 — Card 2.2 — #3, #8, #9, #18, #19, #21, #22, #23 — Project pages show only the user's own projects, per-item status, one shared brief, danger-zone Delete via delete_project() (migration 0035), cards with date/part count/status, per-project title and breadcrumb.
- 88352d1 — Card 2.4 — #3 — Migration 0034 (create_part_order v5) stops checkout doubling a project line's quantity and repairs doubled lines once, with a DRY RUN.

Pending owner steps: run 0033 → 0034 → 0035 (after 0030–0032); re-test checklist items 3–6 on the Plant monitor project; decide by hand on lines with cancelled orders (listed in the 0034 header).

## Phase 3 — Prototyping correctness

- ade6320 — Card 3.2 — #2, #27, #38 — Weak matches show "No confident match" and are never pre-selected, matcher debug is admin-only, pack lines show need / pack size / price per pack, unit prices show when the product is known, and wiring blocks show the bought product.
- e4e42c2 — Card 3.3 — #5 — Brief words set material and process, unstated facts read "Inferred", an enclosure too small for its board can't be kept, and implausible dimensions block "Ready to make".
- 2f40e2f — Card 3.1 — #1, #33, #36 — Hard circuit rules insert the pump driver, flyback diode and LED resistors into the netlist (one model for schematic, wiring and BOM), block Readiness while any fails, and the Power leaf shows a per-rail budget; Phase 3 copy in en + ar (parity 1630/1630).

No migrations. Pending owner steps: after 0030–0035, open Plant monitor → Electronics › Board → Regenerate and re-test checklist item 2; projects saved before Card 3.1 show as blocking until regenerated. Still open: bought-group subtotals read QAR 0.00 (#27); wiring view too small (#38).

## Phase 4 — Prototyping UX

- fb94ef1 — Card 4.1 — #30, #39, #40, #58 — Blocked sidebar rows show the reason inline + tooltip and a click always leads to the fix (no dead clicks); the discipline "×" moved to the row end with an inline confirm and a 6-second Undo; rows are real buttons with accessible names and arrow-key navigation (completes #58 with the /projects card aria-labels from 392ffa2); button reads "Analyse brief" / "Re-analyse brief".
- 787ab03 — Card 4.2 — #34, #37, #39 — One "not a cut file" warning per drawing; title, view name and thickness on separate baselines; parts without drawable dimensions get a link instead of an empty frame; concept ids display as human names; "What it must do" grows 3–16 rows; suggested concepts stay under Concepts until Keep.
- 55f2c7d — Card 4.3 — #25, #26, #27, #28, #29 — One QAR figure ("To buy now") plus a counts line; group headers show the to-buy subtotal and "ordered: QAR Y"; one "Request a quote for N unstocked items" button sends one bom_quote lead; one kit button; consumables follow one build route; USB cable deduped; Components and BOM share one selector.
- e18104e — Card 4.4 — #24, #30, #31, #32, #35, #40 — Side panels collapsed under 1440 px (saved choice wins); site header hidden in the workspace, whose bar carries logo/back/cart/language/sign-in; width up to 1760 px; opens on Brief for a new project, otherwise where the user left off; Quote/Production disabled with the reason inline when blocked; Material & process leaf shows material + process with "Accept this route"; blocked views show a banner with a fix link; Undo of a branch removal restores detected branches.
- Copy — Phase 4 strings in en + ar (parity 1683/1683), landed with fb94ef1 and the 4.3/4.4 commits.

No migrations. Pending owner steps: after 0030–0035, walk Plant monitor at 1280 px, 1920 px and in /ar — no dead clicks, no clipped tables, one cost figure, one quote button, one kit button, Components count = BOM count, drawings without overlap. Still open: wiring view too small (#38); drawing title-block values clip at ~26+ chars (pre-existing); Readiness labels show raw concept ids; the project page's QAR total and the BOM's "To buy now" are different figures (documented).


## Phase 5 — Entry points, navigation, public pages (2026-09-29, on main)
- Nav: Shop parts · Make a part · How it works; My projects with a session; account menu (Dashboard, Sign out); mobile menu under 768 px (components/header-nav.tsx).
- Home: three choices — Buy parts / Make my part / Turn an idea into a product.
- Project spine: /design/quote creates a project with the CAD file attached; /projects/new?for=drawing (brief + WhatsApp → drawing_request lead). FINDINGS #1 closed.
- Product page: Add to project (components/parts/add-to-project-button.tsx).
- How it works: all three paths.
- Prototyping on phones: tree behind a "Project sections" button; title on its own row.
- Per-page titles/descriptions (lib/meta.ts, Meta namespace); FIG·0x labels and spec chips removed.
- Copy en + ar parity 1994/1994. Tests 259 passed. Build green. Verified live at 375 px: no horizontal scroll on 11 pages, mobile menu works.

## Phase 6 — Admin, Arabic, polish (2026-09-29, on main)
- Dashboard: grouped sidebar + "What needs you today" overview (done earlier the same day).
- Leads: status filter (open by default) + kind filter (file quote, drawing, parts quote, callback, message; lib/admin/lead-kind.ts), links clickable, project CAD files as fresh 1-hour downloads, "Find the project".
- Admin projects: search by name / id / phone; guest owners show their WhatsApp number.
- Phones: isValidPhone() (lib/phone.ts) checked on checkout, callback, contact, quote and new-project forms; stored as +974…
- Parts customers need: grouped by kind of part (lib/admin/gap-key.ts), values kept as specs.
- Arabic: Western digits everywhere (ar-QA-u-nu-latn formatters, 9 message strings fixed); verified live on 5 /ar pages.
- Inventory tenant filter: same-name tenants get a short id.
- Cleanup: unused Features/LocalAdvantage/Social copy and the old spec sheet removed.
- Header = the three paths; projects / inventory / dashboard in the account menu; footer and home without repeats (owner).
- Tests 267 passed; build green; en/ar parity kept.

# Site review fixes — changelog
Source: STAGE_SITE_REVIEW_FIXES_PROMPT.md

## Phase A — Money and checkout (2026-10-03)
- Migration 0044: shipping is a flat QAR 50 on all tiers, handling fee 0; free delivery for goods >= QAR 300 on Standard only (`free_shipping_threshold` setting; Express never free); create_part_order v6 rejects a 0 total and requires an email for bank transfer; set_order_payment_method v2.
- Delivery cost is shown on the product page and in the cart ("Delivery from QAR 50", free-delivery gap).
- An empty cart sent to checkout is redirected to the cart on the server (client check stays as a fallback).
- Handling line hidden at 0; split-shipment option no longer reads "(+QAR 0.00)" when delivery is free.
- Copy fixes A4-A9: price note ("This is your final price. We confirm your order on WhatsApp."), card-payment "coming soon" once under the method list, Fawran account name shown with the legal name (page and email; IBAN stays email-only), email required with hint and inline error for bank transfer (EN + AR), company WhatsApp +974 6656 7410 link under the payment confirmation note (`COMPANY_WHATSAPP` in lib/company.ts), hint for delivery area "Other".
- Guest cart persistence verified: @supabase/ssr cookies have a 400-day maxAge, so no change was needed.
- Tests 319; i18n parity 2295/2295 EN/AR; `scripts/check-i18n-parity.mjs` added.
- Pending owner steps: run 0044 (after 0043).
