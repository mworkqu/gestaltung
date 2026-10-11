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

/** Battery sources (a cell or pack that powers the product). Chargers/converters are not sources. */
const BATTERY_IDS = new Set(["cell_18650", "lipo_1000", "aa_holder_2"]);
const NOT_A_CELL = ["charger", "converter", "regulator", "boost", "buck", "step-up", "stepdown"];
/** Wall / USB supply boards that are a power source in their own right. */
const SUPPLY_IDS = new Set(["usbc_power_5v"]);
/** Li-ion charger: only makes sense with a rechargeable cell. */
const CHARGER_IDS = new Set(["tp4056_usbc"]);
/** Alkaline holders must not get a Li-ion charger. */
const ALKALINE_IDS = new Set(["aa_holder_2"]);
const BACKUP_RE = /\b(back-?up|redundan\w*|spare|fail-?over|second battery|two batteries|dual power)\b/i;

export function isBatteryCell(e: Pick<PickIndexEntry, "id" | "category" | "tags"> | undefined): boolean {
  if (!e || e.category !== "power") return false;
  if (BATTERY_IDS.has(e.id)) return true;
  const tags = e.tags ?? [];
  return tags.includes("battery") && !NOT_A_CELL.some((t) => tags.includes(t));
}

/** Does the spec explicitly ask for a backup / second power source? */
export function specWantsBackupPower(spec: ProductSpec): boolean {
  return BACKUP_RE.test([spec.name, spec.oneLine, ...spec.features].join(" . "));
}

/**
 * One power source, deterministically. Several batteries → keep one (the one
 * POWER_PARTS names for the spec, else the first); a battery next to a wall
 * supply board → keep what the spec's power asks for; a charger without a
 * rechargeable cell goes. Unless the spec asks for a backup. Pure; every
 * removal is logged.
 */
export function enforceSinglePower<T extends { partId: string }>(
  list: T[],
  opts: { spec: ProductSpec; byId: ReadonlyMap<string, PickIndexEntry>; log: ClampLog },
): T[] {
  const { spec, byId, log } = opts;
  if (specWantsBackupPower(spec)) return list;
  let out = list;
  const drop = (items: T[], why: string, keep: string | null) => {
    for (const p of items) log.push({ path: `components.power.${why}`, from: p.partId, to: keep });
    out = out.filter((p) => !items.includes(p));
  };
  const cells = () => out.filter((p) => isBatteryCell(byId.get(p.partId)));
  const supplies = () => out.filter((p) => SUPPLY_IDS.has(p.partId));

  // Mains / USB products carry no battery; battery products carry no supply board.
  if (cells().length && supplies().length) {
    if (spec.power === "usb" || spec.power === "mains_adapter") drop(cells(), "battery_vs_supply", supplies()[0].partId);
    else drop(supplies(), "supply_vs_battery", cells()[0].partId);
  }

  // Several batteries → one.
  const c = cells();
  if (c.length > 1) {
    const preferred = POWER_PARTS[spec.power].find((id) => c.some((p) => p.partId === id));
    const keep = c.find((p) => p.partId === preferred) ?? c[0];
    drop(c.filter((p) => p !== keep), "duplicate_battery", keep.partId);
  }
  // Several supply boards → one.
  const sup = supplies();
  if (sup.length > 1) drop(sup.slice(1), "duplicate_supply", sup[0].partId);

  // A charger needs a rechargeable cell (not alkaline, not nothing).
  const kept = cells();
  const chargers = out.filter((p) => CHARGER_IDS.has(p.partId));
  if (chargers.length && !kept.some((p) => !ALKALINE_IDS.has(p.partId))) {
    drop(chargers, "charger_without_cell", kept[0]?.partId ?? null);
  }
  return out;
}

/**
 * Library parts the spec itself asks for (W3, from the idea guards): a pump output needs
 * the water pump (the wiring adds its driver), a valve needs the relay that switches it,
 * a plant that is watched needs the soil probe. Only ids present in the library are added.
 */
export function specParts(spec: ProductSpec): string[] {
  const ids: string[] = [];
  const feature = (re: RegExp) => spec.features.some((f) => re.test(f));
  if (spec.outputs.includes("pump")) ids.push("pump_5v");
  if (spec.outputs.includes("relay") && feature(/valve|solenoid|صمام/i)) ids.push("relay_module");
  if (spec.placement === "plant_soil" && feature(/soil|moist|رطوبة|تربة/i)) ids.push("soil_moisture_cap");
  return ids;
}

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

  // Two batteries / a battery plus a wall supply: one power source.
  list = enforceSinglePower(list, { spec: opts.spec, byId, log });

  // Power parts spec.power needs.
  const power: Pending[] = [];
  for (const id of POWER_PARTS[opts.spec.power]) {
    const entry = byId.get(id);
    if (!entry || list.some((p) => p.partId === id)) continue;
    // A cell the model already chose stands in for the default cell.
    if (isBatteryCell(entry) && list.some((p) => isBatteryCell(byId.get(p.partId)))) continue;
    power.push({ partId: id, label: name(entry) });
    log.push({ path: "components.power", from: null, to: id });
  }
  if (power.length) list.splice(list.length && isMcu(list[0]) ? 1 : 0, 0, ...power);
  // Added parts can again pair a charger with the wrong cell, or a cell with a supply.
  list = enforceSinglePower(list, { spec: opts.spec, byId, log });

  // Parts the spec itself names (W3): the model may drop them, we never do.
  for (const id of specParts(opts.spec)) {
    const entry = byId.get(id);
    if (!entry || list.some((p) => p.partId === id)) continue;
    list.splice(list.length && isMcu(list[0]) ? 1 : 0, 0, { partId: id, label: name(entry) });
    log.push({ path: "components.spec", from: null, to: id });
  }

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
