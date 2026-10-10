import { describe, expect, it } from "vitest";

import { DEFAULT_SERVICE_PRICES } from "./defaults";
import { drawingTiers } from "./service-tiers";

describe("drawingTiers", () => {
  it("reads the three tiers from service_prices", () => {
    expect(drawingTiers(DEFAULT_SERVICE_PRICES)).toEqual([
      { id: "simple", price: 200, from: false },
      { id: "assembly", price: 450, from: false },
      { id: "complex", price: 800, from: true },
    ]);
  });
  it("follows an owner edit", () => {
    const t = drawingTiers({ ...DEFAULT_SERVICE_PRICES, drawing_simple: 250 });
    expect(t[0].price).toBe(250);
  });
});
