import { describe, expect, it } from "vitest";

import type { Candidate, LineMatch, ProjectLine } from "./bom";
import { matchLine, packExceedsNeed, packLineCount, weakSuggestion } from "./bom-match";

let n = 0;
function part(over: Partial<Candidate>): Candidate {
  n += 1;
  return {
    id: `p${n}`,
    sku: `GR-${String(n).padStart(3, "0")}`,
    name: "Part",
    name_ar: null,
    description: null,
    description_ar: null,
    category: "Diodes",
    material: null,
    standard: null,
    unit_price: 1,
    min_order_qty: 1,
    stock_status: "in_stock",
    image_url: null,
    is_published: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    attributes: null,
    pack_size: 1,
    ...over,
  };
}

const flyback: ProjectLine = {
  id: "d1",
  function: "Flyback diode",
  spec: "rectifier, 1 A, 400 V+",
  quantity: 1,
  kind: "electronics",
  critical: false,
  class: "diode",
  attributes: { diode_type: "rectifier", current_a: 1, voltage_v: 400 },
};

const match = (line: ProjectLine, catalogue: Candidate[]) => matchLine(line, catalogue, [], new Map());

describe("matchLine — diodes (audit #2)", () => {
  // A diode whose name states no type: a weak candidate, never picked for the client.
  const untypedDiode = part({ name: "Diode, general purpose", unit_price: 30, pack_size: 100 });
  const untyped4148 = part({ name: "Diode 1N4148", unit_price: 30, pack_size: 100 });
  const rectifier4007 = part({
    name: "Diode 1N4007",
    attributes: { class: "diode", diode_type: "rectifier", current_a: 1, voltage_v: 1000 },
  });
  const signal4148 = part({
    name: "Diode 1N4148",
    attributes: { class: "diode", diode_type: "signal", current_a: 0.2, voltage_v: 100 },
  });

  it("a diode of unstated type is weak and never pre-selected: the line waits (We'll pick this part for you)", () => {
    const m = match(flyback, [untypedDiode]);
    expect(m.candidates.map((c) => [c.id, c.strength])).toEqual([[untypedDiode.id, "weak"]]);
    expect(m.product).toBeNull();
    expect(m.status).toBe("choose");
    expect(weakSuggestion(m)?.id).toBe(untypedDiode.id);
  });

  it("an untyped 1N4148 is read as a signal diode from its name and is no flyback rectifier", () => {
    const m = match(flyback, [untyped4148]);
    expect(m.candidates).toEqual([]);
    expect(m.status).toBe("not_stocked");
  });

  it("a typed rectifier 1N4007, 1 A 1000 V, is a strong match and resolves the line", () => {
    const m = match(flyback, [rectifier4007, untyped4148]);
    expect(m.product?.id).toBe(rectifier4007.id);
    expect(m.product?.strength).toBe("strong");
    expect(m.status).toBe("matched");
    expect(weakSuggestion(m)).toBeNull();
  });

  it("a typed signal 1N4148 is excluded", () => {
    const m = match(flyback, [signal4148]);
    expect(m.candidates).toEqual([]);
    expect(m.status).toBe("not_stocked");
  });

  it("a rectifier rated below the line's current or voltage is excluded", () => {
    const small = part({ attributes: { class: "diode", diode_type: "rectifier", current_a: 0.2, voltage_v: 1000 } });
    const lowV = part({ attributes: { class: "diode", diode_type: "rectifier", current_a: 1, voltage_v: 100 } });
    expect(match(flyback, [small, lowV]).candidates).toEqual([]);
  });

  it("a rectifier with no ratings on the product is weak, not strong", () => {
    const bare = part({ attributes: { class: "diode", diode_type: "rectifier" } });
    const m = match(flyback, [bare]);
    expect(m.candidates[0]?.strength).toBe("weak");
    expect(m.product).toBeNull();
    expect(m.status).toBe("choose");
  });

  it("the client's explicit pick of the suggestion resolves the line", () => {
    const m = match({ ...flyback, choice: untypedDiode.id }, [untypedDiode]);
    expect(m.product?.id).toBe(untypedDiode.id);
    expect(m.auto).toBeUndefined();
    expect(m.status).toBe("matched");
    expect(weakSuggestion(m)).toBeNull();
  });
});

describe("pack sizes", () => {
  it("packExceedsNeed: need 1 of a pack of 100 is over; exact packs or single units are not", () => {
    expect(packExceedsNeed(1, { pack_size: 100, min_order_qty: 1 })).toBe(true);
    expect(packExceedsNeed(100, { pack_size: 100, min_order_qty: 1 })).toBe(false);
    expect(packExceedsNeed(3, { pack_size: 1, min_order_qty: 1 })).toBe(false);
    expect(packExceedsNeed(12, { pack_size: 10, min_order_qty: 1 })).toBe(true);
  });

  it("packLineCount counts only lines in 'to buy now'", () => {
    const pack = { ...part({ pack_size: 100 }), strength: "strong" as const, why: [] };
    const lines: ProjectLine[] = [
      { ...flyback, id: "a" },
      { ...flyback, id: "b", fulfilled: { orderId: "o", at: "", productId: pack.id, sku: pack.sku, quantity: 1 } },
      { ...flyback, id: "c" },
      { ...flyback, id: "d" },
    ];
    const m = (lineId: string, over: Partial<LineMatch>): [string, LineMatch] => [
      lineId,
      { lineId, status: "matched", candidates: [pack], product: pack, have: null, ...over },
    ];
    const matches = new Map([
      m("a", {}),
      m("b", { status: "fulfilled" }),
      m("c", { have: { name: "x", quantity: 5 }, status: "have" }),
      m("d", { status: "choose", product: null }),
    ]);
    expect(packLineCount(lines, matches)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Regressions found on the demo project (2026-10-10): accessories won over the
// device. Candidates are modelled on live product names (parts.name, category,
// store_category; the live catalogue has no attributes yet, so every match is
// text). The guard lives in bom-intent.ts.
// ---------------------------------------------------------------------------

const live = (name: string, category: string, store: string, price = 10, over: Partial<Candidate> = {}): Candidate =>
  part({ name, category, unit_price: price, ...over, ...({ store_category: store } as Partial<Candidate>) });

const line = (over: Partial<ProjectLine>): ProjectLine => ({
  id: "l",
  function: "",
  spec: "",
  quantity: 1,
  kind: "electronics",
  critical: false,
  ...over,
});

const names = (m: LineMatch) => m.candidates.map((c) => c.name);

describe("matchLine — the device, not its accessory (demo project)", () => {
  describe("ESP32", () => {
    const BOARDS = "Boards and microcontrollers";
    const catalogue = [
      live("NodeMCU ESP32 I/O Expansion Shield", "Microcontrollers", "Modules", 15),
      live("DOIT ESP32 DevKit I/O Expansion Shield", "Microcontrollers", "Modules", 15),
      live("NodeMCU ESP32 Screw Terminal Expansion Board", "Microcontrollers", "Modules", 15),
      live("ESP32-CAM USB Programmer Board – USB to UART Interface", "Microcontrollers", "Modules", 19),
      live("ESP32-WROOM-32E Wi-Fi & Bluetooth Module", "Microcontrollers", BOARDS, 17),
      live("Beetle ESP32-C6 Mini Development Board", "Microcontrollers", BOARDS, 29),
      live("NodeMCU ESP32 Development Board – Wi-Fi & Bluetooth Enabled", "Microcontrollers", BOARDS, 39),
      live("Heltec ESP32 LoRa 32 V4 Development Board with OLED Display", "Microcontrollers", BOARDS, 159),
    ];
    const lines = {
      typed: line({
        function: "ESP32",
        spec: "Wi-Fi and Bluetooth microcontroller, 3.3 V",
        class: "board",
        attributes: { platform: "esp32", logic_v: 3.3 },
      }),
      untyped: line({ function: "ESP32", spec: "Wi-Fi microcontroller board" }),
    };

    for (const [kind, l] of Object.entries(lines)) {
      it(`${kind} line: no shield, expansion board or programmer is a candidate`, () => {
        const m = match(l, catalogue);
        expect(names(m).length).toBeGreaterThan(0);
        for (const n of names(m)) expect(n).not.toMatch(/shield|expansion|programmer/i);
      });

      it(`${kind} line: our pick is a plain ESP32 development board`, () => {
        const m = match(l, catalogue);
        expect(m.product?.name).toBe("NodeMCU ESP32 Development Board – Wi-Fi & Bluetooth Enabled");
        expect(m.product?.strength).toBe("strong");
      });
    }

    it("a line that asks for the shield still gets the shield", () => {
      const m = match(line({ function: "ESP32 expansion shield", spec: "I/O breakout" }), catalogue);
      expect(names(m).some((n) => /expansion shield/i.test(n))).toBe(true);
    });

    it("only accessories in stock: not stocked, never an accessory standing in", () => {
      const m = match(lines.typed, catalogue.slice(0, 4));
      expect(m.candidates).toEqual([]);
      expect(m.status).toBe("not_stocked");
    });
  });

  describe("USB adapter / plug-in adapter", () => {
    const POWER = "Power";
    const catalogue = [
      live("DC Jack Socket Female Connector – 2.1mm (2 Pieces)", "Components", "Cables and connectors", 1),
      live("DC Jack Socket Female – 5.5mm jack and 2.1mm center pole diameter", "Components", "Cables and connectors", 1),
      live("DC Barrel Jack Adapter – 5.5 × 2.1 mm Male Plug", "Components", "Cables and connectors", 4),
      live("USB Type-A Male to 4-Pin DIP Breakout Adapter", "Components", "Cables and connectors", 3),
      live("M.2 NVME SSD to USB Adapter", "Power", "Modules", 49),
      live("9V Battery Adapter Clip – Snap Connector with Wire Leads", "Power", POWER, 3),
      live("Generic 12V 3A AC/DC Power Adapter UK Plug", "Power", POWER, 35),
      live("Generic 5V 3A AC/DC Power Adapter EU Plug", "Power", POWER, 35),
      live("Raspberry Pi 5 USB-C Power Adapter – 27W Official Supply", "Raspberry Pi", POWER, 49),
    ];
    const lines = {
      typed: line({
        function: "USB adapter / plug-in adapter",
        spec: "5 V, 2 A, powers the board",
        class: "power",
        attributes: { power_type: "adapter", voltage_v: 5 },
      }),
      untyped: line({ function: "USB adapter / plug-in adapter", spec: "5 V, 2 A" }),
    };

    for (const [kind, l] of Object.entries(lines)) {
      it(`${kind} line: a DC jack, socket, breakout or clip is never a candidate`, () => {
        const m = match(l, catalogue);
        expect(names(m).length).toBeGreaterThan(0);
        for (const n of names(m)) expect(n).not.toMatch(/jack|socket|barrel|breakout|dip|clip|ssd/i);
      });

      it(`${kind} line: our pick is a power adapter at 5 V`, () => {
        const m = match(l, catalogue);
        expect(m.product?.name).toMatch(/Power Adapter/);
        expect(m.product?.name).not.toMatch(/12V/);
      });
    }

    it("a line that asks for a DC jack socket still gets one", () => {
      const m = match(line({ function: "DC jack socket", spec: "2.1 mm" }), catalogue);
      expect(names(m).some((n) => /jack socket/i.test(n))).toBe(true);
    });
  });

  describe("USB cable", () => {
    const catalogue = [
      live("USB Type-B Female Connector – Through-Hole PCB Mount", "Components", "Cables and connectors", 2),
      live("5 Pin Micro USB Type B Male Plug Connector", "Components", "Cables and connectors", 4),
      live("USB Type-C Male Breakout Board – USB 3.1 Connector Adapter", "Components", "Cables and connectors", 14),
      live("Alligator Clip to USB Male Power Cable – 40cm", "Components", "Cables and connectors", 5),
      live("USB 2.0 Type-A to Micro USB Cable – 1 m", "Components", "Cables and connectors", 9),
      live("USB Type-A to USB Type-C Cable – 1m White", "Components", "Cables and connectors", 9),
    ];

    it("a typed USB cable line never lists a socket, connector or breakout", () => {
      const l = line({
        function: "USB cable",
        spec: "powers the board",
        kind: "consumable",
        class: "consumable",
        attributes: { consumable_type: "usb_cable" },
      });
      const m = match(l, catalogue);
      expect(names(m).length).toBeGreaterThan(0);
      for (const n of names(m)) expect(n).toMatch(/Cable/);
    });

    it("with no connector named the client chooses: shown, never auto-picked", () => {
      const m = match(line({ function: "USB cable", spec: "", kind: "consumable" }), catalogue);
      expect(m.status).toBe("choose");
      expect(m.product).toBeNull();
      expect(m.auto).toBeUndefined();
      expect(m.candidates.length).toBeGreaterThan(0);
      for (const c of m.candidates) expect(c.doubt).toBe(true);
    });

    it("naming the connector lets us pick it", () => {
      const m = match(line({ function: "Micro USB cable", spec: "", kind: "consumable" }), catalogue);
      expect(m.product?.name).toBe("USB 2.0 Type-A to Micro USB Cable – 1 m");
    });
  });

  describe("M3 screws", () => {
    const catalogue = [
      live("M3 Brass Spacer Kit – 120pcs Female-Female & Male-Female Set", "Fasteners", "Motors and mechanical", 59),
      live("M3 Nylon Screws Nuts And Standoffs Kit – 180 Pieces", "Fasteners", "Motors and mechanical", 29),
      live("Hex nut M3, stainless steel (pack of 10)", "Fasteners", "Motors and mechanical", 74.5, { pack_size: 10 }),
      live("M4 Stainless Steel Phillips Flat Head Screws – 5 Pcs", "Fasteners", "Motors and mechanical", 1),
      live("M3 Knob Spring Heated Bed Leveling Kit", "3D printer parts", "3D printing", 7),
      live("Stainless Steel Hex Socket Screw Kit – M2 M3 M4 M5 Assortment 880 Pcs", "Fasteners", "Motors and mechanical", 75),
      live("M3 Stainless Steel Phillips Flat Head Screws – 5 Pcs", "Fasteners", "Motors and mechanical", 1),
    ];
    const lines = {
      typed: line({
        function: "M3 screws",
        spec: "M3 x 8 mm, stainless",
        kind: "mechanical",
        quantity: 4,
        class: "fastener",
        attributes: { fastener_type: "screw", thread: "M3", length_mm: 8 },
      }),
      untyped: line({ function: "M3 screws", spec: "M3 x 8 mm", kind: "mechanical", quantity: 4 }),
    };

    for (const [kind, l] of Object.entries(lines)) {
      it(`${kind} line: a spacer, standoff, nut or bed-leveling kit is not a screw`, () => {
        const m = match(l, catalogue);
        for (const n of names(m)) expect(n).not.toMatch(/spacer|standoff|nut|leveling/i);
      });

      it(`${kind} line: the best candidate is the single M3 screw, not the QAR 59 spacer kit`, () => {
        const m = match(l, catalogue);
        expect(m.candidates[0]?.name).toBe("M3 Stainless Steel Phillips Flat Head Screws – 5 Pcs");
        // The typed line also asks for 8 mm, which the name does not state: weak, so not pre-selected.
        if (kind === "typed") expect(m.product).toBeNull();
        else expect(m.product?.name).toBe("M3 Stainless Steel Phillips Flat Head Screws – 5 Pcs");
      });

      it(`${kind} line: the wrong size is not a candidate`, () => {
        expect(names(match(l, catalogue)).join("|")).not.toMatch(/M4 Stainless/);
      });
    }

    it("an assortment kit is offered but never auto-picked when it is all there is", () => {
      const m = match(lines.typed, [catalogue[5]]);
      expect(m.candidates).toHaveLength(1);
      expect(m.candidates[0].doubt).toBe(true);
      expect(m.auto).toBeUndefined();
      expect(m.product).toBeNull();
      expect(m.status).toBe("choose");
    });

    it("a line that asks for standoffs gets the spacer kit", () => {
      const m = match(
        line({
          function: "M3 standoffs",
          spec: "M3, brass",
          kind: "mechanical",
          class: "fastener",
          attributes: { fastener_type: "standoff", thread: "M3" },
        }),
        catalogue,
      );
      expect(names(m)).toContain("M3 Brass Spacer Kit – 120pcs Female-Female & Male-Female Set");
    });
  });

  describe("relay module", () => {
    const catalogue = [
      live("L293D Motor Driver Shield – Dual H-Bridge for Arduino", "Modules", "Modules", 33),
      live("L293D dual H-bridge motor driver, DIP-16", "Chips & ICs", "Chips and ICs", 39),
      live("L293D Dual H-Bridge Motor Driver IC – 600mA, 4.7–36V", "Modules", "Chips and ICs", 3),
      live("SPDT Relay SRD 5V", "Modules", "Modules", 3),
      live("2 Channel Relay Module", "Modules", "Modules", 22),
      live("1 Channel Relay Module", "Modules", "Modules", 13),
    ];
    const typedLine = line({
      function: "relay module",
      spec: "5 V coil, switches the pump",
      class: "module",
      attributes: { module_type: "relay" },
    });

    it("a typed relay-module line never lists a motor driver or a bare relay", () => {
      const m = match(typedLine, catalogue);
      expect(names(m).length).toBeGreaterThan(0);
      for (const n of names(m)) expect(n).toMatch(/Relay Module/);
      expect(m.product?.name).toBe("1 Channel Relay Module");
    });

    it("an untyped relay-module line behaves the same", () => {
      const m = match(line({ function: "relay module", spec: "5 V" }), catalogue);
      for (const n of names(m)) expect(n).not.toMatch(/L293D/);
      expect(m.product?.name).toBe("1 Channel Relay Module");
    });

    it("a motor driver typed as a module does not match a relay line that names no attribute", () => {
      const driver = live("L293D Motor Driver Shield – Dual H-Bridge for Arduino", "Modules", "Modules", 33, {
        attributes: { class: "module", module_type: "motor_driver" },
      });
      const bare = line({ function: "relay module", spec: "", class: "module", attributes: {} });
      const m = match(bare, [driver]);
      expect(m.candidates).toEqual([]);
      expect(m.status).toBe("not_stocked");
    });

    it("a relay line whose words say relay matches a relay-typed module strongly", () => {
      const relay = live("1 Channel Relay Module", "Modules", "Modules", 13, { attributes: { class: "module", module_type: "relay" } });
      const m = match(line({ function: "relay module", spec: "", class: "module", attributes: {} }), [relay]);
      expect(m.candidates[0]?.strength).toBe("strong");
      expect(m.product?.id).toBe(relay.id);
    });

    it("a module line that names no type at all is only a weak match, never pre-selected", () => {
      const relay = live("1 Channel Relay Module", "Modules", "Modules", 13, { attributes: { class: "module", module_type: "relay" } });
      const m = match(line({ function: "module", spec: "", class: "module", attributes: {} }), [relay]);
      expect(m.candidates.every((c) => c.strength === "weak")).toBe(true);
      expect(m.product).toBeNull();
    });
  });

  it("an accessory-named product typed with the line's class is still not the device", () => {
    const shield = live("NodeMCU ESP32 I/O Expansion Shield", "Microcontrollers", "Modules", 15, {
      attributes: { class: "board", platform: "esp32", logic_v: 3.3 },
    });
    const l = line({ function: "ESP32", spec: "3.3 V", class: "board", attributes: { platform: "esp32", logic_v: 3.3 } });
    expect(match(l, [shield]).candidates).toEqual([]);
  });

  it("a battery line wants a cell, not its charging module or protection board", () => {
    const catalogue = [
      live("TP4056 Type-C Li-ion Battery Charging Module – 1A Charger", "Power", "Power", 6),
      live("1S 18650 Battery Protection Board – DW01A 8205A 2A BMS Module", "Power", "Power", 4),
      live("Lecxo 18650 Li-Ion Rechargeable Battery – 3.7V 3600mAh", "Power", "Power", 18),
    ];
    const m = match(line({ function: "rechargeable battery", spec: "3.7V Li-ion", class: "power", attributes: { power_type: "battery" } }), catalogue);
    expect(names(m)).toEqual(["Lecxo 18650 Li-Ion Rechargeable Battery – 3.7V 3600mAh"]);
  });

  it("a product that only mentions the word in its description (breadboard friendly) is not picked over the real thing", () => {
    const catalogue = [
      live("2N2222 NPN Transistor – 3 Pieces", "Components", "Components", 1, { description: "Breadboard friendly NPN transistor." }),
      live("Full-Size Solderless Breadboard – 830 Tie Points", "Prototyping", "Tools and accessories", 20),
    ];
    const m = match(line({ function: "breadboard", spec: "", kind: "consumable" }), catalogue);
    expect(m.product?.name).toBe("Full-Size Solderless Breadboard – 830 Tie Points");
  });
});

// ---------------------------------------------------------------------------
// P5-01 (2026-10-10): wrong matches on the owner's projects (smart desk lamp,
// plant monitor). Products are live names with no stored attributes: the type
// and values are read from the name (lib/store/derive-attributes.ts).
// ---------------------------------------------------------------------------

describe("matchLine — the right product type (P5-01)", () => {
  // The owner's resistor rows carry class + tolerance (as on live); value, power
  // and package come from the name.
  const TOL5 = { class: "resistor", tolerance_pct: 5 };
  const SENSORS = "Sensors";
  const catalogue = [
    live("Limit Switch Module – Mechanical Collision Detection Sensor", "Sensors", SENSORS, 4),
    live("SW-520D Tilt Sensor Module Digital Output", "Sensors", SENSORS, 3),
    live("IR Obstacle Avoidance Sensor - 2 to 30 cm Adjustable Detection", "Sensors", SENSORS, 5),
    live("HC-SR501 PIR Motion Sensor - Digital Output", "Sensors", SENSORS, 12),
    live("AM312 Mini PIR Motion Sensor - Digital Output", "Sensors", SENSORS, 10),
    live("IR Line Tracking Sensor Module – Adjustable Sensitivity", "Sensors", SENSORS, 4),
    live("Pololu QTR-1A Reflectance Sensor – Analog IR Line Sensor (2 Pack)", "Sensors", SENSORS, 20),
    live("UV Light Sensor Module – GUVA-S12SD, Analog Output", "Sensors", SENSORS, 25),
    live("Photoresistor Light Sensor Module – LM393 Comparator, Analog Output", "Sensors", SENSORS, 6),
    live("Photocell LDR Light Sensor – 4 Pieces Pack", "Sensors", SENSORS, 3),
    live("12V Pre-Wired LED – 3mm/5mm with Built-in Resistor", "Components", "Modules", 1),
    live("NE555P Precision Timer IC – DIP-8, 2 Pieces", "Chips & ICs", "Chips and ICs", 2),
    live("Resistor 220 Ω 1/4 W, through-hole (pack of 10)", "Components", "Chips and ICs", 2, { pack_size: 10, attributes: TOL5 }),
    live("Resistor 4.7 kΩ 1/4 W, through-hole (pack of 10)", "Components", "Chips and ICs", 2, { pack_size: 10, attributes: TOL5 }),
    live("Resistor 10 kΩ 1/4 W, through-hole (pack of 10)", "Components", "Chips and ICs", 2, { pack_size: 10, attributes: TOL5 }),
    live("USB Logic Analyzer 8-Channel Module", "Modules", "Modules", 45),
    live("7404 Hex Inverter Logic IC – DIP-14", "Chips & ICs", "Chips and ICs", 2),
  ];
  const pir = line({
    id: "e_item_2",
    function: "motion sensor",
    spec: "PIR, digital output, 5V",
    class: "sensor",
    attributes: { class: "sensor", measures: "motion", voltage_v: 5 },
  });
  const light = line({
    id: "e_item_3",
    function: "light sensor",
    spec: "phototransistor, analog output, 3.3V-5V",
    class: "sensor",
    attributes: { class: "sensor", measures: "light", voltage_v: 5 },
  });
  const resistor = (ohm: number) =>
    line({
      id: `rule_res_${ohm}`,
      function: "Resistor",
      spec: `${ohm} Ω, 1/4 W, ±5%, through-hole`,
      class: "resistor",
      attributes: { class: "resistor", package: "through_hole", power_w: 0.25, tolerance_pct: 5, resistance_ohm: ohm },
    });
  const shifter = line({
    id: "rule_level_shifter",
    function: "Logic level shifter",
    spec: "bidirectional, 3.3 V ↔ 5 V, 4 channels",
    class: "module",
    attributes: { class: "module", channels: 4, module_type: "level_shifter" },
  });

  it("PIR motion sensor: a PIR sensor, never the limit switch, tilt or obstacle sensor", () => {
    const m = match(pir, catalogue);
    expect(names(m).length).toBeGreaterThan(0);
    for (const n of names(m)) expect(n).toMatch(/PIR/);
    expect(m.product?.name).toMatch(/PIR Motion Sensor/);
    expect(m.product?.strength).toBe("strong");
    expect(m.status).toBe("matched");
  });

  it("PIR line with no PIR in the store: nothing stands in (We'll source this)", () => {
    const m = match(pir, catalogue.filter((p) => !/PIR/.test(p.name)));
    expect(m.candidates).toEqual([]);
    expect(m.status).toBe("not_stocked");
  });

  it("light sensor: a photoresistor / LDR, never the IR line tracking or UV sensor", () => {
    const m = match(light, catalogue);
    expect(names(m).length).toBeGreaterThan(0);
    for (const n of names(m)) expect(n).toMatch(/Photoresistor|LDR/);
    expect(m.product?.name).toMatch(/Photoresistor|LDR/);
  });

  it("Resistor 120 Ω never matches the 12V pre-wired LED (or a timer IC)", () => {
    const m = match(resistor(120), catalogue);
    for (const n of names(m)) expect(n).not.toMatch(/LED|Timer|NE555/);
    expect(m.product).toBeNull();
  });

  it("a resistor line takes the nearest standard E12 value in the right pack", () => {
    // 4.6 kΩ is not a standard value; the nearest E12 value is 4.7 kΩ.
    const m = match(resistor(4600), catalogue);
    expect(m.product?.name).toBe("Resistor 4.7 kΩ 1/4 W, through-hole (pack of 10)");
    expect(m.product?.strength).toBe("strong");
    expect(m.product?.pack_size).toBe(10);
    // 9.6 kΩ → 10 kΩ; never the 4.7 kΩ or 220 Ω packs.
    const ten = match(resistor(9600), catalogue);
    expect(ten.product?.name).toBe("Resistor 10 kΩ 1/4 W, through-hole (pack of 10)");
    expect(names(ten)).not.toContain("Resistor 220 Ω 1/4 W, through-hole (pack of 10)");
  });

  it("a cheaper pack that covers the need ranks before a bigger one", () => {
    const small = live("Resistor 10 kΩ 1/4 W, through-hole (pack of 10)", "Components", "Chips and ICs", 2, { pack_size: 10, sku: "R10-10", attributes: TOL5 });
    const big = live("Resistor 10 kΩ 1/4 W, through-hole (pack of 100)", "Components", "Chips and ICs", 12, { pack_size: 100, sku: "R10-100", attributes: TOL5 });
    const m = match(resistor(10000), [big, small]);
    expect(m.product?.sku).toBe("R10-10");
  });

  it("logic level shifter with none in the store: not stocked (We'll source this), never a logic analyzer or IC", () => {
    const m = match(shifter, catalogue);
    expect(m.candidates).toEqual([]);
    expect(m.status).toBe("not_stocked");
    expect(m.product).toBeNull();
  });

  it("logic level shifter: the store's Logic Level Converter is a candidate (converter is not an accessory here)", () => {
    const conv = live("Logic Level Converter - Bi-Directional", "Modules", "Modules", 9);
    const m = match(shifter, [...catalogue, conv]);
    expect(names(m)).toEqual(["Logic Level Converter - Bi-Directional"]);
    // Its channel count is not in its name: no confident match until the owner fills it in.
    expect(m.product).toBeNull();
    expect(m.status).toBe("choose");
    const typed = { ...conv, attributes: { class: "module", module_type: "level_shifter", channels: 4 } };
    expect(match(shifter, [typed]).product?.id).toBe(conv.id);
  });

  it("only weak candidates: nothing is pre-selected", () => {
    const m = match(resistor(120), [live("1/4W Through-Hole Resistor – 20 Pieces", "Components", "Chips and ICs", 1)]);
    expect(m.candidates[0]?.strength).toBe("weak");
    expect(m.product).toBeNull();
    expect(m.auto).toBeUndefined();
    expect(m.status).toBe("choose");
    expect(weakSuggestion(m)?.name).toMatch(/Resistor/);
  });
});
