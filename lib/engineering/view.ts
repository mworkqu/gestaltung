// Engineering view data (pure): the bill of materials, the connections and the
// power budget derived from a StudioDoc. No React, no I/O.

import type { LibraryPart, StudioDoc } from "@/lib/studio/schema";

type GetPart = (id: string) => LibraryPart | undefined;

export type BomLine = { partId: string; name: string; category: string; qty: number; skus: string[] };

/** One line per partId, identical parts grouped. Unknown ids keep their label as the name. */
export function buildBom(doc: StudioDoc, getPart: GetPart, locale: "en" | "ar"): BomLine[] {
  const by = new Map<string, BomLine>();
  for (const c of doc.components) {
    const p = getPart(c.partId);
    const line = by.get(c.partId);
    if (line) line.qty += 1;
    else by.set(c.partId, { partId: c.partId, name: p?.name[locale] ?? c.label ?? c.partId, category: p?.category ?? "", qty: 1, skus: p?.storeSkus ?? [] });
  }
  return [...by.values()];
}

export type PinLabel = { part: string; pin: string };
export type Connection = { net: string; pins: PinLabel[] };

/** "instanceId.pinId" becomes { part: "label", pin: "pin label" }. */
export function pinLabel(ref: string, doc: StudioDoc, getPart: GetPart): PinLabel {
  const i = ref.indexOf(".");
  const inst = i < 0 ? ref : ref.slice(0, i);
  const pinId = i < 0 ? "" : ref.slice(i + 1);
  const c = doc.components.find((x) => x.instanceId === inst);
  const pin = c ? getPart(c.partId)?.pins.find((x) => x.id === pinId) : undefined;
  return { part: c?.label ?? inst, pin: pin?.label ?? pinId };
}

export function buildConnections(doc: StudioDoc, getPart: GetPart): Connection[] {
  return doc.netlist.nets.map((n) => ({ net: n.name, pins: n.pins.map((r) => pinLabel(r, doc, getPart)) }));
}

/** Per component: the net each of its pins sits on (the full view's pin-level netlist). */
export function pinsByComponent(doc: StudioDoc, getPart: GetPart) {
  return doc.components.map((c) => {
    const part = getPart(c.partId);
    const rows: { pin: string; net: string }[] = [];
    for (const n of doc.netlist.nets) {
      for (const r of n.pins) {
        const i = r.indexOf(".");
        if (i < 0 || r.slice(0, i) !== c.instanceId) continue;
        const pinId = r.slice(i + 1);
        rows.push({ pin: part?.pins.find((x) => x.id === pinId)?.label ?? pinId, net: n.name });
      }
    }
    return { label: c.label, rows };
  });
}

export type PowerBudget = { drawMA: number; supplyMA: number | null; ok: boolean | null };

/** Sum of the current of every part that is not a supply, against the largest supply. */
export function powerBudget(doc: StudioDoc, getPart: GetPart): PowerBudget {
  let draw = 0;
  let supply = 0;
  for (const c of doc.components) {
    const p = getPart(c.partId);
    if (!p) continue;
    if (p.power.supplyMA) supply = Math.max(supply, p.power.supplyMA);
    else draw += p.power.mA;
  }
  return { drawMA: Math.round(draw), supplyMA: supply > 0 ? supply : null, ok: supply > 0 ? draw <= supply : null };
}

// ── Engineering jobs (admin queue) ───────────────────────────────────────────

/** Job statuses still being worked on; only these have a due time. */
export const OPEN_JOB_STATUSES: readonly string[] = ["queued", "in_progress"];

/** Open jobs whose ETA has passed (rows come from an open-status query). */
export function countOverdueJobs(rows: readonly { eta_at: string | null }[], now: number): number {
  return rows.filter((r) => r.eta_at && new Date(r.eta_at).getTime() < now).length;
}

export type JobDue = { late: boolean; hours: number; minutes: number };

/**
 * Time to an open job's ETA in whole minutes (rounded), split into hours and
 * minutes; `late` once it has passed. null when the job has no ETA or is not open.
 */
export function jobDue(job: { eta_at: string | null; status: string }, now: number): JobDue | null {
  if (!job.eta_at || !OPEN_JOB_STATUSES.includes(job.status)) return null;
  const mins = Math.round((new Date(job.eta_at).getTime() - now) / 60000);
  const abs = Math.abs(mins);
  return { late: mins < 0, hours: Math.floor(abs / 60), minutes: abs % 60 };
}
