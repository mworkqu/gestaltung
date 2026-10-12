import { describe, expect, it } from "vitest";
import { getPart, LIBRARY } from "../library";
import { buildWiring } from "../netlist";
import { buildConnections } from "../connections";
import { DEFAULT_SPEC, type LibraryPart } from "../schema";
import { pins3dFor, slotRows } from "./pins3d";
import { apartLift, applyMoves, CLEAR, GAP, layoutMat, MOVE_CLEAR, movePart, pinWorld, resolveMove, settleMove, snapToBreadboard, type MatLayout } from "./layout";
import { buildWires, railNets, touchesPart, WIRE_R, type WireEnd, type WireSegment } from "./wires";
import { allHoles, breadboardSpec, fits, groupOf, holeWorld, plugFor, plugHoles, type Occupant } from "./breadboard";
import { groupNets, wireProblems } from "./verify";
import type { Net } from "../schema";

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
  const comps = ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));
  const w = buildWiring(comps, DEFAULT_SPEC, getPart, "en");
  const connections = buildConnections(w.components, w.netlist.nets, getPart);
  const items = w.components.flatMap((c) => {
    const p = getPart(c.partId);
    return p ? [{ instanceId: c.instanceId, part: p }] : [];
  });
  const nets: Net[] = w.netlist.nets;
  return { w, connections, items, nets, layout: () => layoutMat(items, connections, nets) };
};

const FIXTURES = {
  plant: ["esp32_c3_mini", "soil_moisture_cap", "pump_5v", "motor_driver", "ws2812_ring"],
  doorbell: ["esp32_c3_mini", "button_6mm", "speaker_amp", "led_5mm", "lipo_1000", "tp4056_usbc"],
  uno: ["arduino_uno", "soil_moisture_cap", "relay_module", "led_5mm", "oled_096_i2c", "dht22"],
  busy: ["esp32_devkit", "sg90_servo", "ws2812_ring", "button_6mm", "dht22", "oled_096_i2c", "led_5mm", "usbc_power_5v"],
};

type R = { x: number; y: number; w: number; d: number };
const rect = (p: { pos: number[]; w: number; d: number }): R => ({ x: p.pos[0], y: p.pos[1], w: p.w, d: p.d });
/** Clearance between two footprints (mm; negative = overlap). */
const clearance = (p: R, q: R) => Math.max(Math.abs(p.x - q.x) - (p.w + q.w) / 2, Math.abs(p.y - q.y) - (p.d + q.d) / 2);
const bbRect = (l: MatLayout): R => ({ x: l.breadboard!.pos[0], y: l.breadboard!.pos[1], w: l.breadboard!.w, d: l.breadboard!.d });
/** Everything on the mat (the breadboard counts as one block; plugged parts are inside it). */
const matRects = (l: MatLayout): [string, R][] => [
  ...l.placements.filter((p) => !p.breadboard).map((p) => [p.instanceId, rect(p)] as [string, R]),
  ["breadboard", bbRect(l)],
];

function expectNoOverlap(l: MatLayout, min = 0) {
  const ms = matRects(l);
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++)
      expect(clearance(ms[i][1], ms[j][1]), `${ms[i][0]} vs ${ms[j][0]}`).toBeGreaterThanOrEqual(min - 1e-6);
  const bb = l.breadboard!;
  const plugged = l.placements.filter((p) => p.breadboard);
  for (const p of plugged) {
    expect(Math.abs(p.pos[0] - bb.pos[0]) + p.w / 2, `${p.instanceId} over the board`).toBeLessThanOrEqual(bb.w / 2 + 1e-6);
    expect(Math.abs(p.pos[1] - bb.pos[1]) + p.d / 2, `${p.instanceId} over the board`).toBeLessThanOrEqual(bb.d / 2 + 1e-6);
    for (const h of p.holes ?? []) {
      expect(h.col).toBeGreaterThanOrEqual(0);
      expect(h.col).toBeLessThan(bb.cols);
    }
  }
  for (let i = 0; i < plugged.length; i++)
    for (let j = i + 1; j < plugged.length; j++)
      expect(clearance(rect(plugged[i]), rect(plugged[j])), `${plugged[i].instanceId} vs ${plugged[j].instanceId}`).toBeGreaterThanOrEqual(-1e-6);
  expect(groupNets(l).conflicts).toEqual([]);
}

describe("breadboard", () => {
  it("half-size = 30 columns, 400 points; full-size = 63 columns", () => {
    const half = breadboardSpec(30);
    expect(allHoles(30)).toHaveLength(400);
    expect(half.w).toBeGreaterThan(80);
    expect(half.w).toBeLessThan(86);
    expect(breadboardSpec(63).w).toBeGreaterThan(160);
  });

  it("one column on one side of the channel is one group; rails are one group", () => {
    expect(groupOf({ col: 4, row: 0 })).toBe(groupOf({ col: 4, row: 4 }));
    expect(groupOf({ col: 4, row: 4 })).not.toBe(groupOf({ col: 4, row: 5 }));
    expect(groupOf({ col: 4, row: 0 })).not.toBe(groupOf({ col: 5, row: 0 }));
    expect(groupOf({ col: 0, row: 10 })).toBe(groupOf({ col: 28, row: 10 }));
    expect(groupOf({ col: 0, row: 10 })).not.toBe(groupOf({ col: 0, row: 11 }));
  });

  it("small through-hole parts plug in; boards and big or odd parts stay on the mat", () => {
    for (const id of ["led_5mm", "resistor_220", "button_6mm", "dht22", "oled_096_i2c", "motor_driver", "bh1750", "mpu6050"])
      expect(plugFor(part(id)), id).not.toBeNull();
    for (const id of ["esp32_devkit", "arduino_uno", "esp32_c3_mini", "pump_5v", "sg90_servo", "relay_module", "usbc_power_5v", "soil_moisture_cap", "lipo_1000", "aa_holder_2", "speaker_amp"])
      expect(plugFor(part(id)), id).toBeNull();
  });

  it("a 6 mm button goes across the centre channel; a DHT22 stands with its 4 pins in one row", () => {
    const b = plugFor(part("button_6mm"), "A")!.bottom;
    expect(b.pins.filter((p) => p.id === "A").every((p) => p.row === 4)).toBe(true);
    expect(b.pins.filter((p) => p.id === "B").every((p) => p.row === 5)).toBe(true);
    const d = plugFor(part("dht22"))!.bottom;
    expect(d.tilt).toBe(90);
    expect(d.pins.map((p) => p.dc).sort()).toEqual([0, 1, 3]);
    expect(new Set(d.pins.map((p) => p.row)).size).toBe(1);
  });

  it("refuses a column that holds another net, accepts the same net", () => {
    const spec = breadboardSpec(30);
    const led = plugFor(part("led_5mm"))!.bottom;
    const other: Occupant = { holes: [{ col: 5, row: 0, net: "GND" }], rect: { x: -100, y: -100, w: 1, d: 1 } };
    const at = plugHoles(led, 5).find((h) => h.col === 5)!.id;
    expect(fits(spec, led, 5, (p) => (p === at ? "LED1" : "X"), [other])).toBe(false);
    expect(fits(spec, led, 5, (p) => (p === at ? "GND" : "X"), [other])).toBe(true);
    expect(fits(spec, led, 29, () => "X", [])).toBe(false); // second leg off the end
  });
});

describe("layoutMat", () => {
  it.each(Object.entries(FIXTURES))("%s: breadboard in the middle, board beside it, no overlaps, deterministic", (_, ids) => {
    const { items, layout } = wire(ids);
    const a = layout();
    expect(a).toEqual(layout());
    expect(a.placements).toHaveLength(items.length);
    expect(a.breadboard!.pos).toEqual([0, 0]);
    const board = a.placements.find((p) => p.board)!;
    expect(getPart(board.partId)?.category).toBe("mcu");
    expect(board.breadboard).toBe(false);
    expect(board.pos[0] + board.w / 2).toBeLessThanOrEqual(-a.breadboard!.w / 2 - 1e-6);
    expectNoOverlap(a, CLEAR);
  });

  it.each(Object.entries(FIXTURES))("%s: mat parts keep wire lanes free, but stay close (CLEAR … GAP + a grid step)", (_, ids) => {
    const a = wire(ids).layout();
    const ms = matRects(a);
    for (const [id, r] of ms.filter(([id]) => id !== "breadboard" && !a.placements.find((p) => p.instanceId === id)!.board)) {
      const near = Math.min(...ms.filter(([o]) => o !== id).map(([, q]) => clearance(r, q)));
      expect(near, id).toBeGreaterThanOrEqual(CLEAR - 1e-6);
      expect(near, id).toBeLessThanOrEqual(GAP + 2.6);
    }
  });

  it("half-size by default, full-size when the parts don't fit", () => {
    expect(wire(FIXTURES.busy).layout().breadboard!.cols).toBe(30);
    const many = wire(["esp32_devkit", "led_5mm", "led_5mm", "led_5mm", "led_5mm", "button_6mm", "button_6mm", "button_6mm", "dht22", "oled_096_i2c"]);
    const l = many.layout();
    expect(l.breadboard!.cols).toBe(63);
    expect(l.placements.filter((p) => p.breadboard).length).toBeGreaterThan(6);
    expectNoOverlap(l);
  });

  it("LED + resistor: both plug in, the resistor bridges the board's column and the LED's column", () => {
    const { connections, layout, nets } = wire(FIXTURES.doorbell);
    const l = layout();
    const c = connections.find((x) => x.viaPart)!;
    const r = l.placements.find((p) => p.instanceId === c.viaPart)!;
    const led = l.placements.find((p) => p.instanceId === c.to.part)!;
    expect(r.breadboard).toBe(true);
    expect(led.breadboard).toBe(true);
    const near = r.holes!.find((h) => r.pinNets![h.id] === c.net)!;
    const far = r.holes!.find((h) => h !== near)!;
    const anode = led.holes!.find((h) => h.id === c.to.pin)!;
    expect(groupOf(anode)).toBe(groupOf(far));
    expect(groupOf(near)).not.toBe(groupOf(far));
    // The board's jumper goes into the resistor's near column, and that is the whole wire.
    const segs = buildWires({ connections, layout: l, getPart, nets }).filter((s) => s.id === c.id);
    expect(segs).toHaveLength(1);
    expect(segs[0].ends[0]).toEqual({ kind: "pin", part: c.from.part, pin: c.from.pin });
    const end = segs[0].ends[1];
    expect(end.kind).toBe("hole");
    expect(groupOf(end as Extract<WireEnd, { kind: "hole" }>)).toBe(groupOf(near));
  });

  it("the button's ground side sits below the channel, next to the − rail", () => {
    const l = wire(FIXTURES.doorbell).layout();
    const b = l.placements.find((p) => p.partId === "button_6mm")!;
    expect(b.breadboard).toBe(true);
    expect(b.holes!.filter((h) => h.id === "A").every((h) => h.row < 5)).toBe(true);
  });

  it("Take it apart lifts every part but the board (the breadboard stays)", () => {
    const l = wire(FIXTURES.uno).layout();
    const lift = apartLift(l);
    for (const p of l.placements) expect(lift.get(p.instanceId)! > 0).toBe(!p.board);
  });
});

describe("moving parts", () => {
  const setup = () => {
    const f = wire(FIXTURES.doorbell);
    return { ...f, layout: f.layout() };
  };

  it("a free spot on the mat is taken as is; deterministic", () => {
    const { layout } = setup();
    const p = layout.placements.find((q) => !q.board && !q.breadboard)!;
    const want: [number, number] = [layout.bounds.maxX + 80, 0];
    expect(resolveMove(layout, p.instanceId, want)).toEqual(want);
    const moved = movePart(layout, p.instanceId, want);
    expect(moved.placements.find((q) => q.instanceId === p.instanceId)!.pos.slice(0, 2)).toEqual(want);
    expect(moved.bounds.maxX).toBeGreaterThan(layout.bounds.maxX);
    expect(applyMoves(layout, { [p.instanceId]: want })).toEqual(applyMoves(layout, { [p.instanceId]: want }));
  });

  it("dropping a mat part on the board or the breadboard never overlaps", () => {
    const { layout } = setup();
    const board = layout.placements.find((q) => q.board)!;
    for (const p of layout.placements.filter((q) => !q.breadboard && !q.board)) {
      for (const want of [[0, 0], [board.pos[0], board.pos[1]], [10, 20], [-20, -5]] as [number, number][]) {
        const xy = settleMove(layout, p.instanceId, want);
        const out = applyMoves(layout, { [p.instanceId]: xy });
        expectNoOverlap(out, MOVE_CLEAR);
        expect(out.placements.find((q) => q.instanceId === p.instanceId)!.pos.slice(0, 2)).toEqual(xy);
      }
    }
  });

  it("applyMoves drops a move that would overlap and keeps the rest", () => {
    const { layout } = setup();
    const [a, b] = layout.placements.filter((q) => !q.board && !q.breadboard);
    const far: [number, number] = [layout.bounds.maxX + 100, layout.bounds.maxY + 100];
    const out = applyMoves(layout, { [a.instanceId]: [0, 0], [b.instanceId]: far, gone_1: [5, 5] });
    expect(out.placements.find((q) => q.instanceId === a.instanceId)).toEqual(a);
    expect(out.placements.find((q) => q.instanceId === b.instanceId)!.pos.slice(0, 2)).toEqual(far);
    expectNoOverlap(out);
  });

  it("dragging a plugged LED onto the mat unplugs it; its jumpers then go to its legs", () => {
    const { layout, connections, nets } = setup();
    const led = layout.placements.find((q) => q.partId === "led_5mm")!;
    const spot: [number, number] = [layout.bounds.maxX + 30, layout.bounds.maxY + 30];
    const out = applyMoves(layout, { [led.instanceId]: settleMove(layout, led.instanceId, spot) });
    const moved = out.placements.find((q) => q.instanceId === led.instanceId)!;
    expect(moved.breadboard).toBe(false);
    expect(moved.pos[2]).toBe(0);
    const segs = buildWires({ connections, layout: out, getPart, nets });
    expect(wireProblems(segs, connections, out, getPart, nets)).toEqual([]);
    const c = connections.find((x) => x.viaPart)!;
    expect(segs.filter((s) => s.id === c.id).at(-1)!.ends[1]).toEqual({ kind: "pin", part: led.instanceId, pin: c.to.pin });
  });

  it("dropping a pluggable part over the breadboard snaps it into free holes, never into another net's column", () => {
    const { layout, connections, nets } = setup();
    const btn = layout.placements.find((q) => q.partId === "button_6mm")!;
    const bb = layout.breadboard!;
    // Off the board first, then back onto the board right on top of the resistor.
    const off = applyMoves(layout, { [btn.instanceId]: [layout.bounds.maxX + 30, 0] });
    expect(off.placements.find((q) => q.instanceId === btn.instanceId)!.breadboard).toBe(false);
    const res = layout.placements.find((q) => q.partId === "resistor_220")!;
    const xy = settleMove(off, btn.instanceId, [res.pos[0], bb.pos[1] - 2]);
    const back = applyMoves(layout, { [btn.instanceId]: xy });
    const snapped = back.placements.find((q) => q.instanceId === btn.instanceId)!;
    expect(snapped.breadboard).toBe(true);
    expectNoOverlap(back);
    expect(snapToBreadboard(off, btn.instanceId, xy)!.pos.slice(0, 2)).toEqual(xy);
    const segs = buildWires({ connections, layout: back, getPart, nets });
    expect(wireProblems(segs, connections, back, getPart, nets)).toEqual([]);
  });

  it("wires follow a moved part, and rebuilding only its wires matches the full build", () => {
    const { connections, layout, nets } = setup();
    const p = layout.placements.find((q) => !q.board && !q.breadboard && connections.some((c) => c.to.part === q.instanceId && !c.viaPart))!;
    const moved = movePart(layout, p.instanceId, [layout.bounds.maxX + 60, layout.bounds.minY - 40]);
    const full = buildWires({ connections, layout: moved, getPart, nets });
    const mine = buildWires({ connections, layout: moved, getPart, nets, only: (c) => touchesPart(c, p.instanceId) });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine).toEqual(full.filter((s) => touchesPart(connections.find((c) => c.id === s.id)!, p.instanceId)));
    const c = connections.find((x) => x.to.part === p.instanceId && !x.viaPart)!;
    const seg = mine.filter((s) => s.id === c.id).find((s) => s.ends.some((e) => e.kind === "pin" && e.part === p.instanceId))!;
    const pl = moved.placements.find((q) => q.instanceId === p.instanceId)!;
    expect(seg.points[0]).toEqual(pinWorld(pl, pins3dFor(part(c.to.partId))[c.to.pin]).pos);
  });
});

describe("wires on the breadboard", () => {
  it.each(Object.entries(FIXTURES))("%s: every connection has a jumper in its colour; every end on its pin or a hole of its net", (_, ids) => {
    const { connections, layout, nets } = wire(ids);
    const l = layout();
    const segs = buildWires({ connections, layout: l, getPart, nets });
    expect(new Set(segs.map((s) => s.id))).toEqual(new Set(connections.map((c) => c.id)));
    for (const s of segs) for (const p of s.points) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    expect(wireProblems(segs, connections, l, getPart, nets)).toEqual([]);
    expect(buildWires({ connections, layout: l, getPart, nets })).toEqual(segs);
  });

  it.each(Object.entries(FIXTURES))("%s: no two jumpers share a hole, and none goes into a leg's hole", (_, ids) => {
    const { connections, layout, nets } = wire(ids);
    const l = layout();
    const used = new Set(l.placements.flatMap((p) => (p.breadboard ? (p.holes ?? []).map((h) => `${h.col}:${h.row}`) : [])));
    for (const s of buildWires({ connections, layout: l, getPart, nets }))
      for (const e of s.ends) {
        if (e.kind !== "hole") continue;
        const k = `${e.col}:${e.row}`;
        expect(used.has(k), `${s.id} ${k}`).toBe(false);
        used.add(k);
      }
  });

  it("ground runs on the − rail, the board's supply on a + rail, each fed by ONE jumper shared by its net", () => {
    const { connections, layout, nets } = wire(FIXTURES.doorbell);
    const l = layout();
    const rails = railNets(connections, l);
    expect(rails.get("GND")).toBe(10);
    const segs = buildWires({ connections, layout: l, getPart, nets });
    for (const [net] of rails) {
      // (the − rail bridge, rail to rail, is not a feed)
      const bridge = (s: WireSegment) => s.ends.every((e) => e.kind === "hole" && e.row >= 10);
      const feeds = segs.filter((s) => s.shared && !bridge(s) && connections.find((c) => c.id === s.id)!.net === net);
      expect(feeds, net).toHaveLength(1);
      const all = connections.filter((c) => c.net === net).map((c) => c.id);
      expect(feeds[0].id).toBe(all[0]);
      expect(feeds[0].shared).toEqual(all);
      expect(feeds[0].colour).toBe(net === "GND" ? "black" : "red");
    }
    // A net that touches neither the board nor a plugged part (battery → charger) stays a direct wire.
    const bat = connections.find((c) => c.net === "VBAT")!;
    expect(rails.has("VBAT")).toBe(false);
    expect(segs.filter((s) => s.id === bat.id)).toHaveLength(1);
  });

  it("ground above the board's middle goes to the top − rail, bridged once to the bottom one", () => {
    const { connections, layout, nets } = wire(FIXTURES.plant);
    const l = layout();
    const segs = buildWires({ connections, layout: l, getPart, nets });
    const top = segs.filter((s) => s.ends.some((e) => e.kind === "hole" && e.row === 12));
    expect(top.length).toBeGreaterThan(1);
    const bridges = segs.filter((s) => s.ends[0].kind === "hole" && s.ends[0].row === 10 && s.ends[1].kind === "hole" && s.ends[1].row === 12);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].id).toBe(connections.find((c) => c.net === "GND")!.id);
    expect(bridges[0].shared).toEqual(connections.filter((c) => c.net === "GND").map((c) => c.id));
  });

  it("lifted parts drag their wire ends up; holes stay down", () => {
    const { connections, layout, nets } = wire(FIXTURES.uno);
    const l = layout();
    const lift = apartLift(l);
    const flat = buildWires({ connections, layout: l, getPart, nets });
    const up = buildWires({ connections, layout: l, getPart, nets, lift: (id) => lift.get(id) ?? 0 });
    const c = connections.find(
      (x) => !x.viaPart && x.role !== "power" && x.role !== "ground" && !l.placements.find((p) => p.instanceId === x.to.part)!.breadboard,
    )!;
    const i = flat.findIndex((s) => s.id === c.id);
    expect(up[i].points.at(-1)![2] - flat[i].points.at(-1)![2]).toBeCloseTo(lift.get(c.to.part)!);
    const hole = flat.findIndex((s) => s.ends[1].kind === "hole");
    expect(up[hole].points.at(-1)).toEqual(flat[hole].points.at(-1));
  });

  it("jumpers rise straight out of their holes and lie low on the breadboard top", () => {
    const { connections, layout, nets } = wire(FIXTURES.doorbell);
    const l = layout();
    const bb = l.breadboard!;
    for (const s of buildWires({ connections, layout: l, getPart, nets })) {
      s.ends.forEach((e, i) => {
        if (e.kind !== "hole") return;
        const pts = i === 0 ? s.points : [...s.points].reverse();
        // Straight up first, then flat a wire radius above the breadboard top.
        expect(pts[1][0]).toBeCloseTo(pts[0][0], 6);
        expect(pts[1][1]).toBeCloseTo(pts[0][1], 6);
        expect(pts[1][2]).toBeGreaterThan(pts[0][2]);
        expect(Math.min(...pts.slice(1, 8).map((p) => p[2]))).toBeGreaterThan(bb.h - 1);
      });
      // A flat run on the breadboard sits exactly one wire radius above it (no arches).
      const onTop = s.points.filter((p) => Math.abs(p[2] - (bb.h + WIRE_R)) < 1e-6);
      if (s.ends.every((e) => e.kind === "hole")) expect(onTop.length).toBeGreaterThan(0);
    }
  });

  it("holes the wires end in are real holes of the board", () => {
    const { connections, layout, nets } = wire(FIXTURES.plant);
    const l = layout();
    const segs: WireSegment[] = buildWires({ connections, layout: l, getPart, nets });
    const keys = new Set(allHoles(l.breadboard!.cols).map((h) => `${h.col}:${h.row}`));
    for (const s of segs)
      s.ends.forEach((e, i) => {
        if (e.kind !== "hole") return;
        expect(keys.has(`${e.col}:${e.row}`)).toBe(true);
        expect(i === 0 ? s.points[0] : s.points.at(-1)).toEqual(holeWorld(l.breadboard!, e));
      });
  });
});
