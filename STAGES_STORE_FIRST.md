# Gestaltung — Store-First Rebuild · Claude Code Stages

Execute these **one at a time** in Claude Code. Build a stage, run its test, confirm it works,
then move to the next. Do not skip ahead — each stage depends on the one before it.

**Hard rules (apply to every stage):**
- No database migrations. Routing / navigation / i18n / landing rebuild only. Supabase schema + RLS stay untouched. If a stage seems to need a new table, **stop and ask first.**
- Keep the `/[locale]` prefix on every route and redirect. Test **/en (LTR)** and **/ar (RTL)**, plus **light and dark** themes.
- Use permanent (308) redirects for every moved public URL. After moving, repo-search for `/parts`, `/cad-assistance`, `/dashboard/jobs`, `/dashboard/inventory`, `/dashboard/parts` and fix hardcoded hrefs.
- **Inventory never appears on the store landing** — no link, no mention. Hard requirement.

**Decision to make before Stage 4/5:** the design header has an "Inventory" nav link. Choose:
(a) keep it, but route signed-out users to `/sign-in`; or (b) remove it from the public header so Inventory is reached only from the account menu.

---

## Stage 1 — Implement the store landing from the design

```
Import the attached Store-first platform design-handoff.zip — read the README
inside. Implement: Gestaltung Store.dc.html.

Read project/StoreLanding.dc.html in full and recreate it as the homepage
app/[locale]/page.tsx in this Next.js 15 + Tailwind + shadcn + next-intl app:
- Match the visual output pixel-close: header, hero title 'Order parts. Or
  design your own.', search + category chips, Featured products grid, the
  'Custom manufacturing' strip with ONE 'Design' button, WhatsApp footer.
- Support BOTH light and dark themes and BOTH en (LTR) and ar (RTL); pull all
  strings from messages/en.json + ar.json (the design already provides them).
- Wire the featured products + prices to Supabase (published parts) via the
  existing RLS reads; keep the design's card layout. Cart badge uses the
  existing cart provider. Do NOT put inventory anywhere on this page.
- The 'Design' button links to /design. 'Store' nav → /, Cart → /store/cart.
Then tell me how to test locally.
```

**Test:** `/en` and `/ar` homepages match the design in light + dark, desktop + mobile. Featured products load from Supabase; Add-to-cart updates the badge; the single Design button goes to `/design`; no inventory anywhere on the page.

---

## Stage 2 — Store routes (/parts → /store)

```
Rename the customer store from /parts to /store with no behaviour change.
1. Move app/[locale]/parts -> app/[locale]/store (all sub-routes: [sku], cart,
   checkout, checkout/success). Update every /parts/* Link/href to /store/*.
2. Add 308 redirects: /:locale/parts -> /:locale/store and
   /:locale/parts/:path* -> /:locale/store/:path* .
3. Rename i18n namespace PartsStore -> Store (keep EN + AR).
Then tell me how to test locally.
```

**Test:** `/store` catalog, product, cart, checkout work on `/en` and `/ar`; old `/parts` URLs redirect.

---

## Stage 3 — Design hub (one destination for the landing button)

```
Create /design as the single custom-manufacturing hub.
1. app/[locale]/design/page.tsx: two paths — 'Upload a file to manufacture'
   (-> /design/upload) and 'Hire us to draw your CAD' (-> /design/drawing).
2. Move app/[locale]/cad-assistance -> app/[locale]/design/drawing.
3. Move the job flow: dashboard/jobs -> app/[locale]/design/jobs and
   dashboard/jobs/new -> app/[locale]/design/upload (keep new-internal, [id],
   [id]/edit and the auth-gate). Update all hrefs.
4. 308 redirects: /cad-assistance -> /design/drawing; /dashboard/jobs/new ->
   /design/upload; /dashboard/jobs(+/:path*) -> /design/jobs(+/:path*).
The landing's Design button already points here. Then tell me how to test.
```

**Test:** Landing Design button → `/design`; both paths work; signed-in upload creates a job at `/design/jobs/[id]`; old URLs redirect; `/ar` RTL correct.

---

## Stage 4 — Inventory as a separate signed-in area

```
Move inventory to its own top-level, signed-in area, unrelated to the landing.
1. Move app/[locale]/dashboard/inventory -> app/[locale]/inventory (keep new/
   and [id]/edit/, the auth-gate and role check, and RLS tenant scoping).
2. Add a project-planning view at app/[locale]/inventory/projects: group items
   into projects with a bill of materials; per-row current stock; flag
   sufficient (green) / short (red); simple kanban Planned→In progress→Done.
   Reuse existing job/BOM patterns; match the azure-on-dark component style.
   NO new DB migration — use existing inventory_items; if a projects table is
   truly needed, STOP and ask me first.
3. Reach /inventory only from the signed-in dashboard/account menu. Do NOT link
   or mention inventory anywhere on the store landing.
4. 308 redirects: /dashboard/inventory(+/:path*) -> /inventory(+/:path*).
Then tell me how to test locally.
```

**Test:** Signed-in workshop/admin reach `/inventory` from the account menu; storage CRUD works with tenant scoping; the planning view flags short stock; the store landing has zero inventory references; old URLs redirect.

---

## Stage 5 — Account/admin + header cleanup + build

```
Finish the reorg.
1. Move dashboard/parts -> dashboard/store (+ orders); keep super-admin guard;
   update nav labels + hrefs; 308 redirects for the old paths.
2. Rebuild the public header to match the design: Store, Inventory (per the
   decision above), EN·ع toggle, session-aware Sign in/Dashboard, Cart.
   Remove old marketing items from the primary nav.
3. Run npm run build; fix any type errors. Then tell me how to test, and I'll
   push to main for Vercel to deploy.
```

**Test:** Header matches the design on `/en` + `/ar`; admin store catalog at `/dashboard/store`; `npm run build` passes; deploy green.

---

## Final acceptance checklist

- [ ] Homepage is the store landing and matches the design (light + dark, EN + AR, desktop + mobile).
- [ ] Featured products load from Supabase; add-to-cart updates the cart badge.
- [ ] Exactly one Design button on the landing; it goes to `/design`.
- [ ] No inventory content, link, or mention anywhere on the landing page.
- [ ] `/store`, `/store/[sku]`, cart and checkout work; old `/parts` URLs redirect.
- [ ] `/design` hub offers upload + drawing; signed-in upload creates a trackable job.
- [ ] `/inventory` is signed-in only, reached from the account menu, with storage + a project-planning view.
- [ ] Inventory tenant isolation (RLS) verified per role.
- [ ] All legacy URLs 308-redirect; no hardcoded old hrefs remain.
- [ ] `npm run build` passes; Vercel deploy green on `/en` and `/ar`.
