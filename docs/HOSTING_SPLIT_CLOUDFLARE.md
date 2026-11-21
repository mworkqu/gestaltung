# Hosting split, step 1: Cloudflare in front of Vercel

Owner said yes on 2026-11-21. This is the rule list and the DNS records for **you** to apply — Claude
never touches your Cloudflare, Vercel or registrar account. Nothing in the code changes for this step;
it is all configuration. Read §7 before you start: there is one real trade-off to decide.

**Cost: none.** Cloudflare **Free plan** (DNS, the reverse proxy, Page Rules and Cache Rules, universal
SSL). No card, no Workers, no Argo, no Pro feature. Vercel stays on Hobby.

## 1. What this buys, and what it does not

Today every crawl of a product page that is not in Vercel's cache is an origin render: ~83 kB gzipped
leaves our functions (measured — `docs/ORIGIN_TRANSFER_2026-11.md`). With Cloudflare in front and an
HTML cache rule, that page leaves Vercel **once per Cloudflare location per TTL** instead of once per
purge-and-crawl. Bot-driven Fast Origin Transfer should fall to near zero; what is left is your own
admin work and real customers *(estimate)*.

It does **not** make the site faster for you, does not reduce Vercel function *invocations* much, and
does not touch ISR writes. It is a transfer fix.

## 2. Why caching our public HTML is safe

The public pages already render identically for every visitor: `app/[locale]/layout.tsx` reads no
cookies, and the signed-in state in the header comes from the browser (`components/header-nav.tsx` is a
`"use client"` component using `useAuth`). Public responses also carry no `Set-Cookie` (Phase G).
So a cached copy cannot leak one visitor's state to another **on the paths in §5**. Everything else
stays uncached — that is why §5 is an allow-list, not a block-list.

## 3. Order of operations (do not reorder)

1. Add `gestaltung360.com` to Cloudflare (Free plan). Cloudflare reads your current DNS; check every
   record it imported, above all the **MX and TXT records for email** (Resend/Google verification). A
   missing MX record stops your mail.
2. Change the nameservers at your registrar to the two Cloudflare gave you. Wait until Cloudflare says
   "Active".
3. Keep every record **grey-cloud (DNS only)** for now, so Vercel still sees the domain directly.
4. In Vercel → Project → Settings → Domains, confirm `gestaltung360.com` and `www.gestaltung360.com`
   are still Valid and the certificate is issued. Vercel cannot verify a domain or issue a certificate
   *through* an active proxy, so this has to be green before step 6.
5. Set Cloudflare → SSL/TLS → Overview to **Full**. Not Flexible (it causes a redirect loop with
   Vercel), not "Strict (SSL-Only Origin Pull)". Full (strict) also works and is what Vercel's current
   guide prefers; if the domain goes 5xx on Full (strict), drop back to Full.
6. Turn the **orange cloud on** for the apex record and for `www`. From this moment traffic goes
   browser → Cloudflare → Vercel.
7. Add the cache rules in §5, then verify with §6.

## 4. DNS records

Use **exactly the values Vercel's own dashboard shows** for this project (Settings → Domains → the
domain → "View DNS records"). Do not copy an IP address out of any documentation, this file included:
Vercel has changed them before, and a stale apex A record takes the site down.

The shape is:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` (gestaltung360.com) | the apex IP Vercel shows | Proxied (orange) after step 4 |
| CNAME | `www` | the hostname Vercel shows (`cname.vercel-dns.com`-style) | Proxied (orange) after step 4 |
| MX / TXT | as imported | unchanged | DNS only (grey) — never proxy mail |

`www` → apex stays a Vercel redirect (`vercel.json`), which Cloudflare passes through.

## 5. Cache rules — cache ONLY these paths

Cloudflare → Caching → Cache Rules → Create rule. Default behaviour (no rule) does not cache HTML, so
anything not listed here keeps going to Vercel on every request, which is what we want for the
signed-in and admin areas.

**Rule 1 — "storefront HTML"**
- When: `(http.request.uri.path matches "^/(en|ar)/store/[^/]+$") or (http.request.uri.path matches "^/(en|ar)/store$") or (http.request.uri.path matches "^/(en|ar)/store/collections/[^/]+$")`
- And: `http.request.method eq "GET"` and `not http.request.uri.query contains "q="`
- Then: Cache eligibility → **Eligible for cache**; Edge TTL → **Override origin, 4 hours**;
  Browser TTL → Respect origin.

**Rule 2 — "marketing, legal and home HTML"**
- When: `http.request.uri.path matches "^/(en|ar)(/(about|contact|how-it-works|pricing|design|design/drawing|design/quote|students|schools|institutions|institutions/proposal|trust|partners/schools|partners/accelerators|case-studies|case-studies/[^/]+|terms|privacy|warranty|delivery-returns|join))?$"`
- And: `http.request.method eq "GET"`
- Then: Eligible for cache; Edge TTL → **Override origin, 24 hours**; Browser TTL → Respect origin.

**Rule 3 — "sitemap, robots and the share images"**
- When: `http.request.uri.path in {"/sitemap.xml" "/robots.txt" "/manifest.webmanifest" "/icon" "/apple-icon"} or http.request.uri.path matches "^/(en|ar)/opengraph-image$"`
- Then: Eligible for cache; Edge TTL → Override origin, 24 hours.

Leave `/_next/static/*` alone: Vercel already serves it with immutable headers and Cloudflare caches it
by default.

**If Cache Rules will not cache the HTML** (reported on some Free zones), use Page Rules instead — the
Cache Everything setting is documented as available on every plan. Free gives you 3 page rules, which is
exactly enough: `gestaltung360.com/en/store*`, `gestaltung360.com/ar/store*`, and one for the rest, each
with *Cache Level: Cache Everything* + *Edge Cache TTL*. Note the Free-plan floor: **the lowest Edge
Cache TTL on Free is 2 hours.**

## 6. Must never be cached (verify after §5)

These must show `cf-cache-status: DYNAMIC` or `BYPASS`. None of them matches a rule above, so this is a
check, not more configuration:

`/api/*` · `/{en,ar}/dashboard*` · `/{en,ar}/orders*` · `/{en,ar}/projects*` · `/{en,ar}/my-inventory` ·
`/{en,ar}/account*` · `/{en,ar}/tokens` · `/{en,ar}/store/cart` · `/{en,ar}/store/checkout*` ·
`/{en,ar}/store/search` · `/{en,ar}/store?…` (any query) · `/{en,ar}/sign-in` · `/sign-up` ·
`/reset-password` · `/confirm-email` · `/forgot-password` · `/{en,ar}/handoff/*` · **everything under
`/cad-champions/`** (students, staff, sticky Arabic cookie, `noindex`).

If you ever add a rule with a wildcard, keep `/cad-champions/` and `/store/cart` out of it by hand.

## 7. The trade-off you need to decide

Today a Dashboard → Store save purges Vercel's cache and the new price is live at once. With rule 1 in
place, Cloudflare keeps the old HTML for up to its Edge TTL — **4 hours** as written above. Prices,
stock and "Arrives by" would lag by that much for a visitor whose nearest Cloudflare location already
has the page.

Three ways out, pick one:
- **(a) Accept 4 hours** (or 2, the Free floor). Simplest, nothing to build. Recommended to start with:
  Voltaat prices move once a day anyway.
- **(b) 24 hours on marketing and legal, 2 hours on the store.** Same as (a), slightly fresher store.
- **(c) Purge Cloudflare when we purge Vercel.** A small code change: `revalidateStorefront()` and the
  per-SKU purge also call Cloudflare's purge-by-URL API. Needs a Cloudflare API token with
  *Zone → Cache Purge → Edit* and the zone id, both as Vercel env vars. Then the Edge TTL can be 24 h
  everywhere and an admin edit is live in seconds. Say the word and I will build it — I will need the
  zone id, and **you** create and paste the token (I never handle secrets).

## 8. Verify it works

```bash
curl -sI https://gestaltung360.com/en/store/VLT-31976620458086 | grep -iE "cf-cache-status|x-vercel-cache|cache-control|server"
```

Run it twice. The second response should say `cf-cache-status: HIT`. Then:

```bash
curl -sI https://gestaltung360.com/en/dashboard | grep -i cf-cache-status
```

That one must **not** be a HIT. Also check, in a signed-in browser, that the header still shows your
account on a storefront page (it is client-side, so it must), that `/en/store/cart` shows your cart, and
that adding to the cart still works.

Then watch Vercel → Usage → Fast Origin Transfer for two or three days and compare with
`docs/ORIGIN_TRANSFER_2026-11.md`.

## 9. Rollback

Turn the orange cloud **off** on the apex and `www` records (one click each). Traffic goes straight to
Vercel again and the cache rules stop applying. Keep the nameservers at Cloudflare; nothing else needs
undoing. If the site is already broken when you do this, also purge everything (Caching → Configuration
→ Purge Everything).

## 10. What this step does not include

- No static export and no second build: `/store/[sku]` reads Supabase, so it cannot move to a static
  host. Cloudflare Pages / GitHub Pages stay the option B of the gate plan, worth doing only if §8 shows
  this was not enough.
- No change to the Mac Mini worker (still OFF), to the migrations, or to any code.
- Our own per-IP rate limits keep working: `lib/rate-limit.ts`, `lib/turnstile.ts` and
  `lib/credits/server.ts` all read the **first** `x-forwarded-for` hop, which Cloudflare sets to the
  real visitor. Nothing to change. (Vercel's own bot protection and request logs are a different
  matter: once the proxy is on they see Cloudflare's IPs unless you register it — Vercel's "verified
  proxy" guide covers that. Read it before turning the proxy on if you rely on those.)
