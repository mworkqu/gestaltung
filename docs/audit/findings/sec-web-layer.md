# Security review — web / browser layer (gestaltung, audit/code-and-security-2026-10)

Scope: XSS sinks, headers, cookies, page gates, open redirects, public env, browser storage writes, logging, dependencies.
Method: read-only source review + inspection of the existing `.next/` build (BUILD_ID 2026-10-22 11:16, built with NO Supabase env). No network, no server run. Installed versions: next 15.5.25, react/react-dom 19.2.6, next-intl 4.14.5, @supabase/ssr 0.10.3, @supabase/supabase-js 2.107.0, sharp 0.35.4.

---

## 1. Raw-HTML / markup sinks

`grep dangerouslySetInnerHTML` = 8 matches = 6 JSX sinks + 2 comment lines in `lib/schools/qr.ts`. Plus one `document.write`. No `innerHTML=`, `insertAdjacentHTML`, `eval`, `new Function`, `<iframe>`, `srcDoc` in app/components/lib. No markdown/HTML library is a dependency.

| # | Sink (file:line) | Text inserted | Source of the text | Escaped? | Verdict |
|---|---|---|---|---|---|
| S1 | `app/[locale]/page.tsx:226` `<script type="application/ld+json">` | `JSON.stringify(heroVideoLd).replace(/</g,"\\u003c")` | owner: translations + `NEXT_PUBLIC_SUPABASE_URL` | yes (`<` escaped; data block, not executed) | safe |
| S2 | `app/[locale]/v2/page.tsx:219` JSON-LD | same as S1 | owner | yes | safe |
| S3 | `app/[locale]/schools/classes/[id]/sheet/page.tsx:151` | QR SVG from `qrcode` lib | URL built by us (`joinUrl(SITE_URL, join_code)`; code constrained by 0096 CHECK); aria-label = translation, attribute-escaped (`lib/schools/qr.ts:23-30`) | yes | safe |
| S4 | `components/studio/steps/wiring/SchematicFrame.tsx:454` | SVG from `renderSchematicSVG` / `renderWiringSVG` (`lib/studio/schematic.ts`, `lib/studio/wiring-drawing.ts`), generated in the browser at render time | user/AI-influenced: part names, net names, pin labels, project title from the Studio doc | yes, every text/attribute via `esc()` (`lib/prototyping/netlist.ts:409`, escapes `& < > "`; all attributes are double-quoted) | safe |
| S5 | `components/prototyping/svg-frame.tsx:111` (callers: `netlist-view.tsx:251`, `client/client-wiring.tsx:163`, `dimension-drawings.tsx:105`) | SVG from `renderSchematic` (`lib/prototyping/schematic-svg.ts`), `wiring-svg.ts`, `dimension-drawing.ts`, generated at render time | AI netlist labels, part names, store product names/images/hrefs | yes (`esc`); `<a href>` = `/${locale}/store/${encodeURIComponent(sku)}` (`wiring-svg.ts:53,211`); `<image href>` = store image URL, escaped (SVG `<image>` cannot run script) | safe |
| S6 | `components/prototyping/svg-frame.tsx:58` `w.document.write(...)` (print) | same SVG as S5 + `title` | translation | title escapes only `<`; svg as S5 | safe (owner text) |
| **S7** | **`components/prototyping/schematics-stage.tsx:320`** | **`shown.svg` read back from table `project_schematic_revisions.svg`** (`workspace.tsx:345`) | **any authenticated user (incl. anonymous guests) can write this column directly through PostgREST** (`schematics-stage.tsx:130-136`, RLS 0020 `project_schematic_revisions_insert … with check (owns_schematic(...))`) | **no** — stored markup inserted as-is | **stored XSS → WEB-01** |
| S8 | `lib/orders/rating-page.ts`, `app/api/notifications/unsubscribe/route.ts` (route handlers returning `text/html`) | order id, token, comment, locale | email-link query / form POST (user) | yes: `escapeHtml` on every value; locale normalised to en/ar (`lib/reviews/form.ts:45`, `lib/notifications/decide.ts:177`) | safe |
| S9 | Email HTML (`lib/email/brand-layout.ts`, `lib/email/templates/*`, `lib/email/lead-email.ts`, `lib/store/order-email.ts`, sourcing reports `dataTable`) | customer name, email, phone, notes, part names, supplier rows, AI-free | user / supplier / owner | yes: every text and href through `escapeHtml`/`escapeHtmlText`; raw `bodyHtml` only from `order-email.ts` (all dynamic parts `e()`/`bidiHtml()`/numeric) and `dataTable()` (escaped) | safe; hrefs are HTML-escaped but not scheme-checked (all hrefs are built by us: wa.me digits, mailto:<email>, signed URLs, site URLs) |
| S10 | Legal + case-study markdown (`lib/legal/markdown.ts`, `components/legal/legal-document.tsx`, `lib/case-studies.ts`) | owner-authored markdown | owner (repo files) | rendered as React nodes; links filtered by `SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i` (`markdown.ts:18`) | safe; `\/` also admits `//host` (WEB-11, info) |
| S11 | React-rendered `href`/`src` from DB (store `datasheet_url`, `links[].url` `store/[sku]/page.tsx:335,355`; `supplier_url` admin pages; `quote-calc-card.tsx:157`; `<img src>` product images `part-card.tsx:68`) | supplier / admin / user URLs | supplier, admin, user | React 19 blocks `javascript:` URLs (string present in `node_modules/next/dist/compiled/react-dom/...server.node.production.js`); `<img>` cannot execute script | safe (phishing-link risk only) |
| S12 | AI text (brief chat, analysis, BOM notes), user names in admin pages, product descriptions/specs from Voltaat sync | AI / user / supplier | — | rendered as React text (auto-escaped); no HTML path found | safe |

No pre-paint theme script exists in this checkout (`grep "<script\|next/script"` finds only S1/S2). Inline JS on pages = Next's own RSC bootstrap (53 inline `<script>self.__next_f.push(...)` blocks in `.next/server/app/en.html`) + GA loader injected by `components/cookie-notice.tsx:60-74` (external `https://www.googletagmanager.com/gtag/js`, inline `gtag()` function defined in JS, not an inline `<script>` element). Inline `<style>` elements: `SchematicFrame.tsx` (`FRAME_CSS`), class sheet `PRINT_CSS`, rating/unsubscribe pages; many `style=""` attributes in SSR HTML.

---

## 2. Cookies

| Cookie | Set where | HttpOnly | Secure | SameSite | Path | Max-Age | Notes |
|---|---|---|---|---|---|---|---|
| `sb-<ref>-auth-token` (+ `.0/.1` chunks) | `@supabase/ssr` via `lib/supabase/client.ts` (document.cookie), `server.ts:21`, `middleware.ts:37` | **no** | **not set** | Lax | `/` | 400 days | defaults from `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11`; no `cookieOptions` passed anywhere. Guests (anonymous users) hold the same cookie. WEB-04 |
| `sb-<ref>-auth-token-code-verifier` | Supabase browser client (PKCE, OAuth) | no | not set | Lax | `/` | per lib | read in `app/api/auth/callback/route.ts:43` |
| `site_v2` = `1` | `app/api/admin/site-v2-preview/route.ts:34` (super_admin only, GET) | yes | prod only | Lax | `/` | `SITE_V2_PREVIEW_MAX_AGE` (7 d) | `lib/site-v2.ts:139-147`. Value is a constant: anyone can set `site_v2=1` themselves to preview /v2 (public marketing content only) — info |
| `yt_oauth_state` | `app/api/admin/youtube/connect/route.ts:32-38` | yes | prod only | Lax | `/api/admin/youtube` | state TTL | HMAC-signed state, cleared in callback — good |
| `gestaltung_consent` | `components/cookie-notice.tsx:55` → `lib/analytics/consent.ts:62-70` | no (must be JS-readable) | when https | Lax | `/` | 365 d | value `accepted.<ms>`/`declined.<ms>`, validated on read |
| `NEXT_LOCALE` | next-intl: root-path middleware (`middleware.ts:19`, default `localeCookie`) and client locale switch (`i18n/navigation.ts`) | no | not set | Lax (`next-intl/.../routing/config.js:13`) | `/` | session (next-intl 4 default; not observed at runtime — unverified) | locale-prefixed pages never write it (`localeCookie:false`, `middleware.ts:25`) |
| cart / guest | — | — | — | — | — | — | no cookie: cart = `localStorage` `CART_KEY` + `cart_items` table; guests = Supabase anonymous session (auth cookie above). sessionStorage `gestaltung:last-order` holds the order summary for the success page |

---

## 3. Page gates (private routes under `app/[locale]`)

Middleware does **not** gate anything (it only refreshes the session when an auth cookie exists, `lib/supabase/middleware.ts:27`). All gates are server-side in layouts/pages, plus RLS. Matcher skips every path containing a `.` (`middleware.ts:132`), harmless for auth because no auth lives there.

| Route | Gate location | Verdict |
|---|---|---|
| `/dashboard/**` | `dashboard/layout.tsx:33-41` (getAuthUser → guestRedirect → getSessionContext → sign-in) | server-side, layout only |
| `/dashboard` home | layout + `dashboard/page.tsx:24-26` | OK |
| `/dashboard/{ai-costs,credits,customers,engineering-jobs,notifications,payments,projects,studio-library,usage,store}/**` | role check in each sub-`layout.tsx` (`role !== "super_admin"` → redirect); pages have **no own check** | layout-only; pages that use the **service-role client** without their own check: `customers/page.tsx:107-111` (`auth.admin.listUsers`), `customers/[id]/page.tsx:105` (`auth.admin.getUserById(id)`), `projects/page.tsx:77-82` → WEB-02. All other pages read through the RLS client (RLS = second gate) |
| `/dashboard/leads`, `/leads/[id]`, `/reviews` | own role check in page | OK |
| `/dashboard/contact` | only the root dashboard gate (any signed-in client/workshop) | UI exposed, action gated (`contact/actions.ts:15-16`) → WEB-08 |
| `/dashboard/overview` | redirect only | OK |
| `/inventory/**` | `inventory/layout.tsx` + pages (role) | OK |
| `/my-inventory` | none server-side; client component loads via browser client | RLS-only (acceptable: own rows) |
| `/orders`, `/orders/[id]` | `auth.getUser` + redirect / notFound in page | OK |
| `/projects` | `auth.getUser` in page | OK |
| `/projects/new` | none (public start page) | intended |
| `/projects/[id]` | `auth.getUser`/`getSessionContext` + RLS | OK |
| `/projects/[id]/studio` | session lookup + RLS (guests allowed by design) | OK |
| `/projects/[id]/prototyping` | `page.tsx:52-55` super_admin else redirect | OK (the WEB-01 victim surface) |
| `/projects/[id]/engineering` | getAuthUser/getSessionContext | OK |
| `/projects/[id]/request` | `auth.getUser` + notFound | OK |
| `/schools` | public marketing page (prerendered, revalidate 86400) | intended |
| `/schools/classes/**` (incl. `[id]/sheet`, `teams/[teamId]`) | `schools/classes/layout.tsx:31-37` (getAuthUser + getSessionContext); pages RLS | layout-only, RLS reads → OK |
| `/tokens` | getAuthUser only to pick signed-in vs public view | intended |
| `/join` | public (code read client-side) | intended |
| `/store/checkout` | `auth.getUser` + redirect | OK |
| `/v2/**` | middleware site_v2 flag / preview cookie (404 otherwise) | public content |
| `/e2e-fixtures/**` | `lib/e2e-fixtures.ts:13-15`: `E2E_FIXTURES==="1" && !VERCEL && VERCEL_ENV!=="production"`, every page calls it then `notFound()`; all force-dynamic | OK on Vercel; only a self-hosted `next start` with `E2E_FIXTURES=1` exposes them |
| `/[...rest]` | `notFound()` | OK |

**The "● prerendered dashboard" question — route-table quirk, not an exposure (proven):**
- `.next/server/app/` contains 60 `.html` files; none under `dashboard`, `projects`, `inventory`, `orders`, `tokens`, `my-inventory`, `e2e-fixtures`, `schools/classes` (the `en/dashboard/store/suppliers` directories exist but are empty).
- `.next/prerender-manifest.json`: 68 routes; the only matches for those names are the public `/en|ar/{join,schools,partners/schools}` (revalidate 86400).
- Every dashboard page also exports `dynamic = "force-dynamic"` itself (e.g. `dashboard/page.tsx:12`, `payments/page.tsx:14`, `leads/page.tsx:25`), and `.next/server/app/[locale]/dashboard/page.js` exists as an on-demand function.
- The ● comes from `generateStaticParams` on `app/[locale]/layout.tsx:76` (locale list); the build table prints the param expansion even though rendering bailed to dynamic. No admin data can be in static HTML.
- Caveat: this build ran without Supabase env; the conclusion rests on `force-dynamic`, which does not depend on env.

---

## 4. Open redirects

| Flow | Code | Verdict |
|---|---|---|
| `?next=` on sign-in/sign-up pages + forms | `lib/auth/next-path.ts:31-55` (`safeNextPath`): string, ≤1024, leading `/` not `//`, no `\`, no C0/DEL, URL-normalised against a fixed base, must start with `/en` or `/ar`, never an auth page; used in `sign-in/page.tsx:31,40`, `sign-up/page.tsx:35`, forms push only the validated prop (`sign-in-form.tsx:99-101`, `sign-up-form.tsx:126-128`) | safe |
| `/api/auth/callback?next=` | own `safeNext` (`route.ts:27-31`: leading `/`, not `//`, no `\`, no control chars) → `NextResponse.redirect(\`${origin}${next}\`)` (`:153`) | safe (origin is ours; `/@x`, `/%2F%2Fx` stay same-origin) |
| OAuth `redirectTo` | `oauthCallbackUrl(window.location.origin, afterAuthPath(next), provider)` (`social-sign-in.tsx`, `lib/auth/providers.ts:51-60`); Supabase additionally enforces its redirect allow-list | safe |
| Password reset `redirectTo` | `forgot-password-form.tsx:45-52` fixed `/${locale}/reset-password` | safe |
| Admin `returnTo` | `lib/admin/return-to.ts:10-31` (must stay under `/${locale}/dashboard/`, no `//`, normalised) | safe |
| YouTube OAuth callback locale | from HMAC-verified state (`youtube/callback/route.ts:20-21`) | safe |
| `?getItMade=1` / `?step=` | `lib/projects/href.ts:33` → `studioRedirectPath(locale,id,sp)` same-origin path | safe |
| `/join` | `join-form.tsx:94` `router.push(\`/projects/${projectId}/studio\`)` with id from RPC | safe |
| `redirect(\`/${locale}/…\`)` with `locale` from route params | locale is one path segment; middleware forces en/ar except for dotted paths (matcher) | see WEB-10 (unverified, info) |

---

## 5. Environment variables

Next inlines only `NEXT_PUBLIC_*` into client bundles; a non-public `process.env.X` read in client code becomes `undefined`, so a server secret cannot be bundled by accident. Client components that read env: `components/turnstile.tsx`, `components/admin/safety-settings.tsx` (TURNSTILE site key), `components/feature-video-client.tsx` (SUPABASE_URL), `lib/google/drive-picker.ts` (GOOGLE_API_KEY/APP_ID/CLIENT_ID), `cart-provider.tsx`/`Viewer.tsx`/`Wiring3DView.tsx` (NODE_ENV only).

Bundle scan of `.next/static` (6.3 MB; counts only, no values printed): JWT `eyJhbGciOi…` 0, `service_role` 0, `sk_live_|sk_test_` 0, Resend `re_…` 0, Google `AIza…` 0, Groq `gsk_…` 0, `BEGIN PRIVATE KEY` 0, secret env-var names 0; `supabase.co` 3 hits = supabase-js library host list. **Limitation:** the build had no env, so this proves no hard-coded secrets; it cannot show what a Vercel build with env inlines (only NEXT_PUBLIC_* would be).

| Variable | Server / public | Used in |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | public | lib/supabase/{client,server,middleware,public,service}.ts, middleware.ts, lib/auth/providers-server.ts, feature-video-{client,section}.tsx, home + v2 page (JSON-LD), checkout page, store-lead, design-quote, admin youtube |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | public (by design; RLS is the boundary) | same Supabase client files, middleware.ts flag fetch, checkout, store-lead, design-quote |
| NEXT_PUBLIC_GA_MEASUREMENT_ID | public | app/[locale]/layout.tsx → CookieNotice (validated `^G-[A-Z0-9]+$`) |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY | public | components/turnstile.tsx, components/admin/safety-settings.tsx, lib/turnstile.ts |
| NEXT_PUBLIC_GOOGLE_API_KEY | public (browser Picker key) | lib/google/drive-picker.ts — must be HTTP-referrer + API restricted in GCP (unverified) |
| NEXT_PUBLIC_GOOGLE_APP_ID | public | lib/google/drive-picker.ts |
| NEXT_PUBLIC_GOOGLE_CLIENT_ID | public | lib/google/drive-picker.ts, lib/integrations/youtube-server.ts |
| NEXT_PUBLIC_SITE_URL | public | lib/email/brand-layout.ts, lib/projects/recovery.ts, api/project-cad, api/design-quote |
| NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA | public | lib/studio/geometry/persist.ts |
| SUPABASE_SERVICE_ROLE_KEY | server (`lib/supabase/service.ts` imports `server-only`) | lib/supabase/service.ts, lib/admin/project-export.ts, lib/integrations/youtube-server.ts, lib/credits/server.ts |
| TURNSTILE_SECRET_KEY | server | lib/turnstile.ts |
| GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL | server | lib/prototyping/providers/gemini-client.ts, lib/studio/tiers.ts, dashboard/usage (presence only), lib/admin/project-export.ts |
| GROQ_API_KEY, GROQ_WHISPER_MODEL | server | app/api/transcribe/route.ts, dashboard/usage, project-export |
| RESEND_API_KEY, RESEND_FROM, STORE_LEAD_EMAIL | server | lib/email.ts, api/admin/notifications/test, project-export |
| CRON_SECRET | server | 6 × app/api/cron/*/route.ts |
| INTEGRATIONS_ENC_KEY, GOOGLE_OAUTH_CLIENT_ID/SECRET | server | lib/integrations/youtube-server.ts |
| GCP_CAD_SA_EMAIL, GCP_CAD_SA_KEY, GCP_CAD_URL, GCP_WIF_PROVIDER, CAD_WORKER_TOKEN, VERCEL_OIDC_TOKEN | server | lib/cad/cloud.ts |
| DIGIKEY_CLIENT_ID/SECRET, MOUSER_API_KEY | server | lib/sourcing/adapters/{digikey,mouser}.ts |
| AI_RATE_SALT | server | lib/credits/server.ts |
| AI_PRICES, AI_RESET_TZ_GEMINI/GROQ, ANALYSIS_PROVIDER, TIER_MODEL_ENGINEER/MAKER, NETLIST_TEST_BREAK, + dynamic `process.env[name]` | server | lib/ai/{prices,limits}.ts, lib/prototyping/providers/index.ts, lib/studio/tiers.ts, lib/engineering/config.ts, lib/prototyping/electronics-gen.ts |
| STORE_SHEET_CSV_URL | server | dashboard/store/import/page.tsx |
| EXPORT_DEV_OWNER | server, dev only (`NODE_ENV !== "production"` AND `=== "1"`) | api/admin/{customers,projects}/[id]/export |
| E2E_FIXTURES, VERCEL, VERCEL_ENV | server | lib/e2e-fixtures.ts |
| VERCEL_GIT_COMMIT_SHA | server | components/dashboard-footer.tsx (server component) |

**Turnstile:** site key public, secret server-only; verification is server-side (`lib/turnstile.ts:88-112` POST to siteverify with `remoteip`, fail-closed; `lib/turnstile-server.ts:52-60` `checkTurnstile`). Used by `app/api/store-lead`, `app/api/analyse`, `lib/credits/server.ts`; auth forms pass `captchaToken` to Supabase (verified by Supabase). The response's `hostname`/`action` are not checked (info). `/api/design-quote` and `/api/demand` do not call `checkTurnstile` (grep) — confirm intent with the API reviewer.

---

## 6. Browser-side storage / DB writes

All uploads go through the anon-key browser client; storage RLS (latest definitions):

| Bucket | Public | Size / MIME limit (bucket) | Browser insert policy | Path built by client | UPDATE policy (upsert) |
|---|---|---|---|---|---|
| quote-uploads | no | 50 MB / none | **`to anon, authenticated with check (bucket_id='quote-uploads')`** (0012:22-25) — unauthenticated, any path | `${uuid}/${sanitize(name)}` (`quote-request.tsx:182-187`) | none → overwrite impossible |
| cad-files | no | 50 MB / none | `foldername[1] = auth.uid()` (0018) | `${user.id}/${project}/${uuid}-${name}` | none |
| project-images | no | 20 MB (0062) / none | `foldername[1] = auth.uid()` (0015) | user-id prefixed | none |
| payment-proofs | no | 8 MB / png,jpeg (0089) | `foldername[1] = auth.uid()` | `fawran-checkout.tsx:57` | none |
| engineering-files | no | 100 MB / none | user: `foldername[1]=auth.uid()`; admin: all (0091) | user-id prefixed | admin only |
| product-images, videos, studio-models | yes | videos 50 MB + MIME; studio-models 20 MB + MIME | super_admin only | admin forms | super_admin |

- Another user's path: blocked by `foldername[1] = auth.uid()` everywhere except quote-uploads (write-only, admin-read). Upsert/overwrite: no user bucket has an UPDATE policy, so `upsert:true` fails; client code uses `upsert:false`. Client-side size/MIME checks exist in forms but the real limits are the bucket settings above.
- Files are read through signed URLs on the Supabase origin, so an uploaded HTML/SVG cannot run script on the app origin.
- Direct table writes through the browser client are scoped by RLS (DB reviewer's area). The one browser-written column that is later rendered as markup is `project_schematic_revisions.svg` → WEB-01. `grep` of migrations/types finds no other svg/html column.

---

## 7. Logging

App code has 4 `console.log` (the baseline's 77 counts `scripts/*.mjs`): `cron/anonymous-cleanup` (2, counts), `lib/notifications/drain.ts:115` (sent/failed counts), a comment. No log prints auth headers, tokens, cookies, phone numbers, emails or briefs: auth callback logs codes/flags only (`route.ts:113-123`, keys only at `:131-134`); Turnstile logs error codes; YouTube logs status + error code. Raw objects logged: PostgREST error objects (`api/store-lead/route.ts:208-333`, `projects/recovery-email/route.ts:40`, `projects/claim/route.ts:38`, `schools/classes/actions.ts:240`, `youtube/callback/route.ts:95`) and `transcribe/route.ts:94` (first 300 chars of Groq error body). PostgREST `details` can echo a row value on constraint errors (e.g. a unique email) — low; prefer `error.code` + `error.message`.

---

## 8. Dependencies (from docs/audit/BASELINE.md, `npm ls` offline; no changelog fetched)

Paths: `sharp@0.35.4` top-level + via `next` + via `manifold-3d → @gltf-transform → ndarray-pixels`; `source-map-js@1.2.1` via `postcss@8.5.28` (top-level, autoprefixer, tailwind) and `next/node_modules/postcss@8.4.31`; `braces/micromatch/chokidar/postcss-selector-parser` via `tailwindcss@3.4.19`.

| Advisory | Reachable at runtime? | Action |
|---|---|---|
| sharp <0.35.5 (librsvg CVE-2026-96889, GHSA-wq5f-xc86-pv6w, as reported by npm audit; details not fetched) | **Yes, partially**: librsvg decodes SVG. `lib/store/store-image.ts:49` and `app/api/admin/drive-import/route.ts:47` accept any `image/*` incl. `image/svg+xml`, then `sharp(buf,{failOn:"none"})`. Inputs: admin-picked Drive files; product images fetched from supplier hosts (`/(^|\.)(digikey|mouser)\.com$/`, `store-cleanup`, `starter-parts`, `sourcing-backup`, supplier lookup). Admin-triggered only. `/_next/image` has no remote patterns and `dangerouslyAllowSVG` is off | WEB-05: `npm update sharp` (0.35.5, inside `^0.35.4`) + reject SVG |
| source-map-js 1.0.0-1.2.1 (DoS) | No — build-time (PostCSS/Tailwind/Next compile) | low-risk: `npm update postcss` (8.5.31 top-level); Next's nested copy follows Next |
| postcss ≤8.5.22 inside next (XSS in stringify, sourceMappingURL file read) | No — only our own CSS at build | fixed by a Next release that bundles newer postcss (not in 15.5.28 per npm audit range — unverified) |
| braces / micromatch / chokidar / postcss-selector-parser | No — Tailwind 3 build tooling | needs Tailwind 4 (planning) |
| next 9.3.4 - 16.3.0-preview.10 (SSG/ISR cache poisoning, GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p, moderate) | Advisory text says **self-hosted** apps; on Vercel likely not applicable (unverified). The app relies heavily on ISR | upgrade to 15.5.28 now; plan Next 16 |

**Low-risk (patch/minor inside existing ranges, `npm update`):** sharp 0.35.5, next 15.5.28, eslint-config-next 15.5.28, next-intl 4.14.9, zod 4.6.7 (patch, despite being listed as "planning" in the brief), @supabase/supabase-js 2.118.0, postcss 8.5.31, autoprefixer 10.6.1, google-auth-library 11.3.1, @radix-ui/react-slot 1.5.0, react/react-dom 19.3.1 (minor; App Router uses Next's vendored React, so mostly affects tests/types), vitest 4.1.12, @playwright/test 1.64.1, @react-three/fiber 9.8.2 (pinned exact — edit pin), @types/react(-dom) 19.3.0.
**Needs planning (majors / 0.x minors):** next 16.x (+ eslint-config-next 16; async request APIs already used, middleware→proxy naming, caching defaults, fixes postcss chain and the ISR advisories), tailwindcss 4 (+ tailwind-merge 3; config rewrite; removes the braces chain), eslint 10 (flat config only; FlatCompat in use), three 0.186 (+ @types/three, drei/fiber, three-bvh-csg 0.0.18 and three-mesh-bvh pins), lucide-react 1.x (icon renames), @supabase/ssr 0.12 (0.x minor = may change the cookie API; test sign-in, OAuth, guest claim, middleware refresh), typescript 7, vitest 5, @types/node (stay on 24.x to match `engines.node 24.x`, not 26). Changelogs for next-intl/@supabase/ssr were not fetched (reasoned from version numbers only).

---

## 9. SECURITY_REVIEW.md re-check

- **M5 "No security headers configured" — still open.** `next.config.mjs` has `rewrites()`, `redirects()`, `webpack()` but no `headers()`; `vercel.json` has only a host redirect + crons; no CSP/XFO/nosniff/Permissions-Policy set anywhere in code (only per-response `Referrer-Policy: no-referrer` on the rating and unsubscribe HTML routes). Next also sends `X-Powered-By: Next.js` (no `poweredByHeader:false`). HSTS: the review says Vercel handles it — not re-verified (needs `curl -sI https://gestaltung360.com`).
- Its Info section is stale: "the service-role key is not used anywhere in app code" (baseline counts 76 references) and "every /dashboard/* page AND the shared dashboard/layout.tsx calls getSessionContext()" (≈35 dashboard pages now rely on a layout only — §3).
- `docs/cad-champions/SECURITY_REVIEW.md` **does not exist** in this repo (`ls docs/cad-champions` → No such file or directory; the only SECURITY_REVIEW*.md is `./SECURITY_REVIEW.md`).

---

## FINDINGS

### WEB-01 — High — Stored XSS against the super_admin via schematic revision SVG
- **Evidence:**
  - `components/prototyping/schematics-stage.tsx:130-136` — the browser writes the markup itself:
    `await supabase.from("project_schematic_revisions").insert({` … `svg,`
  - `supabase/migrations/0020_prototyping.sql:229-231` — any owner may insert any value:
    `create policy project_schematic_revisions_insert … with check (public.owns_schematic(schematic_id));` (`owns_schematic` = project owner or super_admin; anonymous guests are `authenticated`).
  - `components/prototyping/workspace.tsx:343-346` reads it back; `schematics-stage.tsx:317-320` renders it raw:
    `// Generated locally by lib/prototyping/schematic.ts … no user HTML reaches this.`
    `dangerouslySetInnerHTML={{ __html: shown.svg ?? "" }}`
  - Viewer: `/projects/[id]/prototyping` is super_admin-only (`prototyping/page.tsx:52-55`) and `owns_schematic` lets the admin read every project's revisions.
- **Exploit:** a client (or a guest) creates a project, then with their own JWT POSTs to `/rest/v1/project_schematic_revisions` `{schematic_id:<theirs>, rev:99, status:"ready", svg:"<img src=x onerror=…>"}`. When the owner opens that project's Engineer workspace (Design stage), the handler runs in the admin's session on the app origin. Supabase auth cookies are JS-readable (WEB-04), so the admin access + refresh tokens can be stolen → full super_admin (orders, payments, credits, customer PII, service actions). No CSP limits it (WEB-03).
- **Fix (behaviour-preserving):** stop trusting stored markup. Either (a) redraw at display time from the stored inputs (`drawSchematic({code,rev,kind,title,material,quantity,features})`; features are already reconstructable, `featuresOf`), keeping `svg` only as an export artefact; or (b) render stored SVG in an inert context, as `workspace.tsx:1018` already does: `<img src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)}>` (scripts and handlers never run in `<img>`); or (c) sanitise with DOMPurify (`USE_PROFILES:{svg:true}`) before injecting. Defence in depth: a NEW migration (0100+) revoking client INSERT/UPDATE on `svg` (column privilege) or moving revision creation into a SECURITY DEFINER RPC that renders server-side.
- **Proving test:** vitest + jsdom: render `SchematicsStage` with one revision whose `svg` is `<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="window.__x=1"/><foreignObject><img src="x" onerror="window.__x=1"></foreignObject></svg>`; assert the rendered DOM has no element with an `on*` attribute and no `<foreignObject>` (fails today, passes after fix). PGlite migration test for the column revoke: `insert … (svg)` as `authenticated` → permission denied.

### WEB-02 — Medium — Admin role checks live only in layouts; pages that use the service-role client can be rendered without them
- **Evidence:**
  - `app/[locale]/dashboard/customers/layout.tsx:18-20` holds the only role check; `customers/[id]/page.tsx:102-106` then reads auth data for an arbitrary id with the service key:
    `const service = createServiceClient();` … `await service.auth.admin.getUserById(id);`
    and renders it even when RLS returned nothing (`:117` `if (!profile && … && !auth) notFound();`, email shown at `:119,141`).
  - Same pattern: `customers/page.tsx:107-111` (`auth.admin.listUsers`, 10×1000 users fetched before any page-level check), `projects/page.tsx:77-82`.
  - Next 15.5.25 renders from the first segment that does not match the client-supplied router state: `node_modules/next/dist/server/app-render/walk-tree-with-flight-router-state.js:41-45`
    `const renderComponentsOnThisLevel = !flightRouterState || !matchSegment(actualSegment, flightRouterState[0]) || parallelRoutesKeys.length === 0 || flightRouterState[3] === 'refetch';`
    The state comes from the `Next-Router-State-Tree` request header (client-controlled). Layouts the client claims to have are not executed.
- **Exploit (confirmed from source, not executed end-to-end — needs a running server):** `curl -H 'RSC: 1' -H 'Next-Router-State-Tree: <url-encoded ["",{"children":[["locale","en","d"],{"children":["dashboard",{"children":["customers",{"children":["__PAGE__",{}]}]}]}]},null,null,true]>' https://host/en/dashboard/customers/<uuid>` with no cookies; if the `[id]` page renders, the RSC payload contains that user's email, sign-up and last-sign-in dates, provider and anonymous flag. Requires knowing a target UUID. Pages that only use the RLS client leak nothing this way (RLS still applies), and every server action has its own check.
- **Fix:** add a cached guard and call it at the top of every admin page/data loader that uses `createServiceClient()` (and ideally every admin page): `export const requireSuperAdmin = cache(async (locale) => { const s = await getSessionContext(); if (s?.profile.role !== "super_admin") redirect(...) ; return s; })`. Wrap `getAuthUser`/`getSessionContext` in React `cache()` so repeated checks cost one `getUser()` per request (today each layout/page call is a separate Supabase round trip).
- **Proving test:** vitest: mock `@/lib/auth/get-session` to return a `client` session (and `null`), call the default export of `customers/[id]/page.tsx` directly with params, assert it throws `NEXT_REDIRECT` before `createServiceClient` is called (spy). Optional e2e against a local `next start` + test project with the curl above → expect 307/redirect payload, not the email.

### WEB-03 — Medium — No security headers (SECURITY_REVIEW M5 still open)
- **Evidence:** `next.config.mjs` (whole file) has no `headers()`; `vercel.json` has no `headers`; `grep Content-Security-Policy|X-Frame-Options|frame-ancestors|Permissions-Policy|nosniff` in app/lib/middleware → none.
- **Impact:** no CSP to blunt WEB-01-class bugs or restrict exfiltration; no `X-Content-Type-Options`; no `frame-ancestors`. Clickjacking of signed-in actions is largely mitigated today because the Supabase cookies are `SameSite=Lax` (not sent in a cross-site iframe), but same-site framing and logged-out flows (quote form, checkout as guest) are not protected. `X-Powered-By` advertises Next.js.
- **Fix:** the `headers()` block below + `poweredByHeader: false`. Deploy CSP as `Content-Security-Policy-Report-Only` for one release, watch console/reports on Studio (WASM + workers), Drive Picker, Turnstile, GA, then enforce.
- **Proving test:** vitest importing `next.config.mjs` and asserting `await config.headers()` contains the five headers for `/:path*`; Playwright smoke: `page.on("console")` has no CSP violations on `/en`, `/en/store`, `/en/projects/new`, a Studio fixture (`/e2e-fixtures/studio`), `/en/design/quote` with Turnstile on.

### WEB-04 — Low — Supabase auth cookies are JS-readable and lack `Secure`
- **Evidence:** no `cookieOptions` in `lib/supabase/client.ts:6-9`, `server.ts:11-28`, `middleware.ts:29-40`; defaults `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11`: `path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60`.
- **Impact:** any XSS = session (access + refresh token) theft for 400 days; the cookie could go over plain HTTP on a first non-HSTS request. `httpOnly:false` is inherent to `createBrowserClient` (the browser client reads the session), so it cannot simply be flipped.
- **Fix:** pass `cookieOptions: { secure: process.env.NODE_ENV === "production" }` to all three clients (same value everywhere, else chunk names/attributes diverge); keep `SameSite=Lax`; explicit HSTS header (below). Long-term, a server-only session (no browser client) would allow HttpOnly — owner decision.
- **Proving test:** unit test on a small `supabaseCookieOptions()` helper used by all three clients; Playwright: after sign-in on the prod build, `context.cookies()` → `sb-*` cookies have `secure: true`.

### WEB-05 — Medium — sharp 0.35.4 (librsvg advisory) reachable through supplier/Drive image import; fetch has no size cap and follows redirects
- **Evidence:** `lib/store/store-image.ts:47-50`
  `const res = await fetch(u, { signal: AbortSignal.timeout(15000), cache: "no-store" })`
  `if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;`
  `return Buffer.from(await res.arrayBuffer());` → `store-image.ts:19` `sharp(buf, { failOn: "none" })`; `app/api/admin/drive-import/route.ts:47,51` same `startsWith("image/")` → `sharp(buf, …)`.
- **Exploit:** an SVG (served as `image/svg+xml`) on an allowed supplier CDN or in a Drive folder the admin picks is decoded by librsvg in the Vercel function. Host allow-list is checked on the first URL only; `fetch` follows redirects to any host. Whole body is buffered (memory DoS). All triggers are super_admin actions, so exposure is limited to supplier-controlled or admin-chosen files.
- **Fix:** `npm update sharp` (0.35.5, within range); allow only `image/jpeg|png|webp|gif|avif` (reject SVG) and confirm with `sharp(...).metadata().format`; `sharp(buf, { failOn: "error", limitInputPixels: 40e6 })`; cap bytes (check `content-length` and stop reading past e.g. 15 MB); `fetch(u, { redirect: "manual" })` or re-check the final `res.url` host.
- **Proving test:** vitest for `fetchImage` with an injected fetch returning `content-type: image/svg+xml` → `null`; with a redirect to a non-allowed host → `null`; with 20 MB body → `null`. `npm audit --omit=dev` no longer lists sharp.

### WEB-06 — Low — Unauthenticated, unlimited uploads to `quote-uploads`
- **Evidence:** `supabase/migrations/0012_quote_uploads.sql:22-25`
  `create policy quote_uploads_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'quote-uploads');` bucket 50 MB, no MIME list (`:17-19`).
- **Exploit:** anyone with the public anon key can store unlimited 50 MB objects of any type (storage cost / quota exhaustion). Not readable by others (select is admin-only), so not a hosting/XSS vector.
- **Fix (new migration 0100+):** add `allowed_mime_types` matching the quote form's CAD/PDF/image extensions; better, have `/api/design-quote` (after `checkTurnstile`) issue `createSignedUploadUrl` with the service client and drop the anon insert policy; add cleanup of orphaned objects older than N days.
- **Proving test:** PGlite migration test (pattern of `lib/schools/db/schools-migration.test.ts`): as role `anon`, insert into `storage.objects` (stubbed schema) for `quote-uploads` → denied after the migration.

### WEB-07 — Low — OpenSCAD engine loaded from public CDNs without integrity check
- **Evidence:** `lib/cad/render.ts:13-15` jsDelivr/unpkg `openscad-wasm-prebuilt@1.2.0`; `lib/cad/render.worker.ts:32` `await import(/* webpackIgnore: true */ url)`.
- **Impact:** a compromised CDN response runs as a same-origin worker (can make credentialed same-origin requests as the user). Version is pinned (npm content immutable), which limits but does not remove the risk.
- **Fix:** self-host the two files under `public/` (still zero cost), or fetch → verify SHA-384 against a constant → `import(URL.createObjectURL(blob))`.
- **Proving test:** vitest on the worker's loader with a fetch stub returning tampered bytes → load error.

### WEB-08 — Low — `/dashboard/contact` reachable by any signed-in client/workshop
- **Evidence:** `app/[locale]/dashboard/contact/page.tsx` has no role check and no role layout; only `dashboard/layout.tsx:33-41` (signed-in, non-guest).
- **Impact:** UI only — it shows the public phone and the editor; the save action is gated: `contact/actions.ts:15-16` `if (s?.profile.role !== "super_admin") throw new Error("forbidden");`.
- **Fix:** add `dashboard/contact/layout.tsx` with the same super_admin redirect as siblings (or the WEB-02 guard).
- **Proving test:** as WEB-02 (call page with client session → redirect).

### WEB-09 — Info — "● /[locale]/dashboard…" in the build table is a display quirk
- Proven in §3 (no HTML, not in prerender-manifest, pages and layout are `force-dynamic`). No action.

### WEB-10 — Info (unverified) — locale-param redirects on dotted paths
- **Evidence:** middleware matcher skips any path with a `.` (`middleware.ts:132`), so `/%2F%2Fevil.com/dashboard` reaches `app/[locale]` without next-intl normalising the locale; `dashboard/layout.tsx:40` does `redirect(\`/${locale}/sign-in\`)`. If Next decodes the param to `//evil.com` and the dashboard layout runs before `[locale]/layout.tsx:87-89` `notFound()`, the redirect would be `///evil.com/sign-in` (protocol-relative).
- **Expectation:** the parent layout's `notFound()` should run first on a normal request, so this is likely not exploitable. **Test:** `curl -sI 'http://localhost:3000/%2F%2Fevil.com/dashboard'` against `next start` → expect 404, never a `Location` beginning `//` or `///`. Cheap hardening: validate `locale` against `routing.locales` in the few pages/layouts that build redirects from it.

### WEB-11 — Info — legal/case-study link filter admits `//host`
- `lib/legal/markdown.ts:18` `const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i;` → `[x](//evil.example)` passes and renders via i18n `<Link>`. Owner-authored content only. Fix: `/^(https?:\/\/|mailto:|tel:|\/(?!\/))/i` (edit the parser, not content/legal/**). Test: `parseInline("[a](//x.y)")` → text node.

### WEB-12 — Info — Turnstile response not bound to hostname/action
- `lib/turnstile.ts:107-109` accepts `success === true` without checking `data.hostname`; a token minted on another site using the same site key is unlikely (keys are per-site). Optional: compare `hostname` with the site host.

### WEB-13 — Info — Logging
- §7: no secrets/PII logged deliberately; raw PostgREST error objects in ~6 places — log `code`/`message` only.

---

## Recommended `headers()` for next.config.mjs

External origins found in code (runtime, browser side):
- Supabase: `NEXT_PUBLIC_SUPABASE_URL` origin (REST/auth/storage signed URLs, public videos/models, `supabase.co` storage); realtime not used (no `.channel(`), wss kept harmless.
- GA4 (after consent): `https://www.googletagmanager.com` (script), `*.google-analytics.com`, `*.analytics.google.com` (collect).
- Cloudflare Turnstile: `https://challenges.cloudflare.com` (script + iframe).
- OpenSCAD engine: `https://cdn.jsdelivr.net`, `https://unpkg.com` (module import in worker + wasm fetch).
- Google Drive Picker (admin): `https://apis.google.com`, `https://accounts.google.com` (scripts), Picker iframe `https://docs.google.com` (+ `content.googleapis.com` — unverified, check in Report-Only).
- Images: `https://cdn.shopify.com` (preconnect, Voltaat), supplier/admin image URLs on arbitrary hosts (`image_url`), Supabase storage → `img-src https:` is required.
- Links only (no embed, no CSP need): youtube.com/youtu.be, wa.me, voltaat.com, digikey/mouser. **No YouTube iframe/embed exists** (grep `embed|<iframe` = 0). Fonts are self-hosted by `next/font` (no fonts.googleapis.com at runtime).
- Server-side only (not in CSP): googleapis.com (Drive/YouTube/Gemini), api.groq.com, api.resend.com, api.mouser.com, api.digikey.com, Cloud Run CAD worker, sts/iamcredentials/oauth2.

Why `'unsafe-inline'` for scripts: static/ISR pages carry ~50 inline Next RSC `<script>` blocks whose content changes per page/build, so hashes are not maintainable; nonces need a per-request render (forbidden on public static pages by project rule 6). A nonce-based policy can be layered later only on the already-dynamic areas (dashboard, projects, studio) via middleware — phase 2, unverified with next-intl's middleware composition. `'wasm-unsafe-eval'` is needed for manifold-3d and OpenSCAD WASM. Dev needs `'unsafe-eval'` (React refresh).

```js
// next.config.mjs — add inside nextConfig
const supabaseOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin; } catch { return ""; }
})();
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  [
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    isDev ? "'unsafe-eval'" : "",
    "https://www.googletagmanager.com",
    "https://challenges.cloudflare.com",
    "https://cdn.jsdelivr.net https://unpkg.com",
    "https://apis.google.com https://accounts.google.com",
  ].join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `media-src 'self' blob: ${supabaseOrigin}`,
  [
    "connect-src 'self'",
    supabaseOrigin,
    supabaseOrigin.replace(/^https:/, "wss:"),
    "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    "https://challenges.cloudflare.com",
    "https://cdn.jsdelivr.net https://unpkg.com",
    "https://www.googleapis.com https://content.googleapis.com",
    isDev ? "ws: http://localhost:*" : "",
  ].join(" "),
  "frame-src https://challenges.cloudflare.com https://docs.google.com https://accounts.google.com https://content.googleapis.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  isDev ? "" : "upgrade-insecure-requests",
].filter(Boolean).join("; ");

const securityHeaders = [
  // Step 1: ship as Content-Security-Policy-Report-Only for one release, then rename.
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

// in nextConfig:
poweredByHeader: false,
async headers() {
  return [{ source: "/:path*", headers: securityHeaders }];
},
```
Notes: `microphone=(self)` because `components/prototyping/dictation.tsx` records audio in the browser for `/api/transcribe`. `same-origin-allow-popups` keeps Google OAuth/Picker popups and `window.open` print working. `frame-ancestors 'self'` (not `'none'`) in case any page is framed by the site itself — none found; tighten to `'none'` if the Report-Only phase shows no self-framing. Vercel preview deployments with the Vercel toolbar need `https://vercel.live` in script-src/frame-src/connect-src (unverified; add only for `VERCEL_ENV==="preview"`). Static responses served from the CDN still get these headers (headers() applies at the edge), so this does not make ISR pages dynamic.

---

## Summary

1. One real exploitable bug: **WEB-01 (High)** stored XSS — client-writable `project_schematic_revisions.svg` is injected raw into the super_admin's Engineer workspace; with JS-readable auth cookies this is admin account takeover.
2. **WEB-02 (Medium)**: admin role checks sit only in layouts; Next 15 skips layouts the client claims to have (source-confirmed), so `customers/[id]` can leak any user's email/sign-in data via the service key (needs the UUID; not executed end-to-end).
3. **WEB-03 (Medium)**: M5 still open — no CSP, nosniff, frame-ancestors, Referrer/Permissions-Policy; a working Report-Only CSP for this app is given above.
4. **WEB-05 (Medium)**: sharp's librsvg advisory is reachable (SVG from supplier CDNs/Drive passes `image/*`); patch to 0.35.5 and reject SVG, cap size, stop following redirects.
5. All other HTML sinks (JSON-LD, QR, Studio/prototyping renderers, rating pages, every email template) escape correctly; React 19 blocks `javascript:` hrefs.
6. Redirect sanitising (`next`, callback, `returnTo`, OAuth/reset `redirectTo`) is sound; one dotted-path locale edge case is unverified (WEB-10, likely safe).
7. Dashboard "●" routes are a build-table quirk: no dashboard HTML in `.next`, none in prerender-manifest, all force-dynamic.
8. Cookies: Supabase auth cookies are `HttpOnly=false` (by design) and missing `Secure` (WEB-04); app-own cookies are fine.
9. No secret is bundled (bundle scan clean; only NEXT_PUBLIC_* reach the client); Turnstile verifies server-side; storage paths are uid-prefixed with no UPDATE policies, but `quote-uploads` accepts unlimited anonymous 50 MB uploads (WEB-06).
10. `docs/cad-champions/SECURITY_REVIEW.md` does not exist; the root SECURITY_REVIEW.md Info section is stale (service-role use, per-page gates). Low-risk `npm update` set and the planned majors (Next 16, Tailwind 4, ESLint 10, three, lucide 1, @supabase/ssr 0.12) are listed in §8.
