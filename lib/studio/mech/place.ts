// Where each printable part goes (enclosure coords: mm, Z up, XY centred, the
// base bottom at z = 0) and its exploded-view vector. Pure + deterministic.
//
// Rules:
//  * standoff      — under the N-th mount hole of its forInstance part (hole in
//                    part-local coords → rotZ → layout pos + contentOffset),
//                    base on the floor (floorZ); height = floor → board underside
//                    when that gap is ≥ the template minimum, else its own height;
//  * pcb_cradle    — under its board (centre, rotZ), on the floor;
//  * battery_clip  — around the cell, axis along the cell's long side, on the floor;
//  * button_extender / light_pipe — on top of the button / LED (its +z port),
//                    up through the lid; explode up past the lid;
//  * sensor_mount  — at its part, on the floor; explode outwards;
//  * cable_clip    — on the floor next to the MCU (+x side, clamped in the cavity);
//  * wall_bracket  — behind the base, outside (−y), lip under the floor; explode −y;
//  * lid / base    — enclosure origin (template fallback: lid at H − thickness);
//                    explode like explode.ts (lid up H·0.9, base down 10 mm).
// Anything without a usable target falls back to a deterministic floor slot.

import { MECH_PARAMS, type LayoutItem, type LibraryPart, type MechPart } from "../schema";
import { rotateXY, type LayoutResult } from "../layout";
import { BASE_DROP_MM, LID_LIFT, type Vec3 } from "../explode";
import { clampParams, type MechParams } from "./templates";

/** The enclosure numbers placement needs (EnclosureDims satisfies it). */
export type MechDims = {
  W: number;
  D: number;
  H: number;
  wall: number;
  floorZ: number;
  splitZ: number;
  contentOffset: Vec3;
};

export type MechPlacement = {
  id: string;
  position: Vec3;
  /** Degrees about +z (0 / 90 / 180 / 270 from the layout, else 0). */
  rotZ: number;
  explode: Vec3;
  /** Clamped params actually used to build (standoff height may be fitted). */
  params: MechParams;
};

/** Enclosure numbers from a bare layout (no enclosure built): 2 mm walls, 2 mm clearance. */
export function dimsFromLayout(layout: Pick<LayoutResult, "footprint" | "height">, wall = 2, clearance = 2): MechDims {
  const W = layout.footprint.w + 2 * (wall + clearance);
  const D = layout.footprint.d + 2 * (wall + clearance);
  const H = layout.height + 2 * wall + clearance;
  return { W, D, H, wall, floorZ: wall, splitZ: Math.round(H * 0.68 * 10) / 10, contentOffset: [0, 0, wall] };
}

const FLOOR_DROP = BASE_DROP_MM * 0.5;
const r3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};
const vec = (x: number, y: number, z: number): Vec3 => [r3(x), r3(y), r3(z)];

type Ctx = { layout: LayoutResult; parts: Map<string, LibraryPart>; dims: MechDims };

function target(ctx: Ctx, instanceId: string | undefined): { item: LayoutItem; part: LibraryPart } | null {
  if (!instanceId) return null;
  const item = ctx.layout.layout.find((l) => l.instanceId === instanceId);
  const part = ctx.parts.get(instanceId);
  return item && part ? { item, part } : null;
}

/** Part-local point → enclosure coords. */
function toWorld(ctx: Ctx, item: LayoutItem, lx: number, ly: number, lz: number): Vec3 {
  const [rx, ry] = rotateXY(lx, ly, item.rotZ);
  const [ox, oy, oz] = ctx.dims.contentOffset;
  return [item.pos[0] + rx + ox, item.pos[1] + ry + oy, item.pos[2] + lz + oz];
}

/** Unit XY direction from the cavity centre (fallback +x), scaled. */
function outward(p: Vec3, len: number): [number, number] {
  const l = Math.hypot(p[0], p[1]);
  return l > 1e-6 ? [(p[0] / l) * len, (p[1] / l) * len] : [len, 0];
}

function topPort(part: LibraryPart, kinds: string[]): { x: number; y: number } {
  const p = part.ports.find((q) => q.face === "+z" && kinds.includes(q.kind)) ?? part.ports.find((q) => q.face === "+z");
  if (!p) return { x: 0, y: 0 };
  return { x: -part.dims.x / 2 + p.at.u * part.dims.x, y: -part.dims.y / 2 + p.at.v * part.dims.y };
}

/** Deterministic floor slot for parts with no target: a row along the front. */
function floorSlot(ctx: Ctx, n: number): Vec3 {
  const { W, D, wall, floorZ } = ctx.dims;
  const usable = Math.max(1, W - 2 * wall - 10);
  const x = -usable / 2 + ((n * 12) % usable);
  return [r3(x), r3(-D / 2 + wall + 6), r3(floorZ)];
}

export function placeMechParts(
  mech: readonly MechPart[],
  layout: LayoutResult,
  parts: Map<string, LibraryPart>,
  dims: MechDims,
): MechPlacement[] {
  const ctx: Ctx = { layout, parts, dims };
  const holeIndex = new Map<string, number>();
  let free = 0;
  const lidUp = dims.H * LID_LIFT;

  return mech.map((m) => {
    const params = clampParams(m.template, m.params);
    const t = target(ctx, m.forInstance);
    const out = (position: Vec3, explode: Vec3, rotZ = 0): MechPlacement => ({
      id: m.id,
      position: vec(...position),
      rotZ,
      explode: vec(...explode),
      params,
    });
    const fallback = (explode: Vec3 = [0, 0, -FLOOR_DROP]) => out(floorSlot(ctx, free++), explode);

    switch (m.template) {
      case "standoff": {
        const holes = t?.part.mount?.holes ?? [];
        const key = m.forInstance ?? "";
        const i = holeIndex.get(key) ?? 0;
        if (!t || i >= holes.length) return fallback();
        holeIndex.set(key, i + 1);
        const h = holes[i];
        const p = toWorld(ctx, t.item, h.x, h.y, 0);
        const gap = p[2] - dims.floorZ;
        const [min, max] = MECH_PARAMS.standoff.height;
        if (gap >= min) params.height = Math.min(max, gap);
        const c = toWorld(ctx, t.item, 0, 0, 0);
        const [ox, oy] = outward([p[0] - c[0], p[1] - c[1], 0], 3);
        return out([p[0], p[1], dims.floorZ], [ox, oy, -FLOOR_DROP], 0);
      }
      case "pcb_cradle": {
        if (!t) return fallback();
        const c = toWorld(ctx, t.item, 0, 0, 0);
        return out([c[0], c[1], dims.floorZ], [0, 0, -FLOOR_DROP], t.item.rotZ);
      }
      case "battery_clip": {
        if (!t) return fallback();
        const c = toWorld(ctx, t.item, 0, 0, 0);
        const along = t.part.dims.x >= t.part.dims.y ? 0 : 90;
        const [ox, oy] = outward(c, 6);
        return out([c[0], c[1], dims.floorZ], [ox, oy, -FLOOR_DROP], (t.item.rotZ + along) % 360);
      }
      case "button_extender":
      case "light_pipe": {
        if (!t) return fallback([0, 0, lidUp + 8]);
        const port = topPort(t.part, m.template === "button_extender" ? ["button_cap"] : ["led_light_pipe"]);
        const p = toWorld(ctx, t.item, port.x, port.y, t.part.dims.z);
        return out(p, [0, 0, lidUp + 8], 0);
      }
      case "sensor_mount": {
        const c = t ? toWorld(ctx, t.item, 0, 0, 0) : floorSlot(ctx, free++);
        const [ox, oy] = outward(c, Math.max(12, dims.H * 0.45));
        return out([c[0], c[1], dims.floorZ], [ox, oy, 4], t ? t.item.rotZ : 0);
      }
      case "cable_clip": {
        const mcu =
          target(ctx, m.forInstance) ??
          layout.layout
            .map((item) => ({ item, part: parts.get(item.instanceId)! }))
            .find((x) => x.part?.category === "mcu") ??
          null;
        const half = params.cableD / 2 + Math.max(1.2, params.cableD * 0.25) + 3;
        const limX = dims.W / 2 - dims.wall - half;
        const limY = dims.D / 2 - dims.wall - params.width / 2;
        let x = 0, y = 0;
        if (mcu) {
          const c = toWorld(ctx, mcu.item, 0, 0, 0);
          const w = mcu.item.rotZ === 90 || mcu.item.rotZ === 270 ? mcu.part.dims.y : mcu.part.dims.x;
          x = c[0] + w / 2 + half + 2;
          y = c[1];
        }
        x = Math.max(-limX, Math.min(limX, x));
        y = Math.max(-limY, Math.min(limY, y));
        return out([x, y, dims.floorZ], [0, 0, -FLOOR_DROP], 0);
      }
      case "wall_bracket":
        return out([0, -dims.D / 2 - 0.5, -params.thickness], [0, -25, 0], 0);
      case "lid":
        return out([0, 0, Math.max(0, dims.H - params.thickness)], [0, 0, lidUp], 0);
      case "base":
        return out([0, 0, 0], [0, 0, -BASE_DROP_MM], 0);
    }
  });
}
