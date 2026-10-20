// The AI product designer's prompt + Gemini responseSchema (P5-16 Phase 2a).
//
// The model thinks like an industrial designer, in this order, and keeps the
// reasoning SHORT inside the JSON (one line per step):
//   1. job      — what the product physically does, step by step
//   2. use      — where it lives, what the user touches / sees / fills / plugs in
//   3. parts    — one body per job; every actuator / sensor appears physically
//   4. proportions — archetype + sizes from the size hint ("palm" ≈ 70–100 mm head)
//   5. look     — 2–3 palette colours, finishes, one signature detail
// It always STARTS from our archetype default (given as JSON) and changes it —
// never from nothing. It never writes geometry or code: only ProductModel JSON
// from the form-part kit, which we clamp and solve.

import { COLOURS, FINISHES, type ProductSpec } from "../../schema";
import { ANCHORS } from "../forms/geometry";
import { FORM_KINDS, FORM_PARAMS, type ParamDef } from "../forms/params";
import {
  ARCHETYPES, BODY_ROLES, FEATURE_KINDS, LINK_KINDS, PRODUCT_LIMITS, PRODUCT_MATERIALS, SCENES, SHELLS,
  type Archetype, type ProductModel,
} from "../schema";

export const DESIGNER_SYSTEM =
  "You are an industrial designer. You design the real physical product, not a box around electronics. " +
  "Think in this order and keep each step to one short line: " +
  "1 job: what the product physically does, step by step (e.g. sense soil, pump water from a reservoir, drip at the roots, show status with light); " +
  "2 use: where it stands or hangs and what the user touches, sees, fills or plugs in; " +
  "3 parts: one body per job (stake, head, reservoir, tube, nozzle, light ring, button, base, lid, clip, handle…). " +
  "Every actuator and sensor in the parts list must appear physically: a pump needs a reservoir, a tube and an outlet; " +
  "a soil sensor needs its prongs exposed in the soil on a stake; an LED needs a visible clear light ring or window; " +
  "USB needs a port the user can reach; " +
  "4 proportions: keep the archetype and size it from the size hint (palm ≈ 70–100 mm head, pocket smaller, desk and large bigger); " +
  "5 look: 2–3 colours from the palette, a finish per body and ONE signature detail (a light halo, a leaf-shaped cap, a grip texture…). " +
  "The product must stand out from its scene as a designed object: never colour it like its surroundings " +
  "(in a plant pot no green bodies — leaves are green; use warm white or sand with one accent). " +
  "Light rings, shades and windows are resin_clear and glow; keep them large enough to see from a three-quarter view. " +
  "Start from the default design you are given for each archetype and improve it: its silhouette and functional bodies are " +
  "already tuned to be recognised at a glance. KEEP EVERY BODY of the default (same id, role and attach target and anchor); " +
  "you may resize, recolour, refinish, add features and add up to 2 new bodies; keep new body ids short snake_case. " +
  "All sizes are millimetres, Z up, -y is the front. Every body except the first attaches to another body (attach.to = its id) " +
  "or to 'ground' / 'scene'; children touch the parent's anchor face, offset slides along that face. " +
  "why_en and why_ar: one friendly sentence (max 160 characters) telling the client why this design suits the product — " +
  "plain words, no technical terms, no measurements; why_ar is natural Arabic. " +
  "Return only the JSON asked for. Never write code, meshes or anything outside the schema.";

const enumOf = (values: readonly string[], description?: string) => ({ type: "STRING", enum: [...values], ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: "NUMBER", ...(description ? { description } : {}) });
const vec3 = (description: string) => ({ type: "ARRAY", items: { type: "NUMBER" }, description });

/** All form parameters as one flat object (only the ones of `kind` are read). */
function formSchema() {
  const props: Record<string, object> = { kind: enumOf(FORM_KINDS) };
  for (const params of Object.values(FORM_PARAMS) as Record<string, ParamDef>[]) {
    for (const [k, d] of Object.entries(params)) {
      if (props[k]) continue;
      if (d.t === "num") props[k] = num();
      else if (d.t === "enum") props[k] = { type: "STRING" };
      else props[k] = { type: "ARRAY", items: { type: "ARRAY", items: { type: "NUMBER" } }, description: "[r, z] points, bottom to top" };
    }
  }
  return { type: "OBJECT", properties: props, required: ["kind"] };
}

export function productModelSchema(archetype?: Archetype) {
  const end = { type: "OBJECT", properties: { body: { type: "STRING" }, anchor: enumOf(ANCHORS) }, required: ["body", "anchor"] };
  return {
    type: "OBJECT",
    properties: {
      archetype: enumOf(archetype ? [archetype] : ARCHETYPES),
      scene: enumOf(SCENES),
      rationale: { type: "STRING", description: `max ${PRODUCT_LIMITS.rationale.max} characters` },
      bodies: {
        type: "ARRAY",
        description: `${PRODUCT_LIMITS.bodies.min}–${PRODUCT_LIMITS.bodies.max} bodies`,
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING", description: "short snake_case, unique" },
            role: enumOf(BODY_ROLES),
            form: formSchema(),
            attach: {
              type: "OBJECT",
              properties: {
                to: { type: "STRING", description: "a body id, 'ground' or 'scene'" },
                anchor: enumOf(ANCHORS),
                offset: vec3("[x, y, z] mm along the parent face"),
                rotate: vec3("[rx, ry, rz] degrees"),
              },
              required: ["to", "anchor", "offset"],
            },
            material: enumOf(PRODUCT_MATERIALS),
            colour: enumOf(COLOURS),
            finish: enumOf(FINISHES),
            features: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { kind: enumOf(FEATURE_KINDS), face: enumOf(ANCHORS), count: { type: "INTEGER" } },
                required: ["kind"],
              },
            },
            wall: num("shell wall mm, 1.6–4"),
            shell: enumOf(SHELLS),
          },
          required: ["id", "role", "form", "attach", "material", "colour", "finish"],
        },
      },
      electronicsHost: { type: "STRING", description: "id of the body that holds the electronics" },
      links: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { kind: enumOf(LINK_KINDS), from: end, to: end, diameter: num("4–8 mm"), colour: enumOf(COLOURS) },
          required: ["kind", "from", "to", "diameter", "colour"],
        },
      },
    },
    required: ["archetype", "scene", "rationale", "bodies", "electronicsHost", "links"],
  };
}

export function designerSchema(archetypes: readonly Archetype[]) {
  const line = { type: "STRING", description: "one short line" };
  return {
    type: "OBJECT",
    properties: {
      designs: {
        type: "ARRAY",
        description: `exactly ${archetypes.length}, one per archetype asked for, in that order`,
        items: {
          type: "OBJECT",
          properties: {
            archetype: enumOf(archetypes),
            thinking: {
              type: "OBJECT",
              properties: { job: line, use: line, parts: line, proportions: line, look: line },
              required: ["job", "use", "parts", "proportions", "look"],
            },
            why_en: { type: "STRING", description: "max 160 characters" },
            why_ar: { type: "STRING", description: "Arabic, max 160 characters" },
            model: productModelSchema(),
          },
          required: ["archetype", "thinking", "why_en", "why_ar", "model"],
        },
      },
    },
    required: ["designs"],
  };
}

/** One part as the designer sees it (no ids it could copy into geometry). */
export type DesignerPart = { name: string; category: string; size: [number, number, number]; notes: string[] };

/** The form kit in one compact block: kind(param min–max, …). */
export function formKitText(): string {
  return FORM_KINDS.map((k) => {
    const params = Object.entries(FORM_PARAMS[k] as Record<string, ParamDef>).map(([p, d]) => {
      if (d.t === "num") return `${p} ${d.min}–${d.max}`;
      if (d.t === "enum") return `${p} ${d.values.join("|")}`;
      return `${p} ${d.minPoints}–${d.maxPoints} [r,z] points`;
    });
    return `- ${k}(${params.join(", ")})`;
  }).join("\n");
}

export function designerPrompt(i: {
  spec: ProductSpec;
  brief?: string | null;
  /** The client's complaints about the designs they were shown (regeneration). */
  feedback?: string | null;
  parts: DesignerPart[];
  starts: { archetype: Archetype; model: ProductModel }[];
}): string {
  const s = i.spec;
  const lines = [
    `Product: ${s.name}. ${s.oneLine}`,
    i.brief ? `The client wrote: ${i.brief.slice(0, 600)}` : null,
    i.feedback
      ? `The client saw an earlier set of designs and said what is wrong with them (their words, quoted): ${JSON.stringify(i.feedback.slice(0, 400))}. ` +
        "Make NEW designs that fix these complaints: change the shape, proportions or features they point at, and do not repeat the earlier look. " +
        "Still honour the product description and keep every electronics part below fitting and working."
      : null,
    `Use: ${s.use}${s.placement ? `, placement ${s.placement}` : ""}; size: ${s.sizeHint}; style: ${s.style}; environment: ${s.environment}; power: ${s.power}.`,
    s.features.length ? `Features: ${s.features.join("; ")}.` : null,
    `Inputs: ${s.inputs.join(", ") || "none"}. Outputs: ${s.outputs.join(", ") || "none"}.`,
    "",
    "Electronics that must fit inside (name, category, size w×d×h mm, notes):",
    ...i.parts.slice(0, 20).map((p) => `- ${p.name} (${p.category}, ${p.size.map((n) => Math.round(n)).join("×")})${p.notes.length ? `: ${p.notes.join(", ")}` : ""}`),
    "",
    `Design ${i.starts.length} different product${i.starts.length > 1 ? "s" : ""}, one per archetype below, in this order. ` +
      "Each must look clearly different (different composition, not only colour).",
    ...i.starts.map((st, n) => `Archetype ${n + 1}: ${st.archetype}. Default design to start from:\n${JSON.stringify(st.model)}`),
    "",
    "Form-part kit (kind(params with ranges)):",
    formKitText(),
    `Body roles: ${BODY_ROLES.join(", ")}. Anchors: ${ANCHORS.join(", ")}. Materials: ${PRODUCT_MATERIALS.join(", ")} (resin_clear for light rings and windows, aluminium only for probe prongs).`,
    `Palette: ${COLOURS.join(", ")}. Finishes: ${FINISHES.join(", ")}. Features: ${FEATURE_KINDS.join(", ")}.`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}
