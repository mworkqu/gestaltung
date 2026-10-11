// Wokwi export (P5-17): the circuit as a Wokwi diagram.json, from the SAME
// Connection[] every wiring view draws. Pure, client-safe, no network: we never
// call a Wokwi API — the client uploads the files at wokwi.com themselves.
//
// Format (docs.wokwi.com/diagram-format):
//   { version: 1, author, editor: "wokwi", parts: [{ type, id, top, left, attrs }],
//     connections: [["partId:pin", "partId:pin", colour, []]] }
// Part types and pin names were checked against docs.wokwi.com/parts/* and the
// wokwi-boards repo (board-esp32-devkit-c-v4) on 2026-10-12. Only parts with a
// verified mapping are exported; anything else → { ok: false, unsupported }.
// Pure power parts (USB-C power board, batteries, charger, converters) are
// SKIPPED: the simulator powers the board itself.

import type { Connection, ConnectionEnd } from "./connections";
import type { GetPart } from "./netlist";
import type { Net, StudioComponent } from "./schema";

export type WokwiPart = { type: string; id: string; top: number; left: number; attrs: Record<string, string> };
export type WokwiConnection = [string, string, string, string[]];
export type WokwiDiagram = {
  version: 1;
  author: string;
  editor: "wokwi";
  parts: WokwiPart[];
  connections: WokwiConnection[];
};
export type WokwiResult = { ok: true; diagram: WokwiDiagram } | { ok: false; unsupported: string[] };

type PinMap = (pin: string) => string | null;
type PartMap = { type: string; pin: PinMap; attrs?: Record<string, string> };

const table = (m: Record<string, string>): PinMap => (pin) => m[pin] ?? null;

/** Arduino Uno (docs.wokwi.com/parts/wokwi-arduino-uno): "2", "A0", "5V", "GND.1". */
const unoPin: PinMap = (pin) => {
  let m = /^D(\d+)$/.exec(pin);
  if (m) return String(Number(m[1]));
  m = /^A(\d)$/.exec(pin);
  if (m) return `A${m[1]}`;
  m = /^GND_(\d)$/.exec(pin);
  if (m) return `GND.${m[1]}`;
  return ({ "5V": "5V", "3V3": "3.3V", VIN: "VIN" } as Record<string, string>)[pin] ?? null;
};

/**
 * ESP32 DevKitC V4 (board-esp32-devkit-c-v4, wokwi-boards/boards/esp32-devkit-c-v4/board.json):
 * GPIOs by number, except 36 = "VP", 39 = "VN", 1 = "TX", 3 = "RX"; our VIN is its "5V".
 */
const esp32Pin: PinMap = (pin) => {
  const m = /^GPIO(\d+)$/.exec(pin);
  if (m) {
    const n = Number(m[1]);
    return ({ 36: "VP", 39: "VN", 1: "TX", 3: "RX" } as Record<number, string>)[n] ?? String(n);
  }
  return ({ GND_L: "GND.1", GND_R: "GND.2", VIN: "5V", "3V3": "3V3", EN: "EN" } as Record<string, string>)[pin] ?? null;
};

const BOARDS: Record<string, PartMap> = {
  arduino_uno: { type: "wokwi-arduino-uno", pin: unoPin },
  esp32_devkit: { type: "board-esp32-devkit-c-v4", pin: esp32Pin },
};

/** Where a part fed by a skipped supply is wired instead (both boards have a 5V pin). */
const BOARD_RAIL: Record<string, { power: string; ground: string }> = {
  arduino_uno: { power: "5V", ground: "GND.2" },
  esp32_devkit: { power: "5V", ground: "GND.2" },
};

/** Library part id → Wokwi part (each verified on docs.wokwi.com/parts/<type>). */
export const WOKWI_PARTS: Record<string, PartMap> = {
  led_5mm: { type: "wokwi-led", pin: table({ A: "A", K: "C" }), attrs: { color: "red" } },
  resistor_220: { type: "wokwi-resistor", pin: table({ "1": "1", "2": "2" }), attrs: { value: "220" } },
  button_6mm: { type: "wokwi-pushbutton", pin: table({ A: "1.l", B: "2.l" }) },
  sg90_servo: { type: "wokwi-servo", pin: table({ SIG: "PWM", VCC: "V+", GND: "GND" }) },
  dht22: { type: "wokwi-dht22", pin: table({ VCC: "VCC", DATA: "SDA", GND: "GND" }) },
  pir_hcsr501: { type: "wokwi-pir-motion-sensor", pin: table({ VCC: "VCC", OUT: "OUT", GND: "GND" }) },
  hcsr04: { type: "wokwi-hc-sr04", pin: table({ VCC: "VCC", TRIG: "TRIG", ECHO: "ECHO", GND: "GND" }) },
  oled_096_i2c: { type: "board-ssd1306", pin: table({ GND: "GND", VCC: "VCC", SCL: "SCL", SDA: "SDA" }) },
  lcd1602_i2c: { type: "wokwi-lcd1602", pin: table({ GND: "GND", VCC: "VCC", SDA: "SDA", SCL: "SCL" }), attrs: { pins: "i2c" } },
  relay_module: { type: "wokwi-relay-module", pin: table({ VCC: "VCC", GND: "GND", IN: "IN" }) },
  buzzer: { type: "wokwi-buzzer", pin: table({ PLUS: "2", MINUS: "1" }) },
  ws2812_ring: { type: "wokwi-led-ring", pin: table({ VCC: "VCC", GND: "GND", DIN: "DIN" }), attrs: { pixels: "12" } },
  slide_switch: { type: "wokwi-slide-switch", pin: table({ A: "2", B: "1" }) },
  mpu6050: { type: "wokwi-mpu6050", pin: table({ VCC: "VCC", GND: "GND", SCL: "SCL", SDA: "SDA" }) },
  rotary_encoder: { type: "wokwi-ky-040", pin: table({ CLK: "CLK", DT: "DT", SW: "SW", VCC: "VCC", GND: "GND" }) },
  ldr_module: { type: "wokwi-photoresistor-sensor", pin: table({ VCC: "VCC", GND: "GND", DO: "DO", AO: "AO" }) },
};

/** Supplies the simulator replaces: dropped with their wires, never "unsupported". */
export const WOKWI_SKIPPED = new Set([
  "usbc_power_5v",
  "usbc_breakout",
  "cell_18650",
  "lipo_1000",
  "aa_holder_2",
  "tp4056_usbc",
  "boost_5v",
  "buck_converter",
]);

/** Short Wokwi-safe id from our instance id ("led_5mm_2" stays, odd characters become "_"). */
const wid = (inst: string) => inst.replace(/[^A-Za-z0-9_-]/g, "_");

/**
 * Netlist → Wokwi diagram. `nets` is used only to tell which leg of a series
 * resistor sits on the board side. ok:false lists the parts (library ids) the
 * simulator has no verified match for, and boards other than Uno / ESP32 DevKit.
 */
export function wokwiDiagram(
  components: StudioComponent[],
  connections: Connection[],
  nets: Net[],
  getPart: GetPart,
): WokwiResult {
  const unsupported = new Set<string>();
  const mapOf = new Map<string, PartMap>();
  let board: StudioComponent | undefined;
  for (const c of components) {
    const p = getPart(c.partId);
    if (!p) {
      unsupported.add(c.partId);
      continue;
    }
    if (p.category === "mcu") {
      if (board || !BOARDS[p.id]) unsupported.add(p.id);
      else {
        board = c;
        mapOf.set(c.instanceId, BOARDS[p.id]);
      }
      continue;
    }
    if (WOKWI_SKIPPED.has(p.id)) continue;
    const m = WOKWI_PARTS[p.id];
    if (!m) unsupported.add(p.id);
    else mapOf.set(c.instanceId, m);
  }
  if (!board) unsupported.add("no_board");
  if (unsupported.size) return { ok: false, unsupported: [...unsupported] };

  // Layout: board on the left, the rest in a grid to its right (people re-arrange in Wokwi anyway).
  const parts: WokwiPart[] = [];
  let i = 0;
  for (const c of components) {
    const m = mapOf.get(c.instanceId);
    if (!m) continue;
    const isBoard = c === board;
    const top = isBoard ? 0 : -60 + Math.floor(i / 3) * 140;
    const left = isBoard ? 0 : 340 + (i % 3) * 140;
    if (!isBoard) i++;
    parts.push({ type: m.type, id: wid(c.instanceId), top, left, attrs: { ...(m.attrs ?? {}) } });
  }

  const ref = (e: Pick<ConnectionEnd, "part" | "pin">): string | null => {
    const m = mapOf.get(e.part);
    const pin = m?.pin(e.pin);
    return m && pin ? `${wid(e.part)}:${pin}` : null;
  };
  const out: WokwiConnection[] = [];
  const missing: string[] = [];
  const boardRail = BOARD_RAIL[board!.partId];
  for (const c of connections) {
    const colour = c.wireColour; // our names are CSS colour names, which Wokwi accepts
    const ends = [c.from, c.to];
    const off = ends.filter((e) => !mapOf.has(e.part));
    if (off.length) {
      // A skipped supply's wire: the simulator powers the board, so a part that took
      // power or ground from the supply takes it from the board's 5V / GND instead.
      const other = ends.find((e) => mapOf.has(e.part));
      const rail = boardRail && (c.role === "power" ? boardRail.power : c.role === "ground" ? boardRail.ground : null);
      if (off.length === 1 && other && other.part !== board!.instanceId && rail) {
        const b = ref(other);
        if (b) out.push([`${wid(board!.instanceId)}:${rail}`, b, colour, []]);
      }
      continue;
    }
    if (c.viaPart && mapOf.has(c.viaPart)) {
      // board → resistor leg on the board's net, other leg → the far part.
      const net = nets.find((n) => n.name === c.net);
      const near = net?.pins.find((r) => r.startsWith(`${c.viaPart}.`))?.slice(c.viaPart.length + 1) ?? "1";
      const far = near === "1" ? "2" : "1";
      const a = ref(c.from);
      const b = ref({ part: c.viaPart, pin: near });
      const d = ref({ part: c.viaPart, pin: far });
      const e = ref(c.to);
      if (!a || !b || !d || !e) {
        missing.push(c.id);
        continue;
      }
      out.push([a, b, colour, []], [d, e, colour, []]);
      continue;
    }
    const a = ref(c.from);
    const b = ref(c.to);
    if (!a || !b) {
      missing.push(c.id);
      continue;
    }
    out.push([a, b, colour, []]);
  }
  // A pin we could not name (a board pin the simulator does not have): refuse rather than drop a wire.
  if (missing.length) return { ok: false, unsupported: missing.map((id) => `pin:${id}`) };

  return { ok: true, diagram: { version: 1, author: "Gestaltung", editor: "wokwi", parts, connections: out } };
}

/** The two files of the export. */
export function wokwiFiles(diagram: WokwiDiagram, code: string): { name: string; data: string }[] {
  return [
    { name: "diagram.json", data: `${JSON.stringify(diagram, null, 2)}\n` },
    { name: "sketch.ino", data: code.endsWith("\n") ? code : `${code}\n` },
  ];
}
