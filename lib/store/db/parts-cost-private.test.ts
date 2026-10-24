// Migration 0105 (audit DB-09): parts cost / margin / sourcing columns are no
// longer readable by anon or sessions; admins read them through parts_admin;
// store_settings hides internal keys. Applied TWICE in PGlite on a stub of
// parts (every column the migrations add) with the 0011 grants + policies.
// Never touches Supabase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, pgliteDb } from "@/lib/db-test/pglite";
import { PART_PUBLIC_COLUMNS } from "@/lib/store/part-columns";
import { PRIVATE_PART_FIELDS } from "@/lib/store/part-source";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique, name text not null, name_ar text, description text, description_ar text,
  category text not null default 'x', material text, standard text,
  unit_price numeric(10, 2) not null default 10, min_order_qty integer not null default 1,
  stock_status text not null default 'in_stock', image_url text, is_published boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  tags text[] not null default '{}', attributes jsonb not null default '{}', pack_size integer not null default 1,
  images jsonb not null default '[]',
  pricing_mode text not null default 'markup', pinned_offer_id uuid, preferred_offer_id uuid,
  landed_cost_qar numeric(12, 2), expected_income_qar numeric(12, 2), income_pct numeric(7, 2),
  below_floor boolean not null default false, lead_time_class text,
  name_key text, merged_into uuid, is_test boolean not null default false,
  datasheet_url text, specs jsonb, backup_for uuid, specs_ar jsonb, details_ar_at timestamptz,
  store_category text, store_category_review boolean not null default false, in_own_stock boolean not null default false
);
alter table public.parts enable row level security;
grant select on public.parts to anon, authenticated;
grant insert, update, delete on public.parts to authenticated;
create policy parts_select on public.parts for select to anon, authenticated using (is_published or public.is_super_admin());
create policy parts_admin_write on public.parts for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create table public.store_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.store_settings enable row level security;
grant select on public.store_settings to anon, authenticated;
create policy store_settings_select on public.store_settings for select to anon, authenticated
  using (key <> 'price_experiment' or public.is_super_admin());
insert into public.store_settings (key, value) values
  ('margin_floor_pct', '15'), ('commission_floor_pct', '8'), ('fx_to_qar', '{"USD": 3.64}'),
  ('anonymous_cleanup', '{}'), ('backup_search', '{}'), ('voltaat_sync', '{}'), ('csv_mapping:mouser', '{}'),
  ('price_experiment', '{}'), ('site_v2', '{"enabled": false}'), ('turnstile', '{}'), ('shipping', '{}'),
  ('kit_discount_pct', '0'), ('pricing_plans', '{}'), ('studio_quote_rule', '{}');
`;

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const USER = "00000000-0000-4000-8000-0000000000a1";
const { db, rows, as, fails, applyTwice } = pgliteDb();

const PUBLIC_KEYS = ["kit_discount_pct", "pricing_plans", "shipping", "site_v2", "studio_quote_rule", "turnstile"];
const settingKeys = (who: string | null) =>
  as(who, () => rows<{ key: string }>("select key from public.store_settings order by key")).then((r) => r.map((x) => x.key));

describe("0105_parts_cost_private", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.exec(`
      insert into auth.users (id) values ('${ADMIN}'), ('${USER}');
      insert into public.profiles (id, role) values ('${ADMIN}', 'super_admin'), ('${USER}', 'client');
      insert into public.parts (sku, name, is_published, landed_cost_qar, income_pct, pricing_mode)
        values ('A-1', 'Part A', true, 7.5, 25, 'mirror'), ('B-1', 'Draft', false, 3, 10, 'markup');
    `);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("BEFORE: anon reads landed cost and margin of every published part; internal settings too", async () => {
    const [r] = await as(null, () => rows<{ landed_cost_qar: string }>("select landed_cost_qar from public.parts"));
    expect(Number(r.landed_cost_qar)).toBe(7.5);
    expect(await settingKeys(null)).toContain("margin_floor_pct");
  });

  it("applies twice", async () => {
    await applyTwice("0105_parts_cost_private.sql");
  });

  it("AFTER: anon / sessions are denied every hidden column and select *", async () => {
    for (const who of [null, USER]) {
      for (const col of PRIVATE_PART_FIELDS) {
        expect(await as(who, () => fails(`select ${col} from public.parts`)), col).toMatch(/permission denied/);
      }
      expect(await as(who, () => fails("select * from public.parts"))).toMatch(/permission denied/);
      expect(await as(who, () => fails("select id from public.parts order by income_pct"))).toMatch(/permission denied/);
    }
  });

  it("AFTER: PART_PUBLIC_COLUMNS (what the app selects) still works, rows still filtered by RLS", async () => {
    const r = await as(null, () => rows<{ sku: string }>(`select ${PART_PUBLIC_COLUMNS} from public.parts`));
    expect(r.map((x) => x.sku)).toEqual(["A-1"]);
    // every live column is either public or private — nothing silently hidden
    const all = await rows<{ c: string }>(
      "select attname as c from pg_attribute where attrelid = 'public.parts'::regclass and attnum > 0 and not attisdropped",
    );
    const known = new Set([...PART_PUBLIC_COLUMNS.split(", "), ...PRIVATE_PART_FIELDS]);
    expect(all.map((x) => x.c).filter((c) => !known.has(c))).toEqual([]);
  });

  it("AFTER: the admin reads cost through parts_admin; nobody else gets rows; anon has no access", async () => {
    const a = await as(ADMIN, () => rows<{ sku: string; landed_cost_qar: string; pricing_mode: string }>(
      "select sku, landed_cost_qar, pricing_mode from public.parts_admin order by sku",
    ));
    expect(a.map((x) => [x.sku, Number(x.landed_cost_qar), x.pricing_mode])).toEqual([["A-1", 7.5, "mirror"], ["B-1", 3, "markup"]]);
    expect(await as(USER, () => rows("select * from public.parts_admin"))).toEqual([]);
    expect(await as(null, () => fails("select * from public.parts_admin"))).toMatch(/permission denied/);
    expect((await as("service", () => rows("select landed_cost_qar from public.parts"))).length).toBe(2);
  });

  it("AFTER: admin writes of hidden columns still work (no RETURNING of them)", async () => {
    expect(await as(ADMIN, () => fails("update public.parts set pricing_mode = 'markup', pinned_offer_id = null where sku = 'A-1'"))).toBeNull();
    expect(await as(ADMIN, () => fails("insert into public.parts (sku, name, pricing_mode) values ('C-1', 'New', 'mirror')"))).toBeNull();
  });

  it("AFTER: internal store_settings keys are invisible to anon and sessions, visible to the admin", async () => {
    for (const who of [null, USER]) expect(await settingKeys(who)).toEqual(PUBLIC_KEYS);
    expect((await settingKeys(ADMIN)).length).toBe(14);
  });
});
