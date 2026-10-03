# Site review fixes — Claude Code prompt

Paste this whole file into Claude Code in the Gestaltung repo (Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, next-intl, Supabase, Vercel). Source: UX/performance review of https://gestaltung360.com dated 2 Oct 2026. Do only what is listed. Do not scaffold anything else.

## 0. How to work (MANDATORY)

Use delegation defaults.
- Main session: orchestrate, decide, review, synthesise. Never run routine work on the top model.
- Subagents by tier:
  - **opus**: caching/ISR refactor, next-intl message scoping, checkout/shipping logic, every migration, the notification outbox and cron.
  - **sonnet**: standard implementation, copy changes across `messages/en.json` and `messages/ar.json`, tests, email templates.
  - **haiku**: mechanical find-and-replace of strings, file searches, format conversions.
  - Unsure between tiers: pick the cheaper one, escalate only if the result is inadequate.
- Every subagent prompt is self-contained: context, exact files, exact strings, constraints, expected output format.
- Launch independent subagents in parallel in one message.

Rules per phase:
1. One commit per phase. Before each commit: `npm run build` and `npm run test` green, and the EN/AR parity check at 100% (keep key counts identical in en.json and ar.json, e.g. 1683/1683 style).
2. After each phase print "How to test locally" steps.
3. Append a dated entry to `CLAUDE.md` PROGRESS and to `CHANGELOG-audit.md` after each phase.
4. Any new migration continues numbering (latest is 0043, so 0044+), is idempotent (`if not exists`, `create or replace`, `drop ... if exists`), has a dry-run comment block at the top, and is NOT run by you. Tell the owner to run it and wait.
5. Owner rules: never sign the owner up for paid services. The IBAN never appears on the site (email only). AI is free during launch. WhatsApp +974 6656 7410 is already public on /design/drawing.

## 1. Decisions

Before touching code, ask the owner ONE numbered question list containing the decisions below, each with its default. If he answers "defaults", use the bracketed value. Record the final answers in `CLAUDE.md` under "Site review decisions".

| # | Decision | Default |
|---|---|---|
| D1 | Shipping | Restore 50 QAR for all tiers (Economy/Standard/Express), handling 0, free delivery over QAR 300. Owner to confirm the threshold. |
| D2 | Handling fee | Remove (set 0 and hide the line when 0). |
| D3 | "Final price confirmed via WhatsApp" | Checkout total is binding. Replace the line (see A4). |
| D4 | SKU visibility | Hide "VLT-…" codes from customers (cards, product page, cart). Keep on admin pages. URLs keep working. |
| D5 | Guest (anonymous) sessions on /dashboard and /inventory | Redirect guests to /projects. Only signed-up users see them. |
| D6 | Phone-only identity | Explain in copy that projects stay in this browser, and add an optional email field on /projects/new so projects can be recovered on any device. |
| D7 | Analytics | Simple cookie notice (Accept / Decline). Remove the Google Signals / ga-audiences pixel. GA4 loads only after Accept. |
| D8 | Returns, warranty, terms, privacy | Owner supplies the text. Build the pages from his text. A "coming soon" placeholder is NOT acceptable. Ask for the text in this same question list and do not start Phase D pages until it arrives; do the rest of Phase D first. |
| D9 | Store scope | Keep all published products. |
| D10 | WhatsApp number | Publish +974 6656 7410 on Contact, footer, checkout, 404. |
| D11 | About page facts | Ask for 3 facts: (a) year/story of the studio, (b) machines list, (c) one photo path or "no photo". |
| D12 | Opening hours and full street address for Contact/footer | Ask. Until answered, show "Lusail, Qatar" and omit hours. |
| D13 | Category consolidation | Show the proposed mapping table (Phase C) and wait for approval before applying. |

## 2. Phase A — Money and checkout (review fixes #1, #2, #3, #7)

Context: live checkout shows Economy 50 / Standard 100 / Express 150 plus "Handling fee" QAR 5.00 on a QAR 78 order (total 183). Agreed on 2026-09-27: 50 QAR all tiers, handling 0. Settings live in `store_settings` (admin `/dashboard/store/suppliers`).

Tasks (opus for A1–A3, sonnet for the rest):
- **A1** Read the current `store_settings` shipping and handling values and the code that applies them. Add a migration (0044+, idempotent) that sets shipping per D1 and handling per D2, and adds a `free_shipping_threshold` key. Do not run it. Make the handling line render only when > 0. Free-shipping threshold applies to the goods subtotal; show "Free delivery" when met.
- **A2** Show delivery cost before checkout:
  - Product page: "Delivery from QAR {min}" beside the existing delivery-date line.
  - Cart: a shipping estimate line under the subtotal ("Delivery from QAR {min}, final at checkout"; "Free delivery" over the threshold), plus "Add QAR {n} more for free delivery" when within range.
  - Replace the cart line "Choose faster or cheaper shipping at checkout" with "Choose your delivery speed at checkout."
- **A3** `/store/checkout` with an empty cart: server-side redirect to `/store/cart` (locale-aware). Also disable "Place order" when total is 0 and reject a 0-total order in the API.
- **A4** Cart copy. Current: "Final price confirmed by our team via WhatsApp before payment." New EN: "This is your final price. We confirm your order on WhatsApp." AR: "هذا هو سعرك النهائي. نؤكد طلبك عبر واتساب."
- **A5** "Card payment … coming soon": show once, below the payment method list, not under each method.
- **A6** Fawran account name: keep "GESTALTUNG FOR TRD AND SERV" (the bank alias) and add beside it "(Gestaltung for Trading and Services W.L.L)". The IBAN stays off the site.
- **A7** Verify (and fix if wrong): when "Bank transfer" is chosen, the Email field label loses "(optional)", is marked required, validated client and server side, with the hint "We email you the bank details." Test AR too.
- **A8** Under "We confirm your payment on WhatsApp before we ship." add the number as a `wa.me/97466567410` link (D10).
- **A9** Delivery area "Other": add a hint "Outside Doha, Lusail, Al Wakra and the Industrial Area? We confirm if we can deliver on WhatsApp."
- **A10** Verify: add an item, close the browser, reopen; check the cart persists for a guest session. If lost, fix persistence (cart_items keyed to the anonymous user) and report.
- Tests: shipping calculation (tiers, threshold, handling 0), empty-cart redirect, bank-transfer email requirement.

## 3. Phase B — Copy, naming and jargon (fixes #4, #6, #11 and REPORT section 4)

One name per path, everywhere: nav (desktop and mobile menu), home cards and links, page H1s, `how-it-works`, breadcrumbs, `generateMetadata` titles and descriptions, buttons, footer. Haiku: grep every old string in `messages/*.json` and `app/`. Sonnet: apply. Do both EN and AR.

| Now | New EN | New AR |
|---|---|---|
| "Buy parts" / "Order parts" | Shop parts | تسوّق القطع |
| "Make my part" / "Design your own part" / "Or explore custom manufacturing" / "Upload a file to manufacture" | Get a part made | اصنع قطعتي |
| "Turn an idea into a product" / "Start a project" (idea tool) | Plan a product | خطّط لمنتج |
| "Your projects" (list) | My projects | مشاريعي |
| "Need help with drawing?" | No file? We'll draw it | ليس لديك ملف؟ نرسمه لك |
| "CAD", "STL · STEP · DXF · IGES" | 3D or drawing file (STL, STEP, DXF, IGES) | ملف ثلاثي الأبعاد أو رسم (STL, STEP, DXF, IGES) |
| "EDM" (quote form) | EDM (spark erosion for hard metals) | EDM (القطع بالشرارة للمعادن الصلبة) |
| "Single-body, no assembly" | One solid piece, e.g. a bracket | قطعة واحدة صلبة، مثل حامل |
| "Sign in to reach your Gestaltung dashboard." | Sign in to see your orders and projects. | سجّل الدخول لترى طلباتك ومشاريعك. |
| "New accounts start as clients." | (remove the line) | (remove) |
| "No password needed. Your projects are saved under this number on this device." | No account needed. Your project stays in this browser. We'll WhatsApp you only about this project. | (translate equivalently) |

Keep the word "project" only for the idea tool. Use "drawing request" for /projects/new?for=drawing (title, button "Send drawing request", intro) and "Save to a project" for the saved-parts group.

Further tasks:
- **B1** Nav "Plan a product" links to `/projects/new` (not `/projects`). Add "My projects" as a secondary link on the page itself.
- **B2** `/projects/new` explanation, three short lines above the form:
  1. "What happens next: you describe your idea and we help turn it into a design, a parts list and a quote."
  2. "Free to start. The AI circuit and CAD tools are free during launch; later runs use credits."
  3. "Why your number: we WhatsApp you only about this project."
  Add the optional email field per D6 with the hint "Add an email to open this project on any device." Add a country-code placeholder on the number ("+974 5XXX XXXX"). Title gets the brand: "Plan a product | Gestaltung360".
- **B3** Dashboard: remove "This is your account context, read live through row-level security. Role-specific dashboards arrive in a later stage.", the ROLE line and "TENANT / No tenant (platform-wide)" for clients. Replace the card with two blocks "My orders" and "My projects" (links, counts, empty states). Keep tenant/role info for admin and workshop users only.
- **B4** About page rewritten for customers. Remove "manufacturing marketplace and inventory platform", "multi-tenant inventory system…", "one bilingual dashboard", the "MODEL: Marketplace" chip. Structure: who we are (Gestaltung for Trading and Services W.L.L, C.R. 236988, Lusail studio), what we make (use D11 machines), how partner workshops fit, one photo if given, CTA to WhatsApp. EN and AR, short paragraphs. Ask for the D11 facts; do not invent them.
- **B5** Home: under the "Get a part made" card add "No file? We can draw it from your sketch" linking to `/design/drawing`. Under the callback form add "We call you back within one working day." Replace "Order at the listed price. Each product shows its delivery time." with "Each product shows its delivery date and delivery cost."
- **B6** `/design`: label the upload card "Upload a file → get a free quote". On `/design/quote` add under the title "Free quote. We reply within one working day." and mark required fields; keep "email or phone, at least one" but validate it inline on blur. Verify and fix behaviour when sent without a file (clear error, nothing silently lost).
- **B7** `/design/drawing`: add "What's included" (revisions count and file ownership: ask the owner, use "1 free revision; you own the files" as draft and flag it) and make "Start a drawing request" the primary button, "Chat on WhatsApp" secondary (single instance).
- **B8** `/how-it-works`: shorten the hero so it no longer repeats the home page; add the limits that apply to guests ("Circuits need a free account; later circuits use credits"); final CTA "Need help designing your part? Message us on WhatsApp".
- **B9** Sign-in/sign-up copy per the table; add benefits line on sign-up: "Keep your orders and projects on every device." Verify a "Forgot password?" link exists on sign-in (and the reset flow works); add if missing.

## 4. Phase C — Store discovery (fixes #5, #9)

- **C1** `/store`: search box (query param `q`, debounced, accessible label "Search parts") and sort select (Relevance, Price low to high, Price high to low, Name A–Z). Server-side filtering and pagination so the payload stays small.
- **C2** Relevance ranking: score title match first, then category weight so boards and modules rank above accessories (jumper wires, connectors, cables) for the same query. Example: "esp32" must show ESP32 boards before "2-pin jumper wire" and "laser module". Add a unit test with that query.
- **C3** Empty state. Replace "No parts found — No parts match your filters yet. Check back soon…" with: "We don't have "{q}" yet. Tell us what you need and we'll source it." Buttons: "Request this item" (opens the existing request flow with `{q}` pre-filled) and "Clear search". Keep the WhatsApp link with the number.
- **C4** Cards and product page:
  - Replace "In stock" with "Arrives by {date}" (use the delivery calculator already on the product page).
  - Delivery filter renamed "Delivery time", options by lead time only ("Any", "3–5 days", "1–2 weeks", "2–4 weeks"); drop the "In stock" option.
  - Hide "No minimum"; show "Min. order: N" only when N > 1.
  - "Request this item" only on on-request or out-of-stock items.
  - "Add to project" becomes "Save to a project" with a tooltip: "Collect parts for something you're building."
  - After "Add to Cart" the button shows "Added — View cart" linking to `/store/cart`.
  - Title appears once as H1; remove the repeated title in the content block (breadcrumb may keep it).
  - "Links • 3D Model": render as a real link if a URL exists, otherwise remove.
  - Apply D4 (hide VLT codes).
- **C5** Category pills: consolidate 16 to about 8. Produce a mapping table (old category to new category, with product counts) and show it to the owner for approval (D13) before applying. Proposed starting set: Boards and microcontrollers; Sensors; Modules; Chips and ICs; Power; Motors and mechanical; Cables and connectors; Tools and accessories. "Other" is not a category; unmapped items go to the nearest one and are listed for review. Implement the mapping as data (migration or config), not hard-coded in components.
- **C6** English store: show "Clear filters" when any filter is active (Arabic already has it).
- Tests: sort orders, ranking, empty state, min-order visibility.

## 5. Phase D — Trust, contact, footer, errors (fixes #8, #12)

- **D-1** `/contact`: add WhatsApp number (`wa.me` link), phone, address and hours (D12), C.R. 236988 and "Gestaltung for Trading and Services W.L.L" under "Company details", in EN and AR.
- **D-2** Footer on all pages: WhatsApp number, address, email info@gestaltung360.com, payment-method icons (Cash on delivery, Fawran, Bank transfer; no card logos while card is "coming soon"), links Delivery and returns, Terms, Privacy, How it works, About, Contact, and the C.R. line.
- **D-3** Pages `/delivery-returns`, `/terms`, `/privacy` created from the owner's text (D8), EN and AR, using the shared layout. If the owner has not yet supplied the text, stop this task, say so in the phase summary, and ship everything else.
- **D-4** Branded `app/[locale]/not-found.tsx` with header and footer, message, search box, links to Store and Home, WhatsApp link. Also make unknown product SKUs call `notFound()` so they use it.
- **D-5** `/projects` empty state: one example idea ("e.g. a handheld milk frother with a heater") and "Sign in to keep projects on every device".
- **D-6** Prototyping "not available" page: show the project name if it can be known, and add "Started as a guest? Projects live in the browser you started on. Sign up there to keep them on every device." with buttons "Sign up" and "My projects".
- **D-7** Guest sessions (D5): redirect anonymous-session users from `/dashboard` and `/inventory` to `/projects`. Make the header show "Sign in" consistently for guests (no mismatch). Tests: guest redirect, signed-in access unchanged, RLS untouched.
- **D-8** Sign-in: confirm forgot-password link (B9).

## 6. Phase E — Arabic (fix #10)

- **E1** Extend the existing Gemini translate step in `/api/admin/store-cleanup` (`{step:'translate'}`) to also translate product description and spec labels/values into new columns (migration 0044+: `description_ar`, `specs_ar jsonb`, idempotent). Batch in chunks, resumable, idempotent; do not run it automatically. Tell the owner to run the migration, then the step from the admin page. On `/ar`, show the Arabic fields; if a product has none yet, hide the English description and spec block and show only the Arabic headings with available data. Never show the raw English supplier text on `/ar`.
- **E2** Direction isolation: wrap Latin part numbers and brand/model tokens inside Arabic titles in `<bdi dir="ltr">` (or a small `<LtrIsolate>` component) on cards, the product H1, the cart and checkout, so "وBluetooth" no longer dangles. Shorten the Arabic title display to the first 80 characters on cards with CSS clamp.
- **E3** Unify sensor to مستشعر (replace حساس in messages and the category data). Kits: replace "الأطقم" with "مجموعات".
- **E4** Count plural: "107 منتجات" becomes "107 منتجًا" (use ICU plural rules in ar.json: 3–10 منتجات, 11+ منتجًا, 1 منتج واحد, 2 منتجان).
- **E5** Test the Arabic checkout, form errors and the confirmation email (not yet tested) and fix any English leftovers.

## 7. Phase F — Mobile (REPORT section 6)

- **F1** `/design` on phones: "Choose your path" cards first. The blueprint panel is hidden below `md` or collapsed to under 120 px; the "Maybe we already sell it — search first" box moves below the two choices.
- **F2** `/store` on phones: 2-column grid of compact cards; category and delivery filters in a "Filters" drawer (shadcn Sheet) with a count badge and "Clear filters"; floating back-to-top button after 600 px scroll.
- **F3** Minimum 44 px tap targets (category pills, quantity steppers, language toggle, cart icon, hamburger, pagination). Add a Tailwind utility and apply it; check the 26 small targets on the home page.
- **F4** Product images: fixed aspect ratio (`aspect-square`) with a light placeholder background, so lazy images do not shift the layout.
- **F5** Mobile menu: use the short names from Phase B so labels fit one line.
- **F6** Keep: no horizontal overflow at 375 px on any page (add a Playwright or script check if test tooling exists).

## 8. Phase G — Performance (REPORT section 7, ranked)

Log before and after numbers (HTML KB, inline script KB, JS KB, image KB, requests, `x-vercel-cache`) for `/en`, `/en/store`, a product page and `/en/store/cart` in `CHANGELOG-audit.md`. Run Lighthouse locally (`npx lighthouse` against a production build) if possible and record LCP and CLS, since the review could not.

1. **Photos (S).** Shopify images come as `?width=1000`. Use `?width=600` for cards and `?width=140` for cart thumbnails, or `next/image` with `remotePatterns` for `cdn.shopify.com`, `sizes`, `width`/`height`. `priority` only for the first 4 home images. Cards use `loading="lazy"` otherwise.
2. **Caching (opus).** `export const revalidate = 300` (or `unstable_cache` with a tag) for `/`, `/store`, product pages and marketing pages, per locale. Remove anything that reads cookies/headers in those server components. Move cart badge, credits, auth state to client fetches. Tag-revalidate when the admin edits products or settings. Confirm `x-vercel-cache: HIT` on second request.
3. **Page data (opus).** Scope `NextIntlClientProvider` messages per route: pass only the namespaces each route's client components use. Send only the fields product cards need (id, slug, title, price, image, delivery) in the store list; no full descriptions.
4. **Fonts (S).** Audit families and weights actually used; subset (latin + arabic where needed); preload only 1–2 above-the-fold files; `display: swap`. Target under 100 KB per page.
5. **Duplicate calls (S).** `auth/v1/user` runs twice and `rpc/credit_summary` three times on `/en`. Fetch once via a shared provider (or React `cache`) and skip `credit_summary` for anonymous visitors.
6. **Console 404s (S).** Find the 4 "Failed to load resource: 404" (check `<Link prefetch>` to missing routes, `/apple-touch-icon.png`, `/manifest.webmanifest`, `/og-image.png`, icon references). Add `app/favicon.ico`, `app/manifest.ts`, apple icon. Verify zero 404s on `/en`, `/ar`, `/en/store`.
7. **Analytics (S).** Per D7: cookie notice component (EN/AR), GA4 loaded only after Accept, remove ga-audiences / Google Signals (`allow_google_signals: false`, `allow_ad_personalization_signals: false`).
8. Low-resolution supplier photos (225 px shown at 565 px): content issue. Do not fix in code; list the affected SKUs in the phase summary for the owner.

## 9. Phase H — SEO and sharing (REPORT section 8)

- `generateMetadata` on every page: `alternates.canonical` (absolute, locale-specific) and `alternates.languages` (`en`, `ar`, `x-default`). Product pages included. Titles keep the brand ("Plan a product | Gestaltung360").
- Default `openGraph` image (logo + tagline, 1200×630, created under `app/opengraph-image` or `public/`), plus per-product `og:image` from the product photo with price in `og:description`. `og:title`, `og:type`, `og:locale` and `og:locale:alternate`. Twitter card summary_large_image.
- `app/sitemap.ts`: static pages and every published product, each in `en` and `ar`, with `alternates.languages`. Paginate if above 50,000 URLs (not needed now).
- `app/robots.ts`: allow all, disallow `/dashboard`, `/inventory`, `/api`, and a `Sitemap:` line.
- Keep html `lang`/`dir`, single H1 and image alt (already correct). Add tests for sitemap content and metadata shape.

## 10. Phase I — Credit and milestone emails (NEW FEATURE)

Send a congratulatory bilingual email whenever a customer gains credits or unlocks something. Language by `profiles.locale` (default `en`). Sending uses Resend with the same `fetch` approach as `app/api/store-lead/route.ts` and `app/api/orders/confirmation`; extract a shared helper `lib/email/send.ts` and reuse it. Use opus for the migration, trigger functions and cron; sonnet for templates, admin page and tests.

**Triggers**
| Kind | When | Content |
|---|---|---|
| `credits_order_delivered` | `credits_ledger` insert with `delta > 0` from the part_order delivered trigger | "Congratulations — your order #{order} earned you 3 circuit credits and 1 CAD credit." |
| `credits_admin_grant` | `credits_ledger` insert with `delta > 0` from `admin_grant()` | "You received {N} credits: {note}" |
| `first_project` | the first row created in `projects` for the user | "Welcome — your project is saved." Link to `/projects/{id}`. |
| `first_circuit` | `projects.free_wiring_used` becomes true (or first circuit drawn) | "Your first circuit is ready. Your next ones use credits." Explain the balance. |
| `discount_ready` | a `spend:` credit becoming redeemable as QAR 20 off | "You have QAR 20 off your next order, valid until {date}." Link to `/store`. |

For `discount_ready`, first read migration 0042 and how `spend:` rows and the QAR 20 redemption actually work. Only wire the trigger to real existing behaviour; if redemption does not exist yet, implement the trigger and template, mark it disabled in `store_settings.notifications`, and say so in the summary.

**Data (migration 0044 or next free number, idempotent, dry-run comment block, not run by you)**
- Table `notification_outbox`: `id uuid pk`, `user_id uuid`, `kind text`, `payload jsonb`, `locale text`, `email text`, `status text check in ('queued','sent','failed','skipped')`, `attempts int default 0`, `last_error text`, `created_at timestamptz default now()`, `sent_at timestamptz`.
- Unique index on `(user_id, kind, (payload->>'ref'))` so nothing is queued twice. `payload.ref` is the order id, ledger row id, project id etc.
- Postgres functions + triggers on `credits_ledger` and `projects` insert/update that insert into the outbox with `on conflict do nothing`. They snapshot `profiles.email` and `profiles.locale`. If no email: insert with status `skipped` and `last_error = 'no_email'` (guests with only a phone get nothing; WhatsApp sending is out of scope because it costs money).
- RLS: enabled, no policies for users; only the service role and super admin (select) can access.
- Unsubscribe: a table `notification_prefs(user_id pk, unsubscribed_kinds text[], all_off bool, token uuid default gen_random_uuid())` or equivalent. Triggers and the drainer skip when the user opted out (status `skipped`, reason `unsubscribed`).

**Drain job**
- `app/api/cron/notifications/route.ts` (GET, requires `Authorization: Bearer ${CRON_SECRET}`), service-role client, takes up to 50 `queued` rows (and `failed` rows with attempts < 3) with row locking (`for update skip locked` via an RPC), renders the template, sends via Resend, sets `sent`/`failed`, increments attempts, records `last_error`.
- `vercel.json` cron: `*/15 * * * *` on that path. Tell the owner to set `CRON_SECRET` in Vercel env (no paid service involved).
- Owner opt-out per kind: `store_settings.notifications` jsonb, e.g. `{ "credits_order_delivered": true, ... }`; the drainer checks it and marks `skipped` with `reason = 'disabled'`.

**Templates** `lib/email/templates/*.ts`, one per kind plus a shared `layout.ts`
- Each exports `render({ locale, payload, links }) => { subject, text, html }`; EN and AR (RTL `dir="rtl"` for AR), plain text and simple inline-style HTML, brand strip with "Gestaltung for Trading and Services W.L.L · C.R. 236988", a button linking to `/projects` or `/store`, a short "how to use your credit" paragraph, WhatsApp number.
- Footer of every email: one-click unsubscribe link `/api/notifications/unsubscribe?token=...&kind=...` (GET shows a confirmation page, POST/one-click applies, no login). Include `List-Unsubscribe` header in the Resend call.

**Admin**
- `/dashboard/notifications` (super admin): table of outbox rows with status filter, kind, user, email, attempts, error, timestamps; button "Send test to me" (sends a rendered sample of the chosen kind to the admin's own email, not written to the outbox). Add a link from the dashboard nav. Strings in EN and AR.

**Tests**: template rendering for every kind in EN and AR (subject, key strings, RTL attribute, unsubscribe link present); dedupe (same ref queued twice yields one row); skipped-without-email; opt-out; cron auth rejects without secret.

## 11. Acceptance checklist (owner runs on the live site, EN and AR, phone and desktop)

**Phase A**
- [ ] Add a QAR 78 item: cart shows "Delivery from QAR 50" and the exact line "This is your final price. We confirm your order on WhatsApp."
- [ ] Checkout totals: shipping 50 for every tier (or your D1 values), no "Handling fee" line, and total = goods + shipping.
- [ ] Open `/en/store/checkout` with an empty cart: you land on the cart page.
- [ ] "Card payment … coming soon" appears once. Fawran shows the full name in brackets.
- [ ] Choose Bank transfer: Email shows as required; submit empty gives a clear error.
- [ ] WhatsApp number visible on checkout. Cart survives closing and reopening the browser.

**Phase B**
- [ ] Nav reads Shop parts / Get a part made / Plan a product (AR: تسوّق القطع / اصنع قطعتي / خطّط لمنتج) on desktop and in the mobile menu; "Plan a product" opens `/projects/new`.
- [ ] No page contains "multi-tenant", "row-level security", "tenant", "Role-specific", "MODEL: Marketplace", "New accounts start as clients".
- [ ] `/projects/new` shows the three explanation lines, optional email, "+974" placeholder.
- [ ] About tells your story with your facts. Dashboard shows "My orders" and "My projects".

**Phase C**
- [ ] `/store` has search and sort. Search "esp32": boards first, jumper wires last.
- [ ] Search "zzzz": "We don't have "zzzz" yet", "Request this item" pre-filled, "Clear search".
- [ ] Cards show "Arrives by {date}", no "In stock", no "No minimum", no VLT code. Filter is "Delivery time".
- [ ] Product page: "Delivery from QAR …", "Save to a project" with tooltip, title once, no dead "3D Model" text, "Added — View cart".
- [ ] About 8 category pills; EN store shows "Clear filters" when filtered.

**Phase D**
- [ ] Contact and footer show WhatsApp +974 6656 7410, address, C.R. 236988, payment icons, Delivery and returns / Terms / Privacy (with your text).
- [ ] `/en/nope` shows the branded 404 with search and links. Guest opening `/en/dashboard` or `/en/inventory` lands on `/projects`.
- [ ] `/projects` empty state shows an example and a sign-in link. A guest opening a foreign prototyping URL sees the guest explanation.

**Phase E**
- [ ] On `/ar` a translated product shows the Arabic description and spec labels; no English supplier text. Latin tokens do not dangle alone on a line. Store shows "107 منتجًا" and مستشعر only.

**Phase F** (375 px wide)
- [ ] `/design` shows the two choices at the top. `/store` is a 2-column grid with a Filters drawer and a back-to-top button. No horizontal scroll anywhere. Images do not jump while loading.

**Phase G**
- [ ] Second request to `/en` and `/en/store` returns `x-vercel-cache: HIT`. Card images are at most 600 px wide. Zero 404s in the console. Favicon shows. Cookie notice appears; no `ga-audiences` request before or after Accept; GA4 loads only after Accept. `CHANGELOG-audit.md` has before and after numbers.

**Phase H**
- [ ] `view-source` of any page has canonical, hreflang (en, ar, x-default) and og:title/og:image. `/sitemap.xml` lists pages and products in both languages. `/robots.txt` has a Sitemap line. A product link pasted into WhatsApp shows a photo and price.

**Phase I**
- [ ] After you run the migration and set `CRON_SECRET`: mark a test order delivered, wait up to 15 minutes; the customer with an email receives "Congratulations — your order #… earned you 3 circuit credits and 1 CAD credit" (AR user receives the Arabic version, right to left). A phone-only guest gets nothing and the outbox row is `skipped`.
- [ ] `/dashboard/notifications` lists the rows; "Send test to me" delivers a sample; the unsubscribe link in the email stops further emails of that kind; re-running the cron never sends the same email twice.
