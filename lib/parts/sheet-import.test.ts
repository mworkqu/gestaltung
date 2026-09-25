import { describe, expect, it } from "vitest";

import {
  compareSku,
  isDuplicateProductError,
  materialLabel,
  normalizeMaterial,
  normalizeName,
  partKey,
} from "@/lib/parts/part-key";
import { parseSheet, type ExistingPart } from "@/lib/parts/sheet-import";

const HEADER = "sku,name,category,unit_price,material,pack_size";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("normalizeName", () => {
  it("lower-cases, turns punctuation into spaces and collapses whitespace", () => {
    expect(normalizeName("Diode 1N4148")).toBe("diode 1n4148");
    expect(normalizeName("  diode,   1N4148 ")).toBe("diode 1n4148");
    expect(normalizeName("Resistor – 10K")).toBe("resistor 10k");
    expect(normalizeName("Stepper 28BYJ-48")).toBe("stepper 28byj 48");
    expect(normalizeName("9V\u00a0Battery")).toBe("9v battery");
  });

  it("keeps letters in any script and handles empty input", () => {
    expect(normalizeName("مقاوم 10K")).toBe("مقاوم 10k");
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
  });
});

describe("normalizeMaterial / materialLabel", () => {
  it("stores lower snake_case, blank as null", () => {
    expect(normalizeMaterial("Aluminum")).toBe("aluminum");
    expect(normalizeMaterial(" aluminum ")).toBe("aluminum");
    expect(normalizeMaterial("Stainless Steel")).toBe("stainless_steel");
    expect(normalizeMaterial("stainless-steel")).toBe("stainless_steel");
    expect(normalizeMaterial("   ")).toBeNull();
    expect(normalizeMaterial(null)).toBeNull();
  });

  it("shows a stored material readably", () => {
    expect(materialLabel("stainless_steel")).toBe("Stainless steel");
    expect(materialLabel(null)).toBe("");
  });
});

describe("partKey", () => {
  it("combines name, material and pack size", () => {
    expect(partKey("Diode 1N4148", null, 1)).toBe("diode 1n4148||1");
    expect(partKey("Resistor 10K", "Aluminum", 10)).toBe("resistor 10k|aluminum|10");
  });

  it("treats a missing or invalid pack size as 1", () => {
    expect(partKey("Diode", null, undefined)).toBe(partKey("Diode", null, 1));
    expect(partKey("Diode", null, 0)).toBe(partKey("Diode", null, 1));
  });

  it("different material or pack size is a different product", () => {
    expect(partKey("Resistor 10K", "aluminum", 1)).not.toBe(partKey("Resistor 10K", null, 1));
    expect(partKey("Resistor 10K", null, 10)).not.toBe(partKey("Resistor 10K", null, 1));
    expect(partKey("Resistor 10K", "Aluminum", 1)).toBe(partKey("resistor-10k", " aluminum", 1));
  });
});

describe("compareSku", () => {
  it("orders by prefix, then the number numerically", () => {
    const skus = ["GR-114", "GR-034", "GR-024", "GR-104"];
    expect([...skus].sort(compareSku)).toEqual(["GR-024", "GR-034", "GR-104", "GR-114"]);
    expect(compareSku("GR-9", "GR-10")).toBeLessThan(0);
  });
});

describe("isDuplicateProductError", () => {
  it("only matches the 0030 unique index", () => {
    expect(isDuplicateProductError({ code: "23505", message: 'violates unique constraint "parts_name_key_uniq"' })).toBe(true);
    expect(isDuplicateProductError({ code: "23505", message: 'violates unique constraint "parts_sku_key"' })).toBe(false);
    expect(isDuplicateProductError(null)).toBe(false);
  });
});

describe("parseSheet de-duplication", () => {
  it("collapses duplicate products in the sheet; first SKU wins", () => {
    const r = parseSheet(
      csv(
        "GR-024,Diode 1N4148,Components,1,,",
        "GR-034,\"diode, 1n4148\",Components,1,,",
        "GR-114,Diode 1N4148 ,Components,1.5,,",
        "GR-011,Resistor 10K,Components,0.1,,"
      )
    );
    expect(r.valid.map((p) => p.sku)).toEqual(["GR-024", "GR-011"]);
    expect(r.skipped).toEqual([
      { row: 3, sku: "GR-034", reason: "duplicate_of", ref: "GR-024" },
      { row: 4, sku: "GR-114", reason: "duplicate_of", ref: "GR-024" },
    ]);
  });

  it("keys with material and pack size", () => {
    const r = parseSheet(
      csv(
        "A-1,Resistor 10K,Components,1,Aluminum,",
        "A-2,Resistor 10K,Components,1,aluminum ,1",
        "A-3,Resistor 10K,Components,1,,",
        "A-4,Resistor 10K,Components,1,Aluminum,10",
        "A-5,Resistor 10K,Components,1,brass,"
      )
    );
    expect(r.valid.map((p) => p.sku)).toEqual(["A-1", "A-3", "A-4", "A-5"]);
    expect(r.skipped).toEqual([{ row: 3, sku: "A-2", reason: "duplicate_of", ref: "A-1" }]);
    expect(r.valid[0].material).toBe("aluminum");
  });

  it("skips rows the store already has under another SKU", () => {
    const existing: ExistingPart[] = [
      { sku: "GR-024", name: "Diode 1N4148", material: null, pack_size: 1, merged_into_sku: null },
      { sku: "GR-114", name: "Diode 1N4148", material: null, pack_size: 1, merged_into_sku: "GR-024" },
    ];
    const r = parseSheet(
      csv(
        "GR-114,Diode 1N4148,Components,1,,",
        "NEW-1,DIODE 1N4148,Components,1,,",
        "NEW-2,Push Button,Components,1,,"
      ),
      existing
    );
    expect(r.valid.map((p) => p.sku)).toEqual(["NEW-2"]);
    expect(r.skipped).toEqual([
      { row: 2, sku: "GR-114", reason: "exists_as", ref: "GR-024" },
      { row: 3, sku: "NEW-1", reason: "exists_as", ref: "GR-024" },
    ]);
  });

  it("imports the stored SKU even when a duplicate comes first in the sheet", () => {
    const existing: ExistingPart[] = [
      { sku: "GR-024", name: "Diode 1N4148", material: null, pack_size: 1, merged_into_sku: null },
    ];
    const r = parseSheet(
      csv("GR-034,Diode 1N4148,Components,1,,", "GR-024,Diode 1N4148,Components,2,,"),
      existing
    );
    expect(r.valid.map((p) => p.sku)).toEqual(["GR-024"]);
    expect(r.skipped).toEqual([{ row: 2, sku: "GR-034", reason: "duplicate_of", ref: "GR-024" }]);
  });

  it("before 0030 (several live copies) keeps the lowest SKU, like the migration", () => {
    const existing: ExistingPart[] = ["GR-114", "GR-034", "GR-024"].map((sku) => ({
      sku,
      name: "Diode 1N4148",
      material: null,
      pack_size: 1,
      merged_into_sku: null,
    }));
    const r = parseSheet(csv("GR-114,Diode 1N4148,Components,1,,"), existing);
    expect(r.valid).toEqual([]);
    expect(r.skipped).toEqual([{ row: 2, sku: "GR-114", reason: "exists_as", ref: "GR-024" }]);
  });

  it("uses the stored pack size when the sheet has no pack_size column", () => {
    const existing: ExistingPart[] = [
      { sku: "P-1", name: "Screw M3", material: null, pack_size: 50, merged_into_sku: null },
    ];
    const r = parseSheet(
      ["sku,name,category,unit_price", "P-1,Screw M3,Fasteners,5", "P-2,Screw M3,Fasteners,1"].join("\n"),
      existing
    );
    // P-1 keeps its pack of 50; P-2 is a new pack-of-1 product.
    expect(r.valid.map((p) => p.sku)).toEqual(["P-1", "P-2"]);
    expect(r.skipped).toEqual([]);
  });

  it("still reports the older reasons, in row order", () => {
    const r = parseSheet(csv(",No SKU,Components,1,,", "X-1,Thing,Components,abc,,", "X-2,Thing,Components,1,,", "X-2,Other,Components,1,,"));
    expect(r.skipped.map((s) => [s.row, s.reason])).toEqual([
      [2, "missing_required"],
      [3, "bad_price"],
      [5, "duplicate_sku"],
    ]);
  });
});
