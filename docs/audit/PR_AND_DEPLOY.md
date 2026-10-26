# `fix/review-2026-10` — PR summary and deployment plan

Branch: `fix/review-2026-10` · 38 commits ahead of `origin/main` (88a6473) · nothing pushed.
Full detail: [FIX_REPORT.md](FIX_REPORT.md). This file is the short version plus the order
to deploy in.

---

## 1. What this branch does

Four things, in the order they were asked for.

**A. The 2026-10 audit, applied.** It existed only as diffs. Its six migrations (0100–0105)
are re-reviewed with fresh eyes and carried over unchanged; the docs the diff could not
carry were rebuilt. Two of its findings are live production leaks that this branch does not
fix on its own — they need the SQL run (§3 below).

**B. The live-site QA findings, F-001 to F-054.** Every one is accounted for in the report:
fixed, or listed with the reason it was not. The ones worth knowing:

* **F-004** the Studio template enclosure came out Ø190 mm — external parts were packed
  inside the case and a round template was sized from a rectangle's corners in an uncapped
  loop. Now 99.17 mm.
* **F-006** "Add all to cart" was a per-line client loop with no rollback — the same
  failure that once left a half kit in a customer's cart (P5-02). Now one atomic `addKit`.
* **F-007 / F-010** the pump was wired so the MOSFET switched nothing. Fixing the wiring
  revealed the design is genuinely over budget (565 mA against 450 mA): the old wiring had
  been hiding the pump from the rail.
* **F-033 / F-034** reported done but absent from the tree; implemented here. The 404 title
  needed a client component — `notFound()` discards the segment's `generateMetadata`.

**C. Password reset and email confirmation, rebuilt** so a mail scanner pre-fetching the
link, or the person opening it on another device, no longer burns it.

**D. The ideation-token model, rebuilt (your 2026-10-25 decision).** F-008 asked for copy in
three places and F-023 for a counter that stops lying. You replaced the model instead:

| tier | what it is | cost |
|---|---|---|
| 1 — basic | one controller, ≤ 2 sensors, ≤ 2 movers | **free** |
| 2 — mechatronics | multi-axis, a higher-end controller, or controllers on a bus | 7 tokens |
| 3 — advanced | custom PCB, production firmware, integrated packaging, complex power | 14 tokens |

Refining the same idea is always free. A turn that moves the project up a tier, or starts a
different product, **pauses and quotes the exact cost before anything is deducted**, with
the option to decline and carry on refining. Once agreed, exactly that is charged.

Five things in there will look like bugs to someone, so they are written down in
FIX_REPORT §3.5: Tier 3 is reached by integration signals **only, never part count**; Tier 1
narrows from 3 sensors to 2; "QAR 10 with 80% off" is presentation of the **QAR 2 already
charged today** — no pack price moves; there is no card gateway (Fawran / transfer / cash);
and the new-product check is deliberately biased toward free.

---

## 2. Two real bugs the e2e caught in this branch's own work

Both would have shipped, and neither unit tests nor review found them.

1. **Approving a tier charge did nothing.** The browser caches AI answers by a hash of the
   turn. Approving resends the *same* turn with `approveTier`, which was not part of the
   key — so the cache replayed the pause stored a second earlier. The request never left the
   browser: nothing charged, card unchanged, a dead-looking button. Fixed, pinned by tests.
2. **The dialog focused nobody.** React's `autoFocus` prop renders no `autofocus`
   attribute, so `showModal()` left focus on the dialog element.

---

## 3. Verification

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run lint` | 0 errors (219 pre-existing warnings) |
| `npx vitest run` | **4,069 passed** (309 files) |
| EN/AR parity | 5,326 / 5,326 |
| `check:cycles` | no circular dependency |
| `npm run build` | passes |
| e2e, full suite | **322 passed · 26 failed · 1 flaky** |
| e2e, `origin/main`, same specs and environment | **the same 26 failures, test for test** |
| targeted smoke (post-change) | tier checkpoint **12/12**; F-008 copy EN+AR **16/16 checks** |

**Zero regressions, measured rather than assumed:** `origin/main` was built in its own
worktree under an identical environment and the failure lists were diffed line by line.
Nothing that passes there fails here.

**What this does NOT prove.** Everything ran with only the two public Supabase vars — no
service-role key, production data read-only, writes blocked by the suite's guard. The 26
pre-existing failures are specs that need a signed-in, writable app. They are unexplored,
not explained. One run against a deployed preview with the real env would settle them.

---

## 4. Deployment plan

> **Order matters.** 0100 and 0105 must be run **after** the app is deployed, because they
> remove columns/privileges the current production code still reads. Everything else can go
> before or after.

### Step 1 — merge and deploy the app

Nothing in the app requires new SQL to boot. Before 0100–0106 run, the new behaviour
degrades quietly: the tier checkpoint still quotes and charges through the existing 0088
`idea_token_charge`, and the telemetry write is best-effort. Batch 1 below may go before or
after this step; batch 2 must wait for it.

### Step 2 — settled: the database is further ahead than the docs said

Checked live on 2026-10-26 with the PUBLIC anon key, read-only (no writes, no service-role
key, no secrets printed). Each row is a schema probe through PostgREST: a missing column
answers `42703`, a missing table `PGRST205`, and a table that exists but denies the anon
role answers `42501` — which is itself proof the object is there.

| migration | probe | live answer | verdict |
|---|---|---|---|
| 0094 | `store_settings.fx_to_qar` | `USD: 3.72` | **run** |
| 0095 | `suppliers.rank` | column resolves | **run** |
| 0096 | `school_classes`, `class_teams` | `42501 permission denied` (exists, anon correctly has nothing) | **run** |
| 0097 | `part_orders.class_id`, `.class_breakdown` | both resolve | **run** |
| 0098 | `store_settings.commission_floor_pct` | row present | **run** |
| 0099 | `analysis_runs.request_hash` | column resolves | **run** |
| 0100 | `project_studio_private` | `PGRST205 not found` | not run |
| 0105 | `parts.landed_cost_qar`, `.income_pct` | **readable by anon** | not run — the leak is open |

So the `CLAUDE.md` conflict is settled: **0096 and 0097 have run**, and the
"0098 still NOT RUN" line in FIX_REPORT §4 was wrong — it has run too. Nothing else in the
repo seeds `commission_floor_pct` (0103 and 0105 only read it), so that probe is decisive.
0097 having applied also means its own guard passed, i.e. exactly one `create_part_order`
was left behind.

**What the anon key could NOT answer:** the function overloads themselves. PostgREST's
schema document needs a secret key, and I would not use one for a read. If you want the
list in your own hands, run this in the SQL editor — read-only:

```sql
select p.oid::regprocedure as signature
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_part_order'
order by 1;
```

Expect exactly one row.

### Step 3 — run the SQL, in this order, checking each

Full per-file verification queries are in FIX_REPORT §4.

**Batch 1 — RUN ✔ 2026-10-26 by the owner, verified.**

`0103` is confirmed from outside, not from a query read back: `offer_landed_cost_qar`
answered the anon role `HTTP 200` before, and answers `42501 permission denied` after. The
storefront is unaffected — published products, store settings, `co_purchased` and
`approved_reviews` all still answer anon, and gestaltung360.com serves home, store and a
product page (prices rendering) after the change. `supplier_offers` returning 0 rows to
anon is the pre-existing 0028 policy (super-admin only), not something 0103 did.

`0104` was applied in the same pass. It cannot be checked from outside without attempting
an upload, which would mean writing to storage to test a policy, so its evidence is the
`pg_policies` query in the runbook.

**Batch 1 — safe to run NOW, before the deploy (2 files):**

| order | file | why it is safe now |
|---|---|---|
| 1 | `0103_guards_and_grants.sql` | both prerequisites are already in place (0097 ✓, 0098 ✓). Its guards do not reject anything the live app does: the projects guard silently forces `is_test`/`tenant_id` rather than raising, and the raising limits are 10 orders/hour per phone or email, quantity ≤ 1000, ≤ 300 lines per order. It keeps EXECUTE for `authenticated` on `offer_landed_cost_qar` and moves the admin check inside the function, so the dashboard keeps working. |
| 2 | `0104_quote_upload_path.sql` | the new path rule is `<uuid>/<filename>` case-insensitively, and the live app already uploads exactly that — `${crypto.randomUUID()}/${sanitize(file.name)}`, with the same `sanitize()` on both branches. |

**Batch 2 — RUN ✔ 2026-10-26, after the deploy.** Confirmed by probe: `spend_credit` now
answers `42501` (0102), the `parts` cost columns deny anon while the storefront still reads
`sku`/`name`/`unit_price` (0105), `project_studio_private` exists (0100) and
`admin_idea_charge_summary` went from `PGRST202` to `42501` (0106). 0101 is the owner's
word: both overloads are invisible to the public key. `SUPABASE_SERVICE_ROLE_KEY` is set
for Production and Preview, which is what 0102 made mandatory.

**Batch 2 — ONLY after the app is deployed (4 files):**

| order | file | what it breaks if run early |
|---|---|---|
| 3 | `0100_studio_private.sql` | as documented |
| 4 | `0101_ai_usage_server_only.sql` | **soft.** Revokes `log_ai_usage` from `authenticated`; today's code logs with the caller's own client. Logging stops, so cost tracking goes blind — but `logUsage` only `console.warn`s, so AI keeps working. Quota reads are unaffected (`ai_usage_totals` keeps `authenticated`). |
| 5 | `0102_credits_server_spend.sql` | **HARD — customer-facing.** Revokes `spend_credit` from `authenticated`. Today's `lib/credits/server.ts` calls it on the user's own client; only this branch moves it to `spend_credit_for` on the service client. A permission error is not the "function missing" case the code tolerates, so `spend()` returns `failed` and **every wiring diagram and 3D model stops working** until the deploy lands. |
| 6 | `0105_parts_cost_private.sql` | as documented; closes the cost/margin leak |
| 7 | `0106_idea_charge_telemetry.sql` | this branch's only own migration; optional, last |

**This corrects an earlier version of this plan**, which said only 0100 and 0105 needed the
deploy first. 0101 and 0102 do too, and 0102 is the dangerous one: it was checked by reading
what `origin/main` actually ships, not by trusting the migration headers.

**The 0103 trap.** 0103 reads `part_orders.class_id`, which comes from 0097. Applying 0103
before 0097 succeeds and then breaks **every** `part_order_items` insert — i.e. checkout.
This is in the migration header, CLAUDE.md and FIX_REPORT §4.

**Two live leaks that only the SQL closes.** Today `anon` can read
`parts.landed_cost_qar`, `expected_income_qar` and `income_pct` through PostgREST — your
cost and margin are public until **0105**. And `offer_landed_cost_qar` is callable by any
signed-in user until **0103**.

### Step 4 — smoke after the SQL

Open the site and the dashboard once after each file. After **0105** specifically, place one
small test order and open Dashboard → Store, to confirm the admin still reads prices
through `parts_admin`.

### Step 5 — your own settings, no code involved

* **Lower `kit_discount_pct`** (your decision, rather than isolating Studio parts in code).
* **Shipping handling / buffer** for the delivery-filter relabel.
* Supabase auth screens: four templates, 12 redirect URLs keeping `/api/auth/callback`,
  OTP 10800 s, Resend SMTP ≥ 30/hour. FIX_REPORT §5 has the exact values.
* `SUPABASE_SERVICE_ROLE_KEY` in all three Vercel environments.
* Delete the QA test rows (FIX_REPORT §8) — one pass, at the end, as you asked.

### Rollback

Each migration carries a rollback block in its header. The app itself rolls back by
redeploying the previous commit: nothing in this branch writes a schema it cannot read
without, and no customer data is migrated or deleted.

---

## 5. Still open, for you to decide

1. **The header tagline fails AA on every page** — 9px `text-faint`, measured 2.28:1.
   Already allow-listed on five pages. Changing the token changes the brand everywhere.
2. **The "Clean description" admin step (F-018)** is not built.
3. **F-044** partials: the duplicated email could not be reproduced, and the dialog still
   uses the default quote rule because `studio_quote_rule` is server-side only.
4. **A fast tap on the parts list can be swallowed** (minor, pre-existing) — FIX_REPORT §8e.
