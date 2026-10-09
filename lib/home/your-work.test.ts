import { describe, expect, it } from "vitest";

import type { ProjectBom, ProjectLine } from "@/lib/prototyping/bom";
import {
  buildReorderPlan,
  countOpenBomLines,
  partsToBuy,
  pickActiveProjects,
  pickLastDelivered,
  pickLastOrder,
  type ReorderPart,
} from "./your-work";

const line = (id: string, extra: Partial<ProjectLine> = {}): ProjectLine => ({
  id,
  function: `item ${id}`,
  spec: "",
  quantity: 1,
  kind: "electronics",
  critical: false,
  ...extra,
});
const bom = (lines: ProjectLine[], dismissed: string[] = []): ProjectBom => ({
  lines,
  analysedAt: "2026-10-01T00:00:00Z",
  dismissed,
});

describe("pickActiveProjects", () => {
  const rows = [
    { id: "a", status: "active", updated_at: "2026-10-01T00:00:00Z" },
    { id: "b", status: "archived", updated_at: "2026-10-09T00:00:00Z" },
    { id: "c", status: "active", updated_at: "2026-10-05T00:00:00Z" },
    { id: "d", updated_at: "2026-10-07T00:00:00Z" },
    { id: "e", status: "active", updated_at: "2026-09-01T00:00:00Z" },
  ];
  it("keeps the newest three active projects and drops archived ones", () => {
    expect(pickActiveProjects(rows).map((p) => p.id)).toEqual(["d", "c", "a"]);
  });
  it("treats a missing status (before 0042) as active", () => {
    expect(pickActiveProjects([{ updated_at: "2026-10-01T00:00:00Z" }])).toHaveLength(1);
  });
  it("does not mutate its input and handles an empty list", () => {
    const copy = [...rows];
    pickActiveProjects(rows);
    expect(rows).toEqual(copy);
    expect(pickActiveProjects([])).toEqual([]);
  });
  it("respects a custom limit", () => {
    expect(pickActiveProjects(rows, 1).map((p) => p.id)).toEqual(["d"]);
  });
});

describe("pickLastOrder / pickLastDelivered", () => {
  const orders = [
    { id: "1", status: "delivered", created_at: "2026-08-01T00:00:00Z" },
    { id: "2", status: "shipped", created_at: "2026-10-01T00:00:00Z" },
    { id: "3", status: "delivered", created_at: "2026-09-01T00:00:00Z" },
    { id: "4", status: "cancelled", created_at: "2026-09-20T00:00:00Z" },
  ];
  it("last order is the newest whatever its status", () => {
    expect(pickLastOrder(orders)?.id).toBe("2");
  });
  it("last delivered skips open and cancelled orders", () => {
    expect(pickLastDelivered(orders)?.id).toBe("3");
  });
  it("is null when nothing qualifies", () => {
    expect(pickLastOrder([])).toBeNull();
    expect(pickLastDelivered([orders[1]])).toBeNull();
  });
});

describe("countOpenBomLines / partsToBuy", () => {
  it("counts live lines not bought and not fabrication", () => {
    const b = bom(
      [
        line("1", { function: "servo" }),
        line("2", { function: "battery" }),
        line("3", { function: "usb cable", fulfilled: { orderId: "o", at: "x", productId: "p", sku: "S", quantity: 1 } }),
        line("4", { function: "laser cut panel", group: "fabrication" }),
        line("5", { function: "led" }),
      ],
      ["5"]
    );
    expect(countOpenBomLines(b)).toBe(2);
  });
  it("is 0 for a missing bom", () => {
    expect(countOpenBomLines(null)).toBe(0);
    expect(countOpenBomLines(undefined)).toBe(0);
  });
  it("sums across projects", () => {
    const a = { bom: bom([line("1", { function: "servo" })]) };
    const b = { bom: bom([line("2", { function: "battery" }), line("3", { function: "motor" })]) };
    expect(partsToBuy([a, b])).toEqual({ kind: "count", count: 3 });
  });
  it("is unknown when no project has a bom", () => {
    expect(partsToBuy([{ bom: null }, { bom: bom([]) }])).toEqual({ kind: "unknown" });
    expect(partsToBuy([])).toEqual({ kind: "unknown" });
  });
  it("is none when every line is bought or made in-house", () => {
    const b = bom([line("1", { function: "panel", group: "fabrication" })]);
    expect(partsToBuy([{ bom: b }])).toEqual({ kind: "none" });
  });
});

describe("buildReorderPlan", () => {
  const part = (sku: string, extra: Partial<ReorderPart> = {}): ReorderPart => ({
    id: `id-${sku}`,
    sku,
    name: `Part ${sku}`,
    name_ar: null,
    min_order_qty: 1,
    is_published: true,
    merged_into: null,
    ...extra,
  });
  it("adds sold products as plain lines and lists the rest", () => {
    const plan = buildReorderPlan(
      [
        { part_sku: "A", part_name: "Servo", quantity: 2 },
        { part_sku: "B", part_name: "Gone", quantity: 1 },
        { part_sku: "C", part_name: "Hidden", quantity: 4 },
        { part_sku: "D", part_name: "Merged", quantity: 1 },
      ],
      [part("A"), part("C", { is_published: false }), part("D", { merged_into: "id-A" })]
    );
    expect(plan.add.map((l) => [l.part.sku, l.quantity])).toEqual([["A", 2]]);
    expect(plan.unavailable).toEqual(["Gone", "Hidden", "Merged"]);
  });
  it("sums duplicate skus and names a missing sku once", () => {
    const plan = buildReorderPlan(
      [
        { part_sku: "A", part_name: "Servo", quantity: 2 },
        { part_sku: "A", part_name: "Servo", quantity: 3 },
        { part_sku: "X", part_name: "Old", quantity: 1 },
        { part_sku: "X", part_name: "Old", quantity: 1 },
      ],
      [part("A")]
    );
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].quantity).toBe(5);
    expect(plan.unavailable).toEqual(["Old"]);
  });
  it("ignores lines with a non-positive quantity", () => {
    const plan = buildReorderPlan([{ part_sku: "A", part_name: "Servo", quantity: 0 }], [part("A")]);
    expect(plan).toEqual({ add: [], unavailable: [] });
  });
});
