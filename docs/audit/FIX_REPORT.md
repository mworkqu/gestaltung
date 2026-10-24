# Fix report — audit merge, live-site QA findings, password reset rebuild

Branch: `fix/review-2026-10`, cut from `origin/main` 88a6473.
Nothing is pushed, nothing is merged, nothing is deployed, no migration has been run.

> **Status: IN PROGRESS.** This file is written as the work lands. Sections marked
> *(pending)* are not finished yet. Do not read a blank row as "nothing to do".

## 1. Summary

Three pieces of work on one branch:

- **Phase A — bring in the 2026-10 code audit.** The audit ran with read-only GitHub
  access, so its 129 commits only ever existed as two diffs. `all-changes.diff` is now
  applied as one commit, the docs it could not carry are restored, the lockfile matches
  `package.json`, and the riskiest things it did were re-reviewed with fresh eyes.
- **Phase B — fix the live-site QA findings** F-001…F-054 from `review/qa/REPORT.md`.
- **Phase C — rebuild password reset and email confirmation** so a link a corporate mail
  scanner has already fetched, or one opened on a different device, still works.

## 2. Findings → status

### Phase A re-reviews

| Item | What was asked | Result |
|---|---|---|
| `0102_credits_server_spend.sql` | `spend_credit_for` is a hand copy of the live `spend_credit` (0096 v4) — diff it line by line | **Clean, no change needed.** Byte-for-byte identical to 0096 lines 319–385 apart from the three lines the on-behalf-of signature requires: the `spend_credit_for(p_user, …)` signature, `v_uid := p_user` instead of `auth.uid()`, and `ai_role_of(p_user)` instead of `ai_role()`. Locking (`for update`, the `credits:` advisory lock), check order, free-vs-paid precedence, ledger columns, the 30-day window, payer-vs-actor (`user_id` = teacher, `created_by` = actor), the `cad_regens_remaining` branch, all four return shapes and both raise paths are unchanged. `ai_role_of(null)` returns `anonymous`, so the `sign_in` path survives. Grants correct: revoked from `public, anon, authenticated`, granted only to `service_role`. |
| `0100_studio_private.sql` | the strip of `engineering_jobs.snapshot` is irreversible — add a backup table written first | **Fixed.** A new step 2b runs before the destructive `update`, same migration, same transaction: `engineering_jobs_snapshot_backup_2026_10` (job_id pk, project_id, user_id, created_at, snapshot, backed_up_at) is created and filled with the whole pre-change snapshot of every job the strip touches. Column types taken from 0091. Idempotent (`create table if not exists` + `on conflict (job_id) do nothing`). Locked down like the repo's other service-role-only tables: RLS on, revoked from `public, anon, authenticated`, granted to `service_role`, plus an in-migration `has_table_privilege` assert that fails the run if a customer can still read it. The header rollback note now gives the restore `update`, and says the table is kept deliberately and you may drop it when satisfied. Its PGlite test `lib/studio/db/studio-private.test.ts` was extended and passes 11/11: the backup holds the whole original snapshot, exactly one row (so only the affected job is copied and a re-run does not double-write), the table is denied to the job owner and to anon, and the header's rollback `update` really restores `productPrivate`. |
| Service-role dependency | one clear startup warning naming the env var | **Fixed.** `lib/supabase/service.ts` — the one place that reads the key, server-only, not imported by any client component — warns once per server instance: `[supabase] SUPABASE_SERVICE_ROLE_KEY is not set: server-only API routes that need it will answer 503. Set it in the Vercel project environment variables for Production, Preview and Development.` It never logs the key, its prefix or its length, never throws, and is skipped during `next build`. Test: `lib/supabase/service.test.ts`. **→ §7: you must confirm this variable is set in all three Vercel environments.** |
| `0103_guards_and_grants.sql` | diff seven copied function bodies; prove no non-admin path calls `refresh_part_sourcing` / `offer_landed_cost_qar`; raise the order-line cap to 300 and exempt class orders | *(pending)* |
| `0105_parts_cost_private.sql` | find every `select('*')`, `parts(*)` embed and `insert().select()` on `parts`; add a grep test | *(pending)* |
| 90 deleted message keys | restore any key still built at runtime | *(pending)* |
| `callbackNextPath()` | confirm the live templates and the forgot-password form still produce `/{locale}/reset-password` | *(pending)* |

### Phase B — QA findings F-001…F-054

| F-id | Status | Note |
|---|---|---|
| F-001 Terms "through partners" / "free planning tool" | **Fixed** | `LEGAL_PAGES_DRAFT.md`, EN + AR: §3(b) now reads "in our Lusail studio; larger CNC or sheet-metal jobs are quoted case by case"; §3(d) now "a planning tool (the parts list is free; wiring diagrams and 3D models cost credits)"; §7 Arabic "فوري" → "فوران" (also fixed in Delivery & Returns §5, the only other occurrence); §13 Arabic credit-expiry sentence replaced with the clearer wording from the report's Arabic table; Terms "Last updated" → 24 October 2026, Western digits in Arabic. `content/legal/**` regenerated with `scripts/split-legal-draft.mjs`; `--check` passes. No other legal wording touched (D8). |

| F-013 Delivery-time filter | **Fixed** | `leadClassesFor()` in `lib/store/catalog.ts` now keeps a lead class when the **computed arrival date** — the one the card prints — falls in the option's range, instead of matching the supplier's lead class. The date depends only on the lead class, today and the shipping settings, so it still resolves to a short list of classes the database can match: filtering, `total` and paging stay in the query and the page stays static/ISR. `?stock=` option names and values are unchanged. **See §3.3 for a side effect you need to decide on.** |
| F-014 Two delivery tiers cost the same | **Fixed** | `displayedTiers()` in `lib/store/checkout-totals.ts` groups tiers by price and keeps only the fastest in each group, so Standard disappears while it costs the same QAR 50 as Express. `selectableTier()` moves the selection onto a visible tier, so a hidden tier cannot be submitted from the page. Applied at checkout, on the product page "Arrives by" line and in the cart. The data model, `create_part_order` and the order/email rendering are untouched, so an order already placed on a now-hidden tier still displays correctly. |
| F-026 Missing `Studio.cat_logic` | **Fixed** | See the F-001/F-026 commit above. |
| F-020 "You may also need" nonsense | **Fixed** | The filler came from any product in the same store category — including "Tools and accessories", the catch-all where unreviewed products land, which is why a DC jack got an HDMI cable. Filler now has to be in the product's exact category and that category must not be the catch-all; real co-purchases still show whatever their category. Nothing relevant → the block hides itself. Suggestions are still not filtered by stock; left as it was. |
| F-038 Content invisible in a background tab | **Fixed** | `animate-fade-up` started at `opacity: 0` with `fill-mode: both`, so a page opened in a background tab stayed blank. It now starts at `0.6`, readable even if the animation never runs. Not dropping fill-mode on purpose: the `.delay-1`/`.delay-2` stagger would paint at full opacity and then jump back when the animation began. |
| F-049 235+ requests on one store visit | **Fixed** | Product cards no longer RSC-prefetch on sight. `components/parts/hover-prefetch-link.tsx` sets `prefetch={false}` and prefetches on pointer-enter and on focus, so keyboard users keep it. |
| F-054 Cart thumbnails are grey squares | **Fixed** | The first three load eagerly; the rest stay lazy. |
| F-037 409 on `PUT /api/studio/doc` | **Fixed** | `saveWithConflictRetry` retries once against the version the server returned before falling back to the existing "adopt their doc" path. Other failures are not retried. |
| F-037 three.js on the store page | **Could not reproduce — no change** | The store, home and product initial chunks contain no `three`/BVH code, and a live load of `/en/store` logged no BVH warning; the only chunk containing `maxLeafSize` is loaded lazily from the Studio. The home hero *does* deliberately load a 3D loop once idle (your W7 decision). The tester most likely went home → store in one tab and saw the hero's warnings still in the console. **Removing the hero's 3D would be your decision, not a bug fix**, so nothing was changed. |
| F-037 one 404 asset on `/projects/new` | **Could not reproduce — no change** | Every asset path, `/api` path, `rpc()` and table name the page references resolves. The only 404s observed were `/apple-touch-icon.png` and `/apple-touch-icon-precomposed.png`, which browsers probe for unprompted and the page does not reference. The QA run did not capture the URL. If you see it again, please grab the request URL. |

| F-015 "Final price" on the cart | **Fixed** | The cart says "Final price shown at checkout."; the binding line stays only on checkout, where the total really is final (D3). |
| F-016 Checkout does not prefill | **Fixed** | Reuses the same profile reader the Get-it-made dialog uses (dynamic import, so Studio code stays out of the checkout bundle). Fills only empty fields; guests still check out with empty ones. |
| F-017 Three meanings of "confirm" | **Fixed** | The first status reads **"Received" / "تم الاستلام"** everywhere a customer sees it, including the order email's subject and headline. **The stored value is untouched — still `confirmed`** — and the admin screens still say "Confirmed", because an admin picks the real stored state and a different word there would not match it. Button → "Message us on WhatsApp". The "within one working day" sentence is unchanged. |
| F-036 Pricing FAQ vs Terms §13 | **Fixed** | The FAQ now says what Terms §13 says: a credit can be redeemed as a QAR 20 discount within 30 days, then it expires; no cash value, no transfer. EN + AR. |
| F-050 Ambiguous Arabic credit words | **Fixed** | "أرصدة مخططات التوصيل" (not "أرصدة توصيل", which reads as delivery) and "رصيد النموذج ثلاثي الأبعاد" (not "رصيد CAD"), in the UI and the credit emails, singular/plural made to agree, Western digits kept. |
| F-007 Pump wired so it cannot work | **Fixed** | The IRF520 low-side module was wired OUT → pump +, pump − → GND, so the MOSFET switched nothing. A low-side switch module and a two-terminal load path are now modelled explicitly, and the pair is wired V+ → load → switched terminal. New **hard** rule `load_return_on_ground` blocks readiness: a load on a low-side switch may not also sit on a ground net. It fails rather than warns — "Checked ✓" on a dead circuit is worse than no check. The tester's exact netlist is a fixture and fails it. |
| F-052 USB back-feed caution | **Fixed** | "Unplug USB while the power board feeds the 5 V pin" now appears in "What we checked" whenever a power part feeds the board's own 5 V/VIN pin. Known gap: it does not fire for a USB-C 5 V supply board, which is not classified as a power *source*; widening that was an unrelated behaviour change so it was left. |
| F-010 Inverted sensor logic, no safety | **Fixed** | Calibration facts live on the library part as data: the capacitive probe states that the reading goes **up** as soil dries, with dry/wet as **percentages of the board's ADC range** (so they hold on a 10-bit and a 12-bit board) and a comment to calibrate in your own soil — no invented absolute numbers. They are re-inserted into the generated pin block verbatim after the model answers. Any inductive load (pump, motor, solenoid, relay, fan) gets a safety block our code inserts itself: 10 s per run, 60 s per hour. A promise no part can keep is now stated in a "NOT IN THIS SKETCH" block instead of silently dropped. |
| F-011 Promised feature with no part | **Fixed** | The Parts step cannot be marked done while an "Includes" line maps to no part. A float/level/tank line is explicitly unmappable, so a plain slide switch can no longer stand in for the tank sensor — which is what would have happened before. The main button still advances, so nobody is trapped. **Not yet shown in the Parts UI** — it only blocks the step; a "we have no part for: Float switch" line needs copy and is listed under §9. |
| F-012 Invented features | **Fixed** | A feature line is kept only if every concept it names appears in the visitor's own words across the whole conversation, or was confirmed in chat. Lines naming no known concept are kept (we cannot judge them), and only new lines are judged, so what the visitor already saw stays. The tester's "Motion sensor" and "small screen" go; the real features stay. |
| F-046 Unstocked part preferred | **Fixed** | A part with no store product is swapped for a stocked equivalent, within hand-checked equivalent groups only, after every other rule. The model never sees stock and never names a SKU. When nothing stocked does the job, the row says so. |

| F-006 "Add all to cart" added 3 of 7 | **Fixed** | The Studio Parts step added parts in a **client loop, one line at a time** — session, lookup, insert and a full cart reload per line (~0.6 s each, which is why the badge crept 2 → 3). No single statement, no rollback: a loop that stops part way leaves the first rows saved and the rest never attempted. This is the **same failure mode as P5-02**, fixed once for the BOM kit and never picked up by the Studio path, which was written separately. Now one plan, written through the existing atomic `addKit`, so a half-filled cart is impossible; the step's total, its "+N priced on request" count and the button all read the plan that is written. Nothing was filtering helpers or packs out — that was the obvious suspicion and it was wrong; the lost lines were simply at the tail of the loop. Toast: "Added 7 parts · 2 we'll source", counted from the rows actually written. |
| F-029 Search suggestions | **Fixed, with a caveat** | Links named, thumbnails no longer lazy. The threshold was **already 2 characters** in both the route and the component, so it was left at 2 (3 would have been worse) and the component now imports the constant so they cannot drift. If the live site still needs four characters, the deployed build is older than this code. |
| F-030, F-031, F-032 (partial), F-033, F-034, F-051 | **Fixed** | See the accessibility commit. F-031 cannot be fully enforced by us — see §7 for the Supabase setting you must change. The Studio's seven step buttons and "Order the parts" are **still to do**. |
| F-021, F-022 | **Fixed** | Quote success and the confirmation email now carry a reference (`Q-` + eight hex digits, derived from the row id the route generates — no migration) and the file name; the "open your project" link is shown only to a signed-in account. `/design/drawing` describes the on-site form, with WhatsApp as the marked alternative, and hides "My projects" from guests. |

*(the remaining F-ids follow as they land)*

### Phase C — password reset and email confirmation

| Piece | Status | Note |
|---|---|---|
| Emails carry a token hash, not a spent link | **Done** | All four templates now link to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…` instead of `{{ .ConfirmationURL }}`, and print the 6-digit `{{ .Token }}` as a fallback a scanner cannot consume. Rendered to PNG at 600 and 360 px in `review/fixes/emails/` and checked by eye. |
| `/{locale}/reset-password` does not verify on GET | **Done** | Server component, `force-dynamic`, `noindex`. It parses `token_hash` and renders the form with it in a hidden field. The page imports nothing from `lib/supabase` — no auth call, no cookie write — so a Safe Links / Mimecast / Proofpoint pre-fetch cannot spend the token. Verification happens only on submit: `verifyOtp` + `updateUser` + `signOut` in one server action. |
| Any device works | **Done** | Verifying a token hash on submit needs no PKCE verifier cookie, so opening the email on a phone or in another browser now works. |
| 6-digit code fallback | **Done** | Email + code + new password, one submit, rate-limited 8 attempts per 15 minutes per IP and per address. Deliberately one screen rather than verify-then-show-form: same two Supabase calls in one request, and it never leaves a half-spent recovery session between two round trips. |
| `/{locale}/confirm-email` | **Done** | One "Confirm my email" button for `signup` and `email_change`; `recovery`, `magiclink` and `invite` are refused. Then `/{locale}` or a safe `?next=` path through the existing `safeNextPath`. |
| Forgot-password UX | **Done** | Names the address, says to check Spam/Junk, states the validity, Resend after a 60-second countdown, a link to the code path, and a WhatsApp link. `?expired=1` shows "That link was already used or has expired" with the address prefilled from this browser's `localStorage`, never from the URL. |
| Account enumeration | **Preserved** | Expired, already-used, wrong code and unknown address all return one answer. Nothing reveals whether an account exists. No token, hash, code or password is logged. |
| Tests | **Done** | 33 unit tests; `e2e/reset-password.spec.ts` (5 tests × EN/AR, 375 and 1366 px) asserts that no request to `/auth/v1/(verify|otp|recover|token|signup)` happens before submit. The e2e write guard is untouched. The e2e run itself is Phase D. |

**The "3 hours" in the copy is only true once you raise the Supabase OTP expiry** (§5 step 3).
`OTP_VALID_HOURS` in `lib/auth/reset-token.ts` is the single place the number lives; if you
choose a different expiry, change it there and the emails and pages follow.

## 3. Intentional behaviour changes

Everything the audit itself changes is listed in `docs/audit/FINAL_REPORT.md` §4; that list
still applies and is not repeated here. What **this** branch changes on top:

1. `0100` now keeps a backup table of the pre-migration `engineering_jobs.snapshot` rows.
   It holds customer design data, it is service-role only, and you may drop it once you are
   satisfied nothing needs restoring.
2. A missing `SUPABASE_SERVICE_ROLE_KEY` now logs one startup warning. The 503s it causes
   are unchanged — only the silence is fixed.
3. Terms §3(b), §3(d) and two Arabic wordings now say what is actually true (F-001).
4. The four Supabase auth email templates no longer use `{{ .ConfirmationURL }}`; they link
   into our own site with a token hash and also print a 6-digit code (Phase C, §5).
5. At checkout, a delivery tier that costs the same as a faster one is no longer shown
   (F-014). Nothing about the stored order changed.
6. **The delivery-time filter now means what it says, and that changes what it returns
   (F-013).** This one deserves your attention — see §3.3.
7. The first order status reads "Received" to a customer and still "Confirmed" to an
   admin; the stored value is unchanged (F-017).
8. Arabic UI text now renders in IBM Plex Sans Arabic rather than a size-adjusted Arial
   (F-035), and every page's CSS is inlined into its HTML (F-053) — about 19 kB gzip per
   page, no longer cached across hard loads, in exchange for first paint going from 2.67 s
   to 0.91 s on a throttled connection.
9. The minimum password is 8 characters, not 6 (F-031). Sign-in keeps no minimum so
   existing accounts can still sign in and reset.
10. **A Studio kit now creates a `project_kit` row, so `kit_discount_pct` applies to
    Studio parts (F-006).** They were loose project lines before and got no kit discount.
    This is inherent to the atomic insert that fixes the bug, and it is arguably right —
    it *is* a kit — but it changes what a customer pays. Tell me if Studio parts should be
    excluded from the kit discount.

### 3.2 The template enclosure now offers no STL at all — and the credit is already spent

This is the most important thing in this report. Please read it before you merge.

Fixing F-003 meant refusing to hand over a file we know is broken. Running the new
manifold check against the **legacy template enclosure** (the Dome / Puck / Box shapes
with "Try another look") shows its meshes cannot be made printable at all: the dome lid
comes back with **2,611 unbalanced edges out of 6,275 triangles**, the base 1,044 of 1,467.
`three-bvh-csg`'s booleans are non-manifold at the source, and `manifold-3d` refuses the
same mesh even after welding coincident vertices. That is now recorded as a test, not an
aspiration.

So on that path the Print step correctly withholds every file and sends the customer to the
engineer quote. **But the CAD credit was already spent at the Enclosure step** — `cad_deliver`
runs as soon as the 3D model is produced, and the Print step is free. The customer pays, sees
a model on screen, and then cannot download anything.

Before this change they paid and got a file with 297 loose shells that no slicer would
print. So nothing has been taken away that was ever worth having — but a visible refusal
after payment is a different kind of bad from a broken download, and it is your call.

**Your options:**

1. **Rebuild the template path on the product kernel.** The product kernel already builds
   all eight templates (plus `stake_pod`) as the `enclosure` form kind, so the route is
   "send the template path through the product kernel", not "repair the soup". It is a
   stage of its own and was too large to land safely inside this review. *My recommendation
   — it is the only option that ends with a printable file.*
2. **Don't charge when nothing printable comes out**, or refund the credit. The honest
   reading is that the credit buys the 3D model and the quote route, both of which are
   still delivered — but if you tell customers a credit buys a downloadable model, option 2
   is the minimum until option 1 lands.
3. **Ship as it is** and let the engineer quote carry it. Defensible, since the old files
   were worthless, but a customer who paid will notice.

Which path real customers hit matters here, and I could not confirm it from the repo: the
tester's downloads were named `lid_1`, `base_1`, `battery_clip_1`, `light_pipe_1`, which are
the **template/mech** names — so the live site appears to serve the template path. The
product path (which does export clean files: 7 bodies, all watertight, single-shell, 204 g,
two plates inside the bed) is the default in this code. **Please confirm on the live site
which one a customer actually gets** before deciding.

### 3.3 The delivery filter now returns fewer things, and "3–5 days" may be empty

The finding was that "3–5 days" listed products whose card said "Arrives by 2 November",
eleven days out. That happened because the filter matched the supplier's lead class while
the card showed the full computed date — lead time **plus** handling, transit and buffer.

Filtering on the real date fixes the lie, but it exposes an uncomfortable fact: with the
live shipping settings (handling 1 day, buffer 3 days, standard transit 2 days) even an
**in-stock** product arrives in about 8 days. So:

- "3–5 days" matches **nothing** — no product in the catalogue can arrive that fast.
- In-stock products now appear under "1–2 weeks", which is where they actually land.
- I made the slowest option open-ended, so a `2_4_weeks` product (about 34 days once
  handling and buffer are added, past its own 28-day bound) is still reachable from a
  filter instead of only from "All". A unit test pins that no product can fall outside
  every option, however slow the settings get.

I did not rename the options, because that is customer-facing copy and your decision.
**You have three choices:**

1. **Relabel the options** to the windows that are real — e.g. "About a week", "1–2 weeks",
   "2–4 weeks or more". Honest, and the filter becomes useful again. *My recommendation.*
2. **Lower handling and buffer** in Dashboard → Store → Suppliers until an in-stock item
   really does arrive in 3–5 days. Only do this if the dates are genuinely achievable —
   the whole point of the buffer is that you keep the promise.
3. **Ship it as it is.** Honest, but one filter option is permanently empty, which looks
   broken to a customer.

Until you choose, option 1's wording is not written anywhere — nothing is renamed.

## 4. Migrations to run, in order

**Nothing here has been run.** Run them in this order, only when you are ready, and check
each one before moving on. 0100 and 0105 need the app commit **deployed** first.

| # | File | Check it ran (read-only, SQL editor) |
|---|---|---|
| 0098 | `0098_commission_floor.sql` (pre-existing, still NOT RUN — 0103 builds on it) | `select value from store_settings where key = 'commission_floor_pct';` |
| 0100 | `0100_studio_private.sql` (deploy the app first) | `select to_regclass('public.project_studio_private') is not null;` → true; then `select count(*) from public.engineering_jobs_snapshot_backup_2026_10;` |
| 0101 | `0101_ai_usage_server_only.sql` | `select has_function_privilege('authenticated','public.log_ai_usage(text,text,uuid,text,integer,integer,integer,numeric,integer,text,text,integer,integer,text,numeric)','execute');` → false |
| 0102 | `0102_credits_server_spend.sql` | `select has_function_privilege('authenticated','public.spend_credit(text,uuid)','execute');` → false |
| 0103 | `0103_guards_and_grants.sql` (needs 0098 first) | `select count(*) from pg_trigger where tgname in ('part_order_items_limits','part_orders_rate_limit','projects_guard_admin_columns','inquiries_guard_insert');` → 4 |
| 0104 | `0104_quote_upload_path.sql` | `select with_check from pg_policies where policyname = 'quote_uploads_insert';` contains the path regex |
| 0105 | `0105_parts_cost_private.sql` (deploy the app first) | `select has_column_privilege('anon','public.parts','landed_cost_qar','select');` → false |
| 0106+ | **None.** This branch adds no migration of its own — every fix was possible in application code. The only new SQL files are the audit's 0100–0105, re-reviewed above. | — |

Smoke test after each: open the site and the dashboard once. After **0105** specifically,
place one small test order and open Dashboard → Store, to confirm the admin still reads
prices through `parts_admin`.

**A conflict you need to settle before running anything.** The pre-audit `CLAUDE.md`
records 0096 and 0097 as **RUN ✔ 2026-10-21, verified by live probe**, while the main
checkout's working copy of `CLAUDE.md` lists them as NOT RUN. `docs/MIGRATIONS.md` follows
the verified-by-probe record. Please confirm in Supabase first, because 0097 replaces
`create_part_order` and refuses to apply unless exactly one copy of it is left.

## 5. Supabase dashboard checklist — auth emails

The full version, with the reasoning and a 7-step test, is in `docs/AUTH_EMAILS.md`. Short form:

1. **Authentication → Emails** — paste the four templates from `supabase/auth-templates/`
   and set their subjects:
   - `reset-password.html` — "Reset your password · إعادة تعيين كلمة المرور — Gestaltung"
   - `confirm-signup.html` — "Confirm your email · تأكيد بريدك الإلكتروني — Gestaltung"
   - `change-email.html` — "Confirm your new email · تأكيد بريدك الجديد — Gestaltung"
   - `magic-link.html` — "Your sign-in link · رابط تسجيل الدخول — Gestaltung"
2. **Authentication → URL Configuration** — Site URL stays `https://gestaltung360.com`.
   Add `/en/reset-password`, `/ar/reset-password`, `/en/confirm-email`, `/ar/confirm-email`
   on each of `https://gestaltung360.com`, `https://www.gestaltung360.com` and
   `http://localhost:3000` (12 URLs). **Keep** the existing `/api/auth/callback` entries —
   social sign-in still uses them.
3. **Authentication → Email** — set OTP expiration to **3 hours (10800 s)**. Why: university
   and corporate mail gateways can delay external mail by many minutes, and the old 1-hour
   window plus a delayed delivery is most of the "already expired" complaint.
4. **Custom SMTP** — confirm it is Resend: host `smtp.resend.com`, port `465`, user
   `resend`, password = the Resend API key already set in Vercel, sender
   `noreply@contact.gestaltung360.com`. Confirm the Supabase email rate limit is ≥ 30/hour.
5. **Authentication → Attack Protection** — record the current CAPTCHA state (on/off and
   which provider). This change does not alter it, but you need to know it.

**Reading the delivery latency in Resend:** Resend → Emails, filter by the recipient (or by
`qu.edu.qa`), open the message and compare its *Sent/Queued* timestamp with *Delivered*. A
large gap there is the recipient's gateway holding the mail, not us — which is exactly why
the link is no longer single-use and why a 6-digit code is printed beside it.

**Deploy the app before pasting the templates.** They point at `/{locale}/reset-password`
and `/{locale}/confirm-email`; until those pages are live the links lead nowhere.

## 6. Needs owner decision

Carried from the audit (`docs/audit/FINAL_REPORT.md` §6, `SECURITY_AUDIT.md` §5,
`CODE_QUALITY_AUDIT.md` §3) with the auditor's recommendation and my own one-line view.
**Nothing in this list was acted on**, exactly as you asked.

| # | Decision | Auditor's recommendation | My view |
|---|---|---|---|
| 1 | Auto-approval of `kind = 'service'` payments (an approval opens a paid human job) | Never auto-approve service payments; route them to the review queue | **Agree, do this first.** An auto-approved service payment spends your engineer's hours, not just credits — the one irreversible thing in the payment path. |
| 2 | Cap on auto-approved payments | ≤ 1 per user per 30 days and a QAR ceiling; unique index on `lower(transfer_ref)` | **Agree.** The unique index is the cheap half and stops the same Fawran receipt being used twice; do it even if you defer the cap. |
| 3 | AI-02: the Studio model is public via `/product/check` and `/design` before unlock | Drop `model` from `/check`; serve a reduced preview mesh, or price the export rather than the geometry | **Price the export.** Hiding geometry you have already rendered is a losing game; what the customer actually pays for is the printable file, so gate that. |
| 4 | DB-03: browser CAD returns SCAD before `cad_deliver` | Block a new generation while one is undelivered; settle stale ones server-side | **Agree, low risk.** It is a 24-hour-cap loophole, not a live leak. |
| 5 | DB-04/06: free credits become QAR 20 vouchers; no per-team cap | Minimum goods value for the order reward; decide whether free credits should be redeemable; cap team spends | **Make earned credits non-redeemable.** A credit earned by ordering should buy AI, not discount the next order — otherwise a delivered order mints currency. |
| 6 | DB-05: any confirmed user can create a class (free delivery, no project cap) | Admin verification (`verified_at`) before class benefits apply | **Agree.** Free Economy delivery on a class order is a real cost, and "I am a teacher" is currently self-declared. |
| 7 | DB-10: class orders over 100 lines fail | Raise or exempt the cap for class orders | **Settled by you:** 300 lines, class orders exempt. Done in 0103. |
| 8 | Supabase CAPTCHA state, and when to turn the `turnstile` switch on | Confirm; the clients are wired | **Turn it on after this branch is live.** The order in `docs/TURNSTILE.md` matters: keys, then switch, then Supabase — never Supabase first. |
| 9 | CSP promotion after one release of report-only | Rename the header to `Content-Security-Policy` | **Wait one release and read the reports.** Enforcing early breaks the Studio's workers and the CDN-loaded OpenSCAD engine. |
| 10 | Google WIF attribute conditions and Cloud Run hardening of the CAD worker | Confirm issuer/audience pinning, `--no-allow-unauthenticated`, `CAD_WORKER_TOKEN`, zero-role SA | **Agree.** Worth an hour: an unauthenticated Cloud Run worker is a free compute endpoint for anyone who finds it. |
| 11 | O1: v1 public pages + `site_v2` flag (752 lines; the site silently serves v1 if the flag read fails) | Remove once the rollback is no longer wanted | **Remove it.** The flag has been ON since 2026-10-09; the silent-fallback behaviour is now a liability, not a safety net. |
| 12 | O2: Engineer view (48 files, 11,143 lines, ~750 message keys, admin-only) | Decide whether it stays; if not, remove it and keep the shared lib modules | **Your call — it is a product question, not a code one.** If you still open it to debug a customer's project, keep it; if you have not opened it in a month, delete it and reclaim ~750 keys of translation debt. |
| 13 | O3/O4/O5/O15: legacy `tenants`/`inventory_items` UI and tables, `jobs*` tables, `project_claims`, dead columns | Check the live tables are empty, then one drop migration | **Check first, then drop in one migration.** Do it as its own release so a mistake is easy to find. |
| 14 | O11: a design mock-up is publicly served from `public/prototypes/` | Remove from the production domain or keep with noindex | **Remove it.** It is an old mock-up on your real domain. |
| 15 | O14: `Gestaltung_Build_Plan.md` is a Word file with a `.md` name | Rename or archive | **Rename to `.docx`.** Trivial, and it stops the next tool from trying to parse it. |
| 16 | WEB-07: OpenSCAD engine loaded from public CDNs without integrity | Self-host under `public/` | **Add SRI rather than self-hosting.** Self-hosting puts the WASM back into your Vercel data transfer, which you deliberately moved off. |
| 17 | API-10: rating links record on GET and never expire; secret falls back to `CRON_SECRET` | Confirm-button POST and a dedicated secret | **Give it its own secret at least.** Sharing `CRON_SECRET` means a leaked rating link is a cron key. |

Already settled by you in this round, recorded here so it is not re-opened:

Already settled by you in this round, recorded here so it is not re-opened:

- **DB-10c** order-line cap raised from 100 to 300, and class orders (`class_id is not null`)
  exempt from it.
- **F-002** CAD credit price: the published price is the contract (Qatar consumer
  protection) — charge exactly what `/pricing` says.
- **F-008 / F-023** ideation tokens: keep them, but explain them in three places and never
  deduct them optimistically.

New, found while doing this work:

- Privacy §4 still says "Partners: when a job needs a partner, they receive only the files
  and details needed to make your part" (EN + AR). You wrote that line deliberately on
  2026-10-09 and it is conditional rather than a promise, so I left it. It now sits beside a
  Terms section that says the work is done in the Lusail studio. Your call whether the two
  should be aligned. *My view: leave it — it is a data-protection statement about a
  possibility, not a capability claim, and softening it would weaken the privacy page.*

## 7. What you must do afterwards

- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in **all three** Vercel environments
  (Production, Preview, Development). Many routes answer 503 without it, and the new startup
  warning is the only thing that will tell you.
- **Supabase → Authentication → set the minimum password length to 8.** F-031 raised the
  minimum everywhere we control it, but sign-up talks to Supabase straight from the browser,
  so without this setting a 6-character password can still be created through the API.
- **Dashboard → Store → clean the product descriptions** and run the Arabic translate step
  (F-018, F-019). Both are metered admin actions and are yours to run, not ours.
- *(pending — clean descriptions, the Arabic translate step, test-data cleanup)*

## 8. Test data to delete (one pass, at the end)

From `review/qa/REPORT.md` §11 — the QA run's rows. **I did not touch the database.**
Logged here and in `docs/TEST_DATA_CLEANUP.md`; delete them all in one go when the review
is done:

| Type | Identifier | Note |
|---|---|---|
| Order | `3a939b38-a527-4dc3-901b-c3f89806179f` "TEST QA — please cancel" | COD, Lusail, QAR 56.00 — cancel it |
| Project | `719b2ec2-a300-4f6f-a7b8-ebcff6412d18` "TEST QA — Balcony Plant Waterer" | used 1 wiring + 2 CAD credits |
| Get-it-made request | on project `719b2ec2…` | notes "TEST — please ignore" |
| Guest project | `6cc3bf2f-98dd-48c6-9b3e-dca2e6829ce3` "Auto Desk Lamp" | |
| Drawing request | `bc67437f-d774-47d8-a142-fab7ca944a4b` | sketch `test-sketch.png`, tier simple |
| Quote request | no reference shown; file `test-bracket.stl`, name "TEST QA — please ignore" | 22 Oct |
| Contact message | "TEST QA — please ignore" | 22 Oct |

## 8b. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors**, 213 warnings (the pre-existing complexity / max-lines ratchet; the audit's baseline was 209) |
| `npx vitest run` | **299 files, 3,962 tests pass** (the audit's baseline was 288 files / 3,855 — this branch adds 107 tests) |
| `node scripts/check-i18n-parity.mjs` | en 5,275 · ar 5,275 |
| `node scripts/split-legal-draft.mjs --check` | OK — the generated legal files match the draft |
| `npm run check:cycles` | no circular dependency (one was introduced by the F-013 work and fixed; `check:cycles` is part of the green bar for a reason) |
| `npm run build` | passes |
| Route table vs `origin/main` | **No static/ISR flag changed anywhere.** One new route, `/[locale]/confirm-email`. Shared First Load JS identical at 104 kB. |
| First Load JS | `/[locale]` 149 kB, `/[locale]/store` 148 kB, `/[locale]/store/[sku]` 211 kB — all within 2 kB of baseline. `/[locale]/reset-password` **198 → 133 kB** (−65 kB: the page no longer pulls the Supabase browser client, because it does not authenticate on GET). `/[locale]/forgot-password` 201 → 228 kB. Note the baseline is `origin/main` *before* the audit's own 129 commits, so these deltas are the audit plus this branch, not this branch alone. |
| `npm run test:e2e` | see below |

**A safety property worth stating:** this branch was built in a git worktree that has **no
`.env.local`**. The production Supabase credentials were never reachable from it, so no
migration, write or paid API call was possible at any point — not by policy, but
structurally. It is also why the e2e suite's numbers look the way they do: it runs without
Supabase env, exactly as the audit's baseline did.

## 9. Follow-ups

1. **After 2026-10-31 (7 days after this deploys), remove the legacy link path.**
   `/api/auth/callback` still accepts `token_hash` + `type` so that reset emails already
   sitting in inboxes keep working. To remove it: delete the `else if (tokenHash && type)`
   branch and the `tokenHash` / `type` / `EmailOtpType` reads in
   `app/api/auth/callback/route.ts`, and delete the `/{locale}/reset-password` exception at
   the end of `callbackNextPath` in `lib/auth/next-path.ts` (and its test case). The `code`
   path stays — social sign-in uses it.
2. **Test the reset end to end with a real mailbox**, including one sent to a `@qu.edu.qa`
   address, following the numbered test in `docs/AUTH_EMAILS.md`. That is the one thing
   this branch cannot prove: it needs a real inbox and a write to production.
3. **Re-run the QA pass** on the branch once it is deployed, with the same script, to
   confirm the findings are actually gone on the live site rather than only in tests.
4. **An H-bridge motor driver has the same bug F-007 had.** A load on `motor_driver` is
   still wired OUT1 → motor +, motor − → GND. A reversible motor belongs between OUT1 and
   OUT2; as wired it can only ever turn one way, if at all. The new hard rule is scoped to
   low-side modules only, because the H-bridge was not in this round's findings and
   widening it would change designs nobody has reviewed. It is the same class of mistake
   and should be the next Studio fix.
5. **Show the unmet promise on the Parts step.** `unmetPromises()` already knows that, say,
   "Float switch" has no part; today it only blocks the step from being ticked. A line
   saying so needs one new string in EN + AR.
6. **Move the two Studio toast strings into `messages/**`.** They live inline in
   `lib/studio/kit-plan.ts` for now (the arrangement `plain-checks.ts` already uses). The
   keys, with the same ICU `form` + `count` shape as `Studio.partsOnRequestPlus`:
   `Studio.addedToCart` — EN `Added {form, select, one {1 part} other {{count} parts}}`,
   AR `أضفنا {form, select, one {قطعة واحدة} two {قطعتين} few {{count} قطع} other {{count} قطعة}}`;
   and `Studio.addedToCartSourced`, the same plus ` · {sourced} we'll source` /
   ` · {sourced} سنوفّرها لك`.
7. **`pack_size` is not in `STORE_CARD_COLUMNS`.** The Studio reads a product's pack size
   from its NAME, so a pack product whose name does not say the size is bought one listing
   per piece. Adding the column to the card query would fix it, but that query is shared by
   the storefront, so it needs its own change and its own test.
8. **Add `Prototyping.hard_load_return_on_ground`** to `messages/{en,ar}.json`, params
   `{ref}`, `{driver}`, `{net}`, for the legacy Engineer view. No user can hit a missing
   key today — the flag only arises from Studio wiring, and the Studio shows its own inline
   line — but the Engineer view would render the raw key if it ever did.
