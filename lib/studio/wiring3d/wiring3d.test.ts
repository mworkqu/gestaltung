import { describe, expect, it } from "vitest";
import { getPart, LIBRARY } from "../library";
import { buildWiring } from "../netlist";
import { buildConnections } from "../connections";
import { DEFAULT_SPEC, type LibraryPart } from "../schema";
import { pins3dFor, slotRows } from "./pins3d";
import { apartLift, layoutMat, pinWorld } from "./layout";
import { buildWires, wirePath } from "./wires";

const CHECKED = [
  "arduino_uno", "esp32_devkit", "esp32_c3_mini", "soil_moisture_cap", "pump_5v", "motor_driver", "relay_module",
  "led_5mm", "resistor_220", "ws2812_ring", "sg90_servo", "button_6mm", "usbc_power_5v", "oled_096_i2c", "dht22",
];

const part = (id: string) => {
  const p = getPart(id);
  if (!p) throw new Error(`missing part ${id}`);
  return p;
};

function expectPinsSane(p: LibraryPart) {
  const pins = pins3dFor(p);
  const m = 1.5; // mm slack around the bbox
  const seen = new Set<string>();
  for (const pin of p.pins) {
    const q = pins[pin.id];
    expect(q, `${p.id}.${pin.id}`).toBeDefined();
    for (const v of [...q.pos, ...q.dir]) expect(Number.isFinite(v), `${p.id}.${pin.id}`).toBe(true);
    expect(Math.abs(q.pos[0]), `${p.id}.${pin.id} x`).toBeLessThanOrEqual(p.dims.x / 2 + m);
    expect(Math.abs(q.pos[1]), `${p.id}.${pin.id} y`).toBeLessThanOrEqual(p.dims.y / 2 + m);
    expect(q.pos[2], `${p.id}.${pin.id} z`).toBeGreaterThanOrEqual(-m);
    expect(q.pos[2], `${p.id}.${pin.id} z`).toBeLessThanOrEqual(p.dims.z + m);
    expect(Math.hypot(...q.dir), `${p.id}.${pin.id} dir`).toBeCloseTo(1, 5);
    const key = q.pos.map((v) => v.toFixed(2)).join(",");
    expect(seen.has(key), `${p.id}.${pin.id} duplicates another pin`).toBe(false);
    seen.add(key);
  }
}

describe("pins3d", () => {
  it.each(CHECKED)("%s: every pin finite, inside the bbox, distinct", (id) => expectPinsSane(part(id)));

  it("every library part gets a position for every pin", () => {
    for (const p of LIBRARY) expectPinsSane(p);
  });

  it("reads header rows from the model params (ESP32 DevKit: 2 × 15 at y = ±12.7, tips at dims.z)", () => {
    const rows = slotRows(part("esp32_devkit"));
    expect(rows.map((r) => r.slots.length)).toEqual([15, 15]);
    expect(rows[0].cy).toBeCloseTo(12.7);
    expect(rows[0].slots[0].pos[2]).toBe(10);
  });

  it("ESP32 DevKit: EN / GPIO23 at the antenna end, VIN / 3V3 next to the USB", () => {
    const p = pins3dFor(part("esp32_devkit"));
    expect(p.EN.pos[0]).toBeGreaterThan(15);
    expect(p.VIN.pos[0]).toBeLessThan(-15);
    expect(p.EN.pos[1]).toBeCloseTo(12.7);
    expect(p.GPIO23.pos[1]).toBeCloseTo(-12.7);
    expect(p["3V3"].pos[0]).toBeLessThan(-15);
  });

  it("Arduino Uno: digital pins on the top sockets, A0–A5 on the bottom right, socket tops", () => {
    const p = pins3dFor(part("arduino_uno"));
    expect(p.D2.pos[1]).toBeCloseTo(24.15);
    expect(p.D0.pos[0]).toBeGreaterThan(p.D7.pos[0]);
    expect(p.D8.pos[0]).toBeLessThan(p.D7.pos[0]);
    expect(p.A0.pos[1]).toBeCloseTo(-24.1);
    expect(p.A5.pos[0]).toBeGreaterThan(p.A0.pos[0]);
    expect(p.D2.pos[2]).toBeCloseTo(1.6 + 8.5);
  });

  it("LED anode is the +x leg; pump and servo leads leave sideways", () => {
    expect(pins3dFor(part("led_5mm")).A.pos[0]).toBeGreaterThan(0);
    expect(pins3dFor(part("pump_5v")).M_PLUS.dir).toEqual([1, 0, 0]);
    expect(pins3dFor(part("sg90_servo")).SIG.dir).toEqual([-1, 0, 0]);
  });

  it("moduleBoard pads / rows and the OLED header follow the model", () => {
    const usb = pins3dFor(part("usbc_power_5v"));
    expect(usb.OUT_5V.pos[0]).toBeCloseTo(7.6);
    const oled = pins3dFor(part("oled_096_i2c"));
    expect(oled.GND.pos[0]).toBeLessThan(oled.SDA.pos[0]);
    const relay = pins3dFor(part("relay_module"));
    expect(relay.IN.pos[0]).toBeCloseTo(-23);
    expect(relay.IN.pos[2]).toBeCloseTo(9.5);
  });

  it("an explicit part.pins3d wins", () => {
    const base = part("led_5mm");
    const p = pins3dFor({ ...base, pins3d: { A: [2, 0, 3] } });
    expect(p.A.pos).toEqual([2, 0, 3]);
  });
});

const wire = (ids: string[]) => {
  const comps = ids.map((id) => ({ partId: id, instanceId: `${id}_1`, label: id }));
  const w = buildWiring(comps, DEFAULT_SPEC, getPart, "en");
  const connections = buildConnections(w.components, w.netlist.nets, getPart);
  const items = w.components.flatMap((c) => {
    const p = getPart(c.partId);
    return p ? [{ instanceId: c.instanceId, part: p }] : [];
  });
  return { w, connections, items };
};

const FIXTURES = {
  plant: ["esp32_devkit", "soil_moisture_cap", "pump_5v", "led_5mm", "usbc_power_5v"],
  uno: ["arduino_uno", "soil_moisture_cap", "relay_module", "led_5mm", "oled_096_i2c", "dht22"],
  busy: ["esp32_devkit", "sg90_servo", "ws2812_ring", "button_6mm", "dht22", "oled_096_i2c", "led_5mm", "usbc_power_5v"],
};

describe("layoutMat", () => {
  it.each(Object.entries(FIXTURES))("%s: board at the centre, no overlaps, deterministic", (_, ids) => {
    const { connections, items } = wire(ids);
    const a = layoutMat(items, connections);
    expect(a).toEqual(layoutMat(items, connections));
    expect(a.placements).toHaveLength(items.length);
    const board = a.placements.find((p) => p.board)!;
    expect(getPart(board.partId)?.category).toBe("mcu");
    expect(board.pos).toEqual([0, 0, 0]);
    for (let i = 0; i < a.placements.length; i++) {
      for (let j = i + 1; j < a.placements.length; j++) {
        const p = a.placements[i];
        const q = a.placements[j];
        const clear = Math.abs(p.pos[0] - q.pos[0]) * 2 >= p.w + q.w || Math.abs(p.pos[1] - q.pos[1]) * 2 >= p.d + q.d;
        expect(clear, `${p.instanceId} overlaps ${q.instanceId}`).toBe(true);
      }
    }
  });

  it("the series resistor stands on a breadboard strip", () => {
    const { connections, items } = wire(FIXTURES.plant);
    const r = layoutMat(items, connections).placements.find((p) => p.partId === "resistor_220");
    expect(r?.breadboard).toBe(true);
    expect(r!.pos[2]).toBeGreaterThan(0);
  });

  it("Take it apart lifts every part but the board", () => {
    const { connections, items } = wire(FIXTURES.uno);
    const l = layoutMat(items, connections);
    const lift = apartLift(l);
    for (const p of l.placements) expect(lift.get(p.instanceId)! > 0).toBe(!p.board);
  });
});

describe("wires", () => {
  it.each(Object.entries(FIXTURES))("%s: each wire starts and ends on its pins", (_, ids) => {
    const { w, connections, items } = wire(ids);
    const layout = layoutMat(items, connections);
    const byId = new Map(layout.placements.map((p) => [p.instanceId, p]));
    const at = (inst: string, partId: string, pin: string) => pinWorld(byId.get(inst)!, pins3dFor(part(partId))[pin]).pos;
    const segs = buildWires({ connections, layout, getPart, nets: w.netlist.nets });
    for (const c of connections) {
      const mine = segs.filter((s) => s.id === c.id);
      expect(mine.length, c.id).toBe(c.viaPart ? 2 : 1);
      for (const s of mine) {
        expect(s.colour).toBe(c.wireColour);
        for (const p of s.points) for (const v of p) expect(Number.isFinite(v)).toBe(true);
      }
      const first = mine[0].points[0];
      const last = mine[mine.length - 1].points.at(-1)!;
      expect(first).toEqual(at(c.from.part, c.from.partId, c.from.pin));
      expect(last).toEqual(at(c.to.part, c.to.partId, c.to.pin));
    }
  });

  it("via wires go board pin → resistor leg a, leg b → host", () => {
    const { w, connections, items } = wire(FIXTURES.plant);
    const layout = layoutMat(items, connections);
    const c = connections.find((x) => x.viaPart)!;
    const segs = buildWires({ connections, layout, getPart, nets: w.netlist.nets }).filter((s) => s.id === c.id);
    const r = layout.placements.find((p) => p.instanceId === c.viaPart)!;
    const legs = pins3dFor(part("resistor_220"));
    const ends = [segs[0].points.at(-1)!, segs[1].points[0]];
    const legPos = ["1", "2"].map((id) => pinWorld(r, legs[id]).pos);
    expect(legPos).toContainEqual(ends[0]);
    expect(legPos).toContainEqual(ends[1]);
    expect(ends[0]).not.toEqual(ends[1]);
  });

  it("lifted parts drag their wire ends up", () => {
    const { w, connections, items } = wire(FIXTURES.uno);
    const layout = layoutMat(items, connections);
    const lift = apartLift(layout);
    const flat = buildWires({ connections, layout, getPart, nets: w.netlist.nets });
    const up = buildWires({ connections, layout, getPart, nets: w.netlist.nets, lift: (id) => lift.get(id) ?? 0 });
    const c = connections.find((x) => !x.viaPart && lift.get(x.to.part)! > 0)!;
    const i = flat.findIndex((s) => s.id === c.id);
    expect(up[i].points.at(-1)![2] - flat[i].points.at(-1)![2]).toBeCloseTo(lift.get(c.to.part)!);
  });

  it("the arch rises above both ends", () => {
    const pts = wirePath({ pos: [0, 0, 10], dir: [0, 0, 1] }, { pos: [60, 0, 2], dir: [-1, 0, 0] });
    expect(pts[0]).toEqual([0, 0, 10]);
    expect(pts.at(-1)).toEqual([60, 0, 2]);
    expect(Math.max(...pts.map((p) => p[2]))).toBeGreaterThan(15);
  });
});
