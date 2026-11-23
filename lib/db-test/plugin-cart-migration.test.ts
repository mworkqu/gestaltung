// Migration 0115 (plugin_add_to_cart): applied twice in PGlite. Covers who may
// call it, the quantity rules, that a repeated product is topped up rather than
// duplicated, that an unsellable SKU is reported instead of dropped, and that a
// refusal writes nothing. Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, pgliteDb } from "./pglite";

const USER = "dddddddd-0000-0000-0000-000000000001";
const GUEST = "dddddddd-0000-0000-0000-000000000002";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.projects (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id));
create table public.project_kits (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects (id));
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  unit_price numeric,
  min_order_qty integer not null default 1,
  pack_size integer,
  is_published boolean not null default true,
  merged_into uuid,
  lead_time_class text
);
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  product_id uuid not null references public.parts (id),
  project_id uuid references public.projects (id),
  kit_id uuid references public.project_kits (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  bom_lines text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The real index from 0025: the ON CONFLICT target must match it exactly.
create unique index cart_items_line_unique
  on public.cart_items (user_id, product_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        coalesce(kit_id, '00000000-0000-0000-0000-000000000000'::uuid));

insert into auth.users (id, is_anonymous) values ('${USER}', false), ('${GUEST}', true);
insert into public.profiles (id, role) values ('${USER}', 'client');

insert into public.parts (sku, name, unit_price, min_order_qty, is_published, lead_time_class) values
  ('VLT-A', 'Soil moisture sensor', 18.5, 1, true, 'stock'),
  ('VLT-B', 'Resistor pack', 4, 5, true, 'stock'),
  ('VLT-HIDDEN', 'Unpublished thing', 9, 1, false, 'stock'),
  ('VLT-NOLEAD', 'No delivery class', 9, 1, true, null);
`;

const CALL = "select public.plugin_add_to_cart($1::jsonb) as r";

type Result = {
  ok: boolean;
  reason?: string;
  added?: number;
  lines?: { sku: string; name: string; qty: number; unit_price_qar: number | null }[];
  skipped?: string[];
};

describe("0115 plugin_add_to_cart", () => {
  const { db, rows, as, fails, applyTwice } = pgliteDb();

  const run = (who: string, lines: unknown) =>
    as(who, async () => (await rows<{ r: Result }>(CALL, [JSON.stringify(lines)]))[0]!.r);

  const cart = () => rows<{ sku: string; quantity: number }>(
    "select p.sku, c.quantity from public.cart_items c join public.parts p on p.id = c.product_id order by p.sku",
  );

  beforeAll(async () => {
    await db.exec(STUB);
    await applyTwice("0115_plugin_cart.sql");
  });

  it("is closed to anon", async () => {
    const err = await as(null, () => fails(CALL, ["[]"]));
    expect(err).toMatch(/permission denied/i);
  });

  it("refuses a request with no user, writing nothing", async () => {
    // role authenticated but no sub claim: a token the gate let through with no
    // subject must not reach the cart.
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'authenticated', false)");
    await db.exec("set role authenticated");
    const r = (await rows<{ r: Result }>(CALL, [JSON.stringify([{ sku: "VLT-A", qty: 1 }])]))[0]!.r;
    await db.exec("reset role");
    expect(r).toMatchObject({ ok: false, reason: "sign_in" });
    expect(await cart()).toHaveLength(0);
  });

  it("refuses a guest session", async () => {
    expect(await run(GUEST, [{ sku: "VLT-A", qty: 1 }])).toMatchObject({ ok: false, reason: "guest" });
    expect(await cart()).toHaveLength(0);
  });

  it("refuses lines that are not a non-empty array", async () => {
    for (const bad of [[], {}, null]) {
      expect(await run(USER, bad)).toMatchObject({ ok: false, reason: "bad_lines" });
    }
    expect(await cart()).toHaveLength(0);
  });

  it("adds published parts, lifts a quantity to min_order_qty and reports what it could not add", async () => {
    const r = await run(USER, [
      { sku: "VLT-A", qty: 2 },
      { sku: "VLT-B", qty: 2 }, // min_order_qty 5
      { sku: "VLT-HIDDEN", qty: 1 },
      { sku: "VLT-NOLEAD", qty: 1 },
      { sku: "VLT-GONE", qty: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(2);
    expect(r.skipped).toEqual(["VLT-GONE", "VLT-HIDDEN", "VLT-NOLEAD"]);
    expect(r.lines?.map((l) => [l.sku, l.qty])).toEqual([
      ["VLT-A", 2],
      ["VLT-B", 5],
    ]);
    expect(await cart()).toEqual([
      { sku: "VLT-A", quantity: 2 },
      { sku: "VLT-B", quantity: 5 },
    ]);
  });

  it("tops up an existing line instead of duplicating it", async () => {
    const r = await run(USER, [{ sku: "VLT-A", qty: 3 }]);
    expect(r).toMatchObject({ ok: true, added: 1 });
    expect(await cart()).toEqual([
      { sku: "VLT-A", quantity: 5 },
      { sku: "VLT-B", quantity: 5 },
    ]);
  });

  it("sums a SKU repeated in one call (ON CONFLICT cannot hit a row twice)", async () => {
    const r = await run(USER, [
      { sku: "VLT-A", qty: 1 },
      { sku: "VLT-A", qty: 2 },
    ]);
    expect(r).toMatchObject({ ok: true, added: 1 });
    const after = await cart();
    expect(after.find((c) => c.sku === "VLT-A")?.quantity).toBe(8);
  });

  it("caps one call at 20 products and one line at 999", async () => {
    await db.exec("delete from public.cart_items");
    const many = Array.from({ length: 25 }, (_, i) => ({ sku: `BULK-${String(i).padStart(2, "0")}`, qty: 1 }));
    await db.exec(
      `insert into public.parts (sku, name, unit_price, is_published, lead_time_class)
       select sku, 'Bulk ' || sku, 1, true, 'stock' from (values ${many.map((m) => `('${m.sku}')`).join(",")}) as v(sku)`,
    );
    const r = await run(USER, [...many, { sku: "VLT-A", qty: 5000 }]);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(20);
    expect(await cart()).toHaveLength(20);

    await db.exec("delete from public.cart_items");
    expect((await run(USER, [{ sku: "VLT-A", qty: 5000 }])).lines?.[0]?.qty).toBe(999);
  });

  it("keeps the line loose: no project and no kit", async () => {
    await db.exec("delete from public.cart_items");
    await run(USER, [{ sku: "VLT-A", qty: 1 }]);
    const row = (await rows<{ project_id: string | null; kit_id: string | null; bom_lines: string[] }>(
      "select project_id, kit_id, bom_lines from public.cart_items",
    ))[0]!;
    expect(row).toMatchObject({ project_id: null, kit_id: null });
  });
});
