// Renderer A — the wiring diagram the customer sees.
//
// Every component is drawn as a card showing the actual store product its BOM
// line resolved to — matched, picked, or already bought (photo, name, sku, link
// to its store page) — with labelled wires between named pins. "No store
// product" only when the line has neither a product nor a bought sku. A
// product without a photo gets a labelled placeholder box — never a generated
// image.
//
// Picture diagram (owner, 2026-09-29): photos are large, every connection has
// its own wire colour — power red, ground black, each signal a distinct
// colour, the pin dots in the same colour — with a colour key underneath.
// A part not yet matched to a product can show an EXAMPLE photo of the same
// kind of part from our store, labelled as an example. Nothing is generated:
// the model only decides what connects to what; photos are store photos.
//
// Pure string building from a validated netlist: same input, same SVG.

import { partImageUrl, partName } from "@/lib/parts/format";
import type { LineMatch, ProjectLine } from "./bom";
import { esc, flaggedRefs, powerNets, type Flag, type Netlist, type PinType } from "./netlist";

/** `sku` is shown under the name; when absent it is read from `href` (…/store/<sku>). */
export type WiringProduct = {
  name: string;
  href: string;
  image: string | null;
  sku?: string;
  /** A store product of the same kind, shown only for its photo — not the line's product. */
  example?: boolean;
};

/**
 * The products map for renderWiring, by BOM line id: the line's store product
 * (matched, picked, or the one it was bought as), else — for a bought line
 * whose product is no longer listed — its sku alone.
 */
export function wiringProducts(
  lines: ProjectLine[],
  matches: Map<string, LineMatch>,
  locale: string
): Map<string, WiringProduct | null> {
  const out = new Map<string, WiringProduct | null>();
  for (const l of lines) {
    const p = matches.get(l.id)?.product ?? null;
    const sku = p?.sku ?? l.fulfilled?.sku ?? null;
    out.set(
      l.id,
      sku
        ? {
            name: p ? partName(p, locale) : sku,
            sku,
            href: `/${locale}/store/${encodeURIComponent(sku)}`,
            image: p ? partImageUrl(p) : null,
          }
        : null
    );
  }
  return out;
}

function skuOf(p: WiringProduct): string {
  if (p.sku) return p.sku;
  const m = p.href.match(/\/store\/([^/?#]+)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * The client view (P5-04): the same picture with plain words. Designators,
 * pin names, net names and SKUs are replaced by what the callbacks return
 * ("Motion sensor", "Signal", "Power"); the product name stays under the part.
 */
export type PlainWiring = {
  component: (ref: string) => string;
  pin: (ref: string, pinId: string, type: PinType) => string;
  net: (name: string) => string;
};

export type WiringInput = {
  netlist: Netlist;
  flags: Flag[];
  /** By BOM line id: the product the line resolved to, if any. */
  products: Map<string, WiringProduct | null>;
  labels: { noPhoto: string; noProduct: string; example?: string; key?: string };
  plain?: PlainWiring;
};

/** Wire colours: ground black, power red, signals in order (distinct, readable on white). */
export const GROUND_WIRE = "#111827";
export const POWER_WIRE = "#dc2626";
export const SIGNAL_WIRES = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#a16207", "#db2777", "#4f46e5", "#65a30d", "#0f766e"];

/** Colour per net name; same netlist → same colours. */
export function netColours(n: Netlist): Map<string, string> {
  const { power, ground } = powerNets(n);
  const out = new Map<string, string>();
  let i = 0;
  for (const net of n.nets) {
    if (ground.has(net.name)) out.set(net.name, GROUND_WIRE);
    else if (power.has(net.name)) out.set(net.name, POWER_WIRE);
    else out.set(net.name, SIGNAL_WIRES[i++ % SIGNAL_WIRES.length]);
  }
  return out;
}

const INK = "#1c2434";
const MUTED = "#64748b";
const LINE = "#cbd5e1";
const COBALT = "#0e59c5";
const ALERT = "#dc2626";

const BOX_W = 230;
const IMG_H = 136;
const HEAD = IMG_H + 64;
const PIN_H = 18;
const GUT_X = 150;
const GUT_Y = 110;
const PAD = 40;

const LEFT: PinType[] = ["power_in", "ground", "input"];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Anchor = { x: number; y: number; side: 1 | -1; row: number };

export function renderWiring({ netlist: n, flags, products, labels, plain }: WiringInput): string {
  const flagged = flaggedRefs(flags);
  const colours = netColours(n);
  const pinNet = new Map<string, string>();
  for (const net of n.nets) for (const c of net.connections) pinNet.set(`${c.ref}.${c.pin}`, net.name);
  const colourOf = (ref: string, pin: string) => colours.get(pinNet.get(`${ref}.${pin}`) ?? "") ?? INK;
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
      const sku = prod ? skuOf(prod) : "";
      const s = sides(c);

      const exampleTag =
        prod?.example && prod.image && labels.example
          ? `<rect x="${x + 12}" y="${y + 12}" width="${labels.example.length * 6 + 14}" height="17" rx="8.5" fill="#fef3c7"/>
             <text x="${x + 19}" y="${y + 24}" font-size="10" font-weight="600" fill="#92400e">${esc(labels.example)}</text>`
          : "";
      const photo = prod?.image
        ? `<image href="${esc(prod.image)}" x="${x + 8}" y="${y + 8}" width="${BOX_W - 16}" height="${IMG_H - 8}" preserveAspectRatio="xMidYMid meet"/>${exampleTag}`
        : `<rect x="${x + 8}" y="${y + 8}" width="${BOX_W - 16}" height="${IMG_H - 8}" rx="6" fill="#f8fafc" stroke="${LINE}" stroke-dasharray="4 3"/>
           <text x="${x + BOX_W / 2}" y="${y + 8 + (IMG_H - 8) / 2 + 4}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(prod ? labels.noPhoto : labels.noProduct)}</text>`;

      const pinRows = (list: typeof c.pins, side: 1 | -1) =>
        list
          .map((p, i) => {
            const py = y + HEAD + i * PIN_H + PIN_H / 2;
            const px = side === -1 ? x : x + BOX_W;
            anchors.set(`${c.ref}.${p.id}`, { x: px, y: py, side, row: r });
            const col = colourOf(c.ref, p.id);
            return `<circle cx="${px}" cy="${py}" r="4.5" fill="${col}" stroke="#ffffff" stroke-width="1.5"/>
              <text x="${side === -1 ? x + 10 : x + BOX_W - 10}" y="${py + 4}" font-size="11" font-weight="600" fill="${col}" text-anchor="${side === -1 ? "start" : "end"}">${esc(clip(plain ? plain.pin(c.ref, p.id, p.type) : p.name, 14))}</text>`;
          })
          .join("");

      // Client view: the plain name in bold, the product's name under it; no
      // designator, no function text, no SKU.
      const heading = plain ? plain.component(c.ref) : c.ref;
      const sub = plain ? (prod && !prod.example ? prod.name : "") : c.function;
      const productLine = plain
        ? ""
        : `<text x="${x + 10}" y="${y + IMG_H + 46}" font-size="10.5" fill="${prod && !prod.example ? COBALT : MUTED}">${esc(clip(prod && !prod.example ? prod.name : labels.noProduct, 34))}</text>`;
      const card = `<g>
        <rect x="${x}" y="${y}" width="${BOX_W}" height="${h}" rx="10" fill="#ffffff" stroke="${bad ? ALERT : LINE}" stroke-width="${bad ? 2.5 : 1.2}"/>
        ${photo}
        <text x="${x + 10}" y="${y + IMG_H + 18}" font-size="13" font-weight="700" fill="${bad ? ALERT : INK}">${esc(clip(heading, plain ? 24 : 30))}${bad ? " ⚠" : ""}</text>
        <text x="${x + 10}" y="${y + IMG_H + 32}" font-size="11" fill="${MUTED}">${esc(clip(sub, 30))}</text>
        ${productLine}
        ${!plain && sku && !prod?.example ? `<text x="${x + 10}" y="${y + IMG_H + 59}" font-size="10" font-family="ui-monospace, monospace" fill="${MUTED}">${esc(clip(sku, 34))}</text>` : ""}
        <line x1="${x}" x2="${x + BOX_W}" y1="${y + HEAD - 4}" y2="${y + HEAD - 4}" stroke="${LINE}"/>
        ${pinRows(s.left, -1)}${pinRows(s.right, 1)}
      </g>`;
      boxes.push(prod && !prod.example ? `<a href="${esc(prod.href)}" target="_blank">${card}</a>` : card);
    })
  );

  // Wires: each net is a star from its first pin, routed through the gutters
  // beside the cards and the channel under a row so it never crosses a card.
  const wires: string[] = [];
  n.nets.forEach((net, k) => {
    const pts = net.connections.map((c) => anchors.get(`${c.ref}.${c.pin}`)).filter(Boolean) as Anchor[];
    if (!pts.length) return;
    const colour = colours.get(net.name) ?? INK;
    const off = 14 + (k % 10) * 6;
    const [hub, ...rest] = pts;
    const laneA = hub.x + hub.side * off;
    for (const p of rest) {
      const laneB = p.x + p.side * off;
      const upper = Math.min(hub.row, p.row);
      const channel = rowY[upper] + rowH[upper] + 16 + (k % 10) * 7;
      wires.push(
        // A white casing under each wire keeps crossings readable, like jumper wires.
        `<path d="M${hub.x} ${hub.y} H${laneA} V${channel} H${laneB} V${p.y} H${p.x}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/>
<path d="M${hub.x} ${hub.y} H${laneA} V${channel} H${laneB} V${p.y} H${p.x}" fill="none" stroke="${colour}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`
      );
    }
    if (!rest.length)
      wires.push(`<path d="M${hub.x} ${hub.y} H${laneA}" fill="none" stroke="${ALERT}" stroke-width="1.6" stroke-dasharray="3 2"/>`);
    wires.push(
      `<text x="${laneA + hub.side * 3}" y="${hub.y - 4}" font-size="10" font-weight="600" fill="${colour}" text-anchor="${hub.side === 1 ? "start" : "end"}">${esc(plain ? plain.net(net.name) : net.name)}</text>`
    );
  });

  const width = PAD * 2 + GUT_X + cols * BOX_W + (cols - 1) * GUT_X;
  const bodyH = rowY[rowY.length - 1] + rowH[rowH.length - 1] + GUT_Y;

  // Colour key: one swatch per wire, wrapped to the drawing width.
  const keyItems: string[] = [];
  let kx = PAD;
  let ky = bodyH + 22;
  if (labels.key) keyItems.push(`<text x="${kx}" y="${ky}" font-size="11" font-weight="700" fill="${MUTED}">${esc(labels.key)}</text>`);
  ky += 20;
  for (const net of n.nets) {
    const keyName = plain ? plain.net(net.name) : net.name;
    const w = 34 + clip(keyName, 18).length * 7;
    if (kx + w > width - PAD) {
      kx = PAD;
      ky += 20;
    }
    keyItems.push(
      `<line x1="${kx}" x2="${kx + 22}" y1="${ky - 4}" y2="${ky - 4}" stroke="${colours.get(net.name) ?? INK}" stroke-width="4" stroke-linecap="round"/>
<text x="${kx + 28}" y="${ky}" font-size="11" fill="${INK}">${esc(clip(keyName, 18))}</text>`
    );
    kx += w + 12;
  }
  const height = ky + PAD;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" width="${width}" height="${height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
${wires.join("\n")}
${boxes.join("\n")}
${keyItems.join("\n")}
</svg>`;
}
