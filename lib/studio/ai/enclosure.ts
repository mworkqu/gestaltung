// Enclosure look. Pure orchestration around an injected StudioCall.
//
// The model only fills EnclosureSpec (template + a few options); the browser
// builds the mesh deterministically. Enum mistakes are sent back once; numbers
// out of range are clamped quietly (clampEnclosure). Two failures → the caller's
// default (templateFor(spec) when it exists, else DEFAULT_ENCLOSURE).

import {
  COLOURS, DEFAULT_ENCLOSURE, ENCLOSURE_TEMPLATES, FEET, FINISHES, LIDS, clampEnclosure,
  type ClampLog, type EnclosureSpec, type EnclosureTemplate, type ProductSpec,
} from "../schema";
import { AI_TEMPLATES, ENCLOSURE_SYSTEM, enclosurePrompt, enclosureSchema } from "./prompts";
import { isObj, type Outcome, type StudioCall } from "./types";

export type Bbox = { w: number; d: number; h: number };

function enumError(field: string, v: unknown, allowed: readonly string[]): string | null {
  return typeof v === "string" && allowed.includes(v) ? null : `${field} must be one of: ${allowed.join(", ")}`;
}

/** True when `a` and `b` would look the same to the user (same template AND colour). */
export const sameLook = (a: EnclosureSpec, b: EnclosureSpec) => a.template === b.template && a.colour === b.colour;

export function validateEnclosure(
  raw: unknown,
  opts: { templates: readonly EnclosureTemplate[]; bbox: Bbox; previous: readonly EnclosureSpec[]; log: ClampLog },
): { value: EnclosureSpec | null; errors: string[] } {
  if (!isObj(raw)) return { value: null, errors: ["the answer must be one EnclosureSpec JSON object"] };
  const errors = [
    enumError("template", raw.template, opts.templates),
    enumError("lid", raw.lid, LIDS),
    enumError("feet", raw.feet, FEET),
    enumError("finish", raw.finish, FINISHES),
    enumError("colour", raw.colour, COLOURS),
  ].filter((e): e is string => !!e);
  if (errors.length) return { value: null, errors };
  const value = clampEnclosure(raw, opts.log, { templates: opts.templates, footprint: { w: opts.bbox.w, d: opts.bbox.d } });
  if (opts.previous.some((p) => sameLook(p, value)))
    return { value: null, errors: ["this look was already shown: choose a different template or a different colour"] };
  return { value, errors: [] };
}

export function safeBbox(input: unknown): Bbox {
  const o = isObj(input) ? input : {};
  const n = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(400, Math.max(10, v)) : def);
  return { w: n(o.w, 60), d: n(o.d, 40), h: n(o.h, 25) };
}

/** Default look when the model fails: the caller's, made valid, and different from earlier looks when possible. */
export function defaultEnclosure(
  base: EnclosureSpec,
  opts: { templates: readonly EnclosureTemplate[]; bbox: Bbox; previous: readonly EnclosureSpec[] },
): EnclosureSpec {
  const value = clampEnclosure(base, [], { templates: opts.templates, footprint: { w: opts.bbox.w, d: opts.bbox.d } });
  if (!opts.previous.some((p) => sameLook(p, value))) return value;
  const colour = COLOURS.find((c) => !opts.previous.some((p) => p.template === value.template && p.colour === c));
  return colour ? { ...value, colour } : value;
}

export async function runEnclosure(opts: {
  call: StudioCall;
  spec: ProductSpec;
  components: { name: string; category: string }[];
  bbox: Bbox;
  templates?: readonly EnclosureTemplate[];
  previous?: readonly EnclosureSpec[];
  /** templateFor(spec) when lib/studio/enclosure/templates.ts provides it. */
  fallback?: EnclosureSpec;
}): Promise<Outcome<EnclosureSpec>> {
  const templates = (opts.templates ?? AI_TEMPLATES).filter((t) => (ENCLOSURE_TEMPLATES as readonly string[]).includes(t));
  const previous = opts.previous ?? [];
  const log: ClampLog = [];
  const r = await opts.call<EnclosureSpec>({
    step: "enclosure",
    system: ENCLOSURE_SYSTEM,
    prompt: enclosurePrompt({ spec: opts.spec, components: opts.components.slice(0, 20), bbox: opts.bbox, templates, previous: [...previous] }),
    schema: enclosureSchema(templates),
    validate: (raw) => {
      const attempt: ClampLog = [];
      const res = validateEnclosure(raw, { templates, bbox: opts.bbox, previous, log: attempt });
      if (res.value) log.splice(0, log.length, ...attempt);
      return res;
    },
  });
  if (r.ok) return { ok: true, value: r.value, source: "model", clampLog: log, problems: [], model: r.model };
  if (r.error === "paused" || r.error === "rate_limited") return { ok: false, error: r.error, clampLog: log, problems: r.problems };
  const value = defaultEnclosure(opts.fallback ?? DEFAULT_ENCLOSURE, { templates, bbox: opts.bbox, previous });
  return { ok: true, value, source: "default", clampLog: [], problems: r.problems };
}
