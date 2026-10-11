import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildConnections } from "./connections";
import { getPart } from "./library";
import { buildWiring } from "./netlist";
import { DEFAULT_SPEC } from "./schema";
import { WOKWI_SKIPPED, wokwiDiagram, wokwiFiles } from "./wokwi";
import { crc32, zipStore } from "./zip";

const comps = (...ids: string[]) => ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));

// docs.wokwi.com/diagram-format
const DiagramSchema = z
  .object({
    version: z.literal(1),
    author: z.string(),
    editor: z.literal("wokwi"),
    parts: z.array(
      z.object({
        type: z.string().min(1),
        id: z.string().regex(/^[A-Za-z0-9_-]+$/),
        top: z.number(),
        left: z.number(),
        attrs: z.record(z.string(), z.string()),
      }),
    ),
    connections: z.array(z.tuple([z.string().regex(/^[^:]+:.+$/), z.string().regex(/^[^:]+:.+$/), z.string(), z.array(z.string())])),
  })
  .strict();

function build(ids: string[]) {
  const w = buildWiring(comps(...ids), DEFAULT_SPEC, getPart, "en");
  const conns = buildConnections(w.components, w.netlist.nets, getPart);
  return { w, conns, r: wokwiDiagram(w.components, conns, w.netlist.nets, getPart) };
}

describe.each([
  { ids: ["arduino_uno", "led_5mm", "button_6mm"], board: "wokwi-arduino-uno" },
  { ids: ["esp32_devkit", "led_5mm", "dht22", "usbc_power_5v"], board: "board-esp32-devkit-c-v4" },
])("wokwiDiagram $ids", ({ ids, board }) => {
  const { w, conns, r } = build(ids);
  it("matches the documented shape", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(DiagramSchema.parse(r.diagram)).toBeTruthy();
    expect(r.diagram.parts[0].type).toBe(board);
    const partIds = new Set(r.diagram.parts.map((p) => p.id));
    expect(partIds.size).toBe(r.diagram.parts.length);
    for (const [a, b] of r.diagram.connections) {
      expect(partIds.has(a.split(":")[0])).toBe(true);
      expect(partIds.has(b.split(":")[0])).toBe(true);
    }
  });
  it("has every wire (except skipped power parts) with its colour", () => {
    if (!r.ok) throw new Error("not ok");
    const skipped = new Set(w.components.filter((c) => WOKWI_SKIPPED.has(c.partId)).map((c) => c.instanceId));
    const kept = conns.filter((c) => !skipped.has(c.from.part) && !skipped.has(c.to.part));
    expect(kept.length).toBeLessThan(conns.length + 1);
    const pairs = r.diagram.connections.map(([a, b, colour]) => ({ a: a.split(":")[0], b: b.split(":")[0], colour }));
    for (const c of kept) {
      if (c.viaPart) {
        expect(pairs).toContainEqual({ a: c.from.part, b: c.viaPart, colour: c.wireColour });
        expect(pairs).toContainEqual({ a: c.viaPart, b: c.to.part, colour: c.wireColour });
      } else expect(pairs).toContainEqual({ a: c.from.part, b: c.to.part, colour: c.wireColour });
    }
    const viaCount = kept.filter((c) => c.viaPart).length;
    // Parts that took power / ground from a skipped supply now take it from the board.
    const boardId = w.components.find((c) => getPart(c.partId)?.category === "mcu")!.instanceId;
    const rewired = conns.filter(
      (c) =>
        (c.role === "power" || c.role === "ground") &&
        [c.from, c.to].filter((e) => skipped.has(e.part)).length === 1 &&
        [c.from, c.to].some((e) => !skipped.has(e.part) && e.part !== boardId),
    );
    for (const c of rewired) {
      const part = [c.from, c.to].find((e) => !skipped.has(e.part))!.part;
      expect(pairs).toContainEqual({ a: boardId, b: part, colour: c.wireColour });
    }
    expect(r.diagram.connections).toHaveLength(kept.length + viaCount + rewired.length);
    expect(r.diagram.parts.some((p) => skipped.has(p.id))).toBe(false);
  });
});

describe("pin names", () => {
  it("Uno: D2 → 2, GND_1 → GND.1, LED + via the resistor, LED − → C", () => {
    const { r } = build(["arduino_uno", "led_5mm", "button_6mm"]);
    if (!r.ok) throw new Error("not ok");
    const flat = r.diagram.connections.map(([a, b]) => `${a} ${b}`);
    expect(flat).toContain("arduino_uno_1:GND.1 led_5mm_2:C");
    expect(flat).toContain("arduino_uno_1:4 button_6mm_3:2.l");
    expect(flat.some((l) => /^arduino_uno_1:2 resistor_220_1:[12]$/.test(l))).toBe(true);
    expect(flat.some((l) => /^resistor_220_1:[12] led_5mm_2:A$/.test(l))).toBe(true);
  });
  it("ESP32: GPIO25 → 25, GND_L → GND.1, 3V3 → 3V3, DHT22 DATA → SDA", () => {
    const { r } = build(["esp32_devkit", "led_5mm", "dht22", "usbc_power_5v"]);
    if (!r.ok) throw new Error("not ok");
    const flat = r.diagram.connections.map(([a, b]) => `${a} ${b}`);
    expect(flat).toContain("esp32_devkit_1:GND.1 dht22_3:GND");
    expect(flat).toContain("esp32_devkit_1:3V3 dht22_3:VCC");
    expect(flat).toContain("esp32_devkit_1:26 dht22_3:SDA");
    expect(flat.some((l) => /^esp32_devkit_1:25 resistor_220_1:[12]$/.test(l))).toBe(true);
    expect(flat.some((l) => l.includes("usbc_power"))).toBe(false);
  });
});

it("Plant Waterer golden parts (C3 mini, pump, soil probe) are not exportable", () => {
  const { r } = build(["esp32_c3_mini", "pump_5v", "led_5mm", "button_6mm", "soil_moisture_cap"]);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.unsupported).toEqual(expect.arrayContaining(["esp32_c3_mini", "pump_5v", "soil_moisture_cap"]));
});

// ── zip ─────────────────────────────────────────────────────────────────────

function readZip(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  let p = v.getUint32(eocd + 16, true);
  expect(p + cdSize).toBe(eocd);
  const files: { name: string; crc: number; size: number; data: Uint8Array; flags: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const flags = v.getUint16(p + 8, true);
    expect(v.getUint16(p + 10, true)).toBe(0); // STORE
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    expect(csize).toBe(size);
    const nlen = v.getUint16(p + 28, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    expect(v.getUint32(off + 14, true)).toBe(crc);
    const lnlen = v.getUint16(off + 26, true);
    const data = bytes.subarray(off + 30 + lnlen, off + 30 + lnlen + size);
    files.push({ name, crc, size, data, flags });
    p += 46 + nlen;
  }
  return files;
}

describe("zipStore", () => {
  it("crc32 matches the known value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("central directory lists both files with the right CRC and size", () => {
    const { r } = build(["arduino_uno", "led_5mm", "button_6mm"]);
    if (!r.ok) throw new Error("not ok");
    const entries = wokwiFiles(r.diagram, "void setup() {}\nvoid loop() {}");
    const files = readZip(zipStore(entries, new Date(2026, 9, 12, 10, 30)));
    expect(files.map((f) => f.name)).toEqual(["diagram.json", "sketch.ino"]);
    const enc = new TextEncoder();
    files.forEach((f, i) => {
      const want = enc.encode(entries[i].data as string);
      expect(f.size).toBe(want.length);
      expect(f.crc).toBe(crc32(want));
      expect(new TextDecoder().decode(f.data)).toBe(entries[i].data);
      expect(f.flags & 0x0800).toBe(0x0800);
    });
    expect(JSON.parse(new TextDecoder().decode(files[0].data))).toEqual(r.diagram);
  });
  it("UTF-8 names round-trip", () => {
    const files = readZip(zipStore([{ name: "مصباح.ino", data: "x" }]));
    expect(files[0].name).toBe("مصباح.ino");
  });
});

it("a servo fed by the USB-C power board takes 5V from the board in the simulator", () => {
  const { r } = build(["esp32_devkit", "sg90_servo", "button_6mm", "usbc_power_5v"]);
  if (!r.ok) throw new Error("not ok");
  expect(DiagramSchema.parse(r.diagram)).toBeTruthy();
  expect(r.diagram.connections.some(([a, b]) => a === "esp32_devkit_1:5V" && b === "sg90_servo_2:V+")).toBe(true);
});
