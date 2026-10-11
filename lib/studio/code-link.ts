// Code ↔ wiring link (P5-17): the pure helpers the Code step, the firmware
// route and the e2e mock share. The pin block itself (names, values, comments)
// comes from lib/studio/connections.ts; this module decides when the code needs
// a new block and which code lines belong to which wire.
//
// Pure and client-safe.

import {
  linesUsing,
  pinBlock,
  pinConstants,
  replacePinBlock,
  PIN_BLOCK_END,
  PIN_BLOCK_START,
  type Connection,
  type PinConstant,
} from "./connections";
import type { GetPart } from "./netlist";

export type PinSync = {
  code: string;
  changed: boolean;
  removed: string[];
  added: string[];
  constants: PinConstant[];
};

/** Does the code already carry a pin block (both markers, in order)? */
export function hasPinBlock(code: string): boolean {
  const lines = code.split("\n").map((l) => l.trim());
  const s = lines.indexOf(PIN_BLOCK_START);
  return s >= 0 && lines.indexOf(PIN_BLOCK_END, s + 1) > s;
}

/**
 * Brings the code's pin block in line with the wiring. Only the block changes;
 * the rest of the code is kept byte for byte. A circuit with no board signal
 * pins and code without a block is left alone (no empty block is added).
 */
export function syncPinBlock(code: string, connections: Connection[], getPart: GetPart): PinSync {
  const constants = pinConstants(connections, getPart);
  if (!constants.length && !hasPinBlock(code)) return { code, changed: false, removed: [], added: [], constants };
  const r = replacePinBlock(code, pinBlock(constants));
  return { ...r, constants };
}

export type LineLink = {
  /** The constant this line declares or uses (the first one when several). */
  name: string;
  /** The wire the line points to (the constant's first connection). */
  connectionId: string;
  /** True for the `const int NAME = …;` line inside the pin block. */
  declares: boolean;
};

/** 0-based line → the pin constant it uses, for every line that uses one. */
export function lineLinks(code: string, constants: PinConstant[]): Map<number, LineLink> {
  const out = new Map<number, LineLink>();
  const lines = code.split("\n");
  for (const c of constants) {
    const decl = new RegExp(`\\bconst\\s+int\\s+${c.name}\\b`);
    for (const i of linesUsing(code, c.name)) {
      if (out.has(i)) continue;
      out.set(i, { name: c.name, connectionId: c.connectionIds[0], declares: decl.test(lines[i] ?? "") });
    }
  }
  return out;
}

/** The constant that names a wire, if any (power / ground wires have none). */
export function constantFor(connectionId: string, constants: PinConstant[]): PinConstant | undefined {
  return constants.find((c) => c.connectionIds.includes(connectionId));
}

/** Lines to highlight for a wire: every line using its constant, the declaration first. */
export function focusLines(code: string, connectionId: string, constants: PinConstant[]): number[] {
  const c = constantFor(connectionId, constants);
  return c ? linesUsing(code, c.name) : [];
}

export type DiffLine = { kind: "removed" | "added"; text: string };

/** "Pins updated" diff for display: removed lines first, then added, comments trimmed off. */
export function pinDiffLines(removed: string[], added: string[]): DiffLine[] {
  const tidy = (l: string) => l.replace(/\s*\/\/.*$/, "").trim();
  const r = removed.map(tidy).filter(Boolean);
  const a = added.map(tidy).filter(Boolean);
  // Same declaration with only a new comment: not worth showing.
  const both = new Set(r.filter((x) => a.includes(x)));
  return [
    ...r.filter((x) => !both.has(x)).map((text) => ({ kind: "removed" as const, text })),
    ...a.filter((x) => !both.has(x)).map((text) => ({ kind: "added" as const, text })),
  ];
}
