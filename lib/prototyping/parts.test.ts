import { describe, expect, it } from "vitest";

import { mergePartsForList, rowMatchesFilter, type PartsListFilter, type PartSource } from "./parts";

type P = { id: string; code: string; source: PartSource | null };
type I = {
  id: string;
  quantity: number;
  part: { name: string; sku: string; unit_price: number } | null;
};

const toDesign: P[] = [
  { id: "a", code: "P-01", source: "to_design" },
  { id: "b", code: "P-02", source: "to_design" },
  { id: "c", code: "P-03", source: null }, // rows from before 0022 have no source
];
const catalogPart: P = { id: "d", code: "P-04", source: "catalog" };
const storeLines: I[] = [
  { id: "x", quantity: 2, part: { name: "ESP32", sku: "GR-011", unit_price: 45 } },
  { id: "y", quantity: 1, part: null }, // product no longer readable
];

const ids = (filter: PartsListFilter, parts: P[], items: I[]) =>
  mergePartsForList(parts, items)
    .filter((r) => rowMatchesFilter(r, filter))
    .map((r) => r.id);

describe("mergePartsForList", () => {
  it("lists project_parts first, in order, then every store line", () => {
    const rows = mergePartsForList([...toDesign, catalogPart], storeLines);
    expect(rows.map((r) => r.id)).toEqual(["part:a", "part:b", "part:c", "part:d", "item:x", "item:y"]);
    expect(rows.map((r) => r.origin)).toEqual(["part", "part", "part", "part", "store", "store"]);
  });

  it("keeps the original rows untouched", () => {
    const [first, , , , store] = mergePartsForList([...toDesign, catalogPart], storeLines);
    expect(first.origin === "part" && first.part).toBe(toDesign[0]);
    expect(store.origin === "store" && store.item).toBe(storeLines[0]);
  });

  it("does not collide when a part and a store line share an id", () => {
    const rows = mergePartsForList([{ id: "same", code: "P-01", source: "to_design" as const }], [
      { id: "same", quantity: 1, part: null },
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("handles either side being empty", () => {
    expect(mergePartsForList([], [])).toEqual([]);
    expect(mergePartsForList(toDesign, []).length).toBe(3);
    expect(mergePartsForList([], storeLines).length).toBe(2);
  });
});

describe("rowMatchesFilter", () => {
  it("Catalog shows store lines even when no project_part is a catalog part (audit #4)", () => {
    expect(ids("catalog", toDesign, storeLines)).toEqual(["item:x", "item:y"]);
  });

  it("Catalog shows catalog project_parts and store lines together", () => {
    expect(ids("catalog", [...toDesign, catalogPart], storeLines)).toEqual(["part:d", "item:x", "item:y"]);
  });

  it("To design never shows store lines", () => {
    expect(ids("to_design", [...toDesign, catalogPart], storeLines)).toEqual(["part:a", "part:b", "part:c"]);
  });

  it("All shows everything", () => {
    expect(ids("all", [...toDesign, catalogPart], storeLines).length).toBe(6);
  });
});
