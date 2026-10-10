import { describe, expect, it } from "vitest";

import type { Candidate, LineMatch, ProjectLine, ScoredCandidate } from "./bom";
import type { Netlist } from "./netlist";
import { GROUND_WIRE, netColours, renderWiring, SIGNAL_WIRES, wiringProducts, type WiringProduct } from "./wiring-svg";

const netlist: Netlist = {
  components: [
    {
      ref: "U1",
      function: "Microcontroller",
      bomId: "l-board",
      pins: [
        { id: "vin", name: "VIN", type: "power_in" },
        { id: "gnd", name: "GND", type: "ground" },
        { id: "d2", name: "D2", type: "output" },
      ],
    },
    {
      ref: "D1",
      function: "Status LED",
      bomId: "l-led",
      pins: [
        { id: "a", name: "A", type: "input" },
        { id: "k", name: "K", type: "ground" },
      ],
    },
  ],
  nets: [
    { name: "SIG", connections: [{ ref: "U1", pin: "d2" }, { ref: "D1", pin: "a" }] },
    { name: "GND", connections: [{ ref: "U1", pin: "gnd" }, { ref: "D1", pin: "k" }] },
  ],
  powerRails: [],
  notes: [],
};

const labels = { noPhoto: "No photo", noProduct: "No store product" };

describe("renderWiring (audit #38)", () => {
  it("names the matched product and its sku; 'No store product' only for the other", () => {
    const products = new Map<string, WiringProduct | null>([
      ["l-board", { name: "ESP32 DevKit", href: "/en/store/GR-011", image: null }],
      ["l-led", null],
    ]);
    const svg = renderWiring({ netlist, flags: [], products, labels });
    expect(svg).toContain("ESP32 DevKit");
    expect(svg).toContain(">GR-011</text>");
    expect(svg).toContain('href="/en/store/GR-011"');
    const cards = svg.split("<g>").slice(1);
    const card = (ref: string) => cards.find((c) => c.includes(`>${ref}</text>`)) ?? "";
    expect(card("U1")).toContain("GR-011");
    expect(card("U1")).not.toContain("No store product");
    expect(card("D1")).toContain("No store product");
    expect(card("D1")).not.toContain("GR-");
  });

  it("prefers an explicit sku over the one in the link", () => {
    const products = new Map<string, WiringProduct | null>([
      ["l-board", { name: "ESP32", sku: "GR-012", href: "/en/store/GR-012", image: null }],
    ]);
    expect(renderWiring({ netlist, flags: [], products, labels })).toContain(">GR-012</text>");
  });
});

describe("picture diagram", () => {
  it("gives ground black, each signal its own colour, and lists them in the key", () => {
    const colours = netColours(netlist);
    expect(colours.get("GND")).toBe(GROUND_WIRE);
    expect(colours.get("SIG")).toBe(SIGNAL_WIRES[0]);
    const svg = renderWiring({ netlist, flags: [], products: new Map(), labels: { ...labels, key: "Wire colours" } });
    expect(svg).toContain(`stroke="${SIGNAL_WIRES[0]}"`);
    expect(svg).toContain(">Wire colours</text>");
  });

  it("labels an example photo and never links or names it as the part", () => {
    const products = new Map<string, WiringProduct | null>([
      ["l-led", { name: "Red LED 5 mm", sku: "VLT-1", href: "/en/store/VLT-1", image: "https://cdn.example/led.jpg", example: true }],
    ]);
    const svg = renderWiring({ netlist, flags: [], products, labels: { ...labels, example: "Example photo" } });
    expect(svg).toContain("https://cdn.example/led.jpg");
    expect(svg).toContain(">Example photo</text>");
    expect(svg).not.toContain('href="/en/store/VLT-1"');
    expect(svg).not.toContain("Red LED 5 mm");
  });
});

describe("wiringProducts", () => {
  const esp = {
    id: "p1",
    sku: "GR-011",
    name: "ESP32 DevKit",
    name_ar: "لوحة ESP32",
    image_url: null,
    unit_price: 35,
    strength: "strong",
    why: [],
  } as unknown as ScoredCandidate;

  it("uses the line's product, else a bought line's sku, else null", () => {
    const lines = [
      { id: "a", function: "board" },
      { id: "b", function: "led", fulfilled: { orderId: "o", at: "", productId: "gone", sku: "GR-029", quantity: 1 } },
      { id: "c", function: "diode" },
    ] as ProjectLine[];
    const matches = new Map<string, LineMatch>([
      ["a", { lineId: "a", status: "matched", candidates: [esp], product: esp, have: null }],
      ["b", { lineId: "b", status: "fulfilled", candidates: [], product: null, have: null }],
      ["c", { lineId: "c", status: "choose", candidates: [esp as Candidate as ScoredCandidate], product: null, have: null }],
    ]);
    const map = wiringProducts(lines, matches, "ar");
    expect(map.get("a")).toEqual({ name: "لوحة ESP32", sku: "GR-011", href: "/ar/store/GR-011", image: null });
    expect(map.get("b")).toEqual({ name: "GR-029", sku: "GR-029", href: "/ar/store/GR-029", image: null });
    expect(map.get("c")).toBeNull();
  });
});

describe("renderWiring in plain (client) mode", () => {
  const products = new Map<string, WiringProduct | null>([
    ["l-board", { name: "ESP32 DevKit", sku: "GR-011", href: "/en/store/GR-011", image: null }],
    ["l-led", null],
  ]);
  const svg = renderWiring({
    netlist,
    flags: [],
    products,
    labels: { noPhoto: "No photo yet", noProduct: "We'll pick this part for you", key: "Wires" },
    plain: {
      component: (ref) => (ref === "U1" ? "Main board" : "Status light"),
      pin: (_r, _p, type) => (type === "ground" ? "Ground" : type === "power_in" ? "Power" : "Signal"),
      net: (name) => (name === "GND" ? "Ground" : "Signal · Status light"),
    },
  });

  it("shows plain words and none of the engineering ones", () => {
    expect(svg).toContain(">Main board</text>");
    expect(svg).toContain(">Status light</text>");
    expect(svg).toContain("ESP32 DevKit");
    expect(svg).toContain("Signal · Status light");
    expect(svg).not.toContain(">U1");
    expect(svg).not.toContain(">D1");
    expect(svg).not.toContain("GR-011</text>");
    expect(svg).not.toContain(">VIN<");
    expect(svg).not.toContain(">SIG<");
    expect(svg).not.toContain("Microcontroller");
  });

  it("keeps the engineer picture as it was", () => {
    const eng = renderWiring({ netlist, flags: [], products, labels });
    expect(eng).toContain(">U1</text>");
    expect(eng).toContain(">GR-011</text>");
  });
});
