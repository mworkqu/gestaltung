// Migration 0105 hardening (audit DB-09 follow-up): the post-condition asserts
// refuse to report success while a hidden parts column is still readable by
// anon / authenticated (here: through a grant to PUBLIC, which a revoke from
// anon / authenticated leaves in place), and parts_admin is a security
// barrier view. The main 0105 cases live in lib/store/db/parts-cost-private.test.ts.
// Never touches Supabase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, migration, pgliteDb } from "./pglite";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  sku text not null, name text not null, unit_price numeric not null default 10, is_published boolean not null default true,
  pricing_mode text not null default 'markup', pinned_offer_id uuid, preferred_offer_id uuid,
  landed_cost_qar numeric, expected_income_qar numeric, income_pct numeric, below_floor boolean not null default false
);
alter table public.parts enable row level security;
grant select on public.parts to anon, authenticated;
create policy parts_select on public.parts for select to anon, authenticated using (is_published);
create table public.store_settings (key text primary key, value jsonb not null);
alter table public.store_settings enable row level security;
`;

const { db, rows, as, fails } = pgliteDb();

/** Run the whole migration file (one implicit transaction); its error message or null. */
async function apply0105(): Promise<string | null> {
  try {
    await db.exec(migration("0105_parts_cost_private.sql"));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

describe("0105 post-condition asserts", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.exec("insert into public.parts (sku, name, landed_cost_qar) values ('A-1', 'A', 7.5)");
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("a SELECT grant to PUBLIC keeps cost readable → 0105 raises instead of reporting success", async () => {
    await db.exec("grant select on public.parts to public");
    expect(await apply0105()).toMatch(/0105: anon can still SELECT public\.parts\.landed_cost_qar/);
    // The failed run changed nothing (one transaction): anon still reads cost.
    expect(await as(null, () => fails("select landed_cost_qar from public.parts"))).toBeNull();
  });

  it("without the PUBLIC grant it applies (twice) and hides the columns", async () => {
    await db.exec("revoke select on public.parts from public");
    for (let i = 0; i < 2; i++) expect(await apply0105()).toBeNull();
    expect(await as(null, () => fails("select landed_cost_qar from public.parts"))).toMatch(/permission denied/);
    expect(await as(null, () => rows("select sku from public.parts"))).toEqual([{ sku: "A-1" }]);
  });

  it("parts_admin is a security_barrier view, not security_invoker", async () => {
    const [v] = await rows<{ opts: string[] }>("select reloptions as opts from pg_class where oid = 'public.parts_admin'::regclass");
    expect(v.opts).toEqual(expect.arrayContaining(["security_barrier=true", "security_invoker=false"]));
  });
});
