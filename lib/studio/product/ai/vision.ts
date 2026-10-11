// The AI vision check (P5-16 steps 4–5). Gemini looks at three renders of the
// solved product (front, side, 3/4 — 512 px PNG, in its scene) plus the idea and
// spec, and answers strict JSON:
//   { score 1–10, looksLike, missing: string[], patches: JsonPatch[] }
// Patches may only touch PATCHABLE_PATHS (product/schema.ts applyPatches): the
// route applies them, re-clamps and re-solves, so the loop can never produce an
// invalid model. Quota / no key → the caller skips the check and keeps the model.
// Every call is metered in ai_usage (feature "studio", step "vision").

import type { ProductSpec } from "../../schema";
import { cut, isObj, type StudioCall } from "../../ai/types";
import { isPatchAllowed, type JsonPatchOp, type ProductModel } from "../schema";

export type VisionImages = { front: string; side: string; iso: string };

export type VisionAnswer = {
  score: number;
  looksLike: string;
  missing: string[];
  /** Only ops on allowed paths, values decoded (applyPatches re-checks everything). */
  patches: JsonPatchOp[];
  /** Ops the model proposed that we dropped (Engineer view). */
  dropped: number;
};

export type VisionResult =
  | { ok: true; value: VisionAnswer; model?: string | null }
  | { ok: false; error: "paused" | "rate_limited" | "unavailable" | "invalid"; problems: string[] };

export const VISION_SYSTEM =
  "You are a strict industrial-design reviewer. You get three renders of a product prototype (front, side, three-quarter view, " +
  "in its scene) and what the client asked for. Judge two things at a glance: " +
  "1) does it LOOK LIKE the product the client described (would a stranger recognise it)? " +
  "2) are ALL functional parts visible (each sensor, outlet, light, button, port, reservoir or tube the parts list needs)? " +
  "Score 1–10 (10 = instantly recognisable and complete; below 7 = needs changes). looksLike: what it looks like now, a few words. " +
  "missing: the functional parts or cues that are missing or hidden, short phrases. " +
  "patches: up to 8 JSON-Patch fixes on the design JSON you are given (op replace | add | remove, path, valueJson = the new value " +
  "encoded as a JSON string). Only change sizes, positions, roles, materials, colours, finishes, features or add/remove bodies " +
  "and links on the allowed paths; never change body ids; sizes are millimetres. If it already scores 7 or more, return no patches. " +
  "Return only the JSON asked for.";

export const visionSchema = {
  type: "OBJECT",
  properties: {
    score: { type: "INTEGER", description: "1–10" },
    looksLike: { type: "STRING", description: "a few words" },
    missing: { type: "ARRAY", items: { type: "STRING" } },
    patches: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          op: { type: "STRING", enum: ["replace", "add", "remove"] },
          path: { type: "STRING", description: "JSON pointer, e.g. /bodies/1/form/w" },
          valueJson: { type: "STRING", description: "the new value as JSON text (omit for remove)" },
        },
        required: ["op", "path"],
      },
    },
  },
  required: ["score", "looksLike", "missing", "patches"],
};

/** The allowed paths in words for the prompt. */
const PATH_HINT =
  "/archetype, /scene, /rationale, /electronicsHost, /bodies/- (add a body), /bodies/N (replace/remove), " +
  "/bodies/N/role|material|colour|finish|wall|shell, /bodies/N/form, /bodies/N/form/<param>, /bodies/N/form/points/K, " +
  "/bodies/N/attach, /bodies/N/attach/to|anchor|offset|rotate, /bodies/N/attach/offset/0..2, /bodies/N/features(/K), " +
  "/links, /links/N, /links/-, /links/N/kind|diameter|colour|from|to";

export function visionPrompt(i: { idea: string; spec: ProductSpec; partNames: string[]; model: ProductModel; loop: number }): string {
  const s = i.spec;
  return [
    `The client's idea: ${i.idea.slice(0, 600)}`,
    `Product: ${s.name}. ${s.oneLine} Use: ${s.use}${s.placement ? ` (${s.placement})` : ""}; size: ${s.sizeHint}.`,
    `Parts inside: ${i.partNames.slice(0, 20).join(", ") || "none"}.`,
    `Question: does this look like a ${s.name} at a glance, and are all its functional parts visible?`,
    "USB / power sockets are cut into the back or the underside (checked by our solver to be reachable), so they are usually out of view: do not count them as missing.",
    `Images in order: front, side, three-quarter view. Check round ${i.loop + 1} of 3.`,
    "The design JSON (patch this):",
    JSON.stringify(i.model),
    `Allowed patch paths: ${PATH_HINT}.`,
  ].join("\n");
}

function decodeValue(p: Record<string, unknown>): { ok: true; value?: unknown } | { ok: false } {
  if (p.op === "remove") return { ok: true };
  if ("value" in p) return { ok: true, value: p.value };
  if (typeof p.valueJson !== "string") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(p.valueJson) };
  } catch {
    // A bare word ("graphite") is a fine string value.
    return /^[A-Za-z0-9_ .-]{1,40}$/.test(p.valueJson) ? { ok: true, value: p.valueJson } : { ok: false };
  }
}

/** Strict reading of the reviewer's JSON. Only a missing / non-numeric score is an error (sent back once). */
export function validateVision(raw: unknown): { value: VisionAnswer | null; errors: string[] } {
  if (!isObj(raw)) return { value: null, errors: ["the answer must be one JSON object"] };
  const n = typeof raw.score === "number" ? raw.score : typeof raw.score === "string" ? Number(raw.score) : NaN;
  if (!Number.isFinite(n)) return { value: null, errors: ["score must be a number from 1 to 10"] };
  const score = Math.max(1, Math.min(10, Math.round(n)));
  const missing = (Array.isArray(raw.missing) ? raw.missing : [])
    .map((m) => cut(m, 80))
    .filter(Boolean)
    .slice(0, 8);
  const patches: JsonPatchOp[] = [];
  let dropped = 0;
  for (const p of (Array.isArray(raw.patches) ? raw.patches : []).slice(0, 12)) {
    if (!isObj(p) || typeof p.path !== "string" || !["replace", "add", "remove"].includes(String(p.op))) {
      dropped++;
      continue;
    }
    const op = p.op as JsonPatchOp["op"];
    if (!isPatchAllowed(op, p.path)) {
      dropped++;
      continue;
    }
    const v = decodeValue(p);
    if (!v.ok) {
      dropped++;
      continue;
    }
    patches.push(op === "remove" ? { op, path: p.path } : { op, path: p.path, value: v.value });
  }
  if (patches.length > 8) dropped += patches.length - 8;
  return { value: { score, looksLike: cut(raw.looksLike, 120), missing, patches: patches.slice(0, 8), dropped }, errors: [] };
}

export async function runVisionCheck(opts: {
  call: StudioCall;
  idea: string;
  spec: ProductSpec;
  partNames: string[];
  model: ProductModel;
  images: VisionImages;
  loop: number;
}): Promise<VisionResult> {
  const r = await opts.call<VisionAnswer>({
    step: "vision",
    system: VISION_SYSTEM,
    prompt: visionPrompt(opts),
    schema: visionSchema,
    validate: validateVision,
    images: [
      { mimeType: "image/png", data: opts.images.front },
      { mimeType: "image/png", data: opts.images.side },
      { mimeType: "image/png", data: opts.images.iso },
    ],
    timeoutMs: 60_000,
  });
  if (r.ok) return { ok: true, value: r.value, model: r.model };
  return { ok: false, error: r.error, problems: r.problems };
}
