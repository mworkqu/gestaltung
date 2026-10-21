# ISR writes: what they are and how we keep them low

## What an ISR write is

The public pages (home, `/store`, every product page, the marketing pages) are
not built fresh for each visitor. The first visit to a page renders it once and
Vercel saves that finished HTML; everyone after that gets the saved copy. Each
time Vercel saves a page like that, it counts one **ISR write**. The Hobby plan
allows 200,000 a month.

We have about 1,318 published products and two languages, so there are roughly
2,600 product pages, plus the store listing, the category views and the home
page. If something makes the whole store re-render, that is ~2,600 writes in
one go — not from customers, but from the pages being rebuilt.

## What was eating them

September/October 2026 hit 241,000 writes against the 200,000 limit. Almost
none of it was traffic:

- **Deploys plus re-crawling.** Every deploy throws the saved pages away. The
  next crawl, link-checker or bot sweep renders them all again, and each one is
  a write. Several deploys a day while developing the store is the single
  biggest cost on this list.
- **The daily crons.** The Voltaat and Mouser/DigiKey syncs purged the whole
  store on every run, whether or not a single price had moved.
- **Saving the contact number.** The dashboard save purged the catalogue *and*
  every page under the root layout — the entire site for one phone number.
- **One purge for everything.** Any single-product edit purged the `parts`
  cache tag, which re-renders all ~2,600 product pages.

## What changed

- Pages are kept for 24 hours instead of 5 minutes (done earlier, 2026-10-16).
- The crons purge only when the run actually changed, dropped or re-listed
  something. A quiet day now costs nothing, and the reply says so.
- Saving the contact number purges only the number's own cache tag
  (`contact-phone`). The number is still correct everywhere immediately.
- Each product's cached reads carry a `part-<sku>` tag as well as `parts`, so
  an edit that only its own page can show — a description, an Arabic text, the
  specs, the pack size — refreshes that one product (2 writes) instead of the
  catalogue (~2,600).
- Anything that changes a name, price, photo, category, material, minimum
  quantity or the published flag still purges everything, because the listing,
  the filters and the search results carry those too. A stale price shown to a
  customer is far worse than a write.

## Habits that keep the number down

1. **Deploy in batches.** Finish a few changes, then deploy once. Ten deploys
   in an afternoon can cost more than a month of customer traffic.
2. **Don't re-crawl the store for fun.** Sitemap checks, SEO crawlers, link
   checkers and "open every product to look" sweeps each render pages that were
   thrown away by the last deploy. Check a handful of pages, not all 2,600.
3. **Prefer one bulk edit to many small ones.** Fifty single edits that each
   touch a price purge the catalogue fifty times.
4. **Leave `revalidate` alone.** 86,400 seconds (24 h) is deliberate; lowering
   it multiplies writes by the same factor.
5. **Be suspicious of `revalidatePath("/", "layout")`.** It means "the whole
   site". It is almost never what a single save needs.

## Checking the current usage

Vercel dashboard → the project → **Usage** (or the team's Usage page) → the
**ISR Writes** row, under Edge/Function usage. It shows the usage against the
200,000 included on Hobby.

It does **not** reset on the 1st of the month. Vercel counts over a rolling
30-day window, so once you are over the limit you do not wait for a new month —
the old days drop off the back of the window one at a time and the number comes
down on its own. Deploying less while you wait is what makes it come down
faster. Upgrading to Pro is the other way out, and is only worth it if the
limit is actually blocking you.

Worth a look after any day of heavy deploying; if it is climbing without
customers, something is purging too broadly.
