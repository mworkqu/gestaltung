import { describe, expect, it } from "vitest";

import { packSizeOf, packsFor } from "./pack";

describe("packSizeOf", () => {
  it("uses the stored pack size above 1", () => {
    expect(packSizeOf({ pack_size: 10, name: "Resistor 10 kΩ (pack of 10)" })).toBe(10);
    expect(packSizeOf({ pack_size: 25, name: "Hex nut M3 – 5 Pcs" })).toBe(25);
  });

  it("reads the pack from the name when the stored size is 1 or missing", () => {
    expect(packSizeOf({ pack_size: 1, name: "M3 Stainless Steel Phillips Flat Head Screws – 5 Pcs" })).toBe(5);
    expect(packSizeOf({ pack_size: null, name: "Green 5mm LED – 5.0V 20mA (5 Pack)" })).toBe(5);
    expect(packSizeOf({ name: "Extra Long Jumper Wires - Male to Female (40 Pack)" })).toBe(40);
  });

  it("is 1 for a single item", () => {
    expect(packSizeOf({ pack_size: 1, name: "1 Channel Relay Module" })).toBe(1);
    expect(packSizeOf({ name: "Full-Size Solderless Breadboard – 830 Tie Points" })).toBe(1);
    expect(packSizeOf(null)).toBe(1);
  });
});

describe("packsFor", () => {
  const screws = { pack_size: 1, name: "M3 Screws – 5 Pcs", min_order_qty: 1 };

  it("4 screws in packs of 5 → 1 pack", () => {
    expect(packsFor(4, screws)).toBe(1);
  });

  it("rounds up to whole packs", () => {
    expect(packsFor(5, screws)).toBe(1);
    expect(packsFor(6, screws)).toBe(2);
    expect(packsFor(11, { pack_size: 10, min_order_qty: 1 })).toBe(2);
  });

  it("never goes below the minimum order", () => {
    expect(packsFor(1, { pack_size: 1, min_order_qty: 3 })).toBe(3);
  });

  it("treats a missing or zero need as one piece", () => {
    expect(packsFor(0, { pack_size: 1, min_order_qty: 1 })).toBe(1);
    expect(packsFor(Number.NaN, { pack_size: 1, min_order_qty: 1 })).toBe(1);
  });
});
