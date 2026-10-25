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
`idea_token_charge`, and the telemetry write is best-effort.

### Step 2 — settle one conflict before any SQL

`CLAUDE.md` disagrees with itself about **0096 / 0097**: the pre-audit copy records them as
run and verified by probe, the main checkout's copy lists them as NOT RUN. Confirm in
Supabase first — 0097 replaces `create_part_order` and refuses to apply unless exactly one
copy of it is left.

### Step 3 — run the SQL, in this order, checking each

Full per-file verification queries are in FIX_REPORT §4.

| order | file | note |
|---|---|---|
| 1 | `0098_commission_floor.sql` | pre-existing, still not run; **0103 builds on it** |
| 2 | `0100_studio_private.sql` | **deploy first** |
| 3 | `0101_ai_usage_server_only.sql` | |
| 4 | `0102_credits_server_spend.sql` | |
| 5 | `0103_guards_and_grants.sql` | **needs 0098**; see the trap below |
| 6 | `0104_quote_upload_path.sql` | |
| 7 | `0105_parts_cost_private.sql` | **deploy first**; closes a live leak |
| 8 | `0106_idea_charge_telemetry.sql` | this branch's only own migration; optional, last |

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
