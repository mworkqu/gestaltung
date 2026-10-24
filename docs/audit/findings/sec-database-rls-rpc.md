# sec-db — Database / RLS / RPC security review (migrations 0001→0099, final state)

Scope read: all 86 files in `supabase/migrations/` in number order (0048 data block and 0030 merge block skimmed for DDL only), `lib/supabase/service.ts`, every `.rpc("…")` in app/lib/components, every browser-client `.from("<table>")`, plus the app routes that consume the risky RPCs (`app/api/cad`, `app/api/studio/product/{model,unlock}`, `lib/ai/usage.ts`, `lib/billing/server.ts`, `lib/auth/claim-guest-server.ts`, `app/api/orders/{rate,review}`, `app/api/analyse`, `app/api/design-quote`). Read-only; nothing touched in Supabase.

Roles used below: **anon** = no JWT; **guest** = Supabase anonymous user (PostgREST role `authenticated`, `is_anonymous=true`, `ai_role()='anonymous'`); **client** = confirmed account (`ai_role()='user'`); **admin** = `profiles.role='super_admin'`; **svc** = service_role (bypasses RLS). `workshop` is dormant (every jobs table dropped in 0013; it only matters for the legacy `tenants`/`inventory_items` model).

Assumption flagged once: Supabase's default privileges grant ALL on new public tables and EXECUTE on new public functions to `anon, authenticated, service_role`. So `revoke … from public` alone does **not** remove anon/authenticated EXECUTE. The repo itself relies on this (0071:294 checks `has_function_privilege('authenticated', …)`). Confirm in prod with `select has_function_privilege('anon','public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer,text,numeric)','execute');` — **unverified for this project**. Every table has RLS on, so for tables the effective access is the policy list.

---

## A. Table matrix (final state)

Legend: S/I/U/D = select/insert/update/delete. "own" = `user_id = auth.uid()` (or `profile_id`), "own-proj" = `owns_project(project_id)`, "adm" = `is_super_admin()`. Policies are `to authenticated` unless noted, so guest = client unless a function checks `ai_role()`.

| Table | RLS | Explicit grants | S | I | U | D | Column leaks / notes |
|---|---|---|---|---|---|---|---|
| tenants (legacy) | on | auth SIUD | adm, own tenant | adm | adm, own tenant (type pinned by `tenants_guard_type` 0009:61) | adm | — |
| profiles | on | auth SIUD | adm, own, **same tenant** (0001:137-146) | adm/own | adm/own; guards: role+tenant (0009:21), email silently reverted (0042:64), price_cohort (0060:140) | adm | Tenant-mates read each other's `email, phone, price_cohort` (legacy; only if tenant_id set). |
| inquiries | on | anon+auth I; auth SUD | adm | **anon+auth `with check (true)`** (0002:34) | adm (quote cols pinned for anon/auth by 0073:97) | adm | Anon may set `status`, `is_test`, unbounded text (M3 still open). |
| inventory_items (legacy) | on | auth SIUD | adm/tenant | adm/tenant | adm/tenant | adm/tenant | — |
| parts | on | anon+auth S; auth IUD | **anon+auth: `is_published or adm`** (0011:58-61) | adm | adm | adm | **anon reads `landed_cost_qar, expected_income_qar, income_pct, below_floor, pricing_mode, pinned_offer_id, preferred_offer_id, is_test`** (0028:107-115) — no column grants. Confirmed. |
| part_orders | on | auth SUD (anon I grant, no policy since 0014) | adm, own | none (RPC only) | adm | adm | Owner reads own row incl. `customer_*`, totals. OK. |
| part_order_items | on | as above | adm, own order | none | adm | adm | OK. |
| order_status_history | on | auth SIUD | adm, own order | adm | adm | adm | OK. |
| projects | on | auth SIUD | own, adm, **class teacher** (`projects_select_class_teacher` 0096:247-249, no `to` but needs uid) | own (`user_id=auth.uid()`) | own/adm, **all columns** | own/adm | **Owner reads+writes `studio` incl. server-owned `studio.product` and `studio.productPrivate`** (DB-01). Owner writes `is_test` (DB-12), `tenant_id`, `bom`, `netlist`, `stages`. Guarded: `free_wiring_used, cad_regens_remaining, cad_tier` (0042:129), `contact_email, recovery_token, recovery_emailed_at` (0045:102). Owner and teacher can **read** `recovery_token`, `contact_email` (DB-13). |
| project_blocks / project_materials / project_items / project_claims / project_parts / project_schematics | on | auth SIUD | own-proj | own-proj | own-proj | own-proj | `project_items.qty_from_inventory`, `project_parts.unit_price` owner-writable (own data only). |
| project_schematic_revisions | on | auth SIUD | owns_schematic | same | same | same | — |
| project_files | on | auth SIUD | own-proj | own-proj | (no policy) | own-proj | `storage_path` free text → admin leads page signs it with service role (`dashboard/leads/page.tsx:104`); admin-only exposure. |
| project_kits | on | auth SID | own/adm | **own + own-proj, any items** (0025:99-101) | none | own & `order_id is null` | Self-made kit ⇒ kit discount on any cart line (DB-14). |
| cart_items | on | auth SIUD | own | own (+own-proj) | own | own | `kit_id` unchecked (re-checked at checkout). |
| client_inventory_items | on | auth SIUD | own/adm | own | own | own | — |
| store_settings | on | anon+auth S; auth IU | **anon+auth all keys except `price_experiment`** (0060:128-131) | adm | adm | adm | Leaks `margin_floor_pct`, `commission_floor_pct`, `fx_to_qar`, `rewards`, `studio_quote_rule`, `school_pricing`, `anonymous_cleanup`, `backup_search` (business-internal; Low). |
| suppliers / supplier_offers | on | auth SIUD | adm | adm | adm | adm | Supplier cost readable anyway via parts cols + `offer_landed_cost_qar` (DB-19). |
| demand_signals | on | auth SU | adm | RPC only | adm | — | Contains request emails; admin-only. |
| sourcing_gaps | on | auth S | adm | RPC | — | — | — |
| ai_usage | on | auth S | adm | RPC `log_ai_usage` (**any caller**, DB-02) | — | — | — |
| ai_usage_log (view) | security_invoker | auth S | via ai_usage RLS → adm | — | — | — | OK. |
| analysis_runs | on | auth SI | own-proj | own-proj & user_id self | — | — | Owner can pre-seed the 0099 reuse cache (self only, Info). |
| project_events | on | auth S | own-proj | via `log_project_event` (**exposed**, DB-11) | — | — | — |
| supplier_sync_runs, restock_receipts, cleanup_runs | on | auth S | adm | — | — | — | — |
| credits_ledger | on | auth S; IUD revoked (0042:233) | own/adm | SD only | SD only | — | OK. |
| ai_rate_limits | on | all revoked | — | SD | SD | SD | OK. |
| cad_generations | on | auth S only (0043:55-56) | own/adm | SD | SD | — | Owner reads `scad` (by design). |
| notification_outbox / notification_prefs | on | revoked; outbox S to auth | adm / none | SD | SD | — | `notification_prefs.token` not readable. OK. |
| store_category_rules | on | auth SIUD | adm | adm | adm | adm | — |
| reviews | on | auth SUD | adm | svc RPC | adm | adm | public via `approved_reviews` (first name only). |
| own_stock | on | auth SIUD | adm | adm | adm | adm | Depletable by anyone via orders (DB-10). |
| studio_parts | on | anon+auth S; auth IUD | anon+auth `enabled or adm` | adm | adm | adm | OK. |
| integrations | on | revoked all; svc SIUD | — | — | — | — | `refresh_token_enc` svc-only. OK. |
| edu_credit_grants | on | revoked | — | SD | — | — | OK. |
| idea_sessions, payments, idea_passes, engineering_jobs | on | auth S only | own/adm | SD/svc | SD/svc | — | `payments.proof_path/verdict` own-readable (fine). |
| school_classes | on | auth SIUD; anon revoked | teacher/adm | teacher (client role) /adm | teacher/adm | teacher/adm | **`join_code` readable by teacher only** (OK). |
| class_teams | on | auth SIUD | adm, teacher, team owner | adm only (RPC) | (none) | adm, teacher | — |
| class_team_comments | on | auth SIUD | adm, teacher, team owner | author=self & teacher/adm | none | author/adm | — |
| project_items_repair_0034 | on | all revoked | — | — | — | — | OK. |
| _m0048_map | dropped in same tx (0048:1525) | | | | | | — |

Storage → section D.

---

## B. SECURITY DEFINER functions (live ones; trigger-only functions grouped at the end)

search_path: after 0093 **no function is unpinned**. 0093 pinned the three non-SD helpers (`lead_class_days`, `part_name_key`, `part_material_key` → `pg_catalog`). Eight SD functions are pinned to a non-empty path: `offer_landed_cost_qar`, `refresh_part_sourcing`, `refresh_all_part_sourcing`, `supplier_offers_refresh_trg`, `parts_sourcing_trg`, `suppliers_refresh_trg`, `suppliers_rank_refresh` (`search_path = public`, 0028/0095/0098) and `cleanup_anonymous_users` (`public, auth, pg_temp`, 0055:109). Safe only while untrusted roles cannot CREATE in `public` (Info, DB-24).

"Exec" = effective EXECUTE (explicit grant; "+anon?" = only `revoke from public`, so anon/auth keep it through Supabase defaults, unverified).

| Function (last def) | Exec | Caller check | Acts on others' rows? | Notes |
|---|---|---|---|---|
| create_part_order/10 (0097:84) — **only live overload** (0097:277 drops /9; DO-block asserts 1) | anon, auth | none (guest checkout) | project/kit ownership re-checked; class requires teacher | Prices from `parts.unit_price` where `is_published`; shipping/fee from quote; total>0 check. **No qty/line cap**; self-made kits get kit discount (DB-14); any client can be a "teacher" → free delivery (DB-05). |
| order_delivery_quote (0054:212) | anon, auth | none | read only | `p_from` caller-chosen (display only; checkout uses default). |
| class_order_delivery_quote (0097:54) | auth | teacher of class | read | OK. |
| set_order_payment_method (0044:492) | anon, auth | **none** | any order <1h old with null method | DB-17. |
| redeem_credits (0042:533) | auth | owner, <1h | own order | QAR 20 per redeemable `spend:` row, capped at goods. Server-side maths. |
| spend_credit (0096:319) | auth | project owner; class project → **teacher pays** | teacher's ledger | Callable directly without any AI call → mints QAR 20 vouchers (DB-04); class members drain teacher (DB-06). |
| credit_can_use (0096:254) / credit_summary (0042:258) | anon, auth | self | read | OK. |
| cad_begin (0090:47) | auth | owner via credit_can_use | — | tier caller-chosen; for class projects checks **student's** balance (DB-27). |
| cad_set_code (0043:116) | auth | owner, pending | — | Owner may store any SCAD (own row). |
| cad_deliver (0090:103) | auth | owner | class: base→teacher, extra→student | **Called from the browser** (cad-card.tsx:269) → skip it = free CAD (DB-03). |
| cad_fail (0043:185) | auth | owner, pending | — | Called from browser (cad-card.tsx:263). |
| set_cad_request (0042:419) | auth | owner/adm | — | Sets informational `cad_tier` only. |
| claim_project (0045:190) | auth (+anon? returns early) | token + current owner is guest | moves project | Teacher can read token (DB-13). |
| project_recovery_begin (0045:132) | auth | owner, <1h, 3/24h | — | Email address caller-chosen (route sends mail; Low spam). |
| claim_guest_work (0071:88) | **svc only** | guest JWT verified in `claim-guest-server.ts:20-23` | moves everything | **Aborts on duplicate `idea_welcome`** (DB-08). |
| claim_price_cohort (0060:240) / my_price_quote / price_experiment_quote (anon) | auth / auth / anon+auth | self | own profile | Quote is an anon oracle for cohort codes (DB-20). |
| delete_project (0035:44) | auth | owner (`not_owner`) | own | OK. |
| notification_enqueue / order_notification_enqueue | none (internal) | — | — | OK. |
| claim_notifications / mark_notification / notification_unsubscribe / notification_prefs_token | svc | — | — | OK (unsubscribe by uuid token). |
| record_order_rating / record_order_review | svc | HMAC token in route (`orders/rate:60`, `orders/review:113`) | — | OK. |
| set_order_status (0053:198) | auth | adm | any | OK; transitions enforced. |
| join_class_team (0096:489) | auth (**guests allowed**) | valid code | creates project billed to teacher | No attempt limit; 40 teams/class; bypasses 3-project cap (DB-06). |
| create_school_class (0096:459) | auth | `ai_role in (user, admin)` | — | Any confirmed user is a teacher (DB-05). |
| new_join_code (0096:432, not SD) | none | — | — | 29^6 codes, `random()`. |
| class_teacher_of_project / is_class_project / is_class_teacher_of_project | anon, auth | none | read | Leaks teacher uuid for any project id (DB-22). |
| refresh_part_sourcing (0098:84) | auth (anon revoked) | **none** | rewrites any part's price/cost cols | DB-18. |
| refresh_all_part_sourcing (0028:243) | auth | adm or service_role | all parts | OK. |
| offer_landed_cost_qar (0028:136) | auth (+anon?) | **none** | read supplier cost | DB-19. |
| mark_restock_received / set_own_stock / restock_summary | auth | adm | — | OK. |
| edu_credit_grant (0075:12) | none (trigger only) | — | — | Regex accepts any `*.edu`, `*.edu.xx`, `*.ac.xx` (DB-28). |
| idea_token_status (0089:376) | auth (+anon? early return) | self | own | Grants 5 welcome tokens to every guest session (DB-29). |
| idea_token_charge (0089:424) | auth | owner | own | Amount caller-chosen 0–20; server charges *after* the model answered (`tokens.ts` header) — a direct call can only under-charge itself. |
| payment_create / payment_create_service / payment_attach_proof / payment_settle | svc | route checks owner + path prefix (`billing/server.ts:69-73`) | — | Auto-approve on AI receipt read (DB-26). |
| payment_apply_internal / payment_unapply_internal / idea_pass_sweep | none | — | — | OK. |
| admin_payment_review / admin_pass_expire / admin_revenue_users / admin_ai_cost_users / admin_credit_users / admin_grant / admin_reward_print / admin_engineering_job_set / ai_usage_daily / price_cohort_funnel / grant_for_order / set_review_status | auth | adm | any | OK. |
| engineering_job_submit | svc | route | — | Charges `idea_pass` first, then `idea`. |
| engineering_job_cancel (0091:161) | auth | owner, queued | — | **Refund always to `idea`** (DB-07). |
| engineering_job_return | auth | owner, path prefix check | — | OK. |
| cleanup_anonymous_users | svc | — | deletes anon users w/o data | OK. |
| log_ai_usage /13 (0031:105) and /15 (0088:194) | auth (+anon?) | **none** | inserts global usage rows | **Quota kill-switch DoS** (DB-02). Two overloads live. |
| ai_usage_totals (0031:134) | auth (+anon?) | none | read global usage | Info. |
| log_project_event (0033:46) | **auth+anon? (only `revoke from public`)** | none | inserts into any project's timeline | DB-11. |
| log_sourcing_gap / record_bom_demand | auth | own-proj | — | OK. |
| record_demand (0031:148) | anon, auth | none | inserts demand rows (emails) | Spam (Low). |
| bom_rate_check (0042:612) | anon, auth | — | counters | `p_ip_hash` caller-supplied; server hashes with salt (`credits/server.ts:65-71`) so only self-harm. |
| co_purchased / approved_reviews / approved_review_count / part_public_source / part_merged_redirect_sku / working-day fns | anon, auth | — | read | co_purchased no k-threshold (DB-21). |
| project_ai_charges / project_quote / owns_project / owns_schematic / owns_storage_project / current_user_* / is_super_admin / ai_role | auth (some anon) | self | read | OK. |

Trigger functions (not callable as RPC): `handle_new_user, sync_profile_email, fill_profile_name_from_meta, edu_credit_trigger, profiles_guard_*, tenants_guard_type, projects_guard_credit_columns, projects_insert_defaults, projects_guard_recovery_columns, projects_enforce_limit, projects_event_trigger, project_parts_event_trigger, analysis_runs_event_trigger, propagate_project_is_test, notify_projects, notify_credits_ledger, part_orders_grant_credits, part_orders_status_history, part_orders_notify_status, part_order_items_own_stock, own_stock_sync_flag, ai_usage_fill_anon_key, parts_fill_store_category, *_refresh_trg, inventory_default_tenant, inquiries_guard_quote (not SD), set_updated_at, studio_parts_touch`.

---

## C. Triggers guarding money / credits / status / roles

| Trigger | Guards | Bypass via PostgREST / RPC? |
|---|---|---|
| profiles_guard_privileges (0009:21) | role, tenant_id | No. Trusted = `auth.uid() is null` or admin; anon has no profiles policy. |
| profiles_guard_email (0042:64) | email | No (reverted silently). |
| profiles_guard_price_cohort (0060:140) | price_cohort | No; only `claim_price_cohort` sets GUC. Cohort code itself is guessable (DB-20). |
| tenants_guard_type (0009:61) | tenants.type | No. |
| projects_guard_credit_columns (0042:129) / projects_insert_defaults (0042:152) | free_wiring_used, cad_regens_remaining, cad_tier | No (GUC `app.credits_write` only set inside SD fns; PostgREST cannot set GUCs). |
| projects_guard_recovery_columns (0045:102) | contact_email, recovery_token, recovery_emailed_at | Write: no. **Read: yes** — owner/teacher can SELECT the token (DB-13). |
| projects_enforce_limit (0096:391) | 3 active projects | **Yes**: class projects are excluded; any client can create a class and join it (≤20 classes × 40 teams) (DB-05/06). |
| (none) on projects.studio | server-owned `product`, `productPrivate` | **Yes — no trigger at all** (DB-01). |
| (none) on projects.is_test | test flag that hides usage | **Yes** (DB-12). |
| inquiries_guard_quote (0073:97) | quote columns | No for quote cols; but `status`, `is_test`, sizes unguarded (DB-16). |
| part_orders_status_history / part_orders_notify_status / part_orders_grant_credits (0042:480) | history, emails, purchase credits on `delivered` | Only admin can update part_orders (`part_orders_admin_all`); set_order_status enforces forward transitions. Purchase grant: 3 wiring + 1 cad + 2 idea per delivered order **regardless of order value** (0090:156-181) → feeds DB-04. |
| part_order_items_own_stock (0069:141) | own_stock decrement on every line insert | **Abusable**: anon orders (any qty) zero stock; never restored on cancel (DB-10). |
| credits_ledger_notify (0053:483) | emails | No writes possible by clients. |
| unique idx credits_ledger_purchase_once / credits_ledger_idea_welcome_once (0042:227, 0088:31) | one grant per order / one welcome | The welcome index breaks `claim_guest_work` (DB-08). |
| payments: no triggers; status machine in `payment_settle`/`admin_payment_review` | — | Clients have no write grants (0089:74). |

---

## D. Storage

| Bucket | Public | Size / MIME | Insert | Select (=list + download) | Delete | Notes |
|---|---|---|---|---|---|---|
| cad-files | private | 50 MB (0005:17) / **any MIME** | auth, `foldername[1] = uid` (0018:71) | own folder[1], adm, **or owner of folder[2] project** (0045:293) | same | No update policy (no overwrite). |
| quote-uploads | private | 50 MB / **any MIME** | **anon + auth, any path** (0012:23-25) | adm | adm | Unbounded anonymous storage (DB-15). |
| project-images | private | 20 MB (0062:20) / any MIME | auth own folder[1] | own folder[1] / project folder[2] / adm | same | Also server PREVIEW bucket (svc). |
| product-images | **public** | **no limit / any MIME** | adm | **anon+auth list** (0029:46-48) | adm | Listing exposes unpublished product images (Low, DB-25). |
| videos | public | 50 MB; mp4/webm/jpeg/vtt | adm | anon list | adm | OK. |
| studio-models | public | 20 MB; stl/octet-stream/sla | adm | anon list | adm | OK. |
| payment-proofs | private | 8 MB; png/jpeg | auth own folder | own / adm | none | OK. |
| engineering-files | private | 100 MB / any MIME | auth own folder (0091:64) | own / adm | adm | OK. |

---

## E. Money & credits — can the browser change what it pays?

- Prices: **recomputed server-side** in `create_part_order/10` from `parts.unit_price` (published only); `part_order_items.unit_price_qar` snapshot; no client price accepted. Shipping/fee from `order_delivery_quote`; tier/payment method whitelisted; split only when `can_split`. Total>0 enforced (0097:260).
- Quantity: `greatest(1, qty)`; negative → 1; huge → numeric overflow error. **No upper bound / line cap** → stock depletion + order spam (DB-10).
- Project ids: ownership re-checked (0097:196-203). Class id: must be caller's class (0097:142-144) — but any client can own a class (DB-05).
- Kit discount: kit must be caller's unordered kit, but caller can create kits freely and attach to any line (DB-14). Seed `kit_discount_pct = 0`; admin-editable (`dashboard/store/attributes/actions.ts:101`) → live value unverified.
- Free delivery: threshold on goods−kit discount (0097:253); class economy free (0097:257). Credit redemption runs afterwards, so goods can fall below the threshold while shipping stays 0 (DB-30, Low).
- Credits → cash: each `spend:` ledger row = QAR 20 off a parts order for 30 days (`redeem_credits`). `spend_credit` is directly callable, so any free credit (purchase reward, edu grant, admin/print reward, class pack) becomes a voucher without consuming AI (DB-04).
- Payments (tokens/pass/service): amount fixed by server (`payment_create` svc). Approval can be **automatic from an AI read of a screenshot**; duplicate check is exact image hash or extracted transfer ref (DB-26).
- Token maths: server-side, but `engineering_job_cancel` refunds pass tokens as permanent tokens (DB-07).
- CAD: browser receives SCAD before paying and decides whether to call `cad_deliver` (DB-03). Studio product model: readable/unlockable via PostgREST (DB-01).

---

## F. Findings

Severity is for this codebase's threat model (public store + paid AI). "Test" = PGlite file proposed, following `lib/schools/db/schools-migration.test.ts`. That stub needs `alter default privileges in schema public grant execute on functions to anon, authenticated;` added to mimic Supabase.

### DB-01 — High — Owners can read the private Studio product model and forge the paid "unlock" (projects.studio)
- Evidence: `0068_design_studio.sql:23-25` (`add column if not exists studio jsonb`); `0015_projects.sql:147-151` (`projects_update … using (user_id = auth.uid() …)`), no guard trigger on `studio`. App trusts it: `app/api/studio/product/model/route.ts:30` `const unlocked = cur.owned.product.unlockedId === q.data.designId;`. `lib/studio/server/doc.ts:66-68` reads `productPrivate:studio->productPrivate` with the **user** client. `lib/studio/product/private.ts:1-11` says the key is "server-only… a page save can neither erase nor forge it". That holds only for app saves, not for direct PostgREST.
- Exploit: (a) `GET /rest/v1/projects?id=eq.<own>&select=studio->productPrivate` returns `designs[].model` / `best.model` before "Create my CAD". (b) `PATCH /rest/v1/projects?id=eq.<own>` with `studio.product.unlockedId=<designId>`, then `GET /api/studio/product/model` returns the model and the worker builds STLs. No CAD credit is charged. Class teachers can do (a) on students' projects (`0096:247-249`).
- Fix (0100_studio_server_owned.sql): move server-owned keys out of `projects`:
  ```sql
  create table if not exists public.project_studio_private (
    project_id uuid primary key references public.projects(id) on delete cascade,
    product jsonb, product_private jsonb, updated_at timestamptz not null default now());
  alter table public.project_studio_private enable row level security;
  revoke all on public.project_studio_private from public, anon, authenticated;
  grant all on public.project_studio_private to service_role;
  insert into public.project_studio_private (project_id, product, product_private)
    select id, studio->'product', studio->'productPrivate' from public.projects
    where studio ? 'product' or studio ? 'productPrivate' on conflict do nothing;
  create or replace function public.projects_strip_studio_server_keys() returns trigger
  language plpgsql set search_path = '' as $$
  begin
    if current_user in ('anon','authenticated') and new.studio is not null then
      new.studio := (new.studio - 'product') - 'productPrivate';
    end if; return new; end $$;
  drop trigger if exists projects_strip_studio_server_keys on public.projects;
  create trigger projects_strip_studio_server_keys before insert or update of studio on public.projects
    for each row execute function public.projects_strip_studio_server_keys();
  -- rollback: drop trigger/function; copy columns back into studio; drop table.
  ```
  App: `loadDocPrivate` / `updateProductDoc` / model route switch to the service client for the new table (ownership still checked with the user client). Behaviour is unchanged for legitimate users.
- Test: `lib/studio/db/studio-private.test.ts`. As an authenticated owner, PATCH `studio` with `product.unlockedId` → stored value has no `product` key; SELECT `studio->'productPrivate'` → null; service_role can read `project_studio_private`.

### DB-02 — High — Anyone can trip the global AI quota (log_ai_usage is client-callable, unbounded)
- Evidence: `0088_ideation_tokens.sql:194-219` inserts `p_total_tokens`, `p_outcome`, `p_provider` verbatim, with `grant … to authenticated` and only `revoke … from public`. The 13-arg overload (`0031:105-132`) is also live. `ai_usage_totals` (`0031:134-142`) sums every non-test row per provider. `lib/ai/usage.ts:86-112`: `paused: share >= guardThreshold()`.
- Exploit: a guest (one anonymous sign-in, or anon if default privileges apply) runs `rpc('log_ai_usage', {p_provider:'<provider>', p_feature:'analyse', p_total_tokens:2000000000, p_outcome:'ok', …})`. Every AI feature reports `paused` for all users until the provider's day resets. The same call also pollutes the admin cost dashboards (`p_cost_usd` up to 100 per row).
- Fix (0101_ai_usage_lockdown.sql): short term, keep the signature but require a uid, clamp values and rate-limit per user. Long term, revoke from anon/authenticated and log through service_role with an explicit `p_user`.
  ```sql
  revoke all on function public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer) from public, anon, authenticated;
  revoke all on function public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer,text,numeric) from anon;
  -- in the 15-arg body: if auth.uid() is null then return; end if;
  --   p_total_tokens := least(greatest(coalesce(p_total_tokens,0),0), 1000000);  (same for prompt/completion/audio)
  --   if (select count(*) from public.ai_usage where user_id = auth.uid() and created_at > now() - interval '1 minute') > 30 then return; end if;
  -- and in ai_usage_totals: cap each user's contribution (sum of least(per-user total, X)), or count only rows written by service_role (add column logged_by_server boolean default (current_user = 'service_role')).
  ```
- Test: `lib/ai/db/ai-usage-quota.test.ts`. As anon, EXECUTE is denied. As authenticated, a 2e9-token insert is clamped and `ai_usage_totals` stays under the limit.

### DB-03 — Medium — Browser CAD path: the generated SCAD is returned before payment; skipping `cad_deliver` makes it free
- Evidence: `app/api/cad/route.ts:185-193` returns `scad` once `cad_set_code` succeeds. The charge happens only when the browser calls `cad_deliver` (`components/credits/cad-card.tsx:269`), and the browser may call `cad_fail` instead (`cad-card.tsx:263`; RPC `0043:185-199`, granted to authenticated).
- Exploit: a client with ≥1 CAD credit (needed to pass `cad_begin`) calls `/api/cad`, keeps `scad`, never delivers. The only limit is `too_many_failed` (`0090:86-90`, 5 undelivered per 24 h). That is 5 free LLM CAD generations per day per account, and the balance never drops.
- Fix (0102_cad_settle.sql): charge at code-store time, and refund only on a server-verified failure; or (smaller change) block new generations while one is outstanding and auto-settle stale ones:
  ```sql
  -- cad_begin: raise 'pending_delivery' if exists pending row with scad not null for this user created > 2 min ago
  create or replace function public.cad_settle_stale() returns integer language plpgsql security definer set search_path = '' as $$
  declare r record; n int := 0; begin
    for r in select id, user_id from public.cad_generations where status='pending' and scad is not null and created_at < now() - interval '30 minutes' loop
      perform set_config('request.jwt.claim.sub', r.user_id::text, true); perform public.cad_deliver(r.id); n := n + 1; end loop;
    return n; end $$;
  revoke all on function public.cad_settle_stale() from public, anon, authenticated; grant execute on function public.cad_settle_stale() to service_role;
  -- cad_fail from a JWT caller: only allowed while scad is null (server-side model failure); render failures go through a svc route.
  ```
- Test: `lib/cad/db/cad-settle.test.ts`. Begin → set_code → cad_fail as the owner is rejected once scad is set; `cad_settle_stale` charges 1 credit.

### DB-04 — Medium (needs owner decision) — `spend_credit` mints QAR 20 store vouchers without any AI use
- Evidence: `0096:319-385` is granted to authenticated and inserts `'spend:'…, redeemable_until`. `redeem_credits` (`0042:533-590`) turns each such row into QAR 20 off. Free credit sources: purchase reward of 3+1 credits per delivered order of any value (`0090:169-172`), edu 2+1 (`0075:29-31`), print reward, admin grants.
- Exploit: after any delivered order, call `rpc('spend_credit',{p_step:'wiring',p_project})` ×3 and `('cad')` ×1, giving QAR 80 off the next order within 30 days. That order's delivery grants 4 more. The result is a perpetual ~QAR 80-per-order discount, plus QAR 60 per edu address.
- Fix (0103_voucher_on_real_spend.sql): revoke `spend_credit` from authenticated; add `spend_credit_for(p_user uuid, p_step text, p_project uuid)` granted to service_role and called only by the AI routes after a provider call. Alternatively set `redeemable_until` only when a server GUC (`app.ai_spend='on'`, set inside `cad_deliver` and a new svc RPC) is on. Also consider a minimum goods value for `grant_credits_for_order_internal`.
- Test: `lib/credits/db/voucher.test.ts`. An authenticated direct `spend_credit` is denied (or creates no redeemable row), and `redeem_credits` then applies 0.

### DB-05 — Medium — Any confirmed user can become a "teacher" and get free delivery on every order, plus unlimited active projects
- Evidence: `create_school_class` only requires `ai_role() in ('user','admin')` (`0096:470`). `create_part_order` makes economy shipping free when `v_class` is the caller's class (`0097:142-144`, `257-259`), whatever the order contents. `projects_enforce_limit` skips class projects (`0096:409-417`).
- Exploit: create a class, then pass `p_class_id` at checkout with the economy tier: shipping 0 (QAR 50 saved per order). Join your own class repeatedly for up to 20×40 projects past the 3-project plan cap.
- Fix (0104_class_verification.sql): `alter table school_classes add column verified_at timestamptz;` (admin sets it). Free class delivery and the project-cap exemption apply only when `verified_at is not null` and the class has ≥2 teams; alternatively limit free delivery to lines whose `project_id` is a team project of that class.
- Test: `lib/schools/db/class-order.test.ts`. An unverified class order is charged shipping; a verified one is free.

### DB-06 — Medium — A class join code lets anyone (including guests) drain the teacher's credits
- Evidence: `join_class_team` accepts any uid, guests included (`0096:501`), and creates a project the caller owns. `spend_credit` bills the teacher whenever the project is a class project (`0096:336-342`), with only a project-owner check (`0096:350-354`). No per-team cap, no attempt limit on codes.
- Exploit: whoever gets the 6-character code (shared with the whole class) joins and calls `spend_credit('wiring', <team project>)` in a loop, emptying a paid class pack (15 credits / QAR 199) with no AI use.
- Fix (0105_class_team_caps.sql): `class_teams.credit_cap int default 3, credits_used int default 0`; `spend_credit` increments it and raises `team_cap` past the cap; add teacher approval (`approved_at`) before spending; throttle `join_class_team` per uid (≤5 joins/hour). Combine with DB-04 (no direct spend).
- Test: extend `lib/schools/db/schools-migration.test.ts`: a fourth spend on a team raises `team_cap`; an unapproved team cannot spend.

### DB-07 — Medium — Engineering job cancel converts expiring Maker Pass tokens into permanent tokens
- Evidence: submit charges `idea_pass` first (`0091:127-131`); the refund always credits `'idea'` (`0091:153-155` `values (j.user_id, 'idea', j.tokens, 'job_refund:'…)`); the user can cancel while queued (`0091:161-172`).
- Exploit: before the pass ends, submit a job paid with pass tokens, then cancel. The tokens come back as non-expiring bought tokens. Repeat every month.
- Fix (0106_job_refund_kinds.sql): refund per kind from the ledger: `insert … select user_id, kind, -delta, 'job_refund:'||id … from credits_ledger where reason = 'job:'||p_job and delta < 0;` (`idea_pass_sweep` then expires them normally).
- Test: `lib/engineering/db/job-refund.test.ts`. A pass-paid job that is cancelled returns `idea_pass`, not `idea`.

### DB-08 — Medium (functional) — `claim_guest_work` aborts when both the guest and the account have welcome tokens
- Evidence: unique index `credits_ledger_idea_welcome_once on (user_id) where kind='idea' and reason='idea_welcome'` (`0088:31-33`). `claim_guest_work` moves every ledger row except duplicate `purchase:%` (`0071:209-218`) and was never updated after 0088. `idea_token_status` grants the welcome row to every session, guests included (`0089:396-398`).
- Failure: a guest who opened the Studio signs in to an account that also has the welcome row. The update violates the unique index, the whole claim rolls back, and the guest's projects, cart and orders stay on the orphaned guest.
- Fix (0107_claim_guest_welcome.sql): before the ledger move, `delete from public.credits_ledger g where g.user_id = p_from and g.kind='idea' and g.reason='idea_welcome' and exists (select 1 from public.credits_ledger t where t.user_id=p_to and t.kind='idea' and t.reason='idea_welcome');` (or extend the `not (...)` clause).
- Test: `lib/auth/db/claim-guest-work.test.ts`. Both users hold a welcome row, the claim returns ok, and the account keeps exactly one.

### DB-09 — Medium — Supplier cost and margin readable by anyone (parts columns, store_settings)
- Evidence: `0011:55` `grant select on public.parts to anon, authenticated`; `0011:58-61` row filter only; cost columns `0028:111-115`. `store_settings_select` exposes `margin_floor_pct`, `commission_floor_pct`, `fx_to_qar` (`0060:128-131`).
- Exploit: `GET /rest/v1/parts?select=sku,unit_price,landed_cost_qar,expected_income_qar,income_pct` with the anon key returns the whole catalogue's margins.
- Fix (0108_parts_cost_private.sql): move `landed_cost_qar, expected_income_qar, income_pct, below_floor, pinned_offer_id, preferred_offer_id, pricing_mode` into `public.part_economics (part_id pk)`, which is admin-only RLS. `refresh_part_sourcing` writes there. Admin pages read it with a join. Column grants alone would also hide the columns from admins, who use the same `authenticated` role. Restrict `store_settings_select` to an allowlist of public keys.
- Test: `lib/store/db/parts-columns.test.ts`. Anon selecting `landed_cost_qar` errors (column does not exist / permission denied); admin reads `part_economics`.

### DB-10 — Medium — Anonymous orders can zero `own_stock` and spam orders (no qty/line/rate limits)
- Evidence: `part_order_items_own_stock` decrements on every inserted line (`0069:141-161`) and is never restored on cancel. `create_part_order` is granted to anon (`0097:274`), status defaults to `confirmed`, and qty has no upper bound (`0097:190`).
- Exploit: an anon RPC with `quantity: 99999` for each own-stock SKU sets stock to 0 and flips `in_own_stock` (the storefront shows longer lead times). Each call is also an admin-visible fake order.
- Fix (0109_order_limits.sql): cap `v_qty <= 1000` and `jsonb_array_length(p_items) <= 100`; limit orders per `customer_phone` (e.g. 5 per hour); move the stock decrement to a status trigger (`paid`/`sourcing`) and add a restore on `cancelled`.
- Test: `lib/store/db/order-limits.test.ts`. qty 99999 raises; a cancel restores own_stock.

### DB-11 — Low/Medium — `log_project_event` callable by anyone: fake events in any project timeline
- Evidence: `0033:46-53` is SECURITY DEFINER with only `revoke all … from public` (0033:53). No ownership check; it inserts arbitrary `type`/`detail` for any existing project id.
- Fix (0110_revoke_internal_helpers.sql): `revoke all on function public.log_project_event(uuid,text,jsonb) from anon, authenticated;` Internal callers are SD, so they keep working. Do the same for `offer_landed_cost_qar` (DB-19), `ai_usage_totals` (anon), and `class_teacher_of_project`/`is_class_project` for anon (DB-22).
- Test: `lib/security/db/function-grants.test.ts` asserts `has_function_privilege` false for anon/authenticated on every "internal" SD function. Generate the list from `pg_proc where prosecdef`.

### DB-12 — Low/Medium — Owners can set `projects.is_test`, hiding their AI usage from quotas, charges and cost reports
- Evidence: `projects_update` lets owners write every column (0015:147-151); `propagate_project_is_test` copies the flag onto `ai_usage` (0031:66-82); `ai_usage_totals`, `ai_usage_daily` and `project_ai_charges` all exclude `is_test` (0031:141, 0042:736, 0038:39).
- Fix (in 0110): a BEFORE UPDATE trigger on projects: `if current_user in ('anon','authenticated') and not public.is_super_admin() then new.is_test := old.is_test; end if;` (same for `tenant_id`).
- Test: an owner's PATCH `is_test=true` leaves the value unchanged.

### DB-13 — Low — Teachers (and owners) can read `recovery_token`; a teacher can take over a guest student's project
- Evidence: `projects_select_class_teacher` (0096:247-249) exposes all columns. `claim_project` hands the project to any caller holding the token when the current owner is a guest (0045:209-233).
- Fix: in `claim_project`, refuse when `public.is_class_project(p_project)`; hide `recovery_token` from SELECT (move it to a private table, or expose teacher reads through an SD RPC that returns safe columns).
- Test: a teacher calling claim_project on a team project returns `invalid`.

### DB-14 — Medium (conditional on kit_discount_pct > 0) — Kit discount on arbitrary lines through a self-made kit
- Evidence: `project_kits_insert … with check (user_id = auth.uid() and public.owns_project(project_id))` (0025:99-101); checkout only checks that the kit is the caller's and unordered (0097:205-208, 250). `kit_discount_pct` is admin-editable (`dashboard/store/attributes/actions.ts:101`).
- Fix (0111_kits_server_only.sql): `revoke insert on public.project_kits from authenticated;` add an SD `create_project_kit(p_project)` that snapshots BOM-matched part ids into `project_kits.part_ids uuid[]`. In checkout, count a line toward `v_kit_sum` only if `v_part.id = any(kit.part_ids)`.
- Test: a kit with part A applied to a part B line gives no discount.

### DB-15 — Low/Medium — `quote-uploads`: anonymous 50 MB uploads, any path, any MIME
- Evidence: `0012:17-25` `with check (bucket_id = 'quote-uploads')`, no `allowed_mime_types`.
- Fix (0112_quote_upload_limits.sql): `update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['model/stl','application/octet-stream','application/step','application/dxf','application/pdf','image/png','image/jpeg'] where id='quote-uploads';` and the policy `and name ~ '^[0-9a-f-]{36}/[^/]{1,200}$'`.
- Test: an insert with path `a/b/c.html` is rejected by the policy (storage schema stub).

### DB-16 — Low — `inquiries` anon insert unbounded; anon can set `status`/`is_test` (SECURITY_REVIEW M3 still open)
- Evidence: `0002:29-36`; no length checks were ever added (only quote columns in 0073:79-89).
- Fix (in 0112): `check (char_length(name)<=120 and char_length(phone)<=40 and char_length(coalesce(email,''))<=160 and char_length(message)<=8000)` `not valid` then validate; extend `inquiries_guard_quote` so INSERT forces `status='new'`, `is_test=false` for anon/authenticated.
- Test: an anon insert with a 1 MB message fails; an inserted status='closed' is stored as 'new'.

### DB-17 — Low — `set_order_payment_method` has no ownership check
- Evidence: `0044:509-513` `where id = p_order and payment_method is null and created_at > now() - interval '1 hour'`, granted to anon (0044:519).
- Fix: add `and (profile_id is not distinct from auth.uid())`.
- Test: another user's call returns false.

### DB-18 — Low — `refresh_part_sourcing` callable by every authenticated user
- Evidence: `0098:186-187` grants it to authenticated, and the body has no caller check. It rewrites `parts` price/cost columns and bumps `updated_at` (write amplification; ISR/sitemap churn). Results are deterministic, so no price manipulation.
- Fix: `if not public.is_super_admin() and coalesce(auth.role(),'') <> 'service_role' and pg_trigger_depth() = 0 then raise exception 'not allowed'; end if;` (the triggers call it at depth > 0).
- Test: a client call raises; the trigger path still recomputes.

### DB-19 — Low — `offer_landed_cost_qar` returns supplier landed cost to any caller
- Evidence: `0028:136-153`, `grant execute … to authenticated` (0028:267), never revoked from anon.
- Fix: admin check, or revoke (it is used only by the admin edit page and internal SQL).

### DB-20 — Low — `price_experiment_quote` is an anon oracle for cohort codes
- Evidence: `0060:173-237` granted to anon; codes `^[A-Z0-9-]{3,32}$`.
- Fix: require `auth.uid()` plus per-user attempt throttling, or require codes of ≥10 random characters.

### DB-21 — Low — `co_purchased` has no minimum-count threshold (reveals individual baskets)
- Evidence: `0057:84-94`. Fix: `having count(distinct x.order_id) >= 3`.

### DB-22 — Low — `class_teacher_of_project`, `is_class_project`, `is_class_teacher_of_project` granted to anon
- Evidence: `0096:102-116, 244-245`. These leak the teacher's user id and class membership for any project id. Fix: revoke from anon.

### DB-23 — Info — The "auth.uid() is null ⇒ trusted" pattern
- In `profiles_guard_privileges`, `profiles_guard_email`, `profiles_guard_price_cohort`, `projects_guard_credit_columns`, `projects_insert_defaults`, `projects_guard_recovery_columns`. Safe today only because anon has no write policy on `profiles`/`projects`. Prefer `current_user not in ('anon','authenticated')` as 0073:103 does.

### DB-24 — Info — 8 SD functions pinned to `public` / `public, auth, pg_temp`, not `''`
- Listed in section B. Re-pin with fully qualified names when next touched.

### DB-25 — Low — Public buckets are listable by anon; `product-images` has no size/MIME limit
- Evidence: `0029:42-48`, `0049:33-34`, `0070:111-113`. Public URLs do not need a SELECT policy. Dropping the anon SELECT policies stops listing, but check first that no client code lists them (unverified). Set limits on product-images.

### DB-26 — Medium (design) — Token/pass/service payments auto-approve on an AI read of a screenshot
- Evidence: `lib/billing/server.ts:86-119` → `payment_settle(…, p_auto=true)`. The duplicate guard is an exact `proof_hash` or `transfer_ref` match (`0089:264-273`). Re-encoding the image or editing the screenshot defeats the hash.
- Fix (0113_payment_autoapprove_caps.sql): auto-approve only if `amount_qar <= X` and the user has a prior manually approved payment. Add `create unique index payments_transfer_ref_once on public.payments (lower(transfer_ref)) where status in ('approved','verifying','needs_review');` Otherwise route to `needs_review`.
- Test: a second payment with the same transfer_ref goes to needs_review; a first-time payment over X goes to needs_review.

### DB-27 — Low (bug) — Class CAD billing is inconsistent
- `cad_begin` checks the **student's** cad balance when cost='credit' (`0090:79-82`), while `spend_credit` bills the teacher. Students with 0 credits therefore cannot start CAD on class projects. `cad_deliver` charges the complexity extra to the student (`0090:131-136`). Fix: use the payer (`coalesce(class_teacher_of_project(p_project), v_uid)`) in both.

### DB-28 — Low — The edu-grant regex accepts any `*.edu`, `*.edu.xx`, `*.ac.xx` and strips only `+tags`
- Evidence: `0074:28-38`. Combined with DB-04, this gives QAR 60 of vouchers per alias. Fix: an allowlist of domains in store_settings, or admin review.

### DB-29 — Low (owner decision) — Every guest session gets 5 welcome ideation tokens
- Evidence: `0089:396-398` (no `ai_role` check). This is partly mitigated by the IP guest limit in `lib/studio/server/product.ts:157` (coverage unverified).

### DB-30 — Low — Free shipping is decided before credit redemption
- `create_part_order` applies the threshold (0097:253); `redeem_credits` later lowers the goods value without recomputing shipping (0042:563-587). Fix: in `redeem_credits`, if the new goods value is below the threshold and the order had free shipping, cap `v_applied` so goods stay ≥ threshold.

### DB-31 — Info — The owner can pre-seed the `/api/analyse` reuse cache
- `analysis_runs_insert` (0024:56-58) plus the lookup in `app/api/analyse/route.ts:91-101` (project-scoped, user client). Self-only effect.

---

## G. Re-check of SECURITY_REVIEW.md database items

| Item | Status | Evidence |
|---|---|---|
| C1 self-promotion to super_admin | **Fixed, still in place** | `0009:21-51` trigger `profiles_guard_privileges` never dropped (only 0013's comment mentions it); `profiles_update` unchanged since 0001:158-168. Later guards add email (0042:64) and price_cohort (0060:140). Residual: Info DB-23. |
| H2 clients write workshop BOM | **N/A — object removed** | `job_bom` dropped `0013:57`; `can_manage_job_bom` dropped `0013:69`. |
| H3 job edit window | **N/A — object removed** | `jobs` dropped `0013:60`; `jobs_status_transition` dropped `0013:73`. |
| H5 tenant re-type to workshop | **Fixed, still in place** | `tenants_guard_type` `0009:61-81`; no later change. The tenant model is dormant. |
| M1 forged variation trail | **N/A — object removed** | `job_variations` dropped `0013:56`. |
| M3 unbounded public inquiries insert | **Still open** | `0002:29-36` `with check (true)` for anon; no length constraints added. 0073 guards only quote columns. Anon can also set `status`/`is_test`. See DB-16. |

---

## Summary — worst issues

1. **DB-01 (High)**: owners read `projects.studio.productPrivate` and forge `studio.product.unlockedId` via PostgREST. The paid Studio "Create my CAD" model is free, and teachers can read students' models.
2. **DB-02 (High)**: `log_ai_usage` is client-callable with unbounded token counts. One RPC from any guest pauses every AI feature for all users (`ai_usage_totals` → `paused`).
3. **DB-03 (Medium)**: the browser CAD path returns SCAD before payment; skipping `cad_deliver` gives 5 free CAD generations a day per account.
4. **DB-04 (Medium, owner decision)**: direct `spend_credit` turns any free credit (4 per delivered order, 3 per edu email) into QAR 20 store vouchers without using AI.
5. **DB-05/06 (Medium)**: any confirmed user can make a class, getting free economy delivery on every order and past the 3-project cap. A shared join code lets guests drain a teacher's paid credits.
6. **DB-07 (Medium)**: cancelling an engineering job refunds Maker Pass tokens as permanent tokens.
7. **DB-08 (Medium, bug)**: `claim_guest_work` aborts on duplicate `idea_welcome` rows, so guest work is not moved after sign-in.
8. **DB-09 (Medium)**: anon reads every part's landed cost, margin and income_pct; store_settings exposes the margin floors and FX rates.
9. **DB-10 (Medium)**: anon orders with unbounded quantity zero `own_stock` (never restored) and spam the order queue.
10. **DB-26 (Medium)**: payments auto-approve from an AI-read screenshot with only exact-hash dedupe. M3 (inquiries) is still open; C1 and H5 hold; H2/H3/M1 are moot (tables dropped).
