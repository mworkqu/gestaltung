// F-006: "Add all to cart" on the Studio's Parts step put 3 of 7 stocked parts
// in the cart. The fixture is the tester's own 9-part balcony plant waterer
// (Parts total QAR 81.00 + 2 parts priced on request), including the two parts
// the wiring added for them ("Added for you") and the LED sold in a pack of 5 —
// the lines that were lost. The plan must hold EVERY line with a listing, and
// the toast must count the rows that were written.

import { describe, expect, it } from "vitest";

import type { StoreCardPart } from "@/lib/store/catalog";
import { addedCounts, addedToCartLine, kitRowsFor, studioKitPlan } from "./kit-plan";
import { getPart } from "./library";
import type { StudioComponent } from "./schema";
import { skusFor } from "./variants";

// ── The tester's list ───────────────────────────────────────────────────────

const comp = (partId: string, n: number, extra: Partial<StudioComponent> = {}): StudioComponent => ({
  partId,
  instanceId: `${partId}_${n}`,
  label: partId,
  ...extra,
});

/** The nine parts the Parts step listed, in the order it listed them. */
const PLANT_WATERER_KIT: StudioComponent[] = [
  comp("arduino_nano", 1),
  comp("tp4056_usbc", 1),
  comp("lipo_1000", 1), // no listing → "We'll source this"
  comp("soil_moisture_cap", 1),
  comp("pump_5v", 1),
  comp("led_5mm", 1, { variant: "red" }), // need 1, sold in a pack of 5
  comp("mosfet_module", 1, { auto: true }), // "Added for you"
  comp("boost_5v", 1, { auto: true }), // "Added for you"
  comp("resistor_220", 1, { auto: true }), // no listing → "We'll source this"
];

/** The store listing for a part, priced as the tester saw it. */
const listing = (partId: string, unit_price: number, name: string, variant?: string): [string, StoreCardPart] => {
  const sku = skusFor(getPart(partId), variant)[0];
  if (!sku) throw new Error(`${partId} has no store SKU in the library`);
  return [
    sku,
    {
      id: `id-${sku}`,
      sku,
      name,
      name_ar: null,
      unit_price,
      image_url: null,
      category: "electronics",
      min_order_qty: 1,
    },
  ];
};

const PRODUCTS = new Map<string, StoreCardPart>([
  listing("arduino_nano", 25, "Arduino Nano V3 (clone)"),
  listing("tp4056_usbc", 12, "TP4056 USB-C charger module"),
  listing("soil_moisture_cap", 10, "Capacitive soil moisture sensor"),
  listing("pump_5v", 9, "5V submersible water pump"),
  listing("led_5mm", 1, "Red LED 5mm (5 Pack)", "red"),
  listing("mosfet_module", 9, "IRF520 MOSFET driver module"),
  listing("boost_5v", 15, "1-5V to 5V boost converter module"),
]);

const plan = () => studioKitPlan(PLANT_WATERER_KIT, PRODUCTS, getPart);

const skuOf = (partId: string, variant?: string) => skusFor(getPart(partId), variant)[0]!;

describe("F-006 every line with a listing reaches the cart", () => {
  it("writes one row per stocked line — helper parts and the pack line included", () => {
    const rows = kitRowsFor(plan());
    expect(rows.map((r) => r.part.sku)).toEqual([
      skuOf("arduino_nano"),
      skuOf("tp4056_usbc"),
      skuOf("soil_moisture_cap"),
      skuOf("pump_5v"),
      skuOf("led_5mm", "red"),
      skuOf("mosfet_module"), // was dropped: "Added for you"
      skuOf("boost_5v"), // was dropped: "Added for you"
    ]);
    // The live run added three (QAR 47) of these seven (QAR 81).
    expect(rows).toHaveLength(7);
  });

  it("buys one pack of 5 for the line that needs one LED", () => {
    const led = plan().rows.find((r) => r.product.sku === skuOf("led_5mm", "red"))!;
    expect({ need: led.need, packSize: led.packSize, quantity: led.quantity, lineTotal: led.lineTotal }).toEqual({
      need: 1,
      packSize: 5,
      quantity: 1,
      lineTotal: 1,
    });
  });

  it("buys one listing per piece for the parts sold singly", () => {
    const p = plan();
    expect(p.rows.filter((r) => r.product.sku !== skuOf("led_5mm", "red")).every((r) => r.quantity === r.need)).toBe(true);
    expect(p.goods).toBe(81); // the "Parts total QAR 81.00" the step showed
  });

  it("lists the two parts with no listing instead of dropping them", () => {
    const p = plan();
    expect(p.sourced.map((s) => s.partId)).toEqual(["lipo_1000", "resistor_220"]);
    expect(p.toSource).toBe(2); // "+ 2 parts priced on request"
  });

  it("raises a row to the product's minimum order", () => {
    const products = new Map(PRODUCTS);
    const sku = skuOf("pump_5v");
    products.set(sku, { ...products.get(sku)!, min_order_qty: 3 });
    const pump = studioKitPlan(PLANT_WATERER_KIT, products, getPart).rows.find((r) => r.product.sku === sku)!;
    expect(pump.quantity).toBe(3);
  });

  it("sums identical parts onto one row and packs them together", () => {
    const three = [comp("led_5mm", 1, { variant: "red" }), comp("led_5mm", 2, { variant: "red" }), comp("led_5mm", 3, { variant: "red" })];
    const rows = studioKitPlan([...three, comp("led_5mm", 4, { variant: "red", auto: true })], PRODUCTS, getPart).rows;
    // Four pieces (one of them a helper) out of a pack of 5 = one pack, one row.
    expect(rows).toHaveLength(1);
    expect({ need: rows[0]!.need, quantity: rows[0]!.quantity }).toEqual({ need: 4, quantity: 1 });
  });

  it("plans nothing while the prices are still loading", () => {
    const p = studioKitPlan(PLANT_WATERER_KIT, new Map(), getPart);
    expect(p.rows).toEqual([]);
    expect(p.toSource).toBe(9);
    expect(p.goods).toBe(0);
  });
});

describe("F-006 the toast counts the rows that were written", () => {
  it("counts the written rows, not the list we meant to add", () => {
    const p = plan();
    const rows = kitRowsFor(p);
    expect(addedCounts(rows, p)).toEqual({ added: 7, sourced: 2 });
    expect(addedCounts(rows, p).added).toBe(rows.length);
    expect(addedToCartLine(7, 2, "en")).toBe("Added 7 parts · 2 we'll source");
    expect(addedToCartLine(7, 2, "ar")).toBe("أضفنا 7 قطع · 2 سنوفّرها لك");
  });

  it("says nothing about sourcing when every part is stocked", () => {
    expect(addedToCartLine(3, 0, "en")).toBe("Added 3 parts");
    expect(addedToCartLine(1, 0, "en")).toBe("Added 1 part");
    expect(addedToCartLine(1, 0, "ar")).toBe("أضفنا قطعة واحدة");
    expect(addedToCartLine(2, 0, "ar")).toBe("أضفنا قطعتين");
    expect(addedToCartLine(12, 1, "ar")).toBe("أضفنا 12 قطعة · 1 سنوفّرها لك");
  });
});
