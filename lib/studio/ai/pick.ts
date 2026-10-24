// Part picker. Pure orchestration around an injected StudioCall.
//
// The model may only name ids from the library index it was given. The server
// then enforces the rules the model cannot be trusted with: unknown ids are
// dropped, one mcu when the build class needs a controller (none → esp32_devkit,
// several → the first) and NONE when it does not (a logic or cad build — see
// lib/studio/build-class.ts; an mcu the model slipped in is dropped and logged), the
// power parts that spec.power needs, the actuator rules (Part D, actuator-rules.ts:
// servo count/size from spec.actuators, PCA9685 driver, 5 V 5 A supply), at most 12
// KINDS of part (6 servos = 1 slot), short labels/reasons.
// Two failed answers → a minimal default: the power parts, the actuator rules and whatever
// the card itself promises, led by the mcu — or, on a logic build, by the breadboard and
// the gate chips the card names, with no mcu at all.

import type { BuildClass, ClampLog, Pin, ProductSpec, StudioComponent } from "../schema";
import { classFor, needsController } from "../build-class";
import { applyActuatorRules, capKinds, SUPPLY_BOARD_IDS } from "./actuator-rules";
import { LABEL_MAX, MAX_COMPONENTS, PICK_RESPONSE_SCHEMA, PICK_SYSTEM, REASON_MAX, pickPrompt } from "./prompts";
import { outcomeCached, pickKey, type AiCache } from "./cache";
import { cut, isObj, type Outcome, type StudioCall } from "./types";
import { applyCardColours, cardItems, offCard } from "../card-parts";

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
/**
 * A logic build (no microcontroller, no firmware) is still a build: the gates have to sit
 * on something and be wired with something. Only ids present in the library are added.
 */
export const LOGIC_PARTS: readonly string[] = ["breadboard_830", "jumper_kit"];
/**
 * Parts the 12-kind cap must never drop. On an mcu build that is the board. On a logic
 * build the board does not exist, so it is the gate chips and the breadboard they sit on.
 */
const LOGIC_LEAD_IDS = new Set(["breadboard_830"]);
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
const SUPPLY_IDS = SUPPLY_BOARD_IDS;
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

// ── Stock preference (F-046) ───────────────────────────────────────────────
// The picker chose a LiPo pack we cannot hand over ("We'll source this") while an 18650 cell
// sat in stock at QAR 20. The MODEL never chooses a SKU: it proposes a function, and our code
// then takes the part we can actually give for that same function. Groups are hand-checked
// pairs of parts that do the same job in a kit, best-stocked-first is decided per circuit.

export const EQUIVALENT_GROUPS: readonly (readonly string[])[] = [
  // One rechargeable lithium cell on a USB charger. Both are 3.7 V, both charge on a TP4056.
  ["cell_18650", "lipo_1000"],
  // A small mono I2C screen: same driver, same wiring, a few millimetres apart.
  ["oled_13_i2c", "oled_096_i2c"],
];

/** Is there a store product behind this part, i.e. can we hand it over today? */
export type StockOf = (id: string) => boolean;

/**
 * Swaps a part we cannot supply for an equivalent we can. Nothing outside EQUIVALENT_GROUPS is
 * ever swapped, and a group with nothing in stock is left exactly as the model proposed —
 * which is what SOURCED_REASON then says on the part itself.
 */
export function preferStocked<T extends { partId: string; label: string }>(
  list: T[],
  opts: { byId: ReadonlyMap<string, PickIndexEntry>; stockOf: StockOf; log: ClampLog; name: (id: string) => string },
): T[] {
  return list.map((p) => {
    if (opts.stockOf(p.partId)) return p;
    const group = EQUIVALENT_GROUPS.find((g) => g.includes(p.partId));
    const better = group?.find((id) => id !== p.partId && opts.byId.has(id) && opts.stockOf(id));
    if (!better) return p;
    opts.log.push({ path: "components.stock", from: p.partId, to: better });
    return { ...p, partId: better, label: opts.name(better) };
  });
}

/**
 * Said on a part we keep although we cannot hand it over: the client sees WHY it is still here
 * instead of an unexplained "We'll source this". Shown only when the part itself gave no reason.
 */
export const SOURCED_REASON: Record<"en" | "ar", string> = {
  en: "We'll source this one: nothing we stock does this job.",
  ar: "سنوفّر هذه القطعة بالطلب: لا تتوفر لدينا قطعة بديلة تؤدي نفس الوظيفة.",
};

/** Optional localized display name (e.g. getPart(id)?.name[locale]). */
export type NameFor = (id: string, locale: "en" | "ar") => string | undefined;
/**
 * Any library part by id, helpers included (e.g. the LED, which the model's index leaves
 * out): what the card names is added even when the model could not pick it.
 */
export type Lookup = (id: string) => PickIndexEntry | undefined;
/** Optional library pins per part id (e.g. getPart(id)?.pins): the actuator rules' pin budget. */
export type PinsOf = (id: string) => readonly Pin[] | undefined;

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
  opts: { spec: ProductSpec; index: readonly PickIndexEntry[]; locale: "en" | "ar"; log: ClampLog; nameFor?: NameFor; pinsOf?: PinsOf; lookup?: Lookup; stockOf?: StockOf },
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

  // One mcu — but only for a build that runs firmware (2026-10-20). A logic or cad build
  // has NO microcontroller: zero is the right answer, and one the model slipped in goes.
  const buildClass: BuildClass = classFor(opts.spec);
  const wantsMcu = needsController({ buildClass });
  const isMcu = (p: Pending) => byId.get(p.partId)?.category === "mcu";
  const mcus = list.filter(isMcu);
  if (!wantsMcu) {
    if (mcus.length) {
      list = list.filter((p) => !isMcu(p));
      log.push({ path: "components.mcu", from: mcus.map((m) => m.partId), to: null });
    }
  } else if (mcus.length === 0) {
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

  // A logic build needs the breadboard and the jumpers to be a build at all.
  if (buildClass === "logic") {
    for (const id of LOGIC_PARTS) {
      const entry = byId.get(id) ?? opts.lookup?.(id);
      if (!entry) continue;
      byId.set(id, entry);
      if (list.some((p) => p.partId === id)) continue;
      list.push({ partId: id, label: name(entry) });
      log.push({ path: "components.logic", from: null, to: id });
    }
  }

  /**
   * The lead parts head the list, so the 12-kind cap never drops them and the power parts
   * are inserted after them: the board on an mcu build, the gate chips and their
   * breadboard on a logic build.
   */
  const isLead = (p: Pending) =>
    wantsMcu ? isMcu(p) : byId.get(p.partId)?.category === "logic" || LOGIC_LEAD_IDS.has(p.partId);
  const hoistLeads = () => {
    if (!list.some(isLead)) return;
    list = [...list.filter(isLead), ...list.filter((p) => !isLead(p))];
  };
  /** Where a part that is not a lead belongs: straight after the lead block. */
  const afterLeads = () => {
    let n = 0;
    while (n < list.length && isLead(list[n])) n++;
    return n;
  };
  hoistLeads();

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
  if (power.length) list.splice(afterLeads(), 0, ...power);
  // Added parts can again pair a charger with the wrong cell, or a cell with a supply.
  list = enforceSinglePower(list, { spec: opts.spec, byId, log });

  // Parts the spec itself names (W3): the model may drop them, we never do.
  for (const id of specParts(opts.spec)) {
    const entry = byId.get(id);
    if (!entry || list.some((p) => p.partId === id)) continue;
    list.splice(afterLeads(), 0, { partId: id, label: name(entry) });
    log.push({ path: "components.spec", from: null, to: id });
  }

  // Not on the card: a sensor or output the card never names is dropped (the card decides).
  {
    const before = list.length;
    list = list.filter((p) => !offCard(opts.spec, p.partId));
    if (list.length !== before) log.push({ path: "components.offCard", from: before, to: list.length });
  }

  // Everything on the card (2026-10-18): each sensor, output and mover becomes a part, with
  // its count ("3 LEDs" → 3 LEDs; the wiring adds a resistor each). Servo counts and the
  // servo mix stay with the actuator rules below.
  for (const item of cardItems(opts.spec)) {
    for (const x of item.ids) {
      const e = byId.get(x) ?? opts.lookup?.(x);
      if (e) byId.set(x, e);
    }
    const id = item.ids.find((x) => byId.has(x));
    if (!id) continue;
    const have = list.filter((p) => item.ids.includes(p.partId)).length;
    const want = item.key === "servo" ? Math.min(item.count, 1) : item.count;
    for (let i = have; i < want; i++) {
      list.push({ partId: id, label: name(byId.get(id)!) });
      log.push({ path: "components.card", from: null, to: id });
    }
  }

  // Part D: how many servos / pumps / motors, the servo driver and a supply strong enough.
  list = applyActuatorRules(list, {
    spec: opts.spec,
    byId,
    log,
    name: (id) => name(byId.get(id) ?? { id, category: "" }),
    pinsOf: opts.pinsOf,
  });

  // A pump or fan that only switches on/off takes a MOSFET switch, not an H-bridge (owner,
  // 2026-10-18); the H-bridge stays when a motor in the list may need to reverse.
  const tagsOf = (id: string) => byId.get(id)?.tags ?? [];
  const needsHBridge = list.some((p) => {
    const tags = tagsOf(p.partId);
    return tags.includes("motor") && !tags.some((t) => t === "pump" || t === "fan" || t === "driver" || t === "module" || t === "servo");
  });
  if (!needsHBridge && byId.has("mosfet_module") && list.some((p) => p.partId === "motor_driver")) {
    const sw = byId.get("mosfet_module")!;
    list = list.map((p) => (p.partId === "motor_driver" ? { partId: sw.id, label: name(sw) } : p));
    log.push({ path: "components.driver", from: "motor_driver", to: "mosfet_module" });
  }

  // F-046: an in-stock equivalent beats one we would have to source. Last of the part rules,
  // so parts added by the card and the actuator rules are covered too.
  if (opts.stockOf) {
    list = preferStocked(list, {
      byId,
      stockOf: opts.stockOf,
      log,
      name: (id) => name(byId.get(id) ?? opts.lookup?.(id) ?? { id, category: "" }),
    });
    list = enforceSinglePower(list, { spec: opts.spec, byId, log });
  }

  // At most 12 kinds of part (identical parts are one slot), at most 8 of one part. The
  // leads go first again: the card and the actuator rules appended parts after them.
  hoistLeads();
  list = capKinds(list, MAX_COMPONENTS, log);

  const counts = new Map<string, number>();
  // The card's colours ("green, yellow and red LEDs") go on the instances (lib/studio/variants.ts).
  const components: StudioComponent[] = applyCardColours(
    opts.spec,
    list.map((p) => {
      const n = (counts.get(p.partId) ?? 0) + 1;
      counts.set(p.partId, n);
      return { partId: p.partId, instanceId: `${p.partId}_${n}`, label: p.label } as StudioComponent;
    }),
  );

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
  // F-046: a part we could not swap for a stocked one says why it is still here.
  if (opts.stockOf) {
    for (const c of components) {
      if (c.reason || opts.stockOf(c.partId)) continue;
      c.reason = SOURCED_REASON[locale];
    }
  }
  return { components, reasons };
}

export function validatePick(
  raw: unknown,
  opts: { spec: ProductSpec; index: readonly PickIndexEntry[]; locale: "en" | "ar"; log: ClampLog; nameFor?: NameFor; pinsOf?: PinsOf; lookup?: Lookup; stockOf?: StockOf },
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
  pinsOf?: PinsOf;
  lookup?: Lookup;
  /** F-046: is there a store product behind a part id? Without it no stock preference is applied. */
  stockOf?: StockOf;
  /** W8: the same spec (and language, and library) is answered without a model call. */
  cache?: AiCache | null;
}): Promise<Outcome<Picked>> {
  return outcomeCached(opts.cache, pickKey(opts), () => pickWithModel(opts));
}

async function pickWithModel(opts: {
  call: StudioCall;
  spec: ProductSpec;
  index: readonly PickIndexEntry[];
  locale: "en" | "ar";
  nameFor?: NameFor;
  pinsOf?: PinsOf;
  lookup?: Lookup;
  /** F-046: is there a store product behind a part id? Without it no stock preference is applied. */
  stockOf?: StockOf;
}): Promise<Outcome<Picked>> {
  const log: ClampLog = [];
  const r = await opts.call<Picked>({
    step: "pick",
    system: PICK_SYSTEM,
    prompt: pickPrompt({ spec: opts.spec, index: [...opts.index], locale: opts.locale, actuators: opts.spec.actuators }),
    schema: PICK_RESPONSE_SCHEMA,
    validate: (raw) => {
      const attempt: ClampLog = [];
      const res = validatePick(raw, { spec: opts.spec, index: opts.index, locale: opts.locale, log: attempt, nameFor: opts.nameFor, pinsOf: opts.pinsOf, lookup: opts.lookup, stockOf: opts.stockOf });
      if (res.value) log.splice(0, log.length, ...attempt);
      return res;
    },
  });
  if (r.ok) return { ok: true, value: r.value, source: "model", clampLog: log, problems: [] };
  if (r.error === "paused" || r.error === "rate_limited") return { ok: false, error: r.error, clampLog: log, problems: r.problems };
  // invalid twice, or the provider is down: the minimal deterministic list.
  const fallback: ClampLog = [];
  const value = enforcePick({ components: [] }, { spec: opts.spec, index: opts.index, locale: opts.locale, log: fallback, nameFor: opts.nameFor, pinsOf: opts.pinsOf, lookup: opts.lookup, stockOf: opts.stockOf });
  return { ok: true, value, source: "default", clampLog: fallback, problems: r.problems };
}
