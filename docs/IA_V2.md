# IA v2 sign-off sheet (P3-01)

Source: `03-Website-Upgrade-and-Rebuild-Plan.md` §5.1 (sitemap), §5.2 (home order), §5.3 (design), §5.4 (flag), §5.5 (cut-over).
Status of each page is checked against `app/[locale]/*` after Phases 1–2 (2026-10-09).
Legend: **keep** = already matches IA v2, not duplicated under v2 · **rebuild** = new v2 version under the flag · **new** = does not exist yet.

## 1. Sitemap

| Route | Plan §5.1 | Today | Decision |
|---|---|---|---|
| `/` | Home | Founder-first home (hero, founders, paths, videos, featured, students row, callback, trust block) | **Rebuild (v2)** — see section 2 |
| `/how-it-works` | Three paths, persona story + video, four steps | Exists, v1 layout | **Rebuild (v2)** |
| `/design` | Upload → quote · drawing service (prices) · in-house | Exists (hub, `/design/quote`, `/design/drawing`) | **Rebuild (v2)** hub only; quote + drawing sub-pages stay |
| `/store` | Catalogue, collections, product page with source and lead time | Listing + product page + cart + checkout | **Rebuild (v2)** landing/hero treatment only; listing, search, product page, cart, checkout stay |
| `/store/collections/[id]` | Occasion collections | Missing | **New** (P3-07) |
| `/pricing` | Plans, FAQ, credits once | Done (P1-06) | **Keep** |
| `/trust` | Files, support, legal identity, guarantee | Done (P1-04) | **Keep** |
| `/students` | Secondary entry | Done (P1-02) | **Keep** |
| `/institutions` (+ `/proposal`) | Pilot, licence tiers, one-pager | Done (P2-05) | **Keep** |
| `/orders` (+ `/[id]`) | History + status timeline | Done (P2-01) | **Keep** |
| `/about` | Why · studio · team · equipment | Why, who, made in-house, partners present; no separate team or equipment block | **Keep**; add team + equipment blocks in the v2 content pass (owner supplies photos and copy) |
| `/contact`, legal pages | Unchanged | Unchanged | **Keep** |
| `/projects …` | Workspace, unchanged core | Unchanged | **Keep** (dense app layout stays) |

Pages marked **keep** already use the Phase 1–2 neu system, so the flag never serves two copies of them.

## 2. Home section order (plan §5.2) vs what exists

| # | Plan section | Today | v2 work |
|---|---|---|---|
| 1 | Hero | Neu card, H1 + line + one CTA + proof line | Rebuild: larger hero scale; no nested cards |
| 2 | Built for founders | Three outcome cards | Keep content; flat tiles |
| 3 | Paths row (Plan / Make / Shop) | Three cards with drop zone and search | Keep, compact |
| 4 | 45-second video | "See it work" (placeholders until clips exist, P3-04) | Keep |
| 5 | Featured kits and products | Featured products grid | Add kits once P3-07 lands |
| 6 | How credits work | **Missing** | **New**: one diagram, links to `/pricing#credits` |
| 7 | Trust block | Site-wide block above the footer | Keep |
| 8 | Student / school entry | Slim row → `/students` | Keep |
| 9 | Callback form, footer | Present | Keep |
| + | Signed-in "Your work" strip | Missing | **New** (P3-05), above the hero for returning users; must not make `/` dynamic (client fetch) |

Also new on pages that stay: "Frequently bought together" on product pages (P3-06).

## 3. Design direction (plan §5.3)

Keep palette, Outfit, JetBrains Mono, IBM Plex Sans Arabic, cobalt as the only accent. v2 changes: larger hero type, no cards in cards, blueprint motif only in hero and dividers. The unified scale (headings, gaps, padding, kicker, flat `.tile`) is in `DESIGN.md`, "Scale & rhythm (2026-10 audit)".

## 4. Flag mechanics

- `site_v2` lives in `store_settings` (`{"enabled": false}`, no row = off), read in `middleware.ts` (cached; no request-time DB hit on static pages).
- v2 pages live under `app/[locale]/v2/*`; middleware rewrites `/…` to `/v2/…` only while the flag is on.
- While the flag is off, `/v2/*` is reachable by URL but `noindex` and absent from the sitemap.
- Old pages stay until cut-over (P3-09); then redirects and the old files are removed.
- Home and store stay static/ISR: the flag is resolved in middleware, never with `cookies()` or `headers()` in the page.

## 5. Open points for the owner

1. Approve section 1 (which pages are rebuilt, which are kept as they are).
2. Approve the home order in section 2, including where the credits diagram sits.
3. Supply team and equipment content for `/about`, or accept v2 without them.
4. Confirm the cut-over bar from §5.5: Lighthouse mobile at least 90 on `/`, `/store`, `/pricing` (live).

## Sign-off

| | |
|---|---|
| Approved by (owner name) | |
| Date | |
| Changes requested | |
