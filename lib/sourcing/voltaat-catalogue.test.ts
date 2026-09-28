import { describe, expect, it } from "vitest";

import { partKey } from "@/lib/parts/part-key";
import { buildImportRows, categoryFor, stripHtml } from "./voltaat-catalogue";

describe("categoryFor", () => {
  it("maps Voltaat product types to our categories", () => {
    expect(categoryFor("3DP_Filaments", "Bambu PLA")).toBe("3D printing filament");
    expect(categoryFor("DEVEB_ESP", "ESP32 board")).toBe("Microcontrollers");
    expect(categoryFor("MOD_Display_Sound", "OLED")).toBe("Displays");
    expect(categoryFor("MECH_Screws_Inserts", "M3 screws")).toBe("Fasteners");
  });
  it("falls back to the title, then Other", () => {
    expect(categoryFor(null, "Ultrasonic Distance Sensor HC-SR04")).toBe("Sensors");
    expect(categoryFor("", "Gift card")).toBe("Other");
  });
});

describe("stripHtml", () => {
  it("keeps readable text and lists", () => {
    expect(stripHtml("<h3>Description </h3><p>Fast &amp; strong.</p><ul><li>PLA</li><li>1 kg</li></ul>")).toBe("Fast & strong.\n• PLA\n• 1 kg");
  });
});

describe("buildImportRows", () => {
  const products = [
    {
      id: 1,
      handle: "Servo",
      title: "Servo Motor",
      product_type: "Motors_Servos_Stepper",
      images: [{ src: "https://cdn.shopify.com/servo.jpg" }],
      variants: [
        { id: 11, title: "SG90", sku: "VT-1/A", price: "19.00", available: true },
        { id: 12, title: "MG90S", sku: "VT-1/B", price: "29.00", available: false },
      ],
    },
    { id: 2, handle: "servo-copy", title: "Servo Motor", variants: [{ id: 21, title: "SG90", price: "19.00", available: true }] },
    { id: 3, handle: "uno", title: "Arduino Uno", variants: [{ id: 31, title: "Default Title", price: "95.00", available: true }] },
  ];

  it("creates one product per Voltaat product, mirror-priced, and skips repeats and mapped ones", () => {
    const { rows, skippedMapped, skippedDuplicate } = buildImportRows(products, {
      mappedKeys: new Set(["uno|31"]),
      existingPartKeys: new Set(),
      publish: true,
    });
    // Voltaat's "…-copy" listings are separate products with their own names.
    expect(rows.map((r) => r.part.name)).toEqual(["Servo Motor"]);
    expect(skippedMapped).toBe(1);
    expect(skippedDuplicate).toBe(1);
    expect(rows[0].part.description).toContain("Options: SG90, MG90S.");
    expect(rows[0].part).toMatchObject({ sku: "VLT-11", unit_price: 19, pricing_mode: "mirror", category: "Motors", is_published: true });
    expect(rows[0].offer).toMatchObject({ supplier_url: "https://www.voltaat.com/products/servo?variant=11", active: true, lead_time_days: 1 });
  });

  it("follows the first option in stock", () => {
    const { rows } = buildImportRows(
      [{ ...products[0], variants: [{ ...products[0].variants[1] }, { ...products[0].variants[0] }] }],
      { mappedKeys: new Set(), existingPartKeys: new Set(), publish: true }
    );
    expect(rows[0].part.sku).toBe("VLT-11");
    expect(rows[0].offer.active).toBe(true);
  });

  it("never creates a product we already sell under the same name", () => {
    const { rows, skippedDuplicate } = buildImportRows([products[2]], {
      mappedKeys: new Set(),
      existingPartKeys: new Set([partKey("Arduino Uno", null, 1)]),
      publish: true,
    });
    expect(rows).toHaveLength(0);
    expect(skippedDuplicate).toBe(1);
  });
});
