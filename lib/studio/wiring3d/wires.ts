// 3D wiring (P5-17): wire paths from pin to pin.
//
// Pure. A wire leaves its pin along the pin's exit direction, arches through a
// lifted midpoint and comes down into the other pin: the control points here go
// through a centripetal Catmull-Rom spline in the view (TubeGeometry). A
// connection with a series helper (`viaPart`, a resistor) is two segments with
// the same id and colour: board pin → helper leg a, helper leg b → host pin.

import type { Connection, WireColour } from "../connections";
import type { LibraryPart, Net } from "../schema";
import { pinWorld, type MatLayout, type Placement } from "./layout";
import { pins3dFor, type Pin3d, type Vec3 } from "./pins3d";

export type WireSegment = {
  /** Connection id (c1…); a via connection has two segments with the same id. */
  id: string;
  /** 0 = the only / first segment, 1 = helper → host. */
  part: 0 | 1;
  colour: WireColour;
  points: Vec3[];
};

/** Straight lead out of a pin before the wire bends (mm). */
export const LEAD = 5;

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/**
 * Control points for one wire: pin, a short lead along each pin's exit
 * direction, and a lifted midpoint (higher for longer wires). `spread` shifts
 * the midpoint sideways so parallel wires don't sit in one tube.
 */
export function wirePath(a: Pin3d, b: Pin3d, spread = 0): Vec3[] {
  const a1 = add(a.pos, a.dir, LEAD);
  const b1 = add(b.pos, b.dir, LEAD);
  const dx = b1[0] - a1[0];
  const dy = b1[1] - a1[1];
  const flat = Math.hypot(dx, dy);
  const top = Math.max(a1[2], b1[2]) + 6 + flat * 0.14;
  // Sideways unit vector in the mat plane.
  const nx = flat > 1e-6 ? -dy / flat : 1;
  const ny = flat > 1e-6 ? dx / flat : 0;
  const mid: Vec3 = [(a1[0] + b1[0]) / 2 + nx * spread, (a1[1] + b1[1]) / 2 + ny * spread, top];
  if (flat < 2 && Math.abs(a1[2] - b1[2]) < 2) return [a.pos, a1, b1, b.pos];
  return [a.pos, a1, mid, b1, b.pos];
}

/** The helper leg on the board side of a via connection, then the other one. */
export function viaLegs(c: Connection, helper: LibraryPart, nets: Net[]): [string, string] | null {
  if (!c.viaPart || helper.pins.length < 2) return null;
  const net = nets.find((n) => n.name === c.net);
  const near = helper.pins.find((p) => net?.pins.includes(`${c.viaPart}.${p.id}`)) ?? helper.pins[0];
  const far = helper.pins.find((p) => p.id !== near.id);
  return far ? [near.id, far.id] : null;
}

export type WireInput = {
  connections: Connection[];
  layout: MatLayout;
  getPart: (partId: string) => LibraryPart | undefined;
  nets: Net[];
  /** Per-instance lift ("Take it apart"), mm. */
  lift?: (instanceId: string) => number;
  /** Only build these connections (the wire spread still follows each one's place in `connections`). */
  only?: (c: Connection) => boolean;
};

/** Does this connection touch the part (either end or its series helper)? */
export const touchesPart = (c: Connection, instanceId: string) =>
  c.from.part === instanceId || c.to.part === instanceId || c.viaPart === instanceId;

/** Every wire segment of the circuit, in connection order. Ends with a missing part/pin are skipped. */
export function buildWires({ connections, layout, getPart, nets, lift, only }: WireInput): WireSegment[] {
  const byId = new Map<string, Placement>(layout.placements.map((p) => [p.instanceId, p]));
  const end = (inst: string, partId: string, pin: string): Pin3d | null => {
    const pl = byId.get(inst);
    const part = getPart(partId);
    const p = part ? pins3dFor(part)[pin] : undefined;
    return pl && p ? pinWorld(pl, p, lift?.(inst) ?? 0) : null;
  };
  const out: WireSegment[] = [];
  connections.forEach((c, i) => {
    if (only && !only(c)) return;
    const spread = ((i % 5) - 2) * 1.6;
    const a = end(c.from.part, c.from.partId, c.from.pin);
    const b = end(c.to.part, c.to.partId, c.to.pin);
    if (!a || !b) return;
    const helper = c.viaPartId ? getPart(c.viaPartId) : undefined;
    const legs = c.viaPart && helper ? viaLegs(c, helper, nets) : null;
    if (c.viaPart && c.viaPartId && legs) {
      const ha = end(c.viaPart, c.viaPartId, legs[0]);
      const hb = end(c.viaPart, c.viaPartId, legs[1]);
      if (ha && hb) {
        out.push({ id: c.id, part: 0, colour: c.wireColour, points: wirePath(a, ha, spread) });
        out.push({ id: c.id, part: 1, colour: c.wireColour, points: wirePath(hb, b, spread) });
        return;
      }
    }
    out.push({ id: c.id, part: 0, colour: c.wireColour, points: wirePath(a, b, spread) });
  });
  return out;
}
