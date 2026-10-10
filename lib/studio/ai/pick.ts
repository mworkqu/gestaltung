// Part picker. Pure orchestration around an injected StudioCall.
//
// The model may only name ids from the library index it was given. The server
// then enforces the rules the model cannot be trusted with: unknown ids are
// dropped, exactly one mcu (none → esp32_devkit, several → the first), the
// power parts that spec.power needs, at most 12 parts, short labels/reasons.
// Two failed answers → a minimal default (the mcu + the power parts).

import type { ClampLog, ProductSpec, StudioComponent } from "../schema";
import { LABEL_MAX, MAX_COMPONENTS, PICK_RESPONSE_SCHEMA, PICK_SYSTEM, REASON_MAX, pickPrompt } from "./prompts";
import { cut, isObj, type Outcome, type StudioCall } from "./types";

/** What libraryIndexForAI() gives the model (only id + category are relied on here). */
export type PickIndexEntry = {
  id: string;
  category: string;
  tags?: readonly string[];
  name?: unknown;
  power?: unknown;
  logicV?: unknown;
};

export type Picked = { components: StudioComponent[]; reasons: Record<string, string> };

export const DEFAULT_MCU = "esp32_devkit";
/** Power parts per spec.power (only those present in the library are added). */
export const POWER_PARTS: Record<ProductSpec["power"], readonly string[]> = {
  usb: [],
  battery: ["cell_18650", "tp4056_usbc"],
  battery_usb: ["cell_18650", "tp4056_usbc"],
  mains_adapter: [],
};

/** Optional localized display name (e.g. getPart(id)?.name[locale]). */
export type NameFor = (id: string, locale: "en" | "ar") => string | undefined;

function nameOf(entry: PickIndexEntry, locale: "en" | "ar", nameFor?: NameFor): string {
  const own = nameFor?.(entry.id, locale);
  if (own) return own;
  const n = entry.name;
  if (typeof n === "string") return n;
  if (isObj(n)) {
    const v = n[locale] ?? n.en;
    if (typeof v === "string") return v;
  }
  return entry.id.replace(/_/g, " ");
}

/** Model answer (any shape) → a rule-abiding parts list. Every change goes to `log`. */
export function enforcePick(
  raw: unknown,
  opts: { spec: ProductSpec; index: readonly PickIndexEntry[]; locale: "en" | "ar"; log: ClampLog; nameFor?: NameFor },
): Picked {
  const { index, log, locale } = opts;
  const name = (e: PickIndexEntry) => cut(nameOf(e, locale, opts.nameFor), LABEL_MAX);
  const byId = new Map(index.map((e) => [e.id, e]));
  const o = isObj(raw) ? raw : {};
  const rawComponents = Array.isArray(o.components) ? o.components : [];

  type Pending = { partId: string; label: string };
  let list: Pending[] = [];
  for (const [i, c] of rawComponents.entries()) {
    const partId = isObj(c) && typeof c.partId === "string" ? c.partId.trim() : "";
    if (!byId.has(partId)) {
      log.push({ path: `components[${i}].partId`, from: isObj(c) ? c.partId : c, to: null });
      continue;
    }
    const label = cut(isObj(c) ? c.label : "", LABEL_MAX) || name(byId.get(partId)!);
    if (isObj(c) && typeof c.label === "string" && c.label.trim() && c.label.trim() !== label)
      log.push({ path: `components[${i}].label`, from: c.label, to: label });
    list.push({ partId, label });
  }

  // Exactly one mcu.
  const isMcu = (p: Pending) => byId.get(p.partId)?.category === "mcu";
  const mcus = list.filter(isMcu);
  if (mcus.length === 0) {
    const fallback = byId.get(DEFAULT_MCU) ?? index.find((e) => e.category === "mcu");
    if (fallback) {
      list.unshift({ partId: fallback.id, label: name(fallback) });
      log.push({ path: "components.mcu", from: null, to: fallback.id });
    }
  } else if (mcus.length > 1) {
    const keep = mcus[0];
    list = list.filter((p) => !isMcu(p) || p === keep);
    log.push({ path: "components.mcu", from: mcus.map((m) => m.partId), to: keep.partId });
  }
  // The mcu leads the list so the 12-part cap never drops it.
  const mcuIdx = list.findIndex(isMcu);
  if (mcuIdx > 0) list.unshift(...list.splice(mcuIdx, 1));

  // Power parts spec.power needs.
  const power: Pending[] = [];
  for (const id of POWER_PARTS[opts.spec.power]) {
    const entry = byId.get(id);
    if (!entry || list.some((p) => p.partId === id)) continue;
    power.push({ partId: id, label: name(entry) });
    log.push({ path: "components.power", from: null, to: id });
  }
  if (power.length) list.splice(list.length && isMcu(list[0]) ? 1 : 0, 0, ...power);

  if (list.length > MAX_COMPONENTS) {
    log.push({ path: "components", from: list.length, to: MAX_COMPONENTS });
    list = list.slice(0, MAX_COMPONENTS);
  }

  const counts = new Map<string, number>();
  const components: StudioComponent[] = list.map((p) => {
    const n = (counts.get(p.partId) ?? 0) + 1;
    counts.set(p.partId, n);
    return { partId: p.partId, instanceId: `${p.partId}_${n}`, label: p.label };
  });

  // Reasons: {partId: sentence} or [{partId, reason}] — only for parts kept.
  const reasons: Record<string, string> = {};
  const kept = new Set(components.map((c) => c.partId));
  const rawReasons: [string, unknown][] = Array.isArray(o.reasons)
    ? o.reasons.filter(isObj).map((r) => [String(r.partId ?? ""), r.reason] as [string, unknown])
    : isObj(o.reasons)
      ? Object.entries(o.reasons)
      : [];
  for (const [id, text] of rawReasons) {
    const reason = cut(text, REASON_MAX);
    if (kept.has(id) && reason && !reasons[id]) reasons[id] = reason;
  }
  for (const c of components) if (reasons[c.partId]) c.reason = reasons[c.partId];
  return { components, reasons };
}

export function validatePick(
  raw: unknown,
  opts: { spec: ProductSpec; index: readonly PickIndexEntry[]; locale: "en" | "ar"; log: ClampLog; nameFor?: NameFor },
): { value: Picked | null; errors: string[] } {
  if (!isObj(raw) || !Array.isArray(raw.components)) return { value: null, errors: ["the answer must be {components:[{partId,label}], reasons}"] };
  const ids = new Set(opts.index.map((e) => e.id));
  const named = raw.components.map((c) => (isObj(c) ? c.partId : null));
  if (!named.some((id) => typeof id === "string" && ids.has(id.trim()))) {
    const unknown = named.filter((id) => typeof id === "string").slice(0, 6).join(", ");
    return { value: null, errors: [`use only part ids from the library list${unknown ? ` (not: ${unknown})` : ""}`] };
  }
  return { value: enforcePick(raw, opts), errors: [] };
}

export async function runPick(opts: {
  call: StudioCall;
  spec: ProductSpec;
  index: readonly PickIndexEntry[];
  locale: "en" | "ar";
  nameFor?: NameFor;
}): Promise<Outcome<Picked>> {
  const log: ClampLog = [];
  const r = await opts.call<Picked>({
    step: "pick",
    system: PICK_SYSTEM,
    prompt: pickPrompt({ spec: opts.spec, index: [...opts.index], locale: opts.locale }),
    schema: PICK_RESPONSE_SCHEMA,
    validate: (raw) => {
      const attempt: ClampLog = [];
      const res = validatePick(raw, { spec: opts.spec, index: opts.index, locale: opts.locale, log: attempt, nameFor: opts.nameFor });
      if (res.value) log.splice(0, log.length, ...attempt);
      return res;
    },
  });
  if (r.ok) return { ok: true, value: r.value, source: "model", clampLog: log, problems: [] };
  if (r.error === "paused" || r.error === "rate_limited") return { ok: false, error: r.error, clampLog: log, problems: r.problems };
  // invalid twice, or the provider is down: the minimal deterministic list.
  const fallback: ClampLog = [];
  const value = enforcePick({ components: [] }, { spec: opts.spec, index: opts.index, locale: opts.locale, log: fallback, nameFor: opts.nameFor });
  return { ok: true, value, source: "default", clampLog: fallback, problems: r.problems };
}
