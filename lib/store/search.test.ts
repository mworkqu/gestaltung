import { describe, expect, it } from "vitest";

import {
  categoryWeight,
  compareByName,
  compareByPriceAsc,
  compareByPriceDesc,
  DEFAULT_CATEGORY_WEIGHT,
  normalizeText,
  queryWords,
  rankProducts,
  scoreProduct,
  sortProducts,
  type SearchableProduct,
} from "@/lib/store/search";

const p = (id: string, name: string, category: string, unit_price = 10, extra: Partial<SearchableProduct> = {}): SearchableProduct => ({
  id,
  name,
  sku: `VLT-${id}`,
  category,
  unit_price,
  ...extra,
});

// What the database returns for "esp32" (every row matched somewhere,
// some only in the description), in an unhelpful order.
const FIXTURE: SearchableProduct[] = [
  p("1", "2-pin jumper wire for ESP32", "Prototyping", 2),
  p("2", "Laser module (ESP32 compatible)", "Modules", 9),
  p("3", "Arduino Uno R3", "Microcontrollers", 45),
  p("4", "ESP32-CAM WiFi Bluetooth Camera Module", "Modules", 38),
  p("5", "Breadboard 830 points", "Prototyping", 12),
  p("6", "ESP32 Development Board (30 pin)", "Microcontrollers", 42, { name_ar: "لوحة تطوير ESP32" }),
  p("7", "USB cable for ESP32 boards", "Cables and connectors", 8),
];

const ids = (list: SearchableProduct[]) => list.map((x) => x.id);

describe("rankProducts — esp32", () => {
  it("lists ESP32 boards and modules before the jumper wire and the laser module", () => {
    const ranked = ids(rankProducts("esp32", FIXTURE));
    expect(ranked.slice(0, 2)).toEqual(["6", "4"]);
    expect(ranked.indexOf("6")).toBeLessThan(ranked.indexOf("1"));
    expect(ranked.indexOf("6")).toBeLessThan(ranked.indexOf("2"));
    expect(ranked.indexOf("4")).toBeLessThan(ranked.indexOf("1"));
    expect(ranked.indexOf("4")).toBeLessThan(ranked.indexOf("2"));
    // Names that only mention ESP32 still beat products that never say it.
    expect(ranked.indexOf("1")).toBeLessThan(ranked.indexOf("3"));
    expect(ranked.slice(-2).sort()).toEqual(["3", "5"]);
  });

  it("is case- and spacing-insensitive", () => {
    expect(ids(rankProducts("  ESP32 ", FIXTURE)).slice(0, 2)).toEqual(["6", "4"]);
  });

  it("puts the module first when every query word is in its name", () => {
    expect(ids(rankProducts("esp32 cam", FIXTURE))[0]).toBe("4");
  });

  it("ranks a board above a cable for the same title match (category weight)", () => {
    const board = p("b", "ESP32 board", "Boards and microcontrollers");
    const cable = p("c", "ESP32 board", "Cables and connectors");
    expect(ids(rankProducts("esp32", [cable, board]))).toEqual(["b", "c"]);
  });

  it("exact word beats prefix beats substring", () => {
    const exact = scoreProduct("led", p("a", "LED 5mm red", "Components"));
    const prefix = scoreProduct("led", p("b", "LEDs assorted", "Components"));
    const sub = scoreProduct("led", p("c", "Bi-colorled strip", "Components"));
    expect(exact).toBeGreaterThan(sub);
    expect(prefix).toBeGreaterThan(sub);
  });

  it("all words in the title beats some words in the title", () => {
    const all = scoreProduct("ultrasonic sensor", p("a", "HC-SR04 ultrasonic sensor", "Other"));
    const some = scoreProduct("ultrasonic sensor", p("b", "Sensor shield", "Sensors"));
    expect(all).toBeGreaterThan(some);
  });

  it("treats the SKU as the strongest match", () => {
    const list = [p("x", "ESP32 board", "Microcontrollers"), { ...p("y", "Relay", "Modules"), sku: "VLT-123" }];
    expect(ids(rankProducts("vlt-123", list))[0]).toBe("y");
  });

  it("matches the Arabic name too", () => {
    const ar = p("a", "Soil moisture probe", "Sensors", 5, { name_ar: "حساس رطوبة التربة" });
    const other = p("b", "Water pump", "Motors", 5, { name_ar: "مضخة ماء" });
    expect(ids(rankProducts("حساس", [other, ar]))[0]).toBe("a");
    expect(scoreProduct("الحساس", ar)).toBeGreaterThan(scoreProduct("الحساس", other));
  });

  it("keeps ESP32 boards first with the nine store categories (C5)", () => {
    const nine: SearchableProduct[] = [
      p("1", "2-pin jumper wire for ESP32", "Cables and connectors", 2),
      p("2", "Laser module (ESP32 compatible)", "Modules", 9),
      p("3", "Arduino Uno R3", "Boards and microcontrollers", 45),
      p("4", "ESP32-CAM WiFi Bluetooth Camera Module", "Modules", 38),
      p("5", "Breadboard 830 points", "Tools and accessories", 12),
      p("6", "ESP32 Development Board (30 pin)", "Boards and microcontrollers", 42),
      p("7", "ESP32 case for 3D printing", "3D printing", 8),
      p("8", "USB cable for ESP32 boards", "Cables and connectors", 8),
    ];
    const ranked = ids(rankProducts("esp32", nine));
    expect(ranked.slice(0, 2)).toEqual(["6", "4"]);
    expect(ranked.indexOf("6")).toBeLessThan(ranked.indexOf("7"));
    expect(ranked.indexOf("6")).toBeLessThan(ranked.indexOf("1"));
    expect(ranked.slice(-2).sort()).toEqual(["3", "5"]);
  });

  it("returns 0 for an empty query", () => {
    expect(scoreProduct("   ", FIXTURE[0])).toBe(0);
  });
});

describe("categoryWeight", () => {
  it("reads today's and the consolidated names, tolerant of & / and / case", () => {
    expect(categoryWeight("Chips & ICs")).toBe(categoryWeight("chips and ics"));
    expect(categoryWeight("Boards and microcontrollers")).toBeGreaterThan(categoryWeight("Cables and connectors"));
    expect(categoryWeight("Microcontrollers")).toBeGreaterThan(categoryWeight("Prototyping"));
    expect(categoryWeight("Modules")).toBeGreaterThan(categoryWeight("Tools and accessories"));
    expect(categoryWeight("3D printing")).toBeGreaterThan(categoryWeight("Cables and connectors"));
    expect(categoryWeight("3D printing")).toBeLessThan(categoryWeight("Boards and microcontrollers"));
  });

  it("gives an unknown or empty category the default weight", () => {
    expect(categoryWeight("Brand new category")).toBe(DEFAULT_CATEGORY_WEIGHT);
    expect(categoryWeight(null)).toBe(DEFAULT_CATEGORY_WEIGHT);
  });
});

describe("normalizeText / queryWords", () => {
  it("folds case, accents, Arabic letter forms and digits", () => {
    expect(normalizeText("Café")).toBe("cafe");
    expect(normalizeText("أحمر")).toBe(normalizeText("احمر"));
    expect(normalizeText("مُستشعِر")).toBe("مستشعر");
    expect(normalizeText("١٢٣")).toBe("123");
  });

  it("splits on punctuation and de-duplicates", () => {
    expect(queryWords("ESP32-CAM esp32")).toEqual(["esp32", "cam"]);
  });
});

describe("sort comparators", () => {
  const list = [
    p("a", "Zeta motor", "Motors", 30),
    p("b", "alpha sensor", "Sensors", 5),
    p("c", "Beta relay", "Modules", 5),
    p("d", "Gamma board", "Microcontrollers", 99.5),
  ];

  it("price low to high, ties by name", () => {
    expect(ids([...list].sort(compareByPriceAsc("en")))).toEqual(["b", "c", "a", "d"]);
  });

  it("price high to low, ties by name", () => {
    expect(ids([...list].sort(compareByPriceDesc("en")))).toEqual(["d", "a", "b", "c"]);
  });

  it("name A–Z ignores case", () => {
    expect(ids([...list].sort(compareByName("en")))).toEqual(["b", "c", "d", "a"]);
  });

  it("sortProducts treats relevance without a query as name A–Z", () => {
    expect(ids(sortProducts(list, "relevance", "", "en"))).toEqual(["b", "c", "d", "a"]);
    expect(ids(sortProducts(list, "price_desc", "x", "en"))).toEqual(["d", "a", "b", "c"]);
  });
});

describe("Arabic / Latin name sorting", () => {
  const list = [
    p("1", "Zeta", "Other", 1),
    p("2", "Motor", "Motors", 1, { name_ar: "محرك" }),
    p("3", "Battery", "Power", 1, { name_ar: "بطارية" }),
    p("4", "alpha", "Other", 1),
    p("5", "Arduino", "Microcontrollers", 1, { name_ar: "أردوينو" }),
  ];

  it("in Arabic sorts by the Arabic name (alphabetical), Latin-only names after", () => {
    expect(ids([...list].sort(compareByName("ar")))).toEqual(["5", "3", "2", "4", "1"]);
  });

  it("in English sorts by the English name regardless of the Arabic one", () => {
    expect(ids([...list].sort(compareByName("en")))).toEqual(["4", "5", "3", "2", "1"]);
  });

  it("is numeric-aware", () => {
    const n = [p("x", "M10 screw", "Fasteners"), p("y", "M2 screw", "Fasteners"), p("z", "M3 screw", "Fasteners")];
    expect(ids(n.sort(compareByName("en")))).toEqual(["y", "z", "x"]);
  });
});
