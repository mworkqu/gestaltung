// The 12 archetypes (P5-16): each a good-looking, printable DEFAULT ProductModel
// built from the spec (size hint, style, placement) and the chosen parts (pump,
// soil probe, LEDs, button, speaker…). The AI (Phase 2a) starts from one of these
// and changes it — never from nothing — and when the AI fails, this IS the model.
//
// archetypeFor(spec) reuses the W6 shape signals (enclosure/shape-pick.ts) plus a
// few product words (pet, doorbell, remote, robot, car…). rankArchetypes() gives
// every archetype a score + reason, best first ("Try another" takes the next ones).

import type { Colour, LibraryPart, ProductSpec } from "../schema";
import type { LayoutInput } from "../layout";
import { shapeSignals } from "../enclosure/shape-pick";
import { ARCHETYPES, ARCHETYPE_SCENE, clampProductModel, type Archetype, type ProductModel } from "./schema";
import { POT } from "./scene";
import { isButtonPart, isLight, isPump, isSoilProbe } from "./parts";

// ---------------------------------------------------------------------------
// Signals from the spec + parts
// ---------------------------------------------------------------------------

export type ProductNeeds = {
  pump: boolean;
  soil: boolean;
  light: boolean;
  button: boolean;
  /** How many push buttons the parts list has (each gets its own cap). */
  buttons: number;
  speaker: boolean;
  screen: boolean;
  touch: boolean;
  /** Plan scale from the size hint (palm = 1). */
  scale: number;
  main: Colour;
  accent: Colour;
};

const SIZE_SCALE: Record<ProductSpec["sizeHint"], number> = { pocket: 0.8, palm: 1, desk: 1.3, large: 1.6 };

export function needsOf(spec: ProductSpec, parts: readonly LayoutInput[] = []): ProductNeeds {
  const ps: LibraryPart[] = parts.map((p) => p.part);
  const out = spec.outputs ?? [];
  const ins = spec.inputs ?? [];
  const s = shapeSignals(spec);
  let main: Colour = "chalk";
  let accent: Colour = "sage";
  // Plant products: warm white with a water-blue accent, so the product never melts into the leaves.
  if (s.plant) [main, accent] = ["chalk", "ocean"];
  else if (s.outdoor || spec.style === "rugged") [main, accent] = ["graphite", "sun"];
  else if (spec.style === "soft_tech") [main, accent] = ["mist", "cobalt"];
  else if (spec.style === "minimal") [main, accent] = ["chalk", "graphite"];
  else [main, accent] = ["chalk", "coral"];
  return {
    pump: out.includes("pump") || ps.some(isPump),
    soil: ps.some(isSoilProbe),
    light: out.includes("led") || ps.some(isLight),
    button: ins.includes("button") || ps.some(isButtonPart),
    buttons: ps.filter(isButtonPart).length,
    speaker: out.includes("speaker") || out.includes("buzzer") || ps.some((p) => p.ports.some((q) => q.kind === "speaker_grille")),
    screen: out.includes("screen"),
    touch: ins.includes("touch"),
    scale: SIZE_SCALE[spec.sizeHint] ?? 1,
    main,
    accent,
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type ArchetypeReason =
  | "plant_soil" | "plant_pot" | "pet" | "dispense" | "robot" | "vehicle" | "door" | "remote"
  | "wearable" | "wall" | "lamp" | "outdoor" | "desk" | "fallback";

export type RankedArchetype = { archetype: Archetype; score: number; reason: ArchetypeReason };

const PET = /\b(cats?|kitt(?:y|en)s?|dogs?|pupp(?:y|ies)|pets?|feeders?|kibble|bowl)\b|(قطة|قطط|كلب|حيوان|أليف|إطعام)/;
const DISPENSE = /\b(dispens\w*|soap|sanitizer|sanitiser|treats?|candy|pills?)\b|(موزع|صابون|معقم)/;
const ROBOT = /\b(robots?|bots?|companion|buddy)\b|(روبوت)/;
const VEHICLE = /\b(cars?|dash(?:board)?|vehicles?|bikes?|bicycles?|scooters?)\b|(سيارة|دراجة)/;
const DOOR = /\b(doors?|doorbells?|intercom|entrance)\b|(باب|جرس)/;
const REMOTE = /\b(remotes?|remote control|controllers?|wand|clicker)\b|(ريموت|جهاز تحكم)/;
const PLANTER = /\b(planters?|pot insert|pebble)\b/;

function textOf(spec: ProductSpec): string {
  return [spec.name, spec.oneLine, ...(spec.features ?? [])].filter((x): x is string => typeof x === "string").join(" ").toLowerCase();
}

/** Every archetype scored for this spec, best first (ties keep ARCHETYPES order). */
export function rankArchetypes(spec: ProductSpec): RankedArchetype[] {
  const s = shapeSignals(spec);
  const text = textOf(spec);
  const scored = new Map<Archetype, RankedArchetype>(ARCHETYPES.map((a) => [a, { archetype: a, score: 0, reason: "fallback" as ArchetypeReason }]));
  const add = (a: Archetype, score: number, reason: ArchetypeReason) => {
    const cur = scored.get(a)!;
    if (score > cur.score) scored.set(a, { archetype: a, score, reason });
  };
  const carried = s.handheld || s.wearable;
  if (spec.placement === "plant_soil") add("stake_device", 100, "plant_soil");
  if (s.plant) {
    add("stake_device", s.wall ? 50 : 95, "plant_soil");
    add("planter_insert", PLANTER.test(text) ? 97 : 70, "plant_pot");
  }
  if (PET.test(text)) add("pet_feeder", 92, "pet");
  if (DISPENSE.test(text)) add("dispenser", 85, "dispense");
  if (ROBOT.test(text)) add("tabletop_robot", 86, "robot");
  if (spec.use === "vehicle" || VEHICLE.test(text)) add("vehicle_mount", 90, "vehicle");
  if (DOOR.test(text)) add("wall_mount", 91, "door");
  if (REMOTE.test(text)) add("handheld", 93, "remote");
  if (s.wearable || spec.placement === "on_wrist" || spec.placement === "on_body") add("wearable_band", 90, "wearable");
  if (s.handheld) add("handheld", 88, "remote");
  if (s.wall) add("wall_mount", 89, "wall");
  if (s.lampish && !carried && !s.plant) add("lamp", 82, "lamp");
  if (s.outdoor && !s.plant) add("outdoor_box", 72, "outdoor");
  add("desk_object", s.desk ? 40 : 20, s.desk ? "desk" : "fallback");
  // Second choices that look different ("Try another").
  if (s.plant) add("desk_object", 45, "plant_pot");
  if (s.lampish) add("desk_object", 50, "lamp");
  if (s.handheld) add("wearable_band", 30, "remote");
  const order = new Map(ARCHETYPES.map((a, i) => [a, i]));
  return [...scored.values()].sort((a, b) => b.score - a.score || order.get(a.archetype)! - order.get(b.archetype)!);
}

export function archetypeFor(spec: ProductSpec): Archetype {
  return rankArchetypes(spec)[0].archetype;
}

/** Message key for "Why this design" of an archetype default (Studio.product.why_<archetype>, Phase 2b). */
export const archetypeWhyKey = (a: Archetype) => `why_${a}`;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const k = (n: number, s: number) => Math.round(n * s * 10) / 10;
const pts = (list: [number, number][], s: number, sz = s): [number, number][] => list.map(([r, z]) => [k(r, s), k(z, sz)]);

function body(id: string, role: string, form: Raw, attach: Raw, material: string, colour: Colour, finish: string, extra: Raw = {}): Raw {
  return { id, role, form, attach: { offset: [0, 0, 0], ...attach }, material, colour, finish, ...extra };
}

const RATIONALE: Record<Archetype, string> = {
  stake_device: "Stands in the soil on its stake, with a palm-sized head, a glowing status ring and a drip outlet aimed at the roots.",
  planter_insert: "A low pebble that sits on the soil with its probe tips in the ground, so it hides among the leaves.",
  desk_object: "A soft, low block that sits steady on a desk, with everything you touch on its top.",
  lamp: "A weighted base with a touch pad to dim it, a slim stem and a frosted head that glows.",
  wall_mount: "A slim plate on the wall with one big button and a light you can see from the door.",
  handheld: "A long, rounded body that sits in the hand, a column of keys under the thumb, a red power key and the signal window at the front.",
  wearable_band: "A small rounded pod on a soft strap, light enough to wear all day.",
  pet_feeder: "A clear food hopper on a sturdy base, so you see what is left, with a chute that drops each meal into the bowl.",
  dispenser: "A tall body with the tank on top and the outlet at the front, at hand height.",
  vehicle_mount: "A compact face that clips into a car vent, angled towards the driver.",
  outdoor_box: "A sealed, screwed box with drain holes and a mounting flange, made for sun and rain.",
  tabletop_robot: "A friendly little body with a round head and a glowing visor, sized for a desk.",
};

function stakeDevice(n: ProductNeeds): Raw {
  const s = n.scale;
  const stakeLen = n.soil ? 118 : 110;
  const bodies: Raw[] = [
    body("stake", "stake", n.soil
      ? { kind: "stake", section: "blade", length: stakeLen, width: 28, thick: 12, taper: 0.35 }
      : { kind: "stake", section: "cross", length: stakeLen, width: 18, thick: 3.2, taper: 0.3 },
      { to: "ground", anchor: "top", offset: [0, 0, -(stakeLen - 28)] }, "PETG", "graphite", "matte_plastic"),
    body("head", "housing", { kind: "lathe_profile", points: pts([[34, 0], [39, 9], [41, 18], [41, 30]], s), round: 4, segments: 96 },
      { to: "stake", anchor: "top" }, "PLA", n.main, "soft_touch"),
  ];
  let top = "head";
  if (n.light) {
    // Signature detail: a tall glowing status band between the head and its cap.
    bodies.push(body("halo", "light_ring", { kind: "ring", shape: "round", w: k(76, s), d: k(76, s), t: 3, h: 10 }, { to: "head", anchor: "top" }, "resin_clear", "mist", "glossy_plastic"));
    top = "halo";
  }
  bodies.push(body("cap", "lid", { kind: "lathe_profile", points: pts([[41, 0], [40, 5], [33, 15], [19, 23], [5, 26]], s), round: 4, segments: 96 }, { to: top, anchor: "top" }, "PLA", n.main, "soft_touch"));
  if (n.soil) bodies.push(body("probe_tips", "stake", { kind: "prongs", length: 18, d: 3, spacing: 12 }, { to: "stake", anchor: "bottom" }, "aluminium", "graphite", "anodized_aluminium"));
  const links: Raw[] = [];
  if (n.pump) {
    bodies.push(body("nozzle", "nozzle", { kind: "nozzle", length: 16, d: 8, bore: 2.5, angle: 55, drop: 14 }, { to: "head", anchor: "front" }, "PLA", n.accent, "matte_plastic"));
    bodies.push(body("reservoir", "reservoir", { kind: "tank", shape: "round", w: 72, d: 72, h: 92, r: 12, lidH: 8, window: 1 },
      { to: "scene", anchor: "bottom", offset: [POT.radius + 14 + 36, 0, 0] }, "resin_clear", "mist", "glossy_plastic"));
    links.push({ kind: "tube", from: { body: "reservoir", anchor: "top" }, to: { body: "head", anchor: "back" }, diameter: 6, colour: "mist" });
  }
  return { archetype: "stake_device", scene: "plant_pot", rationale: RATIONALE.stake_device, bodies, electronicsHost: "head", links };
}

function planterInsert(n: ProductNeeds): Raw {
  const s = n.scale;
  const bodies: Raw[] = [];
  let hostAttach: Raw = { to: "ground", anchor: "top" };
  if (n.soil) {
    bodies.push(body("stake", "stake", { kind: "stake", section: "blade", length: 112, width: 28, thick: 12, taper: 0.35 }, { to: "ground", anchor: "top", offset: [0, 0, -112] }, "PETG", n.main, "matte_plastic"));
    hostAttach = { to: "stake", anchor: "top" };
  }
  bodies.push(body("pebble", "housing", { kind: "lathe_profile", points: pts([[32, 0], [37, 5], [38, 12], [36, 20]], s), round: 4, segments: 96 }, hostAttach, "PLA", n.main, "soft_touch"));
  let top = "pebble";
  if (n.light) {
    bodies.push(body("halo", "light_ring", { kind: "ring", shape: "round", w: k(66, s), d: k(66, s), t: 3, h: 5 }, { to: "pebble", anchor: "top" }, "resin_clear", "mist", "glossy_plastic"));
    top = "halo";
  }
  bodies.push(body("cap", "lid", { kind: "lathe_profile", points: pts([[36, 0], [34, 4], [27, 11], [13, 16], [4, 17]], s), round: 4, segments: 96 }, { to: top, anchor: "top" }, "PLA", n.accent, "soft_touch"));
  if (n.soil) bodies.push(body("probe_tips", "stake", { kind: "prongs", length: 16, d: 3, spacing: 12 }, { to: "stake", anchor: "bottom" }, "aluminium", "graphite", "anodized_aluminium"));
  const links: Raw[] = [];
  if (n.pump) {
    bodies.push(body("nozzle", "nozzle", { kind: "nozzle", length: 14, d: 8, bore: 2.5, angle: 60, drop: 10 }, { to: "pebble", anchor: "front" }, "PLA", n.accent, "matte_plastic"));
    bodies.push(body("reservoir", "reservoir", { kind: "tank", shape: "round", w: 72, d: 72, h: 92, r: 12, lidH: 8, window: 1 }, { to: "scene", anchor: "bottom", offset: [POT.radius + 14 + 36, 0, 0] }, "resin_clear", "mist", "glossy_plastic"));
    links.push({ kind: "tube", from: { body: "reservoir", anchor: "top" }, to: { body: "pebble", anchor: "back" }, diameter: 6, colour: "mist" });
  }
  return { archetype: "planter_insert", scene: "plant_pot", rationale: RATIONALE.planter_insert, bodies, electronicsHost: "pebble", links };
}

function deskObject(n: ProductNeeds): Raw {
  const s = n.scale;
  const W = k(96, s), D = k(72, s);
  const bodies: Raw[] = [
    body("base", "base", { kind: "rounded_extrude", shape: "rrect", w: W, d: D, h: 6, r: 18, fillet: 2 }, { to: "ground", anchor: "top" }, "PLA", n.accent, "matte_plastic"),
    body("body", "housing", { kind: "rounded_extrude", shape: "rrect", w: W, d: D, h: k(30, s), r: 18, fillet: 2 }, { to: "base", anchor: "top" }, "PLA", n.main, "soft_touch",
      n.speaker ? { features: [{ kind: "grille", face: "front", count: 24 }] } : {}),
  ];
  let top = "body";
  if (n.light) {
    bodies.push(body("glow", "light_ring", { kind: "ring", shape: "rrect", w: W - 6, d: D - 6, t: 3, h: 5, r: 15 }, { to: "body", anchor: "top" }, "resin_clear", "mist", "glossy_plastic"));
    top = "glow";
  }
  bodies.push(body("top", "lid", { kind: "rounded_extrude", shape: "rrect", w: W, d: D, h: 10, r: 18, fillet: 5 }, { to: top, anchor: "top" }, "PLA", n.main, "soft_touch"));
  return { archetype: "desk_object", scene: "desk", rationale: RATIONALE.desk_object, bodies, electronicsHost: "body", links: [] };
}

function lamp(n: ProductNeeds): Raw {
  // A real lamp silhouette: a weighted disc base with a touch pad, a slim stem, and a
  // head whose frosted dome is the light (the LED ring shines up into it).
  const s = Math.min(n.scale, 1.15);
  const dark: Colour = n.main === "graphite" ? "chalk" : "graphite";
  const bodies: Raw[] = [
    body("base", "base", { kind: "lathe_profile", points: pts([[58, 0], [60, 4], [60, 12], [48, 19], [40, 20]], s), round: 3, segments: 96 }, { to: "ground", anchor: "top" }, "PLA", n.main, "matte_plastic"),
    // The touch pad is a printed disc over a copper electrode (no switch under it), so it is a cover, not a key cap.
    body("touch_pad", "cover", { kind: "button_cap", d: 24, h: 2, dome: 0.2, stem: 0 }, { to: "base", anchor: "top", offset: [0, k(-27, s), 0] }, "PLA", n.accent === dark ? "coral" : n.accent, "soft_touch"),
    body("stem", "handle", { kind: "lathe_profile", points: [[8, 0], [6.5, 6], [6, 150], [7, 158]], round: 2, segments: 64 }, { to: "base", anchor: "top" }, "PLA", dark, "matte_plastic"),
    body("head", "housing", { kind: "lathe_profile", points: pts([[22, 0], [30, 4], [37, 10], [38, 16]], s), round: 3, segments: 96 }, { to: "stem", anchor: "top" }, "PLA", n.main, "soft_touch"),
    body("shade", "light_ring", { kind: "lathe_profile", points: pts([[38, 0], [39, 6], [35, 22], [24, 33], [8, 38]], s), round: 4, segments: 96 }, { to: "head", anchor: "top" }, "resin_clear", "mist", "glossy_plastic", { shell: "open_bottom" }),
  ];
  return { archetype: "lamp", scene: "desk", rationale: RATIONALE.lamp, bodies, electronicsHost: "head", links: [] };
}

function wallMount(n: ProductNeeds): Raw {
  const s = n.scale;
  const up: [number, number, number] = [90, 0, 0];
  const bodies: Raw[] = [
    body("plate", "bracket", { kind: "rounded_extrude", shape: "rrect", w: k(64, s), d: k(124, s), h: 4, r: 16, fillet: 1.5 }, { to: "scene", anchor: "back", rotate: up }, "PLA", n.accent, "matte_plastic"),
    body("face", "housing", { kind: "rounded_extrude", shape: "rrect", w: k(58, s), d: k(116, s), h: 22, r: 14, fillet: 5 }, { to: "plate", anchor: "top", rotate: up }, "PLA", n.main, "soft_touch",
      n.speaker ? { features: [{ kind: "grille", face: "top", count: 16 }] } : {}),
  ];
  const button = n.button || !n.light;
  if (button) bodies.push(body("button", "button_cap", { kind: "button_cap", d: 24, h: 4, dome: 0.4, stem: 0 }, { to: "face", anchor: "top", offset: [0, -22, 0], rotate: up }, "PLA", n.accent, "soft_touch"));
  // Signature detail: a glowing halo round the bell button (or a lens when there is no button).
  if (n.light && button) bodies.push(body("halo", "light_ring", { kind: "ring", shape: "round", w: 28, d: 28, t: 3, h: 3 }, { to: "face", anchor: "top", offset: [0, -22, 0], rotate: up }, "resin_clear", "mist", "glossy_plastic"));
  else if (n.light) bodies.push(body("lens", "window", { kind: "rounded_extrude", shape: "rrect", w: 18, d: 18, h: 2.5, r: 8.9, fillet: 1 }, { to: "face", anchor: "top", offset: [0, 34, 0], rotate: up }, "resin_clear", "mist", "glossy_plastic"));
  return { archetype: "wall_mount", scene: "wall", rationale: RATIONALE.wall_mount, bodies, electronicsHost: "face", links: [] };
}

function handheld(n: ProductNeeds): Raw {
  const s = n.scale;
  const keys: Colour = n.main === "graphite" ? "chalk" : "graphite";
  const len = Math.min(200, k(168, s));
  const bodies: Raw[] = [
    body("shell", "housing", { kind: "loft_rounded", shape: "rrect", w0: k(46, s), d0: len, w1: k(42, s), d1: len, h: 22, r: 14, fillet: 6, shiftY: 0 }, { to: "ground", anchor: "top" }, "PLA", n.main, "soft_touch",
      { features: [{ kind: "texture_grip", face: "left", count: 8 }] }),
  ];
  // One cap per switch (the solver moves each over its switch), in a column on the top.
  const caps = Math.max(1, Math.min(4, n.buttons));
  for (let i = 0; i < caps; i++) {
    bodies.push(body(i ? `button_${i + 1}` : "button", "button_cap", { kind: "button_cap", d: 10, h: 3, dome: 0.5, stem: 0 }, { to: "shell", anchor: "top", offset: [0, -30 + 14 * i, 0] }, "PLA", keys, "soft_touch"));
  }
  // The red power key at the far end: the first thing anyone looks for on a remote.
  bodies.push(body("power", "button_cap", { kind: "button_cap", d: 9, h: 2.5, dome: 0.4, stem: 0 }, { to: "shell", anchor: "top", offset: [0, -(len / 2 - 18), 0] }, "PLA", "coral", "soft_touch"));
  if (n.light) bodies.push(body("lens", "window", { kind: "rounded_extrude", shape: "rrect", w: 16, d: 8, h: 2.5, r: 3.9, fillet: 1 }, { to: "shell", anchor: "front", rotate: [90, 0, 0] }, "resin_clear", "graphite", "glossy_plastic"));
  return { archetype: "handheld", scene: "hand", rationale: RATIONALE.handheld, bodies, electronicsHost: "shell", links: [] };
}

function wearable(n: ProductNeeds): Raw {
  const s = n.scale;
  const bodies: Raw[] = [
    body("pod", "housing", { kind: "rounded_extrude", shape: "superellipse", w: k(42, s), d: k(36, s), h: 13, r: 12, n: 4, fillet: 4 }, { to: "ground", anchor: "top" }, "PLA", n.main, "soft_touch"),
    body("strap_l", "clip", { kind: "rounded_extrude", shape: "rrect", w: 60, d: 22, h: 2.4, r: 4, fillet: 1 }, { to: "pod", anchor: "left" }, "TPU", "graphite", "soft_touch"),
    body("strap_r", "clip", { kind: "rounded_extrude", shape: "rrect", w: 60, d: 22, h: 2.4, r: 4, fillet: 1 }, { to: "pod", anchor: "right" }, "TPU", "graphite", "soft_touch"),
  ];
  return { archetype: "wearable_band", scene: "hand", rationale: RATIONALE.wearable_band, bodies, electronicsHost: "pod", links: [] };
}

function petFeeder(n: ProductNeeds): Raw {
  const s = n.scale;
  const W = k(150, Math.min(s, 1.3));
  const D = k(140, Math.min(s, 1.3));
  const bowlR = 58;
  const bodies: Raw[] = [
    body("base", "housing", { kind: "rounded_extrude", shape: "rrect", w: W, d: D, h: 70, r: 30, fillet: 6 }, { to: "ground", anchor: "top" }, "PLA", n.main, "matte_plastic"),
    // Clear hopper: you see how much food is left.
    body("hopper", "reservoir", { kind: "tank", shape: "round", w: 116, d: 116, h: 140, r: 20, lidH: 10, window: 0 }, { to: "base", anchor: "top", offset: [0, 8, 0] }, "resin_clear", "mist", "glossy_plastic"),
    // The chute the food drops down, over the bowl.
    body("chute", "nozzle", { kind: "nozzle", length: 40, d: 14, bore: 5, angle: 70, drop: 18 }, { to: "base", anchor: "front", offset: [0, 0, 24] }, "PLA", n.accent, "matte_plastic"),
    body("bowl", "base", { kind: "lathe_profile", points: [[44, 0], [50, 4], [56, 20], [bowlR, 28]], round: 3, segments: 96 }, { to: "ground", anchor: "top", offset: [0, -(D / 2 + bowlR + 1), 0] }, "PETG", n.accent, "glossy_plastic", { shell: "open_top" }),
  ];
  return { archetype: "pet_feeder", scene: "pet_bowl", rationale: RATIONALE.pet_feeder, bodies, electronicsHost: "base", links: [] };
}

function dispenser(n: ProductNeeds): Raw {
  const s = n.scale;
  const W = k(80, s), D = k(70, s);
  const bodies: Raw[] = [
    body("body", "housing", { kind: "rounded_extrude", shape: "rrect", w: W, d: D, h: k(110, s), r: 20, fillet: 4 }, { to: "ground", anchor: "top" }, "PLA", n.main, "soft_touch"),
    body("tank", "reservoir", { kind: "tank", shape: "rrect", w: W, d: D, h: 70, r: 20, lidH: 8, window: 1 }, { to: "body", anchor: "top" }, "PETG", "mist", "glossy_plastic"),
  ];
  const links: Raw[] = [];
  if (n.pump) {
    bodies.push(body("spout", "nozzle", { kind: "nozzle", length: 24, d: 10, bore: 3, angle: 80, drop: 12 }, { to: "body", anchor: "front", offset: [0, 0, 20] }, "PLA", n.accent, "matte_plastic"));
    links.push({ kind: "tube", from: { body: "tank", anchor: "back" }, to: { body: "body", anchor: "back" }, diameter: 6, colour: "mist" });
  }
  return { archetype: "dispenser", scene: "desk", rationale: RATIONALE.dispenser, bodies, electronicsHost: "body", links };
}

function vehicleMount(n: ProductNeeds): Raw {
  const s = n.scale;
  const up: [number, number, number] = [90, 0, 0];
  const bodies: Raw[] = [
    body("face", "housing", { kind: "rounded_extrude", shape: "rrect", w: k(72, s), d: k(72, s), h: 20, r: 18, fillet: 5 }, { to: "scene", anchor: "back", rotate: up }, "PETG", n.main, "soft_touch"),
    body("clip", "clip", { kind: "clip_arm", w: 22, length: 40, t: 2.4, gap: 8 }, { to: "face", anchor: "bottom" }, "PETG", "graphite", "matte_plastic"),
  ];
  return { archetype: "vehicle_mount", scene: "car_dash", rationale: RATIONALE.vehicle_mount, bodies, electronicsHost: "face", links: [] };
}

function outdoorBox(n: ProductNeeds): Raw {
  const s = n.scale;
  const W = k(110, s), D = k(80, s);
  const bodies: Raw[] = [
    body("flange", "bracket", { kind: "rounded_extrude", shape: "rrect", w: W + 36, d: D + 10, h: 4, r: 8, fillet: 1.5 }, { to: "ground", anchor: "top" }, "PETG", n.accent, "matte_plastic"),
    body("box", "housing", { kind: "enclosure", template: "rounded_box", w: W, d: D, h: k(60, s), r: 10, fillet: 3 }, { to: "flange", anchor: "top" }, "PETG", n.main, "matte_plastic",
      { wall: 2.4, features: [{ kind: "screw_bosses" }, { kind: "drain_holes", face: "bottom", count: 2 }] }),
  ];
  return { archetype: "outdoor_box", scene: "outdoor", rationale: RATIONALE.outdoor_box, bodies, electronicsHost: "box", links: [] };
}

function tabletopRobot(n: ProductNeeds): Raw {
  const s = n.scale;
  const bodies: Raw[] = [
    body("body", "base", { kind: "rounded_extrude", shape: "rrect", w: k(90, s), d: k(76, s), h: k(46, s), r: 22, fillet: 8 }, { to: "ground", anchor: "top" }, "PLA", n.main, "soft_touch"),
    body("head", "housing", { kind: "lathe_profile", points: pts([[30, 0], [36, 9], [36, 24], [24, 36], [8, 41]], s), round: 4, segments: 96 }, { to: "body", anchor: "top" }, "PLA", n.accent, "soft_touch"),
    body("visor", "window", { kind: "rounded_extrude", shape: "rrect", w: k(34, s), d: 10, h: 2.5, r: 4.9, fillet: 1 }, { to: "head", anchor: "front", rotate: [90, 0, 0] }, "resin_clear", "graphite", "glossy_plastic"),
  ];
  return { archetype: "tabletop_robot", scene: "desk", rationale: RATIONALE.tabletop_robot, bodies, electronicsHost: "head", links: [] };
}

const BUILDERS: Record<Archetype, (n: ProductNeeds) => Raw> = {
  stake_device: stakeDevice,
  planter_insert: planterInsert,
  desk_object: deskObject,
  lamp,
  wall_mount: wallMount,
  handheld,
  wearable_band: wearable,
  pet_feeder: petFeeder,
  dispenser,
  vehicle_mount: vehicleMount,
  outdoor_box: outdoorBox,
  tabletop_robot: tabletopRobot,
};

/** The default model of one archetype for this spec + parts (always valid). */
export function archetypeDefault(archetype: Archetype, spec: ProductSpec, parts: readonly LayoutInput[] = []): ProductModel {
  const raw = BUILDERS[archetype](needsOf(spec, parts));
  return clampProductModel({ ...raw, scene: raw.scene ?? ARCHETYPE_SCENE[archetype] });
}

/**
 * The product the Studio shows when there is no AI design (or the AI failed): the best
 * archetype for the spec, parameterised by its size hint, style and parts.
 */
export function defaultProductFor(spec: ProductSpec, parts: readonly LayoutInput[] = [], opts: { archetype?: Archetype } = {}): ProductModel {
  return archetypeDefault(opts.archetype ?? archetypeFor(spec), spec, parts);
}

/** "Try another": the next `n` archetypes after the current one, as default models. */
export function productVariants(spec: ProductSpec, parts: readonly LayoutInput[], current: Archetype, n = 3): ProductModel[] {
  return rankArchetypes(spec)
    .filter((r) => r.archetype !== current)
    .slice(0, n)
    .map((r) => archetypeDefault(r.archetype, spec, parts));
}
