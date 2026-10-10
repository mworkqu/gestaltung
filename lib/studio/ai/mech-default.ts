// Deterministic printable-parts list — the safe default when the model fails,
// and the reference the model's answer is compared with. Pure.
//
// Rules: one standoff per mounting hole of every placed part that has a mount;
// a battery_clip per cell; a button_extender per button; a light_pipe per LED;
// plus the lid and the base sized to the enclosure.

import {
  MECH_PARAMS, clampMechParts, estGrams,
  type ClampLog, type LayoutItem, type LibraryPart, type MechPart, type MechTemplate, type StudioComponent,
} from "../schema";

export type Dims = { w: number; d: number; h: number };

export type MechSummaryItem = {
  instanceId: string;
  partId: string;
  category: string;
  dims: { x: number; y: number; z: number } | null;
  mountHoles: { x: number; y: number; d: number }[];
  standoffHeight: number | null;
  ports: string[];
  tags: string[];
};

export type MechSummary = { enclosure: Dims; template: string | null; components: MechSummaryItem[] };

const clampTo = (t: MechTemplate, k: string, v: number) => {
  const [min, max] = MECH_PARAMS[t][k];
  return Math.min(max, Math.max(min, v));
};
const round = (v: number) => Math.round(v * 10) / 10;

/** Outer size of the placed parts (mm), from layout positions and part dims. */
export function layoutBounds(
  components: readonly StudioComponent[],
  layout: readonly LayoutItem[],
  getPart: (id: string) => LibraryPart | undefined,
): Dims | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;
  for (const item of layout) {
    const c = components.find((x) => x.instanceId === item.instanceId);
    const part = c ? getPart(c.partId) : undefined;
    if (!part) continue;
    const swap = item.rotZ === 90 || item.rotZ === 270;
    const w = swap ? part.dims.y : part.dims.x;
    const d = swap ? part.dims.x : part.dims.y;
    minX = Math.min(minX, item.pos[0] - w / 2);
    maxX = Math.max(maxX, item.pos[0] + w / 2);
    minY = Math.min(minY, item.pos[1] - d / 2);
    maxY = Math.max(maxY, item.pos[1] + d / 2);
    maxZ = Math.max(maxZ, item.pos[2] + part.dims.z);
  }
  if (!Number.isFinite(minX)) return null;
  return { w: round(maxX - minX), d: round(maxY - minY), h: round(maxZ) };
}

export function mechSummary(opts: {
  components: readonly StudioComponent[];
  layout: readonly LayoutItem[];
  getPart: (id: string) => LibraryPart | undefined;
  enclosure: Dims;
  template?: string | null;
}): MechSummary {
  const placed = new Set(opts.layout.map((l) => l.instanceId));
  const items: MechSummaryItem[] = [];
  for (const c of opts.components) {
    // Unplaced parts (no layout yet) still count, so a doc without a layout gets a list.
    if (opts.layout.length && !placed.has(c.instanceId)) continue;
    const part = opts.getPart(c.partId);
    items.push({
      instanceId: c.instanceId,
      partId: c.partId,
      category: part?.category ?? "unknown",
      dims: part ? { ...part.dims } : null,
      mountHoles: part?.mount?.holes ?? [],
      standoffHeight: part?.mount ? part.mount.standoffHeight : null,
      ports: part?.ports.map((p) => p.kind) ?? [],
      tags: part?.tags ?? [],
    });
  }
  return { enclosure: opts.enclosure, template: opts.template ?? null, components: items };
}

const has = (item: MechSummaryItem, ...words: string[]) =>
  words.some((w) => item.partId.includes(w) || item.tags.some((t) => t.toLowerCase().includes(w)));

const isCell = (i: MechSummaryItem) => i.category === "power" && (has(i, "cell", "18650", "battery") && !has(i, "charger", "tp4056"));
const isButton = (i: MechSummaryItem) => i.category === "input" && (has(i, "button", "switch") || i.ports.includes("button_cap"));
const isLed = (i: MechSummaryItem) => has(i, "led") || i.ports.includes("led_light_pipe");

export function defaultMechParts(summary: MechSummary, log: ClampLog = []): MechPart[] {
  const raw: Record<string, unknown>[] = [];
  const add = (template: MechTemplate, params: Record<string, number>, forInstance: string | undefined, volume: number) =>
    raw.push({
      id: `${template}_${raw.filter((r) => r.template === template).length + 1}`,
      template,
      params,
      ...(forInstance ? { forInstance } : {}),
      printable: { material: "PLA", estGrams: estGrams(volume) },
    });

  for (const item of summary.components) {
    for (const hole of item.mountHoles) {
      const holeD = clampTo("standoff", "holeD", hole.d);
      const outerD = clampTo("standoff", "outerD", holeD + 3);
      const height = clampTo("standoff", "height", item.standoffHeight || MECH_PARAMS.standoff.height[2]);
      add("standoff", { height, outerD, holeD }, item.instanceId, Math.PI * (outerD / 2) ** 2 * height);
    }
    if (isCell(item)) {
      const cellD = clampTo("battery_clip", "cellD", item.dims ? Math.min(item.dims.y, item.dims.z) : 18.6);
      const length = clampTo("battery_clip", "length", item.dims ? item.dims.x : 65);
      add("battery_clip", { cellD, length, wall: 1.8 }, item.instanceId, length * (cellD + 3.6) * 1.8 * 2);
    }
    if (isButton(item)) add("button_extender", { capD: 8, length: 6 }, item.instanceId, Math.PI * 16 * 6);
    if (isLed(item)) add("light_pipe", { d: 3, length: 8 }, item.instanceId, Math.PI * 2.25 * 8);
  }

  const { w, d, h } = summary.enclosure;
  const lid = { width: clampTo("lid", "width", w), depth: clampTo("lid", "depth", d), thickness: 2 };
  add("lid", lid, undefined, lid.width * lid.depth * lid.thickness);
  const base = { width: clampTo("base", "width", w), depth: clampTo("base", "depth", d), height: clampTo("base", "height", h) };
  // A shell: floor + four walls at ~2 mm.
  add("base", base, undefined, base.width * base.depth * 2 + 2 * (base.width + base.depth) * base.height * 2);

  return clampMechParts(raw, log);
}
