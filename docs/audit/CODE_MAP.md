# CODE_MAP — Gestaltung (audit/code-and-security-2026-10, base origin/main 88a6473)

Built 2026-10-22 by reading code (find/grep over `app`, `lib`, `components`, `supabase/migrations`, `vercel.json`). Read-only; no network, no DB. Paths are repo-relative. "CLAUDE.md" claims are marked as such where code was not enough to confirm. Counts below are measured, and where they differ from the brief the measured number is given.

Measured: 104 `page.tsx` (103 under `app/[locale]`, plus `app/page.tsx`; the brief said 100) · 62 `route.ts` under `app/api` + 1 more route handler outside it (`app/[locale]/dashboard/engineering-jobs/[id]/snapshot/route.ts`) · 26 `"use server"` files · 86 migration files (0001–0099, gaps 0063, 0065, 0077–0087) · 232 vitest files · 35 Playwright specs.

---

## 1. Overview

1. **Stack**: Next.js 15 App Router (webpack build, `next.config.mjs`), React 19, TypeScript strict, Tailwind 3, next-intl 4 (`en` default, `ar` RTL), Supabase (Postgres + Auth + Storage via `@supabase/ssr`), zod 4, three.js / R3F + manifold-3d (Studio geometry), vitest 4, Playwright, Vercel (crons in `vercel.json`), optional Cloud Run CAD worker (`services/cad-worker`, Python/CadQuery).
2. **Folders**: `app/[locale]/**` pages + server actions · `app/api/**` route handlers · `lib/**` logic (pure helpers first, server-only files marked in their header) · `components/**` UI · `messages/{en,ar}.json` · `i18n/{routing,request,navigation}.ts` · `supabase/migrations/*.sql` (hand-run in the SQL editor; no migration runner in repo) · `content/{legal,case-studies}` · `e2e/` · `scripts/` · `docs/` · `services/cad-worker/`.
3. **Request flow**: `middleware.ts` → (a) next-intl routing (`handleI18nRouting` for locale-prefixed paths with `localeCookie:false`, `handleRootRouting` otherwise) → (b) `applySiteV2()` for paths `siteV2Affects()` says the flag can change (anon PostgREST `fetch` of `store_settings.site_v2`, 1.5 s timeout, 60 s per-instance cache, fail closed; may rewrite to `/:locale/v2…`, 308 back, or 404) → (c) `updateSession()` (`lib/supabase/middleware.ts`) which touches Supabase only when an `sb-…-auth-token` cookie exists. Matcher skips `api`, `_next`, `_vercel`, `icon`, `apple-icon` and any path containing a dot.
4. Then `app/layout.tsx` → `app/[locale]/layout.tsx` (fonts, `NextIntlClientProvider` with `BASE_MESSAGES` only, `ContactPhoneProvider` via cookie-free `getContactPhone()`, `AuthProvider`, `CartProvider`, header/footer gates, `CookieNotice`, `GuestClaimNotice`) → page. Pages call `setRequestLocale(locale)` and wrap client UI in `<MessagesScope scope="…">`.
5. **Supabase clients**: browser `lib/supabase/client.ts` (anon key; lazily via `lib/supabase/lazy.ts`; guests via `ensureSession()` in `lib/supabase/guest.ts` = `signInAnonymously`) · server `lib/supabase/server.ts` (cookie-bound, anon key + RLS; used by dashboards, server actions, most API routes) · cookie-free anon `lib/supabase/public.ts` (storefront reads, sitemap) · service role `lib/supabase/service.ts` `createServiceClient()` (bypasses RLS, returns null without key; 28 non-test files use it, listed in §6).
6. **Roles**: `profiles.role` = `super_admin | workshop | client` (migration 0001/0009); guests are Supabase anonymous users (`user.is_anonymous`); `ai_role()` (0042, `ai_role_of` 0096) maps to `admin | user | anonymous`. Dashboard auth gate: `app/[locale]/dashboard/layout.tsx` (+ `store/layout.tsx` and ~9 sub-layouts require `super_admin`).
7. **Caching rules**: public storefront (home `/`, `/store`, `/store/[sku]`, `/store/collections/[id]`, `/v2/*`, marketing/legal) is static/ISR: no `cookies()`/`headers()`/`force-dynamic`/`searchParams` there. `export const revalidate = 86400` (= `STOREFRONT_REVALIDATE`, `lib/cache/storefront.ts`; CLAUDE.md history said 300 s, code says 24 h). Catalogue reads go through `unstable_cache` in `lib/store/public-catalog.ts` with tags `parts`, `store-settings`, `part-<sku>`, `contact-phone`. Any write to `parts`/`supplier_offers`/`suppliers`/`store_settings` must call `revalidateStorefront()` (or the narrow `revalidatePart()`/`revalidateContactPhone()`); `docs/ISR_WRITES.md` explains why. `/store?q|category|material|stock|sort|page` is rewritten by `next.config.mjs` (beforeFiles) to the dynamic `/store/search`.
8. **Private pages** (`/projects*`, `/orders*`, `/dashboard*`, `/inventory`, `/my-inventory`, `/tokens`, `/store/checkout`, auth pages) are `dynamic = "force-dynamic"` and read the cookie client.
9. **i18n scopes**: root layout sends only `BASE_MESSAGES` (`lib/i18n/scopes.ts`); each page wraps `<MessagesScope scope="home|store|product|checkout|orders|projects|project|studio|engineering|pricing|auth|contact|join|designQuote|tokens|all">` (`MESSAGE_SCOPES` map, `pickMessages` in `lib/i18n/pick-messages.ts`). Dashboard / inventory / my-inventory / prototyping use `"all"`. A new client component namespace must be added to the scope of every route that renders it (`lib/i18n/scopes.test.ts`). Parity: `node scripts/check-i18n-parity.mjs` (5330 / 5330 keys per BASELINE.md).
10. **Email**: everything through `lib/email.ts` (`sendEmail`/`sendEmailResult`, Resend REST `https://api.resend.com/emails`) with the shared shell `lib/email/brand-layout.ts`; transactional status mails via the `notification_outbox` (0046) drained by `/api/cron/notifications`.
11. **Money**: currency QAR. Payments are manual: cash on delivery, Fawran (alias), bank transfer (`part_orders.payment_method`, 0039/0044); tokens/pass/services paid by Fawran proof (`payments`, 0089/0092). No card gateway in code.
12. **AI**: Gemini (default `gemini-3.5-flash-lite`, fallback `gemini-3.5-flash`) via `lib/prototyping/providers/gemini-client.ts` + `lib/prototyping/ai-call.ts`; Groq Whisper for voice (`/api/transcribe`); cloud CAD worker on Cloud Run (WIF auth in `lib/cad/cloud.ts`). Metering: `lib/ai/{limits,usage,prices}.ts`, RPC `log_ai_usage`/`ai_usage_totals`; gating: `lib/credits/server.ts` (`canUse`, `spend`, `bomRate`) and `lib/studio/server/tokens.ts`.
13. **Crons** (`vercel.json`, UTC): delivery-promises 04:00 · voltaat-sync 03:00 · supplier-refresh 02:00 · notifications 04:30 · anonymous-cleanup Sun 05:00 · youtube-retire 07:00. All `GET`, `Authorization: Bearer $CRON_SECRET`.
14. **Redirects/rewrites** in `next.config.mjs` (legacy `/parts*`, `/design/upload|jobs`, `/dashboard/jobs`, `/credits`, `/dashboard/inventory`, `/dashboard/parts`, `/cad-assistance`) and `vercel.json` (www → apex). `next.config.mjs` has no `headers()` (no CSP/security headers configured in the repo).
15. **Tests/ops**: unit `npm test` (vitest), e2e `npm run test:e2e` (Playwright, server started with `E2E_FIXTURES=1`, read-only write guard in `e2e/fixtures.ts`), `scripts/` (i18n parity, legal split, OG image, video tooling, bundle size).

---

## 2. Areas

Legend: **P** pages, **API** `app/api`, **SA** server-action files, **T** tables (migration numbers in parentheses = created/changed it, from a grep of each migration for the table name, comments stripped), **RPC** called from app/lib/components, **Cron**, **Env**. "Status" cites evidence.

### 2.1 Store catalog & search
- **P**: `app/[locale]/store/page.tsx` (ISR 86400, default listing), `store/search/page.tsx` (dynamic; reached by rewrite when a listing param is present), `store/[sku]/page.tsx` (ISR 86400 + `generateStaticParams`, redirects merged SKUs via `getMergedRedirectSku`), `store/collections/[id]/page.tsx` (occasion collections, ISR + SSG), shared `store/store-listing.tsx`, home `app/[locale]/page.tsx` (ISR 86400), `v2/store/page.tsx`, `v2/page.tsx`.
- **API**: `/api/store/search` (instant suggestions, GET, in-memory rate limiter `lib/rate-limit.ts`), `/api/demand` (view/add_to_cart/request/zero_search signals), admin feeders `/api/admin/{drive-import,store-cleanup,starter-parts,voltaat-import,sourcing-backup}` (see §2.11).
- **SA**: `app/[locale]/dashboard/store/actions.ts` (createPart, updatePart, deletePart, importPartsFromSheet, togglePublished), `store/attributes/actions.ts`, `store/fix/actions.ts`, `store/quick/actions.ts`, `store/overview/actions.ts`, `store/occasions/actions.ts` (all call `revalidateStorefront()`).
- **lib/store**: `public-catalog.ts` (cached cookie-free reads + tags), `catalog.ts` (`STORE_URL_PARAMS`, card contract), `search.ts` / `search-suggest.ts` (ranking), `store-categories.ts` + `categories.ts` + `category-label.ts` (9 storefront categories), `product-details.ts` / `specs.ts` / `part-source.ts` (product page blocks), `sourcing.ts` (our product vs supplier offers; `SOURCED_OFFER_FIELDS`), `attributes.ts` / `derive-attributes.ts` (typed attributes from names), `pack.ts`, `image-url.ts` (Shopify CDN sizing), `store-image.ts` (server-only, uses `sharp`), `bought-together.ts` / `also-useful-relevance.ts` / `similar.ts`, `translate-details.ts` (AR descriptions), `demand-client.ts`, `restock.ts`. **lib/parts**: `constants.ts`, `format.ts`, `part-key.ts`, `sheet-import.ts` (Google Sheet CSV import), `storage-keys.ts`. **lib/cache/storefront.ts**.
- **components**: `components/parts/{part-card,part-detail-cart,parts-filters,add-to-cart-button,request-item-button,arrival-badge,lead-time-badge,demand-beacon,gear-placeholder}.tsx`, `components/search/{unified-search,home-store-search,suggest-shell,store-suggest}.tsx`, `components/store/occasion-banner.tsx`, `components/reviews/review-tiles.tsx`, `components/marketing/youtube-links.tsx`.
- **T**: `parts` (0011; 0007/0015–0017 FKs; 0022–0023, 0025, 0027–0032, 0034, 0037, 0041, 0044, 0047, 0048, 0054, 0056–0058, 0069, 0070, 0090, 0094, 0095, 0097, 0098 touch it), `store_settings` (0025 and 30 more), `store_category_rules` (0048; no `.from()` in app code), `demand_signals` (0029, 0030, 0031, 0037, 0053, 0058, 0069, 0071), `sourcing_gaps` (0023), storage `product-images` (public, 0029). Backups of merges in comments of 0030.
- **RPC**: `part_merged_redirect_sku` (0030), `part_public_source` (0054), `order_delivery_quote` (0029/0044/0054), `co_purchased` (0057), `approved_reviews` / `approved_review_count` (0058), `record_demand` (0029/0031), `log_sourcing_gap` (0023/0031).
- **Cron**: voltaat-sync and supplier-refresh call `revalidateStorefront()` (daily purge).
- **Env**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `STORE_SHEET_CSV_URL` (admin import page pre-fill).
- **Status**: active, core. Evidence: ISR flags above; `docs/ISR_WRITES.md`; `lib/store/*` tests (25 test files). Legacy URL `/parts*` redirected in `next.config.mjs`.

### 2.2 Cart & checkout
- **P**: `store/cart/page.tsx`, `store/checkout/page.tsx` (dynamic, cookie client, redirects empty cart to cart), `store/checkout/checkout-client.tsx` (the order submit), `store/checkout/success/page.tsx` (reads `sessionStorage` snapshot `LAST_ORDER_KEY`), layouts for each.
- **API**: `/api/orders/confirmation` (POST, service client; see §3a).
- **SA**: none for customers.
- **lib**: `lib/parts/cart.ts` (legacy localStorage cart, migrated once), `cart-snapshot.ts`, `lib/store/checkout.ts` (pure checks, `checkoutRpcError`), `shipping.ts`, `shipping-settings.ts`, `delivery.ts`, `use-delivery-quote.ts` (RPC `order_delivery_quote` / `class_order_delivery_quote`), `working-days.ts` (TS twin of SQL `add_working_days`), `payment.ts`, `order-email.ts` (confirmation + date-change mails), `lib/prototyping/kit-money.ts` (kit discount rounding), `lib/schools/client.ts` (class-order marker).
- **components**: `components/parts/cart-provider.tsx` (the cart = `cart_items` rows per Supabase session incl. guests, `ensureSession()` on first add), `cart-icon.tsx`, `added-view-cart.tsx`, `components/payment/payment-instructions.tsx`, `components/phone-input.tsx`.
- **T**: `cart_items` (0016, 0025, 0030, 0035, 0055, 0071), `part_orders` + `part_order_items` (0011, 0014 guest-order hardening, 0025, 0027, 0029, 0032, 0034, 0035, 0039, 0044, 0053, 0097…), `project_kits` (0025), `store_settings` keys `shipping`, `holidays`, `kit_discount_pct`, `free_shipping_threshold`.
- **RPC**: `create_part_order` (latest 0097, 10 args), `redeem_credits` (0042), `set_order_payment_method` (0039/0044), `order_delivery_quote`, `class_order_delivery_quote` (0097).
- **Env**: Supabase public pair only (checkout page also reads them for the anon client).
- **Status**: active, money path. Legacy shims inside `checkout-client.tsx`: retries the RPC without `p_class_id` / `p_payment_method` / shipping args on `PGRST202` for databases that have not run 0097/0044/0029 (`legacy` flag from `useDeliveryQuote`).

### 2.3 Orders & delivery dates
- **P**: customer `orders/page.tsx`, `orders/[id]/page.tsx` (dynamic; owner = account or guest session); admin `dashboard/store/orders/page.tsx`, `dashboard/store/orders/[id]/page.tsx`.
- **API**: `/api/orders/rate` (GET one-tap rating from email), `/api/orders/review` (POST/GET comment), `/api/orders/confirmation`, cron `/api/cron/delivery-promises`.
- **SA**: `dashboard/store/orders/actions.ts` (setOrderStatus, updateOrderStatus, toggleWhatsappSent, advanceOrder, cancelOrder, setOrderTest; uses service client 2×).
- **lib/orders**: `status.ts` (statuses; TS twin of SQL `order_status_transition_ok`), `admin-rules.ts`, `line-suppliers.ts`, `rating.ts` (HMAC token), `rating-page.ts` (self-contained bilingual HTML), `whatsapp.ts`. **lib/store**: `delivery.ts`, `working-days.ts`, `order-email.ts`. **lib/admin/order-lines.ts**.
- **components**: `components/orders/{order-status-pill,order-timeline}.tsx`, `components/admin/{orders-table,order-controls,order-status-control}.tsx`, `components/parts/whatsapp-sent-toggle.tsx`.
- **T**: `part_orders`, `part_order_items`, `order_status_history` (0053), `reviews` (0058), `credits_ledger` (grant on delivery), `notification_outbox` (status mails).
- **RPC**: `set_order_status` (0053), `record_order_rating`, `record_order_review` (0053/0058, service role), `mark_restock_received` (0037/0069).
- **Cron**: `/api/cron/delivery-promises` (04:00): recompute dates for open orders whose lead-time class changed, email customer + owner summary.
- **Env**: `ORDER_RATING_SECRET` (else `CRON_SECRET`), `CRON_SECRET`, `RESEND_*`.
- **Status**: active. Migrations 0033 (delete-project fix), 0053, 0054, 0058, 0066 (holidays).

### 2.4 Design / quote / drawing requests
- **P**: `design/page.tsx` (hub), `design/quote/page.tsx` (upload + contact), `design/drawing/page.tsx` (tiered drawing service, prices from `store_settings.service_prices`), `projects/[id]/request/page.tsx` (Studio "Get it made" received page), `v2/design/page.tsx`. Redirects: `/design/upload`, `/design/jobs`, `/dashboard/jobs` → `/design/quote` (`next.config.mjs`).
- **API**: `/api/design-quote` (public; inserts `inquiries` + owner mail with 7-day signed link), `/api/project-cad` (notify owner that a CAD file was attached to a project), `/api/store-lead` (generic lead/contact/callback endpoint keyed by `source`, Turnstile when enforced).
- **SA**: `dashboard/leads/actions.ts` (setLeadStatus, saveLeadQuote, saveQuoteRule, rewardPrint).
- **lib**: `lib/design/{constants,pending-upload,quote-method}.ts`, `lib/email/lead-email.ts`, `lib/admin/{lead-kind,lead-parse}.ts`, `lib/pricing/service-tiers.ts`, `lib/studio/{request-summary,quote-accuracy}.ts`, `lib/studio/server/quote.ts` (RPC `project_quote`), `lib/projects/drawing-attachment.ts`.
- **components**: `components/design/{design-dropzone,quote-request}.tsx`, `components/store-landing/callback-form.tsx`, `components/contact-form.tsx`, `components/admin/{quote-form,quote-calc-card,quote-rule-form,quote-accuracy}.tsx`, `components/studio/{GetItMade,RequestReceived}.tsx`.
- **T**: `inquiries` (0002; 0031, 0064, 0073 quote columns, 0090), storage `quote-uploads` (0012, anon insert, 50 MB), `cad-files` (0005).
- **RPC**: `project_quote` (0073), `admin_reward_print` (0090).
- **Env**: `RESEND_API_KEY`, `RESEND_FROM`, `STORE_LEAD_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `TURNSTILE_SECRET_KEY`.
- **Status**: active. Old jobs pipeline (jobs/job_*) dropped by migration 0013; its app routes now redirect. Migration files 0005–0010 are still in the tree (history).

### 2.5 Projects (incl. recovery links, guest claim)
- **P**: `projects/page.tsx` (list, client-side so first-timers need no session), `projects/new/page.tsx` ("Describe your idea" chat, no sign-in wall), `projects/[id]/page.tsx` (project page; redirects product projects to `/studio`, `?view=page` escape), `projects/[id]/request/page.tsx`.
- **API**: `/api/projects/name` (Gemini project name), `/api/projects/recovery-email` (D6: email link, `project_recovery_begin`), `/api/projects/claim` (open emailed link, `claim_project`), `/api/auth/claim-guest` (move guest work on sign-in), `/api/project-cad`, `/api/admin/projects/[id]/export`.
- **SA**: none (client writes via supabase-js under RLS; `delete_project` RPC).
- **lib/projects**: `href.ts` (where a project opens), `create-from-chat.ts`, `name-from-brief.ts`, `recovery.ts` (link building; production URL hard-coded), `link-email.ts`, `phone-prompt.ts`, `parts-list.ts`, `allocation.ts`, `item-status.ts`, `uses-ai.ts`, `constants.ts`, `drawing-attachment.ts`. **lib/auth**: `claim-guest.ts`, `claim-guest-client.ts`, `claim-guest-server.ts`, `guest-redirect.ts`. **lib/supabase/guest.ts**.
- **components**: `components/projects/{project-workspace,project-list,new-project-chat,new-project-form,describe-idea,project-claim-gate,project-parts-list,project-cad-card,phone-prompt,product-picture,project-unavailable}.tsx`, `components/auth/guest-claim-notice.tsx`, `components/studio/DeleteProject.tsx`.
- **T**: `projects` (0015; columns added by 0016, 0018–0025, 0040, 0042 credit columns + 3-active-project trigger, 0043, 0045 `contact_email`/`recovery_token`/`recovery_emailed_at`, 0068 `studio`/`studio_version`, 0073, 0088–0092, 0096, 0097, 0099), `project_items` (0015, 0019), `project_parts` (0020), `project_files` (0018), `project_blocks` (0015), `project_materials` (0015; no `.from()` anywhere in app code = write-only/unused), `project_events` (0024, 2 uses), `project_kits` (0025), `analysis_runs` (0024, 0099 `request_hash`), storage `project-images`, `cad-files`.
- **RPC**: `delete_project` (0035), `project_recovery_begin`, `claim_project` (0045), `claim_guest_work` (0071, service role), `is_class_project` (0096).
- **Env**: `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (claim-guest, project-cad).
- **Status**: active. Retired: `project_claims` (0020, no `.from()` use), `project_materials` (see above).

### 2.6 Studio (idea → spec → parts → wiring → enclosure → model → print/make; tokens; product engineer)
- **P**: `projects/[id]/studio/page.tsx` (scope `studio`; `StudioShell`), test twin `e2e-fixtures/studio`, `e2e-fixtures/studio-request`, `tokens/page.tsx` (balance, Maker Pass, token shop).
- **API** (15; the brief's "×17" is not what `find` shows): `/api/studio/{spec,pick,wiring,enclosure,mech,firmware,doc,tokens}` + `/api/studio/product/{design,check,preview,choose,unlock,model,engineer}`. Auth/charging per route in §5.
- **SA**: `dashboard/studio-library/actions.ts` (savePart, savePartSkus, setPartEnabled, resetPart, lookupSkus).
- **lib/studio** (288 files): `schema.ts` (StudioDoc, ProductSpec), `tiers.ts` (explorer/maker/engineer, ideation token config `IDEATION`), `ai/` (`spec.ts`, `pick.ts`, `enclosure.ts`, `mech.ts`, `prompts.ts`, `spec-guards.ts`, `actuator-rules.ts`, `cache.ts`), `server/` (`context.ts` `studioRequest`/`studioCall`, `doc.ts` optimistic persistence incl. private product doc, `tokens.ts` `ideaStatus`/`ideaCharge`, `product.ts` guest limit + preview bucket, `quote.ts`, `http.ts`, `initial.ts`, `preview-url.ts`), `client/` (`api.ts` the Studio's single fetch door, `steps.ts` FLOW = idea, parts, wiring, enclosure, print, code, make; `save-state.ts`, `cache.ts`, `product.ts`, `mock.ts` e2e), `library/` (53 part files in `parts/`, `remote.ts` merges DB `studio_parts`, `class-safe.ts`, `merge.ts`), `netlist.ts` / `connections.ts` / `schematic.ts` / `wiring-drawing.ts` / `wokwi.ts` (deterministic wiring), `wiring3d/` (breadboard 3D), `enclosure/` (templates, CSG inputs, label), `mech/`, `geometry/` (worker + manifold kernel + IndexedDB cache `persist.ts`, `GEOMETRY_CACHE_VERSION`), `product/` (ProductModel, 12 archetypes, solver, forms, vision/design AI, `private.ts`), `sim/` ("Try it" simulation), `models/` (procedural component models), `export.ts`, `zip.ts`.
- **components/studio** (60 files): `StudioShell.tsx`, `StudioLoader.tsx`, `steps/{IdeaStep,PartsStep,PartsFlipbook,WiringStep,EnclosureStep,EnclosureProduct,EnclosureTemplate,PrintStep,PrintProduct,CodeStep,MakeStep,ProductEngineer,UnderstandingPanel}.tsx`, `viewer/{Viewer,ProductViewer,LeanCanvas,EnclosureMesh,…}.tsx` (R3F; new tags must be registered in `LeanCanvas.tsx`), `use-product.ts`, `use-studio-cart.ts`. Also `components/tokens/token-shop.tsx`, `components/payments/fawran-checkout.tsx`, `components/admin/studio-library/*`.
- **T**: `projects.studio` jsonb + `studio_version` (0068), `studio_parts` (0070; bucket `studio-models` public), `idea_sessions` + `idea_passes` (0088/0089), `credits_ledger` kind `idea` (0088), `ai_usage` + `analysis_runs` (feature `studio`, 0068), `ai_rate_limits` (guest design limit, 0042), `cad_generations` (enclosure/unlock, 0043/0090), `inquiries.quote_calc` (0073), storage `project-images` (`studio-previews/`).
- **RPC**: `idea_token_status`, `idea_token_charge` (0088→0089 replaced), `cad_begin/cad_set_code/cad_deliver/cad_fail` (0043, 0090), `credit_can_use`, `spend_credit`, `bom_rate_check`, `project_quote`.
- **Env**: `GEMINI_*`, `TIER_MODEL_MAKER`, `TIER_MODEL_ENGINEER`, `IDEA_TURNS_PER_TOKEN`, `AI_RATE_SALT`, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (geometry cache key), `E2E_FIXTURES`.
- **Status**: active, current "Plan a product" flow (`lib/projects/href.ts` sends product projects here). Product designer (`/api/studio/product/*`) is live code; "Create my CAD" unlock charges via the `cad_*` RPCs. Needs migrations 0068–0072, 0088–0090 (routes degrade when missing: `rpcMissing`, `run_0068`).

### 2.7 Prototyping / engineer view (electronics builder, BOM table, schematics)
- **P**: `projects/[id]/prototyping/page.tsx` (redirects non-admins to `/studio`; old workspace = Engineer view for `super_admin`; scope `all`), `projects/[id]/engineering/page.tsx` (see §2.15).
- **API**: `/api/analyse` (brief → understanding, NDJSON), `/api/brief-chat`, `/api/transcribe` (Groq), `/api/bom/match` (deterministic), `/api/bom/electronics`, `/api/netlist`, `/api/firmware`.
- **SA**: none.
- **lib/prototyping** (74 files): `engine.ts` (rules), `analysis.ts` / `analysis-schema.ts` / `analysis-request.ts` (0099 hash), `ai-call.ts` (`validatedCall`, one retry, metering), `providers/{index,gemini,gemini-client,gemini-attrs,rules,types}.ts`, `bom.ts`, `bom-match.ts`, `bom-server.ts`, `bom-intent.ts`, `bom-cost.ts` ("To buy now"), `kit-plan.ts`, `electronics-build.ts` / `electronics-gen.ts` / `electronics-rules.ts` / `auto-electronics.ts`, `netlist.ts` / `netlist-schema.ts`, `schematic.ts` / `schematic-svg.ts` / `wiring-svg.ts`, `firmware.ts`, `readiness.ts`, `spec.ts`, `tree.ts`, `view-mode.ts` (client vs engineer view), `client-steps.ts`, `dimension-drawing.ts`, `footprints.ts`.
- **components/prototyping** (31): `workspace.tsx`, `bom-table.tsx`, `parts-list.tsx`, `electronics-route.tsx`, `netlist-view.tsx`, `schematics-stage.tsx`, `svg-frame.tsx`, `firmware-card.tsx`, `idea-stage.tsx`, `brief-editor.tsx`, `brief-chat.tsx`, `dictation.tsx`, `tree-nav.tsx`, `payment-card.tsx`, and `client/{client-workspace,client-parts,client-wiring,client-make,step-card}.tsx` (4-step client view).
- **T**: `projects` (`bom`, `netlist`, `firmware`, `spec`, `disciplines`; 0020–0024, 0040), `project_parts` (0020), `project_schematics` + `project_schematic_revisions` (0020; 3 `.from()` uses each), `analysis_runs` (0024), `ai_usage` (0023, 0026), `sourcing_gaps`, `project_kits`.
- **RPC**: `log_sourcing_gap`, `record_bom_demand`, `bom_rate_check`, `credit_can_use`, `spend_credit`, `log_ai_usage`, `ai_usage_totals`, `project_ai_charges` (0038; payment-card).
- **Env**: `ANALYSIS_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GROQ_API_KEY`, `GROQ_WHISPER_MODEL`, `NETLIST_TEST_BREAK` (dev).
- **Status**: active for the client-facing 4-step view (older projects) and `super_admin` Engineer view; new product projects are routed to Studio (§2.6). Duplicates of Studio (see §6).

### 2.8 Credits, payments & pricing (plans, service prices, price experiment, edu credits, maker pass)
- **P**: `pricing/page.tsx` (plans, credits, invite price; `#credits`), `tokens/page.tsx`, `dashboard/credits/page.tsx`, `dashboard/payments/page.tsx`, `dashboard/usage/page.tsx`, `dashboard/ai-costs/page.tsx` + `[userId]`, `dashboard/store/discounts/page.tsx`, `dashboard/store/schools/page.tsx`.
- **API**: `/api/billing/{checkout,proof,service}` (Fawran payments, signed-in non-anonymous), `/api/studio/tokens`.
- **SA**: `dashboard/credits/actions.ts` (grantCredits), `dashboard/payments/actions.ts` (reviewPayment, expirePass), `dashboard/usage/actions.ts` (saveAiPricing, saveTurnstileSwitch, saveCleanupSettings), `dashboard/store/schools/actions.ts` (saveSchoolPricing), `dashboard/engineering-jobs/actions.ts` (saveServicePrices).
- **lib**: `lib/credits/{server,use-credits,constants,classify,cad-cost,edu,grant-reasons,redeem-window}.ts`, `lib/pricing/{defaults,plans,service-tiers,experiment,fx,usage-price,use-price-quote}.ts` (plans/service prices are data in `store_settings`, defaults mirrored from SQL), `lib/billing/{config,server,verify}.ts` (token packs 10/25/50 at QAR 2, Maker Pass QAR 20/30 days; Fawran receipt check), `lib/services/{quote,server}.ts` (engineer services), `lib/ai/prices.ts`, `lib/admin/discount-report.ts`.
- **components**: `components/credits/{credits-badge,credits-overview,access-note,cad-card}.tsx`, `components/pricing/invite-price.tsx`, `components/payments/fawran-checkout.tsx`, `components/tokens/token-shop.tsx`, `components/services/services-panel.tsx`, `components/admin/{ai-pricing,safety-settings,school-pricing-editor}.tsx`.
- **T**: `credits_ledger` (0042; 0046, 0052, 0053, 0055, 0060, 0061, 0071, 0074, 0075, 0088–0092, 0096), `edu_credit_grants` (0074; no `.from()` use, SQL-only), `ai_rate_limits` (0042), `ai_usage`, `payments` (0089, 0091, 0092), `idea_passes` / `idea_sessions` (0088/0089), `store_settings` keys `pricing_plans`, `service_prices`, `price_experiment` (hidden from anon), `ai_pricing`, `rewards` (0090), `engineer_services` (0092), `school_pricing` (0096); storage `payment-proofs` (0089, private 8 MB png/jpeg).
- **RPC**: `credit_can_use`, `spend_credit` (0042→0052→0053→0096), `credit_summary`, `admin_grant` (0042→0088), `admin_credit_users`, `ai_usage_daily`, `redeem_credits`, `payment_create`, `payment_attach_proof`, `payment_settle`, `admin_payment_review`, `admin_pass_expire`, `payment_create_service` (0092), `admin_revenue_users`, `admin_ai_cost_users` (0088/0089), `idea_token_status`, `idea_token_charge`, `price_experiment_quote`, `my_price_quote`, `claim_price_cohort`, `price_cohort_funnel` (0060/0061), `project_ai_charges`.
- **Env**: `AI_PRICES`, `AI_RATE_SALT`, `SUPABASE_SERVICE_ROLE_KEY` (billing writes), `GEMINI_API_KEY` (receipt vision), `ENGINEERS_JOB_TOKENS`.
- **Status**: active. "Charging" flag for AI price (0038 → 0050 one price) is display-only per header comments (`store_settings` `ai_pricing`); plans are display-only (CLAUDE.md: not enforced by DB). Triggers: `part_orders_grant_credits` (0042), `on_auth_user_edu_credits` (0074, `edu_credit_grant` = 2 wiring + 1 CAD since 0075).

### 2.9 CAD generation (browser engine + cloud cad-worker)
- **P**: UI inside Studio and prototyping (no own page): `components/credits/{cad-card,cad-viewer,cad-cloud-result}.tsx`; test page `e2e-fixtures/cad-cloud`.
- **API**: `/api/cad` (Gemini writes OpenSCAD or CadQuery; `maxDuration` 300), `/api/studio/enclosure`, `/api/studio/product/unlock`.
- **SA**: none. Admin switch: `store_settings.cad_engine` edited via SQL/admin (`lib/cad/engine-server.ts` reads it).
- **lib/cad**: `engine.ts` (`browser | admin | cloud`, `min_wall_mm`), `engine-server.ts`, `prompt.ts` (OpenSCAD + CadQuery prompts), `validate.ts` (static checks on model SCAD), `render.ts` + `render.worker.ts` (browser OpenSCAD wasm in a Web Worker), `cloud.ts` (server-only: Vercel OIDC → Google STS WIF → ID token → worker; legacy `GCP_CAD_SA_KEY`), `cloud-flow.ts` (the cloud branch of `/api/cad`), `footprints`. **lib/credits/cad-cost.ts** (credits by tier: simple 1 / standard 2 / complex 3, 0090). **services/cad-worker/** (`app/{main,runner,executor,sandbox,geometry,cadhelpers}.py`, `Dockerfile`, `cloudbuild.yaml`, pytest suite in `tests/`). Docs: `docs/CAD_CLOUD.md`, `docs/STUDIO_CAD.md`.
- **T**: `cad_generations` (0043, 0071, 0090), `store_settings.cad_engine` (0067), `inquiries`.
- **RPC**: `cad_begin`, `cad_set_code`, `cad_deliver`, `cad_fail` (0043 → 0090), `set_cad_request` (0042), `credit_can_use`, `log_ai_usage`.
- **Env**: `GEMINI_API_KEY`, `GCP_CAD_URL`, `GCP_WIF_PROVIDER`, `GCP_CAD_SA_EMAIL`, `GCP_CAD_SA_KEY` (legacy), `CAD_WORKER_TOKEN`, `VERCEL_OIDC_TOKEN` (platform-injected).
- **Status**: active; browser engine is the default (no row / bad value = browser). Cloud engine is behind `store_settings.cad_engine` plus GCP env vars; `lib/studio/cad-setting.ts` and `lib/studio/cad-adapter.ts` exist (the former is reported unused by knip in BASELINE.md).

### 2.10 Dashboard / admin (every `/dashboard/*` page)
- Gate: `dashboard/layout.tsx` (auth + `guestRedirect` → guests go to `/projects`; non-admin clients see only a profile card on `/dashboard`); `dashboard/store/layout.tsx` requires `super_admin`; `customers`, `studio-library`, `payments`, `engineering-jobs`, `projects`, `usage`, `ai-costs`, `credits`, `notifications` each have a `layout.tsx` requiring `super_admin`; `leads` and `reviews` check the role in the page; `contact` and `overview` have no role check in the page (see §6). Nav: `components/dashboard/admin-nav-groups.ts` (Today · Sell · Build · Settings + tab sets), `lib/admin/nav.ts`, `nav-badges.ts`, `home-tiles.ts` (Reply / Confirm / Buy / Fix).
- **SA files** (23 under `dashboard/**`): contact, credits, engineering-jobs, leads, payments, reviews, store, store/attributes, store/fix, store/occasions, store/orders, store/overview, store/quick, store/restock, store/schools, store/sourcing, store/stock, store/suppliers/{import,lookup,voltaat}, store/youtube, studio-library, usage. Only `store/orders/actions.ts` uses the service client. `restock/actions.ts` and `engineering-jobs/actions.ts` write `store_settings`/`suppliers` without `revalidateStorefront()` (pointer, §6).
- **lib/admin** (36 files, e.g. `fix-data`, `fix-groups`, `fix-delivery`, `stock-data`, `stock-lists`, `own-stock`, `order-lines`, `discount-report`, `customer-export`, `project-export`, `health-status`, `pagination`, `test-data`, `continue-projects`). **components/admin** (38) + **components/dashboard** (8).

| Route (under `app/[locale]`) | File | Purpose (one line) | Gate / render |
|---|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | Owner home: Reply/Confirm/Buy/Fix tiles, numbers & funnels (`components/dashboard/admin-home.tsx`, `admin-overview.tsx`), price-experiment funnel; client sees profile card | layout auth; force-dynamic |
| `/dashboard/overview` | `dashboard/overview/page.tsx` | Redirect to Home `#numbers` (`overviewRedirectPath`) | layout auth |
| `/dashboard/store` | `dashboard/store/page.tsx` | Product catalog table (publish toggle, StockBadge, delete) | super_admin |
| `/dashboard/store/new` | `store/new/page.tsx` | New product form (`components/parts/part-form.tsx`) | super_admin (layout) |
| `/dashboard/store/[id]/edit` | `store/[id]/edit/page.tsx` | Product edit (`components/admin/part-editor.tsx`, sourcing panel, `offer_landed_cost_qar`) | super_admin (layout) |
| `/dashboard/store/quick` | `store/quick/page.tsx` | Fast product entry with Drive images (`quick-entry.tsx`, `/api/admin/drive-import`) | super_admin |
| `/dashboard/store/attributes` | `store/attributes/page.tsx` | Typed attributes editor + kit discount | super_admin |
| `/dashboard/store/import` | `store/import/page.tsx` | Google Sheet catalogue import (`STORE_SHEET_CSV_URL`, `lib/parts/sheet-import.ts`) | super_admin |
| `/dashboard/store/fix` | `store/fix/page.tsx` | Fix list: missing photo/price/delivery date (D1) | super_admin |
| `/dashboard/store/stock` | `store/stock/page.tsx` | "What to buy" three lists + own-stock units (`set_own_stock`, `mark_restock_received`) | super_admin |
| `/dashboard/store/restock` | `store/restock/page.tsx` | Demand-ranked restock (`restock_summary`, weights, supplier minimums) | super_admin |
| `/dashboard/store/discounts` | `store/discounts/page.tsx` | Discount-leakage report (`lib/admin/discount-report.ts`) | super_admin; no `force-dynamic` flag in file (reads cookie client) |
| `/dashboard/store/occasions` | `store/occasions/page.tsx` | Seasonal campaign editor (`store_settings.occasions`) | super_admin |
| `/dashboard/store/orders` | `store/orders/page.tsx` | Order list (test/cancelled hidden unless `?show=all`) | super_admin |
| `/dashboard/store/orders/[id]` | `store/orders/[id]/page.tsx` | One order: status control, lines, payment, WhatsApp flag | super_admin |
| `/dashboard/store/suppliers` | `store/suppliers/page.tsx` | Suppliers, pricing mode, commission, shipping tiers, holidays, rank | super_admin |
| `/dashboard/store/suppliers/import` | `suppliers/import/page.tsx` | Supplier CSV price-list import (adapter 19a) | super_admin |
| `/dashboard/store/suppliers/lookup` | `suppliers/lookup/page.tsx` | Search Mouser / DigiKey and add products | super_admin |
| `/dashboard/store/suppliers/voltaat` | `suppliers/voltaat/page.tsx` | Voltaat sync switch, run now, mapping | super_admin |
| `/dashboard/store/overview` | `store/overview/page.tsx` | Sourcing overview groups, below-floor list, hide product | super_admin |
| `/dashboard/store/gaps` | `store/gaps/page.tsx` | `sourcing_gaps`: BOM lines the store could not supply | super_admin |
| `/dashboard/store/youtube` | `store/youtube/page.tsx` | Videos & YouTube links, connect channel, retire log | super_admin |
| `/dashboard/store/schools` | `store/schools/page.tsx` | `school_pricing` editor | super_admin |
| `/dashboard/reviews` | `reviews/page.tsx` | Review moderation (`set_review_status`) | super_admin in page |
| `/dashboard/leads` | `leads/page.tsx` | All enquiries (service client), statuses, Studio requests | super_admin in page |
| `/dashboard/leads/[id]` | `leads/[id]/page.tsx` | One enquiry: quote calc, owner quote, reward print | super_admin in page |
| `/dashboard/customers` | `customers/page.tsx` | Every customer (service client + `admin_ai_cost_users`) | super_admin (layout) |
| `/dashboard/customers/[id]` | `customers/[id]/page.tsx` | One customer across tables; JSON export via `/api/admin/customers/[id]/export` | super_admin (layout) |
| `/dashboard/projects` | `projects/page.tsx` | All projects for diagnostics (service client), JSON export buttons | super_admin (layout) |
| `/dashboard/credits` | `credits/page.tsx` | Find user, balances, grant credits, ledger, `ai_usage_daily` | super_admin (layout) |
| `/dashboard/studio-library` | `studio-library/page.tsx` | Studio part library list (code parts + `studio_parts`) | super_admin (layout) |
| `/dashboard/studio-library/[id]` | `studio-library/[id]/page.tsx` | Add / edit one Studio part, SKU check | super_admin (layout) |
| `/dashboard/usage` | `usage/page.tsx` | AI usage vs free allowances, AI price, Turnstile switch, anonymous-cleanup settings, health lines | super_admin (layout) |
| `/dashboard/ai-costs` | `ai-costs/page.tsx` | Per-user AI cost overview | super_admin (layout) |
| `/dashboard/ai-costs/[userId]` | `ai-costs/[userId]/page.tsx` | One user's projects, tokens, per-model totals | super_admin (layout) |
| `/dashboard/payments` | `payments/page.tsx` | Fawran proof review queue (`admin_payment_review`, `admin_pass_expire`) | super_admin (layout) |
| `/dashboard/engineering-jobs` | `engineering-jobs/page.tsx` | Engineering job queue, status, service prices (+ `[id]/snapshot/route.ts` JSON download) | super_admin (layout) |
| `/dashboard/notifications` | `notifications/page.tsx` | `notification_outbox` log, per-kind switches, test send | super_admin (layout) |
| `/dashboard/contact` | `contact/page.tsx` | Contact phone editor (`store_settings.contact_phone`) | action checks `super_admin`; page has no role check |

- **API**: `/api/admin/*` (13 routes, §5), `/api/orders/*` for rating pages.
- **T/RPC**: all areas; admin-only RPCs `admin_grant`, `admin_credit_users`, `admin_ai_cost_users`, `admin_revenue_users`, `admin_payment_review`, `admin_pass_expire`, `admin_engineering_job_set`, `admin_reward_print`, `set_order_status`, `set_review_status`, `set_own_stock`, `mark_restock_received`, `refresh_all_part_sourcing`, `restock_summary`.
- **Env**: none specific beyond Supabase; `EXPORT_DEV_OWNER` (export routes dev hook), `VERCEL_GIT_COMMIT_SHA` (`components/dashboard-footer.tsx`).
- **Status**: active. `dashboard/store/*` pages predate role-specific dashboards (CLAUDE.md: role dashboards deliberately not built).

### 2.11 Sourcing & supplier sync (Voltaat, suppliers, offers, restock, own stock, commission / margin floors)
- **P**: `dashboard/store/suppliers/**`, `dashboard/store/{stock,restock,overview,gaps,fix}`.
- **API**: `/api/admin/{voltaat-import,voltaat-sync,sourcing-backup,starter-parts,store-cleanup,drive-import}` (super_admin), cron `/api/cron/voltaat-sync`, `/api/cron/supplier-refresh`, `/api/bom/match` (feeds `sourcing_gaps`).
- **SA**: `store/sourcing/actions.ts` (saveOffer, deleteOffer, pinOffer, setPricingMode, saveSupplier, saveSourcingSettings, saveShippingSettings, saveHolidays), `suppliers/{import,lookup,voltaat}/actions.ts`, `store/restock/actions.ts`, `store/stock/actions.ts`, `store/fix/actions.ts`.
- **lib/sourcing** (17): `types.ts` (adapter contract), `adapters/{csv,mouser,digikey,voltaat}.ts`, `voltaat-catalogue.ts`, `voltaat-sync.ts` (server-only; robots.txt check, `REQUEST_GAP_MS` 5000, UA `GestaltungPriceSync/1.0` in `adapters/voltaat.ts`), `api-refresh.ts` (Mouser + DigiKey daily), `backup.ts`, `spec-map.ts`, `lead-times.ts`. **lib/store**: `sourcing.ts`, `offer-clean.ts`, `restock.ts`. **lib/admin**: `fix-delivery.ts` (creates the "own stock (Lusail)" supplier if 0095 not run), `own-stock.ts`, `stock-lists.ts`. **lib/pricing/fx.ts**.
- **components**: `components/admin/{sourcing-panel,suppliers-editor,supplier-lookup,price-list-import,voltaat-sync,offer-coverage,restock-dashboard,stock-lists-view,own-stock-panel,shipping-settings,holiday-settings,fix-list,store-translate}.tsx`.
- **T**: `suppliers` (0028; 0036, 0037, 0054, 0095 `rank`, 0098), `supplier_offers` (0028; 0030, 0054, 0095, 0098), `supplier_sync_runs` (0036), `restock_receipts` (0037, 0069), `own_stock` (0069, 0095), `demand_signals`, `sourcing_gaps`, `parts` (landed cost / income / `in_own_stock`), `store_settings` keys `voltaat_sync`, `fx_to_qar`, `margin_floor_pct`, `commission_floor_pct`, `restock_weights`.
- **RPC**: `refresh_part_sourcing` (0028 → 0095 → 0098 latest), `refresh_all_part_sourcing`, `offer_landed_cost_qar`, `mark_restock_received`, `set_own_stock`, `restock_summary`, `log_sourcing_gap`, `record_bom_demand`.
- **Cron**: voltaat-sync 03:00 UTC, supplier-refresh 02:00 UTC; both call `revalidateStorefront()`.
- **Env**: `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, `CRON_SECRET`, `GEMINI_API_KEY` (store-cleanup translate).
- **Status**: active. Migration headers 0069/0095/0098 say "NOT RUN YET (owner runs it)": code references `parts.in_own_stock`, `suppliers.rank`, commission floor, so production state of these three is **unverified** (needs a DB check, not possible here). Supplier ranking: in stock → `rank` (own_stock 10, voltaat 20, digikey 30, mouser 40, alibaba/aliexpress 70) → lead days → landed cost (0095 header). Commission floor separate from margin floor (0098 header).

### 2.12 Notifications & email (outbox, kinds, templates, unsubscribe, Resend)
- **P**: `dashboard/notifications/page.tsx`.
- **API**: `/api/cron/notifications` (drain), `/api/notifications/unsubscribe` (GET page / POST apply / RFC 8058 one-click), `/api/admin/notifications/test`, plus direct mails from `/api/store-lead`, `/api/design-quote`, `/api/demand`, `/api/orders/confirmation`, `/api/cron/delivery-promises`, `/api/project-cad`, `/api/projects/recovery-email`.
- **SA**: `store/orders/actions.ts` calls the drainer in `after()` after an admin status change.
- **lib**: `lib/email.ts` (`sendEmail`, `sendEmailResult`, `OWNER_EMAIL`, `escapeHtml`; Resend REST), `lib/email/{brand-layout,html-to-text,lead-email}.ts`, `lib/email/templates/{index,layout,credits-admin-grant,credits-order-delivered,discount-ready,engineering-job-ready,first-circuit,first-project,order-status}.ts`, `lib/notifications/{decide,drain,links}.ts` (`OUTBOX_KINDS`, `isAuthorizedCron`), `lib/store/order-email.ts`, `lib/projects/link-email.ts`, `lib/orders/rating*.ts`.
- **Kinds** (3 places must match: DB check constraint, `OUTBOX_KINDS` in `lib/notifications/decide.ts`, `NOTIFICATION_KINDS` in `lib/email/templates/index.ts`; `lib/notifications/kinds-sync.test.ts` passes on main per BASELINE.md): `credits_order_delivered`, `credits_admin_grant`, `first_project`, `first_circuit`, `discount_ready`, `order_confirmed|paid|sourcing|shipped|delivered|cancelled`, `engineering_job_ready`. Latest constraint: 0091.
- **T**: `notification_outbox`, `notification_prefs` (0046; no `.from()` in app code, accessed in SQL/RPC), `store_settings.notifications` (owner per-kind switches), `order_status_history`.
- **RPC**: `claim_notifications` (SKIP LOCKED, 10-minute claim), `mark_notification`, `notification_unsubscribe`; enqueue is SQL (`notification_enqueue`, triggers `credits_ledger_notify`, `projects_notify_insert/update`, `part_orders_notify_status`).
- **Cron**: `/api/cron/notifications` 04:30 UTC (Hobby-safe daily).
- **Env**: `RESEND_API_KEY`, `RESEND_FROM`, `STORE_LEAD_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `ORDER_RATING_SECRET`.
- **Status**: active. Auth emails (confirm/reset) are Supabase-side templates in `supabase/auth-templates/*.html` (docs/AUTH_EMAILS.md), not sent by this code.

### 2.13 Auth & accounts (sign-in/up, social, anonymous guests, roles, profiles, cleanup cron)
- **P**: `sign-in`, `sign-up`, `forgot-password`, `reset-password` (scope `auth`; sign-in/up redirect signed-in users), `dashboard` (profile card for clients).
- **API**: `/api/auth/callback` (GET: recovery `verifyOtp`, OAuth code exchange for Google/Apple/Microsoft, `signInError` redirects), `/api/auth/claim-guest` (POST, same-origin + guest access token → `claim_guest_work`), cron `/api/cron/anonymous-cleanup`.
- **lib/auth**: `get-session.ts` (`getAuthUser`, `getSessionContext` → profile + tenant), `guest-redirect.ts`, `next-path.ts` (redirect sanitising), `redirects.ts`, `providers.ts` / `providers-server.ts` (which social buttons; reads `/auth/v1/settings`), `claim-guest*.ts`. **lib/supabase**: `guest.ts` (`ensureSession`, lazy anonymous session), `middleware.ts`, `auth-cookie.ts`, `server.ts`, `client.ts`, `lazy.ts`, `types.ts`. **lib/turnstile.ts**, `turnstile-server.ts`, `turnstile-client.ts`. **lib/cleanup/anonymous.ts**.
- **components/auth** (10): `auth-provider.tsx`, `sign-in-form`, `sign-up-form`, `forgot-password-form`, `reset-password-form`, `social-sign-in`, `auth-shell`, `auth-return-link`, `guest-claim-notice`, `sign-out-button`; `components/turnstile.tsx`, `turnstile-challenge.tsx`, `header-auth-link.tsx`, `account-bar.tsx` (reported unused by knip).
- **T**: `profiles` (0001 role + tenant, 0003 phone, 0009 anti-self-promotion hardening, 0042 email sync + `profiles_guard_email`, 0064 phone normalise, 0076 social name trigger), `tenants` (0001), `cleanup_runs` (0055), `edu_credit_grants` (0074), `store_settings.turnstile` + `anonymous_cleanup` (0055).
- **RPC**: `claim_guest_work` (0071), `cleanup_anonymous_users` (0055, service role; `dry_run` default true), `credit_can_use` (role from `ai_role()`).
- **Cron**: anonymous-cleanup Sun 05:00 UTC (`isAuthorizedCron`).
- **Env**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, Supabase pair, `SUPABASE_SERVICE_ROLE_KEY` (callback, claim-guest, cleanup).
- **Status**: active. Docs: `docs/SOCIAL_SIGN_IN.md`, `docs/TURNSTILE.md`, `docs/AUTH_EMAILS.md`. Turnstile is behind `store_settings.turnstile.enabled` (default false in 0055; current value **unverified**). Cleanup is dry-run unless the owner flips `dry_run` (0055 header).

### 2.14 Schools & classes (join codes, teams, class orders)
- **P**: `schools/page.tsx` (entry), `schools/classes/page.tsx` + `layout.tsx` (auth gate), `schools/classes/[id]/page.tsx`, `…/teams/[teamId]/page.tsx`, `…/sheet/page.tsx` (printable sheet with QR via `dangerouslySetInnerHTML`, noindex), `join/page.tsx` (students join with code), plus marketing `students`, `institutions`, `institutions/proposal` (ISR 86400), `partners/schools`, `partners/accelerators`.
- **API**: none dedicated; invoice request goes to `/api/store-lead` from the server action (`fetch(`${origin}/api/store-lead`)`).
- **SA**: `schools/classes/actions.ts` (createClass, setClassArchived, addTeamComment, requestSchoolInvoice).
- **lib/schools** (16): `join-code.ts`, `pricing.ts` (`store_settings.school_pricing`), `safe-parts.ts` / `lib/studio/library/class-safe.ts` (class-safe parts, 422 `unsafe_part`), `class-parts.ts` (team parts → one order), `delivery.ts`, `qr.ts`, `client.ts`, `server.ts` (`is_class_project`), `db/schools-migration.test.ts` (PGlite; package missing per BASELINE.md).
- **components/schools**: `class-create-form`, `class-row-actions`, `join-form`, `team-comment-form`, `buy-for-class`.
- **T**: `school_classes`, `class_teams`, `class_team_comments` (0096), `part_orders.class_id` + `class_breakdown` (0097), `projects` (class team projects exempt from the 3-project cap), `store_settings.school_pricing`.
- **RPC**: `create_school_class`, `join_class_team` (0096, students are anonymous sessions), `is_class_project`, `credit_can_use` / `spend_credit` v4 (teacher pays), `class_order_delivery_quote`, `create_part_order` with `p_class_id` (0097), `credit_summary`.
- **Env**: none specific.
- **Status**: active, newest (migrations 0096/0097). CLAUDE.md states school DB paths were verified only through PGlite; **unverified** against a live DB here.

### 2.15 Engineering jobs (0091 / 0092)
- **P**: `projects/[id]/engineering/page.tsx` (engineer-style project view + STEP panel + services; uses service client), `dashboard/engineering-jobs/page.tsx`, route `dashboard/engineering-jobs/[id]/snapshot/route.ts` (super_admin JSON).
- **API**: `/api/engineering/jobs` (POST, queue STEP job), `/api/engineering/jobs/[id]/cancel`, `/api/engineering/jobs/[id]/return`, `/api/billing/service` (pay for assembly / cad_engineer / pcb_gerber).
- **SA**: `dashboard/engineering-jobs/actions.ts` (setJobStatus, markJobReady, saveServicePrices).
- **lib**: `lib/engineering/{config,server,view}.ts` (job kinds `step_model | pcb_gerber | assembly | cad_engineer`; tokens `ENGINEERS_JOB_TOKENS`, ETA 1–3 h), `lib/services/{quote,server}.ts` (quote recomputed server-side from the saved Studio doc), `lib/billing/*`.
- **components**: `components/engineering/{step-panel,actions}.tsx`, `components/services/services-panel.tsx`.
- **T**: `engineering_jobs` (0091, 0092), `payments` (kind `service`), `credits_ledger` (tokens), storage `engineering-files` (private, 100 MB, 0091), `store_settings.engineer_services` (0092).
- **RPC**: `engineering_job_submit`, `engineering_job_cancel`, `engineering_job_return` (0091), `admin_engineering_job_set`, `payment_create_service` (0092).
- **Env**: `ENGINEERS_JOB_TOKENS` (default 10).
- **Status**: active, newest (2026-10-18). `engineering_job_ready` kind is in the 0091 constraint (resolved vs older CLAUDE.md note).

### 2.16 Inventory (legacy tenants / inventory_items vs client_inventory_items / my-inventory)
- **P**: `inventory/page.tsx`, `inventory/new/page.tsx`, `inventory/[id]/edit/page.tsx` (workshop/tenant inventory, `inventory_items` + `tenants`, role `workshop|super_admin`, any signed-in sees own tenant by RLS), `inventory/layout.tsx`, `my-inventory/page.tsx` (client's own parts, scope `all`). Redirects `/dashboard/inventory*` → `/inventory*`.
- **SA**: `inventory/actions.ts` (createItem, updateItem, deleteItem).
- **lib/components**: `lib/inventory/edit.ts`, `components/inventory/{item-form,delete-item-button,tenant-filter,my-inventory}.tsx`, `components/search/unified-search.tsx` ("inventory first"), `components/parts/add-to-project-button.tsx`, `components/prototyping/part-dialogs.tsx`, `lib/projects/allocation.ts`.
- **T**: `tenants` (0001), `inventory_items` (0004; 0007 job BOM FK dropped with 0013), `client_inventory_items` (0017; 0022, 0025, 0030, 0035, 0055, 0071).
- **RPC**: none specific (RLS).
- **Status**: `tenants`/`inventory_items`/`/inventory` = **legacy** (docs/audit-history/FINDINGS.md 3–4; kept hidden from public nav, reachable from the admin nav "inventory" link `components/dashboard/admin-nav-groups.ts`). `client_inventory_items` / `/my-inventory` = active (5 `.from("inventory_items")` vs 17 `.from("client_inventory_items")` uses).

### 2.17 Videos & YouTube integration
- **P**: videos shown on home / how-it-works / design pages via `components/feature-video*.tsx`; admin `dashboard/store/youtube/page.tsx`.
- **API**: `/api/admin/youtube/{connect,callback,upload}` (super_admin, signed httpOnly state cookie), cron `/api/cron/youtube-retire`.
- **SA**: `dashboard/store/youtube/actions.ts` (saveYoutube, disconnectYoutube, queueRetireAction, cancelRetireAction, deleteRetireNowAction).
- **lib**: `lib/videos.ts` (7 slugs: idea-to-kit, file-to-part, sketch-to-drawing, wiring-check, cad-model, store-to-door, idea-to-product-ar; `videoJsonLd`), `lib/youtube.ts`, `lib/youtube-upload.ts`, `lib/youtube-retire.ts`, `lib/integrations/{crypto,youtube-server,youtube-retire}.ts` (AES-256-GCM refresh token), `lib/google/drive-picker.ts` (separate: Drive image picker). `scripts/{upload-video,make-video-placeholders,make-hero-poster}.mjs`, `scripts/record-videos/*` (ffmpeg/TTS tooling).
- **components**: `components/feature-video{,-client,-section}.tsx`, `components/admin/{videos-youtube,youtube-editor}.tsx`, `components/marketing/youtube-links.tsx`.
- **T**: `integrations` (0072, service role only), `store_settings.youtube` (0059), storage `videos` (public, 0049).
- **Env**: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (fallback id), `INTEGRATIONS_ENC_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; scripts: `FFMPEG`, `FFPROBE`, `FONT_DIR`.
- **Cron**: youtube-retire 07:00 UTC.
- **Status**: active. JSON-LD VideoObject emitted only when `published: true` (`lib/videos.ts`).

### 2.18 i18n
- **Files**: `i18n/routing.ts` (locales en/ar, default en), `i18n/request.ts` (loads `messages/<locale>.json`, ~292 KB en / ~393 KB ar), `i18n/navigation.ts`, `lib/i18n/{scopes,pick-messages}.ts` (+ `scopes.test.ts`), `components/i18n/messages-scope.tsx`, `components/language-switcher.tsx`, `components/ltr-isolate.tsx`, `lib/text/{bidi,count,title}.ts` (Arabic count agreement, direction isolation), `lib/parts/format.ts` (QAR formatting per locale), `lib/store/translate-details.ts` + `/api/admin/store-cleanup` step `translate` (Gemini Arabic names/details), `scripts/check-i18n-parity.mjs`, `scripts/make-og-ar.mjs`.
- **Rules**: AR uses Western digits (`ar-QA-u-nu-latn` per CLAUDE.md), no uppercase/letter-spacing in AR, `app/[locale]/layout.tsx` sets `dir`. Parity script must pass after any message change.
- **T/RPC/Env/Cron**: `parts.name_ar` / Arabic details (0047); none else.
- **Status**: active, cross-cutting.

### 2.19 SEO & metadata (sitemap, robots, OG images, JSON-LD, case studies)
- **Files**: `lib/seo.ts` (`pageMetadata`, canonical/hreflang, `sitemapEntries`, `robotsRules`, `SITEMAP_STATIC_PATHS`; `SITE_URL` hard-coded `https://gestaltung360.com`), `lib/meta.ts` (`metaFor`), `app/sitemap.ts` (revalidate 3600; published, non-merged parts via anon client + case studies), `app/robots.ts`, `app/manifest.ts`, `app/[locale]/opengraph-image.tsx` (+ `assets/og/ar-text.png`), `app/icon.svg`, `app/apple-icon.tsx`, `app/favicon.ico`, `lib/case-studies.ts` + `content/case-studies/*.md` (2 files, traced via `outputFileTracingIncludes`), pages `case-studies`, `case-studies/[slug]` (SSG), `lib/videos.ts` `videoJsonLd`, `lib/legal/{content,markdown}.ts`, `content/legal/*.md` (generated from `LEGAL_PAGES_DRAFT.md` by `scripts/split-legal-draft.mjs`; do not hand-edit), `components/legal/legal-document.tsx`, `lib/trust.ts`.
- **JSON-LD**: only `VideoObject` on `app/[locale]/page.tsx` and `app/[locale]/v2/page.tsx` (`dangerouslySetInnerHTML` with `<` escaped). No Product / Organization JSON-LD found by grep.
- **Other `dangerouslySetInnerHTML`** (8 per BASELINE): home + v2 JSON-LD, `schools/classes/[id]/sheet/page.tsx` (QR SVG), `components/studio/steps/wiring/SchematicFrame.tsx`, `components/prototyping/{svg-frame,schematics-stage}.tsx` (self-generated SVG).
- **Env**: `NEXT_PUBLIC_SITE_URL` (emails/recovery), `CHROME_PATH` (OG script).
- **Status**: active.

### 2.20 Analytics & consent (GA4, funnel events, demand signals)
- **Files**: `lib/analytics.ts` (`AnalyticsEvents` map: path_chosen, project_created, bom_generated, circuit_generated, cad_generated, add_to_cart, checkout_started, order_placed, phone_captured, pricing_viewed, kit_added, upsell_added, class_created, team_joined, class_parts_ordered, school_invoice_requested; `track()` no-ops without consent), `lib/analytics/consent.ts` (localStorage `gestaltung:cookie-consent` + cookie `gestaltung_consent`, 12 months), `components/cookie-notice.tsx` (adds gtag only after Accept; Google Signals / ad personalisation off), `components/analytics/{pricing-viewed,track-click}.tsx`, `app/[locale]/layout.tsx` (passes `NEXT_PUBLIC_GA_MEASUREMENT_ID`). Demand: `lib/store/demand-client.ts`, `components/parts/demand-beacon.tsx`, `/api/demand`, `record_demand`, `demand_signals`, `lib/store/restock.ts` weights; admin funnel card `components/dashboard/admin-overview.tsx`, `price_cohort_funnel` RPC.
- **T**: `demand_signals`, `sourcing_gaps`, `ai_usage`.
- **Env**: `NEXT_PUBLIC_GA_MEASUREMENT_ID`.
- **Status**: active; `track(` appears in 24 non-test files.

### 2.21 e2e fixtures & tests
- **Unit**: 232 `*.test.ts(x)` files colocated with sources (vitest `vitest.config.mts`); notable guards: `lib/middleware-matcher.test.ts`, `lib/table-scroll.test.ts`, `lib/i18n/scopes.test.ts`, `lib/notifications/kinds-sync.test.ts`, `lib/seo.test.ts`, `lib/store/catalog.test.ts`, `lib/schools/db/schools-migration.test.ts` (needs `@electric-sql/pglite`, not in package.json).
- **e2e**: 35 Playwright specs in `e2e/` (`playwright.config.ts`: `webServer: npm run start` with `E2E_FIXTURES=1`, reuses :3000; projects incl. `mobile-375`, `desktop`). `e2e/fixtures.ts` is a network write guard (aborts non-GET Supabase / `/auth/v1/*` writes / app `/api` writes because `.env.local` is production), `e2e/guard.spec.ts` tests it.
- **Fixture pages** (`app/[locale]/e2e-fixtures/*`, 8): `cad-cloud`, `dashboard`, `dashboard-fix`, `hero-poster`, `orders`, `quote-calc`, `studio`, `studio-request`; each calls `notFound()` unless `e2eFixturesEnabled()` (`lib/e2e-fixtures.ts`: `E2E_FIXTURES==="1" && !VERCEL && VERCEL_ENV!=="production"`). Server action `e2e-fixtures/quote-calc/actions.ts` (fixtureSaveQuote, fixtureSaveRule). Mock layers: `lib/studio/client/mock.ts`, `lib/studio/geometry/product-mock.ts`, `lib/studio/server/fake-supabase.ts`, `lib/studio/ai/fake-model.ts`, `lib/prototyping/plant-monitor.fixture.ts`.
- **Other test env**: `P517_SHOTS`, `STUDIO_PERF`, `STUDIO_PROFILE` (e2e only), `ROUTE_STRICT` (`lib/studio/wiring3d/route.test.ts`), `CI`.
- **Python**: `services/cad-worker/tests/` (pytest).
- **Status**: active.

---

## 3. DATA-FLOW notes

### 3a. Money path: cart → `/store/checkout` → `create_part_order` → emails → `/orders` and admin
Steps in order (browser side marked B, server S, database D):
1. B `components/parts/add-to-cart-button.tsx` / `part-detail-cart.tsx` → `useCart().addItem` in `components/parts/cart-provider.tsx`. `ensureSession()` (`lib/supabase/guest.ts`, anonymous `signInAnonymously`, Turnstile token if `store_settings.turnstile` on) gives a `user_id`; the line is inserted into **`cart_items`** (0016; RLS on `user_id`; optional `project_id`, `bom_lines`, `kit_id`). Kit adds share one `kit_id` (`project_kits`, 0025). Legacy `localStorage` cart (`lib/parts/cart.ts`) is migrated once. `trackDemand()` → `POST /api/demand` → `record_demand`.
2. B `/store/cart` → `/store/checkout` (`app/[locale]/store/checkout/page.tsx` server: redirects empty cart; mounts `checkout-client.tsx`).
3. B `checkout-client.tsx`: `useDeliveryQuote()` (`lib/store/use-delivery-quote.ts`) → RPC **`order_delivery_quote`** (0029/0044/0054; or **`class_order_delivery_quote`** 0097 when `?class=`) → tier dates; `shippingFor()` (`lib/store/shipping.ts`), `lib/store/delivery.ts`; `useCreditSummary()` → RPC `credit_summary`; validation `validateCheckoutEmail` / `isValidPhone` (`lib/store/checkout.ts`, `lib/phone.ts`); `track("checkout_started")`.
4. B on submit: `supabase.rpc("create_part_order", {...})` (browser anon/authenticated client; prices never sent, only `part_id`, `quantity`, `project_id`, `bom_lines`, `kit_id`). Fallback retries on `PGRST202` for older schemas.
5. D **`create_part_order`** (latest 0097, SECURITY DEFINER, `search_path=''`): validates fields and payment method (`cash_on_delivery|fawran|bank_transfer`; bank transfer needs plausible email via `is_plausible_email`), class teacher check, `order_delivery_quote(p_items)`, reads `store_settings.kit_discount_pct`, **inserts `part_orders`**, then per item reads `parts` (`is_published`, `unit_price`, `lead_time_class`) and **inserts `part_order_items`** (price snapshot), writes `project_items` and marks `projects.bom.lines[].fulfilled` (not for class orders), computes kit discount, `free_shipping_applies()`, class Economy free delivery (`school_free_class_delivery()`), refuses total <= 0, **updates `part_orders.total_qar/discount_qar/shipping_qar`**, links `project_kits.order_id`. Trigger `part_order_items_own_stock` (0069) counts own stock down; trigger `part_orders_status_history` (0053) writes **`order_status_history`**.
6. B `redeem_credits(p_order)` (0042 body, window rules 0053): consumes up to N spent-credit ledger rows (`reason like 'spend:%'`, `redeemable_until > now()`, QAR 20 each, capped at goods subtotal), lowers `part_orders.total_qar`, sets `credit_discount_qar`, inserts audit row `redeemed:<order>` in **`credits_ledger`**.
7. B `set_order_payment_method` (0039; no-op after 0044) · B writes `sessionStorage[LAST_ORDER_KEY]` snapshot for the success page (guests cannot read their order back through RLS).
8. B `fetch("/api/orders/confirmation", {orderId, locale})` (fire and forget) → S `app/api/orders/confirmation/route.ts`: service client; only orders < 1 h old with `confirmation_emailed_at is null`; claims by `update … is null`; reads `part_order_items` + `parts.name_ar` + `store_settings.holidays`; `confirmationEmail()` (`lib/store/order-email.ts`) → `sendEmail()` (`lib/email.ts`) → Resend; resets the claim on failure.
9. B `track("order_placed")`, `clearCart()`, `router.push('/store/checkout/success?order=…')`.
10. Customer view: `app/[locale]/orders/page.tsx` and `orders/[id]/page.tsx` read `part_orders` / `part_order_items` / `order_status_history` through the cookie client (RLS: owner = `profile_id`), components `order-timeline.tsx`, `order-status-pill.tsx`.
11. Admin: `dashboard/store/orders/page.tsx` + `[id]/page.tsx` (`lib/admin/order-lines.ts`) → server action `dashboard/store/orders/actions.ts` (`advanceOrder`, `setOrderStatus`, `cancelOrder`) → RPC **`set_order_status`** (0053; validates transition, SQL twin of `lib/orders/status.ts`) → trigger `part_orders_status_history` + `part_orders_notify_status` → `notification_enqueue` → **`notification_outbox`** (`order_<status>`) → `after()` runs `drainOutbox()` (`lib/notifications/drain.ts`, service client; RPC `claim_notifications`, `mark_notification`) → template `lib/email/templates/order-status.ts` → Resend. Same drainer runs daily at `/api/cron/notifications`.
12. On `delivered`: trigger `part_orders_grant_credits` → credits (see 3b); email rating link → `/api/orders/rate` (HMAC `lib/orders/rating.ts`) → `record_order_rating` / `record_order_review` → `reviews` (0058) → `/dashboard/reviews` moderation.
13. Daily `/api/cron/delivery-promises` re-checks open orders' lead-time class vs sold-at class and emails date changes (`dateChangeEmail`, `reviewPromise`).

### 3b. Credits path (earn on delivered order, spend on AI call, 30-day window, edu grants, class team spends teacher's credits)
- **Earn, delivered order**: `set_order_status(..., 'delivered')` (or a direct UPDATE) → trigger `part_orders_grant_credits` (0042) → `grant_credits_for_order_internal` (0042; replaced 0090): `credits_ledger` +3 `wiring`, +1 `cad` with `reason 'purchase:<order>'` (unique partial index = once per order) and +`rewards.order_idea_tokens` (default 2) kind `idea` reason `reward:<order>`. Requires `part_orders.profile_id` (not null). Trigger `credits_ledger_notify` (0046) enqueues `credits_order_delivered`.
- **Earn, other**: `grantCredits` (`dashboard/credits/actions.ts`) → `admin_grant` (0088) → `admin_grant` ledger rows + `credits_admin_grant` email; `rewardPrint` (`dashboard/leads/actions.ts`) → `admin_reward_print` (0090, default 1 CAD credit per printed lead); `payment_settle` (0089) → `payment_apply_internal` grants ideation tokens / Maker Pass; welcome 5 ideation tokens on first `idea_token_status` (0088).
- **Edu grants**: trigger `on_auth_user_edu_credits` on `auth.users` (0074) → `edu_credit_grant(user, email)`: only if `is_edu_email` (TS twin `lib/credits/edu.ts`), email confirmed, not anonymous; one row in `edu_credit_grants` per account and per `edu_email_key`; ledger +2 `wiring`, +1 `cad`, reason `edu_grant` (0075 changed 1+1 to 2+1).
- **Spend on an AI call (wiring)**: route (`/api/netlist`, `/api/bom/electronics`, `/api/studio/wiring`) → `canUse(supabase,'wiring',projectId)` (`lib/credits/server.ts` → RPC `credit_can_use`, latest 0096) → model/deterministic build → only after success `spend()` → RPC `spend_credit` (latest 0096 v4): admin free; locks, `pg_advisory_xact_lock('credits:'||payer)`, inserts ledger −1 reason `spend:<project>` with `earned_at` = FIFO earn date (`credit_next_earned_at`, 0053) and `redeemable_until = earned_at + 30 days`; sets `projects.free_wiring_used` marker (fires `first_circuit` email). `parts list` (`bom` step) is free (rate-limited by `bom_rate_check`: anon 5/day per session and hashed IP, user 30/day, `AI_RATE_SALT`).
- **Spend, CAD**: `/api/cad`, `/api/studio/enclosure`, `/api/studio/product/unlock` → `canUse('cad')` → `cad_begin` (cost = `cad_tier_cost(tier)` 1/2/3, 0090) → `cad_set_code` → `cad_deliver` (spends; 1 credit = chosen design + up to 2 changes via `projects.cad_regens_remaining`) / `cad_fail` (no charge). `spend()` in TS only supports `wiring|cad` but is called for `wiring` only.
- **Spend, ideation tokens**: `/api/studio/spec` → `ideaStatus()` (RPC `idea_token_status`) → model → `ideaCharge()` (RPC `idea_token_charge`, tier multiplier 1/2/3, 1 token per N=5 edit turns, `IDEA_TURNS_PER_TOKEN`); product regenerations `/api/studio/product/design` charge `regenCost × tier` after the first free one; engineering STEP job costs `ENGINEERS_JOB_TOKENS` (10).
- **30-day window**: a `spend:*` ledger row can be redeemed once as QAR 20 off a later order (checkout step 6 above) while `redeemable_until > now()`; window counts from the credit's earn date, not the spend date (0053; TS mirror `lib/credits/redeem-window.ts`). Notification `discount_ready` is skipped as `expired` by `decide()` when the window passed.
- **Class team**: `class_teacher_of_project(p_project)` (0096) makes the teacher the payer; `ai_role_of(teacher)` decides the role; ledger rows are written for the teacher with `created_by` = the acting (anonymous) student; the project is exempt from the 3-active-project trigger (`projects_enforce_limit` v2, 0096). Students have no accounts.
- **Purchases**: `/api/billing/checkout` → `payment_create` (service client; amounts from `lib/billing/config.ts`) → user pays via Fawran with reference → `/api/billing/proof` stores to `payment-proofs`, Gemini vision reads receipt (`lib/billing/verify.ts` `checkReceipt`) → `payment_settle` auto-approves or marks "needs review" → `/dashboard/payments` → `admin_payment_review`.

### 3c. AI paths (route → provider → gate → where the charge happens)
| Route | Provider / call | Gate before the call | Charge / meter |
|---|---|---|---|
| `POST /api/analyse` | `lib/prototyping/providers/index.ts` by `ANALYSIS_PROVIDER`: Gemini (`gemini.ts` → `gemini-client.ts`) or rules reader (`rules.ts`) | session (401), guests need Turnstile when enforced (`checkTurnstile`), `bomRate` when metered, `quota` pause (`ProviderError('paused')`), identical-request fingerprint dedupe (`analysis_runs.request_hash`, 0099); no AI-consent check in this route (consent is checked by `studioRequest` for Studio routes) | no credit; `logUsage` → `log_ai_usage`; rows in `analysis_runs`/`ai_usage` |
| `POST /api/brief-chat` | Gemini via `validatedCall`/`callGemini` | session, `quota('gemini')` paused → 429 | metered as `analyse`; no credit |
| `POST /api/projects/name` | Gemini | session, RLS project, only while name is default | metered |
| `POST /api/transcribe` | Groq Whisper (`GROQ_WHISPER_MODEL`, fetch `GROQ_URL`) | session, body cap, daily guard (`lib/ai/limits.ts`) | metered (audio seconds) |
| `POST /api/bom/match` | none (deterministic `lib/prototyping/bom-match.ts`) | session + RLS | logs `sourcing_gaps`/`demand_signals` |
| `POST /api/bom/electronics` | Gemini (two calls, `electronics-gen.ts`) + rules | session, `bomRate` (daily limit), `canUse('wiring')` unless `listOnly` | `spend('wiring')` after success |
| `POST /api/netlist` | Gemini (`electronics-gen.ts`, zod `netlist-schema`, `crossValidate`, one retry) | session, `canUse('wiring')` | `spend('wiring')` after success |
| `POST /api/firmware`, `/api/studio/firmware` | Gemini JSON (`lib/prototyping/firmware.ts`) | session (+ AI consent for studio), `quota('gemini')` | free; metered (`logUsage`) |
| `POST /api/cad` | Gemini writes OpenSCAD (browser renders) or CadQuery → Cloud Run `services/cad-worker` (`lib/cad/cloud.ts`, WIF + optional `X-Cad-Worker-Token`) | session, `canUse('cad')`, `cad_begin` (cap of undelivered generations) | `cad_deliver` spends; `cad_fail` on error; `log_ai_usage` provider `cad-worker` |
| `POST /api/studio/spec` | Gemini JSON mode, temp 0.2, `tierModel()` (`TIER_MODEL_*`) | `studioRequest` (session, project RLS, AI consent), `ideaStatus` (402 `no_tokens`) | `ideaCharge` after the model answered; rule-answered turns free |
| `POST /api/studio/pick`, `/mech` | Gemini via `studioCall` (library-only parts) | `studioRequest` consent; pick uses `bomRate` | free |
| `POST /api/studio/enclosure` | Gemini | `studioRequest`, `canUse('cad')` | `cad_begin → cad_deliver` on first result |
| `POST /api/studio/wiring` | none (deterministic `buildWiring`) | `studioRequest`, `canUse('wiring')` | `spend('wiring')` after build |
| `POST /api/studio/product/design` | Gemini JSON (`product/ai/design.ts`); falls back to archetype defaults | `studioRequest`, guests: 3 designs / Qatar day per session and per hashed IP (`ai_rate_limits`), tokens for regenerations | `ideaCharge` for regens |
| `POST /api/studio/product/check` | Gemini vision (`product/ai/vision.ts`), 3 PNGs | `studioRequest` | metered `ai_usage` (studio/vision), no charge |
| `POST /api/studio/product/unlock` | none | `studioRequest`, `canUse('cad')` (guests get 403 `sign_in`) | `cad_begin → cad_set_code → cad_deliver` |
| `POST /api/billing/proof` | Gemini vision (`lib/billing/server.ts` via `validatedCall`, feature `billing`) | signed-in non-anonymous | none (it grants purchased tokens on pass) |
| `POST /api/admin/store-cleanup` (step `translate`, `translate_details`) | Gemini | `super_admin` | none |
Provider call plumbing: `lib/prototyping/ai-call.ts` `validatedCall` (zod validate, one retry, model fallback `GEMINI_FALLBACK_MODEL`, logs `ai_usage` + `analysis_runs`), `lib/ai/usage.ts` (`quota()`, `logUsage()`; limits in `lib/ai/limits.ts`, guard at `AI_GUARD_THRESHOLD`, default 0.8), prices `lib/ai/prices.ts` (USD cost estimate, override `AI_PRICES`).

---

## 4. Environment variables (all names found in `app lib components middleware.ts scripts i18n`, plus `e2e`/`playwright.config.ts`)

`NEXT_PUBLIC_*` values are inlined into the client bundle at build time. No `.env*` file exists in this checkout; values are not shown.

| Name | Scope | Read in | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | NEXT_PUBLIC | `lib/supabase/{client,server,middleware,service,public}.ts`, `middleware.ts`, `lib/auth/providers-server.ts`, `app/[locale]/page.tsx`, `v2/page.tsx`, `store/checkout/page.tsx`, `dashboard/store/youtube/page.tsx`, `api/store-lead`, `api/design-quote`, `api/admin/youtube/upload`, `components/feature-video{-client,-section}.tsx` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | NEXT_PUBLIC | same Supabase files + `middleware.ts` (site_v2 fetch), `api/store-lead`, `api/design-quote`, `store/checkout/page.tsx` | anon/publishable key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | `lib/supabase/service.ts`, `lib/credits/server.ts`, `lib/integrations/youtube-server.ts`, `lib/admin/project-export.ts` (config presence) | bypasses RLS; 28 server files via `createServiceClient()` |
| `NEXT_PUBLIC_SITE_URL` | NEXT_PUBLIC | `api/project-cad`, `api/design-quote`, `lib/projects/recovery.ts` (non-production only; production hard-codes `https://gestaltung360.com`), `lib/email/brand-layout.ts` | absolute links in mails |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | NEXT_PUBLIC | `app/[locale]/layout.tsx` → `CookieNotice` | GA4 id (script loads only after consent) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | NEXT_PUBLIC | `lib/turnstile.ts`, `components/turnstile.tsx`, `components/admin/safety-settings.tsx` | Cloudflare Turnstile widget key (build-time) |
| `TURNSTILE_SECRET_KEY` | server-only | `lib/turnstile.ts` | Turnstile `siteverify` secret (fail-closed when enforced) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_APP_ID` | NEXT_PUBLIC | `lib/google/drive-picker.ts` (client id also `lib/integrations/youtube-server.ts`) | Google Drive Picker for admin image import |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | server-only | `lib/integrations/youtube-server.ts` | YouTube OAuth (id falls back to the public one) |
| `INTEGRATIONS_ENC_KEY` | server-only | `lib/integrations/youtube-server.ts` | AES-256-GCM key for stored refresh token (`integrations`) |
| `RESEND_API_KEY` | server-only | `lib/email.ts`, `api/admin/notifications/test`, `lib/admin/project-export.ts` | send mail via Resend |
| `RESEND_FROM` | server-only | `lib/email.ts` | From header |
| `STORE_LEAD_EMAIL` | server-only | `lib/email.ts` (`OWNER_EMAIL`) | where owner alerts go |
| `CRON_SECRET` | server-only | 6 `api/cron/*/route.ts`, fallback in `lib/orders/rating.ts` | cron bearer auth; fallback HMAC secret |
| `ORDER_RATING_SECRET` | server-only | `lib/orders/rating.ts` (param `env`) | HMAC for rating / review links |
| `GEMINI_API_KEY` | server-only | `lib/prototyping/providers/gemini-client.ts`, `dashboard/usage/page.tsx`, `lib/admin/project-export.ts`, `scripts/record-videos/{tts,voice-clips}.mjs` | Gemini access |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | server-only | `lib/prototyping/providers/gemini-client.ts`, `lib/studio/tiers.ts` | default `gemini-3.5-flash-lite`, fallback `gemini-3.5-flash` |
| `ANALYSIS_PROVIDER` | server-only | `lib/prototyping/providers/index.ts` | `gemini` or `rules` |
| `TIER_MODEL_MAKER`, `TIER_MODEL_ENGINEER` | server-only | `lib/studio/tiers.ts` (`process.env[name]`) | model per Studio build tier |
| `IDEA_TURNS_PER_TOKEN` | server-only | `lib/studio/tiers.ts` | chat turns per ideation token (default 5) |
| `ENGINEERS_JOB_TOKENS` | server-only | `lib/engineering/config.ts` | tokens per STEP job (default 10) |
| `GROQ_API_KEY`, `GROQ_WHISPER_MODEL` | server-only | `api/transcribe`, `dashboard/usage/page.tsx`, `lib/admin/project-export.ts` | voice-to-text |
| `AI_LIMIT_GEMINI_REQUESTS`, `AI_LIMIT_GEMINI_TOKENS`, `AI_LIMIT_GROQ_REQUESTS`, `AI_LIMIT_GROQ_AUDIO_SECONDS`, `AI_GUARD_THRESHOLD` | server-only | `lib/ai/limits.ts` (`process.env[name]`) | free-tier ceilings and guard fraction |
| `AI_RESET_TZ_GEMINI`, `AI_RESET_TZ_GROQ` | server-only | `lib/ai/limits.ts` | quota reset time zones |
| `AI_PRICES` | server-only | `lib/ai/prices.ts` | JSON override of per-model USD prices |
| `AI_RATE_SALT` | server-only | `lib/credits/server.ts` (`ipHash`) | salt for hashed-IP rate limits |
| `MOUSER_API_KEY` | server-only | `lib/sourcing/adapters/mouser.ts` | Mouser Search API |
| `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET` | server-only | `lib/sourcing/adapters/digikey.ts` | DigiKey API v4 OAuth |
| `STORE_SHEET_CSV_URL` | server-only | `dashboard/store/import/page.tsx` | pre-fills the Google-Sheet import |
| `GCP_CAD_URL`, `GCP_WIF_PROVIDER`, `GCP_CAD_SA_EMAIL` | server-only | `lib/cad/cloud.ts` | Cloud Run worker URL, workload identity provider, service account |
| `GCP_CAD_SA_KEY` | server-only | `lib/cad/cloud.ts` | legacy service-account key path (WIF preferred) |
| `CAD_WORKER_TOKEN` | server-only | `lib/cad/cloud.ts` | optional `X-Cad-Worker-Token` header |
| `VERCEL_OIDC_TOKEN` | server-only (platform) | `lib/cad/cloud.ts` | OIDC token exchanged at Google STS |
| `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` | NEXT_PUBLIC | `lib/studio/geometry/persist.ts` | geometry cache key per deploy |
| `VERCEL_GIT_COMMIT_SHA` | server-only (platform) | `components/dashboard-footer.tsx` | build id in dashboard footer |
| `VERCEL`, `VERCEL_ENV` | server-only (platform) | `lib/e2e-fixtures.ts` | disable fixtures on Vercel |
| `E2E_FIXTURES` | server-only (test) | `lib/e2e-fixtures.ts`, `playwright.config.ts` | enables `/e2e-fixtures/*` and product mock |
| `EXPORT_DEV_OWNER` | server-only (dev) | `api/admin/{customers,projects}/[id]/export` (with `NODE_ENV!=='production'`) | dev bypass of export owner check |
| `NETLIST_TEST_BREAK` | server-only (dev) | `lib/prototyping/electronics-gen.ts` (non-production) | force a bad netlist in tests |
| `NODE_ENV` | server/client | export routes, site-v2-preview cookie `secure`, youtube connect cookie, `lib/projects/recovery.ts`, Studio viewers | standard |
| `CI`, `P517_SHOTS`, `STUDIO_PERF`, `STUDIO_PROFILE`, `ROUTE_STRICT` | test only | `playwright.config.ts`, `e2e/*.spec.ts`, `lib/studio/wiring3d/route.test.ts` | test toggles |
| `CHROME_PATH`, `FFMPEG`, `FFPROBE`, `FONT_DIR` | scripts only | `scripts/make-og-ar.mjs`, `scripts/record-videos/*` | local tooling paths |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | (documented, not read) | no `process.env` reference in code; contact number is `lib/company.ts` constant + `store_settings.contact_phone` | CLAUDE.md-era variable, stale |

---

## 5. API routes (62 under `app/api`; +1 outside, listed last). "Auth" is what the code does, not what it should do.

Legend: **S** = session via cookie client (`supabase.auth.getUser()`), guests allowed unless "non-anon"; **RLS** = project/order ownership enforced by Postgres policies on the cookie client; **admin** = profile role `super_admin` checked in route; **cron** = `Bearer CRON_SECRET`; **svc** = uses service-role client; **public** = no auth check.

| # | Route | Methods | Purpose | Auth as coded |
|---|---|---|---|---|
| 1 | `/api/admin/customers/[id]/export` | GET | One customer's data across tables as JSON | admin; svc; `EXPORT_DEV_OWNER` dev bypass |
| 2 | `/api/admin/drive-import` | POST | Copy picked Google Drive images into `product-images` (sharp) | admin (Drive token in request); maxDuration 60 |
| 3 | `/api/admin/notifications/test` | POST | Send a sample notification email to the admin | admin |
| 4 | `/api/admin/projects/[id]/export` | GET | Diagnostic JSON of one project | admin; svc; dev bypass |
| 5 | `/api/admin/site-v2-preview` | GET | Set/clear the `site_v2` preview cookie | admin (403 otherwise) |
| 6 | `/api/admin/sourcing-backup` | POST | DigiKey/Mouser backup products + datasheets | admin; 300 s |
| 7 | `/api/admin/starter-parts` | POST | One-off starter component set | admin; 300 s |
| 8 | `/api/admin/store-cleanup` | POST | Step runner: store clean-up, Gemini Arabic translation | admin; 300 s |
| 9 | `/api/admin/voltaat-import` | POST | Import Voltaat catalogue | admin; 300 s |
| 10 | `/api/admin/voltaat-sync` | POST | "Run now" Voltaat price sync | admin; svc; 300 s |
| 11 | `/api/admin/youtube/callback` | GET | OAuth return, stores encrypted refresh token | admin + signed state cookie |
| 12 | `/api/admin/youtube/connect` | GET | Start YouTube OAuth, set state cookie | admin |
| 13 | `/api/admin/youtube/upload` | POST | Upload a feature video + captions + thumbnail to YouTube | admin; 300 s |
| 14 | `/api/analyse` | POST | Brief analysis, NDJSON stream (Gemini or rules) | S (401); guests + Turnstile when enforced; `bomRate` |
| 15 | `/api/auth/callback` | GET | Email-link recovery/confirm + OAuth code exchange | public (code/token in URL); svc |
| 16 | `/api/auth/claim-guest` | POST | Move a guest's work to the signed-in account | same-origin check + guest access token in body; svc |
| 17 | `/api/billing/checkout` | POST | Open a Fawran payment for a token pack / Maker Pass | S non-anon |
| 18 | `/api/billing/proof` | POST | Attach Fawran proof; Gemini vision check; settle | S non-anon; 120 s |
| 19 | `/api/billing/service` | POST | Open a Fawran payment for an engineer service | S non-anon |
| 20 | `/api/bom/electronics` | POST | Build electronics BOM (+circuit) for a project | S + RLS; `bomRate`; `canUse/spend('wiring')`; 300 s |
| 21 | `/api/bom/match` | POST | Match a project's BOM to the store (deterministic) | S + RLS |
| 22 | `/api/brief-chat` | POST | "Help me describe it" brief chat | S; quota pause; 60 s |
| 23 | `/api/cad` | POST | Generate a 3D model (OpenSCAD browser / CadQuery cloud) | S; `canUse('cad')`; `cad_*` RPCs; 300 s |
| 24 | `/api/cron/anonymous-cleanup` | GET | Weekly guest-user cleanup (dry-run default) | cron (`isAuthorizedCron`); svc |
| 25 | `/api/cron/delivery-promises` | GET | Re-date open orders, email changes | cron (inline compare); svc |
| 26 | `/api/cron/notifications` | GET | Drain `notification_outbox` | cron (`isAuthorizedCron`); svc |
| 27 | `/api/cron/supplier-refresh` | GET | Mouser + DigiKey daily refresh | cron (inline); svc; 300 s |
| 28 | `/api/cron/voltaat-sync` | GET | Voltaat daily price sync | cron (inline); svc; 300 s |
| 29 | `/api/cron/youtube-retire` | GET | Retire outdated videos after grace period | cron (inline) |
| 30 | `/api/demand` | POST | Demand signals; "request this item" also emails owner | public (no Turnstile, no rate limit in code) |
| 31 | `/api/design-quote` | POST | Public quote request: `inquiries` row + owner mail + signed link | public; svc |
| 32 | `/api/engineering/jobs` | POST | Queue a STEP-file job (tokens) | S non-anon |
| 33 | `/api/engineering/jobs/[id]/cancel` | POST | Cancel a queued job (tokens back) | RLS via RPC `engineering_job_cancel` (no explicit user check in route) |
| 34 | `/api/engineering/jobs/[id]/return` | POST | Send back the user's edited STEP | RLS via RPC `engineering_job_return` |
| 35 | `/api/firmware` | POST | Starter Arduino/ESP32 sketch from project circuit | S + project; quota pause; 120 s |
| 36 | `/api/netlist` | POST | Redraw circuit (Gemini) | S + RLS; `canUse/spend('wiring')`; 240 s |
| 37 | `/api/notifications/unsubscribe` | GET, POST | Unsubscribe page / apply (incl. RFC 8058 one-click) | public, capability = token uuid; svc |
| 38 | `/api/orders/confirmation` | POST | Order confirmation email with promised dates | public gated by: order < 1 h old, not yet emailed; svc |
| 39 | `/api/orders/rate` | GET | One-tap rating from delivered email | public, HMAC token (`ratingSecret`); svc |
| 40 | `/api/orders/review` | POST, GET | Optional comment after rating | public, HMAC token; body capped; svc |
| 41 | `/api/project-cad` | POST | Notify owner that a CAD file was attached | S (401), path ownership check; svc |
| 42 | `/api/projects/claim` | POST | Open an emailed project link (`claim_project`) | S + recovery key |
| 43 | `/api/projects/name` | POST | Name a chat-created project (Gemini) | S + RLS; quota pause; 60 s |
| 44 | `/api/projects/recovery-email` | POST | Email a project link (`project_recovery_begin`) | S |
| 45 | `/api/store-lead` | POST | Single lead/contact/callback endpoint keyed by `source` | public + Turnstile when enforced (skipped if caller has a session); svc; Resend |
| 46 | `/api/store/search` | GET | Instant store search suggestions | public; in-memory rate limit per instance |
| 47 | `/api/studio/doc` | GET, PUT | Read / save the StudioDoc (optimistic version) | S + RLS |
| 48 | `/api/studio/enclosure` | POST | Enclosure look (AI) | `studioRequest` (S, consent); `canUse('cad')`; 120 s |
| 49 | `/api/studio/firmware` | POST | Studio starter firmware | `studioRequest`; quota; 120 s |
| 50 | `/api/studio/mech` | POST | Printable mechanical parts list | `studioRequest`; 120 s |
| 51 | `/api/studio/pick` | POST | Parts pick from the library (AI) | `studioRequest`; `bomRate`; 120 s |
| 52 | `/api/studio/product/check` | POST | Vision check of 3 renders | `studioRequest`; 90 s |
| 53 | `/api/studio/product/choose` | POST | Mark the chosen design | `studioRequest` |
| 54 | `/api/studio/product/design` | POST | Generate 1–3 product designs | `studioRequest`; guest limit 3/day; tokens; 120 s |
| 55 | `/api/studio/product/engineer` | GET | Raw product data for Engineer view | S + `isSuperAdmin` |
| 56 | `/api/studio/product/model` | GET | Product model after unlock | S; owner after `unlockedId`, or super_admin |
| 57 | `/api/studio/product/preview` | POST | Store the final product picture | `studioRequest`; service upload after owner check; 30 s |
| 58 | `/api/studio/product/unlock` | POST | "Create my CAD" (spends credit) | `studioRequest`; `canUse('cad')` |
| 59 | `/api/studio/spec` | POST | One idea-chat turn (tokens) | `studioRequest`; `ideaStatus/ideaCharge`; 120 s |
| 60 | `/api/studio/tokens` | GET | Ideation token line | S; first sight grants welcome tokens |
| 61 | `/api/studio/wiring` | POST | Circuit for chosen parts (deterministic) | `studioRequest`; `canUse/spend('wiring')`; 60 s |
| 62 | `/api/transcribe` | POST | Voice note to text (Groq) | S (guests count); quota pause; 4 MB cap per CLAUDE.md |
| (63) | `/[locale]/dashboard/engineering-jobs/[id]/snapshot` | GET | Download the job's StudioDoc snapshot | admin (403 otherwise) |

---

## 6. Things that look legacy or duplicated (pointers only; another reviewer judges)

**Legacy / retired but still present**
1. `tenants` + `inventory_items` + `/inventory*` + `components/inventory/{tenant-filter,item-form}.tsx` (FINDINGS 3–4) vs `client_inventory_items` + `/my-inventory`; admin nav still links `/inventory` (`components/dashboard/admin-nav-groups.ts`).
2. Jobs pipeline: migrations `0005`–`0010` create `jobs`/`job_*`; `0013_drop_jobs.sql` drops them; `supabase/exports/0013_jobs_export.json` remains; app redirects in `next.config.mjs` (`/design/jobs`, `/dashboard/jobs`).
3. v1 vs v2 pages: `app/[locale]/{page,how-it-works/page,design/page,store/page}.tsx` vs `app/[locale]/v2/*` + `components/marketing/v2.tsx` + `lib/site-v2*.ts` + `middleware.ts applySiteV2` + `/api/admin/site-v2-preview` + `store_settings.site_v2` (CLAUDE.md: flag ON in production since 2026-10-09; v1 cleanup pending, `docs/CUTOVER.md`).
4. Tables with no `.from()` call in app code: `project_claims` (0020, CLAUDE.md: retired), `project_materials` (0015, write-only), `store_category_rules` (0048, migration-time), `notification_prefs` and `edu_credit_grants` (touched only by SQL functions/triggers, so not necessarily dead).
5. `components/payment/home-trust.tsx` (no importer found by grep), `components/account-bar.tsx` and `lib/studio/cad-setting.ts` (knip unused, BASELINE.md). `lib/prototyping/providers/gemini.ts` is also listed unused by knip but is loaded by `loadProvider()` via `import(`./${name}`)` from `ANALYSIS_PROVIDER` (name checked against `^[a-z][a-z0-9-]{0,30}$`), so it is live.
6. `components/store-landing/` holds one file (`callback-form.tsx`); `components/payment/` and `components/payments/` are two directories.
7. `NEXT_PUBLIC_WHATSAPP_NUMBER` documented in CLAUDE.md, not read by code.
8. Price: `store_settings.ai_pricing` / `project_ai_charges` / `components/prototyping/payment-card.tsx` (per-call QAR, 0038 → 0050) alongside credits/tokens (0042/0088); plans in `pricing_plans` are display-only.
9. `lib/parts/cart.ts` localStorage cart (migration shim) beside `cart_items`; `legacy` branches in `checkout-client.tsx` (`PGRST202` fallbacks for pre-0029/0044/0097 DBs); several routes degrade when migrations are missing (`rpcMissing`, `run_0068`, `no_service_key`).
10. CSV supplier importer (`lib/sourcing/adapters/csv.ts`, `/dashboard/store/suppliers/import`) — CLAUDE.md says owner does not use CSV files; AliExpress/Alibaba supplier rows seeded in 0028 and ranked 70 in 0095.
11. `components/parts/stock-badge.tsx` still used in `dashboard/store/page.tsx` while the storefront uses `lead-time-badge.tsx` (CLAUDE.md: stock status never shown publicly).

**Duplicated or twin implementations**
12. Prototyping vs Studio twins: `lib/prototyping/netlist.ts` vs `lib/studio/netlist.ts`; `lib/prototyping/schematic.ts` vs `lib/studio/schematic.ts`; `lib/prototyping/firmware.ts` + `/api/firmware` vs `/api/studio/firmware`; `/api/netlist` + `/api/bom/electronics` vs `/api/studio/wiring`; `/api/cad` vs `/api/studio/enclosure` + `/api/studio/product/unlock` (all use `cad_*` RPCs); `lib/prototyping/footprints.ts` vs Studio library geometry.
13. SQL/TS twins that must stay identical (per CLAUDE.md and file headers): `add_working_days` ↔ `lib/store/working-days.ts`; `is_edu_email` ↔ `lib/credits/edu.ts`; `order_status_transition_ok` ↔ `lib/orders/status.ts`; `order_delivery_quote` ↔ `arrivesByDate`; `lib/pricing/defaults.ts` ↔ 0051; `school_pricing` defaults ↔ 0096; `redeem-window.ts` ↔ `spend_credit`; `cad-cost.ts` ↔ `cad_tier_cost`; `IDEATION.welcomeTokens` ↔ `idea_welcome_tokens()`.
14. `refresh_part_sourcing` redefined in 0028, 0095, 0098; `create_part_order` in 8 files (0011…0097); `spend_credit` in 4; `credit_can_use` in 3; `idea_token_*` in 0088 and 0089; `cad_begin/cad_deliver` in 0043 and 0090.
15. Two cron auth styles: `isAuthorizedCron` (anonymous-cleanup, notifications) vs inline `!== \`Bearer ${secret}\`` in the other four (non-constant-time compare).
16. File pairs with same stem: `lib/email.ts` + `lib/email/`; `lib/analytics.ts` + `lib/analytics/`; `lib/youtube*.ts` + `lib/integrations/youtube*.ts`; `lib/turnstile{,-client,-server}.ts`; `lib/contact-phone{,-server}.ts`.
17. Lead/email endpoints with similar bodies: `/api/store-lead`, `/api/design-quote`, `/api/demand`, `/api/project-cad` (each builds an owner mail through `lib/email/lead-email.ts`); BASELINE.md jscpd lists 88 clones.
18. Studio `ProductSpec` / `product/schema.ts` and `schema.ts` import each other (madge cycles in BASELINE.md); `StudioShell` ↔ steps ×13.

**Rule or access patterns worth a second look (not judged here)**
19. Writes to `store_settings`/`suppliers` without `revalidateStorefront()`: `dashboard/store/restock/actions.ts` (`saveRestockWeights`, `saveSupplierMinimum`), `dashboard/engineering-jobs/actions.ts` (`saveServicePrices`). Whether the storefront reads those keys is unverified.
20. `dashboard/contact/page.tsx` has no role check (only the action does); `dashboard/overview` redirects. `/api/engineering/jobs/[id]/{cancel,return}` rely entirely on RPC checks. `/api/demand` "request" path and `/api/design-quote` have no Turnstile/rate-limit in route code (CLAUDE.md lists which endpoints are Turnstile-checked).
21. `next.config.mjs` defines no `headers()`; no CSP / security headers in repo (docs/audit-history/SECURITY_REVIEW.md Medium item).
22. In-memory rate limiter `lib/rate-limit.ts` is per instance (used by `/api/store/search`).
23. Service-role client files (28): `app/[locale]/dashboard/{customers/[id],customers,leads,projects}/page.tsx`, `dashboard/store/orders/actions.ts`, `projects/[id]/engineering/page.tsx`, `app/api/admin/{customers/[id]/export,projects/[id]/export,voltaat-sync}`, `app/api/auth/{callback,claim-guest}`, `app/api/cron/{anonymous-cleanup,delivery-promises,notifications,supplier-refresh,voltaat-sync}`, `app/api/{design-quote,notifications/unsubscribe,orders/confirmation,orders/rate,orders/review,project-cad,store-lead}`, `lib/{billing,engineering,services}/server.ts`, `lib/integrations/youtube-server.ts`, `lib/studio/server/product.ts`.
24. Migration state is not recorded in the repo: headers 0069, 0094, 0095, 0098 say "NOT RUN YET"; code depends on 0069 (`in_own_stock`), 0095 (`suppliers.rank`), 0098. No `supabase_migrations` tracking, so production schema level is **unverified**.
25. Count mismatches vs the brief: 104 `page.tsx` (not 100), 15 studio API routes (not 17), plus one non-`app/api` route handler (§5 #63).

---

## 7. Appendix: migration index (86 files; numbering gaps 0063, 0065, 0077–0087; migrations are hand-run, none tracked in the repo)

| File | Content (from its header) |
|---|---|
| `0001_auth_roles_rls.sql` | Gestaltung — Stage 4: Auth, roles, and multi-tenant Row Level Security |
| `0002_inquiries.sql` | Gestaltung — Stage 4 follow-up: public contact inquiries |
| `0003_profiles_phone.sql` | Gestaltung — Stage 4 follow-up: store a phone number on each profile |
| `0004_inventory_items.sql` | Gestaltung — Stage 5: Multi-tenant inventory |
| `0005_jobs.sql` | Gestaltung — Stage 6a: CAD upload + job creation |
| `0006_job_workflow.sql` | Gestaltung — Stage 6b: workshop dispatch + job status workflow |
| `0007_internal_jobs.sql` | Gestaltung — Stage 7: workshop internal jobs + BOM + inventory deduction |
| `0008_job_variations.sql` | Gestaltung — Stage 7b: job variations (edit/change trail) |
| `0009_security_hardening.sql` | Gestaltung — Stage 8a: security hardening (from SECURITY_REVIEW.md) |
| `0010_job_upsells.sql` | job upsells (jobs era; dropped with the jobs tables by 0013) |
| `0011_parts_store.sql` | Gestaltung — Parts Store (e-commerce module) |
| `0012_quote_uploads.sql` | Gestaltung — Store-first follow-up: public "request a quote" file uploads |
| `0013_drop_jobs.sql` | retire the jobs pipeline |
| `0014_harden_guest_orders.sql` | close the guest order-forgery hole |
| `0015_projects.sql` | projects, the client workspace |
| `0016_cart_items.sql` | the cart moves to the database, and learns about projects |
| `0017_client_inventory.sql` | a personal inventory for signed-in clients |
| `0018_project_files.sql` | CAD files attached to a project |
| `0019_project_item_allocation.sql` | where each part on a project came from |
| `0020_prototyping.sql` | prototyping |
| `0021_prototyping_disciplines.sql` | prototyping disciplines |
| `0022_prototyping_spec_and_sources.sql` | prototyping spec sheet + part sources |
| `0023_bom_netlist_drawings_usage.sql` | bill of materials, netlist, part dimensions, AI metering |
| `0024_project_diagnostics.sql` | project diagnostics — raw analysis runs + event log |
| `0025_electronics_attributes_kits.sql` | electronics build route, product attributes, project kits |
| `0026_electronics_feature.sql` | record the electronics builder's model calls |
| `0027_bought_units_are_owned.sql` | units bought for a project are owned, not "to buy" |
| `0028_suppliers_and_offers.sql` | suppliers, supplier offers, pricing modes (Part 4, Task 16) |
| `0029_intake_demand_delivery.sql` | image intake, demand capture, honest delivery dates |
| `0030_merge_duplicate_parts.sql` | merge duplicate store products, normalise material (backups in header comments) |
| `0031_is_test_flag.sql` | is_test flag (SITE_AUDIT #7) |
| `0032_on_request_checkout.sql` | "available on request" items can be checked out |
| `0033_order_links_and_delete_fix.sql` | projects can be deleted again; brief backfill |
| `0034_checkout_quantity_fix.sql` | checkout no longer doubles a project line's quantity |
| `0035_delete_project.sql` | delete a project in one transaction (SITE_AUDIT #18) |
| `0036_voltaat_sync.sql` | Voltaat price sync (Part 4, Task 19g) |
| `0037_restock.sql` | restock dashboard (Part 4, Task 20) |
| `0038_ai_pricing.sql` | AI generation pricing, payment-ready (2026-09-28) |
| `0039_payment_method.sql` | how the customer will pay (2026-09-29) |
| `0040_firmware.sql` | generated firmware on a project (owner, 2026-09-29) |
| `0041_datasheets_and_backups.sql` | datasheets, specs and backup products (owner, 2026-09-29) |
| `0042_ai_credits.sql` | AI access, usage counting and credits (2026-10-01) |
| `0043_cad_generations.sql` | CAD generations (2026-10-02) |
| `0044_shipping_flat_free_threshold.sql` | flat QAR 50 shipping, free Standard delivery over a threshold, bank-transfer email rule, no zero-total orders |
| `0045_project_recovery_link.sql` | project link by email: recovery_token, project_recovery_begin, claim_project |
| `0046_notification_outbox.sql` | notification outbox for credit and milestone emails |
| `0047_parts_arabic_details.sql` | Arabic product descriptions and spec tables |
| `0048_store_categories.sql` | nine storefront categories (parts.store_category) |
| `0049_videos_bucket.sql` | public `videos` bucket for the self-hosted feature clips |
| `0050_one_ai_price.sql` | one AI price (P0-05, 2026-10-08) |
| `0051_pricing_settings.sql` | plans and service prices as data (P1-06 / P1-07, 2026-10-09) |
| `0052_no_free_circuit.sql` | no free circuit (owner decision, 2026-10-09) |
| `0053_order_status_history.sql` | order status history, status emails (outbox kinds), one-tap rating, credit earned-date window |
| `0054_working_days.sql` | Qatar working days in delivery promises; part_public_source |
| `0055_turnstile_and_cleanup.sql` | Turnstile switch + anonymous-user cleanup |
| `0056_phase3.sql` | Phase 3 settings (site_v2 flag + occasions) |
| `0057_co_purchased.sql` | "Frequently bought together" (co-purchased products) |
| `0058_reviews.sql` | customer reviews (score + short comment, moderated) |
| `0059_youtube.sql` | YouTube links (P4-05, WF-36) |
| `0060_price_experiment.sql` | credit-price experiment (invite codes → quoted price) |
| `0061_price_funnel_fix.sql` | price funnel fix (price_cohort_funnel) |
| `0062_edm_price_drawing_uploads.sql` | EDM "from" price + 20 MB drawing-request uploads |
| `0064_normalise_phones.sql` | normalise stored phone numbers (header: NOT RUN, owner runs it) |
| `0066_qatar_holidays.sql` | Qatar public holidays 2026–2027 (editable defaults) |
| `0067_cad_engine.sql` | CAD engine switch (2026-10-10) |
| `0068_design_studio.sql` | Design Studio document on a project (2026-10-10, P5-13) |
| `0069_own_stock.sql` | own stock ("In stock in Lusail") (P5-12, 2026-10-10) |
| `0070_studio_parts.sql` | Design Studio part library in the database (P5-15c, 2026-10-11) |
| `0071_claim_guest_work.sql` | claim_guest_work: keep a guest's work on sign-in to an existing account |
| `0072_integrations.sql` | third-party integrations (D6 Videos & YouTube, 2026-10-11) |
| `0073_quote_calculation.sql` | the Studio quote calculation, the owner's quote, and the |
| `0074_edu_credits.sql` | educational-email credits (is_edu_email, edu_credit_grant, auth.users trigger) |
| `0075_edu_credits_two_wiring.sql` | educational-email grant = 2 wiring credits + 1 CAD credit |
| `0076_social_sign_in_profiles.sql` | profiles for social sign-in (Google, Apple, Microsoft) |
| `0088_ideation_tokens.sql` | ideation tokens + per-call AI cost (owner, 2026-10-18). |
| `0089_payments_maker_pass.sql` | token packs, the optional Maker Pass, auto-verified Fawran payments |
| `0090_cad_cost_rewards.sql` | CAD credits scaled by complexity + loyalty rewards (owner, 2026-10-18). |
| `0091_engineering_jobs.sql` | engineering jobs queue (owner, 2026-10-18). Run after 0090. |
| `0092_engineer_services.sql` | paid engineer services (owner, 2026-10-18). Run after 0091. |
| `0093_function_search_path.sql` | pin search_path on the last three functions (owner, 2026-10-18). Run after 0092. |
| `0094_fx_rate_372.sql` | USD is 3.72 QAR, not 3.64 (owner, 2026-10-19) |
| `0095_supplier_rank.sql` | suppliers have a running order (owner, 2026-10-19) |
| `0096_school_classes.sql` | school classes / teams / comments; credit_can_use + spend_credit v4 (teacher pays); projects_enforce_limit v2; join codes |
| `0097_class_order.sql` | class parts order: create_part_order (10 args), class_order_delivery_quote, part_orders.class_id |
| `0098_commission_floor.sql` | a commission has its own floor (owner, 2026-10-20) |
| `0099_analysis_request_hash.sql` | remember which request each analysis answered |

Tables created per migration (from `create table`): 0001 profiles, tenants · 0002 inquiries · 0004 inventory_items · 0005 jobs, job_files · 0006 job_events · 0007 job_bom · 0008 job_variations · 0011 parts, part_orders, part_order_items · 0015 projects, project_blocks, project_items, project_materials · 0016 cart_items · 0017 client_inventory_items · 0018 project_files · 0020 project_parts, project_claims, project_schematics, project_schematic_revisions · 0023 ai_usage, sourcing_gaps · 0024 analysis_runs, project_events · 0025 project_kits, store_settings · 0028 suppliers, supplier_offers · 0029 demand_signals · 0036 supplier_sync_runs · 0037 restock_receipts · 0042 credits_ledger, ai_rate_limits · 0043 cad_generations · 0046 notification_outbox, notification_prefs · 0048 store_category_rules · 0053 order_status_history · 0055 cleanup_runs · 0058 reviews · 0069 own_stock · 0070 studio_parts · 0072 integrations · 0074 edu_credit_grants · 0088 idea_sessions · 0089 payments, idea_passes · 0091 engineering_jobs · 0096 school_classes, class_teams, class_team_comments. Dropped by 0013: jobs, job_files, job_events, job_bom, job_variations. Storage buckets: cad-files (0005), quote-uploads (0012), project-images (0015), product-images (0029), videos (0049), studio-models (0070), payment-proofs (0089), engineering-files (0091).
