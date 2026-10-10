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
//                    up through the lid; length fitted so the extender cap is
//                    THROUGH_LID.extender.proud above the lid, the pipe flush;
//  * sensor_mount  — at its part, on the floor;
//  * cable_clip    — on the floor next to the MCU (+x side, clamped in the cavity);
//  * wall_bracket  — behind the base, outside (−y), lip under the floor; explode −y;
//  * lid / base    — enclosure origin (template fallback: lid at H − thickness).
// Explode vectors use explode.ts's frame (the viewer's own numbers): helpers under a
// part follow its radial drift at a share of its lift; extenders / light pipes float
// half-way between their lifted part and the raised lid.
// Anything without a usable target falls back to a deterministic floor slot.

import { MECH_PARAMS, THROUGH_LID, type LayoutItem, type LibraryPart, type MechPart, type MechTemplate, type Port } from "../schema";
import { rotateXY, type LayoutResult } from "../layout";
import { BASE_DROP_MM, componentVector, explodeFrame, lidLiftMm, type Vec3 } from "../explode";
import { openingSize } from "../enclosure/cutouts";
import { topAt, type DomeDims } from "../enclosure/templates";
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
  /** soft_wedge: the top falls towards the front; dome_base: a domed top (topAt). */
  wedgeDeg?: number;
  dome?: DomeDims;
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

/** The port a through-lid part serves (never any other top port: a screen window is no LED). */
const THROUGH_KIND: Partial<Record<MechTemplate, Port["kind"]>> = { button_extender: "button_cap", light_pipe: "led_light_pipe" };

function matchingTopPort(part: LibraryPart | undefined, template: MechTemplate): Port | null {
  const kind = THROUGH_KIND[template];
  return (kind && part?.ports.find((q) => q.face === "+z" && q.kind === kind)) || null;
}

function portXY(part: LibraryPart, p: Port): { x: number; y: number } {
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
  // The same explode frame the viewer uses for the components (explode.ts explodeFrame).
  const exItems = layout.layout.flatMap((item) => {
    const part = parts.get(item.instanceId);
    if (!part) return [];
    const swap = item.rotZ === 90 || item.rotZ === 270;
    return [{ id: item.instanceId, pos: toWorld(ctx, item, 0, 0, 0), w: swap ? part.dims.y : part.dims.x, d: swap ? part.dims.x : part.dims.y, h: part.dims.z }];
  });
  const ex = explodeFrame(exItems, dims.H, dims.splitZ);
  const lidUp = lidLiftMm(ex.frame.H, ex.frame.tallest);
  /** Loose floor parts (clips, fallbacks) lift a little out of the base at full explode. */
  const FLOAT = ex.frame.H * 0.25;
  /** Full-explode vector of a component (zero radial / mid lift when unknown). */
  const partVec = (instanceId: string | undefined): Vec3 => {
    const i = exItems.findIndex((it) => it.id === instanceId);
    return i < 0 ? [0, 0, lidUp * 0.3] : componentVector(exItems[i].pos, ex.frame, ex.layers[i]);
  };
  /** Float under its part: same radial drift, `share` of the part's lift. */
  const under = (instanceId: string | undefined, share: number): Vec3 => {
    const v = partVec(instanceId);
    return [v[0], v[1], v[2] * share];
  };

  // Through-lid parts: keep a valid target; one whose target has no matching top port (the AI
  // or an old list put a light pipe on the "oLED" screen) moves to an unclaimed part that has one.
  const claimed = new Set<string>();
  const through = new Map<string, string | undefined>();
  for (const m of mech) {
    if (!THROUGH_KIND[m.template]) continue;
    const key = `${m.template}:${m.forInstance}`;
    if (m.forInstance && matchingTopPort(parts.get(m.forInstance), m.template) && !claimed.has(key)) {
      claimed.add(key);
      through.set(m.id, m.forInstance);
    }
  }
  for (const m of mech) {
    if (!THROUGH_KIND[m.template] || through.has(m.id)) continue;
    const next = layout.layout.find(
      (it) => matchingTopPort(parts.get(it.instanceId), m.template) && !claimed.has(`${m.template}:${it.instanceId}`),
    );
    if (next) claimed.add(`${m.template}:${next.instanceId}`);
    through.set(m.id, next?.instanceId);
  }

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
    const fallback = (explode: Vec3 = [0, 0, FLOAT]) => out(floorSlot(ctx, free++), explode);

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
        // Explode: half-way between the dropped floor and its lifted board.
        return out([p[0], p[1], dims.floorZ], under(t.item.instanceId, 0.45), 0);
      }
      case "pcb_cradle": {
        if (!t) return fallback();
        const c = toWorld(ctx, t.item, 0, 0, 0);
        return out([c[0], c[1], dims.floorZ], under(t.item.instanceId, 0.4), t.item.rotZ);
      }
      case "battery_clip": {
        if (!t) return fallback();
        const c = toWorld(ctx, t.item, 0, 0, 0);
        const along = t.part.dims.x >= t.part.dims.y ? 0 : 90;
        return out([c[0], c[1], dims.floorZ], under(t.item.instanceId, 0.4), (t.item.rotZ + along) % 360);
      }
      case "button_extender":
      case "light_pipe": {
        const tt = target(ctx, through.get(m.id));
        const port = tt && matchingTopPort(tt.part, m.template);
        if (!tt || !port) return fallback();
        const local = portXY(tt.part, port);
        const p = toWorld(ctx, tt.item, local.x, local.y, tt.part.dims.z);
        // Length from the part's real top (after settleLayout) to the lid's outer top here.
        const gap = topAt(dims, p[1], p[0]) - p[2];
        const opening = openingSize(port).w;
        if (m.template === "button_extender") {
          const e = THROUGH_LID.extender;
          const [lo, hi] = MECH_PARAMS.button_extender.length;
          params.length = Math.min(hi, Math.max(lo, gap + e.proud - e.flange - e.capT));
          const [dLo, dHi] = MECH_PARAMS.button_extender.capD;
          params.capD = Math.min(dHi, Math.max(dLo, opening - 2 * THROUGH_LID.play));
        } else {
          const [lo, hi] = MECH_PARAMS.light_pipe.length;
          params.length = Math.min(hi, Math.max(lo, gap + THROUGH_LID.lightPipe.proud));
          const [dLo, dHi] = MECH_PARAMS.light_pipe.d;
          params.d = Math.min(dHi, Math.max(dLo, Math.min(params.d, opening - 2 * THROUGH_LID.play)));
        }
        // Explode: float half-way between its lifted part and the raised lid.
        const v = partVec(tt.item.instanceId);
        return out(p, [v[0], v[1], (v[2] + lidUp) / 2], 0);
      }
      case "sensor_mount": {
        const c = t ? toWorld(ctx, t.item, 0, 0, 0) : floorSlot(ctx, free++);
        return out([c[0], c[1], dims.floorZ], t ? under(t.item.instanceId, 0.4) : [0, 0, FLOAT], t ? t.item.rotZ : 0);
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
        return out([x, y, dims.floorZ], [0, 0, FLOAT], 0);
      }
      case "wall_bracket":
        return out([0, -dims.D / 2 - 0.5, -params.thickness], [0, -Math.max(25, dims.H * 0.6), -BASE_DROP_MM], 0);
      case "lid":
        return out([0, 0, Math.max(0, dims.H - params.thickness)], [0, 0, lidUp], 0);
      case "base":
        return out([0, 0, 0], [0, 0, -BASE_DROP_MM], 0);
    }
  });
}
