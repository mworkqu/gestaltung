import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLEANUP_DEFAULTS,
  clampDays,
  cleanupSettingsValue,
  parseCleanupResult,
  parseCleanupSettings,
  shouldEmail,
  summaryLine,
} from "./anonymous";

const SQL = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0055_turnstile_and_cleanup.sql"), "utf8");

describe("parseCleanupSettings", () => {
  it("missing or malformed = on, dry run, 30 days", () => {
    for (const raw of [null, undefined, "x", 3, [], {}]) expect(parseCleanupSettings(raw)).toEqual(CLEANUP_DEFAULTS);
    expect(CLEANUP_DEFAULTS).toEqual({ enabled: true, dryRun: true, days: 30 });
  });

  it("stays a dry run unless dry_run is exactly false", () => {
    expect(parseCleanupSettings({ dry_run: false }).dryRun).toBe(false);
    for (const v of [true, "false", 0, null, undefined]) expect(parseCleanupSettings({ dry_run: v }).dryRun).toBe(true);
  });

  it("only enabled:false switches it off", () => {
    expect(parseCleanupSettings({ enabled: false }).enabled).toBe(false);
    expect(parseCleanupSettings({ enabled: "no" }).enabled).toBe(true);
  });

  it("days are clamped to at least 7", () => {
    expect(parseCleanupSettings({ days: 1 }).days).toBe(7);
    expect(parseCleanupSettings({ days: 45.9 }).days).toBe(45);
    expect(parseCleanupSettings({ days: "60" }).days).toBe(60);
    expect(parseCleanupSettings({ days: "abc" }).days).toBe(30);
    expect(clampDays(100000)).toBe(3650);
  });

  it("round-trips through the stored shape", () => {
    const s = { enabled: false, dryRun: false, days: 14 };
    expect(cleanupSettingsValue(s)).toEqual({ enabled: false, dry_run: false, days: 14 });
    expect(parseCleanupSettings(cleanupSettingsValue(s))).toEqual(s);
  });

  it("matches the 0055 seed", () => {
    const m = SQL.match(/values \('anonymous_cleanup', '([^']+)'::jsonb\)\s*on conflict \(key\) do nothing/);
    expect(m).not.toBeNull();
    expect(parseCleanupSettings(JSON.parse(m![1]))).toEqual(CLEANUP_DEFAULTS);
  });
});

describe("parseCleanupResult / shouldEmail / summaryLine", () => {
  const dry = { dry_run: true, days: 30, candidates: 12, deleted: 0, sample: ["a", "b", 3] };
  const real = { dry_run: false, days: 30, candidates: 3, deleted: 3, sample: [] };

  it("parses the function's jsonb", () => {
    expect(parseCleanupResult(dry)).toEqual({ dryRun: true, days: 30, candidates: 12, deleted: 0, sample: ["a", "b"] });
    expect(parseCleanupResult(null)).toBeNull();
    expect(parseCleanupResult({ dry_run: true })).toBeNull();
  });

  it("emails only when something was deleted", () => {
    expect(shouldEmail(parseCleanupResult(dry)!)).toBe(false);
    expect(shouldEmail(parseCleanupResult(real)!)).toBe(true);
    expect(shouldEmail(parseCleanupResult({ ...real, deleted: 0 })!)).toBe(false);
  });

  it("one line, singular and plural", () => {
    expect(summaryLine(parseCleanupResult(dry)!)).toBe(
      "Anonymous cleanup (dry run): 12 guest accounts older than 30 days own nothing; nothing deleted."
    );
    expect(summaryLine(parseCleanupResult({ ...real, deleted: 1, candidates: 1 })!)).toBe(
      "Anonymous cleanup: deleted 1 guest account older than 30 days that owned nothing (1 found)."
    );
  });
});

describe("0055 cleanup function", () => {
  it("is service_role only and checks every ownership table twice (select + delete)", () => {
    expect(SQL).toMatch(
      /revoke all on function public\.cleanup_anonymous_users\(boolean, integer\) from public, anon, authenticated;/
    );
    expect(SQL).toMatch(/grant execute on function public\.cleanup_anonymous_users\(boolean, integer\) to service_role;/);
    expect(SQL).toMatch(/security definer/);
    const checks = [
      "projects p where p.user_id",
      "part_orders o where o.profile_id",
      "cart_items ci where ci.user_id",
      "client_inventory_items ii where ii.user_id",
      "credits_ledger cl where cl.user_id",
      "project_kits pk where pk.user_id",
      "storage.objects so where so.owner",
    ];
    for (const c of checks) expect(SQL.split(c).length - 1).toBe(2);
  });

  it("is scheduled weekly in vercel.json", () => {
    const v = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(v.crons).toContainEqual({ path: "/api/cron/anonymous-cleanup", schedule: "0 5 * * 0" });
  });
});
