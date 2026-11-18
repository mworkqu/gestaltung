// Migration 0111 (consolidation 2026-11, Phase 3A): seeds store_settings.worker
// = {"enabled": false} when missing, never overwrites an existing row, re-runs
// cleanly. The seeded value parses as "disabled". Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { parseWorkerSettings } from "@/lib/worker/settings";

import { SUPABASE_BASE_STUB, pgliteDb } from "./pglite";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.store_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.store_settings enable row level security;
insert into public.store_settings (key, value) values ('occasions', '[]'), ('turnstile', '{"enabled": false}');
`;

describe("0111 worker switch", () => {
  describe("fresh database", () => {
    const { db, rows, applyTwice } = pgliteDb();
    beforeAll(async () => {
      await db.exec(STUB);
      await applyTwice("0111_worker_switch.sql");
    }, 60_000);

    it("adds the row switched off, once", async () => {
      const r = await rows<{ value: unknown }>("select value from public.store_settings where key = 'worker'");
      expect(r).toEqual([{ value: { enabled: false } }]);
      expect(parseWorkerSettings(r[0]!.value)).toEqual({ enabled: false });
    });

    it("keeps every other setting", async () => {
      const keys = (await rows<{ key: string }>("select key from public.store_settings order by key")).map((r) => r.key);
      expect(keys).toEqual(["occasions", "turnstile", "worker"]);
    });
  });

  describe("row already switched on", () => {
    const { db, rows, applyTwice } = pgliteDb();
    beforeAll(async () => {
      await db.exec(`${STUB}\ninsert into public.store_settings (key, value) values ('worker', '{"enabled": true}');`);
      await applyTwice("0111_worker_switch.sql");
    }, 60_000);

    it("does not overwrite it", async () => {
      expect(await rows("select value from public.store_settings where key = 'worker'")).toEqual([{ value: { enabled: true } }]);
    });
  });
});

describe("parseWorkerSettings", () => {
  it("is enabled only for enabled === true", () => {
    expect(parseWorkerSettings({ enabled: true })).toEqual({ enabled: true });
    for (const v of [undefined, null, {}, { enabled: "true" }, { enabled: 1 }, [true], "on", true]) {
      expect(parseWorkerSettings(v)).toEqual({ enabled: false });
    }
  });
});
