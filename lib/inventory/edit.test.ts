import { describe, expect, it } from "vitest";

import { inventoryEdit, parseInventoryQuantity } from "./edit";

describe("parseInventoryQuantity", () => {
  it("accepts whole numbers from 1", () => {
    expect(parseInventoryQuantity("5")).toBe(5);
    expect(parseInventoryQuantity(" 12 ")).toBe(12);
  });
  it("rejects zero (delete is its own button), negatives, decimals and text", () => {
    for (const bad of ["0", "-3", "2.5", "", "abc", "1e3", "100001"]) expect(parseInventoryQuantity(bad)).toBeNull();
  });
});

describe("inventoryEdit", () => {
  it("a store item only edits its quantity", () => {
    expect(inventoryEdit({ name: "", quantity: "4" }, { custom: false })).toEqual({ ok: true, quantity: 4, name: null });
  });
  it("a custom item needs a name too, trimmed", () => {
    expect(inventoryEdit({ name: "  M3 screws ", quantity: "40" }, { custom: true })).toEqual({ ok: true, quantity: 40, name: "M3 screws" });
    expect(inventoryEdit({ name: "  ", quantity: "40" }, { custom: true })).toEqual({ ok: false, error: "name" });
  });
  it("a bad quantity is reported first", () => {
    expect(inventoryEdit({ name: "", quantity: "0" }, { custom: true })).toEqual({ ok: false, error: "quantity" });
  });
});
