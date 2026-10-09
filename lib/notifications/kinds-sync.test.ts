// Kind names live in three places: the notification_outbox_kind_check
// constraint (latest migration that replaces it), OUTBOX_KINDS and
// NOTIFICATION_KINDS. This test reads the SQL and fails when they drift.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS } from "@/lib/email/templates";
import { DEFAULT_KIND_SETTINGS, OUTBOX_KINDS } from "./decide";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

function latestKindCheck(): string[] {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let found: string[] | null = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const m = sql.match(/notification_outbox_kind_check\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)/i);
    if (m) found = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  if (!found) throw new Error("no notification_outbox_kind_check found");
  return found;
}

describe("notification kinds stay in sync", () => {
  it("SQL check constraint = OUTBOX_KINDS = NOTIFICATION_KINDS", () => {
    const sql = latestKindCheck().sort();
    expect([...OUTBOX_KINDS].sort()).toEqual(sql);
    expect([...NOTIFICATION_KINDS].sort()).toEqual(sql);
  });

  it("every kind has an owner default", () => {
    expect(Object.keys(DEFAULT_KIND_SETTINGS).sort()).toEqual([...OUTBOX_KINDS].sort());
  });

  it("0053 switches discount_ready on and adds the six order keys to store_settings.notifications", () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, "0053_order_status_history.sql"), "utf8");
    expect(sql).toContain(`'{"discount_ready": true}'::jsonb`);
    for (const k of OUTBOX_KINDS.filter((k) => k.startsWith("order_"))) expect(sql).toContain(`"${k}": true`);
  });
});
