# Live re-test pack (SITE_AUDIT items #1 to #10)

Owner re-tests of fixes that are **already shipped**. Nothing here is new work: each block says what to open, what to click and what you should see. If the result differs, mark it **fail**, write what you saw in the note, and send it back.

- Site: https://gestaltung360.com (use `/en`; Arabic is checked only where noted).
- The ten items below do not need the password-reset setup. Do the last section ("Before re-testing: Supabase redirect URLs") only if you want to test password reset.
- Items 1, 2, 4 and 5 are tested on the **Plant monitor** project. Projects belong to the account that created them (item 8), so sign in with the account that owns it, or make a fresh project (header **Plan a product**) and describe the same thing: a small plant monitor with a 5 V water pump, four LEDs, a DHT11 sensor and a button, in a 3D-printed case, powered from a USB adapter, on a desk.
- Old test project id (admin account): `fdd2a6c7-397f-4ca7-adc5-f4dcbb45dd5f`. Its pages: https://gestaltung360.com/en/projects/fdd2a6c7-397f-4ca7-adc5-f4dcbb45dd5f (project page) and https://gestaltung360.com/en/projects/fdd2a6c7-397f-4ca7-adc5-f4dcbb45dd5f/prototyping (workspace).
- Header labels you will click: **Shop parts**, **Get a part made**, **Plan a product**, and **My projects** once a project exists. Inside the workspace the left tree reads: Brief, Mechanical (Parts, Drawings, Material & process), Electronics (Board, Power, Components), Software (Code), Quote, Production, Parts, Bill of materials. The right panel is **Next actions**.

---

## Results (fill in)

| # | Item | Pass / Fail | Note |
|---|------|-------------|------|
| 1 | Electrically unsafe design called "validated" | | |
| 2 | Wrong part auto-matched and priced | | |
| 3 | "In your cart" but the cart is empty | | |
| 4 | Two parts lists that disagree | | |
| 5 | Brief contradicted by the design | | |
| 6 | "In stock" vs "Available on request" | | |
| 7 | Duplicates and test data in the catalog | | |
| 8 | Admin sees everyone's projects | | |
| 9 | False "No projects yet" on a foreign link | | |
| 10 | Brief goes to the Gemini free tier | | |

---

## 1. Prototyping gives an electrically unsafe design and calls it "validated"

**Open:** the Plant monitor workspace (URL above).

**Regenerate first.** Projects saved before the fix show as blocking until redone. Left tree: **Electronics > Board**, then press **Regenerate** next to the circuit. Wait for the circuit to redraw.

**Clicks:**
1. Stay on Electronics > Board and read the circuit. Then open **Electronics > Power**, **Electronics > Components** and **Bill of materials**.
2. Look at the right panel **Next actions** and the **Readiness** badge.

**Expected:**
- The 5 V pump is switched through an **NPN transistor** with a base resistor and a **flyback diode** across the pump, not straight from a pin.
- Every LED has a series resistor, and the resistors appear in **both** the circuit and the Bill of materials (same counts).
- No message "Two supplies drive net 5V".
- The line under the circuit says it was drawn from a netlist that **passed our checks**. If any check fails, that line must not say it passed, a blocking item appears in Next actions, and Readiness goes down.
- Power shows a **Power budget** (source, loads, total, **Headroom**).
- Readiness includes the requirement **Circuit passes our checks**.

**Fail if:** the pump is on a pin directly, an LED has no resistor, circuit and BOM disagree, or a failing check is not in Next actions.

---

## 2. Wrong part auto-matched and priced

**Open:** the Plant monitor workspace, after the Regenerate in item 1.

**Clicks:** **Bill of materials**. Find the line **Flyback diode**. Find any line sold in packs.

**Expected:**
- The flyback diode is a 1N400x-class part, **not** Diode 1N4148. If the store has no confident match, the line says **No confident match** with a confirm button and nothing is pre-selected.
- No matcher text such as "Weak match: product has no attributes" is shown (only admins see it).
- Pack lines read like: **need 1 . sold in packs of 100 . QAR x per pack**.
- The cost panel shows one QAR figure labelled **To buy now**, with a separate counts line ("N lines not stocked . N to fabricate . N ordered"). A pack of 100 is not silently counted as the project cost.

**Fail if:** a weak match is pre-selected, debug text shows, or one pack line still equals the whole project cost.

---

## 3. Project page says parts are "in your cart" but the cart is empty

**Open:** https://gestaltung360.com/en/projects (header **My projects**), open a project that has parts, then https://gestaltung360.com/en/store/cart.

**Clicks:**
1. Project page, section Parts: read the status on each part line.
2. Header cart icon: compare its badge with the Cart page.
3. Workspace > **Bill of materials**: read the status words.

**Expected:**
- Each line says **In cart**, **Ordered #xxxxxxxx . status**, **Delivered**, or "to buy". It never says "in your cart" when the cart is empty.
- The Cart page and the header badge agree.
- The BOM says **Ordered #...**, not "Bought".
- A real "Ordered" line needs a project with an existing order (the old test order). It is still on your delete list, so do this check **before** deleting it. Do not place a new order just for this test.
- Optional: with the network off, the cart keeps its last good lines and shows an error with **Retry**.

**Fail if:** "in your cart" shows with an empty cart, or a quantity is doubled (ESP32 x 2).

---

## 4. Two "parts" lists in one project that disagree

**Open:** the Plant monitor project page and workspace.

**Clicks:**
1. Project page: count the store parts.
2. Workspace, left tree **Parts**: set the filter to **Catalog**.
3. Workspace > **Bill of materials**.

**Expected:** the Parts view lists the same store parts as the project page and the BOM, in one merged list. The **Catalog** filter shows them (not "No parts match this filter"). Quantities match across the three views, and Electronics > Components has the same line count as the BOM.

**Fail if:** Catalog is empty, or any count differs between views.

---

## 5. The brief is contradicted by the generated design

**Open:** the Plant monitor workspace (or a fresh project with the brief from the header note).

**Clicks:**
1. **Brief**: press **Re-analyse brief** (tick the consent box if shown).
2. Read **What we understood**.
3. **Mechanical > Material & process**, then **Mechanical > Parts**.

**Expected:**
- "3D-printed case" gives a printed material (PLA or PETG) with the 3D printing process, not stainless laser cut.
- Power source reads USB 5 V and mounting reads desk, or the item is marked **Inferred**. Anything the brief did not say is labelled **Inferred**, never "From your brief".
- An enclosure smaller than its board is flagged "too small for the board inside" and cannot be kept. **Ready to make** does not appear while dimensions are implausible.
- Reservoir text is not the cat-feeder library text.

**Fail if:** stainless laser cut for a printed case, a 30 x 30 mm shell marked Ready to make, or invented facts labelled "From your brief".

---

## 6. Store shows everything "Available on request" while claiming "In stock"

**Open:** https://gestaltung360.com/en and https://gestaltung360.com/en/store.

**Clicks:**
1. Home, Featured products: read the section subtitle and a card.
2. Header **Shop parts**, open one product, read the delivery line.
3. On /en/store use the **Delivery time** filter.

**Expected:** the copy matches reality. Cards with a supplier offer show **Arrives by <date>**. Products without one are not described as "In stock and ready to ship". The product page shows a delivery date (or "to be confirmed" for on-request items) and the delivery cost. No SKUs are visible to customers, and admin stock status is never shown.

**Owner pre-condition:** this reads correctly only once supplier offers are attached in the dashboard under Store > Suppliers. If a card still says "Available on request", that is missing data, not a code fault: note which product.

**Fail if:** "In stock" appears next to "Available on request" on the same item.

---

## 7. Catalog is 74 % duplicates and test data is live

**Open:** https://gestaltung360.com/en/store and, signed in as admin, https://gestaltung360.com/en/dashboard.

**Clicks:**
1. /en/store: search `diode`, `battery`, `resistor`, `capacitor`, `motor`. Each product name appears once.
2. Search `aluminum` and `123`: no workshop test product.
3. Open the **Material** filter: no separate "Aluminum" and "aluminum".
4. Admin: Dashboard > Store (count rows); Dashboard > Projects, Leads and Store orders (look for "TEST").

**Expected:** no duplicate names, no "aluminum" / SKU 123 product, one casing for materials. Test projects, leads and the test order are gone only after you approved and ran the cleanup. If they are still listed, that is the pending owner action (delete test order #945ea389 and the TEST guest project), not a failure of the code fix.

**Fail if:** duplicates reappear after the migrations were run.

---

## 8. Admin browsing the customer pages sees and can edit everyone's projects

**Open:** https://gestaltung360.com/en/projects while signed in as **admin**.

**Clicks:**
1. Read the **My projects** list.
2. Open https://gestaltung360.com/en/dashboard, then **Projects** (the admin-wide list).

**Expected:** /en/projects lists **only your own** projects, not guests' or other customers'. The all-projects view exists only under Dashboard > Projects. Opening someone else's project from the customer side shows "This project isn't available here" (item 9). **Delete project** sits in a **Danger zone** at the bottom of a project page, not next to the title.

**Fail if:** another person's project appears in /en/projects.

---

## 9. Shared or cross-device project links show a false message

**Open:** a project URL that belongs to another account or browser. Easiest: while signed in as account A copy `https://gestaltung360.com/en/projects/<id>`, then open it in a private window (guest) or signed in as account B.

**Clicks:** paste the URL and load it. Also try `/en/projects/<id>/prototyping`.

**Expected:** the page says **This project isn't available here**, with "It may have been deleted, or it belongs to another account. If it's yours, sign in with the account that created it." (the workspace version says "It may belong to another account or browser, sign in to see it."), plus a **My projects** button. It must **not** say "No projects yet".

**Fail if:** you see "No projects yet" or a blank page.

---

## 10. Privacy: customer briefs go to the Gemini free tier

**Open:** a project workspace on a project that has never been analysed. Easiest: header **Plan a product** (https://gestaltung360.com/en/projects/new), signed in or as a guest.

**Clicks:** type a short brief and look for the consent checkbox beside the start / **Analyse brief** button. Try to press the button without ticking, then tick it and analyse.

**Expected:**
- Before the first analysis a checkbox reads: "Send my brief to Google Gemini for analysis. It runs on a free tier, so Google may use the text to improve its services. Don't include anything confidential." The button stays disabled until it is ticked. Afterwards the workspace shows "Analysis consent given on <date>".
- If the daily allowance is used up, a notice says the reading came from the **basic reader, not the full analysis**, with the reason.
- On **Plan a product** the Start button is disabled until the box is ticked and text typed.

**Fail if:** a brief is analysed without a ticked box, or the fallback happens silently.

---

## Before re-testing: Supabase redirect URLs

Password reset (Phase B) depends on a Supabase setting that **cannot be changed from the code or by the build tooling** (changing it needs the Supabase dashboard; no management API key is available here). Without it, the emailed link lands on the Site URL instead of the app, or Supabase refuses the redirect, so "Forgot password?" looks broken.

### What the app sends

`components/auth/forgot-password-form.tsx` calls `resetPasswordForEmail(email, { redirectTo })` with:

```
{window.location.origin}/api/auth/callback?next=%2F{locale}%2Freset-password
```

So the exact URLs are:

- `https://gestaltung360.com/api/auth/callback?next=%2Fen%2Freset-password` (and `%2Far%2Freset-password`)
- the same two on `https://www.gestaltung360.com`, if www serves the site
- `http://localhost:3000/api/auth/callback?next=%2Fen%2Freset-password` (and `%2Far%2F...`) when running locally

`origin` is whatever host the visitor used, so every host the site is served from needs an entry. `app/api/auth/callback/route.ts` exchanges the `code` (or `token_hash` + `type`) for a session cookie and redirects to `next` (`/en/reset-password` or `/ar/reset-password`). An expired or used link goes to `/{locale}/forgot-password?expired=1`.

### Dashboard steps

1. Open https://supabase.com/dashboard and select the Gestaltung project.
2. Left menu: **Authentication**, then **URL Configuration**.
3. **Site URL**: set `https://gestaltung360.com`.
4. **Redirect URLs**: press **Add URL** and add each of these as its own entry, then **Save**:
   - `https://gestaltung360.com/api/auth/callback`
   - `https://www.gestaltung360.com/api/auth/callback`
   - `http://localhost:3000/api/auth/callback`
   - Because the app appends `?next=...`, also add the wildcard forms so the query string cannot cause a mismatch:
     - `https://gestaltung360.com/api/auth/callback**`
     - `https://www.gestaltung360.com/api/auth/callback**`
     - `http://localhost:3000/api/auth/callback**`
   - Fallback if a link still lands on the Site URL: `https://gestaltung360.com/**`, `https://www.gestaltung360.com/**`, `http://localhost:3000/**`. These allow any path on your own hosts only, which is acceptable.
   - Only if you test resets on Vercel previews: your preview host pattern, e.g. `https://*-<vercel-team>.vercel.app/**`.
5. **Authentication > Emails > Templates > Reset Password** should still use the default `{{ .ConfirmationURL }}`. No template change is needed.
6. Supabase's built-in email sender is rate limited (a few emails per hour). If "Send reset link" seems to do nothing twice in a row, wait an hour, or add custom SMTP later.

### Re-test (about 3 minutes, sends one real email)

1. Open https://gestaltung360.com/en/forgot-password. You should see the heading **Reset your password**, the line "Enter your email and we will send you a link to choose a new password.", an Email field and a **Send reset link** button.
2. Enter the email of an account you own and press the button. The form is replaced by "If an account exists for this email, we sent a reset link." (shown for any email, on purpose).
3. Open the email and click the link. The address bar passes through `/api/auth/callback?...` and lands on `https://gestaltung360.com/en/reset-password` with the heading **Choose a new password** and fields **New password** and **Confirm password**.
4. Enter two different passwords: "Passwords do not match." Enter the same one (6+ characters) and save: "Password updated. Sign in with your new password." You are signed out; sign in normally.
5. Click the same email link again: you land on `/en/forgot-password?expired=1` showing "This reset link is invalid or has expired. Request a new one."
6. Repeat steps 1 to 3 on `/ar/forgot-password` to confirm the Arabic page and that the link lands on `/ar/reset-password`.

**If step 3 lands on the home page or shows an error from supabase.co:** the Redirect URLs entry is missing or does not match. Add the `**` forms above.
