# STAGE — Studio walkthrough fixes (owner test, 2026-10-11)

Paste everything below into Claude Code at the repo root.

---

You are working on the Gestaltung360 Next.js 15 app (this repo, head `d002cc7`). Read `CLAUDE.md` first, especially "Site review decisions", "PERMANENT NOTES" and the Studio (P5) entries. Follow the existing build style: incremental, bilingual (EN + AR/RTL via next-intl, every new string in both `messages/en.json` and `messages/ar.json`), design tokens and neumorphic components already in the codebase, no new paid services, and prototyping only (quantity is always 1).

The owner walked through the live site (gestaltung360.com) as a guest and then as admin. Claude then reproduced the flow in a browser and traced the code. The list below is the confirmed result. Work in the priority order shown. After each block: run `npm run lint`, `npx tsc --noEmit`, `npm test` and the relevant Playwright e2e, then commit with the block ID in the message (e.g. `W1: keep guest project across sign-in`). At the end, add a "Studio walkthrough fixes (2026-10-11)" entry to `CLAUDE.md` PROGRESS and list any new migration under PENDING MIGRATIONS.

Owner rule for every client-facing change: one clear button per step, never re-ask an answer, super simple visuals, nothing technical shown to the client.

---

## 🔴 W1 — Project lost after signing in (CRITICAL, do first)

**Reproduced:** a guest starts a project and gets a Supabase **anonymous** user (`auth/v1/signup` fires, see `lib/supabase/guest.ts → ensureSession`). On the Wiring step, the "Sign in" link is a bare `/en/sign-in` with no return path (`components/studio/StudioShell.tsx:393` and the wiring gate). `components/auth/sign-in-form.tsx:50–75` calls `signInWithPassword` and then always does `router.push(dashboardPathForRole(role))`. Signing in to an **existing** account swaps the anonymous session for a different `auth.uid()`. The guest's project stays owned by the old anonymous user and disappears. (`sign-up-form.tsx` already upgrades the anonymous user with `updateUser`, so only *sign-in* is broken.)

**Fix:**
1. **Return path.** Every sign-in or sign-up link reached from the Studio (or anywhere a guest has work in progress) carries `?next=<current path incl. ?step=>`. `sign-in-form` and `sign-up-form` honour `next` after success. Validate it as a same-origin relative path that starts with `/{locale}/` (no `//`, no scheme) and fall back to the dashboard. Add a unit test for the validator.
2. **Claim guest work.** Before calling `signInWithPassword`, if the current user `isGuest`, keep the anonymous **access token** in memory. After sign-in succeeds, POST it to a new route `app/api/auth/claim-guest/route.ts`. The route:
   - verifies the anonymous token server-side with `auth.getUser(token)`, requires `is_anonymous === true`, and verifies the new session with `auth.getUser()` from cookies;
   - calls a new `SECURITY DEFINER` RPC `claim_guest_work(p_from uuid, p_to uuid)` from migration `supabase/migrations/0071_claim_guest_work.sql`. The RPC reassigns ownership of every guest-owned row to the new user: projects and every child table keyed by owner/user (project_parts, studio docs, carts and cart items, credit ledger rows tied to that project, cad-files and print_request leads, etc.). Grep the migrations for every `owner_id`/`user_id`/`client_id` column that a guest can write, and list them in the migration header. Grant execute to `service_role` only.
   - is idempotent and safe to call twice.
3. If the claim fails, still land the user on `next`, and show a small bilingual notice with a "Try again" button. Never fail silently.
4. Also make sure a **signed-in** user's Studio project always reopens on the step they left (`?step=` already exists, so persist the last step on the doc).
5. **E2E:** guest creates a project, signs in to an existing test account, lands back on the same Studio step, and the project is listed under their account.

## 🔴 W2 — "Request Gestaltung to make it" accepts junk and leads nowhere

**Reproduced:** `lib/phone.ts → isValidPhone("00000000")` returns true (8 digits are normalised to `+97400000000`). After the request, the user doesn't know what happens next or how to reach "Make".

**Fix (owner chose "Form → quote page"):**
1. **Stricter phone rule.** A Qatar mobile is `+974` followed by 8 digits starting with 3, 5, 6 or 7. Reject numbers where every digit is the same and obvious sequences like 12345678. Keep foreign E.164 as is. Update the tests.
2. **One "Get it made" button.** Show it from the Enclosure step onward (a sticky footer on desktop, a bottom bar on mobile). It replaces the scattered "Request printing / Request a quote" entry points but calls the same APIs (`requestPrint`, `requestQuote`, `/api/store-lead`).
3. **Pop-up form** (a proper modal, keyboard and RTL safe): name, WhatsApp phone (validated as above, prefilled from the profile), email (prefilled), and an optional note. Ask only what's missing, so known answers are never re-asked. Guests must sign in or sign up inside the flow first, using W1 so nothing is lost.
4. **Quote page** after submitting: `/[locale]/projects/[id]/request` shows "Request received", a project summary (name, picture of the enclosure, parts list, printed parts) and a rough price range from the existing pricing logic, labelled "estimate". It says "We'll WhatsApp you within one working day" and links to "My projects". The request appears in the admin dashboard's to-do view.
5. Keep the separate Print/Code/Make steps reachable, but the client should never need them to place a request.

## 🔴 W3 — Ideation: no real conversation, and the live spec card is hidden

**Reproduced:** with the idea "automatic small plant watering monitor", `/api/studio/spec` (4.3 s) went straight to a summary card. The chat disappeared (`IdeaStep.tsx` switches `mode` from `"chat"` to `"summary"`). The word "automatic" was lost: no pump or valve was added, and defaults like "Sits on a desk" ignored the context (it lives in a plant pot). In the owner's other test, "Build something new with Arduino" was echoed back as the brief with nothing added.

**Fix:**
1. **Split layout.** Chat on one side and the live spec card (the "Smart plant monitor" card the owner loves; keep its look) on the other. The card fills in and highlights each field as the chat learns it. In EN the chat is on the left and the card on the right; in AR they mirror automatically through logical CSS (`start`/`end`). On mobile the card is a collapsible panel above the chat.
2. **The chat never disappears.** After "Looks right — next" the user can still type to refine, e.g. "make it solar" or "add a pump". The refinement updates the spec and, if the parts are already picked, offers "Update my parts" (don't silently redo later steps).
3. **Smarter spec prompt** (`lib/studio/ai/prompts.ts`):
   - If the idea is vague (no function stated, e.g. "something with Arduino"), ask **one** short question with 3–4 tappable suggestion chips instead of echoing it.
   - Keep every function word the user wrote: "automatic watering" must add an actuator (pump or valve) plus a matching power source.
   - Infer placement and size from the idea (plant → in a pot or staked in soil; wearable → on the body), not generic defaults.
   - Add tests with these three ideas as fixtures.
4. **Speed.** Show a typing indicator immediately and stream the reply if the provider supports it. Otherwise show a skeleton of the card within 300 ms.

## 🟡 W4 — Parts step: photos, highlight, sourcing, sanity

**Reproduced:** the plant monitor got **two** batteries (an 18650 with holder AND a 1000 mAh LiPo), and the parts list showed no images (`<img>` count 0).

**Fix:**
1. **Keep the current icons** (owner loves them). Add the **real product photo** from the linked store product: library `storeSkus` → `parts.images[].thumb` (bucket `product-images`). Show it on hover (desktop) or tap (mobile) in an elegant popover with the photo, name, one-line purpose, price if it's in the store, and stock status ("In stock in Lusail" / "We'll source this, about X days"). Use only images from our own store or Voltaat listings. With no image, the popover shows the icon. Lazy-load the thumbs.
2. **Stronger selected and hover state** on part cards (accent ring + lift). Respect reduced motion.
3. **Single power source rule.** After picking, a deterministic check removes a duplicate battery or power source unless the spec asks for a backup. Add a unit test with the plant monitor fixture.
4. "Swap" for control boards stays as is.

## 🟡 W5 — Wiring diagram: bigger, fit to screen, zoom and pan

**Reproduced:** `WiringStep.tsx → SchematicFrame` renders at `max(720px, viewBox width)` with zoom levels `[1, 1.25, 1.5, 2]`. It never fits the screen on open, and part of the drawing is cut off.

**Fix:**
1. The frame uses the full content width and `min(75dvh, 760px)` height, with an "expand to full screen" button (a dialog at 100dvh).
2. **Opens zoomed to fit** the whole diagram, both width and height, with padding.
3. Zoom in and out (buttons, ctrl+wheel, pinch) **around the cursor or pinch point**, drag to pan, and a "Fit" button that resets. Add a small zoom % label.
4. Keep labels readable: never zoom out past the point where text falls under ~9px. In that case fit the width and let it pan vertically.
5. Keep `dir="ltr"` on the drawing even in Arabic.

## 🟡 W6 — Enclosure: smarter shape from the idea; everything 3D in one step

**Current:** 8 templates exist (`rounded_box, pill, soft_wedge, puck, handheld_taper, lantern, dome_base, wall_plate`), but the owner mostly saw a box or a cylinder. "Take it apart" (exploded view) and the standoffs live in the Print step.

**Fix:**
1. **Template choice from the idea.** Feed the spec (placement, holding style, environment, size) into the template pick, add a short "why this shape" line, and offer 3 "Try another" variants that are *different templates*, not just colour changes. Add a new template **`stake_pod`** (a pod on a spike that pushes into soil, for plant/garden ideas) and give `handheld_taper` grip-friendly fillets. Add tests mapping example ideas to templates.
2. **Move "Take it apart"** (the exploded slider) and the lead-based standoffs view **into the Enclosure step viewer**, as a toggle and slider right under the 3D view. The Print step keeps the printable-parts list, grams and STL downloads.
3. **Speed:** show the cached last build instantly, and build variants in the existing Web Worker in the background, the first one first.
4. Keep the finishes, "Try another" and "Share a picture" exactly as they are (the owner loves them).
5. **Honest limit, don't fake it:** this is template-based. Truly freeform ergonomic shapes come with the future CadQuery backend (`docs/STUDIO_CAD.md`), so don't attempt sculpting here.

## 🟡 W7 — Home page

1. **Hero visual (owner chose "Live 3D enclosure"):** on the right of the hero (below it on mobile), show a slowly rotating Studio enclosure that gently explodes and closes on a loop. Reuse the Studio viewer with a fixed demo doc (`StudioFixture`).
   - Performance budget: render a static poster image first (pre-rendered PNG/WebP of the same model, which is the LCP element). Lazy-load the R3F canvas only after `requestIdleCallback` and when it's in view. Don't add it to first-load JS (check the bundle size before and after).
   - Respect `prefers-reduced-motion`: show the poster only.
   - Clicking it opens `/projects/new`.
2. **"Built for hardware founders" cards** (section 2: "Weeks to a demo-ready prototype", "Parts stocked locally…", "One contact from idea to delivery") currently have no link. Make each whole card a link with a hover state and arrow:
   - Weeks to a prototype → `/projects/new`
   - Parts stocked locally → `/store`
   - One contact → the WhatsApp callback section / `wa.me/97433664265`
3. **Shop search instant results:** the "Search parts, materials, methods…" box (home section 3, and the store page) is a plain form to `/en/store` with no suggestions. Add a debounced (200 ms) combobox (ARIA `combobox` / `listbox`, arrow keys, Esc) that shows the top 6 store products: thumb, name, price, stock, and an **"Add to cart"** button that adds without leaving the page and updates the cart badge. Enter still goes to the full results page. Back it with a lightweight `GET /api/store/search?q=` that returns only public product fields, rate-limited and cached. Match EN and AR names.

## 🟢 W8 — Speed pass

- **Sign-in feels slow:** measure `signInWithPassword` → redirect. Show button loading state immediately, prefetch the `next` route, and avoid the extra role fetch where the role is in the session or JWT.
- Studio AI calls: `/api/studio/pick` took 5.4 s and `/api/studio/spec` 4.3 s. Show progress text ("Picking your parts… 3 of 6") and cache by spec hash so going back and forward never re-runs AI.

---

## Acceptance checklist (must all pass before you say done)

- [ ] Guest → builds project → signs in to existing account → lands on the same step, project kept (e2e).
- [ ] `00000000`, `11111111`, `12345678` are rejected; `+974 5555 1234` is accepted.
- [ ] "Get it made" → pop-up → quote page with summary, estimate and WhatsApp promise; the lead shows in the admin dashboard.
- [ ] "automatic small plant watering monitor" gets a pump or valve, one power source, and a pot or stake placement; the chat stays usable after "next"; the spec card sits beside the chat and mirrors in Arabic.
- [ ] "something with Arduino" gets one clarifying question with chips, not an echo.
- [ ] Parts popover shows a real store photo where linked, and the icon otherwise.
- [ ] Wiring opens fully visible, and zoom, pan and fit all work with mouse and touch.
- [ ] Enclosure for a plant idea is a `stake_pod` or a pot-friendly template; "Take it apart" and standoffs are in the Enclosure step.
- [ ] Home: hero shows a poster then the 3D loop (poster only with reduced motion); the 3 founder cards are clickable; typing "dc motor" shows a dropdown with Add to cart.
- [ ] Lighthouse on `/en` is no worse than before for LCP and TBT; first-load JS for `/en` hasn't grown.
- [ ] Everything checked in both EN and AR (RTL) at 375 px and 1366 px.

Finish by giving me: what changed per block, the migration to run (0071), and exact steps to test each block on localhost.
