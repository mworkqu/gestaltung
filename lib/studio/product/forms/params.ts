// The form-part kit (P5-16): every shape a product body can take, with its
// parameters as [min, max, default] in mm. Pure data, no three.js, no zod —
// schema.ts builds the zod schemas and the TS types from this one table, the
// clamp (forms/clamp.ts) reads the same ranges, and the kernel
// (lib/studio/geometry/product-kernel.ts) reads the clamped values. So a range
// lives in exactly one place.
//
// Local frame of every form (the solver and the kernel agree on it):
//   x, y centred on the form's bounding box, z from 0 (bottom) up, mm, Z up,
//   −y = the form's FRONT. A stake's tip is at z = 0 (it points down); a
//   nozzle's base is on its +y side and it reaches towards −y.
//
// The ranges keep every part printable: walls/sections ≥ 1.6 mm, features
// ≥ 1.2 mm, fillets ≥ 1 mm, nothing larger than a Prusa MK4 bed allows.

import { ENCLOSURE_TEMPLATES } from "../../schema";

export const FORM_KINDS = [
  "lathe_profile",
  "rounded_extrude",
  "loft_rounded",
  "stake",
  "prongs",
  "tube_sweep",
  "nozzle",
  "ring",
  "tank",
  "button_cap",
  "knob",
  "grille_disc",
  "foot",
  "clip_arm",
  "hook",
  "hinge_lid",
  /** The 8 Studio enclosure templates + stake_pod, wrapped as one form (param `template`). */
  "enclosure",
] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export type NumParam = { t: "num"; min: number; max: number; def: number; int?: boolean };
export type EnumParam<V extends string = string> = { t: "enum"; values: readonly V[]; def: V };
/** A lathe profile: 3–8 [r, z] control points, bottom → top (z never goes down). */
export type ProfileParam = {
  t: "profile";
  minPoints: number;
  maxPoints: number;
  rMax: number;
  zMax: number;
  def: readonly (readonly [number, number])[];
};
export type ParamDef = NumParam | EnumParam | ProfileParam;

const num = (min: number, max: number, def: number, int = false): NumParam => ({ t: "num", min, max, def, ...(int ? { int } : {}) });
const en = <V extends string>(values: readonly V[], def: V): EnumParam<V> => ({ t: "enum", values, def });

export const PROFILE_LIMITS = { minPoints: 3, maxPoints: 8, rMax: 120, zMax: 220 } as const;

/** Lathed parts are never coarser than this (owner rule: ≥ 64 radial segments). */
export const MIN_LATHE_SEGMENTS = 64;

export const FORM_PARAMS = {
  /** Revolved profile with rounded corners (bottles, domes, caps, pods, lamp heads). */
  lathe_profile: {
    points: {
      t: "profile",
      ...PROFILE_LIMITS,
      def: [[30, 0], [38, 10], [40, 26], [36, 36], [0, 40]],
    } as ProfileParam,
    /** Corner radius applied at every profile point (mm). */
    round: num(1, 12, 3),
    segments: num(MIN_LATHE_SEGMENTS, 128, 72, true),
  },
  /** Rounded rectangle or superellipse, extruded with a soft top and a 45° bottom chamfer. */
  rounded_extrude: {
    shape: en(["rrect", "superellipse"] as const, "rrect"),
    w: num(8, 240, 80),
    d: num(8, 200, 60),
    h: num(2, 200, 30),
    /** Corner radius in plan (rrect). */
    r: num(1, 100, 10),
    /** Superellipse exponent (2 = ellipse, 8 ≈ squircle). */
    n: num(2, 8, 4),
    /** Top edge fillet (mm). */
    fillet: num(1, 12, 3),
  },
  /** Loft between a bottom and a top rounded rectangle / ellipse (tapers, handhelds, wedges). */
  loft_rounded: {
    shape: en(["rrect", "ellipse"] as const, "rrect"),
    w0: num(8, 240, 60),
    d0: num(8, 200, 160),
    w1: num(4, 240, 50),
    d1: num(4, 200, 150),
    h: num(4, 200, 22),
    r: num(1, 100, 12),
    fillet: num(1, 10, 4),
    /** Top outline shifted along y (mm): a wedge leans back with a positive value. */
    shiftY: num(-60, 60, 0),
  },
  /** Tapered soil spike. Its tip is at z = 0; `length` is the whole spike. */
  stake: {
    section: en(["cross", "round", "blade"] as const, "cross"),
    length: num(60, 200, 120),
    /** Section width at the top (mm). */
    width: num(8, 40, 16),
    /** Blade / cross bar thickness (mm). */
    thick: num(2.6, 16, 3),
    /** Tip size as a share of the top (0.15 = sharp, 1 = straight). */
    taper: num(0.15, 1, 0.3),
  },
  /** Two metal probe pins (bought, not printed). */
  prongs: {
    length: num(10, 80, 24),
    d: num(2, 6, 3),
    spacing: num(6, 30, 12),
  },
  /** A smooth bent tube (a body; Links build their own tube from their path). */
  tube_sweep: {
    d: num(4, 8, 6),
    length: num(20, 400, 100),
    /** Total bend (degrees) over the length. */
    bend: num(0, 180, 90),
  },
  /** Drip outlet: a straight run from the base, then an angled tip. */
  nozzle: {
    length: num(8, 60, 20),
    d: num(5, 14, 8),
    bore: num(1.5, 5, 2.5),
    /** Tip angle below horizontal (0 = straight out, 90 = straight down). */
    angle: num(0, 90, 50),
    /** Length of the angled tip (mm, 0 = none). */
    drop: num(0, 40, 12),
  },
  /** Band / halo / bezel: an outline with a hole through it. w, d = INNER size. */
  ring: {
    shape: en(["round", "rrect"] as const, "round"),
    w: num(10, 240, 60),
    d: num(10, 200, 60),
    /** Band thickness (outer − inner, per side). */
    t: num(1.6, 12, 3),
    h: num(2, 160, 6),
    r: num(1, 100, 8),
  },
  /** Reservoir: a hollow tank whose top `lidH` mm print as the fill lid. */
  tank: {
    shape: en(["round", "rrect"] as const, "round"),
    w: num(30, 200, 70),
    d: num(30, 200, 70),
    h: num(30, 200, 90),
    r: num(2, 100, 12),
    lidH: num(4, 30, 8),
    /** 1 = a water-level window strip on the front. */
    window: num(0, 1, 1, true),
  },
  button_cap: {
    d: num(6, 40, 14),
    /** Height above the surface it sits on. */
    h: num(2, 15, 4),
    /** Dome share of the height (0 = flat top). */
    dome: num(0, 1, 0.5),
    /** Stem down to the switch (mm, set by the solver). */
    stem: num(0, 30, 0),
    /** Extra height of the cap over the point it touches (a cap on a dome sits on the dome's highest point under it). */
    seat: num(0, 10, 0),
  },
  knob: {
    d: num(10, 60, 28),
    h: num(6, 40, 16),
    flutes: num(0, 36, 18, true),
  },
  grille_disc: {
    d: num(10, 120, 40),
    t: num(1.6, 6, 2.4),
    hole: num(1.2, 4, 2),
    pitch: num(2.5, 8, 4),
  },
  foot: {
    d: num(6, 40, 12),
    h: num(2, 20, 4),
  },
  /** U-shaped spring clip (vent clips, belt clips). */
  clip_arm: {
    w: num(6, 60, 20),
    length: num(15, 120, 50),
    t: num(1.6, 6, 2.4),
    gap: num(2, 40, 10),
  },
  hook: {
    w: num(6, 60, 15),
    reach: num(8, 60, 20),
    t: num(2, 8, 4),
    h: num(10, 80, 30),
  },
  /** Flat rounded lid plate with two hinge knuckles on its back edge. */
  hinge_lid: {
    w: num(20, 240, 80),
    d: num(20, 200, 60),
    t: num(1.6, 8, 3),
    r: num(1, 40, 8),
  },
  /** One of the Studio enclosure templates as a body (outer shape only; the solver hollows it). */
  enclosure: {
    template: en(ENCLOSURE_TEMPLATES, "rounded_box"),
    w: num(15, 240, 80),
    d: num(15, 200, 56),
    h: num(10, 200, 32),
    r: num(3, 20, 8),
    fillet: num(1, 6, 2),
  },
} as const satisfies Record<FormKind, Record<string, ParamDef>>;

export type FormParamTable = typeof FORM_PARAMS;

/** The TS value type of one parameter definition. */
type ValueOf<D> = D extends NumParam ? number : D extends EnumParam<infer V> ? V : D extends ProfileParam ? [number, number][] : never;

/** One form part: `{ kind, ...params }` for that kind. */
export type FormPartOf<K extends FormKind> = { kind: K } & { -readonly [P in keyof FormParamTable[K]]: ValueOf<FormParamTable[K][P]> };
export type FormPart = { [K in FormKind]: FormPartOf<K> }[FormKind];

/** A form with all its default parameters. */
export function defaultForm<K extends FormKind>(kind: K): FormPartOf<K> {
  const defs = FORM_PARAMS[kind] as Record<string, ParamDef>;
  const out: Record<string, unknown> = { kind };
  for (const [k, d] of Object.entries(defs)) {
    out[k] = d.t === "profile" ? d.def.map(([r, z]) => [r, z]) : d.def;
  }
  return out as FormPartOf<K>;
}

/** Forms that can be hollowed into a shell (a cavity that holds electronics or water). */
export const HOLLOW_FORMS: readonly FormKind[] = ["lathe_profile", "rounded_extrude", "loft_rounded", "tank", "enclosure"];

/** Enclosure templates that are round in plan (the solver fits electronics in a circle). */
export const ROUND_TEMPLATES = ["puck", "dome_base", "lantern", "stake_pod"] as const;
