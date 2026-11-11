# The "PENDING MIGRATIONS" block of CLAUDE.md, as it stood on 2026-11-11

A record, not rules. Moved out of `CLAUDE.md` verbatim (lines 112-270) in the 2026-11 consolidation, phase 5, so the index stays short. Every migration listed here is RUN. For the run log, how each one was confirmed, and what is still pending, read `docs/MIGRATIONS.md`.


## PENDING MIGRATIONS (run in order if not already done)

**2026-11 consolidation: new NOT RUN files from 0107 on are listed in `docs/MIGRATIONS.md` ("Pending — consolidation 2026-11").** Through 0106: everything has been run — 0103 and 0104 before the
app deploy, 0100 / 0101 / 0102 / 0105 / 0106 after it. The entries below are kept for their
descriptions and rollback notes; see docs/MIGRATIONS.md for how each one was confirmed.
Check Supabase → Table Editor to confirm which tables exist before running.
**Run order is load-bearing: 0096, 0097, 0098, 0099, then 0100-0106.** 0103's order-line
guard reads `part_orders.class_id`, which comes from 0097; plpgsql resolves that column when
the trigger first fires, so applying 0103 before 0097 succeeds and then makes every
`part_order_items` insert fail — checkout dies silently. See `docs/audit/FIX_REPORT.md` §4,
which also records that the run status of 0096/0097 disagrees between two copies of this
file and must be confirmed in Supabase first.
- 0106_idea_charge_telemetry.sql — RUN ✔ 2026-10-26. Ideation-charge telemetry (owner, 2026-10-25): `idea_charge_telemetry`
  (one row per priced decision, `stage` 'quoted' = the checkpoint was shown at that price, 'charged' = approved and
  taken, so quoted minus charged is how often a price is declined; estimated vs charged vs what the model really
  consumed; super-admin read only, no session may write a row directly), `idea_charge_claim()` (writes the quote and
  later the charge; its unique `(project_id, idea_key)` is the replay guard for "this message starts a different
  product" and keeps a repeatedly shown quote to one row), `idea_charge_fill()` (what was really charged and
  consumed; never fills a quote) and `admin_idea_charge_summary(days)`. Run AFTER 0105;
  safe to re-run. Touches nothing in the money path (`idea_token_charge` from 0088 is untouched). Until it runs, the
  Studio charges exactly as it does with it — a missing claim only means nothing is recorded (one warning per call
  in the server log), so the owner cannot yet compare the agreed deduction with the provider cost.
- 0100_studio_private.sql — RUN ✔ 2026-10-26. Audit DB-01: public.project_studio_private (service_role only; the Studio
  product models, back-filled from projects.studio.productPrivate, which is then removed — updated_at kept), trigger
  projects_guard_studio_server_keys (anon/authenticated writes cannot store productPrivate or change studio.product;
  a null/non-object studio keeps the stored product), studio_product_save(project, user, version, studio, private)
  (service_role; owner or super_admin only); also strips studio.productPrivate from engineering_jobs.snapshot (G1.2:
  jobs submitted before this branch hold a copy of the models, readable by the job's owner; not reversed by the
  rollback). RUN AFTER 0099, AFTER the app commit is deployed. Safe to re-run.
  Until it runs the app keeps the models in studio.productPrivate (owners can still read them via PostgREST); after
  it, every Studio product route needs SUPABASE_SERVICE_ROLE_KEY (503 service_unavailable without it).
- 0101_ai_usage_server_only.sql — RUN ✔ 2026-10-26. Audit DB-02: both log_ai_usage overloads revoked from anon/authenticated;
  log_ai_usage_server(p_user, …) service_role only, user required, per-row clamps (tokens ≤ 2,000,000, audio ≤ 3,600 s,
  cost ≤ USD 50, latency ≤ 600,000 ms), is_test copied from the project again; ai_usage_totals revoked from anon.
  RUN AFTER 0100. Safe to re-run. Until it runs the app falls back to the old client RPC (any session can still trip
  the global AI pause). After it, usage rows are written only when SUPABASE_SERVICE_ROLE_KEY is set.
- 0102_credits_server_spend.sql — RUN ✔ 2026-10-26. Audit DB-04/DB-06/G-C1: spend_credit_for(p_user, p_step, p_project)
  (service_role; same body as spend_credit v4); spend_credit revoked from anon/authenticated (cad_deliver still calls
  it internally); cad_set_code_for(p_user, p_id, p_scad, p_model) (service_role; the 0043 body, the generation must
  be p_user's) and cad_set_code revoked from anon/authenticated (a session can no longer store fake CAD code and let
  cad_deliver mint a voucher spend row); ends with notify pgrst. RUN AFTER 0101. Safe to re-run. Until it runs
  spend() / setCadCode() fall back to spend_credit / cad_set_code on the session (sessions can still mint redeemable
  spend rows / drain a teacher's class credits by direct RPC). The app already needs SUPABASE_SERVICE_ROLE_KEY for
  CAD (/api/cad, studio enclosure, product unlock) and non-admin wiring circuits: 503 without it, before any model call.
- 0103_guards_and_grants.sql — RUN ✔ 2026-10-26. Audit DB-07/08/10/11/12/13/16/17/18/19/22 + API-02 (signatures unchanged):
  job refunds go back per token kind (pass tokens as idea_pass); claim_guest_work drops the guest's duplicate
  idea_welcome; ORDER LIMITS — quantity ≤ 1000 per line, ≤ 100 lines per order, ≤ 10 orders per hour per customer
  phone (its last 8 digits, so +974 / 00974 / local forms are one phone) or email ('too_many_orders' /
  'quantity_too_large' / 'too_many_lines', mapped by lib/store/checkout.ts to Checkout.errorTooManyOrders /
  errorQtyCap / errorLineCap — the page shows them once lib/store/place-order.ts passes those keys through;
  super_admin/service_role exempt); log_project_event not client-callable; is_test/tenant_id admin-only on projects;
  claim_project and project_recovery_begin refuse class team projects ('invalid'); INQUIRIES LIMITS — name ≤ 120, phone ≤ 40, email ≤ 160, message ≤ 8000 characters (NOT VALID: old rows
  kept) and public inserts are forced to status 'new', is_test false; set_order_payment_method only for the caller's
  own order; refresh_part_sourcing / offer_landed_cost_qar admin, service_role, triggers or direct SQL only;
  class helper functions not for anon, and the 0096 policy projects_select_class_teacher limited to authenticated (so
  an anon SELECT on projects returns no rows instead of a permission error); project_recovery_begin ≤ 3 emails per
  address per 24 h; ends with notify pgrst. RUN AFTER 0102 AND
  AFTER 0098 (both RUN ✔ 2026-10-26; 0103 replaces refresh_part_sourcing with 0098's version plus the caller check).
  Safe to re-run. Until it runs every hole above stays open.
- 0104_quote_upload_path.sql — RUN ✔ 2026-10-26. Audit DB-15/WEB-06: the quote-uploads INSERT policy also requires
  `<uuid>/<[A-Za-z0-9._-]{1,200}>`, no "..", not "." (what components/design/quote-request.tsx writes and
  lib/design/quote-paths.ts signs); 50 MB kept, MIME not restricted. RUN AFTER 0103. Safe to re-run. Until it runs
  anyone can write any object name into the bucket.
- 0105_parts_cost_private.sql — RUN ✔ 2026-10-26. Audit DB-09: parts cost/sourcing columns (landed_cost_qar,
  expected_income_qar, income_pct, below_floor, pinned/preferred_offer_id, pricing_mode) no longer selectable by
  anon/authenticated (column grants; select=* on parts by the browser or a session is denied), public.parts_admin
  view for super_admin reads, store_settings internal keys hidden from the public (price_experiment, margin/commission
  floors, fx_to_qar, anonymous_cleanup, backup_search, ai_limits, restock_weights, voltaat_sync, fix_on_request,
  csv_mapping:*). RUN AFTER 0104 and AFTER the app commit is deployed (every public reader, including
  components/prototyping/workspace.tsx, now names its columns). parts_admin is a security_barrier view; post-condition
  asserts make the run fail if anon/authenticated can still read a hidden column (e.g. through a grant to PUBLIC).
  Safe to re-run, BUT a re-run after a new parts column was added grants that column to anon/authenticated (the list
  is rebuilt from the live columns) and re-creates parts_admin with it (its column list is frozen at creation). A NEW
  parts column must be granted to anon/authenticated in its own migration. Until it runs anyone reads every margin.
- 0096_school_classes.sql - RUN ✔ 2026-10-21 (owner, live probe). School classes, teams, comments, class-teacher credit routing, school_pricing seed; details in `docs/MIGRATIONS.md`.
- 0097_class_order.sql - RUN ✔ 2026-10-21 (owner, live probe). STILL TO CONFIRM: one test order through checkout, since this file replaced create_part_order (`create_part_order` v5 with `p_class_id`).
- 0098_commission_floor.sql — RUN ✔ 2026-10-26 (probe: commission_floor_pct present). store_settings.commission_floor_pct (default 8) + refresh_part_sourcing
  replaced so a mirror part is judged against the commission floor and a markup part against margin_floor_pct
  (15). Numbered 0098 because review-analyse-guard took 0096 and main took 0096 + 0097. RUN AFTER 0095 — it
  builds on 0095's version of the function, so running it does NOT revert suppliers.rank. Safe to re-run; an
  owner-edited commission floor survives. Until it runs, every Voltaat product stays flagged "below margin"
  (911 of them, because income_pct on a mirror part always equals the supplier's commission) and the admin UI
  shows the commission floor as 8 without a row behind it.
- 0010_job_upsells.sql — jobs upsell columns (speed_tier, post_processing, inspection_report, job_path, production_qty_range)
- 0011_parts_store.sql — parts, part_orders, part_order_items tables + create_part_order RPC
- 0012_quote_uploads.sql — private `quote-uploads` storage bucket + policies for the public /design/quote flow
  (RUN THIS before the drag-and-drop quote upload works in production; needs SUPABASE_SERVICE_ROLE_KEY set)
- 0020_prototyping.sql — prototyping tables + projects.brief/stage/stages (RUN AFTER 0019; /projects/<id>/prototyping
  loads without it but cannot save an analysis until it runs)
- 0021_prototyping_disciplines.sql — projects.disciplines jsonb (RUN 2026-09-21 ✔)
- 0022_prototyping_spec_and_sources.sql — projects.spec + project_parts source/kind/catalog columns (RUN ✔ —
  confirmed 2026-09-22 by a live analysis saving spec + parts)
- 0023_bom_netlist_drawings_usage.sql — projects.bom/netlist, part dimensions, parts.tags, sourcing_gaps,
  ai_usage + RPCs (RUN ✔ — confirmed 2026-09-22)
- 0028_suppliers_and_offers.sql — suppliers, supplier_offers, pricing modes, derived sourcing (RUN AFTER 0027;
  /dashboard/store/suppliers and the product Sourcing panel show "run 0028" until it runs)
- 0029_intake_demand_delivery.sql — images bucket, demand signals, shipping tiers, promised dates,
  create_part_order v3 (RUN AFTER 0028; until it runs, checkout detects the missing quote function (PGRST202)
  and keeps the old no-shipping flow)
- 0030_merge_duplicate_parts.sql — merges duplicate store products, repoints references, soft-deletes losers via
  merged_into, unique guard (RUN AFTER 0029; dry-run/backup blocks at the top)
- 0031_is_test_flag.sql — is_test on projects, inquiries, part_orders, parts, ai_usage (RUN AFTER 0030)
- 0032_on_request_checkout.sql — on-request items orderable at the listed price, "Date to be confirmed"
  (RUN AFTER 0031)
- 0033_order_links_and_delete_fix.sql — fixes the 0024 trigger that broke project delete; copies notes into empty briefs (RUN AFTER 0032)
- 0034_checkout_quantity_fix.sql — create_part_order v5 stops doubling project-line quantities at checkout;
  one-time repair of doubled lines with a DRY RUN block (RUN AFTER 0033; the repair runs once — never drop its
  log table)
- 0035_delete_project.sql — delete_project(): transactional project delete (RUN AFTER 0034)
- 0036_voltaat_sync.sql — supplier_sync_runs + voltaat_sync switch (RUN AFTER 0035; the Voltaat sync page says
  "run 0036" until then)
- 0037_restock.sql — restock weights, supplier minimum order value, receipts, restock_summary() (RUN AFTER 0036)
- 0038_ai_pricing.sql — ai_pricing setting + project_ai_charges() (RUN AFTER 0037; the Payment box on the Quote
  step stays hidden until then)
- 0039_payment_method.sql — (RUN ✔ 2026-09-29) part_orders.payment_method + set_order_payment_method() (RUN AFTER 0038; until then
  orders are placed without a recorded method but the success page still shows the chosen one)
- 0041_datasheets_and_backups.sql — (RUN ✔ 2026-09-29) parts.datasheet_url/specs/backup_for
- 0040_firmware.sql — (RUN ✔ 2026-09-29) projects.firmware + 'firmware' ai_usage/analysis_runs feature (RUN AFTER 0039)
- 0043_cad_generations.sql — (RUN ✔ 2026-10-08, confirmed by live probe) cad_generations + cad_begin/cad_set_code/cad_deliver/cad_fail, analysis_runs 'cad'
  (RUN AFTER 0042; until then the 3D model card only shows the cost dialog)
- 0044_shipping_flat_free_threshold.sql — (RUN ✔ 2026-10-08, confirmed by live probe) QAR 50 all tiers + handling 0, free_shipping_threshold (QAR 300, Standard), quote v2, create_part_order v6 (+p_payment_method; bank transfer needs email; total > 0), set_order_payment_method v2 (RUN AFTER 0043; checkout falls back to the old call until then)
- 0045_project_recovery_link.sql — (RUN ✔ 2026-10-08, confirmed by live probe) D6 project link by email: projects.contact_email/recovery_token/recovery_emailed_at (guarded), project_recovery_begin(), claim_project() (moves a GUEST project to the session holding the #key= link, key rotated, new link emailed), storage read/delete by project owner (RUN AFTER 0044; until then /projects/new skips the email and #key= links show "not available")
- 0046_notification_outbox.sql — (RUN ✔ 2026-10-08, confirmed by live probe) Phase I credit/milestone emails: notification_outbox (+ unique dedupe index) + notification_prefs (unsubscribe token), triggers on credits_ledger/projects, claim_notifications / mark_notification / notification_unsubscribe (service_role), store_settings.notifications (discount_ready OFF) (RUN AFTER 0045; until then /api/cron/notifications answers 500 claim_failed and nothing is queued)
- 0047_parts_arabic_details.sql — (RUN ✔ 2026-10-08, confirmed by live probe) Phase E1: parts.specs_ar (Arabic spec rows, same shape as specs) + parts.details_ar_at (translate marker); description_ar already exists (RUN AFTER 0046; then Dashboard → Store → Sourcing overview → "Arabic descriptions and specs" → Translate; until then /ar product pages show headings + "not translated yet" and the step answers run_0047)
- 0048_store_categories.sql — (RUN ✔ 2026-10-08, confirmed by live probe) C5: parts.store_category (nine values, check constraint) + store_category_review, store_category_rules + trigger for new products, per-SKU mapping of 1,323 published products, gift card unpublished (RUN AFTER 0047, does not depend on it; until then the store shows the old categories; afterwards press any Dashboard → Store save or wait 5 min)
- 0049_videos_bucket.sql — (RUN ✔ 2026-10-08) CC-2: public `videos` bucket (public read, super-admin write, 50 MB, mp4/webm/jpeg/vtt) for the feature videos (RUN AFTER 0048, does not depend on it; until then the video slots fall back to the poster / placeholder, nothing breaks; then `node scripts/upload-video.mjs <folder>` per clip)
- 0062_edm_price_drawing_uploads.sql — RUN ✔ 2026-10-10 (owner; verified edm_from 350, bucket 20 MB) P5-05/P5-06: adds store_settings.service_prices.edm_from = 350 (only when missing; OWNER TO CONFIRM) and raises the private project-images bucket limit 10 MB -> 20 MB for drawing-request uploads (RUN AFTER 0061; until then the app uses the same edm_from default from lib/pricing/defaults.ts and a drawing-request file over 10 MB fails to upload - the request is still sent and the confirmation asks the client to WhatsApp the file)
- 0075_edu_credits_two_wiring.sql — RUN ✔ 2026-10-11 (owner; verified: 1 edu account at 2 wiring + 1 cad, is_edu_email ok). edu_credit_grant now grants wiring +2 / cad +1; tops up every account already granted by 0074 to 2 wiring (RAISE NOTICE prints how many).
- 0074_edu_credits.sql — RUN ✔ 2026-10-11 (owner). edu_credit_grants (RLS on, no policies), is_edu_email / edu_email_key / edu_credit_grant (SECURITY DEFINER), trigger on_auth_user_edu_credits on auth.users, one-time back-fill of confirmed edu accounts (RAISE NOTICE prints how many). Safe to re-run (no second grant). Rollback drops are in the header (RUN AFTER 0073).
- 0072_integrations.sql — RUN ✔ 2026-10-11 (owner; verified: anon gets permission denied, table exists). D6: public.integrations (provider 'youtube', refresh_token_enc sealed by the app, scopes, account_label, metadata quota/uploads), RLS on with no policies + privileges revoked from anon/authenticated (service_role only). Until run: Videos & YouTube page shows Download/copy only and says the connection needs 0072.
- 0073_quote_calculation.sql — RUN ✔ 2026-10-11 (owner; verified studio_quote_rule row). W2b: inquiries project_id/quote_calc/final_quote_qar/quote_note/quoted_at/quoted_by + guard trigger (public inserts cannot set them), project_quote(p_project) (owner or super_admin), store_settings.studio_quote_rule {base_qar 100, per_gram_qar 0.7, spread 1.5}. Until run: leads save without the calculation, admin says "Run migration 0073 first".
- 0071_claim_guest_work.sql — RUN ✔ 2026-10-11 (owner; verified live: service_role only, guest project moved, second call no-op). W1: claim_guest_work(p_from, p_to) SECURITY DEFINER, service_role only; moves a guest's projects (+children), cart, own inventory, kits, credits, orders, CAD/analysis history and file ownership to the account they signed in to. Until run, the claim fails safely and the Try again notice shows.
- 0070_studio_parts.sql — RUN ✔ 2026-10-11 (owner; verified studio_parts readable, public studio-models bucket 20 MB STL). P5-15c Studio library admin: studio_parts (id, data LibraryPart jsonb, enabled; anon reads enabled rows, super admin writes) + studio-models bucket (RUN AFTER 0069; safe to re-run)
- 0069_own_stock.sql — RUN ✔ 2026-10-11 (owner; verified own_stock + parts.in_own_stock, both empty until the first "I bought these"). P5-12: own_stock (admin only), parts.in_own_stock (public flag → "In stock in Lusail"), mark_restock_received adds to it, set_own_stock, sales count down (RUN AFTER 0068; safe to re-run)
- 0068_design_studio.sql — RUN ✔ 2026-10-10 (owner; verified projects.studio + studio_version readable). P5-13 Design Studio: projects.studio jsonb (StudioDoc, lib/studio/schema.ts) + studio_version int (optimistic save), ai_usage/analysis_runs feature 'studio' (RUN AFTER 0067; safe to re-run)
- 0067_cad_engine.sql — RUN ✔ 2026-10-10 (verified: cad_engine = browser). Cloud CAD engine switch: seeds store_settings.cad_engine = {"engine": "browser", "min_wall_mm": 1.2} (on conflict do nothing; no new table/function; RLS unchanged) (RUN AFTER 0066; safe to re-run; until then — and while it says "browser" — every 3D model is built in the browser as today. To test the cloud worker: set GCP_CAD_URL + GCP_WIF_PROVIDER + GCP_CAD_SA_EMAIL in Vercel, then `update public.store_settings set value = '{"engine": "admin", "min_wall_mm": 1.2}'::jsonb where key = 'cad_engine';` and any Dashboard → Store save)
- 0066_qatar_holidays.sql — RUN ✔ 2026-10-10 (owner; verified 10 dates) Group 8 / P5-08: merges Qatar public holidays into store_settings.holidays.dates without removing owner entries or the weekend: National Day 2026-12-18/19 + 2027-12-18, National Sports Day 2027-02-09 (2nd Tuesday of Feb), and the EXPECTED Eid al-Fitr 2027-03-09..11 / Eid al-Adha 2027-05-16..18 (owner confirms when announced; the admin editor tags them "Expected" via QATAR_EXPECTED_HOLIDAYS in lib/store/working-days.ts). Code fallback = DEFAULT_HOLIDAYS (RUN AFTER 0054; safe to re-run)
- 0064_normalise_phones.sql — RUN ✔ 2026-10-10 (owner; verified phones +974XXXXXXXX) Group 7 / P5-07: stores every Qatar phone as bare E.164 (+974XXXXXXXX): spaced, bare 8-digit and doubled-country-code values in inquiries.phone, profiles.phone and part_orders.customer_phone (read-only check: 6 / 0 / 3 rows would change; foreign and junk numbers untouched; dry-run query in the header) (RUN AFTER 0063; the app already normalises new writes and DISPLAYS +974 XXXX XXXX via lib/phone.ts formatPhoneDisplay)
- 0061_price_funnel_fix.sql — (RUN ✔ 2026-10-10) P4-02 follow-up: re-creates price_cohort_funnel() so "bought credits" counts only admin_grant / topup: rows, not credits earned from delivered orders (RUN AFTER 0060; safe to re-run; until then the Funnel card's "bought credits" may include earned credits)
- 0060_price_experiment.sql — (RUN ✔ 2026-10-09) P4-02: store_settings.price_experiment (off; hidden from anon via the replaced store_settings_select policy), profiles.price_cohort + guard trigger, price_experiment_quote (anon), claim_price_cohort / my_price_quote (authenticated), price_cohort_funnel (super admin) (RUN AFTER 0059 by its header, but independent of it; safe to re-run)
- 0059_youtube.sql — (RUN ✔ 2026-10-10) P4-05: seeds store_settings.youtube {"channel_url": "", "videos": []} (on conflict do nothing; RLS unchanged) (RUN AFTER 0058; safe to re-run; optional — the admin editor's first save creates the row; until then the YouTube row renders nothing)
- 0058_reviews.sql — (RUN ✔ 2026-10-09) P4-03: reviews table (order_id unique, score, comment ≤ 280, locale, status pending|approved|rejected, skus jsonb, first_name), RLS super admin only, record_order_review (service_role), set_review_status (super admin), approved_reviews / approved_review_count (anon, approved only), back-fill of existing rating signals as pending (RUN AFTER 0057; safe to re-run; until then the rate route still thanks the user, public sections render nothing and the admin page says "Run migration 0058 first")
- 0057_co_purchased.sql — (RUN ✔ 2026-10-09) P3-06: co_purchased(p_sku, p_limit default 3) SECURITY DEFINER (anon + authenticated EXECUTE; returns only sku + distinct-order count; excludes cancelled + is_test orders, unpublished/merged products and p_sku itself; limit clamped 1..12) + index part_order_items(part_id) (RUN AFTER 0056; safe to re-run; until then the product page falls back to same-category products under "You may also need" and nothing breaks)
- 0056_phase3.sql — (RUN ✔ 2026-10-09) P3-03: store_settings.site_v2 {"enabled": false} (switch for the v2 public pages, read by middleware) + store_settings.occasions (4 seasonal campaigns, dates are defaults for the owner to confirm; ramadan-eid dates change every year), both on conflict do nothing; RLS unchanged (RUN AFTER 0055; safe to re-run; until then the flag reads OFF — site unchanged, /…/v2 404 except with the preview cookie — and occasions read as none)
- 0055_turnstile_and_cleanup.sql — (RUN ✔ 2026-10-09) P2-08/P2-09: store_settings.turnstile {"enabled": false} + anonymous_cleanup {"enabled": true, "dry_run": true, "days": 30} (on conflict do nothing), cleanup_runs, cleanup_anonymous_users() (service_role only; FK audit in the header) (RUN AFTER 0054; safe to re-run; until then the Turnstile switch reads OFF and the cleanup cron answers 500 run_0055)
- 0054_working_days.sql — (RUN ✔ 2026-10-09) P2-06/P2-07: store_settings.holidays (Fri/Sat + National Day, on conflict do nothing), working_days_config / add_working_days / is_working_day, order_delivery_quote v3 (handling + transit + buffer in Qatar working days, never on a weekend/holiday; supplier lead stays calendar days), part_public_source() for the product-page "Source" line (RUN AFTER 0053; safe to re-run; until then dates stay calendar days, no source line, the holidays editor says "run 0054")
- 0053_order_status_history.sql — (RUN ✔ 2026-10-09) P2-01/P2-02: order statuses mapped (pending→confirmed, processing→sourcing, + paid), order_status_history + triggers, set_order_status, order_* email kinds + store_settings keys, credits earned_at (oldest earned first, 30 days from the earn date; existing unredeemed spends shortened) + discount_ready ON, demand_signals 'rating' + record_order_rating (RUN AFTER 0052 — it replaces 0052's spend_credit; safe to re-run; dry-run queries in the header; until then /orders works with created_at only, admin "paid"/notes refuse with "run 0053", no status emails)
- 0052_no_free_circuit.sql — (RUN ✔ 2026-10-09) owner 2026-10-09: credit_can_use + spend_credit replaced, every circuit costs 1 wiring credit (no free first circuit); free_wiring_used kept as the first_circuit email marker (RUN AFTER 0051; safe to re-run; until then lib/credits/server.ts applies the same rule and charges the credit itself)
- 0051_pricing_settings.sql — (RUN ✔ 2026-10-09) P1-06/P1-07: seeds store_settings.pricing_plans + service_prices with `on conflict (key) do nothing` (owner edits survive re-runs) (RUN AFTER 0050; until then /pricing, /design and /design/drawing show the identical defaults from lib/pricing/defaults.ts; after editing either row, press any Dashboard → Store save or wait 5 min)
- 0050_one_ai_price.sql — (RUN ✔ 2026-10-09) P0-05: store_settings.ai_pricing = {"per_call_qar": 20, "charging": false} so the per-call price equals the credit price (QAR 20); charging stays off (RUN AFTER 0049; until then the usage page and the admin form show the old QAR 1)
- 0042_ai_credits.sql — (RUN ✔ 2026-10-02) AI access + credits: credits_ledger, projects.status/limit, rate limits, credit RPCs,
  profiles.email sync, ai_usage_log (RUN AFTER 0041; also turn ON "Confirm email" in Supabase Auth)
- 0027_bought_units_are_owned.sql — create_part_order also sets project_items.qty_from_inventory, so units
  bought for a project stop showing as "to buy" (RUN AFTER 0026)
- 0026_electronics_feature.sql — lets ai_usage / analysis_runs record the 'electronics' feature (RUN AFTER
  0025; the owner ran an early 0025 without it — until 0026 runs, electronics-builder calls work but aren't
  metered or recorded)
- 0024_project_diagnostics.sql — analysis_runs + project_events + event triggers (RUN AFTER 0023; the
  export's raw responses and event log are empty until it runs)
