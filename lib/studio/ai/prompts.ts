// Design Studio — system prompts and Gemini responseSchemas. Server-only text,
// but pure (no I/O) so tests can import it.
//
// Every enum in a responseSchema comes from lib/studio/schema.ts (one source of
// truth). Ranges are given as descriptions only: Gemini's schema subset is
// small, and our clamp*() helpers enforce the real limits anyway.

import {
  ACTUATOR_KINDS, ACTUATOR_LOADS, MOVER_KINDS, COLOURS, ENVIRONMENTS, FEET, FINISHES, HEIGHT_BIASES, INPUTS, LIDS, LIMITS, MECH_PARAMS,
  MECH_TEMPLATES, MATERIALS, OUTPUTS, PHASE_TEMPLATES, PLACEMENTS, POWERS, SIZE_HINTS, STYLES, USES, VENT_FACES, VENT_PATTERNS,
  type EnclosureTemplate, type MechTemplate, type ProductSpec,
} from "../schema";

export const MAX_QUESTIONS = 4;
export const QUESTION_MAX = 140;
export const CHOICE_MAX = 40;
/** Part A: the assistant's chat reply once the card exists, and each "what changed" label. */
export const REPLY_MAX = 220;
export const CHANGED_MAX = 40;
export const CHANGED_ITEMS = 4;
export const LABEL_MAX = 30;
export const REASON_MAX = 100;
export const MAX_COMPONENTS = 12;

/** Enclosure templates the AI may choose (= what the browser builder makes: all eight). */
export const AI_TEMPLATES: readonly EnclosureTemplate[] = PHASE_TEMPLATES;

const str = (description?: string) => ({ type: "STRING", ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: "NUMBER", ...(description ? { description } : {}) });
const enumOf = (values: readonly string[], description?: string) => ({
  type: "STRING",
  enum: [...values],
  ...(description ? { description } : {}),
});
const enumList = (values: readonly string[]) => ({ type: "ARRAY", items: enumOf(values) });

// ---------------------------------------------------------------------------
// a. Idea chat → ProductSpec
// ---------------------------------------------------------------------------

export const SPEC_SYSTEM =
  "You help a non-engineer turn a rough product idea into a clear definition for a FIRST PROTOTYPE (one piece). " +
  "Ask at most 4 short questions, one at a time, each answerable with a tap (offer 2–4 choices). " +
  "Never ask about quantity, exact dimensions, shapes or materials. " +
  "When you know enough, return the ProductSpec JSON. " +
  "Use plain words in the user's language (English or Arabic). " +
  "Never re-ask something already answered in the history. " +
  "If 4 questions were already asked, return the spec. " +
  "If the idea states no function (e.g. 'something with Arduino'), ask what it should do; never repeat the idea back as the product. " +
  "Keep every function word the user wrote: 'automatic watering' needs a pump (outputs: pump) and a power source that can drive it; " +
  "'beeps' needs a buzzer; 'shows' needs a screen; 'lights up' needs a led. " +
  "Infer where it lives from the idea instead of a generic default: a plant monitor stands in the soil of the pot (placement plant_soil), " +
  "a wearable sits on the body (use wearable, placement on_body, or on_wrist for a watch/bracelet) and runs on a battery. " +
  // Part B: how many movers.
  "When the product moves or pumps with more than one actuator, set spec.actuators: groups of {kind (servo, motor, pump, stepper), " +
  `count 1–${LIMITS.actuators.countMax}, load (light, medium, heavy), role} (at most ${LIMITS.actuators.max} groups). ` +
  "If the user names a reference product, infer its joint/motor count, e.g. 6-axis arm → servo ×6; a gripper is one more servo; " +
  "a pan-tilt head → servo ×2; a two-wheel robot → motor ×2; two plants watered separately → pump ×2. " +
  "For an arm, base/shoulder/elbow joints are medium or heavy and wrist/gripper joints light (use separate groups with a role); " +
  "at most 3 joints are medium or heavy, every other joint and the gripper are light (one 5 V supply has to feed them all). " +
  "A desktop copy of a 6-axis industrial arm such as a UR10 = 6 servos in total: 3 heavy (base, shoulder, elbow) + " +
  "3 light (wrist pitch, wrist roll, gripper). " +
  "If the user changes the count ('make it 4 joints'), update spec.actuators and put e.g. '4 joints' in changed. " +
  "Before the card exists, return EITHER {question, choices} OR {spec} (with an optional reply), never both. quantity is always 1. " +
  // Part A: scope honesty on the first card.
  "We make small desktop kits (hobby servos, small motors, USB or battery power, about 60 cm at most). " +
  "If the idea is far beyond that (an industrial robot like a UR10, a car, a full-size drone, anything bigger than about 60 cm " +
  "or needing mains-powered motors), still return the spec of the small version we CAN build, put that small version in oneLine, " +
  `set spec.scaleNote (at most ${LIMITS.scaleNote.max} characters) to what the real thing is versus what we build, ` +
  "and add a reply (1–2 sentences) that says so plainly, e.g. 'A real UR10 is an industrial arm (1.3 m reach, 10 kg). " +
  "We can build a desktop arm that moves like it, about 30–40 cm, with hobby servos.' " +
  // Part A: once the card exists the chat answers like a person.
  "Once a card exists, every turn returns {diff, spec, reply, changed} with the FULL rebuilt understanding and spec: " +
  `reply = one or two plain sentences (at most ${REPLY_MAX} characters) in the page language, always present. ` +
  "If the user asks for a change, rebuild everything it touches, list what changed in changed (short labels like " +
  "'Now solar powered') and say it in reply. If the user asks a question about the idea or a product they mention " +
  "(e.g. 'what is UR10'), answer briefly and relate it to what we can build; the spec comes back unchanged. " +
  "Off-topic or 'who made you': say you are Gestaltung's design assistant who helps turn an idea into parts, wiring and a case, " +
  "and steer back to the idea; spec unchanged. Rude messages: one calm line, no lecture, spec unchanged. " +
  "Never claim to be human. Never name the AI company or model behind you; you are Gestaltung's design assistant. " +
  // 2026-10-18: the "Our understanding" panel, rebuilt in full on every turn.
  "Every spec carries spec.understanding — your full understanding of the idea, shown to the user to confirm: " +
  "goal (one sentence), howItWorks (2–4 plain sentences: what it senses, what it decides, what it does), " +
  "controller (the board, e.g. 'Arduino Uno'), sensors, actuators (servo, linear_actuator, motor, pump, stepper) and " +
  "outputs (screen, LEDs, buzzer…), each {name, count, purpose}. List every part the goal needs and nothing it does not. " +
  "spec.actuators must match the understanding's movers (same kinds and counts; a small linear actuator stays only in the understanding). " +
  "Keep it a student-sized build unless the user asks for more: one controller, the fewest sensors and movers that do the job. " +
  "Use Western digits (0-9) in Arabic too.";

const U = LIMITS.understanding;
const partProps = (what: string) => ({
  name: str(`${what}, at most ${U.name} characters`),
  count: { type: "INTEGER", description: `1–${U.countMax}` },
  purpose: str(`What it does in this build, at most ${U.purpose} characters`),
});
const partList = (what: string) => ({
  type: "ARRAY",
  maxItems: U.items,
  items: { type: "OBJECT", properties: partProps(what), required: ["name", "count"] },
});

export const UNDERSTANDING_SCHEMA = {
  type: "OBJECT",
  properties: {
    goal: str(`What the build is for, one sentence, at most ${U.goal} characters`),
    howItWorks: str(`2–4 plain sentences: what it senses, decides and does, at most ${U.how} characters`),
    controller: str("The one controller board, e.g. Arduino Uno"),
    sensors: partList("Sensor name"),
    actuators: {
      type: "ARRAY",
      maxItems: U.items,
      items: {
        type: "OBJECT",
        properties: { ...partProps("Mover name, e.g. SG90 micro servo"), kind: enumOf(MOVER_KINDS) },
        required: ["name", "count", "kind"],
      },
    },
    outputs: partList("Output name, e.g. Buzzer, OLED screen, LED"),
  },
  required: ["goal", "howItWorks", "controller", "sensors", "actuators", "outputs"],
};

export const PRODUCT_SPEC_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: str(`Short product name, ${LIMITS.name.min}–${LIMITS.name.max} characters`),
    oneLine: str(`What it does, one plain sentence, at most ${LIMITS.oneLine.max} characters`),
    use: enumOf(USES),
    power: enumOf(POWERS),
    environment: enumOf(ENVIRONMENTS),
    features: { type: "ARRAY", items: str(`at most ${LIMITS.features.itemMax} characters`), maxItems: LIMITS.features.max },
    inputs: enumList(INPUTS),
    outputs: enumList(OUTPUTS),
    sizeHint: enumOf(SIZE_HINTS),
    style: enumOf(STYLES),
    placement: enumOf(PLACEMENTS, "Only when the use alone would be wrong: plant_soil (in a plant pot / soil), on_body, on_wrist"),
    scaleNote: str(
      `Only when the idea is far beyond a desktop kit: the real thing vs the small version we build, at most ${LIMITS.scaleNote.max} characters`,
    ),
    actuators: {
      type: "ARRAY",
      maxItems: LIMITS.actuators.max,
      description: "Only when it moves or pumps: groups of identical actuators, e.g. servo ×6 for a 6-axis arm",
      items: {
        type: "OBJECT",
        properties: {
          kind: enumOf(ACTUATOR_KINDS),
          count: { type: "INTEGER", description: `${LIMITS.actuators.countMin}–${LIMITS.actuators.countMax}` },
          load: enumOf(ACTUATOR_LOADS, "heavy/medium = strong joints (base, shoulder, elbow); light = wrist, gripper, pan-tilt"),
          role: str(`What they move, at most ${LIMITS.actuators.roleMax} characters, e.g. "base, shoulder, elbow"`),
        },
        required: ["kind", "count", "load"],
      },
    },
    understanding: UNDERSTANDING_SCHEMA,
    quantity: { type: "INTEGER", description: "Always 1" },
  },
  required: ["name", "oneLine", "use", "power", "environment", "features", "inputs", "outputs", "sizeHint", "style", "understanding", "quantity"],
};

export const SPEC_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    question: str(`One short question, at most ${QUESTION_MAX} characters`),
    choices: { type: "ARRAY", items: str(`At most ${CHOICE_MAX} characters`), minItems: 2, maxItems: 4 },
    spec: PRODUCT_SPEC_SCHEMA,
    reply: str(`One or two plain sentences in the page language, at most ${REPLY_MAX} characters`),
    changed: {
      type: "ARRAY",
      items: str(`What changed on the card, at most ${CHANGED_MAX} characters`),
      maxItems: CHANGED_ITEMS,
    },
  },
};
/** A turn once the card exists: the whole understanding + spec come back every time (2026-10-18). */
export const REFINE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    diff: {
      type: "ARRAY",
      maxItems: 8,
      items: str("One thing the newest message changes versus the current understanding, at most 100 characters"),
    },
    spec: PRODUCT_SPEC_SCHEMA,
    reply: SPEC_RESPONSE_SCHEMA.properties.reply,
    changed: SPEC_RESPONSE_SCHEMA.properties.changed,
  },
  required: ["diff", "spec", "reply", "changed"],
};

export type ChatMessage = { role: "user" | "assistant"; text: string; choices?: string[] };

/** Bigger builds (Makers / Engineers): richer electronics before the parts are listed. */
export const DEEP_CHECK =
  "This is a bigger build: before you answer, check the electronics part by part. " +
  "Every servo group of 3 or more needs a servo driver board and a supply that can feed them all; every DC motor or pump needs a driver " +
  "(motor driver board or MOSFET module); a 3.3 V board driving 5 V parts needs a level shifter; batteries need a charger or holder and a switch. " +
  "List those helper parts in the understanding's outputs or sensors where they fit, and explain them in howItWorks.";

export function specPrompt(opts: {
  idea: string;
  messages: ChatMessage[];
  locale: "en" | "ar";
  forceSpec: boolean;
  /** Makers / Engineers builds: a deeper electronics check on every turn (lib/studio/tiers.ts). */
  deep?: boolean;
  /** The card as it stands: the last user message is a change request on top of it (W3 refinement). */
  current?: ProductSpec | null;
}): string {
  const history = opts.messages.length
    ? opts.messages
        .map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}${m.choices?.length ? ` [choices: ${m.choices.join(" | ")}]` : ""}`)
        .join("\n")
    : "(none yet)";
  if (opts.current) {
    const change = [...opts.messages].reverse().find((m) => m.role === "user")?.text ?? "";
    const { understanding, ...card } = opts.current;
    return [
      `Idea:\n${opts.idea || "(see the conversation)"}`,
      `Our current understanding (shown to the user above the chat):\n${understanding ? JSON.stringify(understanding) : "(none yet — build it now)"}`,
      `Current spec:\n${JSON.stringify(card)}`,
      `The whole conversation, oldest first:\n${history}`,
      `The user's newest message: ${change}`,
      "Do this on EVERY turn, in order:\n" +
        "1. Re-read the idea, the whole conversation and the current understanding.\n" +
        "2. Diff: work out what the newest message, read together with everything said before, changes about the goal, " +
        "how it works, the controller, the sensors, the movers (servos, small linear actuators, motors, pumps) and the outputs. " +
        "Earlier requests that still hold stay applied. Put each change in diff (empty when nothing changes).\n" +
        "3. Rebuild the FULL understanding from the goal down, then the FULL spec from that understanding. Never patch only the " +
        "field the last message names: if the goal or how it works changes, re-think every part — add the parts the new behaviour " +
        "needs and drop the parts that no longer serve it. A count change ('4 servos', 'two sensors') changes that part's count " +
        "and spec.actuators to match.\n" +
        "4. Return {diff, spec (with spec.understanding), reply, changed}. changed = short labels the user sees (e.g. 'Now 4 servos'). " +
        "When the message is only a question ('what is UR10', 'who made you') or small talk, return the current understanding and spec " +
        "copied exactly, diff and changed empty, and answer in reply. " +
        "Copy the wording of everything that did not change exactly, so only real changes show. " +
        "A message that names a reference product to copy ('big robotic arm like a UR10') IS a change: rebuild for the desktop " +
        "version with that product's joint/motor count and a scaleNote when the real thing is far bigger.",
      ...(opts.deep ? [DEEP_CHECK] : []),
      `Language for the reply, names, understanding and features: ${opts.locale === "ar" ? "Arabic" : "English"}.`,
    ].join("\n\n");
  }
  return [
    `Idea:\n${opts.idea || "(see the conversation)"}`,
    `Conversation so far:\n${history}`,
    ...(opts.deep ? [DEEP_CHECK] : []),
    `Language for any question, reply and the spec text: ${opts.locale === "ar" ? "Arabic" : "English"}.`,
    opts.forceSpec ? "Return the spec now." : "Ask the next question, or return the spec if you know enough.",
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// b. Part picker
// ---------------------------------------------------------------------------

export const PICK_SYSTEM =
  "Pick the fewest parts from THIS library that make the product work; when spec.actuators gives a count, " +
  "include exactly that many of the matching actuator (one entry per unit: 6 servos = 6 entries). " +
  "Heavy or medium servo joints use the strong metal-gear servo, light ones the small servo; 3 or more servos go on the servo driver board " +
  "and need a supply that can feed them all. " +
  "Exactly one mcu. Choose power parts that match spec.power. Only ids from the list. " +
  "When spec.understanding lists the controller, sensors, movers and outputs, pick the library parts that match that list " +
  "(same kinds and counts); a part it lists that the library lacks is left out. " +
  "Return {components:[{partId,label}], reasons:{partId:plainSentence}}. " +
  `Labels are short names for the user (at most ${LABEL_MAX} characters); ` +
  `each reason is one plain sentence (at most ${REASON_MAX} characters) on why the part is there. ` +
  "Never invent part ids, voltages or wiring.";

export const PICK_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    components: {
      type: "ARRAY",
      // Identical parts repeat (6 servos = 6 entries); the server caps KINDS at MAX_COMPONENTS.
      maxItems: MAX_COMPONENTS * 2,
      items: {
        type: "OBJECT",
        properties: { partId: str("An id from the library list"), label: str(`At most ${LABEL_MAX} characters`) },
        required: ["partId", "label"],
      },
    },
    // A map cannot be expressed in Gemini's schema subset; the server accepts both shapes.
    reasons: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { partId: str(), reason: str(`One plain sentence, at most ${REASON_MAX} characters`) },
        required: ["partId", "reason"],
      },
    },
  },
  required: ["components"],
};

export function pickPrompt(opts: { spec: unknown; index: unknown[]; locale: "en" | "ar"; actuators?: readonly unknown[] }): string {
  return [
    `Product:\n${JSON.stringify(opts.spec)}`,
    ...(opts.actuators?.length ? [`Actuators (include exactly this many of each):\n${JSON.stringify(opts.actuators)}`] : []),
    `Library (the ONLY parts you may use):\n${JSON.stringify(opts.index)}`,
    `Write labels and reasons in ${opts.locale === "ar" ? "Arabic" : "English"}.`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// c. Enclosure
// ---------------------------------------------------------------------------

export const ENCLOSURE_SYSTEM =
  "Choose a friendly, ergonomic enclosure for this product from the allowed templates and options. " +
  "Prefer soft, rounded, consumer-product looks that suit the use (desk / handheld / wall / outdoor). " +
  "When each template fits: rounded_box = general box on a desk or shelf; pill = wearable or pocket item; " +
  "soft_wedge = desk device with a screen (tilted top); puck = small round palm-sized object; " +
  "handheld_taper = held in the hand; lantern = tall light or speaker standing on a desk (light slots around " +
  "its top band, up to 3 times as tall as wide); dome_base = round sensor, lamp or speaker on a desk (domed lid, " +
  "ring feet); wall_plate = mounted on a wall (thin plate, keyholes on the back, no feet); " +
  "stake_pod = round pod on a spike pushed into the soil of a plant pot or garden bed (no feet; vents on a side). " +
  "Match the product's placement, how it is held, indoor/outdoor and size; when our shape rules suggest a " +
  "template, prefer it for the first look unless the product clearly needs another. " +
  "Vents: slots, holes or hex for airflow; grille = concentric arcs over a speaker (usually the +z top); " +
  "louvres = angled slats on a side face (+x/-x/+y/-y) for products near rain or dust. " +
  "label = optional short product name raised on the lid, Latin letters, digits, space, - . & only, at most " +
  `${LIMITS.label.max} characters; leave it out for an Arabic name. ` +
  "Return only EnclosureSpec JSON. Never write geometry or code.";

export function enclosureSchema(templates: readonly EnclosureTemplate[]) {
  return {
    type: "OBJECT",
    properties: {
      template: enumOf(templates),
      proportions: {
        type: "OBJECT",
        properties: {
          widthToDepth: num(`${LIMITS.widthToDepth.min}–${LIMITS.widthToDepth.max}`),
          heightBias: enumOf(HEIGHT_BIASES),
        },
        required: ["widthToDepth", "heightBias"],
      },
      cornerRadius: num(`mm, ${LIMITS.cornerRadius.min}–${LIMITS.cornerRadius.max}`),
      edgeFillet: num(`mm, ${LIMITS.edgeFillet.min}–${LIMITS.edgeFillet.max}`),
      wall: num(`mm, ${LIMITS.wall.min}–${LIMITS.wall.max}`),
      clearance: num(`mm, ${LIMITS.clearance.min}–${LIMITS.clearance.max}`),
      lid: enumOf(LIDS, "twist only for puck"),
      vents: {
        type: "OBJECT",
        properties: {
          pattern: enumOf(VENT_PATTERNS, "grille = speaker arcs; louvres only on a side face"),
          face: enumOf(VENT_FACES),
          count: { type: "INTEGER", description: `${LIMITS.ventCount.min}–${LIMITS.ventCount.max}` },
        },
        required: ["pattern", "face", "count"],
      },
      feet: enumOf(FEET),
      finish: enumOf(FINISHES),
      colour: enumOf(COLOURS),
      accentColour: enumOf(COLOURS),
      label: str(`Optional product name raised on the lid: Latin letters, digits, space, - . & only, at most ${LIMITS.label.max} characters`),
    },
    required: ["template", "proportions", "cornerRadius", "edgeFillet", "wall", "clearance", "lid", "vents", "feet", "finish", "colour"],
  };
}

export function enclosurePrompt(opts: {
  spec: unknown;
  components: { name: string; category: string }[];
  bbox: { w: number; d: number; h: number };
  templates: readonly EnclosureTemplate[];
  previous: unknown[];
  /** Our shape rules (shape-pick.ts rankShapes), best first: template + the reason code. */
  suggested?: { template: EnclosureTemplate; reason: string }[];
}): string {
  const lines = [
    `Product:\n${JSON.stringify(opts.spec)}`,
    `Parts inside:\n${JSON.stringify(opts.components)}`,
    `Space the parts need (mm): ${JSON.stringify(opts.bbox)}`,
    `Allowed templates: ${opts.templates.join(", ")}`,
  ];
  const suggested = (opts.suggested ?? []).filter((s) => opts.templates.includes(s.template));
  if (suggested.length) {
    lines.push(`Our shape rules suggest, best first: ${suggested.map((s) => `${s.template} (${s.reason})`).join(", ")}`);
  }
  if (opts.previous.length) {
    lines.push(
      `Looks already shown to the user:\n${JSON.stringify(opts.previous)}\n` +
        "Choose a DIFFERENT template or a different colour from every look above."
    );
  }
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// d. Printable mechanical parts (Phase 2)
// ---------------------------------------------------------------------------

export const MECH_SYSTEM =
  "List the printable parts that hold these components inside this enclosure: " +
  "standoffs for mounting holes, cradles, clips, extenders. " +
  "A button_extender only for a component whose topPorts has button_cap, a light_pipe only for one whose topPorts has led_light_pipe. " +
  "Return MechPart[] using only the templates and parameter ranges given. Never write geometry or code.";

const MECH_PARAM_NAMES = [...new Set(Object.values(MECH_PARAMS).flatMap((r) => Object.keys(r)))];

export const MECH_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    parts: {
      type: "ARRAY",
      maxItems: 40,
      items: {
        type: "OBJECT",
        properties: {
          id: str("short id, letters, digits, _ or -"),
          template: enumOf(MECH_TEMPLATES),
          params: {
            type: "OBJECT",
            description: "Only the parameters of the chosen template, in mm (tilt in degrees)",
            properties: Object.fromEntries(MECH_PARAM_NAMES.map((k) => [k, num()])),
          },
          forInstance: str("instanceId of the component this part holds, if any"),
          printable: {
            type: "OBJECT",
            properties: { material: enumOf(MATERIALS), estGrams: num() },
            required: ["material", "estGrams"],
          },
        },
        required: ["template", "params", "printable"],
      },
    },
  },
  required: ["parts"],
};

export function mechRanges(): Record<MechTemplate, Record<string, string>> {
  const out = {} as Record<MechTemplate, Record<string, string>>;
  for (const [t, ranges] of Object.entries(MECH_PARAMS) as [MechTemplate, Record<string, [number, number, number]>][]) {
    out[t] = Object.fromEntries(Object.entries(ranges).map(([k, [min, max, def]]) => [k, `${min}–${max} (default ${def})`]));
  }
  return out;
}

export function mechPrompt(opts: { summary: unknown }): string {
  return [
    `Product inside the enclosure:\n${JSON.stringify(opts.summary)}`,
    `Templates and parameter ranges (mm):\n${JSON.stringify(mechRanges())}`,
  ].join("\n\n");
}
