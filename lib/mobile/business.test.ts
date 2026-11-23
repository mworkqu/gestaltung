import { describe, expect, it } from "vitest";

import {
  buildBusiness,
  matchesSearch,
  newPartRow,
  offerIsLive,
  parseAddStock,
  parseQty,
  skuFromName,
  type BusinessInput,
  type OfferInput,
  type PartInput,
} from "@/lib/mobile/business";

const NOW = new Date("2026-11-24T10:00:00.000Z");

function part(over: Partial<PartInput> = {}): PartInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sku: "SKU-1",
    name: "M3 screw",
    name_ar: "برغي",
    category: "fasteners",
    unit_price: 2.5,
    stock_status: "in_stock",
    in_own_stock: false,
    is_test: false,
    image_url: null,
    pricing_mode: "markup",
    lead_time_class: null,
    ...over,
  };
}

function offer(over: Partial<OfferInput> = {}): OfferInput {
  return {
    id: "o1",
    part_id: "11111111-1111-4111-8111-111111111111",
    supplier_id: "s1",
    cost: 1,
    retail_price: 2,
    availability: "in_stock",
    lead_time_days: 2,
    active: true,
    last_checked_at: null,
    ...over,
  };
}

function input(over: Partial<BusinessInput> = {}): BusinessInput {
  return {
    now: NOW,
    includeTest: false,
    parts: [],
    stock: [],
    suppliers: [],
    offers: [],
    gaps: [],
    cart: [],
    orders: [],
    ...over,
  };
}

describe("parseQty", () => {
  it("takes whole units, including zero", () => {
    expect(parseQty(0)).toBe(0);
    expect(parseQty(12)).toBe(12);
    expect(parseQty("12")).toBe(12);
    expect(parseQty(" 7 ")).toBe(7);
  });

  it("refuses anything that is not a whole count", () => {
    for (const bad of [-1, 1.5, "1.5", "-3", "", "abc", null, undefined, {}, "1e3"]) {
      expect(parseQty(bad)).toBeNull();
    }
  });

  it("refuses a quantity past the cap", () => {
    expect(parseQty(1_000_001)).toBeNull();
  });
});

describe("offerIsLive", () => {
  it("counts an active, available offer", () => {
    expect(offerIsLive(offer())).toBe(true);
  });

  it("drops inactive, out of stock, discontinued and parked offers", () => {
    expect(offerIsLive(offer({ active: false }))).toBe(false);
    expect(offerIsLive(offer({ availability: "out_of_stock" }))).toBe(false);
    expect(offerIsLive(offer({ availability: "DISCONTINUED" }))).toBe(false);
    expect(offerIsLive(offer({ availability: "parked" }))).toBe(false);
  });
});

describe("buildBusiness — inventory", () => {
  it("joins own stock to the catalogue and values it", () => {
    const out = buildBusiness(
      input({
        parts: [part({ unit_price: 2.5 })],
        stock: [{ part_id: part().id, qty: 4, updated_at: "2026-11-20T00:00:00Z" }],
      })
    );
    expect(out.inventory.lines).toBe(1);
    expect(out.inventory.units).toBe(4);
    expect(out.inventory.value).toBe(10);
    expect(out.inventory.rows[0].name).toBe("M3 screw");
  });

  it("ignores zero and negative counts", () => {
    const out = buildBusiness(
      input({
        parts: [part()],
        stock: [{ part_id: part().id, qty: 0, updated_at: null }],
      })
    );
    expect(out.inventory.lines).toBe(0);
    expect(out.inventory.units).toBe(0);
  });

  it("drops stock whose part is not in the catalogue", () => {
    const out = buildBusiness(input({ parts: [], stock: [{ part_id: "gone", qty: 5, updated_at: null }] }));
    expect(out.inventory.lines).toBe(0);
  });

  it("hides test parts unless asked for them", () => {
    const t = part({ id: "22222222-2222-4222-8222-222222222222", is_test: true });
    const stock = [{ part_id: t.id, qty: 3, updated_at: null }];
    expect(buildBusiness(input({ parts: [t], stock })).inventory.lines).toBe(0);
    expect(buildBusiness(input({ parts: [t], stock, includeTest: true })).inventory.lines).toBe(1);
  });

  it("counts parts flagged in_own_stock that have no units", () => {
    const out = buildBusiness(input({ parts: [part({ in_own_stock: true })], stock: [] }));
    expect(out.inventory.flaggedButEmpty).toBe(1);
  });

  it("sorts the shelf by value, biggest first", () => {
    const cheap = part({ id: "33333333-3333-4333-8333-333333333333", name: "cheap", unit_price: 1 });
    const dear = part({ id: "44444444-4444-4444-8444-444444444444", name: "dear", unit_price: 100 });
    const out = buildBusiness(
      input({
        parts: [cheap, dear],
        stock: [
          { part_id: cheap.id, qty: 5, updated_at: null },
          { part_id: dear.id, qty: 5, updated_at: null },
        ],
      })
    );
    expect(out.inventory.rows.map((r) => r.name)).toEqual(["dear", "cheap"]);
  });
});

describe("buildBusiness — supply", () => {
  it("ranks suppliers by rank, lowest first", () => {
    const out = buildBusiness(
      input({
        parts: [part()],
        suppliers: [
          { id: "s2", code: "voltaat", name: "Voltaat", active: true, rank: 20, default_currency: "QAR" },
          { id: "s1", code: "own_stock", name: "Own stock", active: true, rank: 1, default_currency: "QAR" },
        ],
      })
    );
    expect(out.supply.suppliers.map((s) => s.code)).toEqual(["own_stock", "voltaat"]);
  });

  it("separates live offers from dead ones", () => {
    const out = buildBusiness(
      input({
        parts: [part()],
        suppliers: [{ id: "s1", code: "a", name: "A", active: true, rank: 1, default_currency: "QAR" }],
        offers: [offer(), offer({ id: "o2", availability: "out_of_stock" })],
      })
    );
    expect(out.supply.offers).toBe(2);
    expect(out.supply.liveOffers).toBe(1);
    expect(out.supply.suppliers[0].liveOffers).toBe(1);
  });

  it("counts a part with no live offer at all", () => {
    const out = buildBusiness(
      input({ parts: [part()], offers: [offer({ availability: "out_of_stock" })] })
    );
    expect(out.supply.partsWithNoLiveOffer).toBe(1);
  });

  it("flags a supplier that is the only live source for a part", () => {
    const out = buildBusiness(
      input({
        parts: [part()],
        suppliers: [{ id: "s1", code: "a", name: "A", active: true, rank: 1, default_currency: "QAR" }],
        offers: [offer()],
      })
    );
    expect(out.supply.suppliers[0].soleSource).toBe(1);
  });

  it("does not call a supplier sole source when another can supply too", () => {
    const out = buildBusiness(
      input({
        parts: [part()],
        suppliers: [
          { id: "s1", code: "a", name: "A", active: true, rank: 1, default_currency: "QAR" },
          { id: "s2", code: "b", name: "B", active: true, rank: 2, default_currency: "QAR" },
        ],
        offers: [offer(), offer({ id: "o2", supplier_id: "s2" })],
      })
    );
    expect(out.supply.suppliers.every((s) => s.soleSource === 0)).toBe(true);
  });
});

describe("buildBusiness — demand", () => {
  it("measures how long a gap has been asked for", () => {
    const out = buildBusiness(
      input({
        gaps: [
          {
            id: "g1",
            project_id: "p1",
            function: "motor driver",
            spec: "3A",
            kind: "part",
            quantity: 2,
            first_seen: "2026-11-01T00:00:00Z",
            last_seen: "2026-11-11T00:00:00Z",
          },
        ],
      })
    );
    expect(out.demand.openGaps).toBe(1);
    expect(out.demand.gaps[0].ageDays).toBe(10);
    expect(out.demand.gaps[0].what).toBe("motor driver");
  });

  it("adds up units sitting in carts", () => {
    const out = buildBusiness(
      input({ cart: [{ part_id: "x", quantity: 3, created_at: null }, { part_id: "y", quantity: 2, created_at: null }] })
    );
    expect(out.demand.cartUnits).toBe(5);
  });

  it("leaves test orders out unless asked", () => {
    const orders = [{ id: "o1", status: "new", created_at: null, is_test: true }];
    expect(buildBusiness(input({ orders })).demand.orders).toBe(0);
    expect(buildBusiness(input({ orders, includeTest: true })).demand.orders).toBe(1);
  });
});

describe("parseAddStock", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("takes an existing part and a count", () => {
    const r = parseAddStock({ partId: uuid, qty: 5 }, NOW);
    expect(r).toEqual({ ok: true, value: { partId: uuid, qty: 5 } });
  });

  it("takes a brand new part and fills in sensible defaults", () => {
    const r = parseAddStock({ newPart: { name: "Brass insert" }, qty: 2 }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("newPart" in r.value && r.value.newPart.category).toBe("other");
    expect("newPart" in r.value && r.value.newPart.unitPrice).toBe(0);
    expect("newPart" in r.value && r.value.newPart.sku).toMatch(/^OWN-BRASS-INSERT-/);
  });

  it("refuses both a part id and a new part at once", () => {
    expect(parseAddStock({ partId: uuid, newPart: { name: "x" }, qty: 1 }, NOW)).toEqual({ ok: false, error: "both" });
  });

  it("refuses neither", () => {
    expect(parseAddStock({ qty: 1 }, NOW)).toEqual({ ok: false, error: "neither" });
  });

  it("refuses a bad quantity before anything else", () => {
    expect(parseAddStock({ partId: uuid, qty: -1 }, NOW)).toEqual({ ok: false, error: "qty" });
  });

  it("refuses a part id that is not a uuid", () => {
    expect(parseAddStock({ partId: "not-a-uuid", qty: 1 }, NOW)).toEqual({ ok: false, error: "part" });
  });

  it("refuses an empty or absurd name", () => {
    expect(parseAddStock({ newPart: { name: "x" }, qty: 1 }, NOW)).toEqual({ ok: false, error: "name" });
    expect(parseAddStock({ newPart: { name: "y".repeat(201) }, qty: 1 }, NOW)).toEqual({ ok: false, error: "name" });
  });

  it("refuses a non-object body", () => {
    expect(parseAddStock(null, NOW)).toEqual({ ok: false, error: "neither" });
    expect(parseAddStock("nope", NOW)).toEqual({ ok: false, error: "neither" });
  });
});

describe("skuFromName", () => {
  it("makes a readable, prefixed sku", () => {
    expect(skuFromName("M3 screw", NOW)).toMatch(/^OWN-M3-SCREW-[A-Z0-9]+$/);
  });

  it("falls back when the name has nothing usable in it", () => {
    expect(skuFromName("!!!", NOW)).toMatch(/^OWN-ITEM-/);
  });
});

describe("newPartRow", () => {
  it("creates the part unpublished and already marked as ours", () => {
    const row = newPartRow({ name: "Spacer" }, NOW);
    expect(row.is_published).toBe(false);
    expect(row.in_own_stock).toBe(true);
    expect(row.is_test).toBe(false);
    expect(row.min_order_qty).toBe(1);
    expect(row.unit_price).toBe(0);
  });
});

describe("matchesSearch", () => {
  it("matches name, Arabic name and sku, ignoring case", () => {
    expect(matchesSearch(part(), "screw")).toBe(true);
    expect(matchesSearch(part(), "SCREW")).toBe(true);
    expect(matchesSearch(part(), "برغي")).toBe(true);
    expect(matchesSearch(part(), "sku-1")).toBe(true);
  });

  it("does not match an empty search or a miss", () => {
    expect(matchesSearch(part(), "")).toBe(false);
    expect(matchesSearch(part(), "   ")).toBe(false);
    expect(matchesSearch(part(), "resistor")).toBe(false);
  });
});
