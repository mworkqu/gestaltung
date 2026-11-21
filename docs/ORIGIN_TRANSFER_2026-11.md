# Fast Origin Transfer — diagnosis and cuts (2026-11-21)

Fast Origin Transfer = bytes our functions, ISR renders and middleware send to Vercel's CDN. A page
that is static or ISR and still in the CDN cache costs nothing; every render, and every dynamic
request, leaves the origin and is billed.

**Evidence vs estimate.** Everything marked *(measured)* comes from this repo's own production build
(`npm run build`, 2026-11-21) or from the code. Everything marked *(estimate)* is arithmetic on top of
that: no Vercel usage breakdown was available when this was written. If the owner can open
Vercel → Usage → Fast Origin Transfer by path, the estimates below should be replaced by it.

## What the build says (measured)

| | |
|---|---|
| Routes in the build | 259 (pages + API) |
| Static | 9 |
| ISR | 43 (every public page; `revalidate=86400`) |
| Rendered per request | 207 |
| `/en` HTML | 488 kB raw, **90 kB gzipped** |
| `/en/store` HTML | 434 kB raw, **83 kB gzipped** |
| `/en/pricing` HTML | 485 kB raw, **88 kB gzipped** |
| `/en/cad-champions` HTML | 834 kB raw, **174 kB gzipped** |
| Inlined CSS in **every** page | 111 kB raw (~17–19 kB gzipped) — `experimental.inlineCss` |
| Shared first-load JS | 104 kB (static assets, not origin transfer after the first request) |

The 207 per-request routes are almost entirely the owner's own areas: 39 `/dashboard/**`,
32 `/cad-champions/admin/**`, ~20 other CC pages, the signed-in customer pages, and the API. No public
storefront or marketing page is dynamic — `scripts/origin-budget.mjs` now checks that on every build.

## Route table (grouped; per-route detail is in the build output)

| Route / file | Static, ISR or dynamic | Why dynamic | Cache-Control sent | Approx. response | Who hits it | Monthly bytes |
|---|---|---|---|---|---|---|
| `/[locale]` , `/store`, `/store/[sku]`, `/store/collections/[id]` | ISR 86400 | — | CDN default for ISR | 83–90 kB gz *(measured)* | people + every crawler | biggest single item *(estimate)* |
| marketing + legal (`/about` `/contact` `/how-it-works` `/pricing` `/design*` `/students` `/schools` `/institutions` `/trust` `/partners/*` `/case-studies*` `/terms` `/privacy` `/warranty` `/delivery-returns`) | ISR 86400 (the root layout's cached contact-phone read sets the window) | — | CDN default | 60–90 kB gz | people + crawlers | small: ~30 pages × 2 locales *(estimate)* |
| `/sitemap.xml` | ISR 86400 | — | CDN default | ~1 MB raw at ~1,300 SKUs × 2 locales *(estimate)* | crawlers | small (once a day per PoP) |
| `/robots.txt`, `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/[locale]/opengraph-image` | static | — | CDN default | tiny–16 kB | crawlers, social | negligible |
| `/store/search` (and `/store?q=…`, rewritten to it) | dynamic | `searchParams` | none | 83 kB gz | people; **crawlers are disallowed** | small *(estimate)* |
| `/projects/new`, `/sign-in`, `/sign-up`, `/forgot-password`, `/confirm-email`, `/reset-password`, `/join` | dynamic (`/join` is static) | `searchParams`; sign-in/up also a `no-store` fetch in `lib/auth/providers-server.ts` | none | 60–90 kB gz | people; `/projects/new` is in the sitemap and robots-allowed | small, but see "not done" |
| `/dashboard/**` (39) | dynamic | `force-dynamic` + `cookies()` in `app/[locale]/dashboard/layout.tsx` | none | 90–200 kB gz | the owner only | small *(estimate)* |
| `/cad-champions/admin/**` (32) | dynamic | `force-dynamic` + `requireCcStaff` in the admin layout | none | 90–200 kB gz | staff only | small *(estimate)* |
| other `/cad-champions/**` (public + signed-in) | mixed: landing, help, policies static/ISR; test, training, results, account dynamic (`requireCcUser`, `headers()`) | auth | CC pages carry `X-Robots-Tag: noindex` from the middleware | 90–174 kB gz | students; **no crawlers** | medium while a cohort is running *(estimate)* |
| `app/api/**` — 76 routes | all dynamic | route handlers | `no-store` where it matters; `/api/store/search` is `public, s-maxage=60, stale-while-revalidate=300` | small JSON, except the 3 generated PDFs, `/api/analyse` (NDJSON stream), `/api/studio/doc` (≤256 kB) and the two admin exports | signed-in people, the owner, crons | small *(estimate)*; **`/api/` is robots-disallowed** |
| `middleware.ts` | runs on every page request | matcher excludes `api`, `_next`, `_vercel`, `icon`, `apple-icon` and anything with a dot | sets `no-store` only on CC redirects | headers only, no body | everyone | negligible |

Callers from outside, in full: the five Vercel crons (daily/weekly, small JSON), the Mac Mini worker
(off today; when on it calls `POST /api/internal/revalidate` once per job and the cron routes probe
`GET <worker>/healthz`), and **nothing else** — there is no GitHub Actions schedule, no uptime check and
no keepalive in this repo. `cc-payments-expire` is in no scheduler here; if it runs hourly, it is from
something the owner set up outside the repo (docs/cad-champions/DEPLOY.md §4.1 suggests cron-job.org or
a GitHub Actions workflow).

## Top 5 suspects, ranked

1. **Crawlers re-rendering the catalogue.** ~1,300 published products × 2 locales ≈ 2,600 ISR pages at
   ~83 kB gzipped = **~215 MB for one full re-crawl** *(estimate; the page size is measured)*. A full
   `parts` purge (any admin store write, or a supplier sync that moved more than 100 products) makes
   the next crawl of all of them a fresh render. AI/SEO bots that send no customers were free to walk
   all of it. → **Fixed**: 15 AI/SEO agents disallowed; sitemap trimmed to products with a price.
2. **111 kB of inlined CSS in every single page response** *(measured)*: ~17–19 kB gzipped, i.e. roughly
   a fifth of every origin render, and it is never shared between pages. → **Not changed**: it is what
   took `/en` first paint from 2.7 s to 0.9 s (F-053). Owner's call — see "owner decisions" below.
3. **CAD Champions client polling** *(measured intervals)*: the grading screens polled every 5 s and the
   results page also called `router.refresh()` (a full RSC payload); the attempt clock re-synced every
   60 s; the lesson player pinged every 15 s. One hour with a results page open ≈ 720 requests.
   → **Fixed**: 10 s / 5 min / 60 s, which is ~360 + 12 + 60 per hour.
4. **Pages that are dynamic although the public can reach them**: `/projects/new` (in the sitemap AND
   robots-allowed), `/sign-in`, `/sign-up`. Every hit is an origin render, never cached *(estimate: small
   volume, but it is the one place a crawler can make an uncacheable public render)*. → **Not fixed**,
   see below.
5. **The owner's own dashboard and the CC admin** (71 of the 207 dynamic routes), at 90–200 kB gzipped a
   view *(estimate)*. Nothing to fix: they must be dynamic. Worth knowing when reading the usage graph —
   a day of admin work is tens of MB.

Not suspects, checked: `/public` is 440 kB in total (one 429 kB static prototype HTML), no route streams
a file from disk or proxies Supabase Storage, the three PDF routes are per-user and `no-store`, the one
public cacheable GET (`/api/store/search`) is already CDN-cached, and the middleware matcher already
skips `_next`, files and the API.

## What changed (and what it should save)

| Change | Before | After |
|---|---|---|
| robots.txt | every bot could crawl `/store/**` | GPTBot, OAI-SearchBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended, Bytespider, AhrefsBot, SemrushBot, PetalBot, Amazonbot, meta-externalagent, DataForSeoBot, MJ12bot, DotBot: disallowed sitewide. Googlebot, Bingbot, DuckDuckBot, Applebot, YandexBot unchanged |
| sitemap | every published, unmerged product | only those with a price |
| CC grading poll | 5 s (720/h) | 10 s (360/h) |
| CC attempt clock | 60 s (60/h) | 5 min (12/h) |
| CC lesson ping | 15 s (240/h) | 60 s (60/h) |
| build guard | none | `scripts/origin-budget.mjs` warns when a must-stay-cached route turns dynamic |

Already in place before this stage (verified, nothing to do): per-SKU cache purges with a full purge only
past 100 changed products (`lib/cache/catalog-tags.ts`); a sync that changed nothing purges nothing;
`youtube-retire` purges only when a site link actually changed; 24 h ISR expiry; `/api/` and the query
listings disallowed; `?q` over 64 chars and `?page` over 20 answered with 404; main-only builds.

## Not done, and why

- **`/projects/new` static.** It is public, in the sitemap, robots-allowed and dynamic only because of
  `?for=drawing`, which changes server-rendered copy and the price tiers. Making it static means
  splitting it into two routes (or moving the variant to the client), which changes a live funnel. Small
  saving, real risk: owner's call.
- **`experimental.inlineCss`.** Turning it off cuts ~17–19 kB gzipped from every origin render (~20 %)
  and gives the CSS back a shared, cacheable URL — at the cost of two render-blocking requests on a cold
  visit (first paint measured at 2.7 s vs 0.9 s on a throttled link). Owner's call.
- **Narrowing the middleware matcher.** The expected fix does not apply: the matcher already excludes
  `api`, `_next`, `_vercel` and every path with a dot (images, files, `robots.txt`, `sitemap.xml`), and it
  emits headers only, no body. Excluding `/store/**` would break the locale routing and the session
  refresh for a gain of nothing measurable.
- **Caching more public GETs at the CDN.** There is only one candidate left and it is already cached.
  `/api/cad-champions/time` is a clock; caching it would defeat it.
