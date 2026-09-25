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
