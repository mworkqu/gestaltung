# STAGE — Admin dashboard walkthrough fixes (owner test, 2026-10-11)

Paste everything below into Claude Code at the repo root. Run it after `STAGE_STUDIO_WALKTHROUGH_FIXES_PROMPT.md` is finished and merged (it depends on W1 from that stage).

---

You are working on the Gestaltung360 Next.js 15 app. Read `CLAUDE.md` first. Same rules as every stage:
- Bilingual EN + AR/RTL with every string in both message files.
- Existing tokens and neumorphic components.
- super_admin only for everything under `/dashboard`.
- Run lint, tsc, tests and e2e after each block, then commit with the block ID.

Owner rule for the dashboard: **simple enough to see at a glance what to do**. He doesn't want a manual. Explain things with short hover/tap hints (a small "?" or info dot with a tooltip that also works on touch and keyboard), not paragraphs. Most of the confusion below is missing context, not missing features.

Context Claude found in the code (verify, then build on it):
- **Fix list** (`app/[locale]/dashboard/store/fix/page.tsx`, `lib/admin/fix-data.ts`, `lib/admin/home-tiles.ts → fixIssues`): "delivery date" is flagged when `parts.lead_time_class` is null. That column is **only** set by the recompute from an **active supplier offer** (migrations 0028/0032). Editing the product form can never fix it directly, which is why the owner found "no date to change". The only route is "Add offer" in `components/admin/sourcing-panel.tsx`. The fix list doesn't show the supplier or why the date is missing (e.g. a Voltaat offer exists but is inactive or out of stock).
- **Edit save** (`app/[locale]/dashboard/store/actions.ts:130–131, 160–161`) always does `redirect(/dashboard/store)` (the catalog), so the owner loses his place in the fix list.
- **Sidebar** (`components/dashboard/dashboard-nav.tsx:79`) is `sticky top-6` with no max height or overflow, so a nav taller than the screen can't be scrolled. "Back to website" is at the bottom (line 59). `admin-nav-groups.ts` has 24 items in 6 groups.
- **Orders:** `colWhatsapp` = "WA sent" is a manual toggle meaning "the WhatsApp order confirmation was sent to the customer" (`toggleWhatsappSent`). `part_orders.is_test` exists (0031). Neither the order list nor the detail shows product photos or status hints.
- **Videos:** the 6 feature videos are recorded by `scripts/record-videos` and hosted in the Supabase `videos` bucket (`scripts/upload-video.mjs`, `lib/videos.ts`). The "YouTube links" admin page only stores links. Nothing is on the owner's channel.

---

## D1 — Fix list that actually gets things fixed (🔴)

1. **Group by reason and by supplier.** Show a header per issue (Delivery date · Photo · Price · Supplier) with counts, and inside Delivery date a sub-group per supplier: **Voltaat · Mouser · DigiKey · AliExpress/Alibaba · Own stock · No supplier**. Get the supplier from `supplier_offers → suppliers`, falling back to the SKU prefix (`VLT-` = Voltaat). Each row says *why* in plain words: "Voltaat offer is out of stock", "No supplier offer", "Offer has no lead time".
2. **Bulk fix.** Add checkboxes plus "Select all in this group", then a bottom bar of actions:
   - **"Set delivery time"**: choose a supplier (or "Own stock in Lusail") and lead days. It creates or updates the offer for every selected product and runs the existing recompute so `lead_time_class` is filled.
   - **"Mark on request"**: an explicit "on request" choice, so the product stops appearing in Fix.
   - **"Unpublish"**.

   All actions go through a server action with a confirmation and a result toast ("23 fixed, 2 failed — see why").
3. **Single fix in place.** Clicking a row opens a **side drawer** (not the old page) showing only the missing fields. The missing ones get a red outline and an "Add this" label. A delivery-date gap shows the offer mini-form (supplier, lead days, cost) at the top. **Save closes the drawer, removes the row, and moves focus to the next row.**
4. **Fix the edit-form redirect everywhere.** `actions.ts` takes a `returnTo` (validated same-origin dashboard path). The fix list, catalog, gaps and restock pages pass their own URL including filters and scroll anchor. If none is given it defaults to the catalog.
5. **Edit form validation.** Missing required fields are red with a one-line hint. Add a sticky "What's missing" summary at the top of the form that jumps to each field. Move **Delivery (supplier offers)** up as its own clearly labelled section, with a hint: "Delivery date comes from a supplier offer. Add one here."
6. The Fix tile count on Home matches the page count exactly.

## D2 — Sidebar: 4 groups, scrollable, back-to-site on top (🔴)

1. **Owner chose 4 groups.** Rewrite `admin-nav-groups.ts` as:
   - **Today:** Home (merge "Numbers & funnels" *into* Home. The owner likes its look better, so use its cards and funnel visuals as Home's top section and keep the action tiles below; the `/dashboard/overview` route redirects to `/dashboard#numbers`).
   - **Sell:** Orders · Products (catalog, quick add and attributes as tabs inside one page) · Fix list · Restock / Stock to buy · Discounts & occasions (tabs) · Reviews.
   - **Build:** Leads · Projects · AI credits · Studio parts.
   - **Settings:** Suppliers (lookup and Voltaat sync as tabs) · Sourcing gaps · Videos & YouTube · AI usage & pricing · Notifications · Inventory.

   Keep every existing route working. Merging into tabs must not break deep links.
2. Each item gets an icon and a **count badge** where it means "something to do" (Orders new, Fix count, Leads new, Reviews to approve).
3. **"← Back to website" goes at the very top** of the sidebar and the mobile menu.
4. **Sidebar scrolls on its own:** `sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain`, with the active item scrolled into view on load. On mobile, the nav drawer gets the same treatment.
5. **Long right-hand content lists:** add a "Back to top" button after 2 screens, and paginate or virtualise lists over 100 rows (catalog, fix, orders) with search and filters that stay in the URL.

## D3 — Orders you can understand at a glance (🔴)

1. **Hover/tap hints** on every status pill and column header, in one short line each:
   - Confirmed: "Customer placed it; check stock."
   - Paid: "Money received."
   - Sourcing: "Ordering from the supplier (shown below)."
   - Shipping: "On the way to the customer."
   - Delivered: "Customer has it."
   - Cancelled: "Stopped; no money kept."
2. **Rename "WA sent"** to a WhatsApp icon with the label "Confirmation sent on WhatsApp" and the tooltip "Tick after you message the customer." When the WhatsApp module from the earlier stage is live, it ticks automatically.
3. **Next-step button** per order: one button with the obvious next action (e.g. on Paid it says "Start sourcing from Voltaat"), which moves the status forward and logs it in `order_status_history`.
4. **Order detail:**
   - Product **photo** for each line (`parts.images[0].thumb`, falling back to the icon), quantity, price, and the supplier per line with a link to the supplier page.
   - A simple timeline of the status history.
   - Customer name, phone (WhatsApp button) and address.
   - Delivery date promised versus today.
5. **Test and cancelled orders (owner chose "Cancel + hide"):**
   - Add a "Mark as test" action (sets `is_test`) and "Cancel order" (with a confirm). These need no new migration, since `is_test` exists from 0031.
   - The default filter hides `is_test` and cancelled orders. A toggle shows them.
   - **Never hard-delete.** Paid orders can't be marked test.
   - Test orders are excluded from Home numbers.

## D4 — "Did I lose my project?" (🔴, small)

The owner clicked Dashboard by mistake while building in the Studio.
1. Confirm the Studio autosaves on every step for signed-in users (`/api/studio/doc`), and add a unit/e2e test proving it.
2. **Home → "Continue where you left off"** card showing the last 3 projects the admin touched (as a customer too), with a thumbnail and step.
3. While a Studio doc has unsaved changes, add a `beforeunload` guard. In the header, show a small "Saved ✓ / Saving…" indicator so it's always clear the work is safe.

## D5 — AI usage & pricing warnings in plain words (🟡)

The yellow "Cloudflare Turnstile… site key missing" warnings confuse the owner.
1. Replace the jargon with a status line per item: ✅ OK / ⚠️ Needs action / ⏸ Off on purpose, plus one sentence of what it means for the business. For example: "Bot check is off. Fine for now; turn it on if fake sign-ups appear. Needs two keys from Cloudflare (free)." Add a "How to fix" disclosure with the exact env var names.
2. Turnstile while off and keys are missing → ⏸, not yellow.
3. Keep the detailed tables the owner likes, below the status lines.

## D6 — Videos to YouTube (owner chose auto-upload) (🟡)

1. Rename the page to **Videos & YouTube** and list the 6 feature videos from the `videos` bucket, each with a thumbnail, duration, a "Download MP4" button and, if uploaded, the YouTube link.
2. **Connect channel:** add Google OAuth with scope `https://www.googleapis.com/auth/youtube.upload`. Reuse the existing Google Cloud client if suitable (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`), otherwise document the new env vars. Store the refresh token **encrypted** server-side (service role only, new table `integrations` in migration `0072_integrations.sql`, never exposed to the client).
3. **"Upload to YouTube"** per video does a resumable upload from the bucket via the YouTube Data API v3 `videos.insert`. It sends the title, description (EN + AR) and tags generated from the video slug (owner-editable before upload), the `.vtt` captions via `captions.insert`, and the thumbnail. When it finishes, it saves the video ID into the existing YouTube links setting so the site links to the owner's channel.
4. **Be honest in the UI:** Google locks videos uploaded through an unaudited API project to **private** until the project passes Google's API audit. Default privacy to Private, show a hint explaining this, and keep "Download MP4 + copy title/description" as the always-working fallback.
5. Quota: one upload costs about 1,600 units of the 10,000/day default, so show the remaining count.

## D7 — Small polish (🟢)

- **Studio parts page:** add a one-line intro and hint: "Parts the Studio AI can pick from. Each has a 3D shape for the enclosure and a link to the store product." Show a thumbnail of the 3D shape and the store photo side by side.
- **AI credits page:** add quick grant buttons (+1 / +3 / +10), a reason dropdown, the user's balance and recent use inline, and "Email the user" (uses the existing congratulation email).
- **Reviews:** a friendly empty state ("No reviews yet. They appear here after a delivered order."), with a hint about when the review request is sent.
- **Dashboard footer:** replace the full site footer inside `/dashboard` with a single compact line (© Gestaltung360 · version/commit · Help). It must not exceed 48px.

---

## Acceptance checklist

- [ ] Fix list groups by reason and supplier. Selecting 10 Voltaat products → Set delivery time (Own stock, 2 days) → all 10 leave the list, and the Home tile count drops by 10.
- [ ] Single fix opens a drawer showing only the missing fields in red. Save returns to the next row, never to the catalog.
- [ ] Sidebar has 4 groups, "Back to website" on top, and scrolls by itself on a 768px-tall screen. All old URLs still work.
- [ ] Every order status and the WhatsApp column have hover/tap hints. Order detail shows product photos and a timeline. A test order can be marked test or cancelled and disappears from the default view. Nothing is hard-deleted.
- [ ] Home shows "Continue where you left off". The Studio shows Saved ✓.
- [ ] AI usage page shows ✅/⚠️/⏸ in plain words. Turnstile off shows ⏸.
- [ ] Videos page: connect channel, upload one video as private, and the link appears on the site. Download works without connecting.
- [ ] Everything works in EN and AR at 375px and 1366px.

Finish with: what changed per block, migrations to run (0072), new env vars, the Google Cloud steps for YouTube (enable YouTube Data API v3, OAuth consent screen, redirect URI), and how to test each block locally.
