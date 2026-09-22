// The electronics netlist: structure, never pixels.
//
// The model returns components, pins, nets and power rails as JSON. It is
// validated twice before anything is drawn — shape by zod (./netlist-schema),
// references by crossValidate() here — and then checked electrically by
// sanityChecks(), which is our code, not the model's opinion. Both diagrams
// (./wiring-svg, ./schematic-svg) are drawn from the stored netlist, so it is
// the single source of truth.
//
// Pure and client-safe.

export const PIN_TYPES = [
  "power_in",
  "power_out",
  "ground",
  "input",
  "output",
  "bidirectional",
  "passive",
] as const;
export type PinType = (typeof PIN_TYPES)[number];

export type Pin = { id: string; name: string; type: PinType };
export type NetComponent = {
  ref: string;
  function: string;
  bomId: string;
  pins: Pin[];
  /** Typical draw in mA, as proposed by the model; used only for the supply check. */
  currentMa?: number | null;
};
export type Connection = { ref: string; pin: string };
export type Net = { name: string; connections: Connection[] };
export type PowerRail = { name: string; sourceRef: string; maxCurrentMa: number };

export type Netlist = {
  components: NetComponent[];
  nets: Net[];
  powerRails: PowerRail[];
  notes: string[];
};

/** projects.netlist (migration 0023). */
export type ProjectNetlist = Netlist & { generatedAt: string; model: string | null };

/**
 * Every reference must point at something that exists. Returns plain English
 * problems (they are also fed back to the model on the one retry); empty
 * means valid.
 */
export function crossValidate(n: Netlist, bomIds: string[]): string[] {
  const errs: string[] = [];
  const bom = new Set(bomIds);
  const refs = new Map<string, NetComponent>();
  for (const c of n.components) {
    if (refs.has(c.ref)) errs.push(`component ref ${c.ref} is used twice`);
    refs.set(c.ref, c);
    if (!bom.has(c.bomId)) errs.push(`component ${c.ref} has bomId "${c.bomId}", which is not a BOM line id`);
    const pins = new Set<string>();
    for (const p of c.pins) {
      if (pins.has(p.id)) errs.push(`component ${c.ref} has pin id ${p.id} twice`);
      pins.add(p.id);
    }
  }
  const netNames = new Set<string>();
  const pinNet = new Map<string, string>();
  for (const net of n.nets) {
    if (netNames.has(net.name)) errs.push(`net name ${net.name} is used twice`);
    netNames.add(net.name);
    for (const { ref, pin } of net.connections) {
      const c = refs.get(ref);
      if (!c) {
        errs.push(`net ${net.name} connects ${ref}.${pin}, but there is no component ${ref}`);
        continue;
      }
      if (!c.pins.some((p) => p.id === pin)) {
        errs.push(`net ${net.name} connects ${ref}.${pin}, but ${ref} has no pin ${pin}`);
        continue;
      }
      const key = `${ref}.${pin}`;
      const other = pinNet.get(key);
      if (other && other !== net.name) errs.push(`pin ${key} is on two nets (${other} and ${net.name})`);
      pinNet.set(key, net.name);
    }
  }
  for (const r of n.powerRails) {
    if (!refs.has(r.sourceRef)) errs.push(`power rail ${r.name} has sourceRef ${r.sourceRef}, which is not a component`);
  }
  return errs;
}

// ── Electrical sanity checks ────────────────────────────────────────────────

export type Flag =
  | { code: "floating"; net: string; ref: string | null }
  | { code: "unpowered"; ref: string }
  | { code: "shorted"; net: string; refs: string[] }
  | { code: "overcurrent"; rail: string; drawMa: number; maxMa: number; refs: string[] };

const GROUND_NAME = /^(gnd|ground|0v|vss|agnd|dgnd)$/i;

/** Net names that carry power: every rail, plus any net a power_out pin drives. */
export function powerNets(n: Netlist): { power: Set<string>; ground: Set<string> } {
  const typeOf = pinTypes(n);
  const power = new Set<string>();
  const ground = new Set<string>();
  const rails = new Set(n.powerRails.map((r) => r.name.toLowerCase()));
  for (const net of n.nets) {
    const types = net.connections.map((c) => typeOf.get(`${c.ref}.${c.pin}`));
    if (GROUND_NAME.test(net.name) || types.includes("ground")) ground.add(net.name);
    else if (rails.has(net.name.toLowerCase()) || types.includes("power_out")) power.add(net.name);
  }
  return { power, ground };
}

function pinTypes(n: Netlist) {
  const m = new Map<string, PinType>();
  for (const c of n.components) for (const p of c.pins) m.set(`${c.ref}.${p.id}`, p.type);
  return m;
}

export function sanityChecks(n: Netlist): Flag[] {
  const flags: Flag[] = [];
  const typeOf = pinTypes(n);
  const { power } = powerNets(n);

  // Floating: a net that goes nowhere.
  for (const net of n.nets) {
    if (net.connections.length < 2)
      flags.push({ code: "floating", net: net.name, ref: net.connections[0]?.ref ?? null });
  }

  // No power connection. Purely passive parts (resistors, capacitors) and the
  // rail sources themselves are exempt.
  const sources = new Set(n.powerRails.map((r) => r.sourceRef));
  for (const c of n.components) {
    if (sources.has(c.ref) || c.pins.every((p) => p.type === "passive")) continue;
    const powered = n.nets.some((net) => power.has(net.name) && net.connections.some((x) => x.ref === c.ref));
    if (!powered) flags.push({ code: "unpowered", ref: c.ref });
  }

  // Two supplies driving one net.
  for (const net of n.nets) {
    const drivers = [
      ...new Set(net.connections.filter((x) => typeOf.get(`${x.ref}.${x.pin}`) === "power_out").map((x) => x.ref)),
    ];
    if (drivers.length > 1) flags.push({ code: "shorted", net: net.name, refs: drivers });
  }

  // Loads on a rail drawing more than its source declares.
  for (const rail of n.powerRails) {
    const net = n.nets.find((x) => x.name.toLowerCase() === rail.name.toLowerCase());
    if (!net) continue;
    const loads = [...new Set(net.connections.map((x) => x.ref))].filter((r) => r !== rail.sourceRef);
    const draw = loads.reduce(
      (s, r) => s + (n.components.find((c) => c.ref === r)?.currentMa ?? 0),
      0
    );
    if (draw > rail.maxCurrentMa)
      flags.push({ code: "overcurrent", rail: rail.name, drawMa: draw, maxMa: rail.maxCurrentMa, refs: loads });
  }
  return flags;
}

/** Refs a flag is about, for outlining them on the diagrams. */
export const flaggedRefs = (flags: Flag[]) =>
  new Set(
    flags.flatMap((f) =>
      f.code === "unpowered" ? [f.ref] : f.code === "floating" ? (f.ref ? [f.ref] : []) : f.refs
    )
  );

/** XML-escape text for SVG output. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
