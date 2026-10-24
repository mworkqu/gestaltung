// Source-level check: the admin "Today" card counts open orders with its own
// status list (components/dashboard/admin-overview.tsx). It must be the same
// set as OPEN_ORDER_STATUSES (lib/orders/status.ts), the single definition of
// "still in progress".
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { OPEN_ORDER_STATUSES } from "./status";

const SRC = fs.readFileSync(path.join(process.cwd(), "components", "dashboard", "admin-overview.tsx"), "utf8");

/** The array passed to .in("status", ...) in the open-orders count (a literal list, or OPEN_ORDER_STATUSES). */
function openStatusesInOverview(): string[] {
  const m = SRC.match(/\.from\("part_orders"\)[\s\S]{0,200}?\.in\("status",\s*(\[[^\]]*\]|[A-Za-z_]+)/);
  if (!m) throw new Error('admin-overview.tsx: no part_orders .in("status", ...) found');
  if (!m[1].startsWith("[")) {
    if (m[1] !== "OPEN_ORDER_STATUSES") throw new Error(`unrecognised status list expression: ${m[1]}`);
    return [...OPEN_ORDER_STATUSES];
  }
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

describe("admin overview open-order statuses", () => {
  it("finds the list", () => {
    expect(openStatusesInOverview().length).toBeGreaterThan(0);
  });

  it("lists no status that OPEN_ORDER_STATUSES does not know", () => {
    const stray = openStatusesInOverview().filter((s) => !(OPEN_ORDER_STATUSES as readonly string[]).includes(s));
    expect(stray).toEqual([]);
  });

  // Was it.fails until R6: the overview had its own list without "shipped".
  it("covers every OPEN_ORDER_STATUSES value", () => {
    expect([...openStatusesInOverview()].sort()).toEqual([...OPEN_ORDER_STATUSES].sort());
  });
});
