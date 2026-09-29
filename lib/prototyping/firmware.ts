// Starter firmware for a project (owner, 2026-09-29: "at this stage you know
// the components and the board — why not write the code, especially for ESP
// or Arduino"). The model gets the circuit (who connects to which pin) and
// the brief, and writes one Arduino-IDE sketch. Pin numbers come from OUR
// netlist, never invented: the prompt lists them and the result must use them.

import type { Netlist } from "./netlist";

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
