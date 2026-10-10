// A tiny built-in single-stroke font for the raised label on the enclosure lid.
// No font files: a 16-segment display layout (like an alarm clock's letters),
// Latin only — A–Z, 0–9, space, "-", "." and "&". Lower case is printed as upper case.
//
// Every stroke becomes one rounded capsule (label.ts). Strokes that meet are
// shortened at the shared point so NO two capsules touch: the lid + label union in
// build.ts is then a single CSG step on disjoint closed solids (robust and fast).
// Pure + deterministic.

import { LIMITS } from "../schema";

/** Segment end points in the unit cell (x 0..1 left → right, y 0..1 bottom → top). */
const PT = {
  TL: [0, 1], TM: [0.5, 1], TR: [1, 1],
  ML: [0, 0.5], C: [0.5, 0.5], MR: [1, 0.5],
  BL: [0, 0], BM: [0.5, 0], BR: [1, 0],
} as const;
type PtName = keyof typeof PT;

/** The 16 segments (+ "dp", the full stop). */
const SEG: Record<string, [PtName, PtName]> = {
  a1: ["TL", "TM"], a2: ["TM", "TR"], b: ["TR", "MR"], c: ["MR", "BR"],
  d1: ["BL", "BM"], d2: ["BM", "BR"], e: ["ML", "BL"], f: ["TL", "ML"],
  g1: ["ML", "C"], g2: ["C", "MR"], h: ["TL", "C"], i: ["TM", "C"], j: ["TR", "C"],
  k: ["C", "BL"], l: ["C", "BM"], m: ["C", "BR"],
};

const O = "a1 a2 b c d1 d2 e f";
/** Glyph → segments. "." is a single dot; " " is empty. */
const GLYPHS: Record<string, string> = {
  "0": `${O} j k`,
  "1": "b c",
  "2": "a1 a2 b g1 g2 e d1 d2",
  "3": "a1 a2 b c d1 d2 g2",
  "4": "f g1 g2 b c",
  "5": "a1 a2 f g1 g2 c d1 d2",
  "6": "a1 a2 f e d1 d2 c g1 g2",
  "7": "a1 a2 b c",
  "8": `${O} g1 g2`,
  "9": "a1 a2 b c d1 d2 f g1 g2",
  A: "a1 a2 b c e f g1 g2",
  B: "a1 a2 b c d1 d2 g2 i l",
  C: "a1 a2 f e d1 d2",
  D: "a1 a2 b c d1 d2 i l",
  E: "a1 a2 f e d1 d2 g1",
  F: "a1 a2 f e g1",
  G: "a1 a2 f e d1 d2 c g2",
  H: "f e b c g1 g2",
  I: "a1 a2 i l d1 d2",
  J: "b c d1 d2 e",
  K: "f e g1 j m",
  L: "f e d1 d2",
  M: "f e b c h j",
  N: "f e b c h m",
  O,
  P: "a1 a2 b f e g1 g2",
  Q: `${O} m`,
  R: "a1 a2 b f e g1 g2 m",
  S: "a1 a2 f g1 g2 c d1 d2",
  T: "a1 a2 i l",
  U: "f e d1 d2 c b",
  V: "f e k j",
  W: "f e c b k m",
  X: "h j k m",
  Y: "h j l",
  Z: "a1 a2 j k d1 d2",
  "-": "g1 g2",
  "&": "a1 f i g1 e d1 l m",
  ".": "dp",
  " ": "",
};

export const LABEL_CHARS = Object.keys(GLYPHS);

/** Arabic (and Arabic presentation forms) — can't be raised yet. */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export type LabelSkipReason = "empty" | "length" | "script" | "chars";

/**
 * Can this text be raised on the lid? `script` = Arabic (not yet), `chars` = something
 * outside A–Z 0–9 space - . & , `length` = more than LIMITS.label.max characters.
 * The UI uses it to explain a skipped label before anything is built.
 */
export function labelSupport(text: string | null | undefined): { ok: boolean; reason?: LabelSkipReason; text: string } {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, reason: "empty", text: "" };
  if (ARABIC.test(t)) return { ok: false, reason: "script", text: t };
  if (t.length > LIMITS.label.max) return { ok: false, reason: "length", text: t };
  const up = t.toUpperCase();
  for (const ch of up) if (!(ch in GLYPHS)) return { ok: false, reason: "chars", text: t };
  return { ok: true, text: up };
}

// ---------------------------------------------------------------------------
// 2D layout (label space: x along the reading direction, y up, mm, origin = text centre)
// ---------------------------------------------------------------------------

/** One stroke: a capsule from a to b (radius r). a = b is a dot. */
export type Stroke = { a: [number, number]; b: [number, number] };

export type LabelLayout = {
  strokes: Stroke[];
  /** Stroke radius (mm). */
  r: number;
  /** Cap height (mm). */
  cap: number;
  /** Full size including the stroke radius (mm). */
  width: number;
  height: number;
};

/** Minimum air between two strokes' surfaces (mm). */
export const STROKE_GAP = 0.3;
/** Character cell width : cap height. */
const CELL = 0.6;

export function strokeRadius(cap: number): number {
  return Math.min(0.7, Math.max(0.4, cap * 0.09));
}

const sub = (a: readonly number[], b: readonly number[]): [number, number] => [a[0] - b[0], a[1] - b[1]];
const len = (v: readonly number[]) => Math.hypot(v[0], v[1]);

/** Distance between segments p1q1 and p2q2 (2D). */
export function segmentDistance(p1: readonly number[], q1: readonly number[], p2: readonly number[], q2: readonly number[]): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = d1[0] * d1[0] + d1[1] * d1[1];
  const e = d2[0] * d2[0] + d2[1] * d2[1];
  const f = d2[0] * r[0] + d2[1] * r[1];
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) return len(r);
  if (a <= 1e-12) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1];
    if (e <= 1e-12) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1];
      const den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
  const c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t];
  return Math.hypot(c1[0] - c2[0], c1[1] - c2[1]);
}

/** Strokes of one glyph in cell coordinates (mm, cell origin bottom-left), shortened so none touch. */
function glyphStrokes(ch: string, cap: number, r: number): Stroke[] {
  const names = (GLYPHS[ch] ?? "").split(" ").filter(Boolean);
  const cw = CELL * cap;
  const at = (p: PtName): [number, number] => [PT[p][0] * cw, PT[p][1] * cap];
  if (names.includes("dp")) return [{ a: [0, 0], b: [0, 0] }];
  const segs = names.map((n) => SEG[n]);
  const clear = r + STROKE_GAP / 2;
  // How far to pull a segment's end back from a shared end point.
  const pull = (self: number, p: PtName): number => {
    let minAngle = Math.PI;
    let shared = false;
    const [s0, s1] = segs[self];
    const other0 = s0 === p ? s1 : s0;
    const dir = sub(at(other0), at(p));
    segs.forEach(([q0, q1], k) => {
      if (k === self || (q0 !== p && q1 !== p)) return;
      shared = true;
      const o = q0 === p ? q1 : q0;
      const d2 = sub(at(o), at(p));
      const cos = (dir[0] * d2[0] + dir[1] * d2[1]) / (len(dir) * len(d2));
      minAngle = Math.min(minAngle, Math.acos(Math.max(-1, Math.min(1, cos))));
    });
    if (!shared) return 0;
    return clear / Math.sin(minAngle / 2);
  };
  const out: Stroke[] = [];
  segs.forEach(([p, q], k) => {
    const A = at(p);
    const B = at(q);
    const L = len(sub(B, A));
    const ta = pull(k, p);
    const tb = pull(k, q);
    if (ta + tb >= L) {
      const m = (ta / Math.max(1e-9, ta + tb)) * L;
      const u: [number, number] = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      const P: [number, number] = [A[0] + u[0] * m, A[1] + u[1] * m];
      out.push({ a: P, b: P });
    } else {
      const u: [number, number] = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      out.push({ a: [A[0] + u[0] * ta, A[1] + u[1] * ta], b: [B[0] - u[0] * tb, B[1] - u[1] * tb] });
    }
  });
  // Safety net: drop any stroke that would still touch a kept one.
  const kept: Stroke[] = [];
  for (const s of out) {
    if (kept.every((k) => segmentDistance(s.a, s.b, k.a, k.b) >= 2 * r + STROKE_GAP - 1e-6)) kept.push(s);
  }
  return kept;
}

/** Advance of one character (mm). */
function advance(ch: string, cap: number, r: number): number {
  const sp = Math.max(0.3 * cap, 2 * r + STROKE_GAP + 0.6);
  if (ch === ".") return sp;
  if (ch === " ") return CELL * cap * 0.8 + sp;
  return CELL * cap + sp;
}

/** Text width (mm, incl. stroke radius) for a supported, upper-cased label at this cap height. */
export function labelWidth(text: string, cap: number): number {
  const r = strokeRadius(cap);
  const chars = [...text];
  let x = 0;
  chars.forEach((ch, i) => {
    x += i === chars.length - 1 ? (ch === "." ? 0 : ch === " " ? 0 : CELL * cap) : advance(ch, cap, r);
  });
  return x + 2 * r;
}

/** Lay out a supported (upper-cased) label at cap height `cap`, centred on the origin. */
export function layoutLabel(text: string, cap: number): LabelLayout {
  const r = strokeRadius(cap);
  const chars = [...text];
  const strokes: Stroke[] = [];
  let x = 0;
  chars.forEach((ch, i) => {
    for (const s of glyphStrokes(ch, cap, r)) {
      strokes.push({ a: [s.a[0] + x, s.a[1]], b: [s.b[0] + x, s.b[1]] });
    }
    if (i < chars.length - 1) x += advance(ch, cap, r);
  });
  const width = labelWidth(text, cap);
  const height = cap + 2 * r;
  // Centre: content spans x ∈ [-r, width - r], y ∈ [-r, cap + r].
  const dx = -(width / 2 - r);
  const dy = -cap / 2;
  return {
    strokes: strokes.map((s) => ({ a: [s.a[0] + dx, s.a[1] + dy], b: [s.b[0] + dx, s.b[1] + dy] })),
    r,
    cap,
    width,
    height,
  };
}
