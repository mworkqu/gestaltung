/**
 * Build file (from a client's own AI) → a StudioDoc the website opens on the Enclosure
 * step. Pure: every rule is the Studio's own (enforcePick, buildWiring, syncPinBlock,
 * clampSpec / clampEnclosure), so a plugin project obeys exactly what a website project
 * obeys. The client's AI proposes parts; our code decides the circuit and the pins.
 * build.cad and build.wiring_notes never reach the doc (the cad brief is kept elsewhere
 * by the server, and the wiring is always recomputed).
 */
import { findController, ensureRunGuard } from "@/lib/prototyping/firmware";
import { hardFlagId, hardRules, sanityChecks } from "@/lib/prototyping/netlist";
import { enforcePick, type PickIndexEntry } from "@/lib/studio/ai/pick";
import { AI_TEMPLATES } from "@/lib/studio/ai/prompts";
import { cardItems } from "@/lib/studio/card-parts";
import { syncPinBlock } from "@/lib/studio/code-link";
import { buildConnections } from "@/lib/studio/connections";
import { defaultEnclosureFor, adaptEnclosure } from "@/lib/studio/enclosure/shape-pick";
import { layoutComponents } from "@/lib/studio/layout";
import { buildWiring, type WiringResult } from "@/lib/studio/netlist";
import {
  clampEnclosure,
  clampSpec,
  INPUTS,
  LIMITS,
  OUTPUTS,
  StudioDocSchema,
  type Actuator,
  type ClampLog,
  type EnclosureSpec,
  type Input,
  type LibraryPart,
  type Output,
  type ProductSpec,
  type SizeHint,
  type StudioComponent,
  type StudioDoc,
  type Use,
} from "@/lib/studio/schema";
import type { BuildFile } from "./build-file";

export type { PickIndexEntry };

export type PluginLibrary = {
  getPart: (id: string) => LibraryPart | undefined;
  /** All enabled parts, helpers included. */
  parts: readonly LibraryPart[];
  /** lib.libraryIndexForAI(): what the website's picker is allowed to name. */
  index: readonly PickIndexEntry[];
};

export type StudioMapResult = {
  doc: StudioDoc | null;
  problems: string[];
  warnings: string[];
  added: string[];
  removed: string[];
};

/** Same cap as lib/studio/server/doc.ts DOC_MAX_BYTES (server-only, so not importable here). */
export const PLUGIN_DOC_MAX_BYTES = 256 * 1024;
/** Longest answers value the idea chat itself writes (answersFrom, r:<n>). */
const ANSWER_MAX = 1500;
const MSG_MAX = 200;

export function pluginLibraryFrom(lib: {
  parts: readonly LibraryPart[];
  getPart: (id: string) => LibraryPart | undefined;
  libraryIndexForAI: () => PickIndexEntry[];
}): PluginLibrary {
  return { getPart: lib.getPart, parts: lib.parts, index: lib.libraryIndexForAI() };
}

/**
 * Helper parts a client may name directly: exactly the helpers enforcePick's `lookup` can
 * bring in for a card (the LED today). Resistors and level shifters stay ours alone — the
 * wiring adds them where they are needed.
 */
export function directHelperIds(lib: PluginLibrary): Set<string> {
  const card = clampSpec({ name: "All card items", outputs: [...OUTPUTS], inputs: [...INPUTS] });
  const reachable = new Set(cardItems(card).flatMap((i) => i.ids));
  return new Set(lib.parts.filter((p) => p.helper && reachable.has(p.id)).map((p) => p.id));
}

/**
 * The index enforcePick gets: the website's index plus the direct helpers this build names,
 * so the client's own LED is kept with its count (the website model never sees helpers).
 */
export function pluginIndex(build: Pick<BuildFile, "parts">, lib: PluginLibrary): PickIndexEntry[] {
  const allowed = directHelperIds(lib);
  const have = new Set(lib.index.map((e) => e.id));
  const extra: PickIndexEntry[] = [];
  for (const { library_id: id } of build.parts) {
    const p = lib.getPart(id);
    if (!p || have.has(id) || !allowed.has(id)) continue;
    have.add(id);
    extra.push({ id: p.id, category: p.category, tags: p.tags, name: p.name.en, power: { ...p.power }, logicV: p.power.logicV });
  }
  return [...lib.index, ...extra];
}

/** Cut at a word boundary, never above max characters. */
export function cutWords(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const sp = head.lastIndexOf(" ");
  return (sp > max * 0.5 ? head.slice(0, sp) : t.slice(0, max)).replace(/[\s,.;:–-]+$/, "");
}

const msg = (s: string) => (s.length > MSG_MAX ? `${s.slice(0, MSG_MAX - 1)}…` : s);

// ── Spec ─────────────────────────────────────────────────────────────────────
// The spec is derived ONLY from what the client chose. cardItems()/specParts() add a part
// for every output the spec names, so an output we invented would put a part in the
// client's list they never asked for. No `understanding` either: offCard() would then
// drop chosen sensors the card did not mention.

const OUTPUT_OF: Record<string, Output> = {
  led_5mm: "led",
  ws2812_ring: "led",
  buzzer: "buzzer",
  speaker_amp: "speaker",
  relay_module: "relay",
  pump_5v: "pump",
  n20_motor: "motor",
};
const INPUT_OF: Record<string, Input> = { button_6mm: "button", rotary_encoder: "knob" };
const USE_OF: Partial<Record<BuildFile["look"]["template"], Use>> = { wall_plate: "wall", handheld_taper: "handheld" };

function sizeHintOf(note: string): SizeHint {
  if (/pocket|key ?chain|tiny/i.test(note)) return "pocket";
  if (/\b(large|big|floor)\b/i.test(note)) return "large";
  if (/\bdesk\b|table/i.test(note)) return "desk";
  return "palm";
}

export function deriveSpec(build: BuildFile, lib: PluginLibrary, warnings: string[]): ProductSpec {
  const ids = build.parts.map((p) => p.library_id);
  const parts = ids.map((id) => lib.getPart(id)).filter((p): p is LibraryPart => !!p);
  const qtyOf = (id: string) => build.parts.filter((p) => p.library_id === id).reduce((s, p) => s + p.qty, 0);
  const roleOf = (id: string) => build.parts.find((p) => p.library_id === id && p.role)?.role;

  const outputs = new Set<Output>();
  const inputs = new Set<Input>();
  for (const p of parts) {
    const o = OUTPUT_OF[p.id] ?? (p.category === "display" ? "screen" : undefined);
    if (o) outputs.add(o);
    const i = INPUT_OF[p.id] ?? (p.tags.includes("touch") ? "touch" : undefined);
    if (i) inputs.add(i);
  }

  const actuators: Actuator[] = [];
  const group = (id: string, kind: Actuator["kind"], load: Actuator["load"]) => {
    const n = qtyOf(id);
    if (!n || !lib.getPart(id)) return;
    const role = roleOf(id);
    actuators.push({ kind, count: Math.min(LIMITS.actuators.countMax, n), load, ...(role ? { role: role.slice(0, LIMITS.actuators.roleMax) } : {}) });
  };
  group("mg996r_servo", "servo", "heavy");
  group("sg90_servo", "servo", "light");
  group("pump_5v", "pump", "light");
  group("n20_motor", "motor", "light");

  const s = build.summary;
  let power: ProductSpec["power"] = "usb";
  if (s.power === "adapter") power = "mains_adapter";
  else if (s.power === "battery" || s.power === "solar") {
    // A Li-ion charger the client chose means "charges over USB": the website's battery_usb.
    const charger = parts.some((p) => p.category === "power" && p.tags.includes("charger"));
    power = charger ? "battery_usb" : "battery";
  }
  if (s.power === "solar") {
    warnings.push("Solar charging is not in our part library yet; we planned it as battery powered and our engineer will review solar.");
  }

  const hasMcu = parts.some((p) => p.category === "mcu");
  const hasLogic = parts.some((p) => p.category === "logic");
  const soil = parts.some((p) => p.id === "soil_moisture_cap");

  return clampSpec({
    name: cutWords(build.name, LIMITS.name.max),
    oneLine: cutWords(s.what_it_does, LIMITS.oneLine.max),
    use: USE_OF[build.look.template] ?? "desk",
    power,
    environment: s.where_used === "indoor" ? "indoor" : "outdoor",
    features: s.decisions.map((d) => cutWords(d, LIMITS.features.itemMax)).filter(Boolean).slice(0, LIMITS.features.max),
    inputs: [...inputs],
    outputs: [...outputs],
    sizeHint: sizeHintOf(s.size_note),
    style: "rounded",
    ...(soil && build.look.template === "stake_pod" ? { placement: "plant_soil" } : {}),
    ...(actuators.length ? { actuators: actuators.slice(0, LIMITS.actuators.max) } : {}),
    // Stored, never inferred: a "truth table" or "bracket" in the client's words must not
    // strip the controller off an electronics build (inferBuildClass is a guess).
    buildClass: hasLogic && !hasMcu ? "logic" : "mcu",
    quantity: 1,
  });
}

// ── Rule changes in plain words ──────────────────────────────────────────────

const LOG_REASON: [RegExp, string][] = [
  [/^components\.mcu\.pins$/, "the servos need more signal pins than that board has"],
  [/^components\.mcu$/, "a product has exactly one controller board"],
  [/^components\.power\./, "a product has one power source"],
  [/^components\.power$/, "the power source you chose needs it"],
  [/^components\.spec$/, "the product description needs it"],
  [/^components\.card$/, "the product description needs it"],
  [/^components\.driver$/, "a pump or fan that only switches on and off takes a MOSFET switch, not a motor driver"],
  [/^components\.stock$/, "it does the same job and we stock it"],
  [/^components\.servo_driver$/, "three or more servos need a servo driver board"],
  [/^components\.servo_power$/, "the servos need more current than the supply can give"],
  [/^components\.servo$/, "servo sizes follow the load each joint carries"],
  [/^components\.(pump|motor)$/, "the counts follow your movers"],
  [/^components\.logic$/, "a logic build sits on a breadboard with jumper wires"],
  [/^components(\.copies)?$/, "a product has at most 12 kinds of part and 8 of one part"],
];

function mentions(v: unknown, id: string): boolean {
  if (v === id) return true;
  if (Array.isArray(v)) return v.includes(id);
  if (v && typeof v === "object") return JSON.stringify(v).includes(`"${id}"`);
  return false;
}

function reasonFor(log: ClampLog, id: string, side: "to" | "from"): string | null {
  for (const e of log) {
    if (!mentions(e[side], id)) continue;
    const hit = LOG_REASON.find(([re]) => re.test(e.path));
    if (hit) return hit[1];
  }
  return null;
}

const countBy = (ids: readonly string[]) => {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
};

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * Website checks that do not block a plugin project: what our rules fixed (added_*), the
 * USB caution, and the power-source notes the website also lets a client order with.
 * power_budget is advisory too: the golden plant waterer (and EXAMPLE_BUILD_FILE) carries it
 * on the website, and our engineer sizes the supply at review.
 */
const ADVISORY = /^(added_|usb_backfeed|power_budget|no_charger|no_battery|battery_unwanted)/;

function wiringFindings(w: WiringResult, problems: string[], warnings: string[]) {
  for (const c of w.checks) {
    if (c.ok) continue;
    (ADVISORY.test(c.id) ? warnings : problems).push(msg(c.plain));
  }
  const ids = new Set(w.checks.map((c) => c.id));
  // The rule engine's flags the plain checks did not already turn into a line.
  for (const f of hardRules(w.legacy)) {
    const key = f.code === "shorted_supplies" || f.code === "power_budget" ? f.code : `${f.code}:${f.ref}`;
    if (ids.has(key) || ids.has(f.code)) continue;
    if (f.code === "power_budget") continue;
    problems.push(msg(`Our circuit check flagged ${hardFlagId(f).replace(/^circuit:/, "")}. Change the parts so this goes away.`));
  }
  for (const f of sanityChecks(w.legacy)) {
    if (f.code === "unpowered" && [...ids].some((i) => i.endsWith(`:${f.ref}`))) continue;
    if (f.code === "unpowered") problems.push(msg(`${f.ref} gets no power in our wiring. Add a part that powers it, or remove it.`));
    else if (f.code === "shorted") problems.push(msg(`Two outputs drive the same wire (${f.net}). Remove one of the parts on it.`));
    else if (f.code === "overcurrent") warnings.push(msg(`The ${f.rail} supply is loaded with ${f.drawMa} mA of ${f.maxMa} mA. Our engineer will check the power supply.`));
    else if (f.code === "floating") warnings.push(msg(`The wire ${f.net} connects to nothing else.`));
  }
  if (w.unconnected.length) {
    warnings.push(msg(`These pins are not connected in our wiring: ${w.unconnected.slice(0, 12).join(", ")}${w.unconnected.length > 12 ? "…" : ""}.`));
  }
}

// ── The mapping, step by step ────────────────────────────────────────────────

type Ctx = { lib: PluginLibrary; problems: string[]; warnings: string[]; nameOf: (id: string) => string };

/** Ids we cannot take at all: an unknown part, a helper only our wiring adds, a board that is not in parts. */
function requestProblems(build: BuildFile, lib: PluginLibrary): string[] {
  const out: string[] = [];
  const directHelpers = directHelperIds(lib);
  for (const p of build.parts) {
    const part = lib.getPart(p.library_id);
    if (!part) out.push(msg(`Part '${p.library_id}' is not in our library. Pick an id from get_design_rules.`));
    else if (part.helper && !directHelpers.has(part.id))
      out.push(msg(`Part '${p.library_id}' is added by our wiring rules where it is needed. Remove it from parts.`));
  }
  const board = build.code?.board;
  if (board && (!build.parts.some((p) => p.library_id === board) || lib.getPart(board)?.category !== "mcu"))
    out.push(msg(`code.board '${board}' must be the library_id of the controller board in parts.`));
  return out;
}

/** What our rules changed, compared piece by piece with what was asked for. */
function ruleChanges(requested: string[], w: WiringResult, log: ClampLog, c: Ctx): { added: string[]; removed: string[] } {
  const want = countBy(requested);
  const got = countBy(w.components.map((x) => x.partId));
  const added: string[] = [];
  const removed: string[] = [];
  const what = (n: number, id: string) => (n > 1 ? `${n} × ${c.nameOf(id)}` : c.nameOf(id));
  for (const [id, n] of got) {
    const extra = n - (want.get(id) ?? 0);
    if (extra <= 0) continue;
    added.push(id);
    const why = reasonFor(log, id, "to");
    // A wiring helper carries its own reason sentence (ADDED_REASON).
    const own = w.components.find((x) => x.partId === id && x.auto)?.reason;
    const line = why
      ? `We added ${what(extra, id)} because ${why}.`
      : own
        ? `We added ${what(extra, id)}: ${own}`
        : `We added ${what(extra, id)} (required by our design rules).`;
    c.warnings.push(msg(line));
  }
  for (const [id, n] of want) {
    const gone = n - (got.get(id) ?? 0);
    if (gone <= 0) continue;
    removed.push(id);
    const why = reasonFor(log, id, "from");
    c.warnings.push(msg(why ? `We removed ${what(gone, id)} because ${why}.` : `We removed ${what(gone, id)} (our design rules do not allow it here).`));
  }
  return { added, removed };
}

/** The client's sketch with OUR pin block and our run guard, as the firmware route enforces them. */
function firmwareFor(build: BuildFile, w: WiringResult, spec: ProductSpec, c: Ctx): StudioDoc["firmware"] {
  if (!build.code) return undefined;
  const getPart = c.lib.getPart;
  const mcu = w.components.find((x) => getPart(x.partId)?.category === "mcu");
  if (!mcu) {
    c.problems.push("Our rules left no controller board, so the code cannot run. Add one controller board from get_design_rules.");
    return undefined;
  }
  if (mcu.partId !== build.code.board)
    c.warnings.push(msg(`The code was written for ${c.nameOf(build.code.board)} but our rules use ${c.nameOf(mcu.partId)}. We replaced the pin block; check the rest of the code for that board.`));
  const connections = buildConnections(w.components, w.netlist.nets, getPart, spec);
  const synced = syncPinBlock(build.code.source, connections, getPart).code;
  const code = ensureRunGuard(synced, w.legacy).code;
  // The board name the firmware route stores when the model gives none.
  const board = (findController(w.legacy)?.function ?? "").replace(/ microcontroller board$/, "") || c.nameOf(mcu.partId);
  return { board, code };
}

/**
 * The client's template, colour, finish and label, fitted by the website's own shape rules
 * (feet, vents, proportions) and clamped to what the renderer can build.
 */
function enclosureFor(build: BuildFile, w: WiringResult, spec: ProductSpec, c: Ctx): EnclosureSpec {
  let label = build.look.label;
  if (label && label.length > LIMITS.label.max) {
    const short = cutWords(label, LIMITS.label.max);
    c.warnings.push(msg(`The case label "${label}" is longer than ${LIMITS.label.max} characters; we print "${short}".`));
    label = short;
  }
  const base = { ...defaultEnclosureFor(spec), colour: build.look.colour, finish: build.look.finish };
  const fitted = adaptEnclosure(base, build.look.template, spec);
  const placed = w.components.flatMap((x) => {
    const part = c.lib.getPart(x.partId);
    return part ? [{ instanceId: x.instanceId, part }] : [];
  });
  // The footprint caps the corner radius exactly as the enclosure route's bbox does.
  const fp = placed.length ? layoutComponents(placed, { clearance: fitted.clearance, sizeHint: spec.sizeHint }).footprint : null;
  const log: ClampLog = [];
  const out = clampEnclosure({ ...fitted, ...(label ? { label } : {}) }, log, {
    templates: AI_TEMPLATES,
    ...(fp && fp.w > 0 && fp.d > 0 ? { footprint: { w: fp.w, d: fp.d } } : {}),
  });
  for (const e of log) c.warnings.push(msg(`Case ${e.path}: we used ${JSON.stringify(e.to)} instead of ${JSON.stringify(e.from)}.`));
  return out;
}

/** The client's own words for our engineer, in doc.answers (keys the idea chat never uses). */
function answersFor(build: BuildFile, now: Date): Record<string, string> {
  const s = build.summary;
  const answers: Record<string, string> = {};
  const put = (k: string, v: string) => {
    const t = v.trim();
    if (t) answers[k] = t.slice(0, ANSWER_MAX);
  };
  put("plugin_quotes", build.requirement_quotes.join("\n"));
  put("plugin_decisions", s.decisions.join("\n"));
  put("plugin_who_for", s.who_for);
  put("plugin_size_note", s.size_note);
  put("plugin_look_notes", build.look.notes);
  put("plugin_at", now.toISOString());
  return answers;
}

/** The doc as the Studio stores it, or the reasons it cannot be stored. */
export function finalizeDoc(doc: unknown): { doc: StudioDoc | null; problems: string[] } {
  const parsed = StudioDocSchema.safeParse(doc);
  if (!parsed.success) {
    return {
      doc: null,
      problems: parsed.error.issues.slice(0, 10).map((i) => msg(`Internal mapping error at ${i.path.join(".") || "(root)"}: ${i.message}`)),
    };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(parsed.data)).length;
  if (bytes > PLUGIN_DOC_MAX_BYTES)
    return { doc: null, problems: [msg(`The project is ${Math.ceil(bytes / 1024)} kB, over our ${PLUGIN_DOC_MAX_BYTES / 1024} kB limit. Shorten the code.`)] };
  return { doc: parsed.data as StudioDoc, problems: [] };
}

export function buildToStudio(
  build: BuildFile,
  lib: PluginLibrary,
  opts: { locale?: "en" | "ar"; now?: Date } = {},
): StudioMapResult {
  const locale = opts.locale ?? "en";
  const getPart = lib.getPart;
  const c: Ctx = { lib, problems: requestProblems(build, lib), warnings: [], nameOf: (id) => getPart(id)?.name.en ?? id };
  const none = () => ({ doc: null, problems: c.problems, warnings: c.warnings, added: [], removed: [] });
  if (c.problems.length) return none();

  const spec = deriveSpec(build, lib, c.warnings);
  // One slot per piece, as the website's picker answer would list them.
  const requested = build.parts.flatMap((p) => Array.from({ length: p.qty }, () => p.library_id));
  const log: ClampLog = [];
  const picked = enforcePick(
    { components: requested.map((partId) => ({ partId })) },
    {
      spec,
      index: pluginIndex(build, lib),
      locale,
      log,
      nameFor: (id, l) => getPart(id)?.name[l],
      pinsOf: (id) => getPart(id)?.pins,
      // Same stock preference as /api/studio/pick: a part with a linked store SKU is "ours".
      stockOf: (id) => (getPart(id)?.storeSkus.length ?? 0) > 0,
      // No lookup: the client's list is final, so a card item is never added behind its back.
    },
  );

  let w: WiringResult;
  try {
    w = buildWiring(picked.components, spec, getPart, locale);
  } catch (e) {
    c.problems.push(msg(`Our wiring rules could not wire these parts (${e instanceof Error ? e.message : "error"}). Try fewer or different parts.`));
    return none();
  }

  const { added, removed } = ruleChanges(requested, w, log, c);
  wiringFindings(w, c.problems, c.warnings);
  const firmware = firmwareFor(build, w, spec, c);
  const enclosure = enclosureFor(build, w, spec, c);

  const doc: StudioDoc = {
    version: 1,
    spec,
    components: w.components,
    netlist: w.netlist,
    checks: w.checks,
    enclosure,
    enclosureVersions: [enclosure],
    // The Enclosure, Print and Make steps lay the parts out themselves on load.
    layout: [],
    mech: [],
    ...(firmware ? { firmware } : {}),
    answers: answersFor(build, opts.now ?? new Date()),
    lastStep: "enclosure",
  };
  const final = finalizeDoc(doc);
  return { doc: final.doc, problems: [...c.problems, ...final.problems], warnings: c.warnings, added, removed };
}

/** For callers that keep a doc component list: the parts a client chose (not our helpers). */
export const chosenComponents = (doc: StudioDoc): StudioComponent[] => doc.components.filter((x) => !x.auto);
