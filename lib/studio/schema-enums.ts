// Studio enums, their derived types and the shared numeric ranges (LIMITS).
// Dependency-free leaf: the zod schemas, the clamp helpers and the AI
// responseSchema descriptions all read these. Import from "./schema".

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const USES = ["desk", "handheld", "wall", "wearable", "outdoor", "vehicle"] as const;
export const POWERS = ["usb", "battery", "battery_usb", "mains_adapter"] as const;
export const ENVIRONMENTS = ["indoor", "outdoor"] as const;
export const INPUTS = ["button", "touch", "knob", "none"] as const;
/** pump (W3): a small water pump, e.g. "automatic watering" (lib/studio/ai/spec-guards.ts keeps it). */
export const OUTPUTS = ["screen", "led", "buzzer", "speaker", "motor", "relay", "pump"] as const;
/**
 * Where the product physically lives when "use" alone would say the wrong thing (W3):
 * plant_soil = stands in the soil of a plant pot / bed; on_body / on_wrist = worn.
 * Optional: absent = the use (desk, wall, …) says it all.
 */
export const PLACEMENTS = ["plant_soil", "on_body", "on_wrist"] as const;
export const SIZE_HINTS = ["pocket", "palm", "desk", "large"] as const;
/** Part B: what moves the product (spec.actuators[].kind) and how hard it works (load). */
export const ACTUATOR_KINDS = ["servo", "motor", "pump", "stepper"] as const;
export const ACTUATOR_LOADS = ["light", "medium", "heavy"] as const;
export const STYLES = ["rounded", "soft_tech", "rugged", "minimal"] as const;
/** The understanding panel's movers (2026-10-18): linear_actuator has no spec.actuators kind (understanding only). */
export const MOVER_KINDS = ["servo", "linear_actuator", "motor", "pump", "stepper"] as const;

export const CATEGORIES = [
  "mcu", "power", "sensor", "display", "input", "output", "actuator", "connector", "logic",
] as const;

/**
 * What KIND of build this is (owner, 2026-10-20) — a second axis next to the
 * tier in lib/studio/tiers.ts. The tier says how BIG a build is (it sets the
 * price); the class says what SHAPE it is, and that is what decides whether a
 * microcontroller is forced, which part of the library applies, and which of
 * the three deliverable steps (wiring / print / code) leads.
 *
 *   mcu    the default: a board runs firmware. All three deliverables.
 *   logic  discrete logic ICs on a breadboard, no firmware at all (a De Morgan
 *          gate kit). Wiring leads; enclosure/print and code fade out.
 *   cad    the deliverable is mainly a printed part. Print leads; wiring and
 *          code fade out.
 */
export const BUILD_CLASSES = ["mcu", "logic", "cad"] as const;
export type BuildClass = (typeof BUILD_CLASSES)[number];
export const LOOKS = [
  "pcb_green", "pcb_black", "pcb_blue", "metal", "plastic_black", "plastic_white", "battery_wrap",
] as const;
export const PORT_KINDS = [
  "usb_c", "usb_micro", "usb_b", "dc_jack", "sensor_window", "display_window",
  "button_cap", "led_light_pipe", "speaker_grille",
] as const;
export const FACES = ["+x", "-x", "+y", "-y", "+z"] as const;
export const VENT_FACES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;
export const PIN_ROLES = [
  "vin", "3v3", "5v", "gnd", "gpio", "adc", "pwm", "i2c_sda", "i2c_scl",
  "spi_mosi", "spi_miso", "spi_sck", "spi_cs", "uart_tx", "uart_rx", "out", "in",
] as const;
export const PIN_SIDES = ["left", "right", "top", "bottom"] as const;

/** All enclosure templates (lantern / dome_base / wall_plate since Phase 3, stake_pod since W6). */
export const ENCLOSURE_TEMPLATES = [
  "rounded_box", "pill", "soft_wedge", "puck", "handheld_taper",
  "lantern", "dome_base", "wall_plate", "stake_pod",
] as const;
export const HEIGHT_BIASES = ["low", "mid", "tall"] as const;
export const LIDS = ["snap", "screw_4", "slide", "twist"] as const;
/** grille = concentric arcs (speakers); louvres = angled slats on a SIDE face. */
export const VENT_PATTERNS = ["none", "slots", "holes", "hex", "grille", "louvres"] as const;
/** Faces where louvres make sense (side walls). */
export const SIDE_VENT_FACES = ["+x", "-x", "+y", "-y"] as const;
export const FEET = ["none", "rubber_4", "ring"] as const;
export const FINISHES = [
  "matte_plastic", "glossy_plastic", "soft_touch", "anodized_aluminium", "wood_look",
] as const;

/** Enclosure colour palette (names only; hex lives in lib/studio/palette.ts). */
export const COLOURS = [
  "chalk", "graphite", "sand", "sage", "coral", "ocean", "sun", "cobalt", "mist", "clay",
] as const;

export const MECH_TEMPLATES = [
  "standoff", "pcb_cradle", "battery_clip", "sensor_mount", "cable_clip",
  "button_extender", "light_pipe", "wall_bracket", "lid", "base",
] as const;
export const MATERIALS = ["PLA", "PETG", "TPU"] as const;

export type Use = (typeof USES)[number];
export type Power = (typeof POWERS)[number];
export type Environment = (typeof ENVIRONMENTS)[number];
export type Input = (typeof INPUTS)[number];
export type Output = (typeof OUTPUTS)[number];
export type SizeHint = (typeof SIZE_HINTS)[number];
export type Style = (typeof STYLES)[number];
export type Placement = (typeof PLACEMENTS)[number];
export type ActuatorKind = (typeof ACTUATOR_KINDS)[number];
export type MoverKind = (typeof MOVER_KINDS)[number];
export type Category = (typeof CATEGORIES)[number];
export type Look = (typeof LOOKS)[number];
export type PortKind = (typeof PORT_KINDS)[number];
export type Face = (typeof FACES)[number];
export type VentFace = (typeof VENT_FACES)[number];
export type PinRole = (typeof PIN_ROLES)[number];
export type EnclosureTemplate = (typeof ENCLOSURE_TEMPLATES)[number];
export type Finish = (typeof FINISHES)[number];
export type Colour = (typeof COLOURS)[number];
export type MechTemplate = (typeof MECH_TEMPLATES)[number];

// ---------------------------------------------------------------------------
// Ranges (shared by schema + clamp + the AI responseSchema descriptions)
// ---------------------------------------------------------------------------

export const LIMITS = {
  name: { min: 3, max: 40 },
  oneLine: { max: 120 },
  /** Part A: "a real UR10 is 1.3 m — this is the desktop version", under the card name. */
  scaleNote: { max: 140 },
  features: { max: 8, itemMax: 60 },
  /** Part B: at most 4 actuator groups, each 1..8 of the same kind ("servo × 6"). */
  actuators: { max: 4, countMin: 1, countMax: 8, roleMax: 40 },
  /** "Our understanding" panel (2026-10-18): goal, how it works, the parts it needs. */
  understanding: { goal: 220, how: 600, name: 50, purpose: 100, items: 6, countMax: 8 },
  widthToDepth: { min: 0.5, max: 2.5 },
  cornerRadius: { min: 3, max: 20 },
  edgeFillet: { min: 1, max: 6 },
  wall: { min: 1.6, max: 4 },
  clearance: { min: 1, max: 4 },
  ventCount: { min: 0, max: 24 },
  label: { max: 16 },
  /** Footprint never thinner than this (design rule). */
  minFootprint: 15,
  /** Height never > this × the smaller footprint side (except lantern). */
  maxHeightRatio: 2,
  /** Lid lip (mm) between base and lid. */
  lidLip: 0.4,
} as const;
