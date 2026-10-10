# Cut-over checklist: site_v2 ON for 100 % (P3-09)

Plan section 5.5, adapted to how the flag really works (`lib/site-v2.ts`, `middleware.ts`).
The flag only changes which page renders at `/`, `/how-it-works`, `/design` and `/store`; URLs do not change.
Nothing here is done by code: the owner flips the switch.

## 1. Preview v2 while the flag is OFF

1. Sign in as super_admin.
2. Open `/api/admin/site-v2-preview?locale=en` (or `?locale=ar`). It sets the cookie `site_v2=1` for 7 days and sends you to `/en/v2`.
3. Browse, in EN and AR:
   - `/en/v2`, `/en/v2/how-it-works`, `/en/v2/design`, `/en/v2/store`
   - `/ar/v2`, `/ar/v2/how-it-works`, `/ar/v2/design`, `/ar/v2/store`
4. v2 pages are `noindex` and their canonical points at the public URL while the flag is OFF.
5. Turn the preview off: `/api/admin/site-v2-preview?on=0` (clears the cookie, goes back to `/en`).

## 2. Verify before flipping

Tick each line. "E2E" = covered read-only by `npm run test:e2e`; "Manual" = needs a person with a test account (the suite never signs in or writes, because the app's Supabase is production).

### The five critical paths (EN and AR, at 375 px and desktop)

| # | Path | E2E (read-only) | Manual pass (real test account) |
|---|---|---|---|
| 1 | Idea -> BOM -> circuit -> cart -> checkout | Home "Plan a product" opens `/projects/new`; Start stays disabled until consent AND text; no overflow at 375 | Start, analyse, open the BOM, generate the circuit (1 credit), add to cart, check out |
| 2 | File -> quote | none | Drop a file on `/design`, fill `/design/quote`, send, check the lead email |
| 3 | Sketch -> drawing request | none | `/projects/new?for=drawing`, send, check the lead |
| 4 | Store search -> product -> cart | Search results, product page (Add to cart button present, "Frequently bought together" / "You may also need" section), `/store/checkout` with no cart redirects to `/store/cart` | Click Add to cart as a guest, open the cart, go to checkout, see the payment-methods line, place a TEST order |
| 5 | Sign-in -> orders | `/orders` without a session redirects to `/sign-in` | Sign in, open `/orders`, see the timeline |

Also covered by the suite: `/pricing` plan order (desktop and phone), `/institutions/proposal` prints as one A4 page in EN and AR, the `site_v2` flag behaviour (404 without cookie, 200 + noindex with it), and `<html lang dir>` per locale.

### Content and tracking

- [ ] No copy claims a capability the studio does not have (made in the Lusail studio; an engineer quotes the method; no partner workshops, no automatic method detection, no reprint promise).
- [ ] Pricing appears in exactly one place (`/pricing`) and is linked from everywhere else.
- [ ] Funnel events fire: open GA4 DebugView, load the site with `?debug_mode=1`, press Accept on the cookie bar, then walk the paths. Expect `path_chosen`, `project_created`, `bom_generated`, `circuit_generated`, `add_to_cart`, `checkout_started`, `order_placed`, `phone_captured`, `pricing_viewed`.
- [ ] `npm run build && npm run test:e2e` is green on this machine (all specs, both projects, both locales).
- [ ] `npm run typecheck`, `npm run lint`, `npm run test` and `node scripts/check-i18n-parity.mjs` are green.

### Lighthouse mobile (run on LIVE, 3 runs each, use the median)

```
npx lighthouse@13.5.0 https://gestaltung360.com/en           --only-categories=performance --form-factor=mobile --screenEmulation.mobile --output=json --output-path=./lh-home.json
npx lighthouse@13.5.0 https://gestaltung360.com/en/store     --only-categories=performance --form-factor=mobile --screenEmulation.mobile --output=json --output-path=./lh-store.json
npx lighthouse@13.5.0 https://gestaltung360.com/en/pricing   --only-categories=performance --form-factor=mobile --screenEmulation.mobile --output=json --output-path=./lh-pricing.json
```

Score = `categories.performance.score` x 100. Target: 90 or more on `/`, `/store`, `/pricing`. Do the "before" runs now (flag OFF) and the "after" runs after the flip. Do not run other heavy things meanwhile. (`node scripts/check-live.mjs` also prints the cache headers and checks that the second fetch is a HIT.)

## 3. How to flip

1. Supabase -> Table Editor -> `store_settings` -> row `key = site_v2` -> set `value` to `{"enabled": true}`.
   Or in the SQL editor:
   ```sql
   update public.store_settings set value = '{"enabled": true}' where key = 'site_v2';
   ```
2. In the dashboard press any Store save (Dashboard -> Store, for example save a setting). This revalidates the `store-settings` tag so the v2 pages stop sending `noindex`.
3. The middleware picks the flag up within 60 seconds per server instance. No deploy is needed.

## 4. Rollback

1. Set the value back to `{"enabled": false}` (same steps; deleting the row also means OFF).
2. Public URLs serve the old pages within 60 seconds. Nothing else to undo.

## 5. URLs to verify after the flip

Open each in EN and AR; check status, final URL and that it is the v2 page where noted.

| URL | Expected |
|---|---|
| `/en`, `/ar` | v2 home (hero with one CTA, founders block, paths row) |
| `/en/how-it-works`, `/en/design` | v2 pages |
| `/en/store` | v2 store landing |
| `/en/store?q=arduino` | search results, unchanged (the listing params skip the flag) |
| `/en/v2` | 308 -> `/en` (same for `/en/v2/how-it-works` -> `/en/how-it-works`, etc.) |
| `/en/parts` | 308 -> `/en/store` |
| `/en/credits` | 308 -> `/en/pricing` |
| `/en/cad-assistance` | 308 -> `/en/design/drawing` |
| `/en/design/upload`, `/en/design/jobs`, `/en/dashboard/jobs` | 308 -> `/en/design/quote` |
| `/en/dashboard/inventory` | 308 -> `/en/inventory` |
| `/en/dashboard/parts` | 308 -> `/en/dashboard/store` |

- [ ] `/sitemap.xml` has no `/v2` URL.
- [ ] Canonical tags on `/`, `/how-it-works`, `/design`, `/store` point at the public URL (never `/v2`), and the pages no longer carry `noindex`.
- [ ] Share cards: `/en/opengraph-image` is the English card, `/ar/opengraph-image` the Arabic card.
- [ ] The home page is still served from cache (`node scripts/check-live.mjs`: second fetch is a HIT).

## 6. Live numbers (fill in)

| Page | Lighthouse mobile before (flag OFF) | Lighthouse mobile after (flag ON) |
|---|---|---|
| `/en` | 81 | 79 |
| `/en/store` | 83 | 76 |
| `/en/pricing` | 89 | 87 |

Date: 2026-10-10   Run by: Claude Code from the owner's PC (Lighthouse 13.5.0, median of 3)   Notes: "before" = the plan's 10 Oct status note (flag OFF). "After" = live with site_v2 ON (flipped 2026-10-09 18:55 UTC) plus commits 2c16bc1 (hero without opacity 0) and a78a202 (supabase-js lazy, -65 kB first-load JS). CLS 0 everywhere, TBT 60-360 ms, simulated LCP 3-5 s; observed (unthrottled) LCP = FCP about 1.5 s. Run-to-run spread is about 8 points from this connection. The 90 target is not met; the owner accepted these scores on 2026-10-10.

## 7. After the cut-over (separate task, later; do not do it now)

- Remove the v1 page code (the old home, how-it-works, design hub and store landing treatment).
- Remove the `site_v2` flag, the middleware branch, `app/api/admin/site-v2-preview`, the `/v2` routes and `lib/site-v2*.ts`.
- Keep `/pricing`, `/trust`, `/students`, `/institutions` and `/orders` as they are.
