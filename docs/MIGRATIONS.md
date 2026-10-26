# Migrations

Run log, rules for new migrations, and the next free number. Files are in `supabase/migrations/` (92 files in this worktree). Run status is copied from the pre-audit `CLAUDE.md` (`docs/history/CLAUDE-2026-10-full.md`, "Pending migrations" and the stage log) and from the SQL file headers; nothing here was checked against the live database.

**Next free number: 0107.**

## Rules for a new migration

1. Never edit an applied migration. Write a new file.
2. Number it from 0107 upward. Before committing, re-run `ls supabase/migrations`: a parallel session can take your number.
3. Make it idempotent (safe to re-run; `on conflict do nothing` for seeds, so owner edits survive).
4. Put a rollback note in the header (every file from 0088 on has a `Rollback:` section, 0100-0105 included).
5. Add a PGlite test. Pattern: `lib/schools/db/schools-migration.test.ts`.
6. List it in this file, with its run status.
7. Say in the header what happens before it runs (the app should degrade, not break) and which earlier file it must follow.
8. Tell the owner the file name and the order to run in. Run only when the owner says so, in numeric order.
9. Check Supabase -> Table Editor to see which tables exist before running a pending file.

## Was pending — all run as of 2026-10-26

> **2026-10-26 — everything through 0106 has been run.** 0103 and 0104 went in before the
> app was deployed; 0100, 0101, 0102, 0105 and 0106 after it, in that order. Each row below
> says how it was confirmed. Where it says "probe", that is a read-only check through
> PostgREST with the PUBLIC key: a revoked function answers `42501` where it used to answer,
> a missing one answers `PGRST202`. 0101 and 0104 cannot be seen that way and rest on the
> owner's run.

| File | Notes |
|---|---|
| 0098_commission_floor.sql | RUN ✔ (confirmed by probe 2026-10-26: `commission_floor_pct` present). `store_settings.commission_floor_pct` (default 8); `refresh_part_sourcing` replaced so a mirror part is judged against the commission floor and a markup part against `margin_floor_pct` (15). Run after 0095. Until it runs every Voltaat product stays flagged "below margin" (911 of them). **Must run before 0103.** |
| 0100_studio_private.sql | RUN ✔ 2026-10-26 (probe: `project_studio_private` exists, anon denied) (audit DB-01). `project_studio_private` (service_role only); back-fill and removal of `studio.productPrivate`; guard trigger on `projects.studio`; `studio_product_save()`; strips private models from old `engineering_jobs.snapshot`. Run after 0099 and after the matching app commit is deployed. Afterwards every Studio product route needs `SUPABASE_SERVICE_ROLE_KEY` (503 without it). |
| 0101_ai_usage_server_only.sql | RUN ✔ 2026-10-26 (owner; not distinguishable from outside — both overloads are invisible to the public key) (audit DB-02). Revokes both `log_ai_usage` overloads from anon/authenticated; adds service-only `log_ai_usage_server` with per-row clamps; revokes `ai_usage_totals` from anon. |
| 0102_credits_server_spend.sql | RUN ✔ 2026-10-26 (probe: `spend_credit` went from callable to `42501`) (audit DB-04 / DB-06). Service-only `spend_credit_for` and `cad_set_code_for`; `spend_credit` and `cad_set_code` revoked from sessions. |
| 0103_guards_and_grants.sql | RUN ✔ 2026-10-26 (probe: `offer_landed_cost_qar` went from `HTTP 200` to `42501` for anon) (audit DB-07 to DB-22, API-02). Job refunds per token kind, guest-claim fix, order caps, revokes, admin-only columns, inquiry limits and more. Needs 0098 first. |
| 0104_quote_upload_path.sql | RUN ✔ 2026-10-26 (owner; a storage policy cannot be proven from outside without writing). The quote-uploads insert policy requires `<uuid>/<name>`. |
| 0106_idea_charge_telemetry.sql | RUN ✔ 2026-10-26 (probe: `admin_idea_charge_summary` went from `PGRST202 not found` to `42501`). Ideation-charge telemetry (owner, 2026-10-25): `idea_charge_telemetry` (estimated vs charged vs the provider tokens and USD that turn really consumed, plus `stage` 'quoted'/'charged' so declined checkpoints are countable; super-admin read only), `idea_charge_claim()` / `idea_charge_fill()` (the project's own owner writes its rows; the unique `(project_id, idea_key)` is the replay guard for a "different product" charge and keeps a repeated quote to one row) and `admin_idea_charge_summary(days)`. Run after 0105; safe to re-run. Nothing in the money path changes — until it runs the Studio charges the same and only records nothing. Test: `lib/studio/db/idea-telemetry-migration.test.ts`. |
| 0105_parts_cost_private.sql | RUN ✔ 2026-10-26 (probe: cost columns now `42501` while `sku`/`name`/`unit_price` stay readable). Column-level SELECT on `parts` without the cost columns, `parts_admin` view, internal `store_settings` keys hidden. Needs the matching app commit deployed first; after it, place one small test order and open Dashboard -> Store once. |

0100-0105 were added by the 2026-10 audit branch (`docs/audit/FINAL_REPORT.md` section 5 has the check queries). Run order: 0098, then 0100-0106, in numeric order.

### Listed as pending in `CLAUDE.md`, no run mark recorded

The pre-audit file listed these under "run in order if not already done" with no RUN mark. They are old and later files build on them, so they are probably applied, but the file never says so. Confirm in Supabase before relying on them.

| File | Notes |
|---|---|
| 0024_project_diagnostics.sql | `analysis_runs` + `project_events` + event triggers (after 0023). Until it runs, the export's raw responses and event log are empty. |
| 0026_electronics_feature.sql | Lets `ai_usage` / `analysis_runs` record the `electronics` feature (after 0025). The owner ran an early 0025 without it; until 0026 runs, electronics-builder calls work but are not metered or recorded. |
| 0027_bought_units_are_owned.sql | `create_part_order` also sets `project_items.qty_from_inventory`, so bought units stop showing as "to buy" (after 0026). |

### Header says NOT RUN YET (not recorded in the pre-audit `CLAUDE.md`)

| File | Notes |
|---|---|
| 0076_social_sign_in_profiles.sql | Header (2026-10-11): "NOT RUN YET. Run AFTER 0075. Safe to re-run." The app works before it runs. See `docs/SOCIAL_SIGN_IN.md`. |
| 0094_fx_rate_372.sql | Header: "Run any time after 0028. Safe to re-run. NOT RUN YET (the owner runs it)." USD to QAR 3.72. |
| 0095_supplier_rank.sql | Header: "Run AFTER 0028 (and after 0069). Safe to re-run. NOT RUN YET (written by Claude; the owner runs it)." Supplier running order. |

## Run log (oldest first)

RUN dates are the owner's, as recorded in the pre-audit `CLAUDE.md`. "No record" means the old file does not say whether or when it was run. Descriptions for 0008 and 0013-0019 come from the file names only.

| File | What it does | Status |
|---|---|---|
| 0001_auth_roles_rls | Auth, roles, multi-tenant RLS | RUN (stage 4, "migrations 0001-0003 run") |
| 0002_inquiries | `inquiries` table (anon insert) | RUN (stage 4) |
| 0003_profiles_phone | `profiles.phone` | RUN (stage 4) |
| 0004_inventory_items | Tenant `inventory_items` | RUN 2026-06-05 |
| 0005_jobs | `cad-files` private bucket, jobs | No record (old file: "needs 0005 run") |
| 0006_job_workflow | Job status workflow | No record |
| 0007_internal_jobs | Workshop internal jobs, BOM | No record |
| 0008_job_variations | Job variations | No record |
| 0009_security_hardening | Self-promotion fix, job guards | RUN 2026-06-10 |
| 0010_job_upsells | Job upsell columns | No record |
| 0011_parts_store | `parts`, `part_orders`, `part_order_items`, `create_part_order` | No record |
| 0012_quote_uploads | Private `quote-uploads` bucket (needs `SUPABASE_SERVICE_ROLE_KEY`) | No record |
| 0013_drop_jobs | Drops the jobs tables | No record (not mentioned) |
| 0014_harden_guest_orders | Guest order hardening | No record (not mentioned) |
| 0015_projects | Projects | No record (not mentioned) |
| 0016_cart_items | Cart | No record (not mentioned) |
| 0017_client_inventory | Client inventory | No record (not mentioned) |
| 0018_project_files | Project files | No record (not mentioned) |
| 0019_project_item_allocation | Project item allocation | No record (not mentioned) |
| 0020_prototyping | Prototyping tables, `projects.brief/stage/stages` | No record (listed pending, no mark) |
| 0021_prototyping_disciplines | `projects.disciplines` | RUN 2026-09-21 |
| 0022_prototyping_spec_and_sources | `projects.spec`, `project_parts` source columns | RUN (confirmed 2026-09-22) |
| 0023_bom_netlist_drawings_usage | BOM, netlist, part dimensions, `ai_usage` + RPCs | RUN (confirmed 2026-09-22) |
| 0024_project_diagnostics | `analysis_runs`, `project_events` | Pending list, no mark (see above) |
| 0025_electronics_attributes_kits | Build route, part attributes, kits | RUN 2026-09-22 |
| 0026_electronics_feature | `electronics` feature | Pending list, no mark (see above) |
| 0027_bought_units_are_owned | `qty_from_inventory` on order | Pending list, no mark (see above) |
| 0028_suppliers_and_offers | Suppliers, offers, derived sourcing | No record |
| 0029_intake_demand_delivery | Images bucket, demand signals, shipping tiers, `create_part_order` v3 | No record |
| 0030_merge_duplicate_parts | Merges duplicate products | RUN (owner ran 0030-0035 by 2026-09-27) |
| 0031_is_test_flag | `is_test` flag | RUN (by 2026-09-27) |
| 0032_on_request_checkout | On-request items at the listed price | RUN (by 2026-09-27) |
| 0033_order_links_and_delete_fix | Fixes the 0024 trigger that broke project delete | RUN (by 2026-09-27) |
| 0034_checkout_quantity_fix | `create_part_order` v5; one-time repair (never drop its log table) | RUN (by 2026-09-27) |
| 0035_delete_project | `delete_project()` | RUN (by 2026-09-27) |
| 0036_voltaat_sync | `supplier_sync_runs`, `voltaat_sync` switch | No record |
| 0037_restock | Restock weights, receipts, `restock_summary()` | No record |
| 0038_ai_pricing | `ai_pricing` setting, `project_ai_charges()` | No record |
| 0039_payment_method | `part_orders.payment_method` | RUN 2026-09-29 |
| 0040_firmware | `projects.firmware`, `firmware` feature | RUN 2026-09-29 |
| 0041_datasheets_and_backups | `parts.datasheet_url/specs/backup_for` | RUN 2026-09-29 |
| 0042_ai_credits | `credits_ledger`, project limit, credit RPCs (also turn ON "Confirm email" in Supabase Auth) | RUN 2026-10-02 |
| 0043_cad_generations | `cad_generations` + RPCs | RUN 2026-10-08 |
| 0044_shipping_flat_free_threshold | QAR 50 all tiers, free threshold QAR 300, `create_part_order` v6 | RUN 2026-10-08 |
| 0045_project_recovery_link | Project link by email (D6) | RUN 2026-10-08 |
| 0046_notification_outbox | Credit/milestone email outbox | RUN 2026-10-08 |
| 0047_parts_arabic_details | `specs_ar`, `details_ar_at` | RUN 2026-10-08 |
| 0048_store_categories | `parts.store_category` (nine values) | RUN 2026-10-08 |
| 0049_videos_bucket | Public `videos` bucket | RUN 2026-10-08 |
| 0050_one_ai_price | `ai_pricing` per call QAR 20, charging off | RUN 2026-10-09 |
| 0051_pricing_settings | `pricing_plans`, `service_prices` seeds | RUN 2026-10-09 |
| 0052_no_free_circuit | Every circuit costs 1 wiring credit | RUN 2026-10-09 |
| 0053_order_status_history | Order statuses, history, credits `earned_at` | RUN 2026-10-09 |
| 0054_working_days | Holidays, working-day functions, `order_delivery_quote` v3 | RUN 2026-10-09 |
| 0055_turnstile_and_cleanup | Turnstile switch, anonymous cleanup | RUN 2026-10-09 |
| 0056_phase3 | `site_v2` flag, `occasions` | RUN 2026-10-09 |
| 0057_co_purchased | `co_purchased()` | RUN 2026-10-09 |
| 0058_reviews | `reviews` and RPCs | RUN 2026-10-09 |
| 0059_youtube | `store_settings.youtube` seed | RUN 2026-10-10 |
| 0060_price_experiment | Price experiment (off) | RUN 2026-10-09 |
| 0061_price_funnel_fix | `price_cohort_funnel()` fix | RUN 2026-10-10 |
| 0062_edm_price_drawing_uploads | `edm_from` 350; `project-images` limit 20 MB | RUN 2026-10-10 |
| 0064_normalise_phones | Phones stored as +974XXXXXXXX | RUN 2026-10-10 |
| 0066_qatar_holidays | Qatar public holidays merged into `holidays.dates` | RUN 2026-10-10 |
| 0067_cad_engine | `cad_engine` switch seeded as `browser` | RUN 2026-10-10 |
| 0068_design_studio | `projects.studio`, `studio_version`, `studio` feature | RUN 2026-10-10 |
| 0069_own_stock | `own_stock`, `parts.in_own_stock` | RUN 2026-10-11 |
| 0070_studio_parts | `studio_parts`, `studio-models` bucket | RUN 2026-10-11 |
| 0071_claim_guest_work | `claim_guest_work()` | RUN 2026-10-11 |
| 0072_integrations | `integrations` (YouTube), service_role only | RUN 2026-10-11 |
| 0073_quote_calculation | Inquiry quote columns, `project_quote()`, `studio_quote_rule` | RUN 2026-10-11 |
| 0074_edu_credits | Edu-email credit grants | RUN 2026-10-11 |
| 0075_edu_credits_two_wiring | Edu grant: wiring +2, cad +1 | RUN 2026-10-11 |
| 0076_social_sign_in_profiles | Social sign-in profiles | Header: NOT RUN YET |
| 0088_ideation_tokens | Third credit kind `idea` (header: after 0087) | No record in the audit-base history file; the main checkout `CLAUDE.md` says 0088-0093 RUN (owner, 2026-10-23) |
| 0089_payments_maker_pass | Payments, Maker Pass (owner, 2026-10-18) | No record |
| 0090_cad_cost_rewards | CAD session cost per tier, rewards | No record |
| 0091_engineering_jobs | Engineering jobs queue | No record |
| 0092_engineer_services | Paid engineer services | No record |
| 0093_function_search_path | Pins `search_path` on three functions | No record |
| 0094_fx_rate_372 | USD = 3.72 QAR | RUN (probe 2026-10-26: `fx_to_qar` holds USD 3.72) |
| 0095_supplier_rank | Supplier running order | RUN (probe 2026-10-26: `suppliers.rank` exists) |
| 0096_school_classes | School classes, class teams, class pricing seed | RUN 2026-10-21 |
| 0097_class_order | `part_orders.class_id`, `create_part_order` v5 with `p_class_id` | RUN 2026-10-21; still to confirm: one test order through checkout (this file replaced `create_part_order`) |
| 0098_commission_floor | Commission floor | RUN (probe 2026-10-26: the key is present) |
| 0099_analysis_request_hash | Remembers which request each analysis answered | RUN (probe 2026-10-26: `analysis_runs.request_hash` exists) |
| 0100 to 0105 | Audit migrations | RUN 2026-10-26 (see above; 0103 and 0104 before the deploy, the rest after) |
| 0106_idea_charge_telemetry | Ideation charges: quoted vs charged vs actual, admin read only | RUN 2026-10-26 |

## Gaps in the numbering

0063, 0065 and 0077-0087 are not in this worktree. The main checkout `CLAUDE.md` says 0077-0086 (CAD Champions, `cc_*` tables, branch `cad-champions`) were RUN by the owner on 2026-10-15; they are not on this branch, so they are not logged above. The 0088 header refers to a "0087 (cad-champions)" that is not here, and the pre-audit file says 0096 and 0097 were taken by other branches ("Numbered 0098 because review-analyse-guard took 0096 and main took 0096 + 0097"). Before using a number, check `ls supabase/migrations` on `origin/main` and open branches.

## Where more detail lives

- Full old per-migration text (what each did, what breaks until it runs): `docs/history/CLAUDE-2026-10-full.md`, section "PENDING MIGRATIONS".
- Check queries for 0098-0105: `docs/audit/FINAL_REPORT.md` section 5.
- Test data written by demos: `docs/TEST_DATA_CLEANUP.md`.
