import { describe, expect, it } from "vitest";

import { handleFromUrl, parseProducts, pickVariant, planChanges, robotsAllows, type MappedOffer } from "./voltaat";

const ROBOTS = `# Shopify
User-agent: *
Allow: /
Disallow: /cart.js
Disallow: /collections/*sort_by*
Disallow: /checkout
Allow: /products/checkout

User-agent: adsbot-google
Disallow: /products.json
`;

describe("robotsAllows", () => {
  it("allows the catalogue feed and product pages for *", () => {
    expect(robotsAllows(ROBOTS, "/products.json?limit=250&page=1")).toBe(true);
    expect(robotsAllows(ROBOTS, "/products/arduino-uno.json")).toBe(true);
  });
  it("blocks what * disallows, with wildcards", () => {
    expect(robotsAllows(ROBOTS, "/cart.js")).toBe(false);
    expect(robotsAllows(ROBOTS, "/collections/all?sort_by=price")).toBe(false);
    expect(robotsAllows(ROBOTS, "/checkout")).toBe(false);
  });
  it("ignores other bots' groups", () => {
    expect(robotsAllows(ROBOTS, "/products.json")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /products.json", "/products.json?page=1")).toBe(false);
  });
});

describe("handleFromUrl", () => {
  it("reads the handle from a product link", () => {
    expect(handleFromUrl("https://www.voltaat.com/products/Arduino-Uno?variant=5")).toBe("arduino-uno");
    expect(handleFromUrl("https://www.voltaat.com/collections/x")).toBeNull();
  });
});

const product = parseProducts({
  products: [
    {
      handle: "servo",
      title: "Servo",
      variants: [
        { id: 11, sku: "VT-1/A", title: "SG90", price: "19.00", available: true },
        { id: 12, sku: "VT-1/B", title: "MG90S", price: "29.00", available: false },
      ],
    },
  ],
})[0];

describe("pickVariant", () => {
  it("prefers the variant in the URL, then the SKU, never guesses between several", () => {
    expect(pickVariant(product, { supplier_sku: null, supplier_url: "https://www.voltaat.com/products/servo?variant=12" })?.price).toBe(29);
    expect(pickVariant(product, { supplier_sku: "vt-1/a", supplier_url: "https://www.voltaat.com/products/servo" })?.price).toBe(19);
    expect(pickVariant(product, { supplier_sku: null, supplier_url: "https://www.voltaat.com/products/servo" })).toBeNull();
  });
});

describe("planChanges", () => {
  const base: MappedOffer = {
    id: "o1",
    part_id: "p1",
    part_name: "Servo SG90",
    our_price: 18,
    supplier_sku: "VT-1/A",
    supplier_url: "https://www.voltaat.com/products/servo",
    retail_price: 18,
    availability: "in_stock",
    lead_time_days: 1,
  };
  const cat = new Map([["servo", product]]);

  it("reports a price move and leaves unchanged offers alone", () => {
    const { changes, checked } = planChanges([base, { ...base, id: "o2", retail_price: 19 }], cat);
    expect(checked).toBe(2);
    expect(changes).toEqual([
      expect.objectContaining({ offerId: "o1", oldRetail: 18, newRetail: 19, newAvailability: "in_stock", oldOurPrice: 18 }),
    ]);
  });
  it("lists offers it can't follow instead of guessing", () => {
    const { missing } = planChanges(
      [
        { ...base, id: "a", supplier_url: null },
        { ...base, id: "b", supplier_url: "https://www.voltaat.com/products/gone" },
        { ...base, id: "c", supplier_sku: null },
      ],
      cat
    );
    expect(missing.map((m) => m.reason)).toEqual(["no_handle", "not_in_catalogue", "variant_unclear"]);
  });
});
