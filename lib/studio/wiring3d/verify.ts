// 3D wiring (P5-17e): electrical check of the breadboard build. Pure; used by the tests.
//
// Every jumper end must land on a pin of its connection, or in a breadboard hole
// that is electrically on the connection's net: a rail carrying that net, or a
// column group holding a plugged pin of that net. No column group may hold
// plugged pins of two different nets.

import type { Connection } from "../connections";
import type { LibraryPart, Net } from "../schema";
import { groupOf, holeWorld } from "./breadboard";
import { pinWorld, type MatLayout } from "./layout";
import { pins3dFor, type Vec3 } from "./pins3d";
import { railNets, type WireEnd, type WireSegment } from "./wires";

const same = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

/** Nets a connection runs on (a series helper adds its far side). */
export function connectionNets(c: Connection, nets: Net[]): Set<string> {
  const out = new Set([c.net]);
  for (const n of nets) {
    if (c.viaPart && n.pins.some((r) => r.startsWith(`${c.viaPart}.`))) out.add(n.name);
    if (n.pins.includes(`${c.to.part}.${c.to.pin}`)) out.add(n.name);
  }
  return out;
}

/** Net of each column group from the plugged pins; conflicts are reported. */
export function groupNets(layout: MatLayout): { nets: Map<string, string | null>; conflicts: string[] } {
  const nets = new Map<string, string | null>();
  const conflicts: string[] = [];
  for (const p of layout.placements) {
    if (!p.breadboard) continue;
    for (const h of p.holes ?? []) {
      const g = groupOf(h);
      const net = p.pinNets?.[h.id] ?? null;
      if (nets.has(g) && nets.get(g) !== net) conflicts.push(`${g}: ${nets.get(g)} vs ${net} (${p.instanceId}.${h.id})`);
      if (!nets.has(g)) nets.set(g, net);
    }
  }
  return { nets, conflicts };
}

/** Problems with the jumpers (empty = every end lands where it should). */
export function wireProblems(
  segs: WireSegment[],
  connections: Connection[],
  layout: MatLayout,
  getPart: (id: string) => LibraryPart | undefined,
  nets: Net[],
): string[] {
  const out: string[] = [];
  const byId = new Map(layout.placements.map((p) => [p.instanceId, p]));
  const rails = railNets(connections, layout);
  const { nets: gnets, conflicts } = groupNets(layout);
  out.push(...conflicts);
  for (const c of connections) {
    const mine = segs.filter((s) => s.id === c.id);
    if (!mine.length) out.push(`${c.id}: no segment`);
    const cn = connectionNets(c, nets);
    const pinsOf = new Set([`${c.from.part}.${c.from.pin}`, `${c.to.part}.${c.to.pin}`]);
    for (const b of c.bundle ?? []) for (const e of [b.from, b.to]) pinsOf.add(`${e.part}.${e.pin}`);
    if (c.viaPart) for (const p of getPart(c.viaPartId ?? "")?.pins ?? []) pinsOf.add(`${c.viaPart}.${p.id}`);
    for (const s of mine) {
      if (s.colour !== c.wireColour) out.push(`${c.id}: colour ${s.colour}`);
      s.ends.forEach((e: WireEnd, i) => {
        const pt = i === 0 ? s.points[0] : s.points[s.points.length - 1];
        if (e.kind === "pin") {
          if (!pinsOf.has(`${e.part}.${e.pin}`)) out.push(`${c.id}: ends on ${e.part}.${e.pin}, not its pin`);
          const pl = byId.get(e.part);
          const part = pl ? getPart(pl.partId) : undefined;
          const pin = part ? pins3dFor(part)[e.pin] : undefined;
          if (!pl || !pin) out.push(`${c.id}: unknown pin ${e.part}.${e.pin}`);
          else if (pl.breadboard) out.push(`${c.id}: wire to the pin of a plugged part ${e.part}`);
          else if (!same(pinWorld(pl, pin).pos, pt)) out.push(`${c.id}: end off its pin`);
          return;
        }
        if (!layout.breadboard) {
          out.push(`${c.id}: hole without a breadboard`);
          return;
        }
        if (!same(holeWorld(layout.breadboard, e), pt)) out.push(`${c.id}: end off its hole ${e.col}:${e.row}`);
        const g = groupOf(e);
        if (e.row >= 10) {
          // The top − rail is bridged to the bottom one (ground).
          const want = e.row === 12 ? 10 : e.row;
          const railNet = [...rails].find(([, row]) => row === want)?.[0];
          if (!railNet || !cn.has(railNet)) out.push(`${c.id}: rail ${e.row} carries ${railNet}, not ${[...cn]}`);
        } else {
          const net = gnets.get(g);
          if (!net || !cn.has(net)) out.push(`${c.id}: hole ${e.col}:${e.row} (${g}) is on ${net ?? "nothing"}, not ${[...cn]}`);
        }
      });
    }
  }
  return out;
}
