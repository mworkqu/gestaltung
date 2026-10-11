// 3D wiring (P5-17e): which breadboard rail each power / ground net runs on. Pure.
//
// Only nets the board or a plugged part is on use the rails (a battery → charger
// lead stays a direct wire). Ground → the bottom − rail (the top − rail is
// bridged to it when a part above the board needs ground nearby; wires.ts).
// Supply nets, ranked by plugged parts on them, then by wires, then build
// order: the first → bottom + rail, the second → top + rail; any more stay
// direct wires.

import type { Connection } from "../connections";
import { RAIL } from "./breadboard";
import type { MatLayout } from "./layout";

export function railNets(connections: Connection[], layout: Pick<MatLayout, "placements" | "breadboard">): Map<string, number> {
  const out = new Map<string, number>();
  if (!layout.breadboard) return out;
  const on = new Set(layout.placements.filter((p) => p.board || p.breadboard).map((p) => p.instanceId));
  const plugged = new Set(layout.placements.filter((p) => p.breadboard).map((p) => p.instanceId));
  const ends = (c: Connection) => [c.from.part, c.to.part, c.viaPart].filter((x): x is string => !!x);
  const touches = (net: string) => connections.some((c) => c.net === net && ends(c).some((x) => on.has(x)));
  const pluggedOn = (net: string) => new Set(connections.filter((c) => c.net === net).flatMap(ends).filter((x) => plugged.has(x))).size;
  const count = (net: string) => connections.filter((c) => c.net === net).length;
  const firstIdx = (net: string) => connections.findIndex((c) => c.net === net);
  const netsOf = (role: Connection["role"]) =>
    [...new Set(connections.filter((c) => c.role === role).map((c) => c.net))]
      .filter(touches)
      .sort((a, b) => pluggedOn(b) - pluggedOn(a) || count(b) - count(a) || firstIdx(a) - firstIdx(b));
  const ground = netsOf("ground");
  if (ground[0]) out.set(ground[0], RAIL.bottomMinus);
  const power = netsOf("power");
  if (power[0]) out.set(power[0], RAIL.bottomPlus);
  if (power[1]) out.set(power[1], RAIL.topPlus);
  return out;
}
