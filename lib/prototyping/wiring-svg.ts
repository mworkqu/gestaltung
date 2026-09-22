// Renderer A — the wiring diagram the customer sees.
//
// Every component is drawn as a card showing the actual store product its BOM
// line matched (photo, name, link to its store page), with labelled wires
// between named pins. A component without a matched product, or a product
// without a photo, gets a labelled placeholder box — never a generated image.
//
// Pure string building from a validated netlist: same input, same SVG.

import { esc, flaggedRefs, powerNets, type Flag, type Netlist, type PinType } from "./netlist";

export type WiringProduct = { name: string; href: string; image: string | null };

export type WiringInput = {
  netlist: Netlist;
  flags: Flag[];
  /** By BOM line id: the product the line resolved to, if any. */
  products: Map<string, WiringProduct | null>;
  labels: { noPhoto: string; noProduct: string };
};

const INK = "#1c2434";
const MUTED = "#64748b";
const LINE = "#cbd5e1";
const COBALT = "#0e59c5";
const POWER = "#c2410c";
const ALERT = "#dc2626";

const BOX_W = 210;
const IMG_H = 86;
const HEAD = IMG_H + 52;
const PIN_H = 18;
const GUT_X = 150;
const GUT_Y = 110;
const PAD = 40;

const LEFT: PinType[] = ["power_in", "ground", "input"];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Anchor = { x: number; y: number; side: 1 | -1; row: number };

export function renderWiring({ netlist: n, flags, products, labels }: WiringInput): string {
  const flagged = flaggedRefs(flags);
  const { power, ground } = powerNets(n);
  const sources = new Set(n.powerRails.map((r) => r.sourceRef));
  const degree = (ref: string) => n.nets.reduce((s, net) => s + net.connections.filter((c) => c.ref === ref).length, 0);
  const comps = [...n.components].sort(
    (a, b) => Number(sources.has(b.ref)) - Number(sources.has(a.ref)) || degree(b.ref) - degree(a.ref)
  );

  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(comps.length))));
  const sides = (c: (typeof comps)[number]) => ({
    left: c.pins.filter((p) => LEFT.includes(p.type)),
    right: c.pins.filter((p) => !LEFT.includes(p.type)),
  });
  const heightOf = (c: (typeof comps)[number]) => {
    const s = sides(c);
    return HEAD + Math.max(s.left.length, s.right.length, 1) * PIN_H + 12;
  };

  const rows: (typeof comps)[] = [];
  comps.forEach((c, i) => (rows[Math.floor(i / cols)] ??= []).push(c));
  const rowH = rows.map((r) => Math.max(...r.map(heightOf)));
  const rowY: number[] = [];
  rows.forEach((_, i) => (rowY[i] = i === 0 ? PAD : rowY[i - 1] + rowH[i - 1] + GUT_Y));

  const anchors = new Map<string, Anchor>();
  const boxes: string[] = [];

  rows.forEach((row, r) =>
    row.forEach((c, col) => {
      const x = PAD + GUT_X / 2 + col * (BOX_W + GUT_X);
      const y = rowY[r];
      const h = heightOf(c);
      const bad = flagged.has(c.ref);
      const prod = products.get(c.bomId) ?? null;
      const s = sides(c);

      const photo = prod?.image
        ? `<image href="${esc(prod.image)}" x="${x + 8}" y="${y + 8}" width="${BOX_W - 16}" height="${IMG_H - 8}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect x="${x + 8}" y="${y + 8}" width="${BOX_W - 16}" height="${IMG_H - 8}" rx="6" fill="#f8fafc" stroke="${LINE}" stroke-dasharray="4 3"/>
           <text x="${x + BOX_W / 2}" y="${y + 8 + (IMG_H - 8) / 2 + 4}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(prod ? labels.noPhoto : labels.noProduct)}</text>`;

      const pinRows = (list: typeof c.pins, side: 1 | -1) =>
        list
          .map((p, i) => {
            const py = y + HEAD + i * PIN_H + PIN_H / 2;
            const px = side === -1 ? x : x + BOX_W;
            anchors.set(`${c.ref}.${p.id}`, { x: px, y: py, side, row: r });
            return `<circle cx="${px}" cy="${py}" r="3" fill="${INK}"/>
              <text x="${side === -1 ? x + 8 : x + BOX_W - 8}" y="${py + 4}" font-size="11" fill="${INK}" text-anchor="${side === -1 ? "start" : "end"}">${esc(clip(p.name, 14))}</text>`;
          })
          .join("");

      const card = `<g>
        <rect x="${x}" y="${y}" width="${BOX_W}" height="${h}" rx="10" fill="#ffffff" stroke="${bad ? ALERT : LINE}" stroke-width="${bad ? 2.5 : 1.2}"/>
        ${photo}
        <text x="${x + 10}" y="${y + IMG_H + 18}" font-size="13" font-weight="700" fill="${bad ? ALERT : INK}">${esc(c.ref)}${bad ? " ⚠" : ""}</text>
        <text x="${x + 10}" y="${y + IMG_H + 32}" font-size="11" fill="${MUTED}">${esc(clip(c.function, 30))}</text>
        <text x="${x + 10}" y="${y + IMG_H + 46}" font-size="10.5" fill="${prod ? COBALT : MUTED}">${esc(clip(prod ? prod.name : labels.noProduct, 32))}</text>
        <line x1="${x}" x2="${x + BOX_W}" y1="${y + HEAD - 4}" y2="${y + HEAD - 4}" stroke="${LINE}"/>
        ${pinRows(s.left, -1)}${pinRows(s.right, 1)}
      </g>`;
      boxes.push(prod ? `<a href="${esc(prod.href)}" target="_blank">${card}</a>` : card);
    })
  );

  // Wires: each net is a star from its first pin, routed through the gutters
  // beside the cards and the channel under a row so it never crosses a card.
  const wires: string[] = [];
  n.nets.forEach((net, k) => {
    const pts = net.connections.map((c) => anchors.get(`${c.ref}.${c.pin}`)).filter(Boolean) as Anchor[];
    if (!pts.length) return;
    const colour = ground.has(net.name) ? INK : power.has(net.name) ? POWER : COBALT;
    const off = 14 + (k % 10) * 6;
    const [hub, ...rest] = pts;
    const laneA = hub.x + hub.side * off;
    for (const p of rest) {
      const laneB = p.x + p.side * off;
      const upper = Math.min(hub.row, p.row);
      const channel = rowY[upper] + rowH[upper] + 16 + (k % 10) * 7;
      wires.push(
        `<path d="M${hub.x} ${hub.y} H${laneA} V${channel} H${laneB} V${p.y} H${p.x}" fill="none" stroke="${colour}" stroke-width="1.6" stroke-opacity="0.85"/>`
      );
    }
    if (!rest.length)
      wires.push(`<path d="M${hub.x} ${hub.y} H${laneA}" fill="none" stroke="${ALERT}" stroke-width="1.6" stroke-dasharray="3 2"/>`);
    wires.push(
      `<text x="${laneA + hub.side * 3}" y="${hub.y - 4}" font-size="10" font-weight="600" fill="${colour}" text-anchor="${hub.side === 1 ? "start" : "end"}">${esc(net.name)}</text>`
    );
  });

  const width = PAD * 2 + GUT_X + cols * BOX_W + (cols - 1) * GUT_X;
  const height = rowY[rowY.length - 1] + rowH[rowH.length - 1] + GUT_Y + PAD;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
${wires.join("\n")}
${boxes.join("\n")}
</svg>`;
}
