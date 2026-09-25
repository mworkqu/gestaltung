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
