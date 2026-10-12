import { describe, expect, it } from "vitest";
import { getPart } from "../library";
import { buildWiring } from "../netlist";
import { buildConnections } from "../connections";
import { DEFAULT_SPEC, type Net } from "../schema";
import { layoutMat, movePart, type MatLayout } from "./layout";
import { crossingCount, LANE_GAP, ROUTE_CLEAR, routeWires, snapXY, type Box, type Route, type XY } from "./route";
import { buildWires, gridOrigin, planWires } from "./wires";
import { holeWorld } from "./breadboard";

const wire = (ids: string[]) => {
  const comps = ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));
  const w = buildWiring(comps, DEFAULT_SPEC, getPart, "en");
  const connections = buildConnections(w.components, w.netlist.nets, getPart);
  const items = w.components.flatMap((c) => {
    const p = getPart(c.partId);
    return p ? [{ instanceId: c.instanceId, part: p }] : [];
  });
  const nets: Net[] = w.netlist.nets;
  return { connections, items, nets, layout: () => layoutMat(items, connections, nets) };
};

const FIXTURES = {
  plant: ["esp32_c3_mini", "soil_moisture_cap", "pump_5v", "motor_driver", "ws2812_ring"],
  doorbell: ["esp32_c3_mini", "button_6mm", "speaker_amp", "led_5mm", "lipo_1000", "tp4056_usbc"],
  uno: ["arduino_uno", "soil_moisture_cap", "relay_module", "led_5mm", "oled_096_i2c", "dht22"],
  busy: ["esp32_devkit", "sg90_servo", "ws2812_ring", "button_6mm", "dht22", "oled_096_i2c", "led_5mm", "usbc_power_5v"],
  feeder: ["esp32_devkit", "sg90_servo", "usbc_power_5v", "button_6mm"],
};

/** Crossings allowed: a tidy hand-drawn layout of these circuits needs a few (≤ 0.7 per wire; a crossing = one wire hopping one other). */
const maxCrossings = (wires: number) => Math.ceil(wires * 0.7);

type Seg = { a: XY; b: XY; route: number };
const segsOf = (routes: Route[]): Seg[] =>
  routes.flatMap((r, k) => r.points.slice(1).map((p, i) => ({ a: r.points[i], b: p, route: k })));
const horizontal = (s: Seg) => Math.abs(s.a[1] - s.b[1]) < 1e-6;

/** Does the axis-aligned segment pass through the box (shrunk by `pad` from the clearance)? */
function hitsBox(s: Seg, b: Box, clear: number): boolean {
  const x0 = Math.min(s.a[0], s.b[0]);
  const x1 = Math.max(s.a[0], s.b[0]);
  const y0 = Math.min(s.a[1], s.b[1]);
  const y1 = Math.max(s.a[1], s.b[1]);
  return x1 > b.x - b.w / 2 - clear && x0 < b.x + b.w / 2 + clear && y1 > b.y - b.d / 2 - clear && y0 < b.y + b.d / 2 + clear;
}

function checkPlan(l: MatLayout, input: ReturnType<typeof wire>) {
  const plan = planWires({ connections: input.connections, layout: l, getPart, nets: input.nets });
  const { routes, nets, obstacles } = plan;
  // Runs start / end on their (snapped) ends and are axis-aligned.
  routes.forEach((r, i) => {
    expect(r.ok, r.key).toBe(true);
    expect(r.points[0]).toEqual(r.nodes[0]);
    expect(r.points.at(-1)).toEqual(r.nodes[1]);
    expect(Math.hypot(r.nodes[0][0] - nets[i].a[0], r.nodes[0][1] - nets[i].a[1]), `${r.key} start node`).toBeLessThan(LANE_GAP * 1.5);
    expect(Math.hypot(r.nodes[1][0] - nets[i].b[0], r.nodes[1][1] - nets[i].b[1]), `${r.key} end node`).toBeLessThan(LANE_GAP * 1.5);
    for (let k = 1; k < r.points.length; k++) {
      const [p, q] = [r.points[k - 1], r.points[k]];
      expect(Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6, `${r.key} segment ${k} axis-aligned`).toBe(true);
    }
  });
  // No run goes through a part it does not belong to (hard obstacles, with clearance).
  const segs = segsOf(routes);
  for (const s of segs) {
    const own = new Set(nets[s.route].own ?? []);
    for (const o of obstacles) {
      if (o.soft || own.has(o.id)) continue;
      expect(hitsBox(s, o.box, ROUTE_CLEAR - 0.05), `${routes[s.route].key} through ${o.id}`).toBe(false);
    }
  }
  // Two wires never share a lane: parallel overlapping runs keep ≥ LANE_GAP between centre lines.
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const [s, t] = [segs[i], segs[j]];
      if (s.route === t.route || horizontal(s) !== horizontal(t)) continue;
      const ax = horizontal(s) ? 0 : 1;
      const lo = Math.max(Math.min(s.a[ax], s.b[ax]), Math.min(t.a[ax], t.b[ax]));
      const hi = Math.min(Math.max(s.a[ax], s.b[ax]), Math.max(t.a[ax], t.b[ax]));
      if (hi - lo <= 1e-6) continue;
      const gap = Math.abs(s.a[1 - ax] - t.a[1 - ax]);
      expect(gap, `${routes[s.route].key} vs ${routes[t.route].key}`).toBeGreaterThanOrEqual(LANE_GAP - 1e-6);
    }
  return plan;
}

describe("route: grid", () => {
  it("snaps to the nearest grid node", () => {
    expect(snapXY([1.2, -1.4], [0, 0], 2.54)).toEqual([0, -2.54]);
    expect(snapXY([1.3, 0], [0.5, 0], 2.54)[0]).toBeCloseTo(0.5);
  });

  it("goes round an obstacle, straight runs and right angles only", () => {
    const [r] = routeWires([{ key: "w", a: [0, 0], b: [50.8, 0] }], [{ id: "box", box: { x: 25.4, y: 0, w: 10, d: 10 } }]);
    expect(r.ok).toBe(true);
    expect(r.points.length).toBeGreaterThan(2);
    for (const p of r.points) expect(Math.abs(p[1]) < 1e-6 || Math.abs(p[1]) >= 5 + ROUTE_CLEAR - 1e-6).toBe(true);
  });

  it("parallel wires form a ribbon one lane apart; deterministic", () => {
    const nets = [0, 1, 2, 3].map((k) => ({ key: `w${k}`, a: [0, k * LANE_GAP] as XY, b: [76.2, k * LANE_GAP + 20 * LANE_GAP] as XY }));
    const a = routeWires(nets, []);
    expect(routeWires(nets, [])).toEqual(a);
    expect(crossingCount(a)).toBe(0);
  });

  it("a wire that must cross another hops it once instead of a long detour", () => {
    const r = routeWires(
      [
        { key: "h", a: [0, 0], b: [50.8, 0] },
        { key: "v", a: [25.4, -25.4], b: [25.4, 25.4] },
      ],
      [],
    );
    expect(crossingCount(r)).toBe(1);
  });

  it("is fast: 20 wires in ~15 ms alone (guard: SPEED_BUDGET under the loaded parallel suite)", () => {
    const nets = Array.from({ length: 20 }, (_, k) => ({ key: `w${k}`, a: [0, k * 7.62] as XY, b: [150, 150 - k * 7.62] as XY }));
    const obstacles = [0, 1, 2].map((k) => ({ id: `o${k}`, box: { x: 40 + k * 35, y: 70, w: 20, d: 30 } }));
    expect(fastest(() => routeWires(nets, obstacles))).toBeLessThan(SPEED_BUDGET);
  });
});

/**
 * Target: < 30 ms for 20 wires (measured ~15 ms on its own). Every test file
 * runs in its own process at the same time, which slows one run 2-4x, so the
 * guard here is looser; `ROUTE_STRICT=1 npx vitest run lib/studio/wiring3d/route.test.ts` checks 30 ms.
 */
const SPEED_BUDGET = process.env.ROUTE_STRICT ? 30 : 100;

/**
 * Fastest of five runs, in CPU time of this test process (ms): the suite runs
 * every file in its own process at once, so wall time measures the machine's
 * load, CPU time measures the router.
 */
function fastest(fn: () => unknown): number {
  let best = Infinity;
  fn(); // warm up (JIT)
  fn();
  for (let k = 0; k < 5; k++) {
    const t = process.cpuUsage();
    fn();
    const d = process.cpuUsage(t);
    best = Math.min(best, (d.user + d.system) / 1000);
  }
  return best;
}

describe("route: the fixtures", () => {
  it.each(Object.entries(FIXTURES))("%s: runs on their ends, axis-aligned, clear of parts, one lane apart, few crossings", (_, ids) => {
    const f = wire(ids);
    const l = f.layout();
    const plan = checkPlan(l, f);
    expect(crossingCount(plan.routes), "crossings").toBeLessThanOrEqual(maxCrossings(plan.routes.length));
  });

  it.each(Object.entries(FIXTURES))("%s: 3D centre line starts on the pin / hole and ends on the other; flat runs low on the mat", (_, ids) => {
    const f = wire(ids);
    const l = f.layout();
    const segs = buildWires({ connections: f.connections, layout: l, getPart, nets: f.nets });
    expect(buildWires({ connections: f.connections, layout: l, getPart, nets: f.nets })).toEqual(segs);
    for (const s of segs) {
      s.ends.forEach((e, i) => {
        const pt = i === 0 ? s.points[0] : s.points.at(-1)!;
        if (e.kind === "hole") expect(pt).toEqual(holeWorld(l.breadboard!, e));
      });
      // Nothing flies: no point of a wire is higher than the tallest thing it rides over + a hop.
      const top = Math.max(l.bounds.maxZ, 20);
      for (const p of s.points) expect(p[2]).toBeLessThan(top + 6);
      // Most of each long wire lies within a few mm of the mat or the breadboard top.
      const low = s.points.filter((p) => p[2] < 4 || Math.abs(p[2] - (l.breadboard!.h + 1.1)) < 0.2).length;
      if (s.points.length > 30) expect(low / s.points.length, s.id).toBeGreaterThan(0.25);
    }
  });

  it("the grid is aligned with the breadboard holes", () => {
    const f = wire(FIXTURES.doorbell);
    const l = f.layout();
    const o = gridOrigin(l);
    const h = holeWorld(l.breadboard!, { col: 7, row: 9 });
    expect(snapXY([h[0], h[1]], o)[0]).toBeCloseTo(h[0], 6);
    expect(snapXY([h[0], h[1]], o)[1]).toBeCloseTo(h[1], 6);
  });

  it("re-routes when a part moves (the wires go round it at its new place)", () => {
    const f = wire(FIXTURES.doorbell);
    const l = f.layout();
    const p = l.placements.find((q) => !q.board && !q.breadboard)!;
    const moved = movePart(l, p.instanceId, [l.bounds.maxX + 40, l.bounds.minY - 30]);
    checkPlan(moved, f);
  });

  it("20-odd jumpers (busy fixture, a part just moved) route within the speed budget", () => {
    const f = wire(FIXTURES.busy);
    const l = f.layout();
    const id = l.placements.find((q) => !q.board && !q.breadboard)!.instanceId;
    let k = 0;
    // A different spot each run, so the route cache never answers.
    const ms = fastest(() => planWires({ connections: f.connections, layout: movePart(l, id, [l.bounds.maxX + 25 + k++ * 2.54, 0]), getPart, nets: f.nets }));
    expect(planWires({ connections: f.connections, layout: l, getPart, nets: f.nets }).routes.length).toBeGreaterThanOrEqual(20);
    expect(ms).toBeLessThan(SPEED_BUDGET);
  });
});
