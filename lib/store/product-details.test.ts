import { describe, expect, it } from "vitest";

import { productDetailsForLocale, specRows } from "./product-details";

const english = {
  name: "ESP32 DevKit",
  name_ar: "لوحة تطوير ESP32",
  description: [
    "ESP32 DevKit",
    "A Wi-Fi and Bluetooth board for IoT projects.",
    "",
    "Specifications:",
    "• Operating voltage: 3.3V",
    "• Flash: 4 MB",
    "",
    "Links",
    "• 3D model",
    "• Datasheet https://example.com/esp32.pdf",
  ].join("\n"),
};

describe("productDetailsForLocale", () => {
  it("en is unchanged: tidied description, spec bullets, links", () => {
    const d = productDetailsForLocale({ ...english, description_ar: "نص", specs_ar: [{ name: "x", value: "y" }] }, "en");
    expect(d.description).toBe("A Wi-Fi and Bluetooth board for IoT projects.");
    expect(d.specs).toEqual([
      { name: "Operating voltage", value: "3.3V" },
      { name: "Flash", value: "4 MB" },
    ]);
    expect(d.links).toEqual([{ label: "Datasheet", url: "https://example.com/esp32.pdf" }]);
    expect(d.plainDescription).toBe("A Wi-Fi and Bluetooth board for IoT projects.");
    expect(d.untranslated).toEqual({ description: false, specs: false });
  });

  it("en prefers the stored supplier table", () => {
    const d = productDetailsForLocale({ name: "R", description: "A resistor.", specs: [{ name: "Resistance", value: "10 kΩ" }] }, "en");
    expect(d.specs).toEqual([{ name: "Resistance", value: "10 kΩ" }]);
    expect(d.description).toBe("A resistor.");
  });

  it("ar with full Arabic shows only Arabic", () => {
    const d = productDetailsForLocale(
      {
        ...english,
        description_ar: "لوحة تطوير ESP32\nلوحة Wi-Fi وBluetooth لمشاريع إنترنت الأشياء.",
        specs_ar: [
          { name: "جهد التشغيل", value: "3.3V" },
          { name: "الذاكرة", value: "4 MB" },
        ],
      },
      "ar"
    );
    // The Arabic title line repeats the H1 and is dropped.
    expect(d.description).toBe("لوحة Wi-Fi وBluetooth لمشاريع إنترنت الأشياء.");
    expect(d.specs).toEqual([
      { name: "جهد التشغيل", value: "3.3V" },
      { name: "الذاكرة", value: "4 MB" },
    ]);
    expect(d.links).toEqual([{ label: "example.com", url: "https://example.com/esp32.pdf" }]);
    expect(d.plainDescription).toBe("لوحة Wi-Fi وBluetooth لمشاريع إنترنت الأشياء.");
    expect(d.untranslated).toEqual({ description: false, specs: false });
  });

  it("ar with a description only hides the English specs", () => {
    const d = productDetailsForLocale({ ...english, description_ar: "لوحة لمشاريع إنترنت الأشياء." }, "ar");
    expect(d.description).toBe("لوحة لمشاريع إنترنت الأشياء.");
    expect(d.specs).toEqual([]);
    expect(d.untranslated).toEqual({ description: false, specs: true });
  });

  it("ar with nothing shows no English at all", () => {
    const d = productDetailsForLocale(english, "ar");
    expect(d.description).toBeNull();
    expect(d.specs).toEqual([]);
    expect(d.plainDescription).toBeNull();
    expect(d.untranslated).toEqual({ description: true, specs: true });
    const shown = JSON.stringify([d.description, d.specs, d.links.map((l) => l.label)]);
    expect(shown).not.toMatch(/Operating|Wi-Fi|Datasheet|IoT/);
  });

  it("ar with no English source has nothing to flag", () => {
    const d = productDetailsForLocale({ name: "Bolt", description: null }, "ar");
    expect(d.untranslated).toEqual({ description: false, specs: false });
  });
});

describe("specRows", () => {
  it("keeps only valid {name, value} rows", () => {
    expect(specRows([{ name: " A ", value: "1" }, { name: "", value: "2" }, null, { name: "B" }, "x"])).toEqual([{ name: "A", value: "1" }]);
    expect(specRows(null)).toEqual([]);
  });
});
