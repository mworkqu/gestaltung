# Who supplies a part, and how long it takes

Owner's rule, 2026-10-19. Two numbers decide everything a customer sees about
a part's delivery: **who we buy it from** and **how long that supplier takes**.

---

## The running order

When more than one supplier can supply the same part, this is the order:

| # | Supplier | We promise | Why it is there |
|---|----------|-----------|-----------------|
| 1 | **Own stock (Lusail)** | next day | it is already on our shelf |
| 2 | **Voltaat** | 2 days | local, but it still has to come to us |
| 3 | **DigiKey** | 2 weeks | ordered and flown in |
| 4 | **Mouser** | 2 weeks | same |
| 5 | anyone added later | — | sits after the four above |
| 6 | Alibaba / AliExpress | — | last |

**Availability still comes first.** A part we do not actually have cannot beat
one Voltaat can ship today. "Mine first" means *first among the suppliers who
can actually supply it*. Only after that does the order above apply, and only
then price.

Full order used to pick the offer: **pinned offer** (if you pinned one) ->
**in stock** -> **the table above** -> **fewest days** -> **cheapest landed
cost** -> **oldest offer**.

### Changing the order later

It is one number per supplier, `suppliers.rank` — lower goes first. Change it
and every part that supplier touches is re-derived automatically. In SQL:

```sql
update public.suppliers set rank = 15 where code = 'voltaat';
```

The same numbers are mirrored in `lib/sourcing/lead-times.ts` for the code that
writes offers. If you change one, change both.

---

## The delivery times

These are **our** promises, not the supplier's. A DigiKey part sitting in their
warehouse today still takes two weeks to reach a customer here, so two weeks is
what we say.

They live in one file: `lib/sourcing/lead-times.ts`. Everything that writes a
supplier offer reads them — the nightly Voltaat sync, the Voltaat catalogue
import, the DigiKey and Mouser lookups.

The day count becomes the words the customer reads (migration 0028):

| Days | What the customer sees |
|------|------------------------|
| up to 2 | **In stock** |
| 3 to 5 | **3–5 days** |
| 6 to 14 | **1–2 weeks** |
| more, or unknown | **2–4 weeks** |
| no supplier at all | **Available on request** |

So own stock (1 day) and Voltaat (2 days) both read "In stock"; DigiKey and
Mouser (14 days) read "1–2 weeks". If you change a number, check which band it
lands in before you ship it.

---

## Out of stock is not a problem to fix

A part whose supplier is out of stock is **available on request**, not broken.
It drops out of the Fix list on its own, instead of asking you to do something
about it every day, and it stays counted under "available on request" on the
dashboard overview. Customers can still order it at the listed price; we
confirm the date with them afterwards.

Nothing is deleted and no product is unpublished. If you *do* want a part gone,
unpublish it from the Fix list by hand.

---

## Our own stock

Own stock is a supplier like any other, with the code `own_stock` and the name
"Own stock (Lusail)". Two things track it:

- `own_stock.qty` — how many units are on the shelf. Never shown publicly.
- `parts.in_own_stock` — true while that count is above zero. This is the only
  thing the storefront reads, and it is what puts the green **In stock in
  Lusail** badge on the product page.

### Putting units on the shelf

Everything happens on **Dashboard -> Store -> Stock**. No SQL.

1. **A delivery you just bought:** the Buy list has an **"I bought these"**
   button. It records the receipt and adds the units to `own_stock`.
2. **A stock take, a loss, a correction:** the **"Units on the shelf"** panel
   on the same page. Every product we hold is listed with its count; the search
   box finds any other published product, so a product that is not on the Buy
   list can be put on the shelf too. Type the real count and press **Save
   count**.

Saving a count above zero also gives the part the **own-stock offer at 1 day**,
the same thing the Fix list's "Set delivery time -> Own stock in Lusail" does —
so the part is immediately sold as ours and no longer sourced from Voltaat or
DigiKey. You never have to do that step by hand any more.

### Why a Voltaat product's price gets fixed

Every product the Voltaat catalogue import creates is **mirror**-priced: its
shop price follows Voltaat's retail price. The rule in `refresh_part_sourcing`
lets a mirror product follow only an offer that *has* a retail price and whose
supplier *has* a commission percent — and our own shelf has neither. So on a
mirror product the own-stock offer would be written and then silently ignored,
and the part would keep being sourced from Voltaat. The whole imported
catalogue is mirror, so this is nearly every product.

Putting units on the shelf therefore switches that product to **markup**: from
then on *you* set its price. The panel says so, with the exact figure, before
you press Save.

- **The price does not move at that moment.** In markup mode the recompute
  writes `unit_price` back unchanged, so a customer sees the same number. It
  simply stops tracking Voltaat, so the nightly Voltaat sync no longer moves it.
- **It is not switched back when the shelf empties.** That would start the price
  following Voltaat again behind your back. If you want a part to follow Voltaat
  again, set "Price mode" back to mirror on the product's edit page.
- Our own offer carries no cost, so "income %" shows blank for that part until
  you record what you paid. Nothing else changes, and the Fix list does not ask
  for it.

The clean long-term fix is to make own stock always eligible in
`refresh_part_sourcing` instead, but that needs a new migration — raise it with
the owner rather than doing it in passing.

**Saving zero does not delete the offer.** It *parks* it: the offer stays with
its cost, SKU and link, but is marked `unavailable`, so the ranked rule (in
stock first) falls back to Voltaat or DigiKey. If that offer was pinned, the pin
is cleared too — a pinned offer beats availability, and we must not promise
next-day delivery from an empty shelf. The next delivery only has to flip the
count back above zero. `parts.in_own_stock` goes false on its own, so the green
**In stock in Lusail** badge disappears from the product page.

Selling counts down automatically: every order line takes its quantity off
`own_stock`, never below zero. **Cancelling an order does not put the units
back** — correct the count in the "Units on the shelf" panel.

---

## Files

| What | Where |
|------|-------|
| Running order + delivery days (code) | `lib/sourcing/lead-times.ts` |
| Running order (database) | `suppliers.rank`, migration `0095` |
| Which offer wins | `public.refresh_part_sourcing()`, migrations `0028` and `0095` |
| Out of stock = on request | `isAutoOnRequest()` in `lib/admin/fix-groups.ts` |
| What the customer reads | `lib/store/part-source.ts` |
| Own stock tables | migration `0069` |
| "Units on the shelf" panel | `components/admin/own-stock-panel.tsx`, `lib/admin/own-stock.ts` |
| Setting the count + the offer | `setShelfUnits()` in `app/[locale]/dashboard/store/stock/actions.ts` |
