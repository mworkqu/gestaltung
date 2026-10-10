import { describe, expect, it } from "vitest";

import type { StoreCardPart } from "./catalog";
import {
  functionCategoriesOf,
  isRelevantSuggestion,
  MIN_ALSO_USEFUL,
  projectFunctionCategories,
  relevantAlsoUseful,
} from "./also-useful-relevance";

const card = (sku: string, name: string, lead: StoreCardPart["lead_time_class"] = "in_stock"): StoreCardPart => ({
  id: sku,
  sku,
  name,
  name_ar: null,
  unit_price: 10,
  image_url: null,
  category: "Sensors",
  min_order_qty: 1,
  lead_time_class: lead,
});

// A desk lamp that turns on when you sit down.
const lampLines = [
  { function: "PIR motion sensor", spec: "3.3 V digital" },
  { function: "relay module", spec: "5 V, switches the lamp" },
  { function: "LED lamp", spec: "5 V" },
  { function: "ESP32 development board", spec: "" },
  { function: "USB power adapter", spec: "5 V 2 A" },
  { function: "jumper wires", spec: "male to female" },
  { function: "solder", spec: "consumable" },
];

describe("project function categories", () => {
  it("reads the lamp's own words", () => {
    const c = projectFunctionCategories(lampLines);
    for (const k of ["sensing", "switching", "lighting", "controller", "power", "wiring"] as const) expect(c.has(k)).toBe(true);
    expect(c.has("motion")).toBe(false);
    expect(c.has("vision")).toBe(false);
  });

  it("never treats a solder consumable as a reason to suggest tools", () => {
    expect(projectFunctionCategories(lampLines).has("tools")).toBe(false);
  });
});

describe("isRelevantSuggestion: no camera, soldering iron, servo or stepper for a desk lamp", () => {
  const project = projectFunctionCategories(lampLines);
  const ok = (name: string) => isRelevantSuggestion({ name, name_ar: null }, project);

  it("suggests things that share a function with the lamp", () => {
    expect(ok("Ambient light sensor module")).toBe(true);
    expect(ok("USB-C power cable 1 m")).toBe(true);
    expect(ok("Dupont jumper wires 40 pcs")).toBe(true);
    expect(ok("5 V power adapter 2 A")).toBe(true);
    expect(ok("Logic level converter 4 channel")).toBe(true);
  });

  it("drops the ones that do not", () => {
    expect(ok("ESP32-CAM camera module")).toBe(false);
    expect(ok("Soldering iron 60 W")).toBe(false);
    expect(ok("SG90 micro servo")).toBe(false);
    expect(ok("NEMA 17 stepper motor")).toBe(false);
    expect(ok("A4988 stepper motor driver")).toBe(false);
    expect(ok("Digital multimeter")).toBe(false);
  });

  it("a name that says nothing recognisable is not suggested", () => {
    expect(ok("Mystery item 42")).toBe(false);
  });

  it("a tool stays a tool even when its name also names a lamp thing", () => {
    expect(ok("Soldering iron kit with LED light")).toBe(false);
  });

  it("allows a motor suggestion only when the project moves something", () => {
    const fan = projectFunctionCategories([
      { function: "small fan", spec: "5 V" },
      { function: "relay", spec: "" },
    ]);
    expect(isRelevantSuggestion({ name: "5 V mini fan", name_ar: null }, fan)).toBe(true);
    expect(isRelevantSuggestion({ name: "ESP32-CAM camera", name_ar: null }, fan)).toBe(false);
  });
});

describe("relevantAlsoUseful", () => {
  const pool = [
    card("A", "ESP32-CAM camera module"),
    card("B", "Ambient light sensor module", "3_5_days"),
    card("C", "Soldering iron 60 W"),
    card("D", "Dupont jumper wires 40 pcs"),
    card("E", "SG90 micro servo"),
    card("F", "USB-C power cable"),
    card("G", "On the BOM already"),
  ];

  it("keeps only relevant products, in stock first, at most three", () => {
    const out = relevantAlsoUseful({ pool, excludeSkus: ["G"], lines: lampLines });
    expect(out.map((p) => p.sku)).toEqual(["D", "F", "B"]);
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("excludes what is already on the list", () => {
    const out = relevantAlsoUseful({ pool, excludeSkus: ["D"], lines: lampLines });
    expect(out.map((p) => p.sku)).not.toContain("D");
  });

  it("hides the whole block when fewer than two are relevant", () => {
    const small = [card("A", "ESP32-CAM camera module"), card("B", "Ambient light sensor module"), card("E", "SG90 micro servo")];
    expect(MIN_ALSO_USEFUL).toBe(2);
    expect(relevantAlsoUseful({ pool: small, excludeSkus: [], lines: lampLines })).toEqual([]);
  });

  it("returns nothing when the project says nothing about its function", () => {
    expect(relevantAlsoUseful({ pool, excludeSkus: [], lines: [] })).toEqual([]);
  });

  it("recognises a motor by its name", () => {
    expect(functionCategoriesOf("SG90 servo").has("motion")).toBe(true);
  });
});
