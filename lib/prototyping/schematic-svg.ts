// Renderer B — the engineering view: the same netlist drawn with a small
// symbol library (resistor, capacitor, LED, diode, transistor, connector,
// generic IC block, motor). Laid out left to right from the power sources;
// supply rails run along the top, ground along the bottom, and signal nets
// are joined by name with net labels — the standard schematic convention.
//
// Pure string building from a validated netlist: same input, same SVG.

import { esc, flaggedRefs, powerNets, type Flag, type NetComponent, type Netlist } from "./netlist";

const INK = "#1c2434";
const MUTED = "#64748b";
const COBALT = "#0e59c5";
const POWER = "#c2410c";
const ALERT = "#dc2626";

const SLOT = 180;
const PAD = 60;
// A white outline behind label text, so a wire passing under it stays legible.
const HALO = `stroke="#ffffff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"`;

export type SymbolKind = "resistor" | "capacitor" | "led" | "diode" | "transistor" | "connector" | "motor" | "ic";

export function symbolKind(c: NetComponent): SymbolKind {
  // The designator is the most reliable signal, so it decides first.
  const ref = c.ref.toUpperCase();
  if (/^LED\d/.test(ref)) return "led";
  if (/^R\d/.test(ref)) return "resistor";
  if (/^C\d/.test(ref)) return "capacitor";
  if (/^D\d/.test(ref)) return "diode";
  if (/^Q\d/.test(ref)) return "transistor";
  if (/^M\d/.test(ref)) return "motor";
  if (/^(J|BT|P)\d/.test(ref)) return "connector";
  if (/^U\d/.test(ref)) return "ic";
  // Otherwise the function, most specific words first ("LED resistor" is a resistor).
  const t = c.function.toLowerCase();
  if (/resist/.test(t)) return "resistor";
  if (/capacit/.test(t)) return "capacitor";
  if (/\bled\b|light.emitting/.test(t)) return "led";
  if (/diode/.test(t)) return "diode";
  if (/transistor|mosfet|\bbjt\b/.test(t)) return "transistor";
  if (/motor|servo|\bfan\b|pump/.test(t)) return "motor";
  if (/connector|header|terminal|jack|plug|socket|battery|cell|panel/.test(t)) return "connector";
  return "ic";
}

type End = { x: number; y: number; dx: number; dy: number };

export function renderSchematic({ netlist: n, flags }: { netlist: Netlist; flags: Flag[] }): string {
  const flagged = flaggedRefs(flags);
  const { power, ground } = powerNets(n);
  const netOf = new Map<string, string>();
  for (const net of n.nets) for (const c of net.connections) netOf.set(`${c.ref}.${c.pin}`, net.name);

  // Left to right: sources first, then whatever they feed, breadth-first
  // over shared signal nets, then anything left over.
  const order: NetComponent[] = [];
  const seen = new Set<string>();
  const queue = n.components.filter((c) => n.powerRails.some((r) => r.sourceRef === c.ref));
  if (!queue.length && n.components[0]) queue.push(n.components[0]);
  while (order.length < n.components.length) {
    const c = queue.shift() ?? n.components.find((x) => !seen.has(x.ref))!;
    if (seen.has(c.ref)) continue;
    seen.add(c.ref);
    order.push(c);
    const mine = n.nets.filter((net) => !power.has(net.name) && !ground.has(net.name) && net.connections.some((x) => x.ref === c.ref));
    for (const net of mine)
      for (const x of net.connections) {
        const next = n.components.find((k) => k.ref === x.ref);
        if (next && !seen.has(next.ref)) queue.push(next);
      }
  }

  const railNames = [...new Set([...n.powerRails.map((r) => r.name), ...[...power]])];
  const railY = new Map(railNames.map((name, i) => [name, 34 + i * 18]));
  const bandTop = 34 + railNames.length * 18 + 50;
  const tallest = Math.max(
    60,
    ...order.map((c) => (symbolKind(c) === "ic" ? Math.ceil(c.pins.filter(sideOnly).length / 2) * 18 + 28 : 60))
  );
  const cy = bandTop + tallest / 2 + 20;
  const gndY = cy + tallest / 2 + 70;
  const width = PAD * 2 + order.length * SLOT;
  const height = gndY + 50;

  const out: string[] = [];

  railNames.forEach((name) => {
    const y = railY.get(name)!;
    out.push(`<line x1="${PAD - 30}" x2="${width - 20}" y1="${y}" y2="${y}" stroke="${POWER}" stroke-width="1.6"/>
      <text x="${PAD - 34}" y="${y + 4}" font-size="11" font-weight="700" fill="${POWER}" text-anchor="end">${esc(name)}</text>`);
  });
  out.push(`<line x1="${PAD - 30}" x2="${width - 20}" y1="${gndY}" y2="${gndY}" stroke="${INK}" stroke-width="1.6"/>
    <text x="${PAD - 34}" y="${gndY + 4}" font-size="11" font-weight="700" fill="${INK}" text-anchor="end">GND</text>`);

  order.forEach((c, i) => {
    const cx = PAD + SLOT / 2 + i * SLOT;
    const bad = flagged.has(c.ref);
    const stroke = bad ? ALERT : INK;
    const { body, ends } = drawSymbol(symbolKind(c), c, cx, cy, stroke);
    out.push(body);

    c.pins.forEach((p, k) => {
      const e = ends[k];
      if (!e) return;
      const net = netOf.get(`${c.ref}.${p.id}`);
      const sx = e.x + e.dx * 14;
      const sy = e.y + e.dy * 14;
      if (net && (power.has(net) || n.powerRails.some((r) => r.name === net)) && railY.has(net)) {
        const ry = railY.get(net)!;
        out.push(
          `<path d="M${e.x} ${e.y} L${sx} ${sy} V${ry}" fill="none" stroke="${POWER}" stroke-width="1.3"/><circle cx="${sx}" cy="${ry}" r="2.6" fill="${POWER}"/>`
        );
      } else if (net && ground.has(net)) {
        out.push(
          `<path d="M${e.x} ${e.y} L${sx} ${sy} V${gndY}" fill="none" stroke="${INK}" stroke-width="1.3"/><circle cx="${sx}" cy="${gndY}" r="2.6" fill="${INK}"/>`
        );
      } else if (net) {
        // Side stubs: label past the end. Vertical stubs: label beside the
        // stub, so it never runs into the reference printed below the symbol.
        const lx = e.dx ? sx + e.dx * 4 : e.x + 5;
        const ly = e.dx ? sy + 4 : e.y + e.dy * 10 + 3;
        out.push(
          `<line x1="${e.x}" y1="${e.y}" x2="${sx}" y2="${sy}" stroke="${COBALT}" stroke-width="1.3"/>
           <text x="${lx}" y="${ly}" font-size="10" font-weight="600" fill="${COBALT}" text-anchor="${e.dx < 0 ? "end" : "start"}" ${HALO}>${esc(net)}</text>`
        );
      } else {
        out.push(
          `<path d="M${e.x - 4} ${e.y - 4} l8 8 m0 -8 l-8 8" stroke="${ALERT}" stroke-width="1.3"/>`
        );
      }
    });

    out.push(`<text x="${cx}" y="${cy + tallest / 2 + 24}" font-size="12" font-weight="700" fill="${stroke}" text-anchor="middle" ${HALO}>${esc(c.ref)}${bad ? " ⚠" : ""}</text>
      <text x="${cx}" y="${cy + tallest / 2 + 38}" font-size="10" fill="${MUTED}" text-anchor="middle" ${HALO}>${esc(c.function.length > 26 ? `${c.function.slice(0, 25)}…` : c.function)}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
${out.join("\n")}
</svg>`;
}

const sideOnly = (p: { type: string }) => p.type !== "power_in" && p.type !== "ground" && p.type !== "power_out";

/** One symbol, plus where each of the component's pins (in order) attaches. */
function drawSymbol(kind: SymbolKind, c: NetComponent, cx: number, cy: number, s: string): { body: string; ends: End[] } {
  const two = (w: number): End[] => [
    { x: cx - w, y: cy, dx: -1, dy: 0 },
    { x: cx + w, y: cy, dx: 1, dy: 0 },
    ...c.pins.slice(2).map((_, i) => ({ x: cx + i * 12, y: cy + 24, dx: 0, dy: 1 })),
  ];
  const leads = (w: number, inner: number) =>
    `<line x1="${cx - w}" y1="${cy}" x2="${cx - inner}" y2="${cy}" stroke="${s}" stroke-width="1.5"/><line x1="${cx + inner}" y1="${cy}" x2="${cx + w}" y2="${cy}" stroke="${s}" stroke-width="1.5"/>`;

  switch (kind) {
    case "resistor":
      return {
        body: `${leads(36, 18)}<rect x="${cx - 18}" y="${cy - 7}" width="36" height="14" fill="#fff" stroke="${s}" stroke-width="1.5"/>`,
        ends: two(36),
      };
    case "capacitor":
      return {
        body: `${leads(36, 5)}<line x1="${cx - 5}" y1="${cy - 13}" x2="${cx - 5}" y2="${cy + 13}" stroke="${s}" stroke-width="2"/><line x1="${cx + 5}" y1="${cy - 13}" x2="${cx + 5}" y2="${cy + 13}" stroke="${s}" stroke-width="2"/>`,
        ends: two(36),
      };
    case "diode":
    case "led": {
      const arrows =
        kind === "led"
          ? `<path d="M${cx + 2} ${cy - 16} l8 -8 m-5 0 h5 v5 M${cx + 9} ${cy - 12} l8 -8 m-5 0 h5 v5" fill="none" stroke="${s}" stroke-width="1.2"/>`
          : "";
      return {
        body: `${leads(36, 10)}<path d="M${cx - 10} ${cy - 10} L${cx + 8} ${cy} L${cx - 10} ${cy + 10} Z" fill="#fff" stroke="${s}" stroke-width="1.5"/><line x1="${cx + 9}" y1="${cy - 10}" x2="${cx + 9}" y2="${cy + 10}" stroke="${s}" stroke-width="1.8"/>${arrows}`,
        ends: two(36),
      };
    }
    case "transistor": {
      const ends: End[] = [
        { x: cx - 34, y: cy, dx: -1, dy: 0 },
        { x: cx + 10, y: cy - 30, dx: 0, dy: -1 },
        { x: cx + 10, y: cy + 30, dx: 0, dy: 1 },
        ...c.pins.slice(3).map((_, i) => ({ x: cx + 24, y: cy + i * 10, dx: 1, dy: 0 })),
      ];
      return {
        body: `<circle cx="${cx}" cy="${cy}" r="20" fill="#fff" stroke="${s}" stroke-width="1.5"/>
          <line x1="${cx - 34}" y1="${cy}" x2="${cx - 6}" y2="${cy}" stroke="${s}" stroke-width="1.5"/>
          <line x1="${cx - 6}" y1="${cy - 11}" x2="${cx - 6}" y2="${cy + 11}" stroke="${s}" stroke-width="2"/>
          <path d="M${cx - 6} ${cy - 5} L${cx + 10} ${cy - 16} V${cy - 30} M${cx - 6} ${cy + 5} L${cx + 10} ${cy + 16} V${cy + 30}" fill="none" stroke="${s}" stroke-width="1.5"/>`,
        ends,
      };
    }
    case "motor":
      return {
        body: `${leads(40, 22)}<circle cx="${cx}" cy="${cy}" r="22" fill="#fff" stroke="${s}" stroke-width="1.5"/><text x="${cx}" y="${cy + 5}" font-size="15" font-weight="700" fill="${s}" text-anchor="middle">M</text>`,
        ends: two(40),
      };
    case "connector": {
      const h = Math.max(1, c.pins.length) * 16 + 8;
      const top = cy - h / 2;
      const ends: End[] = c.pins.map((_, i) => ({ x: cx + 44, y: top + 12 + i * 16, dx: 1, dy: 0 }));
      const pins = c.pins
        .map(
          (p, i) =>
            `<line x1="${cx + 26}" y1="${top + 12 + i * 16}" x2="${cx + 44}" y2="${top + 12 + i * 16}" stroke="${s}" stroke-width="1.3"/><text x="${cx + 22}" y="${top + 15 + i * 16}" font-size="9" fill="${MUTED}" text-anchor="end">${esc(p.name.slice(0, 8))}</text>`
        )
        .join("");
      return {
        body: `<rect x="${cx - 26}" y="${top}" width="52" height="${h}" rx="3" fill="#fff" stroke="${s}" stroke-width="1.5"/>${pins}`,
        ends,
      };
    }
    default: {
      // Generic IC block: supply pins on top, ground on the bottom, the rest
      // split between the sides.
      const side = c.pins.filter(sideOnly);
      const leftN = Math.ceil(side.length / 2);
      const h = Math.max(leftN, side.length - leftN, 1) * 18 + 28;
      const w = 92;
      const top = cy - h / 2;
      const tops = c.pins.filter((p) => p.type === "power_in" || p.type === "power_out");
      const bottoms = c.pins.filter((p) => p.type === "ground");
      const pos = new Map<string, End>();
      side.forEach((p, i) => {
        const left = i < leftN;
        const row = left ? i : i - leftN;
        pos.set(p.id, { x: left ? cx - w / 2 - 16 : cx + w / 2 + 16, y: top + 20 + row * 18, dx: left ? -1 : 1, dy: 0 });
      });
      tops.forEach((p, i) =>
        pos.set(p.id, { x: cx - w / 2 + ((i + 1) * w) / (tops.length + 1), y: top - 16, dx: 0, dy: -1 })
      );
      bottoms.forEach((p, i) =>
        pos.set(p.id, { x: cx - w / 2 + ((i + 1) * w) / (bottoms.length + 1), y: top + h + 16, dx: 0, dy: 1 })
      );
      const labels = c.pins
        .map((p) => {
          const e = pos.get(p.id)!;
          const inner = e.dy
            ? { x: e.x, y: e.dy < 0 ? top : top + h }
            : { x: e.dx < 0 ? cx - w / 2 : cx + w / 2, y: e.y };
          const tx = e.dy ? e.x : inner.x - e.dx * 4;
          const ty = e.dy < 0 ? top + 11 : e.dy > 0 ? top + h - 5 : e.y + 3.5;
          return `<line x1="${inner.x}" y1="${inner.y}" x2="${e.x}" y2="${e.y}" stroke="${s}" stroke-width="1.3"/><text x="${tx}" y="${ty}" font-size="9" fill="${MUTED}" text-anchor="${e.dy ? "middle" : e.dx < 0 ? "start" : "end"}">${esc(p.name.slice(0, 8))}</text>`;
        })
        .join("");
      return {
        body: `<rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" rx="4" fill="#fff" stroke="${s}" stroke-width="1.6"/>${labels}`,
        ends: c.pins.map((p) => pos.get(p.id)!),
      };
    }
  }
}
