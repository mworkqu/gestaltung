# sec-api-1 — Non-AI API routes + server actions (read-only review, 2026-10-22)

Scope: 38 route.ts under app/api (non-AI), 26 "use server" files (all under app/), and the lib helpers they call.
Method: read every in-scope route and action; traced helpers and the SQL functions they rely on in supabase/migrations. Nothing executed, no network, no repo file modified.
Conventions: "SA" = super_admin check via `getSessionContext()` (profiles row read under RLS). "svc" = `createServiceClient()` (service role, bypasses RLS). Line numbers are from the current checkout.

---

## 1. ROUTE TABLE

### 1a. API routes

| Path | Methods | AuthN | AuthZ | Validation | svc? | Rate limit | Notes |
|---|---|---|---|---|---|---|---|
| /api/admin/customers/[id]/export | GET | getUser() | SA (route) + RLS; dev hook `EXPORT_DEV_OWNER=1` only when NODE_ENV≠production and id==self | id regex (loose `[0-9a-f-]{36}`) | yes, after SA (auth.admin.getUserById) | none | no-store; filename slugged |
| /api/admin/projects/[id]/export | GET | getUser() | SA + RLS; same dev hook (owner) | id regex | yes, after SA | none | same pattern as above |
| /api/admin/drive-import | POST | getSessionContext | SA; bucket policy | hand-written; files ≤8, id regex `[A-Za-z0-9_-]{10,200}` | no (RLS client) | none | runtime nodejs, maxDuration 60; fetch fixed googleapis host; buffers full body before 25 MB check (×8 parallel); returns raw storage error text |
| /api/admin/notifications/test | POST | getSessionContext | SA | kind allow-list, locale enum | no | none | sends only to caller's own email |
| /api/admin/site-v2-preview | GET | getSessionContext | SA | locale allow-list | no | none | sets constant cookie `site_v2=1` (see API-07) |
| /api/admin/sourcing-backup | POST | getSessionContext | SA | step enum; preview bool | no | none | maxDuration 300; step "clear" deletes every backup product; revalidateStorefront ✓ |
| /api/admin/starter-parts | POST | getSessionContext | SA | none needed (no body) | no | none | maxDuration 300; fetchImage (redirects followed); revalidateStorefront ✓ |
| /api/admin/store-cleanup | POST | getSessionContext | SA | step enum; `after` ≤200 | no | none | maxDuration 300; calls Gemini (translate); revalidateStorefront ✓ |
| /api/admin/voltaat-import | POST | getSessionContext | SA | `publish` bool | no | none | robots.txt honoured; revalidateStorefront ✓ |
| /api/admin/voltaat-sync | POST | getSessionContext | SA | none | yes, after SA | "one run a day" in runVoltaatSync | revalidateStorefront ✓ |
| /api/admin/youtube/connect | GET | getSessionContext | SA | locale enum | no | none | signed state + httpOnly lax cookie scoped to /api/admin/youtube |
| /api/admin/youtube/callback | GET | getSessionContext | SA; state HMAC + cookie equality (timingSafeEqual) | code required | yes (integrations table) after SA | none | refresh token AES-256-GCM sealed; never logged |
| /api/admin/youtube/upload | POST | getSessionContext | SA | slug allow-list (videoEntry), validateUploadMeta | yes after SA | YT quota bookkeeping | maxDuration 300; Google PUTs have no per-call timeout |
| /api/auth/callback | GET | Supabase code / token_hash | n/a | `next` via local safeNext (weaker, API-11); provider allow-list | yes (claim after social sign-in, token verified server-side) | none | redirects always `${origin}${next}` (no open redirect) |
| /api/auth/claim-guest | POST | cookie session + guest JWT verified with svc.auth.getUser(token) | target must be non-anon, source anon, different | Origin==Host, JSON content-type, 16 KB cap, JWT regex | yes, after checks | none | the only route with Origin + content-type checks |
| /api/billing/checkout | POST | getUser(), non-anon | product from server config | zod `{product ≤40}` | yes (payment_create, service-role-only) | one open row per product (SQL) | amount never from browser ✓ |
| /api/billing/proof | POST | getUser(), non-anon | payment row read under RLS + user_id check; path must start `<uid>/`, no `..` | zod uuid + path ≤300 | yes (download proof, attach, settle) | none (AI call metered) | **auto-approval on a vision read of a user screenshot (API-01)** |
| /api/billing/service | POST | getUser(), non-anon | project ownership enforced in SQL (0092:39) | zod | yes (payment_create_service) | one open per project/kind | price recomputed server-side ✓ |
| /api/cron/anonymous-cleanup | GET | Bearer CRON_SECRET (timingSafeEqual) | — | — | yes | weekly | unset secret → 500 `cron_secret_unset`; returns `detail: error.message` |
| /api/cron/delivery-promises | GET | Bearer CRON_SECRET (`!==`) | — | — | yes | daily | unset → 401; emails customers |
| /api/cron/notifications | GET | Bearer (timingSafeEqual) | — | — | yes | daily | unset → 500 |
| /api/cron/supplier-refresh | GET | Bearer (`!==`) | — | — | yes | daily | conditional revalidate ✓ |
| /api/cron/voltaat-sync | GET | Bearer (`!==`) | — | — | yes | daily | conditional revalidate ✓ |
| /api/cron/youtube-retire | GET | Bearer (`!==`) | — | — | yes (inside runRetirements) | daily | runtime nodejs |
| /api/demand | POST | optional (RPC stamps auth.uid) | none | hand-written; kind enum, partId regex, strings sliced | no | **none** | kind=request emails owner with attacker replyTo (API-03) |
| /api/design-quote | POST | **none** | **none** | hand-written slices; storage_path free text | **yes, unauthenticated**: reads any project name; mints 7-day signed URL for any path (API-04) | **none** | no Turnstile; no `dynamic` export (POST is dynamic anyway) |
| /api/engineering/jobs | POST | getUser(), non-anon | ownership in SQL (0091:107); `p_free` if SA | zod | yes (engineering_job_submit) | one open job per project/kind | ✓ |
| /api/engineering/jobs/[id]/cancel | POST | cookie (RLS RPC) | SQL `user_id = auth.uid()` (0091:169) | id regex | no | — | error mapped, no leak |
| /api/engineering/jobs/[id]/return | POST | cookie (RLS RPC) | SQL uid + path prefix + no `..` (0091:185-187) | zod | no | — | ✓ |
| /api/notifications/unsubscribe | GET, POST | per-recipient UUID token | token lookup in SQL | uuid + kind allow-list; all output escaped | yes (notification_unsubscribe) | none | GET is non-mutating ✓; RFC 8058 one-click ✓ |
| /api/orders/confirmation | POST | **none** (order id) | order <1 h old, not yet emailed, claim-then-send | id regex | yes, unauthenticated | once per order | sends to attacker-chosen customer_email (API-02) |
| /api/orders/rate | GET, HEAD | HMAC token (timingSafeEqual, no expiry) | token binds order id | parseScore, uuid | yes after token check | none | **GET writes** (API-10) |
| /api/orders/review | POST (GET/HEAD 405) | HMAC token | same | 280 chars/no links, body capped (REVIEW_BODY_MAX_BYTES) | yes after token check | none | output escaped ✓ |
| /api/projects/claim | POST | getUser() (guest ok) | SQL claim_project: key match + current owner anonymous | uuid | no (RPC as caller) | key rotated per claim | emails new link to stored address |
| /api/projects/name | POST | getUser() (guest ok) | `.eq("user_id", user.id)` + RLS | uuid | no | global Gemini pause only; once per project | maxDuration 60; AI call |
| /api/projects/recovery-email | POST | getUser() (guest ok) | SQL: owner, <1 h, once, ≤3/day **per user id** | isPlausibleEmail, ≤254 | no | 3/day per session — new anon session resets it (API-02) | sends to any address |
| /api/store-lead | POST | optional | Turnstile **or any Supabase session** (API-03) | hand-written; items ≤60, files ≤40 with owner-path regex | yes only for studio_quote insert after RLS read of project | none | Host-derived links in owner email (Info) |
| /api/store/search | GET | none | n/a (public card fields) | q trimmed/capped | no (cookie-free anon) | in-memory 60/min/IP per instance | CDN cached 60 s ✓ |

### 1b. Server-action files (all under app/[locale])

| File | Actions | AuthN/AuthZ | Failure mode for non-admin | Validation | svc? | revalidateStorefront | Notes |
|---|---|---|---|---|---|---|---|
| dashboard/contact/actions.ts | saveContactPhone | SA | throw "forbidden" | phone normaliser | no | revalidateContactPhone ✓ (line 24) | — |
| dashboard/credits/actions.ts | grantCredits | SA + admin_grant re-checks | throw | pickAmount/grant-reason parsers | no | n/a | — |
| dashboard/engineering-jobs/actions.ts | setJobStatus, markJobReady, saveServicePrices | SA (guard) + SQL is_super_admin | throw | UUID, status enum, path prefix `jobs/<id>/`, zod schema for prices | no | **no** (store_settings `engineer_services`; read uncached only — Info) | — |
| dashboard/leads/actions.ts | setLeadStatus, saveLeadQuote, saveQuoteRule, rewardPrint | SA | silent return / {error} | enums, UUID, parsers | no | ✓ (quote rule) | — |
| dashboard/payments/actions.ts | reviewPayment, expirePass | SA + SQL | throw | UUID, action enum | no | n/a | — |
| dashboard/reviews/actions.ts | setReviewStatus | SA + SQL | silent return | enums | no | ✓ | — |
| dashboard/store/actions.ts | createPart, updatePart, deletePart, importPartsFromSheet, togglePublished | SA | redirect / {error:"auth"} | parsePart; safeLocale; returnTo sanitiser; sheet host allow-list | no | ✓ | sheet fetch follows redirects (API-08) |
| dashboard/store/attributes/actions.ts | savePartAttributes, bulkSetAttributes, fillAttributesFromNames, saveKitDiscount | SA | throw | cleanAttributes; `ids` unbounded, `patch.field` arbitrary key | no | ✓ | TS-only types (API-13) |
| dashboard/store/fix/actions.ts | bulkSetDelivery, bulkMarkOnRequest, bulkUnpublish, fixOne | SA | {error:"forbidden"} | cleanIds (UUID, MAX_IDS), cleanLead | no | ✓ | — |
| dashboard/store/occasions/actions.ts | saveOccasions | SA | {ok:false} | validator | no | ✓ | — |
| dashboard/store/orders/actions.ts | setOrderStatus, updateOrderStatus, toggleWhatsappSent, advanceOrder, cancelOrder, setOrderTest | SA | redirect | status enum; SQL set_order_status checks transitions | yes in `after()` drain, after SA | n/a (orders) | drain link base = siteUrlFor (env/constant in prod) ✓ |
| dashboard/store/overview/actions.ts | hideProduct | SA | silent | — | no | ✓ | — |
| dashboard/store/quick/actions.ts | saveQuickProducts | SA | throw | rows sliced 200; fields TS-only | no | ✓ | — |
| dashboard/store/restock/actions.ts | saveRestockWeights, saveSupplierMinimum, markReceived | SA + SQL | throw | cleanWeights; returns raw `error.message` | no | **no** — markReceived changes parts.in_own_stock (API-12) | — |
| dashboard/store/schools/actions.ts | saveSchoolPricing | SA | {ok:false} | validator | no | ✓ | — |
| dashboard/store/sourcing/actions.ts | saveOffer, deleteOffer, pinOffer, setPricingMode, saveSupplier, saveSourcingSettings, saveShippingSettings, saveHolidays | SA | throw | per-field cleaners | no | ✓ | — |
| dashboard/store/stock/actions.ts | markBought, setShelfUnits | SA | {error} | sliced 200, parseShelfQty | no | ✓ | — |
| dashboard/store/suppliers/import/actions.ts | previewImport, applyImport | SA | throw | plan(); offers TS-only | no | ✓ | — |
| dashboard/store/suppliers/lookup/actions.ts | searchSuppliers, addFromSupplier, refreshApiOffer | SA | throw | — | no | ✓ | fixed-host supplier APIs with timeouts ✓ |
| dashboard/store/suppliers/voltaat/actions.ts | setVoltaatSync, mapVoltaatProduct | SA | throw | `/voltaat\.com/` + handle `encodeURIComponent` | no | ✓ | decodeURIComponent on bad `%` throws → 500 (admin) |
| dashboard/store/youtube/actions.ts | saveYoutube, disconnectYoutube, queueRetireAction, cancelRetireAction, deleteRetireNowAction | SA | {ok:false} | validators | yes (integrations) after SA | ✓ | — |
| dashboard/studio-library/actions.ts | savePart, savePartSkus, setPartEnabled, resetPart, lookupSkus | SA (`admin()`) | {error}/null | LibraryPartSchema (zod) | no | n/a | — |
| dashboard/usage/actions.ts | saveAiPricing, saveTurnstileSwitch, saveCleanupSettings | SA | throw | parsers | no | ✓ | — |
| e2e-fixtures/quote-calc/actions.ts | fixtureSaveQuote, fixtureSaveRule | `e2eFixturesEnabled()` (E2E_FIXTURES=1 and not on Vercel) | {ok:false} | same validators; writes nothing | no | n/a | safe |
| inventory/actions.ts | createItem, updateItem, deleteItem | any session (incl. guests) | redirect sign-in | parseItem; safeLocale | no | n/a | legacy table; authorisation = RLS only (FINDINGS 3–4) — unverified here |
| schools/classes/actions.ts | createClass, setClassArchived, addTeamComment, requestSchoolInvoice | non-anonymous user; RLS | {ok:false,error:key} | lengths | no | n/a | invoice = server-side HTTP hop forwarding Cookie to a Host-derived origin (API-09) |

---

## 2. FINDINGS

### API-01 — High — Billing: payments (incl. engineer services) are auto-approved from a user-supplied screenshot
- Evidence:
  - `lib/billing/server.ts:110-113`
    `const { data: status, error: settleError } = await service.rpc("payment_settle", {`
    `  p_payment: payment.id,`
    `  p_status: verdict.ok ? "approved" : "needs_review",`
  - `lib/billing/verify.ts:99-110` — the only checks are: model says it is a receipt, confidence ≥0.7, currency, amount equal, recipient contains one of the public strings in `lib/billing/config.ts:53` (`["CR-236988", "236988", "GESTALTUNG", …]`), a plausible date, and *any* non-empty transferRef. The payment's own `reference_code` (GT-XXXXXX, which the user is told to put in the note) is never compared with `receipt.note`.
  - `supabase/migrations/0089_payments_maker_pass.sql:264-273` — SQL only downgrades on a reused image hash or transfer ref, then `perform public.payment_apply_internal(p.id)`.
  - `supabase/migrations/0092_engineer_services.sql` (apply, `elsif p.kind = 'service'` → `insert into public.engineering_jobs`) — an approved service payment opens a paid engineer job.
- Exploit: sign up, open a Maker Pass / token pack / engineer-service payment, upload an edited image of any Fawran confirmation (recipient "Gestaltung", the exact amount, today's date, a made-up reference). A re-encoded image gets a new hash; a fresh ref passes the duplicate check. Tokens / pass / a human engineering job are granted with no money received. Text in the image can also steer the model (prompt injection), but forgery alone is enough.
- Fix (needs owner decision — business rule): (a) never auto-approve `kind = 'service'`; (b) require `fold(receipt.note)` to contain the payment's `reference_code`; (c) cap auto-approval (e.g. ≤ 1 auto-approved payment / user / 30 days, ≤ X QAR) and keep auto-approved rows in a mandatory spot-check queue before tokens are spendable, or (d) switch to bank-statement reconciliation. (b) is a behaviour-preserving hardening; (a)/(c) change behaviour.
- Test: unit — `checkReceipt` with a receipt whose note lacks the reference must return a `reference` reason; route-level — `submitProof` on a `kind: "service"` row with a "perfect" receipt must end `needs_review`.

### API-02 — Medium — Unauthenticated / guest-triggered emails to arbitrary addresses with attacker-controlled text
- Evidence:
  - `supabase/migrations/0097_class_order.sql:273` `grant execute on function public.create_part_order(...) to anon, authenticated;` (no rate limit found in the function body).
  - `app/api/orders/confirmation/route.ts:24-26,55` — any caller with the fresh order id sends `confirmationEmail` to `order.customer_email`; the mail opens `Hi ${e(o.customer_name)}` (`lib/store/order-email.ts:165`) and carries the business IBAN / Fawran alias.
  - `app/api/projects/recovery-email/route.ts:37,48-50` + `0045_project_recovery_link.sql:166-171` — cap is 3/day **per auth user id**; anonymous sessions are free to mint, so the cap is per throw-away session. Project name (user text) is put in the mail (`lib/projects/link-email.ts:43`).
- Exploit: script anon sign-in → create_part_order / create project → POST confirmation / recovery-email with a victim address and a name like "Your account is locked, call +974…". Sent from the brand's Resend domain → spam/phishing and sender-reputation damage. HTML is escaped (no markup injection), but plain-text URLs are auto-linked by mail clients.
- Fix: Turnstile (already built: `lib/turnstile-server.ts`) on checkout and on the recovery-email form; per-email / per-IP limits in SQL (e.g. ≤3 order confirmations per address per day); reject URLs/phone numbers in names used in outbound mail.
- Test: route test — second recovery email to the same address from a new anonymous user within 24 h must be refused once an address-level cap exists.

### API-03 — Medium — Public lead/demand endpoints have no CAPTCHA or rate limit; store-lead's CAPTCHA is bypassed by any session
- Evidence:
  - `app/api/store-lead/route.ts:108-116` `if (token && (await checkTurnstile(request, token)).ok) return true;` … `return !!user;` — any Supabase session (incl. anonymous) skips Turnstile. Safe only if Supabase Auth CAPTCHA is ON for anonymous sign-ins (FINDINGS #8). Dashboard state **unverified**.
  - `app/api/design-quote/route.ts` and `app/api/demand/route.ts:32-58` — no Turnstile, no rate limit; demand `kind:"request"` emails the owner with `replyTo: email` (attacker-chosen) and subject containing user text.
  - `lib/rate-limit.ts` limiter is used only by `/api/store/search`.
- Exploit: flood the owner's inbox and the `inquiries` table (SECURITY_REVIEW M3 still relevant); spoof reply-to.
- Fix: run `checkTurnstile` in design-quote and demand(request); apply `createRateLimiter` per IP on all three; in store-lead accept the session bypass only for non-anonymous users, or confirm Supabase CAPTCHA is on and document the dependency.
- Test: route tests with Turnstile enforced and no token → 403 for design-quote and demand(request).

### API-04 — Low — /api/design-quote: unauthenticated caller makes the service role sign any storage path and read any project name
- Evidence:
  - `app/api/design-quote/route.ts:58-61` storage_path is any string ≤400; `:63` bucket chosen by caller (`cad` → private `cad-files`).
  - `:104-106` `await svc.storage.from(bucket).createSignedUrl(storagePath, SIGNED_URL_TTL);` (7 days).
  - `:73-76` service-role read of `projects.name` for any id.
  - `node_modules/@supabase/storage-js/dist/index.cjs:1528-1530` path is concatenated without encoding, so `../payment-proofs/<uid>/x.png` is normalised by `fetch` to another bucket (normalisation behaviour **unverified** against live Storage).
- Impact: the URL goes only to the owner's email and to an `inquiries` row (SELECT is super_admin-only, 0002:40-42), so nothing reaches the attacker directly. Risk = confused deputy: the owner receives a "customer file" link that is really another customer's private CAD/payment proof, and project names are disclosed into leads.
- Fix: require a session for `bucket:"cad"` and enforce `^<auth.uid>/<project uuid>/…` (as store-lead's `PRINT_PATH` does); for quote-uploads enforce the upload-path shape; reject `..` / `%2e`; read the project name with the caller's RLS client.
- Test: unit test the path validator (`../x`, other user's uid, `%2e%2e/`).

### API-05 — Low — Cron auth: 4 of 6 routes use a non-constant-time compare; inconsistent unset-secret behaviour
- Evidence: `app/api/cron/delivery-promises/route.ts:31`, `supplier-refresh/route.ts:12`, `voltaat-sync/route.ts:12`, `youtube-retire/route.ts:13`
  `if (!secret || request.headers.get("authorization") !== \`Bearer ${secret}\`) {`
  vs `anonymous-cleanup/route.ts:31-32` and `notifications/route.ts:17-18` using `isAuthorizedCron` (`lib/notifications/links.ts:74-81`, timingSafeEqual).
- Unset CRON_SECRET: all six refuse (good); four answer 401, two answer 500 `cron_secret_unset` (config disclosure, Info).
- Fix: use `isAuthorizedCron` in all six; same status for unset and wrong.
- Test: table test over the six handlers: no header / wrong / right / secret unset.

### API-06 — Low — Cookie-authenticated JSON POST routes have no Origin / Content-Type check (CSRF defence rests only on SameSite=Lax)
- Evidence: every mutating route uses `await request.json()` regardless of content type (e.g. `app/api/admin/sourcing-backup/route.ts:226`); only `app/api/auth/claim-guest/route.ts:19-24` checks Origin and content type. `node_modules/@supabase/ssr/dist/main/utils/constants.js:6` `sameSite: "lax"`.
- Scenario: a cross-site `<form enctype="text/plain">` can produce a body that `request.json()` parses (`{"step":"clear","x":"="}`). It fails today only because Lax cookies are not sent on cross-site POST. A future cookie-option change, a same-site subdomain, or an older browser would expose destructive admin steps (sourcing-backup `clear`, store-cleanup `placeholders`).
- Fix: one helper (`assertSameOriginJson(request)`) — reuse `sameOrigin()` from `lib/auth/claim-guest.ts:88-96` + require `application/json` — on every mutating route.
- Test: POST with `Origin: https://evil.example` → 403; `text/plain` → 415.

### API-07 — Low — site_v2 preview gate is a constant, forgeable cookie
- Evidence: `lib/site-v2.ts:22-23` `SITE_V2_PREVIEW_COOKIE = "site_v2"` / `SITE_V2_PREVIEW_COOKIE_VALUE = "1"`; `middleware.ts:95` compares only the value. The route comment says "The cookie is only ever set here" but any visitor can set it.
- Impact: unreleased /v2 pages are visible to anyone who sets the cookie (not a data boundary; whether v2 exposes anything sensitive is unverified).
- Fix: HMAC-signed value (reuse the `signState` pattern) or a super_admin check in the v2 layout when the flag is off.

### API-08 — Low — Outbound fetch hardening (SSRF / memory) on admin and supplier paths
- Evidence:
  - `lib/store/store-image.ts:47-50` host allow-list checked on the first URL only; `fetch` follows redirects by default; whole body buffered (`arrayBuffer`) before the 25 MB check in `storeImage`.
  - `app/[locale]/dashboard/store/actions.ts:285-303` allow-list `*.google.com`/`*.googleusercontent.com` with `redirect: "follow"` (google.com hosts open redirectors) and `(await res.text()).slice(0, 2_000_000)` (cap applied after full read).
  - `app/api/admin/drive-import/route.ts:48-49` buffer then size check, ×8 in parallel (≈200 MB peak).
- Impact: super_admin-only or supplier-API-provided URLs, so low; a redirect from an allowed host can make the server fetch internal/other hosts.
- Fix: `redirect: "manual"` and re-check each hop's host; check `content-length` and stream with a byte cap.
- Test: fetchImage with a mocked 302 to a disallowed host → null.

### API-09 — Low — Schools invoice: server-side HTTP hop to a Host-derived origin, forwarding the caller's cookies
- Evidence: `app/[locale]/schools/classes/actions.ts:200-201` `const host = head.get("x-forwarded-host") ?? head.get("host");` and `:222` `...(head.get("cookie") ? { cookie: head.get("cookie") as string } : {}),` in a `fetch(\`${origin}/api/store-lead\`)`.
- Scenario: if the platform passes a client-supplied `X-Forwarded-Host`, a teacher's request makes the server POST (with that teacher's full session cookies) to any host = SSRF + token exfiltration to an attacker host (self-inflicted unless a proxy injects the header). Vercel is believed to overwrite `x-forwarded-host` — **unverified**.
- Fix: call a shared lead-creation function directly instead of an HTTP hop (also saves a function invocation), or use the constant `SITE_URL`.

### API-10 — Low — Order rating: GET records a score; tokens never expire; secret falls back to CRON_SECRET
- Evidence: `app/api/orders/rate/route.ts:53-75` writes on GET (HEAD is safe, but link scanners such as Safe Links issue GETs); `lib/orders/rating.ts:18-20` `return env.ORDER_RATING_SECRET || env.CRON_SECRET || null;`; token has no timestamp.
- Impact: scanners can record (and overwrite) ratings; one secret serves two purposes (rotating CRON_SECRET silently invalidates all rating links).
- Fix: GET renders a confirm button that POSTs (same pattern as unsubscribe); require a dedicated ORDER_RATING_SECRET; optionally add an issue date to the token.

### API-11 — Low/Info — auth/callback uses a weaker `next` sanitiser than lib/auth/next-path.ts; OTP link login-CSRF
- Evidence: `app/api/auth/callback/route.ts:27-31` accepts any same-origin path (`/api/...`, `/en/sign-in`, non-locale paths); `lib/auth/next-path.ts:31-55` (locale required, auth pages excluded) is not used. Redirect is always `${origin}${next}` (`:153`), so **no open redirect**.
- `:125-126` `verifyOtp({ type, token_hash })` with `type` cast from the query: a crafted email link signs the visitor into the attacker's account (standard Supabase login-CSRF; Info).
- Fix: `afterAuthPath(searchParams.get("next"), locale, "/")`.

### API-12 — Low — Store writes without revalidateStorefront()
- Evidence: `app/[locale]/dashboard/store/restock/actions.ts:39-49` `markReceived` → `mark_restock_received` (0069:113 inserts/updates `own_stock`, which keeps `parts.in_own_stock` in step, shown on `app/[locale]/store/[sku]/page.tsx:139,244`) — no `revalidateStorefront()`; the same RPC via `stock/actions.ts markBought` does revalidate. Also `restock/actions.ts:20-22` (store_settings `restock_weights`), `:32` (suppliers.min_order_value_qar) and `engineering-jobs/actions.ts:89-91` (store_settings `engineer_services`, read uncached only in `lib/services/server.ts:13-16`) — rule deviations with no storefront impact found.
- Impact: the "in our own stock" badge stays stale up to 24 h after a restock receipt.
- Fix: call `revalidateStorefront()` (or `revalidatePart(sku)`) in `markReceived`; add it to the other two for rule consistency.

### API-13 — Info — Admin server actions trust TypeScript types at runtime
- Evidence: `quick/actions.ts:60` `rows.map((r) => r.category.trim())` (throws on non-string); `attributes/actions.ts:41-50` `ids` unbounded, `patch.field` any key; `suppliers/import/actions.ts:168-175` `offers` unchecked. Server actions accept arbitrary serialisable args from a crafted request. super_admin-only → 500s / odd data, not escalation.
- Fix: zod schemas at the action boundary (the project already uses zod 4).

### API-14 — Info — Error-detail leakage (admin/cron only)
- `drive-import/route.ts:63,73`, `starter-parts/route.ts:116`, `restock/actions.ts:23,33,47`, `voltaat/actions.ts` (`{ error: error.message }`), `attributes/actions.ts:49`; cron `anonymous-cleanup/route.ts:60` and `notifications/route.ts:25` return `detail`. Public routes map errors to codes ✓.

### API-15 — Info — Items checked and found sound
- YouTube OAuth state: HMAC subkey derived from INTEGRATIONS_ENC_KEY, timingSafeEqual on both cookie and MAC, 10-min TTL, cookie httpOnly/lax/path-scoped and cleared at callback (`lib/integrations/crypto.ts:69-107`). Token sealing: AES-256-GCM, random 12-byte IV, tag length checked, versioned (`:36-61`); no AAD (Info). Tokens never logged.
- Rating/review HMAC: 192-bit, timingSafeEqual, bound to order id (`lib/orders/rating.ts:23-33`).
- Unsubscribe: random per-recipient UUID, GET non-mutating, all reflected values escaped (`unsubscribe/route.ts:88-102`).
- Project recovery key in URL fragment, rotated on claim, claim only from an anonymous owner (0045).
- billing/proof path check (`lib/billing/server.ts:69`) and engineering return path check (0091:185) block traversal.
- Turnstile verification is server-side (`lib/turnstile-server.ts:52-60`).
- No route logs emails, phones or briefs; tokens are never logged. Mouser key travels in the query string (vendor requirement; errors don't include the URL).
- Google WIF (`lib/cad/cloud.ts`) is reached only from /api/cad (AI reviewer's scope). Note for them: `:113` reads `x-vercel-oidc-token` from the request headers; confirm Vercel overwrites a client-supplied value (**unverified**).

---

## 3. CROSS-CUTTING

**JSON error shapes seen (≥9):**
1. `new Response(null, { status })` — admin exports, drive-import, sourcing-backup, starter-parts, store-cleanup, voltaat-*, cron 401s, demand 400, confirmation 400, projects/name 401.
2. `{ error: "<code>" }` — billing/*, engineering/*, notifications/test, store-lead, design-quote, demand, sourcing-backup.
3. `{ ok: false, error: "<code>" }` — auth/claim-guest, youtube/upload.
4. `{ ok: false, reason: "<code>" }` — projects/claim (HTTP 200 on failure).
5. `{ sent: false, reason }` — projects/recovery-email (HTTP 200 on failure), orders/confirmation (`{sent:false}` 200).
6. `{ name: null }` with 200 — projects/name.
7. `{ error, detail }` — cron anonymous-cleanup, cron notifications; `{ error, requests }` — voltaat-import.
8. HTML pages — unsubscribe, orders/rate, orders/review.
9. 303 redirects with `?yt=error&reason=` — youtube connect/callback.
Server actions use 5 failure styles for the same "not admin" case: `throw new Error("forbidden")`, `return { error: "forbidden" }`, `return { ok: false, error|message: "forbidden" }`, silent `return`, `redirect()`.

**Duplicated auth boilerplate:** `getSessionContext(); if (role !== "super_admin")` repeated in 13 admin routes and in ~25 action files (some as local `requireAdmin`/`guard`/`admin`/`isAdmin`, 5 names). `getUser(); if (!user || user.is_anonymous)` ×4 (billing ×3, engineering). Cron check ×6 with 2 implementations. UUID regex re-declared 16 times (app+lib, non-test) in two strengths (loose `^[0-9a-f-]{36}$` vs strict 8-4-4-4-12). `getSessionContext` costs 2–3 queries (profile + tenant) just for a role check. Proposal: `lib/auth/guards.ts` with `requireSuperAdmin()` (route + action variants), `requireAccount()`, `requireCron()`, one `UUID`.

**runtime / maxDuration:** routes that import `node:crypto` (cron ×2, orders/rate, orders/review, notifications/test) or `sharp` (sourcing-backup, starter-parts, store-cleanup via store-image) rely on the default Node runtime — fine, but only drive-import, youtube/* and cron/youtube-retire declare `runtime = "nodejs"`. No `maxDuration` on orders/confirmation, design-quote, store-lead (builds a quote calc), demand, billing/service, auth/callback — uses the project default (not verified in the Vercel settings).

**Method guards:** Next returns 405 for unexported methods; GET handlers get an automatic HEAD. Only orders/rate (explicit HEAD) and orders/review (explicit 405) handle this on purpose. Side-effecting GETs: orders/rate (API-10), auth/callback (expected), site-v2-preview (sets the caller's own cookie), youtube/connect|callback (OAuth). No mutating GET reachable without a token or session.

**Body size:** route handlers have no Next body limit (Vercel caps ~4.5 MB). Only claim-guest (16 KB) and orders/review cap explicitly. Arrays are capped where used (drive-import 8, store-lead 60/40, fix MAX_IDS, quick 200, stock 200); bulkSetAttributes `ids` is not.

**Service-role use:** every service-role use in scope comes after the right gate (SA, cron secret, HMAC/UUID token, or verified JWT), **except** design-quote (API-04) and orders/confirmation (bounded by "fresh + not yet emailed").

---

## 4. RE-CHECK of earlier items

| Item | Status | Evidence |
|---|---|---|
| SECURITY_REVIEW H1 (startJob double deduction) | **Obsolete — code removed** | `app/[locale]/dashboard/jobs/` does not exist; `grep startJob\|deduct` over app/lib/components → nothing; next.config.mjs comment: "The jobs pipeline was retired". |
| H4 (open redirect via `locale` form field) | **Fixed** | `app/[locale]/inventory/actions.ts:15-17` `safeLocale()` pins en/ar; the same pattern is in store/actions.ts:21-23, store/orders/actions.ts:17-19, and the leads/reviews/credits/payments/engineering actions; returnTo goes through `lib/admin/return-to.ts:33-35`. Actions that take a raw `locale: string` argument use it only in `revalidatePath` (no redirect sink found). |
| M2 (non-atomic inventory deduction) | **Obsolete — code removed** | Same as H1. Today's stock writes go through SQL RPCs (`set_own_stock`, `mark_restock_received`, 0069). |
| M4 (dependency advisories) | **Advisories cited are addressed by upgrades; current audit not run** | Installed `next` 15.5.25 and `next-intl` 4.14.5 (node_modules package.json); 8A's next-intl 3.x advisories need 4.x. `npm audit` not run (no network) — **unverified** for new advisories. |
| M5 (no security headers) | **Still open** | `next.config.mjs` has `rewrites()` and `redirects()` but no `headers()`; `vercel.json` has only redirects + crons; no `Content-Security-Policy` / `X-Frame-Options` / `frame-ancestors` / `X-Content-Type-Options` anywhere in the repo except SECURITY_REVIEW.md. Only the unsubscribe/rating pages set `Referrer-Policy`. |
| FINDINGS #8 (CAPTCHA breaks all auth endpoints) | **Code side fixed; production setting unverified** | `captchaToken` is now passed by sign-in (`components/auth/sign-in-form.tsx:83`), sign-up (`sign-up-form.tsx:109`), forgot-password (`forgot-password-form.tsx:53`) and guest creation (`lib/supabase/guest.ts:37-45`, used by quote-request, new-project-form/chat, join-form). Whether Supabase Auth → Attack Protection → CAPTCHA is ON is not visible in the repo; store-lead's Turnstile bypass (API-03) depends on it. Confirm in the Supabase dashboard. |

---

## SUMMARY (worst first)
1. API-01 High: Fawran payments, including engineer-service jobs, are auto-approved from a user-uploaded screenshot read by a vision model. The reference code is not checked, so a forged image buys tokens, passes or a human engineering job for free.
2. API-02 Medium: anon `create_part_order` + `/api/orders/confirmation`, and guest `/api/projects/recovery-email`, send branded emails with attacker-controlled text to any address. The only cap is per throw-away session.
3. API-03 Medium: design-quote and demand have no CAPTCHA or rate limit. store-lead's Turnstile is skipped for any Supabase session, so it depends on Supabase Auth CAPTCHA being on (unverified).
4. API-04 Low: design-quote (no auth) makes the service role sign any storage path (7 days) and read any project name. The links go only to the owner (confused deputy), not to the attacker.
5. API-05 Low: 4 of 6 crons compare CRON_SECRET with `!==`. Unset secret is refused everywhere, but with mixed 401/500 answers.
6. API-06 Low: no Origin or Content-Type checks on cookie-authenticated JSON POSTs. Destructive admin steps rely only on the SameSite=Lax cookie default.
7. API-12 Low: restock `markReceived` changes `parts.in_own_stock` without `revalidateStorefront()`, so the product-page badge stays stale for up to 24 h.
8. API-09/API-08 Low: the schools invoice action forwards cookies to a Host-derived origin (unverified on Vercel). Image/sheet fetches follow redirects past the host allow-list and buffer whole bodies before the size cap.
9. API-07/API-10 Low: the site_v2 preview cookie is a constant "1" anyone can set. Rating links record on GET, never expire and reuse CRON_SECRET.
10. Re-check: H1/M2 obsolete (code removed), H4 fixed, M4 addressed by upgrades (audit not re-run), M5 still open (no security headers), FINDINGS #8 fixed in code (dashboard CAPTCHA state unverified).
