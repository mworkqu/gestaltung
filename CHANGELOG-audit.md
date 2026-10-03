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

## Phase B — Copy, naming and jargon (2026-10-03)
- One name per path in nav, home, H1s, how-it-works, meta: Shop parts / Get a part made / Plan a product / My projects (EN + AR). "Plan a product" in the nav opens /projects/new.
- /projects/new: three explanation lines, new hint, "+974 5XXX XXXX" placeholder, optional email, "My projects" link, drawing-request wording for ?for=drawing.
- D6 (migration 0045, not run): projects.contact_email + recovery key; the project link is emailed once at creation; opening it in another browser moves a guest-owned project there (key rotates, signed-up owners never lose a project); storage policies follow the project owner.
- Dashboard for clients: "My orders" and "My projects" blocks; tenant/role info only for admin and workshop users.
- About rewritten for customers (founded 2026, Rafal Tower Lusail, Prusa MK4 / CNC / laser / electronics, partner workshops, WhatsApp CTA, no photo).
- Home, /design, /design/quote (inline validation, file marked optional), /design/drawing (single primary + secondary button, "See what the price includes" -> /warranty), /how-it-works (short hero, guest limits, WhatsApp CTA).
- Auth: new intro copy; forgot-password and reset-password pages plus /api/auth/callback (none existed).
- Sitewide metadata localized (Meta.siteTitle / siteDescription).
- Tests 325; i18n parity 2337/2337.
- Pending owner steps: run 0045 (after 0044); add https://gestaltung360.com/** to Supabase Auth redirect URLs.
- Known gap: there is no customer orders page; "My orders" shows the count and links to the store.

## Phase D — Trust, contact, footer, errors (2026-10-03)
- /contact: WhatsApp, phone, address (Rafal Tower, Lusail, Qatar), company details with C.R. 236988. Hours omitted (not supplied).
- Footer: contact block, payment badges (Cash on delivery, Fawran, Bank transfer; no card logos), policy and info links, C.R. line.
- /delivery-returns, /warranty, /terms, /privacy built verbatim from LEGAL_PAGES_DRAFT.md (EN + AR) via content/legal/*.md; `node scripts/split-legal-draft.mjs --check` proves the text matches the draft.
- Branded 404 (app/[locale]/not-found.tsx + catch-all route) with search, Store/Home links and WhatsApp.
- /projects empty state example + sign-in link; "not available" project page explains guest projects with Sign up / My projects.
- Guests (anonymous sessions) on /dashboard and /inventory are redirected to /projects (lib/auth/guest-redirect.ts, tested); header shows "Sign in" for guests. No RLS change.
- Arabic brand spelling unified to the owner's spelling in two site strings.
- Tests 385; i18n parity 2385/2385.

## Phase C — Store discovery (2026-10-03; C5 category consolidation awaits owner approval)
- /store: search box (?q=, debounced), sort (Relevance, Price low/high, Name A–Z), server-side filtering and paging; URL is the source of truth. Search matches name (EN/AR), SKU, category and material.
- Relevance ranking in lib/store/search.ts (title match first, then category weight, accessory penalty); "esp32" lists boards before jumper wires. Unit tested.
- Empty search state: "We don't have "{q}" yet…" with "Request this item" (pre-filled, emails the owner) and "Clear search", plus WhatsApp number.
- Filter renamed "Delivery time" (3–5 days / 1–2 weeks / 2–4 weeks); "In stock" option dropped; "Clear filters" in both locales from one rule.
- Cards and product page: "Arrives by {date}" (lib/store/delivery.ts arrivesByDate, same formula as the SQL quote), SKU codes hidden (kept in URLs, admin, order email), "Min. order: N" only when N > 1, "Request this item" only for on-request items, "Save to a project" tooltip, "Added — View cart", title once, dead "3D Model" text removed (real links only).
- Store list sends cards only the fields they need (StoreCardPart) through a cookie-free client (lib/supabase/public.ts).
- Tests 500; i18n parity 2424/2424.

## Phase I — Credit and milestone emails (2026-10-03)
- Migration 0046 (not run): notification_outbox (unique on user, kind, payload ref), notification_prefs (unsubscribe token), triggers on credits_ledger and projects, claim_notifications() with row locking, store_settings.notifications per-kind switch.
- Kinds: credits_order_delivered, credits_admin_grant, first_project, first_circuit, discount_ready (built but switched OFF: 0042 dates the QAR 20 redemption from the day the credit is spent, and the ledger cannot tell when that credit was earned).
- /api/cron/notifications (Bearer CRON_SECRET) drains up to 50 rows, sends through Resend with List-Unsubscribe and an idempotency key; /api/notifications/unsubscribe (GET confirm page, POST one-click).
- Cron schedule in vercel.json is DAILY (04:30 UTC), not every 15 minutes: the existing crons are all daily, which points to the Vercel Hobby plan, where a */15 schedule blocks deploys. On a Pro plan change it to "*/15 * * * *".
- Templates in lib/email/templates (EN + AR, RTL, plain text + HTML, brand strip, unsubscribe footer).
- /dashboard/notifications (super admin): outbox table with status filter, "Send test to me".
- Guests without an email are stored as skipped (no_email).
- Tests 500 (templates in both languages, decide/skip rules, cron auth).
- Pending owner steps: run 0046 (after 0045); CRON_SECRET must be set in Vercel.

## Phase H — SEO and sharing (2026-10-03)
- lib/seo.ts: one helper gives every page canonical (absolute, per locale), hreflang (en, ar, x-default), Open Graph and Twitter summary_large_image; private pages are noindex. Titles normalised to "X | Gestaltung360".
- Default share image generated with next/og (app/[locale]/opengraph-image.tsx, nothing added to /public). The Arabic locale uses the same English card (no Arabic font available to the generator).
- Product pages: og:image from the product photo (width 1200), price in og:description, product:price tags.
- app/sitemap.ts (static pages + every published product, en and ar, hourly revalidate) and app/robots.ts (disallow /dashboard, /inventory, /api; Sitemap line). public/robots.txt removed.
- Tests: metadata shape, sitemap entries, robots rules.

## Phase E — Arabic (2026-10-03)
- Migration 0047 (not run): parts.specs_ar jsonb + details_ar_at (description_ar already existed). New admin step translate_details in /api/admin/store-cleanup with a control on Dashboard → Store → Sourcing overview (batched, resumable, idempotent, never automatic).
- /ar product page shows Arabic description and specs; when a product has none yet it hides the English supplier text and shows the Arabic headings with a note and a link to the English page (lib/store/product-details.ts).
- Latin part numbers and brand tokens isolated with <bdi dir="ltr"> in titles on cards, product H1, cart, checkout (components/ltr-isolate.tsx, lib/text/bidi.ts); Arabic card titles cut at 80 characters.
- "Sensor" unified to مستشعر and kits to مجموعات in messages and category labels (old words still work in search). Legal text untouched.
- Product count uses the owner's Arabic rule (3–10 منتجات, 11+ منتجًا) via lib/text/count.ts, because CLDR would give "107 منتجات".
- Arabic half of the order confirmation email: Arabic amounts, bank name, product names (name_ar), split-shipment wording; Arabic first for an Arabic checkout.
- Tests 580; i18n parity 2446/2446.
- Pending owner steps: run 0047 (after 0046), then Dashboard → Store → Sourcing overview → "Arabic descriptions and specs" → Translate (about 45–90 minutes, free Gemini tier).

## Phase F — Mobile (2026-10-03)
- /design on phones: the two path cards first, blueprint panel hidden below md, the "search first" box below the choices.
- /store on phones: 2-column compact cards, filters and sort in a "Filters" drawer (components/ui/sheet.tsx on native dialog, count badge, Clear filters, Show results), floating back-to-top after 600 px.
- 44 px tap targets: Tailwind utilities (tap-target, tap-target-y, tap-hit, tap-icon) applied to header controls, mobile menu, category pills, steppers, pagination, home links and chips; Button sizes grow to 44 px below md.
- Product images: square boxes with a light placeholder background and object-contain (cards, product gallery, cart thumbnails).
- Mobile menu labels fit one line; header at 375 px shows one language button and moves the credit chip into the menu.
- Checked in a browser at 375 px: no horizontal overflow on home, store, design, product, legal (EN and AR sample). No Playwright in the repo, so there is no automated overflow check.
## Phase G — Performance (2026-10-03)

### Before (live site, 2026-10-03 20:07 UTC)
Measured with `node scripts/measure-page.mjs https://gestaltung360.com /en /ar /en/store @first-product /en/store/cart` (static-HTML view: HTML + scripts + stylesheets + preloaded fonts + images found in the HTML; sizes are bytes on the wire where the server sends content-length, otherwise decoded; HTML wire size is a brotli estimate). Latest local commit when measured: b012173 (Phase E); the deployed commit could not be confirmed from the outside, so the live site may include earlier pushes from today.

| Page | HTML KB raw / wire (est.) | Inline JS KB (tags) | Own external JS KB (files) | Google gtag JS KB | CSS KB | Fonts KB (files) | Images KB (count) | Requests | Total KB | x-vercel-cache 1st / 2nd | cache-control (both requests) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| /en | 260.0 / 56.1 | 213.4 (55) | 818.1 (16) | 578.3 | 59.6 | 197.7 (6) | 174.7 (8) | 34 | 1884.6 | MISS / MISS | private, no-cache, no-store, max-age=0, must-revalidate |
| /ar | 310.9 / 62.8 | 261.4 (59) | 818.1 (16) | 578.3 | 59.6 | 197.7 (6) | 174.7 (8) | 34 | 1891.3 | MISS / MISS | private, no-cache, no-store, max-age=0, must-revalidate |
| /en/store | 382.2 / 57.7 | 270.4 (97) | 817.6 (16) | 578.3 | 59.6 | 197.7 (6) | 1185.5 (48) | 74 | 2896.3 | MISS / MISS | private, no-cache, no-store, max-age=0, must-revalidate |
| /en/store/VLT-31976620458086 (first product) | 188.0 / 47.6 | 165.4 (25) | 815.8 (16) | 578.3 | 59.6 | 197.7 (6) | 6.1 (1) | 27 | 1705.1 | MISS / MISS | private, no-cache, no-store, max-age=0, must-revalidate |
| /en/store/cart | 175.6 / 45.6 | 158.3 (27) | 843.6 (18) | 578.3 | 59.6 | 197.7 (6) | 0 (0) | 28 | 1724.8 | HIT / HIT (age 46, 47) | private, no-cache, no-store, max-age=0, must-revalidate |

Notes: every page is dynamic (no-store, MISS) except the cart shell; the cart row is a prerendered shell served from the edge. The six preloaded fonts are the same on /en and /ar: Outfit (1 file), JetBrains Mono (1) and four IBM Plex Sans Arabic weights (4 x about 33 KB). "Own external JS" is the unique script src plus modulepreload chunks of the page (the gtag file is listed separately).

### Before — Lighthouse (live, mobile preset, performance only, Edge 154 headless, Windows laptop, 2026-10-03 20:11 UTC; run warns the laptop CPU is slower than Lighthouse expects)
| Page | Score | FCP | LCP | CLS | TBT | Speed Index | Total transfer |
|---|---|---|---|---|---|---|---|
| /en | 55 | 3.4 s | 5.8 s | 0 | 440 ms | 7.0 s | 923 KiB |
| /en/store | 66 | 1.4 s | 4.8 s | 0 | 470 ms | 5.4 s | 1,124 KiB |

Lighthouse ran with `npx lighthouse` (13.5.0, fetched temporarily by npx, not added to the repo) against Microsoft Edge (CHROME_PATH), so no browser was downloaded. Network log of both runs: no non-2xx response, and `ga-audiences` plus `analytics.google.com/g/collect` fire on load without any consent.

### Done in part 1 (fonts, duplicate calls, console 404s, analytics)
- Fonts (app/[locale]/layout.tsx): Outfit and JetBrains Mono are now variable fonts with no weight list (one file per script instead of six/two weight rules); IBM Plex Sans Arabic loads weights 400 and 700 only (500 renders as 400, 600/800 as 700); only Outfit latin is preloaded, Mono and Arabic are `preload: false`. Before, every page preloaded six files (198 KB: Outfit, Mono and four Arabic weights, even on /en). Expected after: /en preloads one file (31 KB) and loads Mono (31 KB) when a mono label renders, about 63 KB; /ar loads two Arabic weights (67 KB) plus the Latin/digit subset of each (about 28 KB), about 95 KB, plus Mono (31 KB) where used. Preloading cannot differ per locale in a shared layout, so /ar no longer preloads its Arabic face (it loads when the CSS is parsed, `display: swap` with a size-adjusted fallback).
- Duplicate calls: one shared `<AuthProvider>` (components/auth/auth-provider.tsx) reads the session the browser holds (no request for a visitor without a session, no auth/v1/user for anyone) and feeds the header (header-nav, header-auth-link); `getCurrentUser()` (lib/supabase/guest.ts) now reads the session and shares one in-flight read, used by the cart, project list/workspace, add-to-project, new-project form, BOM table and my-inventory; `useCreditSummary()` shares ONE credit_summary request per user (lib/dedupe.ts `createSharedLoader`, 10 s TTL, `creditsChanged()` forces one refetch) and asks nothing when there is no session (guest sessions still ask, as before).
- Console 404s: `/favicon.ico`, `/apple-touch-icon.png` and `/apple-touch-icon-precomposed.png` returned 404 on the live site, and `/icon` and `/apple-icon` (generated icon routes) were locale-redirected by the middleware (307 to /en/icon). Added app/favicon.ico (1.8 KB, the existing 64 px mark wrapped as ICO), app/icon.svg (2.5 KB), app/apple-icon.tsx (generated 180 px), app/manifest.ts (/manifest.webmanifest), and the middleware matcher now skips `icon` and `apple-icon`. All internal links on /en, /ar and /en/store (130 hrefs, HTML and RSC prefetch) answer 200/3xx on the live site.
- Analytics (decision D7): gtag.js is no longer in the page. components/cookie-notice.tsx (EN/AR bar, Accept / Decline, 44 px buttons, link to /privacy) loads GA4 only after Accept, with `allow_google_signals: false`, `allow_ad_personalization_signals: false` and Consent Mode defaults denying ad storage/user data/personalisation, so no `ga-audiences` request. The choice is kept 12 months in localStorage and the first-party cookie `gestaltung_consent`; read on the client only. Rules and tests: lib/analytics/consent.ts, consent.test.ts. `@next/third-parties` is no longer imported (still listed in package.json).
- Tests: lib/dedupe.test.ts, lib/analytics/consent.test.ts. Messages: new `CookieNotice` namespace (en + ar).

### Done in part 2 (photos, caching, page data)
- Photos: one helper, lib/store/image-url.ts (`sizedImage(url, width)`, `sizedSrcSet`; tests in image-url.test.ts). It sets the Shopify CDN `width` param (drops `height`/`crop`), swaps our own `-web.webp` upload for its 400 px `-thumb.webp` in small slots, and leaves every other host alone; `ogProductImage` (lib/seo.ts) now uses it. Cards ask for 300/600 px (srcset + `sizes`), the product page for 600/1000 px, cart and BOM thumbnails for 140 px. Every product `<img>` has width/height; cards are `loading="lazy"` except the first four on the home page and on page 1 of /store (eager, `fetchPriority="high"`, which React also turns into an image preload). Plain `<img>`, no next/image (no Vercel image-optimisation quota used). Square boxes unchanged.
- Caching: see "Caching model" below. lib/cache/storefront.ts (tags, `revalidateStorefront()`), lib/store/public-catalog.ts (cached anon reads), app/[locale]/store/store-listing.tsx (shared list), app/[locale]/store/search/page.tsx (dynamic filtered list), next.config.mjs `rewrites()`, middleware.ts + lib/supabase/middleware.ts + lib/supabase/auth-cookie.ts.
- Page data: `NextIntlClientProvider` messages are scoped per route (lib/i18n/scopes.ts, lib/i18n/pick-messages.ts, components/i18n/messages-scope.tsx; guard test lib/i18n/scopes.test.ts walks the import graph of every page and layout). Message bytes in the page: full file 119 KB en / 164 KB ar before on every page; now site chrome 1.0 / 1.5 KB plus the page's scope (home 9.8 / 13.5 KB, /store and product 6.3 / 8.5 KB, cart 6.4 / 8.8 KB, checkout 15.7 / 21.9 KB, contact 1.2 / 1.6 KB). The dashboard, inventory, my-inventory and the prototyping workspace still get the full file (private, complex). Cards and the product page's cart button receive only `id`/`min_order_qty` (before, the home page passed whole `parts` rows, description included, into the client payload).
- `@next/third-parties` uninstalled (nothing imported it).

### Caching model (part 2)
What made the public pages dynamic, and the fix:
- `export const dynamic = "force-dynamic"` on the home page, /store, the product page, /design and /design/quote: removed. Home, /store and product pages now `export const revalidate = 300`; /design and /design/quote are fully static.
- Cookie-bound Supabase server client on the home page and the product page (and its `generateMetadata`): replaced by cached reads through the cookie-free anon client (lib/store/public-catalog.ts, `unstable_cache`, tag `parts`; shipping settings tag `store-settings`). The delivery quote (RPC `order_delivery_quote`) is computed at render time and cached 5 minutes with both tags.
- `searchParams` on /store: the default listing (no query params) no longer reads them and is ISR. A URL with any of `q, category, material, stock, sort, page` (`STORE_URL_PARAMS` in lib/store/catalog.ts) is rewritten in next.config.mjs (`beforeFiles`, one rule per param) to app/[locale]/store/search, which renders the same listing dynamically; the browser keeps /store?…; the filter bar always navigates to /store. The data of a filtered view is still cached per normalised query (`getStoreListing(state, locale)`), so only the HTML render is per request. catalog.test.ts fails if the two param lists drift.
- Product pages: `generateStaticParams` returns [] (nothing built at deploy), each product is rendered on its first visit per locale and then cached (ISR, 5 minutes). Unknown SKUs cache their 404 for 5 minutes too.
- Layouts above them: app/[locale]/layout.tsx, header and footer read no cookies/headers (header per-user parts are client components under `AuthProvider`). The cart and checkout-success layouts now call `setRequestLocale` (without it the new `MessagesScope` would have read request headers and turned the cart dynamic). i18n/request.ts reads no headers/cookies.
- Middleware: anonymous requests (no `sb-…-auth-token` cookie) skip Supabase entirely (no client, no `getUser()`, never a `Set-Cookie`). Requests with a session (signed-in user or guest) still run the refresh; a rotated token comes back as `Set-Cookie` on that one response. next-intl no longer writes `NEXT_LOCALE` on locale-prefixed pages (`localeCookie: false` for those); "/" and unprefixed paths keep the full routing, so the remembered language still decides where "/" redirects, and the language switcher writes the cookie in the browser. (Observation from the live site before this change: static pages already returned HIT even with the middleware's `NEXT_LOCALE` Set-Cookie, so the cookie was not what blocked caching; `force-dynamic` and cookie reads were.)
- Tags are revalidated (`revalidateStorefront()` = `revalidateTag("parts")` + `revalidateTag("store-settings")`) in every admin write to parts / supplier_offers / suppliers / store_settings: dashboard/store actions (create, update, delete, publish toggle, sheet import), attributes (incl. kit discount), overview (hide), quick entry, sourcing (offers, pin, pricing mode, suppliers, floor/FX, shipping settings), Voltaat map/switch, price-list import, supplier lookup (add, link, refresh); API routes admin/voltaat-import, admin/store-cleanup (all steps), admin/starter-parts, admin/sourcing-backup (not on preview), admin/voltaat-sync, cron/voltaat-sync, cron/supplier-refresh.
- Private routes unchanged and dynamic: dashboard, inventory, my-inventory, projects/*, checkout, sign-in/up, reset-password, API.

Build route table (`npm run build`, part 2): ● with `5m` revalidate: /en, /ar, /en/store, /ar/store. ● on-demand ISR (no prebuilt paths, revalidate 300): /[locale]/store/[sku]. ● static (no revalidate, built once per deploy): about, contact, how-it-works, design, design/drawing, design/quote, credits, delivery-returns, warranty, terms, privacy, store/cart, store/checkout/success, opengraph-image. Dynamic: /[locale]/store/search (by design), projects/[id], prototyping, [...rest] (404s), plus the force-dynamic private pages (Next lists those ● because of the locale layout's generateStaticParams, but they are absent from .next/prerender-manifest.json and answer `private, no-store`).

Local proof (`next start` on port 3100, each URL requested twice, no cookies): /en, /ar, /en/store, /ar/store: `x-nextjs-cache: HIT` both times, `cache-control: s-maxage=300, stale-while-revalidate=…`, no Set-Cookie. /en/store/VLT-31976620458086 and /ar/…: MISS then HIT, `s-maxage=300`, no Set-Cookie. /en/about, /en/contact, /en/how-it-works, /en/design, /en/design/drawing, /en/terms, /ar/privacy, /en/store/cart: HIT, `s-maxage=31536000`, no Set-Cookie. /en/store?q=esp32 and ?category=Sensors: rendered per request (`private, no-store`), correct results (8 products for esp32), URL unchanged. /en/sign-in: `private, no-store`. "/" → 307 /en with `NEXT_LOCALE` (root redirect only). In a browser: home search → /en/store?q=esp32, a category chip and "Clear filters" navigate client-side, the language switch from a filtered URL lands on /ar/store (the query was already dropped on switch before), no console errors on /en, /en/store, a product page, /ar/store/cart, /en/contact. Signed out, /en makes no Supabase request and loads nothing from Google before consent. Signed-in counts (one auth read, ≤ 1 `credit_summary`) were not re-measured here (no test login used); the code path is part 1's `AuthProvider` + shared loader.

**Still to confirm after deploy:** the second request to https://gestaltung360.com/en and /en/store (and /ar) must show `x-vercel-cache: HIT` (run `node scripts/measure-page.mjs https://gestaltung360.com /en /ar /en/store @first-product /en/store/cart`). Locally there is no x-vercel-cache header; `s-maxage` + no Set-Cookie on an anonymous request is the local proof.

### After (local production build, 2026-10-03 20:55 UTC)
`node scripts/measure-page.mjs http://localhost:3100 /en /ar /en/store /en/store/VLT-31976620458086 /en/store/cart` against `next start` (same probe as "Before"; HTML wire size is a brotli q5 estimate in both tables). Not like-for-like with the live "Before": no network latency, no CDN, and the local build emits no font preload (`.next/server/next-font-manifest.json` is empty here, so the probe counts no fonts; the fonts still load from the CSS). Supabase data is the live catalogue (.env.local).

| Page | HTML KB raw / wire (est.) | Inline JS KB (tags) | Own external JS KB (files) | Google gtag JS KB | CSS KB | Fonts KB (files) | Images KB (count; eager) | Requests | Total KB | cache-control (both requests) |
|---|---|---|---|---|---|---|---|---|---|---|
| /en | 141.5 / 18.2 | 85.4 (62) | 808.3 (15) | 0 | 56.7 | 0 (0, see note) | 129.5 (8; eager 71.0 / 4) | 26 | 1012.7 | s-maxage=300, stale-while-revalidate |
| /ar | 152.5 / 20.1 | 93.6 (62) | 808.3 (15) | 0 | 56.7 | 0 | 129.5 (8; eager 71.0 / 4) | 26 | 1014.6 | s-maxage=300, stale-while-revalidate |
| /en/store | 321.7 / 22.5 | 170.3 (175) | 813.2 (16) | 0 | 56.7 | 0 | 836.7 (48; eager 43.7 / 4) | 67 | 1729.1 | s-maxage=300, stale-while-revalidate |
| /en/store/VLT-31976620458086 | 71.0 / 12.9 | 46.9 (28) | 806.2 (15) | 0 | 56.7 | 0 | 6.1 (1) | 19 | 881.9 | s-maxage=300, stale-while-revalidate |
| /en/store/cart | 57.8 / 11.3 | 40.5 (29) | 834.0 (19) | 0 | 56.7 | 0 | 0 (0) | 22 | 902.0 | s-maxage=31536000 |

Before → after:
- HTML (raw / est. wire): /en 260.0 / 56.1 → 141.5 / 18.2 KB; /ar 310.9 / 62.8 → 152.5 / 20.1; /en/store 382.2 / 57.7 → 321.7 / 22.5; product 188.0 / 47.6 → 71.0 / 12.9; cart 175.6 / 45.6 → 57.8 / 11.3.
- Inline script: /en 213.4 → 85.4 KB (−60 %); /ar 261.4 → 93.6 (−64 %); /en/store 270.4 → 170.3 (−37 %; the rest is the RSC payload of 48 cards); product 165.4 → 46.9 (−72 %); cart 158.3 → 40.5 (−74 %).
- Own JS: 816–844 → 806–834 KB (about −10 KB; JS bundles were not in scope). Google gtag: 578 KB → 0 before consent (part 1).
- Images: /en 174.7 → 129.5 KB (8); /en/store 1185.5 → 836.7 KB (48; the probe picks the 600 w candidate a 2x phone would use; many Voltaat originals are already under 600 px, so they cannot shrink further); product page 6.1 KB unchanged (that photo's original is 225 px).
- Requests: /en 34 → 26, /en/store 74 → 67, product 27 → 19, cart 28 → 22 (gtag and font preloads gone).
- Cache: every public page was `private, no-cache, no-store` (MISS) except the cart; now `s-maxage=300` (home, /store, products) or `s-maxage=31536000` (static pages), no Set-Cookie for anonymous visitors. `x-vercel-cache: HIT` to be confirmed live after deploy.

### After — Lighthouse (local production build, mobile preset, performance only, Edge headless, 2026-10-03 20:57 UTC)
| Page | Score | FCP | LCP | CLS | TBT | Speed Index | Total transfer |
|---|---|---|---|---|---|---|---|
| /en | 87 | 1.9 s | 3.6 s | 0.009 | 110 ms | 1.9 s | 543 KiB |
| /en/store | 90 | 1.8 s | 3.4 s | 0 | 120 ms | 1.8 s | 806 KiB |

`npx lighthouse@13.5.0 http://localhost:3100/<page> --only-categories=performance` with `CHROME_PATH` = Microsoft Edge, as in "Before". Local server, so FCP/LCP are not comparable one-to-one with the live "Before" run (5.8 s / 4.8 s LCP); re-run against the live site after deploy for the real delta.

### Low-resolution supplier photos (content, not fixed in code)
`node scripts/find-low-res-photos.mjs` (new, read-only): reads published products with the anon key, takes Voltaat photo widths from Voltaat's public /products.json (7 requests, 5 s apart, the price-sync User-Agent) and reads the file header of the 40 photos on other hosts. Of 1,326 published products with a photo, 233 have an original narrower than 565 px (63 under 300 px, 68 at 300–449, 102 at 450–564); 193 of them are listed in the store. They look soft on the product page (shown up to ~600 px). Fix: upload a better photo in Dashboard → Store (quick entry) or ask the supplier.

Listed in the store (193), SKU (original width px), narrowest first: VLT-31855497019494 (170), VLT-39554870968422 (182), VLT-44671847498045 (220), VLT-32179899072614 (224), VLT-32179911524454 (224), VLT-31976620458086 (225), VLT-32061189062758 (225), VLT-32061680517222 (225), VLT-32180166983782 (225), VLT-32326362988646 (225), VLT-48283562606909 (225), VLT-32061247553638 (233), VLT-32061255123046 (233), VLT-31980145180774 (237), VLT-32326289129574 (238), VLT-31985522901094 (240), VLT-31985621794918 (240), VLT-32061146234982 (240), VLT-32061727932518 (240), VLT-32066279571558 (240), VLT-32326217400422 (240), VLT-39404717768806 (240), VLT-31976867659878 (241), VLT-31976965374054 (241), VLT-31980410208358 (241), VLT-31985445470310 (241), VLT-32033831551078 (241), VLT-32033919107174 (241), VLT-32061127557222 (241), VLT-32066225635430 (241), VLT-32066231763046 (241), VLT-32066251128934 (241), VLT-32066416640102 (241), VLT-32066424569958 (241), VLT-32066469888102 (241), VLT-32066471002214 (241), VLT-32066471592038 (241), VLT-32066932539494 (241), VLT-32326215991398 (241), VLT-32326298927206 (241), VLT-32326320357478 (241), VLT-32326320750694 (241), VLT-32326330843238 (241), VLT-32326348963942 (241), VLT-39550628986982 (241), VLT-39578527662182 (260), VLT-39396040540262 (273), VLT-39578527563878 (288), VLT-39539058114662 (293), VLT-12176385507430 (300), VLT-31994147897446 (300), VLT-39392246104166 (300), VLT-39884688523366 (300), VLT-44416228753725 (300), VLT-12191694520422 (310), VLT-39589256331366 (315), VLT-32179923124326 (340), VLT-29575612170342 (342), VLT-31985834492006 (342), VLT-32066234253414 (342), VLT-32325304615014 (342), VLT-39852386680934 (342), VLT-39419042070630 (346), VLT-31994146324582 (350), VLT-48735778013501 (350), VLT-48735861997885 (350), VLT-51336055980349 (350), VLT-39686633848934 (354), VLT-32233976004710 (355), VLT-32329011789926 (355), VLT-12686859370598 (358), VLT-45891062071613 (360), VLT-39386017005670 (361), VLT-12339562217574 (370), VLT-39404718030950 (384), VLT-39837939105894 (389), VLT-39605842051174 (398), VLT-39678091984998 (398), VLT-39678092017766 (398), VLT-12176547971174 (400), VLT-12326657589350 (400), VLT-12326661718118 (400), VLT-12689036476518 (400), VLT-12783144337510 (400), VLT-16289762672742 (400), VLT-31521933623398 (400), VLT-39246396784742 (400), VLT-39246401601638 (400), VLT-39528018477158 (400), VLT-44704065683773 (400), VLT-44704067322173 (400), VLT-48849434116413 (400), VLT-50223422931261 (400), VLT-50223716860221 (400), VLT-51355289289021 (400), VLT-39796269940838 (412), VLT-51449397051709 (417), VLT-31994281295974 (422), VLT-50195148702013 (424), VLT-12191003672678 (425), VLT-39675938832486 (425), VLT-39653308891238 (435), VLT-39532623659110 (436), VLT-39700050313318 (440), VLT-48195671785789 (444), VLT-39255808278630 (445), VLT-51969028948285 (447), VLT-12339538559078 (452), VLT-31476720795750 (452), VLT-39689578020966 (452), VLT-12176521494630 (458), VLT-39668141097062 (458), VLT-31855474049126 (459), VLT-44373609316669 (462), VLT-31214061060198 (468), VLT-44671870927165 (468), VLT-31946370285670 (475), VLT-44622497317181 (479), VLT-31239560953958 (480), VLT-39676481503334 (480), VLT-50642930270525 (480), VLT-39651673669734 (483), VLT-16267188895846 (495), VLT-12176536371302 (500), VLT-12176558194790 (500), VLT-12179009929318 (500), VLT-12179049349222 (500), VLT-12190998691942 (500), VLT-12191954698342 (500), VLT-12192015777894 (500), VLT-12326632751206 (500), VLT-12339535183974 (500), VLT-27880195063910 (500), VLT-27999611125862 (500), VLT-29218322055270 (500), VLT-29233432035430 (500), VLT-29489208655974 (500), VLT-31185376346214 (500), VLT-31503695315046 (500), VLT-32027686895718 (500), VLT-32066433843302 (500), VLT-32066440659046 (500), VLT-32145428185190 (500), VLT-32180136378470 (500), VLT-32268598411366 (500), VLT-32268608634982 (500), VLT-39261023764582 (500), VLT-39261038542950 (500), VLT-39392224837734 (500), VLT-39528514355302 (500), VLT-39535853437030 (500), VLT-39539027443814 (500), VLT-39563598364774 (500), VLT-39693050970214 (500), VLT-39693137248358 (500), VLT-39837940056166 (500), VLT-39838052810854 (500), VLT-39884682330214 (500), VLT-44704484327741 (500), VLT-44708497260861 (500), VLT-46646467854653 (500), VLT-46646471524669 (500), VLT-47477299216701 (500), VLT-48283121779005 (500), VLT-48690546868541 (500), VLT-48734877548861 (500), VLT-48839783579965 (500), VLT-49955416539453 (500), VLT-50053948834109 (500), VLT-50330957807933 (500), VLT-51346740248893 (500), VLT-51415734911293 (500), VLT-51637460894013 (500), DK-18551062ND (500), VLT-48378944291133 (503), VLT-32037174476902 (512), VLT-48697604145469 (512), VLT-39246388002918 (515), VLT-39246389772390 (515), VLT-39246398095462 (515), VLT-39686265700454 (515), VLT-12381594878054 (522), VLT-30471798489190 (524), VLT-48835170206013 (528), VLT-44955910439229 (536), VLT-39679645679718 (537), VLT-50195463307581 (549), VLT-48690625544509 (550), VLT-50494766514493 (557), VLT-51449211715901 (559), VLT-39796295499878 (560), VLT-51449212010813 (563), VLT-47221017248061 (564)

Published but not listed (no delivery date; page opens from old links) (40): VLT-32326331990118 (161), VLT-39539051888742 (162), VLT-32326379995238 (204), VLT-32179892125798 (225), VLT-32326330384486 (229), VLT-31976923824230 (240), VLT-31976932409446 (240), VLT-32033985265766 (240), VLT-32326389760102 (240), VLT-39658429382758 (240), VLT-32061719150694 (241), VLT-32066308866150 (241), VLT-39319215669350 (241), VLT-50962397462845 (295), VLT-51043546202429 (301), VLT-50053871075645 (305), VLT-49501724574013 (340), VLT-51361692221757 (383), VLT-44704070631741 (400), VLT-49889580581181 (400), VLT-50432148996413 (400), VLT-39653304762470 (416), VLT-48106995417405 (422), VLT-32037136236646 (425), VLT-44955870691645 (450), VLT-50741453783357 (468), VLT-39527972372582 (484), VLT-51499702288701 (491), VLT-32328956805222 (499), VLT-32066475982950 (500), VLT-32145432608870 (500), VLT-32327832371302 (500), VLT-48277319188797 (500), VLT-45857269940541 (509), VLT-51228716302653 (520), VLT-31980250464358 (522), VLT-39392839729254 (540), VLT-31214036058214 (552), VLT-51582432149821 (554), VLT-51809499709757 (560)
