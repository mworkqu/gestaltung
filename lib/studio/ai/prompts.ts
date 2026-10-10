// Design Studio — system prompts and Gemini responseSchemas. Server-only text,
// but pure (no I/O) so tests can import it.
//
// Every enum in a responseSchema comes from lib/studio/schema.ts (one source of
// truth). Ranges are given as descriptions only: Gemini's schema subset is
// small, and our clamp*() helpers enforce the real limits anyway.

import {
  COLOURS, ENVIRONMENTS, FEET, FINISHES, HEIGHT_BIASES, INPUTS, LIDS, LIMITS, MECH_PARAMS,
  MECH_TEMPLATES, MATERIALS, OUTPUTS, POWERS, SIZE_HINTS, STYLES, USES, VENT_FACES, VENT_PATTERNS,
  type EnclosureTemplate, type MechTemplate,
} from "../schema";

export const MAX_QUESTIONS = 4;
export const QUESTION_MAX = 140;
export const CHOICE_MAX = 40;
export const LABEL_MAX = 30;
export const REASON_MAX = 100;
export const MAX_COMPONENTS = 12;

/** Phase 1 enclosure templates the renderer can build. */
export const PHASE1_TEMPLATES: readonly EnclosureTemplate[] = [
  "rounded_box", "pill", "soft_wedge", "puck", "handheld_taper",
];

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
  "Return EITHER {question, choices} OR {spec}, never both. quantity is always 1.";

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
    quantity: { type: "INTEGER", description: "Always 1" },
  },
  required: ["name", "oneLine", "use", "power", "environment", "features", "inputs", "outputs", "sizeHint", "style", "quantity"],
};

export const SPEC_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    question: str(`One short question, at most ${QUESTION_MAX} characters`),
    choices: { type: "ARRAY", items: str(`At most ${CHOICE_MAX} characters`), minItems: 2, maxItems: 4 },
    spec: PRODUCT_SPEC_SCHEMA,
  },
};

export type ChatMessage = { role: "user" | "assistant"; text: string; choices?: string[] };

export function specPrompt(opts: { idea: string; messages: ChatMessage[]; locale: "en" | "ar"; forceSpec: boolean }): string {
  const history = opts.messages.length
    ? opts.messages
        .map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}${m.choices?.length ? ` [choices: ${m.choices.join(" | ")}]` : ""}`)
        .join("\n")
    : "(none yet)";
  return [
    `Idea:\n${opts.idea || "(see the conversation)"}`,
    `Conversation so far:\n${history}`,
    `Language for any question: ${opts.locale === "ar" ? "Arabic" : "English"}.`,
    opts.forceSpec ? "Return the spec now." : "Ask the next question, or return the spec if you know enough.",
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// b. Part picker
// ---------------------------------------------------------------------------

export const PICK_SYSTEM =
  "Pick the smallest set of parts from THIS library that makes the product work. " +
  "Exactly one mcu. Choose power parts that match spec.power. Only ids from the list. " +
  "Return {components:[{partId,label}], reasons:{partId:plainSentence}}. " +
  `Labels are short names for the user (at most ${LABEL_MAX} characters); ` +
  `each reason is one plain sentence (at most ${REASON_MAX} characters) on why the part is there. ` +
  "Never invent part ids, voltages or wiring.";

export const PICK_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    components: {
      type: "ARRAY",
      maxItems: MAX_COMPONENTS,
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

export function pickPrompt(opts: { spec: unknown; index: unknown[]; locale: "en" | "ar" }): string {
  return [
    `Product:\n${JSON.stringify(opts.spec)}`,
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
          pattern: enumOf(VENT_PATTERNS),
          face: enumOf(VENT_FACES),
          count: { type: "INTEGER", description: `${LIMITS.ventCount.min}–${LIMITS.ventCount.max}` },
        },
        required: ["pattern", "face", "count"],
      },
      feet: enumOf(FEET),
      finish: enumOf(FINISHES),
      colour: enumOf(COLOURS),
      accentColour: enumOf(COLOURS),
      label: str(`Optional text on the case, at most ${LIMITS.label.max} characters`),
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
}): string {
  const lines = [
    `Product:\n${JSON.stringify(opts.spec)}`,
    `Parts inside:\n${JSON.stringify(opts.components)}`,
    `Space the parts need (mm): ${JSON.stringify(opts.bbox)}`,
    `Allowed templates: ${opts.templates.join(", ")}`,
  ];
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
