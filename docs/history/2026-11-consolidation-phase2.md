# 2026-11 consolidation, phase 2: Vercel diet

Branch `consolidation-2026-11`. Goal: stop paying Vercel usage (builds, ISR
writes, function invocations) for a site with almost no visitors. One commit
per task; numbers re-measured on 2026-11-10 (the plan's 2026-11-02 figures were
not reused).

## 2.4 force-dynamic audit

### How it was measured

- `grep -rl "force-dynamic" app` (files, comments included).
- Rendering mode per page from the build itself: `.next/prerender-manifest.json`
  (a page is static/ISR when `/en/...` is in `routes`, or its param route is in
  `dynamicRoutes` = ISR on first visit) against `.next/server/app-paths-manifest.json`.
  The build's route table is not enough on its own: with the `[locale]`
  layout's `generateStaticParams`, a `force-dynamic` page is still printed as
  `●` (SSG) — only the missing Revalidate column gives it away.

### Before (and after: unchanged)

198 files contain `force-dynamic` (130 under `app/[locale]`, 68 under
`app/api`). 139 `[locale]` pages render per request: 110 with
`force-dynamic` on the page, 25 under a `force-dynamic` layout
(`cad-champions` 21, `cad-champions/admin` 1, `schools/classes` 3) and 4
dynamic only through request data.

- **CAD Champions (signed-in / per-user)** (18): `cad-champions/account/payments/[id]`, `cad-champions/account/payments`, `cad-champions/auth/continue (route)`, `cad-champions/e2e-fixtures/[fixture]`, `cad-champions (layout)`, `cad-champions/results/[attemptId]`, `cad-champions/results`, `cad-champions/results/share/[token]`, `cad-champions/training/[module]`, `cad-champions/training/certificates/[code]`, `cad-champions/training/exercises/[slug]`, `cad-champions/training/in-person`, `cad-champions/training/join/checkout`, `cad-champions/training/join`, `cad-champions/training/join/return`, `cad-champions/training/lessons/[slug]`, `cad-champions/training`, `cad-champions/verify/[code]`
- **CAD Champions admin** (35): `cad-champions/admin/emails`, `cad-champions/admin/exercises/[slug]`, `cad-champions/admin/exercises/new`, `cad-champions/admin/exercises`, `cad-champions/admin/get-ready`, `cad-champions/admin/glossary`, `cad-champions/admin/health`, `cad-champions/admin/help/[id]`, `cad-champions/admin/help/new`, `cad-champions/admin/help`, `cad-champions/admin/insights`, `cad-champions/admin/insights/report (route)`, `cad-champions/admin/landing`, `cad-champions/admin (layout)`, `cad-champions/admin/lessons/lesson/[id]`, `cad-champions/admin/lessons/levels/[id]`, `cad-champions/admin/lessons/modules/[id]`, `cad-champions/admin/lessons`, `cad-champions/admin/operations/audit`, `cad-champions/admin/operations/deletions`, `cad-champions/admin/operations`, `cad-champions/admin`, `cad-champions/admin/payments`, `cad-champions/admin/plans`, `cad-champions/admin/questions`, `cad-champions/admin/review/[taskResultId]/file (route)`, `cad-champions/admin/review/[taskResultId]`, `cad-champions/admin/review`, `cad-champions/admin/students/[id]`, `cad-champions/admin/students/export (route)`, `cad-champions/admin/students/in-person`, `cad-champions/admin/students`, `cad-champions/admin/tests/[slug]`, `cad-champions/admin/tests/new`, `cad-champions/admin/tests`
- **Customer account, auth, checkout** (18): `confirm-email`, `my-inventory`, `orders/[id]`, `orders`, `projects/[id]/engineering`, `projects/[id]`, `projects/[id]/prototyping`, `projects/[id]/request`, `projects/[id]/studio`, `projects`, `reset-password`, `schools/classes (layout)`, `schools/classes`, `sign-in`, `sign-up`, `store/checkout/checkout-client.tsx`, `store/checkout`, `tokens`
- **Dashboard (super admin / signed in)** (51): `dashboard/ai-costs/[userId]`, `dashboard/ai-costs (layout)`, `dashboard/ai-costs`, `dashboard/contact`, `dashboard/credits (layout)`, `dashboard/credits`, `dashboard/customers/[id]`, `dashboard/customers (layout)`, `dashboard/customers`, `dashboard/engineering-jobs/[id]/snapshot (route)`, `dashboard/engineering-jobs (layout)`, `dashboard/engineering-jobs`, `dashboard (layout)`, `dashboard/leads/[id]`, `dashboard/leads`, `dashboard/notifications (layout)`, `dashboard/notifications`, `dashboard/overview`, `dashboard`, `dashboard/payments (layout)`, `dashboard/payments`, `dashboard/projects (layout)`, `dashboard/projects`, `dashboard/reviews`, `dashboard/store/[id]/edit`, `dashboard/store/attributes`, `dashboard/store/discounts`, `dashboard/store/fix`, `dashboard/store/gaps`, `dashboard/store/import`, `dashboard/store (layout)`, `dashboard/store/new`, `dashboard/store/occasions`, `dashboard/store/orders/[id]`, `dashboard/store/orders`, `dashboard/store/overview`, `dashboard/store`, `dashboard/store/quick`, `dashboard/store/restock`, `dashboard/store/schools`, `dashboard/store/stock`, `dashboard/store/suppliers/import`, `dashboard/store/suppliers/lookup`, `dashboard/store/suppliers`, `dashboard/store/suppliers/voltaat`, `dashboard/store/youtube`, `dashboard/studio-library/[id]`, `dashboard/studio-library (layout)`, `dashboard/studio-library`, `dashboard/usage (layout)`, `dashboard/usage`
- **e2e fixtures (local test only)** (8): `e2e-fixtures/cad-cloud`, `e2e-fixtures/dashboard-fix`, `e2e-fixtures/dashboard`, `e2e-fixtures/hero-poster`, `e2e-fixtures/orders`, `e2e-fixtures/quote-calc`, `e2e-fixtures/studio-request`, `e2e-fixtures/studio`
- **API route handlers (app/api/**)** (68): `api/admin/customers/[id]/export (route)`, `api/admin/drive-import (route)`, `api/admin/notifications/test (route)`, `api/admin/projects/[id]/export (route)`, `api/admin/sourcing-backup (route)`, `api/admin/starter-parts (route)`, `api/admin/store-cleanup (route)`, `api/admin/voltaat-import (route)`, `api/admin/voltaat-sync (route)`, `api/admin/youtube/callback (route)`, `api/admin/youtube/connect (route)`, `api/admin/youtube/upload (route)`, `api/analyse (route)`, `api/auth/callback (route)`, `api/auth/claim-guest (route)`, `api/billing/checkout (route)`, `api/billing/proof (route)`, `api/billing/service (route)`, `api/bom/electronics (route)`, `api/bom/match (route)`, `api/brief-chat (route)`, `api/cad-champions/attempts/[id]/status (route)`, `api/cad-champions/certificates/[code] (route)`, `api/cad-champions/payments/[id]/receipt (route)`, `api/cad-champions/payments/[id]/status (route)`, `api/cad-champions/payments/skipcash/webhook (route)`, `api/cad-champions/results-template (route)`, `api/cad-champions/results/[attemptId]/report (route)`, `api/cad-champions/time (route)`, `api/cad-champions/video/[ref] (route)`, `api/cad (route)`, `api/cron/anonymous-cleanup (route)`, `api/cron/cc-payments-expire (route)`, `api/cron/cc-weekly-progress (route)`, `api/cron/delivery-promises (route)`, `api/cron/notifications (route)`, `api/cron/supplier-refresh (route)`, `api/cron/voltaat-sync (route)`, `api/cron/youtube-retire (route)`, `api/demand (route)`, `api/engineering/jobs/[id]/cancel (route)`, `api/engineering/jobs/[id]/return (route)`, `api/engineering/jobs (route)`, `api/firmware (route)`, `api/netlist (route)`, `api/notifications/unsubscribe (route)`, `api/orders/confirmation (route)`, `api/orders/rate (route)`, `api/orders/review (route)`, `api/projects/claim (route)`, `api/projects/name (route)`, `api/projects/recovery-email (route)`, `api/studio/doc (route)`, `api/studio/enclosure (route)`, `api/studio/firmware (route)`, `api/studio/mech (route)`, `api/studio/pick (route)`, `api/studio/product/check (route)`, `api/studio/product/choose (route)`, `api/studio/product/design (route)`, `api/studio/product/engineer (route)`, `api/studio/product/model (route)`, `api/studio/product/preview (route)`, `api/studio/product/unlock (route)`, `api/studio/spec (route)`, `api/studio/tokens (route)`, `api/studio/wiring (route)`, `api/transcribe (route)`

(`store/checkout/checkout-client.tsx` only mentions the word in a comment.)

### Every dynamic page that a visitor without an account can open

| Page | Why it is dynamic | Decision |
|---|---|---|
| `/{locale}/store/search` | `searchParams` (the /store?q=… listing, rewritten here) | Stays dynamic by design (unbounded query space); now capped and disallowed in robots.txt (2.3). |
| `/{locale}/[...rest]` | catch-all 404 | Stays. |
| `/{locale}/sign-in`, `/sign-up` | `force-dynamic`; reads the session (signed-in users are sent on) and `?next=` | Auth page: stays. |
| `/{locale}/forgot-password` | `searchParams` (`?expired=1` message) | Auth page: stays. Could become static by reading `expired` in the client form; not done (out of 2.4's rule). |
| `/{locale}/reset-password`, `/confirm-email` | `force-dynamic`; read the auth code from the query | Auth flow: stays. |
| `/{locale}/projects/new` | `searchParams` (`?for=drawing` switches the whole page) | Stays. Could be split into two static pages later. |
| `/{locale}/tokens` | `force-dynamic`; shows the visitor's own balance (session) | Session page: stays. |
| `/{locale}/store/checkout` | `force-dynamic`; cart with session | Checkout: stays (rule). |
| CAD Champions public pages (`/cad-champions/{en,ar}`, `help`, `help/[slug]`, `privacy`, `terms`, `refunds`, `get-ready`, `sign-in`, `sign-up`, `forgot-password`, `reset-password`, `check-email`, `test`, `training/instruments`, `training/join`, `verify/[code]`, `training/certificates/[code]`, `results/share/[token]`) | `app/[locale]/cad-champions/layout.tsx` is `force-dynamic` and reads the session for the header account menu (`getCcUser()`); `verify`, `certificates`, `share` also read per-token data | Stays: session-dependent, not a store_settings/flag read. All CC pages are `noindex`. Making them static means moving the CC header's session read to the client — a CC change for a later phase. |

**Pages converted: none.** No public page was dynamic only because it read
store_settings or a flag: every store_settings read on a public page already
goes through the cookie-free anon client + `unstable_cache`
(`lib/store/public-catalog.ts`, `getTurnstileSettings`, contact phone), and
the site_v2 flag was retired in phase 1. All other public pages (home, store,
product pages, collections, marketing, legal, pricing, partners, schools,
students, institutions, design, case studies) were already static or ISR and
still are. The remaining public dynamic pages are listed above with the reason
each one keeps reading the request.

Auth-gated pages (dashboard, my-inventory, orders, projects, studio,
schools/classes, CAD Champions account/admin/training/results), checkout and
every API route keep `force-dynamic`; nothing there was touched.
