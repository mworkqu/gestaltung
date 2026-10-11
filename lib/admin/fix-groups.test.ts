import { describe, expect, it } from "vitest";

import {
  chunk,
  deliveryWhy,
  groupFixRows,
  mainOffer,
  nextRowId,
  parseOnRequest,
  summariseBulk,
  supplierBucket,
  type FixOffer,
  type FixRow,
} from "./fix-groups";

const offer = (o: Partial<FixOffer> = {}): FixOffer => ({
  supplierCode: "voltaat",
  supplierName: "Voltaat",
  supplierActive: true,
  commission: 10,
  active: true,
  availability: "in_stock",
  leadDays: 1,
  retailPrice: 20,
  ...o,
});

describe("supplierBucket", () => {
  it("uses own stock first, then the offer's supplier, then the SKU prefix", () => {
    expect(supplierBucket({ sku: "VLT-1", inOwnStock: true, offers: [offer()] })).toBe("own");
    expect(supplierBucket({ sku: "X", offers: [offer({ supplierCode: "own_stock" })] })).toBe("own");
    expect(supplierBucket({ sku: "X", offers: [offer({ supplierCode: "mouser" })] })).toBe("mouser");
    expect(supplierBucket({ sku: "X", offers: [offer({ supplierCode: "digikey" })] })).toBe("digikey");
    expect(supplierBucket({ sku: "X", offers: [offer({ supplierCode: "aliexpress" })] })).toBe("ali");
    expect(supplierBucket({ sku: "X", offers: [offer({ supplierCode: "alibaba" })] })).toBe("ali");
    expect(supplierBucket({ sku: "X", offers: [offer({ supplierCode: "acme" })] })).toBe("other");
    expect(supplierBucket({ sku: "VLT-123", offers: [] })).toBe("voltaat");
    expect(supplierBucket({ sku: "DK-1", offers: [] })).toBe("digikey");
    expect(supplierBucket({ sku: "GR-001", offers: [] })).toBe("none");
  });
  it("prefers an active offer when there are several", () => {
    const offers = [offer({ supplierCode: "mouser", active: false }), offer({ supplierCode: "digikey" })];
    expect(mainOffer(offers)?.supplierCode).toBe("digikey");
    expect(supplierBucket({ sku: "X", offers })).toBe("digikey");
  });
});

describe("deliveryWhy", () => {
  it("names the reason in order of what blocks the date", () => {
    expect(deliveryWhy({ offers: [] })).toEqual({ code: "noOffer", supplier: null });
    expect(deliveryWhy({ offers: [offer({ active: false, availability: "unavailable" })] })).toEqual({
      code: "outOfStock",
      supplier: "Voltaat",
    });
    expect(deliveryWhy({ offers: [offer({ active: false })] }).code).toBe("offerOff");
    expect(deliveryWhy({ offers: [offer({ supplierActive: false })] }).code).toBe("supplierOff");
    expect(deliveryWhy({ pricingMode: "mirror", offers: [offer({ retailPrice: null })] }).code).toBe("mirrorNoRetail");
    expect(deliveryWhy({ pricingMode: "markup", offers: [offer({ retailPrice: null, leadDays: null })] }).code).toBe(
      "noLeadTime"
    );
    expect(deliveryWhy({ offers: [offer({ availability: "backorder" })] }).code).toBe("outOfStock");
    expect(deliveryWhy({ offers: [offer()] }).code).toBe("notWorkedOut");
  });
});

const row = (id: string, issues: FixRow["issues"], bucket: FixRow["bucket"] = "none"): FixRow => ({
  id,
  name: id,
  sku: null,
  issues,
  bucket,
  why: null,
});

describe("groupFixRows", () => {
  it("one group per issue in a fixed order, delivery split by supplier, counts per group", () => {
    const groups = groupFixRows([
      row("a", ["photo", "delivery"], "voltaat"),
      row("b", ["delivery"], "none"),
      row("c", ["price"]),
      row("d", ["delivery", "supplier"], "voltaat"),
    ]);
    expect(groups.map((g) => [g.issue, g.count])).toEqual([
      ["delivery", 3],
      ["photo", 1],
      ["price", 1],
      ["supplier", 1],
    ]);
    expect(groups[0].subGroups?.map((s) => [s.bucket, s.rows.map((r) => r.id)])).toEqual([
      ["voltaat", ["a", "d"]],
      ["none", ["b"]],
    ]);
    expect(groups[1].subGroups).toBeNull();
  });
  it("drops empty groups", () => {
    expect(groupFixRows([])).toEqual([]);
    expect(groupFixRows([row("a", ["photo"])]).map((g) => g.issue)).toEqual(["photo"]);
  });
});

describe("parseOnRequest", () => {
  it("reads {ids} and ignores junk", () => {
    expect([...parseOnRequest({ ids: ["a", "b", 3, ""] })]).toEqual(["a", "b"]);
    expect(parseOnRequest(null).size).toBe(0);
    expect(parseOnRequest({ ids: "a" }).size).toBe(0);
    expect(parseOnRequest([]).size).toBe(0);
  });
});

describe("summariseBulk", () => {
  it("counts fixed and lists failures with their reason", () => {
    const s = summariseBulk([
      { id: "1", name: "A", ok: true },
      { id: "2", name: "B", ok: false, reason: "offerSave" },
      { id: "3", name: "C", ok: false },
      { id: "4", name: "D", ok: true },
    ]);
    expect(s.fixed).toBe(2);
    expect(s.failed).toEqual([
      { id: "2", name: "B", reason: "offerSave" },
      { id: "3", name: "C", reason: "unknown" },
    ]);
  });
  it("a later result for the same product wins", () => {
    const s = summariseBulk([
      { id: "1", name: "A", ok: false, reason: "load" },
      { id: "1", name: "A", ok: true },
    ]);
    expect(s).toEqual({ fixed: 1, failed: [] });
  });
});

describe("chunk + nextRowId", () => {
  it("splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 20)).toEqual([]);
  });
  it("moves focus to the next row, or the previous one at the end", () => {
    expect(nextRowId(["a", "b", "c"], "a")).toBe("b");
    expect(nextRowId(["a", "b", "c"], "c")).toBe("b");
    expect(nextRowId(["a"], "a")).toBeNull();
    expect(nextRowId(["a", "b"], "x")).toBe("a");
  });
});
