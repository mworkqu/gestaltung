// 3D wiring (P5-17): where each pin of a library part sits on its 3D model.
//
// Pure (no three.js): the 3D wiring view, tests and anything else can ask
// "where is GPIO4 on the ESP32 model" without building the model.
//
// Frame = the procedural models' frame (lib/studio/models/types.ts): mm, Z up,
// part centred in XY, sitting on z = 0. `dir` is the way a wire leaves the pin
// (up for header pins, outward for leads and edge pins).
//
// Order of truth (later wins, per pin):
//   1. derived from the model params: header rows (devBoard / moduleBoard
//      `rows`, 2.54 mm pitch; sockets → top of the socket, pins → pin tip),
//      else screw terminals / solder pads (moduleBoard `feats`), else the
//      oledDisplay 4-pin header; LibraryPart.pins in list order fill the slots,
//      each pin.side taking the row(s) on that side of the board;
//   2. pins left over: an evenly spaced 2.54 mm row on the pin.side edge;
//   3. OVERRIDES below (parts whose leads / pin order the derivation can't know);
//   4. part.pins3d (optional, owner-editable in the library data).

import type { LibraryPart, Pin } from "../schema";

export type Vec3 = [number, number, number];
export type Pin3d = { pos: Vec3; dir: Vec3 };
export type Pins3d = Record<string, Pin3d>;

export const PITCH = 2.54;
const UP: Vec3 = [0, 0, 1];

type Side = NonNullable<Pin["side"]>;
const SIDE_DIR: Record<Side, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] };

type Slot = Pin3d;
type SlotRow = { slots: Slot[]; cx: number; cy: number };

type F = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const arr = (v: unknown): F[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as F[]) : []);

function row(xs: [number, number][], z: number): SlotRow {
  const slots = xs.map(([x, y]) => ({ pos: [x, y, z] as Vec3, dir: UP }));
  const cx = xs.reduce((t, p) => t + p[0], 0) / Math.max(1, xs.length);
  const cy = xs.reduce((t, p) => t + p[1], 0) / Math.max(1, xs.length);
  return { slots, cx, cy };
}

/** Points of an n-slot line centred on (x, y) along X or Y. */
function line(x: number, y: number, n: number, pitch: number, alongY: boolean): [number, number][] {
  const len = n * pitch;
  return Array.from({ length: n }, (_, i) => {
    const o = -len / 2 + pitch * (i + 0.5);
    return alongY ? [x, y + o] : [x + o, y];
  });
}

/** Slot rows read from the model params (empty when the builder has none). */
export function slotRows(part: LibraryPart): SlotRow[] {
  if (part.model.kind !== "procedural") return [];
  const p = part.model.params;
  const dz = part.dims.z;
  switch (part.model.builder) {
    case "devBoard": {
      const t = num(p.boardT, 1.6);
      return arr(p.rows).map((r) => {
        const n = Math.max(1, Math.round(num(r.n, 1)));
        const z = str(r.kind, "pins") === "socket" ? t + num(r.h, 8.5) : dz;
        return row(line(num(r.x0, 0), num(r.y, 0), n, PITCH, false), z);
      });
    }
    case "moduleBoard": {
      const top = num(p.boardZ, 0) + num(p.boardT, 1.6);
      const rows = arr(p.rows).map((r) => {
        const n = Math.max(1, Math.round(num(r.n, 1)));
        const z = str(r.kind, "pins") === "socket" ? top + num(r.h, 8.5) : num(r.tip, dz);
        return row(line(num(r.x, 0), num(r.y, 0), n, num(r.pitch, PITCH), str(r.axis, "x") === "y"), z);
      });
      if (rows.length) return rows;
      const out: SlotRow[] = [];
      for (const f of arr(p.feats)) {
        const k = str(f.t, "box");
        const n = Math.max(1, Math.round(num(f.n, 2)));
        const z = num(f.z, top);
        if (k === "screw") out.push(row(line(num(f.x, 0), num(f.y, 0), n, num(f.pitch, 5.08), str(f.axis, "y") === "y"), z + num(f.h, 10)));
      }
      for (const f of arr(p.feats)) {
        if (str(f.t, "box") !== "pads") continue;
        const n = Math.max(1, Math.round(num(f.n, 2)));
        const pitch = num(f.pitch, 3.4);
        const alongY = str(f.axis, "y") === "y";
        // pads are centred on (x, y) with (j - (n-1)/2) * pitch spacing — same as line().
        out.push(row(line(num(f.x, 0), num(f.y, 0), n, pitch, alongY), num(f.z, top) + 0.12));
      }
      return out;
    }
    case "oledDisplay":
      return [row(line(0, -part.dims.y / 2 + 1.7, 4, PITCH, false), dz)];
    default:
      return [];
  }
}

/** Outward direction of the nearest bbox face (top counts, bottom does not). */
export function inferDir(pos: Vec3, dims: LibraryPart["dims"]): Vec3 {
  const [x, y, z] = pos;
  const cands: [number, Vec3][] = [
    [dims.z - z, UP],
    [dims.x / 2 - x, [1, 0, 0]],
    [x + dims.x / 2, [-1, 0, 0]],
    [dims.y / 2 - y, [0, 1, 0]],
    [y + dims.y / 2, [0, -1, 0]],
  ];
  cands.sort((a, b) => a[0] - b[0]);
  return cands[0][1];
}

/** Evenly spaced pins on one edge of the part's footprint (2.54 mm, squeezed to fit). */
function edgeRow(part: LibraryPart, side: Side, n: number): Slot[] {
  const { x: dx, y: dy, z: dz } = part.dims;
  const alongY = side === "left" || side === "right";
  const edgeLen = alongY ? dy : dx;
  const pitch = Math.min(PITCH, (edgeLen * 0.9) / Math.max(1, n));
  const [sx, sy] = SIDE_DIR[side];
  const z = Math.min(dz, Math.max(0.8, dz * 0.4));
  return line((sx * dx) / 2, (sy * dy) / 2, n, pitch, alongY).map(([x, y]) => ({ pos: [x, y, z], dir: [sx, sy, 0] }));
}

// ── Overrides ───────────────────────────────────────────────────────────────

type OverrideEntry = { slot: [row: number, index: number] } | { at: Vec3; dir?: Vec3 };
type Override = Record<string, OverrideEntry>;

const slots = (ids: string[], r: number, start: number, step = 1): Override =>
  Object.fromEntries(ids.map((id, i) => [id, { slot: [r, start + i * step] as [number, number] }]));
const at = (pos: Vec3, dir?: Vec3): OverrideEntry => ({ at: pos, dir });

const ESP32_L = ["EN", "GPIO36", "GPIO39", "GPIO34", "GPIO35", "GPIO32", "GPIO33", "GPIO25", "GPIO26", "GPIO27", "GPIO14", "GPIO12", "GPIO13", "GND_L", "VIN"];
const ESP32_R = ["GPIO23", "GPIO22", "GPIO1", "GPIO3", "GPIO21", "GPIO19", "GPIO18", "GPIO5", "GPIO17", "GPIO16", "GPIO4", "GPIO2", "GPIO15", "GND_R", "3V3"];

/**
 * Parts whose real pinout the generic fill can't know. Rows/indices refer to
 * slotRows(part) (params order, slot 0 at the -x / -y end).
 */
export const OVERRIDES: Record<string, Override> = {
  // Real Uno headers (USB at -x): top 10-pin = SCL SDA AREF GND D13…D8, then D7…D0;
  // bottom 8-pin = NC IOREF RESET 3V3 5V GND GND VIN, then A0…A5.
  arduino_uno: {
    GND_3: { slot: [0, 3] },
    ...slots(["D13", "D12", "D11", "D10", "D9", "D8"], 0, 4),
    ...slots(["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"], 1, 0),
    ...slots(["3V3", "5V", "GND_1", "GND_2", "VIN"], 2, 3),
    ...slots(["A0", "A1", "A2", "A3", "A4", "A5"], 3, 0),
  },
  // DevKit V1: EN / GPIO23 sit at the antenna end (+x), VIN / 3V3 next to the USB (-x).
  esp32_devkit: { ...slots(ESP32_L, 0, 14, -1), ...slots(ESP32_R, 1, 14, -1) },
  // Legs: anode = long leg at +x (models/led.ts), wire taken just above the mat.
  led_5mm: { A: at([1.27, 0, 1.2], [1, 0, 0]), K: at([-1.27, 0, 1.2], [-1, 0, 0]) },
  // Bent leads at ±(dx − 0.6) / 2 (models/resistor.ts).
  resistor_220: { "1": at([-5.1, 0, 1.6], [-1, 0, 0]), "2": at([5.1, 0, 1.6], [1, 0, 0]) },
  // Two of the four legs (models/pushButton.ts).
  button_6mm: { A: at([-2.5, -1.7, 1.5], [-1, 0, 0]), B: at([2.5, -1.7, 1.5], [1, 0, 0]) },
  // Red / black leads out of the +x end, at the body's centre height (models/waterPump.ts).
  pump_5v: { M_PLUS: at([26.5, -1.6, 12], [1, 0, 0]), M_MINUS: at([26.5, 1.6, 12], [1, 0, 0]) },
  // Brown / red / orange leads out of the -x end (models/servo.ts).
  sg90_servo: {
    GND: at([-15.8, -1.6, 5], [-1, 0, 0]),
    VCC: at([-15.8, 0, 5], [-1, 0, 0]),
    SIG: at([-15.8, 1.6, 5], [-1, 0, 0]),
  },
  // Solder pads 5V / DIN / GND at 210° / 270° / 330° on the rim (models/ledRing.ts).
  ws2812_ring: {
    VCC: at(polar(210, 16.9, 1.72)),
    DIN: at(polar(270, 16.9, 1.72)),
    GND: at(polar(330, 16.9, 1.72)),
  },
  // 3-pin JST at x = 44 (6 mm wide): the cable plugs in from the +x end.
  soil_moisture_cap: {
    VCC: at([47, -2.54, 4.6], [1, 0, 0]),
    AOUT: at([47, 0, 4.6], [1, 0, 0]),
    GND: at([47, 2.54, 4.6], [1, 0, 0]),
  },
  // Red / black lead into the white JST plug at the -x end (models/lipoPouch.ts).
  lipo_1000: {
    BAT_PLUS: at([-31, 1.0, 3.25], [-1, 0, 0]),
    BAT_MINUS: at([-31, -1.0, 3.25], [-1, 0, 0]),
  },
  // Four pins toward -y across the body width; pin 3 is not connected (models/dht22.ts).
  dht22: {
    VCC: at([0, -15, 7.55 - 1.5 * PITCH], [0, -1, 0]),
    DATA: at([0, -15, 7.55 - 0.5 * PITCH], [0, -1, 0]),
    GND: at([0, -15, 7.55 + 1.5 * PITCH], [0, -1, 0]),
  },
};

function polar(deg: number, r: number, z: number): Vec3 {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const a = (deg * Math.PI) / 180;
  return [round(Math.cos(a) * r), round(Math.sin(a) * r), z];
}

// ── Derivation ──────────────────────────────────────────────────────────────

function derive(part: LibraryPart, rows: SlotRow[]): Pins3d {
  const out: Pins3d = {};
  const used = rows.map((r) => r.slots.map(() => false));
  const sides: Side[] = [];
  const bySide = new Map<Side, Pin[]>();
  for (const p of part.pins) {
    const s: Side = p.side ?? "bottom";
    if (!bySide.has(s)) {
      bySide.set(s, []);
      sides.push(s);
    }
    bySide.get(s)!.push(p);
  }
  const leftover = new Map<Side, Pin[]>();
  for (const side of sides) {
    const [sx, sy] = SIDE_DIR[side];
    // Rows on this side of the board first (ties: params order).
    const order = rows
      .map((r, i) => ({ i, score: Math.round((r.cx * sx + r.cy * sy) * 100) / 100 }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.i);
    for (const pin of bySide.get(side)!) {
      let placed = false;
      for (const ri of order) {
        const k = used[ri].indexOf(false);
        if (k < 0) continue;
        used[ri][k] = true;
        out[pin.id] = rows[ri].slots[k];
        placed = true;
        break;
      }
      if (!placed) leftover.set(side, [...(leftover.get(side) ?? []), pin]);
    }
  }
  for (const [side, pins] of leftover) {
    const edge = edgeRow(part, side, pins.length);
    pins.forEach((p, i) => {
      out[p.id] = edge[i];
    });
  }
  return out;
}

const cache = new WeakMap<LibraryPart, Pins3d>();

/** Position + exit direction of every pin of `part` on its 3D model (mm, Z up). */
export function pins3dFor(part: LibraryPart): Pins3d {
  const hit = cache.get(part);
  if (hit) return hit;
  const rows = slotRows(part);
  const out = derive(part, rows);
  const ids = new Set(part.pins.map((p) => p.id));
  const apply = (ov: Override | undefined) => {
    if (!ov) return;
    for (const [id, e] of Object.entries(ov)) {
      if (!ids.has(id)) continue;
      if ("slot" in e) {
        const s = rows[e.slot[0]]?.slots[e.slot[1]];
        if (s) out[id] = s;
      } else {
        out[id] = { pos: e.at, dir: e.dir ?? inferDir(e.at, part.dims) };
      }
    }
  };
  apply(OVERRIDES[part.id]);
  if (part.pins3d) {
    apply(Object.fromEntries(Object.entries(part.pins3d).map(([id, pos]) => [id, at(pos as Vec3)])));
  }
  cache.set(part, out);
  return out;
}
