# Stage — Parts Store (E-Commerce Module)

Read CLAUDE.md for full project context. All prior stages (1–8b, migrations 0001–0010) are complete and live. This stage replaces the `/parts` "coming soon" teaser with a real storefront.

Stack: Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, next-intl, Supabase. Azure/panel theme. QAR currency. Bilingual EN/AR throughout. No payment processor — orders are confirmed via WhatsApp (owner's primary channel).

---

## Part 1: Database Migration — `0011_parts_store.sql`

Create `supabase/migrations/0011_parts_store.sql`:

```sql
-- ─── Parts Catalog ────────────────────────────────────────────────
CREATE TABLE parts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  name_ar         TEXT,                          -- Arabic name (optional, falls back to name)
  description     TEXT,
  description_ar  TEXT,
  category        TEXT NOT NULL,                 -- e.g. 'fasteners', 'screws', 'nuts', 'washers'
  material        TEXT,                          -- e.g. 'stainless_steel', 'carbon_steel', 'brass'
  standard        TEXT,                          -- e.g. 'ISO', 'DIN', 'ANSI'
  unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  min_order_qty   INT NOT NULL DEFAULT 1,
  stock_status    TEXT NOT NULL DEFAULT 'in_stock'
                    CONSTRAINT parts_stock_status_check
                    CHECK (stock_status IN ('in_stock','low_stock','out_of_stock')),
  image_url       TEXT,                          -- Supabase Storage public URL or external
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_parts_updated_at
  BEFORE UPDATE ON parts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();  -- reuse existing trigger function

-- RLS: public can SELECT published parts; super_admin can do everything
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY parts_public_select ON parts
  FOR SELECT USING (is_published = TRUE);

CREATE POLICY parts_admin_all ON parts
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ─── Part Orders ──────────────────────────────────────────────────
-- Guest checkout: profile_id is nullable (anon orders allowed)
CREATE TABLE part_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,
  delivery_area   TEXT NOT NULL,                 -- e.g. 'Doha', 'Lusail', 'Industrial Area'
  delivery_notes  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CONSTRAINT part_orders_status_check
                    CHECK (status IN ('pending','confirmed','processing','shipped','delivered','cancelled')),
  total_qar       NUMERIC(10,2) NOT NULL DEFAULT 0,
  whatsapp_sent   BOOLEAN NOT NULL DEFAULT FALSE, -- toggled by admin after confirming via WA
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_part_orders_updated_at
  BEFORE UPDATE ON part_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE part_orders ENABLE ROW LEVEL SECURITY;

-- Anon/authenticated users can INSERT (guest checkout)
CREATE POLICY part_orders_insert ON part_orders
  FOR INSERT WITH CHECK (TRUE);

-- Signed-in user can see their own orders
CREATE POLICY part_orders_own_select ON part_orders
  FOR SELECT USING (profile_id = auth.uid());

-- Super admin sees and manages all
CREATE POLICY part_orders_admin_all ON part_orders
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ─── Order Line Items ─────────────────────────────────────────────
CREATE TABLE part_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES part_orders(id) ON DELETE CASCADE,
  part_id         UUID NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  part_sku        TEXT NOT NULL,   -- snapshot at order time
  part_name       TEXT NOT NULL,   -- snapshot
  quantity        INT NOT NULL CHECK (quantity > 0),
  unit_price_qar  NUMERIC(10,2) NOT NULL CHECK (unit_price_qar >= 0),
  line_total_qar  NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price_qar) STORED
);

ALTER TABLE part_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY part_order_items_insert ON part_order_items
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY part_order_items_select ON part_order_items
  FOR SELECT USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM part_orders po
      WHERE po.id = order_id
        AND (po.profile_id = auth.uid() OR is_super_admin())
    )
  );

CREATE POLICY part_order_items_admin_all ON part_order_items
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
```

**RUN this migration in Supabase SQL editor after 0010.**

---

## Part 2: Public Catalog — `/parts`

Replace the teaser at `app/[locale]/parts/page.tsx` with a real catalog page (server component).

**Layout:**
- Heading: "Mechanical Parts Store" / "متجر القطع الميكانيكية"
- Filter bar (client component `components/parts/parts-filters.tsx`): category chips + material select + stock status toggle. Filters update `?category=&material=&stock=` query params (no client-side JS pagination needed yet).
- Product grid (2 cols mobile, 3 cols tablet, 4 cols desktop): `components/parts/part-card.tsx`

**Part card shows:**
- Image (placeholder SVG gear icon if `image_url` is null)
- Name (show `name_ar` when locale is `ar`, fall back to `name`)
- SKU badge
- `stock_status` badge (green/amber/red)
- Price: `X.XX ر.ق` (ar) / `QAR X.XX` (en)
- Min order note if > 1
- "Add to Cart" button (calls a client-side cart context action)

Server fetch: `supabase.from('parts').select('*').eq('is_published', true)` — no auth needed (public RLS policy covers this). Apply query-param filters server-side.

**Empty state:** "No parts found — check back soon or contact us on WhatsApp." with WhatsApp link.

All copy in `messages/{en,ar}.json` under `Parts` namespace.

---

## Part 3: Product Detail Page — `/parts/[sku]`

`app/[locale]/parts/[sku]/page.tsx` (server component, fetch by SKU).

- Left: image (full size or placeholder)
- Right: name, SKU, category, material, standard, stock badge, price per unit, min order qty
- Description (locale-aware: `description_ar` in AR)
- Quantity input (min = `min_order_qty`, step 1)
- "Add to Cart" button
- If `stock_status === 'out_of_stock'`: disable button, show "Out of stock — notify me" WhatsApp link with pre-filled message `I'd like to be notified when [sku] is back in stock.`
- Breadcrumb: Parts Store → [Category] → [Name]

`generateStaticParams` is NOT needed — use dynamic rendering (`export const dynamic = 'force-dynamic'`). Return `notFound()` if SKU not found or part not published.

---

## Part 4: Cart

Cart state lives in `localStorage` (guest-safe, no auth required). No DB table for cart.

Create `lib/parts/cart.ts` — cart item type, read/write helpers (get, add, update qty, remove, clear). Key: `gestaltung:cart`.

Create `components/parts/cart-provider.tsx` (React context, `'use client'`):
- Exposes `items`, `addItem(part, qty)`, `updateQty(sku, qty)`, `removeItem(sku)`, `clearCart()`, `itemCount`, `totalQar`
- Initialises from `localStorage` on mount; syncs back on every change

Wrap `app/[locale]/layout.tsx` in `<CartProvider>`.

Create `components/parts/cart-icon.tsx` — a header icon button (ShoppingCart from lucide-react) with an item-count badge. Add it to `components/header.tsx` (right side, alongside the auth link). Only renders when on a `/parts/*` route OR always visible (your call — always visible is simpler).

Create `app/[locale]/parts/cart/page.tsx` (client page):
- List of cart items (image, name, SKU, qty stepper, line total, remove button)
- Order summary card: subtotal, note "Final price confirmed by our team via WhatsApp before payment"
- "Proceed to Checkout" button → `/parts/checkout`
- Empty cart state with link back to `/parts`

---

## Part 5: Checkout

`app/[locale]/parts/checkout/page.tsx` (client page — reads cart from context).

**Form fields:**
| Field | Required | Notes |
|-------|----------|-------|
| Full name | ✓ | |
| Phone (WhatsApp preferred) | ✓ | |
| Email | — | |
| Delivery area | ✓ | Select: Doha / Lusail / Al Wakra / Industrial Area / Other |
| Delivery notes | — | Address details, building, etc. |

On submit:
1. Insert into `part_orders` (with `profile_id` if signed in, else null)
2. Insert all `part_order_items` (snapshot SKU, name, price from cart)
3. On success: clear cart, redirect to `/parts/checkout/success?order=<id>`
4. On error: show inline error, do not clear cart

Use the **browser Supabase client** (`lib/supabase/client.ts`) — these are anon-safe inserts (RLS allows it). No server action needed here.

**Success page** `app/[locale]/parts/checkout/success/page.tsx`:
- "Order received!" / "تم استلام طلبك!"
- Order summary (items, total)
- Big WhatsApp button: pre-filled message `New order #[id] - [customer name] - [item count] items - [total] QAR` linking to `NEXT_PUBLIC_WHATSAPP_NUMBER`
- Note: "Our team will confirm your order and delivery time within a few hours."
- Link back to parts store

All copy in `messages/{en,ar}.json` under `Checkout` namespace.

---

## Part 6: Super Admin — Parts Management Dashboard

Add to `app/[locale]/dashboard/parts/` (accessible only to super_admin — guard in the layout or page).

### `/dashboard/parts` — Catalog Manager

- Table: SKU, Name, Category, Price, Stock Status, Published toggle, Edit link
- "Add Part" button → `/dashboard/parts/new`
- Filters: category, stock status, published/draft

### `/dashboard/parts/new` and `/dashboard/parts/[id]/edit`

Form fields matching the `parts` table columns:
- SKU (text, unique — show error if duplicate)
- Name (en) + Name AR
- Category (text — free entry for now, no enum in DB)
- Material, Standard (text)
- Description (en) + Description AR (textarea)
- Unit Price QAR
- Min Order Qty
- Stock Status (select)
- Image URL (text field — paste a public URL; image upload deferred)
- Published toggle

Use server actions `createPart` / `updatePart` / `deletePart` in `app/[locale]/dashboard/parts/actions.ts` (server Supabase client, RLS enforces super_admin only).

### `/dashboard/parts/orders` — Order Management

Table columns: Order ID (truncated), Date, Customer Name, Phone, Delivery Area, Items, Total QAR, Status, WhatsApp Sent

- Status dropdown per row (inline update via server action `updateOrderStatus`)
- "WhatsApp Sent" checkbox toggle
- Click row → order detail `/dashboard/parts/orders/[id]` showing line items

Server actions: `updateOrderStatus`, `toggleWhatsappSent` in `orders/actions.ts`.

Add "Parts Catalog" and "Parts Orders" links to `components/dashboard/dashboard-nav.tsx` — visible to super_admin only.

---

## Part 7: Update Header Nav

In `components/header.tsx`, the existing "Parts Store" nav link (added in Stage 8b) already points to `/parts`. No change needed to the URL — but update the label if it still says "Coming Soon": it should now read "Parts Store" / "متجر القطع" with no qualifier.

---

## i18n

Add the following namespaces to `messages/{en,ar}.json`:
- `Parts` — catalog headings, filter labels, card labels, empty state
- `Checkout` — form labels, success page copy, WhatsApp CTA text
- `PartsDashboard` — admin catalog and orders UI strings

No hardcoded English strings anywhere.

---

## Testing Checklist

- [ ] Migration 0011 runs without error; `parts`, `part_orders`, `part_order_items` tables exist
- [ ] `/en/parts` and `/ar/parts` render the catalog grid (empty state if no published parts)
- [ ] Super admin can create a part via `/dashboard/parts/new`; toggling `is_published` makes it appear/disappear on the public catalog
- [ ] Part card "Add to Cart" increments the cart icon badge
- [ ] `/parts/cart` shows items; qty stepper updates totals; remove works
- [ ] Guest (not signed in) can complete checkout; row appears in `part_orders` with `profile_id = null`
- [ ] Signed-in client checkout sets `profile_id` correctly
- [ ] Success page WhatsApp link fires with pre-filled message
- [ ] `/dashboard/parts/orders` shows the test order; status update persists
- [ ] AR locale is RTL-correct on all new pages
- [ ] `npm run build` passes with zero TypeScript errors
- [ ] Push to `main` → Vercel deploy succeeds; spot-check `/parts` on live URL
