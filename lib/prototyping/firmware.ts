// Starter firmware for a project (owner, 2026-09-29: "at this stage you know
// the components and the board — why not write the code, especially for ESP
// or Arduino"). The model gets the circuit (who connects to which pin) and
// the brief, and writes one Arduino-IDE sketch. Pin numbers come from OUR
// netlist, never invented: the prompt lists them and the result must use them.

import { isInductiveLoad, type Netlist } from "./netlist";

export type Firmware = {
  generatedAt: string;
  model: string | null;
  /** e.g. "ESP32 Dev Module" / "Arduino Uno" — what to pick in Arduino IDE. */
  board: string;
  fileName: string;
  code: string;
  libraries: { name: string; why: string }[];
  steps: string[];
  notes: string[];
};

const MCU = /\b(esp32|esp8266|esp-?32|arduino|atmega|nano|uno|mega|pico|rp2040|stm32|attiny|seeed|xiao|wemos|nodemcu)\b/i;

/** The microcontroller in the circuit, if any: the component the code runs on. */
export function findController(n: Netlist) {
  return (
    n.components.find((c) => MCU.test(c.function)) ??
    n.components.find((c) => /microcontroller|controller|mcu|dev(elopment)? ?board/i.test(c.function)) ??
    null
  );
}

/** The circuit as plain lines for the prompt: every controller pin and what it reaches. */
export function circuitForPrompt(n: Netlist): string {
  const mcu = findController(n);
  const lines: string[] = [];
  lines.push(`Components: ${n.components.map((c) => `${c.ref} = ${c.function}`).join("; ")}`);
  for (const net of n.nets) {
    const ends = net.connections.map((c) => {
      const comp = n.components.find((x) => x.ref === c.ref);
      const pin = comp?.pins.find((p) => p.id === c.pin);
      return `${c.ref}.${pin?.name ?? c.pin}`;
    });
    lines.push(`Net ${net.name}: ${ends.join(", ")}`);
  }
  if (mcu) {
    const byPin = mcu.pins.map((p) => {
      const net = n.nets.find((x) => x.connections.some((c) => c.ref === mcu.ref && c.pin === p.id));
      const others = net?.connections.filter((c) => c.ref !== mcu.ref).map((c) => c.ref) ?? [];
      return `${p.name} (${p.type})${net ? ` → net ${net.name}${others.length ? ` → ${others.join(", ")}` : ""}` : " → unused"}`;
    });
    lines.push(`Controller ${mcu.ref} (${mcu.function}) pins: ${byPin.join("; ")}`);
  }
  if (n.notes.length) lines.push(`Notes: ${n.notes.join(" ")}`);
  return lines.join("\n");
}

// ── Max-run guard (F-010) ───────────────────────────────────────────────────
// The generated sketch ran a pump 3 s every minute with nothing stopping it. A pump, heater,
// motor or solenoid that is left on empties a tank, burns itself out or floods a balcony, so
// the limit is not left to the model: we write the guard into the sketch after it answers and
// the prompt tells it to ask before every switch-on. The figures are OUR policy, not a
// measurement: one run at a time, and a total per hour, both small enough to be safe for any
// load in the library and easy for the builder to raise once they have watched it work.

/** The end marker of the pin block, kept here so this module needs no Studio import. */
const PIN_BLOCK_END_MARK = "// <<< PINS <<<";

export const RUN_GUARD_START = "// >>> SAFETY (from our rules) >>>";
export const RUN_GUARD_END = "// <<< SAFETY <<<";
/** Longest single run of a switched load, ms. */
export const LOAD_MAX_RUN_MS = 10_000;
/** Most running time in any one hour, ms. */
export const LOAD_MAX_ON_PER_HOUR_MS = 60_000;

/** Does this circuit switch something that must not be left running? */
export function needsRunGuard(n: Netlist): boolean {
  return n.components.some(isInductiveLoad);
}

/** The guard itself: two limits and the one function the sketch must call before switching on. */
export function runGuardBlock(): string {
  return [
    RUN_GUARD_START,
    "// A pump, heater or motor must never run away. Call loadMayRun(ms) before you switch it",
    "// on, and loadRan(ms) with how long it actually ran. Raise the limits once you have",
    "// watched your own build; never remove the check.",
    `const unsigned long LOAD_MAX_RUN_MS = ${LOAD_MAX_RUN_MS}UL;`,
    `const unsigned long LOAD_MAX_ON_PER_HOUR_MS = ${LOAD_MAX_ON_PER_HOUR_MS}UL;`,
    "unsigned long loadOnMsThisHour = 0;",
    "unsigned long loadHourStartedMs = 0;",
    "",
    "bool loadMayRun(unsigned long wantMs) {",
    "  unsigned long now = millis();",
    "  if (now - loadHourStartedMs >= 3600000UL) {",
    "    loadHourStartedMs = now;",
    "    loadOnMsThisHour = 0;",
    "  }",
    "  if (wantMs == 0 || wantMs > LOAD_MAX_RUN_MS) return false;",
    "  return loadOnMsThisHour + wantMs <= LOAD_MAX_ON_PER_HOUR_MS;",
    "}",
    "",
    "void loadRan(unsigned long ms) {",
    "  loadOnMsThisHour += ms;",
    "}",
    RUN_GUARD_END,
  ].join("\n");
}

export function hasRunGuard(code: string): boolean {
  const lines = code.split("\n").map((l) => l.trim());
  const s = lines.indexOf(RUN_GUARD_START);
  return s >= 0 && lines.indexOf(RUN_GUARD_END, s + 1) > s;
}

/** Puts the guard into the sketch (after the pin block when there is one). Idempotent. */
export function ensureRunGuard(code: string, n: Netlist): { code: string; added: boolean } {
  if (!needsRunGuard(n) || hasRunGuard(code)) return { code, added: false };
  const lines = code.split("\n");
  let at = 0;
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t === PIN_BLOCK_END_MARK || /^\s*#include\b/.test(l)) at = i + 1;
  });
  const next = [...lines.slice(0, at), ...(at > 0 ? [""] : []), ...runGuardBlock().split("\n"), "", ...lines.slice(at)];
  return { code: next.join("\n"), added: true };
}

// ── Features the parts cannot deliver (F-010) ───────────────────────────────
// The tester asked for a light that shows when the tank is empty; the kit held no level
// sensor, and the sketch said nothing at all. Silence is the bug: what we cannot build is
// stated in the sketch, in a comment, next to the code that would have done it.

export const MISSING_NOTE_START = "// >>> NOT IN THIS SKETCH >>>";
export const MISSING_NOTE_END = "// <<< NOT IN THIS SKETCH <<<";

/** The comment block naming each promise no part in the circuit can keep. */
export function missingFeatureBlock(items: readonly string[]): string {
  return [
    MISSING_NOTE_START,
    "// These were asked for, and no part in this circuit can do them. They need a part that is",
    "// not in the parts list — ask us to add it, then generate the code again.",
    ...items.map((x) => `//   - ${x}`),
    MISSING_NOTE_END,
  ].join("\n");
}

export function hasMissingNote(code: string): boolean {
  const lines = code.split("\n").map((l) => l.trim());
  const s = lines.indexOf(MISSING_NOTE_START);
  return s >= 0 && lines.indexOf(MISSING_NOTE_END, s + 1) > s;
}

/** Puts the note at the top of the sketch when something was promised we cannot build. */
export function ensureMissingNote(code: string, items: readonly string[]): { code: string; added: boolean } {
  if (!items.length || hasMissingNote(code)) return { code, added: false };
  return { code: `${missingFeatureBlock(items)}\n\n${code}`, added: true };
}

export const FIRMWARE_SCHEMA = {
  type: "OBJECT",
  properties: {
    board: { type: "STRING" },
    fileName: { type: "STRING" },
    code: { type: "STRING" },
    libraries: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { name: { type: "STRING" }, why: { type: "STRING" } }, required: ["name", "why"] },
    },
    steps: { type: "ARRAY", items: { type: "STRING" } },
    notes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["board", "fileName", "code", "libraries", "steps", "notes"],
};

/** Keep only well-formed fields; a sketch without code is a failure. */
export function cleanFirmware(raw: unknown, model: string | null): Firmware | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code.trim() : "";
  if (code.length < 40) return null;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 400)).slice(0, 12) : []);
  const fileName = (typeof r.fileName === "string" && /^[\w.-]+\.ino$/.test(r.fileName) ? r.fileName : "project.ino").slice(0, 60);
  return {
    generatedAt: new Date().toISOString(),
    model,
    board: typeof r.board === "string" ? r.board.slice(0, 80) : "",
    fileName,
    code: code.slice(0, 60_000),
    libraries: Array.isArray(r.libraries)
      ? (r.libraries as { name?: unknown; why?: unknown }[])
          .filter((l) => typeof l?.name === "string")
          .slice(0, 12)
          .map((l) => ({ name: String(l.name).slice(0, 80), why: String(l.why ?? "").slice(0, 200) }))
      : [],
    steps: strs(r.steps),
    notes: strs(r.notes),
  };
}
