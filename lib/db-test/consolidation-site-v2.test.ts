// Migration 0107 (consolidation 2026-11, O1): the retired site_v2 flag row is
// deleted and every other store_settings row survives. Applied twice (it must
// re-run). Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, pgliteDb } from "./pglite";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.store_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.store_settings enable row level security;
insert into public.store_settings (key, value) values
  ('site_v2', '{"enabled": true}'),
  ('occasions', '[]'),
  ('turnstile', '{"enabled": false}'),
  ('pricing_plans', '{}');
`;

const { db, rows, applyTwice } = pgliteDb();

describe("0107 drop site_v2 setting", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await applyTwice("0107_drop_site_v2_setting.sql");
  }, 60_000);

  it("deletes the site_v2 row", async () => {
    expect(await rows("select key from public.store_settings where key = 'site_v2'")).toEqual([]);
  });

  it("keeps every other setting", async () => {
    const keys = (await rows<{ key: string }>("select key from public.store_settings order by key")).map((r) => r.key);
    expect(keys).toEqual(["occasions", "pricing_plans", "turnstile"]);
  });
});
