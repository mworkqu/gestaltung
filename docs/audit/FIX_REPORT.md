# Fix report — audit merge, live-site QA findings, password reset rebuild

Branch: `fix/review-2026-10`, cut from `origin/main` 88a6473.
Nothing is pushed, nothing is merged, nothing is deployed, no migration has been run.

**All three decisions are made and the code side of them is done** (§3.2, §3.3). What is
left for you is settings, not code: §7a (shipping buffer, kit discount), §5 (the Supabase
auth-email screens) and §4 — the migration order, which is load-bearing.

## 1. Summary

Three pieces of work on one branch:

- **Phase A — bring in the 2026-10 code audit.** The audit ran with read-only GitHub
  access, so its 129 commits only ever existed as two diffs. `all-changes.diff` is now
  applied as one commit, the docs it could not carry are restored, the lockfile matches
  `package.json`, and the riskiest things it did were re-reviewed with fresh eyes.
- **Phase B — fix the live-site QA findings** F-001…F-054 from `review/qa/REPORT.md`.
- **Phase C — rebuild password reset and email confirmation** so a link a corporate mail
  scanner has already fetched, or one opened on a different device, still works.

### Coverage of F-001…F-054

**Fixed: 48.** F-001 to F-007, F-009 to F-017, F-019 to F-022, F-024 to F-036,
F-038 to F-043, F-045 to F-054.

**Not fixed, each with its reason — nothing was skipped silently:**

| F-id | Status | Why |
|---|---|---|
| F-008, F-023 | **Not started** | Explaining ideation tokens in three places and removing the optimistic deduction. Plain work, simply not reached. |
| F-018 | **Half** | "Datasheet" is already gated correctly — the tester saw none because **no product has `datasheet_url` filled**, which is data, not code. The "Clean description" admin step is a new metered feature and was not built. |
| F-037 | **One of three** | The 409 retry is fixed. The three.js-on-store and the `/projects/new` 404 could **not be reproduced** against this build; both are written up with the evidence rather than guessed at. |
| F-044 | **Partial** | The estimate now shows in the dialog. The duplicated email could not be reproduced from the code, and the dialog reads the *default* quote rule because the saved one is server-side only. |

**All three decisions are settled (2026-10-25)** and the first two are implemented:
§3.2 the template enclosure now produces printable files; §3.3 the filter buckets are
relabelled. The third — the kit discount — you chose to handle by lowering
`kit_discount_pct` in settings rather than carving the Studio out in code, so there is
nothing to change here. Two **settings** halves remain yours: the shipping handling/buffer
days and that discount percentage, both in §7a.

## 2. Findings → status

### Phase A re-reviews

| Item | What was asked | Result |
|---|---|---|
| `0102_credits_server_spend.sql` | `spend_credit_for` is a hand copy of the live `spend_credit` (0096 v4) — diff it line by line | **Clean, no change needed.** Byte-for-byte identical to 0096 lines 319–385 apart from the three lines the on-behalf-of signature requires: the `spend_credit_for(p_user, …)` signature, `v_uid := p_user` instead of `auth.uid()`, and `ai_role_of(p_user)` instead of `ai_role()`. Locking (`for update`, the `credits:` advisory lock), check order, free-vs-paid precedence, ledger columns, the 30-day window, payer-vs-actor (`user_id` = teacher, `created_by` = actor), the `cad_regens_remaining` branch, all four return shapes and both raise paths are unchanged. `ai_role_of(null)` returns `anonymous`, so the `sign_in` path survives. Grants correct: revoked from `public, anon, authenticated`, granted only to `service_role`. |
| `0100_studio_private.sql` | the strip of `engineering_jobs.snapshot` is irreversible — add a backup table written first | **Fixed.** A new step 2b runs before the destructive `update`, same migration, same transaction: `engineering_jobs_snapshot_backup_2026_10` (job_id pk, project_id, user_id, created_at, snapshot, backed_up_at) is created and filled with the whole pre-change snapshot of every job the strip touches. Column types taken from 0091. Idempotent (`create table if not exists` + `on conflict (job_id) do nothing`). Locked down like the repo's other service-role-only tables: RLS on, revoked from `public, anon, authenticated`, granted to `service_role`, plus an in-migration `has_table_privilege` assert that fails the run if a customer can still read it. The header rollback note now gives the restore `update`, and says the table is kept deliberately and you may drop it when satisfied. Its PGlite test `lib/studio/db/studio-private.test.ts` was extended and passes 11/11: the backup holds the whole original snapshot, exactly one row (so only the affected job is copied and a re-run does not double-write), the table is denied to the job owner and to anon, and the header's rollback `update` really restores `productPrivate`. |
| Service-role dependency | one clear startup warning naming the env var | **Fixed.** `lib/supabase/service.ts` — the one place that reads the key, server-only, not imported by any client component — warns once per server instance: `[supabase] SUPABASE_SERVICE_ROLE_KEY is not set: server-only API routes that need it will answer 503. Set it in the Vercel project environment variables for Production, Preview and Development.` It never logs the key, its prefix or its length, never throws, and is skipped during `next build`. Test: `lib/supabase/service.test.ts`. **→ §7: you must confirm this variable is set in all three Vercel environments.** |
| `0103_guards_and_grants.sql` | diff seven copied function bodies; prove no non-admin path calls `refresh_part_sourcing` / `offer_landed_cost_qar`; raise the order-line cap to 300 and exempt class orders | **Six of the seven copies came through clean** — they differ from their newest definitions only by the deliberate new guard, plus a `search_path=''` re-pin whose references are all qualified. 0098's work on `refresh_part_sourcing` survived. `engineering_job_refund_internal` is a deliberate rewrite, not a copy. No defect found, so no body was changed. Every call site of the two sourcing functions is service-role, super_admin-guarded or inside a trigger, and the repo builds no RPC name at runtime, so nothing breaks. Cap raised to 300 with class orders exempt. **It also surfaced the run-order trap in §4.** |
| `0105_parts_cost_private.sql` | find every `select('*')`, `parts(*)` embed and `insert().select()` on `parts`; add a grep test | **No app change needed** — all 97 `from("parts")` call sites already name their columns or go through `readPartsAdmin()`/`parts_admin`, and the ~25 write chains have no `.select()`, so no row comes back. The header's rollback block was repaired (it restored the table grant but left the per-column grants behind). New `lib/store/part-columns.test.ts` fails the build if a wildcard select or `parts(*)` embed reappears: 0 offenders today. |
| 90 deleted message keys | restore any key still built at runtime | **None needed restoring.** Every dynamic `t()` call site was enumerated and its concrete key set worked out (the `cat_${c}` families, the `*Title`/`*Intro` families, the payment-method families, the tree `node_`/`need_` keys). The repo builds no key by concatenation and has no multi-line template. **But `Studio.cat_logic` was missing in BOTH locales on `origin/main`** — the live `MISSING_MESSAGE` bug (F-026) — and is now added in the three namespaces that read it. |
| `callbackNextPath()` | confirm the live templates and the forgot-password form still produce `/{locale}/reset-password` | **Confirmed working.** `safeNextPath` refuses auth paths, but `callbackNextPath` carries an explicit carve-out for exactly `/{locale}/reset-password`, which is what the old form sent. So the old flow kept working in the gap before Phase C replaced it — and the callback keeps that branch for emails already in inboxes (§9 item 1 removes it). |

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

| F-019 `/ar` product specs | **Fixed** | The Arabic page replaced *both* the description and the spec table with "not translated yet". That rule is right for supplier prose and wrong for the spec table, which is structured data — numbers and units that read the same in any language. The table now falls back to the English rows under the Arabic heading, with the "not translated yet" note moved **under** it rather than replacing it. English prose still never reaches `/ar`, and a test pins that. It does not replace your translate step; it makes the gap survivable until you run it. |
| F-018 "Datasheet" shown without a datasheet | **Already correct — no change** | The link is already gated on `datasheet_url` being set (`app/[locale]/store/[sku]/page.tsx:363`). The tester saw no datasheet on 3 of 3 products because **no product has the field filled**, which is a data gap, not a UI bug. Filling `datasheet_url` is an admin job. |
| F-018 "Clean description" admin step | **Not done** | Rewriting the top-50 supplier descriptions into plain English is a new metered admin action (a `translate_details`-shaped step with a super_admin button). It is a feature, not a fix, and it is the largest remaining item from the QA list. Nothing was built for it. |

| F-002 CAD credit price | **Fixed** | The button said 2 credits and the balance went 5 → 3 while the site sells a 3D model for 1. There were **two** sources: the label computed `cadCost(studioCadTier(parts))`, and the spend was decided **in SQL** — applied migration 0090 stores `credit_cost = cad_tier_cost(tier)` and `cad_deliver` books the extra as a `cad_extra:` ledger row. `PUBLISHED_CAD_CREDITS = 1` is now the single source; the SQL tier is derived from it by inverting `cad_tier_cost()`, and every label is derived from the same value. Raise the constant and the label and the SQL spend move together — they cannot diverge. The same 2-credit path on `/api/cad` (the word "case" alone made a request "standard") and in the cloud flow is closed too. 0090 was **not** edited; the complexity rule still exists in the database and is simply unreachable. §6 says what you would change to publish complexity pricing instead. |
| F-009 Enclosure pictures failed silently | **Fixed** | The preview job only reported "failed"/"no_render", so the cause was discarded — offline, a 409 not-ready, a 5xx and "every picture failed" all looked the same. The reason now survives, the step says it in plain words, Retry appears where retrying can help, and the empty grey box is replaced by a worker-drawn standard case. The exact production error could not be reproduced from here, so the reasons come from the code paths rather than a live trace. |
| F-024 Long AI waits | **Fixed** | Staged text plus "Usually 30–60 seconds" on the idea chat, case drawing and code writing, following the Parts step's existing pattern. No invented per-step timings. |
| F-025 Guest project after cleared data | **Fixed** | "Try again" was advice that could never work. The missing guest token is now detected specifically: "This design was saved in another browser. Sign in to find it, or start again." |
| F-028 Promised questions never asked | **Fixed (copy)** | Changed to "Tell us in your own words. If we need more detail, we'll ask." The prompt already permits questions; the model just returns the card, and making it ask would be a behaviour change nobody requested. |
| F-039 Pin list highlight | **Fixed** | Real highlight plus scroll-into-view, keyed on the selection only so it does not fight the user's scrolling. |
| F-040 Schematic net names | **Fixed, with a caveat** | The finding's premise did not hold: the Pin list never shows net names to a customer, it shows part + pin wording. The schematic now builds its rail labels from the **same connections**, and `WiringStep` was rebuilding connections *without the spec* before handing them over, so the schematic genuinely was not reading the same list. **Caveat: the new labels run to ~40 characters, widening the schematic and partly repeating the pin text beside the symbol.** Correct but possibly ugly — a shorter form needs a naming rule of its own. Worth your eye. |
| F-041 Try-it threshold blank | **Fixed — different cause** | The value was already bound. The real defects were a flex child without `shrink-0` (squeezed to nothing in a narrow column — the likely "blank") and a clamp on every keystroke that made "75" impossible to type (7 jumped to 10). |
| F-043 Project cards | **Fixed** | Part count from the doc's components; "Quote requested" once a request exists. Projects with no Studio doc keep the old count. |
| F-044 No estimate in the dialog | **Partial** | The QAR range now shows before sending, through the existing `quoteBreakdown`. **Two gaps:** the duplicated email could not be reproduced from the code and needs a live look; and the dialog uses the **default** quote rule, because your saved `studio_quote_rule` is only read server-side — so if you have changed it, the dialog and the Request page can disagree. Closing that needs a small route exposing the rule. |
| F-045 FQBN in the Code step | **Fixed** | "Arduino Nano", from the library part's display name, falling back to a tidied FQBN segment. |
| F-047 Arabic message, English reply | **Fixed** | The reply and the question mirror the visitor's language; the card, features and change labels stay in the page language. |
| F-048 Chat input not cleared | **Fixed** | Cleared on send. |
| F-008, F-023 Ideation tokens | **Being rebuilt (2026-10-25)** | Rather than only adding copy, the owner chose to rebuild the model: three complexity tiers, Tier 1 free, costs quoted upfront and fixed once agreed. See §3.5. |

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
11. **A 3D model costs 1 credit everywhere (F-002).** The Studio was charging 2 for a
    9-part build through a complexity rule that `/pricing` never mentioned. The rule still
    exists in the database (migration 0090, applied) and is now unreachable.
12. **The Arabic product page shows the English spec table** when `specs_ar` is empty,
    instead of hiding it (F-019). The description still never falls back.
13. **The first order status reads "Received" to a customer** and still "Confirmed" to an
    admin; the stored value is unchanged (F-017).
14. **A chat reply mirrors the visitor's language** (F-047). The card and its labels stay
    in the page's language.
15. **Project cards show a real part count and a "Quote requested" status** (F-043).

### 3.2 The template enclosure now produces printable files — RESOLVED (2026-10-25)

**This was the open decision. It is closed: both enclosure paths now export printable
files, so the "paid a CAD credit and got nothing" case cannot happen.**

The problem was that `three-bvh-csg`'s booleans were non-manifold at the source — the dome
lid came back with 2,611 unbalanced edges out of 6,275 triangles — so once the STL export
began refusing bodies it could not close, that path handed over nothing, after the credit
had already been spent at the Enclosure step.

You chose the long-term fix: rebuild it on the product kernel. What landed:

- **The plan was kept; only the mesh engine changed.** Shapes, sizes, openings, label
  placement and the settled layout are identical to before — the booleans are now
  manifold-3d, the same kernel the product path uses, through a new shared
  `lib/studio/geometry/kernel-core.ts`.
- **This was the right call rather than routing templates through `solveProduct`.** The
  kernel's `enclosure` form has no wedge angle, taper amount, dome rise, floor offset or
  socket; `lantern` is round there and rounded-rect in the templates; and hex vents, grille
  arcs, wall-plate keyholes and slanted louvres cannot be expressed as a `SolvedCutout`.
  Forcing it would have changed the look of four templates and misplaced their cut-outs.
  Sharing one *model* rather than one kernel is still possible later — the exact list of
  missing parameters and cutter kinds is in §9.
- **Measured, all nine templates**, plant-waterer fixture: every lid, base and spike
  watertight, 0 bad edges, exactly one shell. `stake_pod` is 99.17 × 99.17 × 29.75 mm,
  3 printable bodies, 132 g, **one plate** inside the MK4 bed. A sweep of **129 real vent
  combinations** (5 patterns × 4 faces × 9 templates) is watertight throughout, and a ray
  cast down each USB-C and cable-gland cut-out proves the opening really goes through.
- **It is also 10–45× faster**: ~110 ms per case against 1–5 s for the CSG path.
- **The old builder is gone** — `lib/studio/enclosure/build.ts`, 656 lines, deleted, with
  every importer migrated. Net −1,056 / +284 lines. Two builders would have been a trap.
- **The geometry cache version was bumped** (`w6-1` → `k1`), so an IndexedDB case saved by
  the old builder can never be served again.

Golden regression unchanged: the product path's kernel code is byte-identical, only moved.

**What this means for the other two options I offered you:** they are moot. There is no
longer a path that charges and cannot deliver, so there is nothing to refund and no warning
copy to write.

**Still worth doing before you merge:** a live click-through of Enclosure → Print on a
phone. The enclosure worker reply is now async-after-WASM rather than synchronous, and
while every caller already awaited it, that is the one change a browser would feel.

### 3.3 The delivery filter's buckets — RESOLVED (2026-10-25)

Making the filter honest (F-013) exposed that with the live settings — handling 1, transit
2, buffer 3 — even an in-stock item arrives in about 8 days, so "3-5 days" matched nothing.

You chose to relabel the buckets to the windows that are real:

| label | range | what lands there today |
|---|---|---|
| Up to 2 weeks | <= 14 days | in-stock (~8), the 3-5-day class (~11) |
| 2-4 weeks | 15-28 days | the 1-2-week class (~20) |
| Over a month | > 28 days | the 2-4-week class (~34) — open-ended, so nothing falls outside every bucket |

The `?stock=` values are unchanged, so every shared link still works; they are historical
names now, and the code says so. `Delivery.lt_*` and `Sourcing.lt_*` were deliberately left
alone — those name the supplier's lead class on the product page and in admin, where
"3-5 days" still means exactly that. A test fails if any bucket is ever empty.

**The other half is yours and is not code:** tightening handling and buffer so fulfilment is
genuinely faster. The arithmetic is in §7a. Today's 1+2+3 puts an in-stock item at ~8 days;
1+2+1 puts it at ~6. A buffer of 1 is the sensible floor — it is what absorbs a supplier
being a day late without breaking a date already shown to a customer.

### 3.5 The ideation-token model, rebuilt (owner decision, 2026-10-25)

F-008 said tokens are a second currency only one page explains; F-023 said the counter
deducts optimistically and tells people they are broke mid-turn. Rather than paper over
both with copy, the owner replaced the model.

**Three tiers, classified from the project's scope, not from a separate AI pass:**

| tier | what it is | cost |
|---|---|---|
| 1 — basic / educational | one controller, ≤ 2 sensors, ≤ 2 movers, ≤ 2 axes | **free** |
| 2 — mechatronics / multi-axis | several coordinated axes, a higher-end controller, or more than one controller talking over a bus | 7 tokens |
| 3 — advanced / turnkey | custom PCB, production firmware, integrated packaging, complex power | 14 tokens |

**Refining the same idea is always free, however many turns.** Tokens are charged only when
a turn moves the project up a tier, or starts a genuinely different product — and both pause
and quote the exact cost before anything is deducted, with the option to decline and carry
on refining. Once agreed, exactly that amount is charged even if the model's real usage
differs; estimated-vs-actual is recorded for unit economics (migration **0106**, NOT RUN).

**Decided here, and worth knowing because each will look like a bug to someone:**

1. **Tier 3 is reached by integration signals only, never by part count.** A ten-sensor build
   with no integration signal is deliberately Tier 2 at 7 tokens; the old config put
   "anything bigger" in the top tier. Integration is what makes a project expensive to think
   about. *Owner, 2026-10-25.*
2. **Tier 1 narrows from 3 sensors to 2**, so a three-sensor build that ideates free today
   becomes Tier 2.
3. **The price is presentation, not economics.** "QAR 10 with 80% off" resolves to the
   **QAR 2 that is already charged today**. No pack price moves and no customer pays more.
4. **There is no Stripe and no card gateway.** Tokens are paid by Fawran, bank transfer or
   cash through migration 0089, with a human approving the receipt. The one place amounts
   live is `lib/billing/config.ts`.
5. **Tier 2 = 7 and Tier 3 = 14** were not in the spec; they come from the owner's own
   2026-10-23 decision recorded in CLAUDE.md, and are tunable in one place.
6. **The new-product check is deliberately biased toward free.** It fires only when the
   model's hint and our own reading of the identity fields agree, because a false positive
   charges someone who was only refining, while a false negative costs one free turn.

### 3.4 Things I could not reproduce, and did not "fix" blindly

Three findings describe behaviour I could not make happen against this build. In each case
I have written down what I checked, rather than changing code to look responsive:

- **F-037, three.js on the store page.** The store, home and product initial chunks contain
  no three/BVH code and a live load logged no warning. The home hero *does* deliberately
  load a 3D loop once idle (your W7 decision), so the tester most likely went home → store
  in one tab. Removing that is a product decision, not a bug fix.
- **F-037, a 404 asset on `/projects/new`.** Every asset, `/api` path, RPC and table the
  page references resolves. The only 404s are the `apple-touch-icon` files browsers probe
  for unprompted. The run did not capture the URL — if it recurs, that URL settles it.
- **F-044, the email shown twice in the Get-it-made dialog.** The dialog renders it in one
  place in the code. Needs a live look.
- **F-029, suggestions needing four characters.** The code already suggests from two, in
  both the route and the component. If the live site still needs four, the deployed build
  is older than this code.

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
| 0106 | `0106_idea_charge_telemetry.sql` — the ONLY migration this branch adds of its own (the tier rebuild; everything else was application code). **Optional and last**: it records what was quoted vs what was charged vs what the turn really cost. It adds nothing to the money path, and if it is never run the app keeps working — the telemetry write is best-effort and only logs a warning. | `select * from public.admin_idea_charge_summary(30);` → returns rows (empty is fine) |

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

### 7a. The two settings halves of your decisions (2026-10-25)

Both of these are **data, not code** — this branch cannot write to the database, so they are
yours. Neither needs a deploy.

**1. Shipping handling and buffer — Dashboard → Store → Suppliers.**
The filter buckets are now "Up to 2 weeks" / "2–4 weeks" / "Over a month", measured on the
computed arrival date. You asked to tighten processing so fulfilment is realistically
faster. The arithmetic, so you can pick deliberately — arrival = lead class + handling +
transit + buffer, the last three counted in Qatar working days:

| handling + transit + buffer | in-stock arrives in | 3–5-day class | 1–2-week class |
|---|---|---|---|
| 1 + 2 + 3 (today) | ~8 days | ~11 | ~20 |
| 1 + 2 + 1 | **~6 days** | ~9 | ~18 |
| 1 + 2 + 0 | ~5 days | ~8 | ~17 |

A buffer of 1 is the sensible floor: it is what absorbs a supplier being a day late without
breaking the date already shown to the customer. **Only tighten to a window you can keep** —
the whole value of this screen is that the date on the card is one you hit.

**2. Kit discount — Dashboard → Store → Product attributes.**
You chose to lower `kit_discount_pct` rather than carve the Studio out in code. Nothing in
the code changes: the Studio now writes a real kit (that is what fixed F-006), so the
percentage you set there applies to Studio kits and BOM kits alike. Lower it to whatever
margin you are happy with across both, and watch a few real Studio kits before settling.

### 7b. Everything else

- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in **all three** Vercel environments
  (Production, Preview, Development). Many routes answer 503 without it, and the new startup
  warning is the only thing that will tell you.
- **Supabase → Authentication → set the minimum password length to 8.** F-031 raised the
  minimum everywhere we control it, but sign-up talks to Supabase straight from the browser,
  so without this setting a 6-character password can still be created through the API.
- **Dashboard → Store → clean the product descriptions** and run the Arabic translate step
  (F-018, F-019). Both are metered admin actions and are yours to run, not ours.
- **Run the "translate details" step** (Dashboard → Store → Sourcing overview → Arabic descriptions and specs). F-019 makes the gap survivable by showing the English spec table, but your Arabic customers still get English specs until this runs.
- **Fill `datasheet_url`** on the products that have one. The link is already gated correctly; the tester saw none because no product has the field set.
- **Delete the QA test rows** in one pass — the list is §8.

## 7c. Click-through screenshots

`review/fixes/screenshots/` holds 63 full-page screenshots — 17 pages × EN/AR × 1366 and
375 px — produced by `node scripts/review-screenshots.mjs` against a local production
build. They cover home, store, cart, checkout, pricing, terms, sign-up, the whole new
password-reset and confirm-email flow, the 404, and four Studio steps.

Five did not capture, and neither is a regression: `/sign-up` answers 500 because this
worktree has no `.env.local` ("Supabase is not configured"), and three Studio geometry
steps exceed 30 s building meshes in headless Chromium. The script reports any page that
did not return 200 rather than silently photographing an error page.

The email renders are separate, in `review/fixes/emails/` (four templates × 600 and 360 px).

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
| Studio bundle (`scripts/studio-bundle-size.mjs`) | First load 197.6 kB gz unchanged. The enclosure rebuild took `three-bvh-csg`/`three-mesh-bvh` out of the graph: **worker 276.3 → 245.2 kB gz** (93.7 of it not shared, was 123.9) and the **no-Worker fallback 82.7 → 53.8 kB gz**. Studio-before-CAD is 484.3 against its 350 budget — still over, as it was before this branch. |
| `npm run test:e2e` | **249 passed / 60 failed / 2 flaky / 65 skipped**, against the audit baseline's 221 / 62 / — / 53 under the same no-Supabase condition. The three specs this branch adds or rewrote are clean: `a11y-axe` 0 failures, `reset-password` 0, `studio-engine` 0. See §8c. |
| Route table vs `origin/main` | **No static/ISR flag changed anywhere.** One new route, `/[locale]/confirm-email`. Shared First Load JS identical at 104 kB. |
| First Load JS | `/[locale]` 149 kB, `/[locale]/store` 148 kB, `/[locale]/store/[sku]` 211 kB — all within 2 kB of baseline. `/[locale]/reset-password` **198 → 133 kB** (−65 kB: the page no longer pulls the Supabase browser client, because it does not authenticate on GET). `/[locale]/forgot-password` 201 → 228 kB. Note the baseline is `origin/main` *before* the audit's own 129 commits, so these deltas are the audit plus this branch, not this branch alone. |
| `npm run test:e2e` | see §8c |

## 8c. The e2e suite, and a trap worth knowing about

**Playwright no longer reuses a running server, and that matters more than it sounds.**
`reuseExistingServer: true` cost two separate debugging sessions on this branch:

1. Another checkout of this repo was serving `:3000`, so the whole suite — the new axe scan
   included — tested **that** build. Noticed only because a page rendered a message that
   exists nowhere in this source.
2. A server *we* had started on `:3100` for a manual check was still running. `npm run
   start` loads the build manifests at boot, so later rebuilds never reached it: every run
   afterwards tested the app as it stood hours earlier against **current test code**. That
   mismatch produced an apparent regression — `studio-engine`, the spec guarding the 3D
   engine, going from 0 to 6 failures — which **does not exist**. Against a fresh server it
   is 8/8, in 1.8 minutes instead of 12.6.

The failure mode is nasty because nothing errors: the server answers 200, the tests run,
and the only symptom is assertions failing for reasons that make no sense against the code
in front of you. Reuse is now opt-in (`E2E_REUSE=1`); the default starts its own server and
tears it down. `E2E_PORT` still exists for running beside another checkout.

**Which environment a run used changes its numbers more than any code here does**, so
every bar below says which one it was measured in. This worktree has no `.env.local`.

| run | env | passed | failed | flaky | skipped |
|---|---|---|---|---|---|
| audit baseline (`origin/main`) | none | 221 | 62 | — | 53 |
| this branch, first measurement | none | 250 | 59 | 2 | 65 |
| this branch | public Supabase vars | 321 | 28 | 0 | 39 |
| **this branch, final** | **public Supabase vars** | **322** | **26** | **1** | **39** |
| **`origin/main`, same seven specs, same env** | **public Supabase vars** | — | **26 (identical set)** | — | — |

"Public Supabase vars" means `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
loaded into the build environment and nothing else — both are shipped to every visitor's
browser anyway. `SUPABASE_SERVICE_ROLE_KEY` was deliberately NOT loaded, nothing was
written to disk, and the suite's write guard still aborts every non-GET to Supabase.
Supplying them turns 59 failures into 26: that batch was "Supabase is not configured" and
the empty pages that follow from it, nothing else.

**The check this section could not make before, now made.** The audit's criterion is "zero
tests that passed in the baseline fail now", and totals cannot show that. So `origin/main`
(88a6473) was built in its own worktree under the identical environment, on its own port,
sharing `node_modules`, and the seven specs that still fail were run against it. The
failure lists were then compared line by line:

* **fails here, passed on `origin/main`: none.**
* The 26 remaining failures are the same 26 tests, test for test, that fail on
  `origin/main` — `plan-a-product` 8, `studio` 5, `studio-robot-arm` 4, `studio-idea` 4,
  `studio-enclosure` 4, `studio-product` 1. They are pre-existing and environmental: a
  partial env still has no service-role key and no write path, and these specs expect a
  signed-in, writable app.

Both new specs are clean: `reset-password` 20/20, `a11y-axe` 10/10 over three consecutive
runs, and the new `studio-tier-checkpoint` 12/12.

**Two traps cost an hour each; neither is in the code.**

1. **A stale `.next/cache/fetch-cache`.** Builds made before the env was supplied cached
   the "flag off" answer, so the home page prerendered with `robots: noindex` and
   `site-v2-flag` failed on four tests — and ONLY on this branch, because the baseline
   worktree built fresh. CLAUDE.md records the same trap from the 2026-10-09 cut-over.
   `rm -rf .next/cache/fetch-cache` and rebuild; all four pass.
2. **Reading `$?` through a pipe.** `npx playwright test | tail` reports `tail`'s exit
   code, which is always 0. A run with 59 failures looked like a pass. Capture the output
   to a file and read Playwright's own exit code, or the summary line.

**The flakes were chased, not retried away.** `studio-parts-popover` was the worst of
them (flaky in two earlier runs, in different locales and projects, then failing outright):
the open popover is remembered by `instanceId`, the rows are rendered again as the step
settles, and a popover opened inside that window belongs to a row that no longer exists.
Measured on both branches — opening immediately loses it on BOTH, opening on a settled list
keeps it on BOTH — so the spec waits for the list to settle and parks the pointer off the
rows first. Three runs: 6 passed, no flake. The `a11y` flake had its own cause, below.

One flake is left, and it is pre-existing: `studio-wiring-views` *pin list selection…[en]*
on the 375 px project, passed on retry. Viewport/animation timing, not logic.

**What I still cannot claim:** that the app is right with a FULL environment. Everything
above ran without a service-role key and against production read-only data, so the 26
pre-existing failures stay unexplored rather than explained. Running the suite once against
a deployed preview with the real env is the check that would settle those.

### Accessibility, measured

The axe scan (`@axe-core/playwright`, WCAG 2.0/2.1 A and AA, failing on **serious and
critical** only) found and we fixed:

- **`label` (critical)** and **`nested-interactive` (serious)** on the home page — both the
  same cause: the design dropzone's `<input type="file">` sat **inside** the `<button>` that
  opens it, so it was two interactive controls in one and the input had no accessible name.
  On the "upload a CAD file" path, that is the business.

Allow-listed, with the reason, and **needing your decision**:

- **`color-contrast` (serious)** on home (EN), store (EN), checkout (EN) and the Studio
  fixture (EN). This is the design system, not a page bug: `text-faint` at 9–10px and some
  neu button text are under 4.5:1. Changing those tokens changes the brand on every page,
  so it is yours to decide rather than something to quietly restyle. The Arabic pages mostly
  pass, because the RTL `.kicker` rule drops the 9px mono treatment.

A stale allow-list entry **fails** the test, so the list cannot rot — it already caught one.

**A safety property worth stating:** this branch was built in a git worktree that has **no
`.env.local`**. The production Supabase credentials were never reachable from it, so no
migration, write or paid API call was possible at any point — not by policy, but
structurally. It is also why the e2e suite's numbers look the way they do: it runs without
Supabase env, exactly as the audit's baseline did.

## 8d. Where this stopped (2026-10-25, paused mid-verification)

Everything in sections 3.5 and 10 is committed on `fix/review-2026-10`, and the
working tree is clean. Nothing is pushed.

**Green, re-measured after the last code change:** `tsc` clean · `npm run lint`
0 errors (219 pre-existing warnings) · `npx vitest run` 4,067 passed (309 files) ·
parity 5,326/5,326 · no circular dependencies · `npm run build` passes.

**NOT finished: the end-to-end suite.** It ran for 33 minutes against a fresh
production server on port 3400 and was stopped before it printed a summary, so
there is no pass/fail count for this branch yet. While it ran, `test-results/`
collected retry folders for four tests:

| spec | note |
|---|---|
| `dashboard-nav` — old dashboard URLs still answer | retried; also present in earlier runs |
| `home-w7` — AR search, add to cart updates the badge | retried on desktop AND mobile-375 |
| `studio-wiring-views` — hover previews the wire (en, mobile-375) | retried |
| `studio` — idea to enclosure (en + ar, mobile-375) | retried; the heaviest specs in the suite |

A retry folder is not proof of a final failure, and none of these four touch the
tier model, the checkpoint modal or the token copy. They are most likely the
known flakies (the summary before this change recorded 2 flaky), but **that is a
guess, not a measurement** — do not record a green e2e bar until the suite has
actually finished.

**To resume, from this worktree:**

```
npm run build
E2E_PORT=3400 npx playwright test
```

Run it in the background and give it 45–60 minutes. `reuseExistingServer` is off
by default on purpose (§8c), so it boots its own server; the one from the stopped
run was killed, and port 3400 is free. If the four tests above fail again, check
them against `origin/main` before blaming this change.

**Then, to close the branch out:** re-read §9, and decide whether the untracked
`review/` folders belong in git — `review/fixes/screenshots` (16 MB),
`review/fixes/build` (2.2 MB), `review/qa` (54 MB, your input pack) and
`review/gestaltung-audit-reports-2026-10` (4.5 MB) are all on disk and all
untracked. I left them out rather than put 77 MB into the repository without
asking.

## 8e. Found while verifying, worth your attention

Three things the verification turned up that are NOT part of the token work.

**1. A real accessibility fix shipped.** The axe scan had never actually run on a product
page — without a catalogue it skips — so the first real run found the "Arrives by" badge at
**4.47:1** where AA wants 4.5:1. Fixed (emerald-800); the in-stock badge shared the pair and
moved with it.

**2. The header tagline fails AA on every page, and that is your call.** "Product design &
fabrication · Lusail, Qatar", 9px `text-faint`, measures **2.28:1**. It is already
allow-listed on home, store, checkout and the studio fixture, and the product page now
joins them. Changing the token changes the brand everywhere, so it sits in "Needs owner
decision" rather than being quietly restyled. A darker `text-faint`, or dropping the 9px
treatment, would clear it on every page at once.

**3. A fast tap on the parts list can be swallowed (minor, pre-existing).** `PartsStep`
remembers the open popover by `instanceId`; the rows are rendered again as the step
settles, so a popover opened in that first moment belongs to a row that no longer exists
and disappears. A person is unlikely to be that fast, which is why it has only ever shown
up as a test flake — but it is real. The fix is to keep `popFor` when the same instance
survives the re-render. Left alone here: it is product behaviour, not audit scope.

## 9. Follow-ups

0. **`three-bvh-csg` is now used by test code only.** After the enclosure rebuild, nothing
   in `app/`, `lib/` or `components/` imports it — only three tests, for
   `computeMeshVolume`. Swap those for the repo's own `signedVolume` in
   `lib/studio/mech/templates.ts` (mind the sign: it is signed, not absolute) and drop the
   dependency. Leave `three-mesh-bvh` alone — nothing imports it directly, but it is reached
   through `@react-three/drei` at runtime. Housekeeping, no user impact, so it was not done
   inside this review.
1. **If you ever want the two enclosure paths to share one MODEL** rather than just one
   kernel, this is the exact work: add `wedgeDeg`/`frontH`, a taper amount, `dome.z0`/`rise`,
   a floor offset and a socket to the kernel's `enclosure` form; make `lantern`
   rounded-rect rather than round; and add four cutter kinds to `SolvedCutout` (hex vents,
   grille arc slots, wall-plate keyholes, slanted chamfered louvres). Doing it without those
   would change the look of `lantern`, `dome_base`, `soft_wedge` and `handheld_taper` and
   misplace their cut-outs, which is why it was not attempted.

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
8. **Finish F-008 / F-023 (ideation tokens)** and the **"Clean description" admin step**
   (F-018). These are the two real pieces of QA work this round did not reach.
9. **Look at the schematic's new rail labels** (F-040). They are ~40 characters and widen
   the canvas; a shorter naming rule may be worth it.
10. **Expose the saved `studio_quote_rule` to the client** so the Get-it-made dialog's
    estimate matches the Request page when you have changed the rule (F-044).
11. **Add `Prototyping.hard_load_return_on_ground`** to `messages/{en,ar}.json`, params
   `{ref}`, `{driver}`, `{net}`, for the legacy Engineer view. No user can hit a missing
   key today — the flag only arises from Studio wiring, and the Studio shows its own inline
   line — but the Engineer view would render the raw key if it ever did.

## 10. Branch and commits

Branch **`fix/review-2026-10`**, cut from `origin/main` 88a6473, built in its own git
worktree. **Not pushed, not merged, not deployed. No migration has been run and no database
was touched** - the worktree has no `.env.local`, so production was never reachable from it.

- 7851a71 Apply audit 2026-10 proposed changes (see review/gestaltung-audit-reports-2026-10/proposed-code-changes/COMMITS.txt)
- d1a4c52 Phase A repair: restore the docs the audit diff could not carry
- ec2053f Phase A re-review of the audit's migrations 0100/0102/0103/0105
- 8bdb1cc F-001, F-026: Terms say what is true, and the missing Studio.cat_logic key
- d844e2b Phase C part 1: auth emails carry a token hash and a code, not a spent link
- 560cbb6 F-013, F-014: the delivery filter means what it says; no slower tier at the same price
- 8637ef6 F-020, F-038, F-049, F-054: relevant suggestions, readable pages, lighter store
- 2320323 Phase C part 2: reset and confirm verify on submit, never on GET
- 2ea3a64 F-015, F-016, F-017, F-036, F-050: say the right thing about money and orders
- 633b984 F-007, F-010, F-011, F-012, F-046, F-052: the Studio's engineering output is checkable
- 2fed4cf F-035, F-053: Arabic renders in Plex, and the home page paints in under a second
- eee175c F-021, F-022, F-029-F-034, F-051: accessible names, a skip link, and an honest quote receipt
- e8f9a5a F-006: "Add all to cart" writes every stocked part, in one insert
- 1b36c60 F-003, F-004, F-005, F-027, F-042: printable meshes, one weight, a case shaped around the parts
- 65aa449 Phase D: axe findings fixed, the 404 title actually works, e2e can pick its port
- f052f1b F-019: /ar shows the spec table in English rather than hiding it
- 1629778 F-002: charge the price the site publishes, and make the two impossible to diverge
- ef58a2f F-039, F-040, F-041: the wiring views agree, and the Try-it field works
- 10523ed F-009, F-024, F-025, F-028, F-032, F-043, F-044, F-045, F-047, F-048: the Studio explains itself
- 15762f0 e2e: the two new specs actually pass now

The first commit is the whole 2026-10 audit applied as one change (its 129 commits existed
only as a diff); everything after it is this round's work.
