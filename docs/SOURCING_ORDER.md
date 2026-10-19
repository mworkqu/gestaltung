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

### Putting units on the shelf today

1. **Dashboard -> Store -> Stock.** The Buy list has an "I bought these" button.
   It records the receipt and adds the units to `own_stock`.
2. **A stock take, a loss, a correction** has no button yet. For now, in the
   Supabase SQL editor:

   ```sql
   select public.set_own_stock('<part-uuid>', 42);
   ```

3. **Giving a part an own-stock delivery time** (so it is sold as ours even
   before the first receipt): Fix list -> select the products -> **Set delivery
   time** -> supplier **Own stock in Lusail** -> 1 day.

Selling counts down automatically: every order line takes its quantity off
`own_stock`, never below zero. **Cancelling an order does not put the units
back** — correct it with `set_own_stock`.

### What own stock does *not* do yet

Having units on the shelf does not by itself create a supplier offer, so a part
with `own_stock.qty > 0` and no own-stock offer will still be sourced from
Voltaat or DigiKey. Until that is wired up, use step 3 above once per part.

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
