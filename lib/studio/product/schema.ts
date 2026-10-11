// ProductModel (P5-16): the real product as a few functional bodies (stake,
// head, reservoir, nozzle, light ring…) built from the form-part kit. This is
// the ONLY thing the AI designs (Phase 2a) and what the vision check patches.
//
// Rules (same as lib/studio/schema.ts):
//  * plain JSON, numbers in mm, Z up, −y = front; no three.js types, so the same
//    JSON can feed the future CadQuery backend unchanged (docs/STUDIO_CAD.md);
//  * the zod schema describes a VALID model; clampProductModel() turns ANY value
//    into one and never throws (bad enums → defaults, numbers clamped, broken
//    references re-attached to the ground, too few bodies padded);
//  * applyPatches() applies a JSON-Patch subset limited to PATCHABLE_PATHS, then
//    clamps again — the vision loop can never produce an invalid model.

import { z } from "zod";
import { COLOURS, FINISHES, clampNum, type ClampLog, type Colour, type Finish } from "../schema";
import { ANCHORS, type Anchor } from "./forms/geometry";
import { FORM_KINDS, FORM_PARAMS, type FormKind, type FormPart, type ParamDef } from "./forms/params";
import { clampForm } from "./forms/clamp";

export { ANCHORS, type Anchor } from "./forms/geometry";
export { FORM_KINDS, type FormKind, type FormPart } from "./forms/params";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ARCHETYPES = [
  "stake_device", "planter_insert", "desk_object", "lamp", "wall_mount", "handheld",
  "wearable_band", "pet_feeder", "dispenser", "vehicle_mount", "outdoor_box", "tabletop_robot",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const SCENES = ["plant_pot", "desk", "wall", "hand", "floor", "car_dash", "outdoor", "pet_bowl"] as const;
export type Scene = (typeof SCENES)[number];

export const BODY_ROLES = [
  "housing", "stake", "reservoir", "lid", "nozzle", "light_ring", "button_cap", "base",
  "clip", "handle", "window", "cover", "bracket",
] as const;
export type BodyRole = (typeof BODY_ROLES)[number];

/** resin_clear = printed in clear resin (light windows); aluminium = a bought metal part (probe pins). */
export const PRODUCT_MATERIALS = ["PLA", "PETG", "TPU", "resin_clear", "aluminium"] as const;
export type ProductMaterial = (typeof PRODUCT_MATERIALS)[number];

export const FEATURE_KINDS = ["grille", "light_slot", "texture_grip", "emboss_label", "drain_holes", "snap_lip", "screw_bosses"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export const LINK_KINDS = ["tube", "cable"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * How a body is hollowed. auto = the solver decides (the electronics host and
 * reservoirs become shells, stacked caps open at the bottom, small parts stay solid).
 */
export const SHELLS = ["auto", "solid", "open_top", "open_bottom", "split"] as const;
export type Shell = (typeof SHELLS)[number];

export const ATTACH_ROOTS = ["ground", "scene"] as const;

export const PRODUCT_LIMITS = {
  bodies: { min: 2, max: 8 },
  links: { max: 4 },
  rationale: { max: 160 },
  offset: { min: -300, max: 300 },
  rotate: { min: -180, max: 180 },
  wall: { min: 1.6, max: 4 },
  linkDiameter: { min: 4, max: 8 },
  features: { max: 6 },
  featureCount: { min: 1, max: 48 },
  bodyId: /^[a-z][a-z0-9_]{0,23}$/,
} as const;

// ---------------------------------------------------------------------------
// zod schemas (built from the form table, so a range lives in one place)
// ---------------------------------------------------------------------------

function paramSchema(d: ParamDef): z.ZodType {
  if (d.t === "num") return d.int ? z.number().int().min(d.min).max(d.max) : z.number().min(d.min).max(d.max);
  if (d.t === "enum") return z.enum(d.values as [string, ...string[]]);
  return z
    .array(z.tuple([z.number().min(0).max(d.rMax), z.number().min(0).max(d.zMax)]))
    .min(d.minPoints)
    .max(d.maxPoints);
}

function formSchemaOf(kind: FormKind) {
  const shape: Record<string, z.ZodType> = { kind: z.literal(kind) };
  for (const [k, d] of Object.entries(FORM_PARAMS[kind] as Record<string, ParamDef>)) shape[k] = paramSchema(d);
  return z.object(shape);
}

export const FormPartSchema = z.discriminatedUnion(
  "kind",
  FORM_KINDS.map(formSchemaOf) as unknown as [ReturnType<typeof formSchemaOf>, ...ReturnType<typeof formSchemaOf>[]],
) as unknown as z.ZodType<FormPart>;

const Vec3Schema = (min: number, max: number) => z.tuple([z.number().min(min).max(max), z.number().min(min).max(max), z.number().min(min).max(max)]);

export const AttachSchema = z.object({
  /** A body id, "ground" (stands on the scene's ground / soil) or "scene" (scene floor / wall). */
  to: z.string().min(1).max(24),
  anchor: z.enum(ANCHORS),
  offset: Vec3Schema(PRODUCT_LIMITS.offset.min, PRODUCT_LIMITS.offset.max),
  rotate: Vec3Schema(PRODUCT_LIMITS.rotate.min, PRODUCT_LIMITS.rotate.max).optional(),
});
export type Attach = z.infer<typeof AttachSchema>;

export const FeatureSchema = z.object({
  kind: z.enum(FEATURE_KINDS),
  face: z.enum(ANCHORS).optional(),
  count: z.number().int().min(PRODUCT_LIMITS.featureCount.min).max(PRODUCT_LIMITS.featureCount.max).optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const BodySchema = z.object({
  id: z.string().regex(PRODUCT_LIMITS.bodyId),
  role: z.enum(BODY_ROLES),
  form: FormPartSchema,
  attach: AttachSchema,
  material: z.enum(PRODUCT_MATERIALS),
  colour: z.enum(COLOURS),
  finish: z.enum(FINISHES),
  features: z.array(FeatureSchema).max(PRODUCT_LIMITS.features.max).optional(),
  /** Shell wall (mm) when hollowed; default 2. */
  wall: z.number().min(PRODUCT_LIMITS.wall.min).max(PRODUCT_LIMITS.wall.max).optional(),
  shell: z.enum(SHELLS).optional(),
});
export type Body = z.infer<typeof BodySchema>;

export const LinkEndSchema = z.object({ body: z.string(), anchor: z.enum(ANCHORS) });
export const LinkSchema = z.object({
  kind: z.enum(LINK_KINDS),
  from: LinkEndSchema,
  to: LinkEndSchema,
  diameter: z.number().min(PRODUCT_LIMITS.linkDiameter.min).max(PRODUCT_LIMITS.linkDiameter.max),
  colour: z.enum(COLOURS),
});
export type Link = z.infer<typeof LinkSchema>;

export const ProductModelSchema = z.object({
  archetype: z.enum(ARCHETYPES),
  scene: z.enum(SCENES),
  /** "Why this design" (one line, shown to the client). */
  rationale: z.string().max(PRODUCT_LIMITS.rationale.max),
  bodies: z.array(BodySchema).min(PRODUCT_LIMITS.bodies.min).max(PRODUCT_LIMITS.bodies.max),
  /** Id of the body holding the PCB stack. */
  electronicsHost: z.string(),
  links: z.array(LinkSchema).max(PRODUCT_LIMITS.links.max),
});
export type ProductModel = z.infer<typeof ProductModelSchema>;

/** The scene each archetype is shown in by default. */
export const ARCHETYPE_SCENE: Record<Archetype, Scene> = {
  stake_device: "plant_pot",
  planter_insert: "plant_pot",
  desk_object: "desk",
  lamp: "desk",
  wall_mount: "wall",
  handheld: "hand",
  wearable_band: "hand",
  pet_feeder: "pet_bowl",
  dispenser: "desk",
  vehicle_mount: "car_dash",
  outdoor_box: "outdoor",
  tabletop_robot: "desk",
};

// ---------------------------------------------------------------------------
// Clamp
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pick<T extends string>(values: readonly T[], v: unknown, fallback: T, path: string, log: ClampLog, caseSensitive = false): T {
  if (typeof v === "string") {
    const s = v.trim();
    const norm = s.toLowerCase().replace(/[\s-]+/g, "_");
    const hit = caseSensitive
      ? values.find((x) => x.toLowerCase() === s.toLowerCase())
      : values.find((x) => x === s) ?? values.find((x) => x === norm);
    if (hit) {
      if (hit !== v) log.push({ path, from: v, to: hit });
      return hit;
    }
  }
  if (v !== undefined) log.push({ path, from: v, to: fallback });
  return fallback;
}

function clampVec(v: unknown, min: number, max: number, path: string, log: ClampLog): [number, number, number] {
  const a = Array.isArray(v) ? v : [];
  if (!Array.isArray(v) && v !== undefined) log.push({ path, from: v, to: [0, 0, 0] });
  return [0, 1, 2].map((i) => (a[i] === undefined ? 0 : clampNum(a[i], min, max, 0, `${path}[${i}]`, log))) as [number, number, number];
}

function sanitizeId(v: unknown, fallback: string): string {
  let s = typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") : "";
  if (!s) s = fallback;
  if (!/^[a-z]/.test(s)) s = `b_${s}`;
  return s.slice(0, 24);
}

function defaultMaterial(role: BodyRole, form: FormPart): ProductMaterial {
  if (form.kind === "prongs") return "aluminium";
  if (role === "light_ring" || role === "window") return "resin_clear";
  if (role === "reservoir") return "PETG";
  return "PLA";
}

function clampFeature(v: unknown, path: string, log: ClampLog): Feature | null {
  if (!isObj(v)) {
    log.push({ path, from: v, to: null });
    return null;
  }
  if (typeof v.kind !== "string" || !(FEATURE_KINDS as readonly string[]).includes(v.kind.trim().toLowerCase())) {
    log.push({ path: `${path}.kind`, from: v.kind, to: null });
    return null;
  }
  const out: Feature = { kind: v.kind.trim().toLowerCase() as FeatureKind };
  if (v.face !== undefined && v.face !== null) out.face = pick(ANCHORS, v.face, "front", `${path}.face`, log);
  if (v.count !== undefined && v.count !== null) {
    out.count = clampNum(v.count, PRODUCT_LIMITS.featureCount.min, PRODUCT_LIMITS.featureCount.max, 8, `${path}.count`, log, { int: true });
  }
  return out;
}

/** One body (attach.to is checked later, once every id is known). */
export function clampBody(input: unknown, idx: number, log: ClampLog = []): Body {
  const path = `bodies[${idx}]`;
  const o = isObj(input) ? input : {};
  if (!isObj(input)) log.push({ path, from: input, to: "default" });
  const role = pick(BODY_ROLES, o.role, "housing", `${path}.role`, log);
  const form = clampForm(o.form, log, `${path}.form`);
  const a = isObj(o.attach) ? o.attach : {};
  if (!isObj(o.attach)) log.push({ path: `${path}.attach`, from: o.attach, to: "ground" });
  const to = typeof a.to === "string" && a.to.trim() ? a.to.trim() : "ground";
  const attach: Attach = {
    to: (ATTACH_ROOTS as readonly string[]).includes(to.toLowerCase()) ? to.toLowerCase() : sanitizeId(to, "ground"),
    anchor: pick(ANCHORS, a.anchor, "top", `${path}.attach.anchor`, log),
    offset: clampVec(a.offset, PRODUCT_LIMITS.offset.min, PRODUCT_LIMITS.offset.max, `${path}.attach.offset`, log),
  };
  if (a.rotate !== undefined && a.rotate !== null) {
    const rot = clampVec(a.rotate, PRODUCT_LIMITS.rotate.min, PRODUCT_LIMITS.rotate.max, `${path}.attach.rotate`, log);
    if (rot.some((x) => x !== 0)) attach.rotate = rot;
  }
  const material = pick(PRODUCT_MATERIALS, o.material, defaultMaterial(role, form), `${path}.material`, log, true);
  const body: Body = {
    id: sanitizeId(o.id, `${role}_${idx + 1}`),
    role,
    form,
    attach,
    material,
    colour: pick(COLOURS, o.colour, material === "resin_clear" ? "mist" : "chalk", `${path}.colour`, log) as Colour,
    finish: pick(FINISHES, o.finish, material === "resin_clear" ? "glossy_plastic" : "matte_plastic", `${path}.finish`, log) as Finish,
  };
  if (Array.isArray(o.features)) {
    const feats = o.features
      .slice(0, PRODUCT_LIMITS.features.max)
      .map((f, j) => clampFeature(f, `${path}.features[${j}]`, log))
      .filter((f): f is Feature => f !== null);
    if (feats.length) body.features = feats;
  } else if (o.features !== undefined) log.push({ path: `${path}.features`, from: o.features, to: [] });
  if (o.wall !== undefined && o.wall !== null) body.wall = clampNum(o.wall, PRODUCT_LIMITS.wall.min, PRODUCT_LIMITS.wall.max, 2, `${path}.wall`, log);
  if (o.shell !== undefined && o.shell !== null) body.shell = pick(SHELLS, o.shell, "auto", `${path}.shell`, log);
  return body;
}

/** Bodies used to pad a model that has fewer than 2. */
function padBodies(existing: Body[]): Body[] {
  const out = [...existing];
  const ids = new Set(out.map((b) => b.id));
  const fresh = (base: string) => {
    let id = base;
    let n = 2;
    while (ids.has(id)) id = `${base}_${n++}`;
    ids.add(id);
    return id;
  };
  if (out.length === 0) {
    out.push(clampBody({ id: fresh("housing"), role: "housing", form: { kind: "rounded_extrude", w: 80, d: 60, h: 30, r: 12, fillet: 3 }, attach: { to: "ground", anchor: "top" } }, 0));
  }
  while (out.length < PRODUCT_LIMITS.bodies.min) {
    const host = out[0];
    out.push(clampBody({ id: fresh("lid"), role: "lid", form: { kind: "rounded_extrude", w: 80, d: 60, h: 8, r: 12, fillet: 3 }, attach: { to: host.id, anchor: "top" } }, out.length));
  }
  return out;
}

/** Any value → a valid ProductModel. Never throws. */
export function clampProductModel(input: unknown, log: ClampLog = []): ProductModel {
  const o = isObj(input) ? input : {};
  if (!isObj(input)) log.push({ path: "product", from: input, to: "default" });
  const archetype = pick(ARCHETYPES, o.archetype, "desk_object", "archetype", log);
  const scene = pick(SCENES, o.scene, ARCHETYPE_SCENE[archetype], "scene", log);
  let rationale = typeof o.rationale === "string" ? o.rationale.replace(/\s+/g, " ").trim() : "";
  if (rationale.length > PRODUCT_LIMITS.rationale.max) {
    log.push({ path: "rationale", from: rationale, to: rationale.slice(0, PRODUCT_LIMITS.rationale.max) });
    rationale = rationale.slice(0, PRODUCT_LIMITS.rationale.max).trim();
  }

  const rawBodies = Array.isArray(o.bodies) ? o.bodies : [];
  if (!Array.isArray(o.bodies)) log.push({ path: "bodies", from: o.bodies, to: [] });
  if (rawBodies.length > PRODUCT_LIMITS.bodies.max) log.push({ path: "bodies", from: rawBodies.length, to: PRODUCT_LIMITS.bodies.max });
  let bodies = rawBodies.slice(0, PRODUCT_LIMITS.bodies.max).map((b, i) => clampBody(b, i, log));
  // Unique ids.
  const seen = new Set<string>();
  for (const b of bodies) {
    let id = b.id;
    let n = 2;
    while (seen.has(id)) id = `${b.id.slice(0, 21)}_${n++}`;
    if (id !== b.id) log.push({ path: `bodies.${b.id}.id`, from: b.id, to: id });
    b.id = id;
    seen.add(id);
  }
  if (bodies.length < PRODUCT_LIMITS.bodies.min) {
    log.push({ path: "bodies", from: bodies.length, to: PRODUCT_LIMITS.bodies.min });
    bodies = padBodies(bodies);
  }
  resolveAttachments(bodies, log);

  const ids = new Set(bodies.map((b) => b.id));
  let electronicsHost = typeof o.electronicsHost === "string" ? o.electronicsHost.trim() : "";
  if (!ids.has(electronicsHost)) {
    const host = bodies.find((b) => b.role === "housing") ?? bodies.find((b) => ["lathe_profile", "rounded_extrude", "loft_rounded", "enclosure"].includes(b.form.kind)) ?? bodies[0];
    log.push({ path: "electronicsHost", from: o.electronicsHost, to: host.id });
    electronicsHost = host.id;
  }

  const links: Link[] = [];
  const rawLinks = Array.isArray(o.links) ? o.links : [];
  if (o.links !== undefined && !Array.isArray(o.links)) log.push({ path: "links", from: o.links, to: [] });
  rawLinks.slice(0, PRODUCT_LIMITS.links.max).forEach((l, i) => {
    const path = `links[${i}]`;
    if (!isObj(l)) {
      log.push({ path, from: l, to: null });
      return;
    }
    const end = (e: unknown, p: string) => {
      const x = isObj(e) ? e : {};
      const body = typeof x.body === "string" ? x.body.trim() : "";
      return { body, anchor: pick(ANCHORS, x.anchor, "top", `${p}.anchor`, log) as Anchor };
    };
    const from = end(l.from, `${path}.from`);
    const to = end(l.to, `${path}.to`);
    if (!ids.has(from.body) || !ids.has(to.body) || from.body === to.body) {
      log.push({ path, from: l, to: null });
      return;
    }
    links.push({
      kind: pick(LINK_KINDS, l.kind, "tube", `${path}.kind`, log),
      from,
      to,
      diameter: clampNum(l.diameter, PRODUCT_LIMITS.linkDiameter.min, PRODUCT_LIMITS.linkDiameter.max, 6, `${path}.diameter`, log),
      colour: pick(COLOURS, l.colour, "mist", `${path}.colour`, log) as Colour,
    });
  });
  if (rawLinks.length > PRODUCT_LIMITS.links.max) log.push({ path: "links", from: rawLinks.length, to: PRODUCT_LIMITS.links.max });

  return { archetype, scene, rationale, bodies, electronicsHost, links };
}

/**
 * attach.to must name another body (or ground / scene), and following parents must
 * end at ground / scene (no cycles). Broken links are re-attached to the ground.
 */
function resolveAttachments(bodies: Body[], log: ClampLog): void {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const b of bodies) {
    const to = b.attach.to;
    if ((ATTACH_ROOTS as readonly string[]).includes(to)) continue;
    if (to === b.id || !byId.has(to)) {
      log.push({ path: `bodies.${b.id}.attach.to`, from: to, to: "ground" });
      b.attach.to = "ground";
    }
  }
  for (const b of bodies) {
    const seen = new Set<string>([b.id]);
    let cur = b.attach.to;
    while (byId.has(cur)) {
      if (seen.has(cur)) {
        log.push({ path: `bodies.${b.id}.attach.to`, from: b.attach.to, to: "ground" });
        b.attach.to = "ground";
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)!.attach.to;
    }
  }
}

// ---------------------------------------------------------------------------
// JSON Patch subset (the vision loop's fixes)
// ---------------------------------------------------------------------------

export type JsonPatchOp = { op: "replace" | "add" | "remove"; path: string; value?: unknown };

type Op = JsonPatchOp["op"];
const N = "(\\d+)";
const FORM_PARAM_KEYS = [...new Set(Object.values(FORM_PARAMS).flatMap((p) => Object.keys(p)))].join("|");

/**
 * Every path the vision loop may change, with the ops allowed there. Body ids, and
 * anything not listed (unknown keys), can never be patched.
 */
export const PATCHABLE_PATHS: readonly { pattern: RegExp; ops: readonly Op[] }[] = [
  { pattern: /^\/(archetype|scene|rationale|electronicsHost)$/, ops: ["replace"] },
  { pattern: /^\/bodies\/-$/, ops: ["add"] },
  { pattern: new RegExp(`^/bodies/${N}$`), ops: ["replace", "remove", "add"] },
  { pattern: new RegExp(`^/bodies/${N}/(role|material|colour|finish)$`), ops: ["replace"] },
  { pattern: new RegExp(`^/bodies/${N}/(wall|shell)$`), ops: ["replace", "add", "remove"] },
  { pattern: new RegExp(`^/bodies/${N}/form$`), ops: ["replace"] },
  { pattern: new RegExp(`^/bodies/${N}/form/(${FORM_PARAM_KEYS})$`), ops: ["replace", "add"] },
  { pattern: new RegExp(`^/bodies/${N}/form/points/${N}$`), ops: ["replace", "add", "remove"] },
  { pattern: new RegExp(`^/bodies/${N}/form/points/${N}/(0|1)$`), ops: ["replace"] },
  { pattern: new RegExp(`^/bodies/${N}/attach$`), ops: ["replace"] },
  { pattern: new RegExp(`^/bodies/${N}/attach/(to|anchor|offset)$`), ops: ["replace"] },
  { pattern: new RegExp(`^/bodies/${N}/attach/rotate$`), ops: ["replace", "add", "remove"] },
  { pattern: new RegExp(`^/bodies/${N}/attach/(offset|rotate)/(0|1|2)$`), ops: ["replace"] },
  { pattern: new RegExp(`^/bodies/${N}/features$`), ops: ["replace", "add", "remove"] },
  { pattern: new RegExp(`^/bodies/${N}/features/(${N.slice(1, -1)}|-)$`), ops: ["replace", "add", "remove"] },
  { pattern: new RegExp(`^/bodies/${N}/features/${N}/(kind|face|count)$`), ops: ["replace", "add", "remove"] },
  { pattern: /^\/links$/, ops: ["replace"] },
  { pattern: new RegExp(`^/links/(${N.slice(1, -1)}|-)$`), ops: ["replace", "add", "remove"] },
  { pattern: new RegExp(`^/links/${N}/(kind|diameter|colour|from|to)$`), ops: ["replace"] },
  { pattern: new RegExp(`^/links/${N}/(from|to)/(body|anchor)$`), ops: ["replace"] },
];

export function isPatchAllowed(op: Op, path: string): boolean {
  return PATCHABLE_PATHS.some((p) => p.pattern.test(path) && p.ops.includes(op));
}

function parsePointer(path: string): string[] | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  return path
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** Apply one op to a plain JSON value in place. Returns an error string or null. */
function applyOne(doc: Record<string, unknown>, p: JsonPatchOp): string | null {
  const parts = parsePointer(p.path);
  if (!parts || parts.length === 0) return "bad_path";
  let parent: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (Array.isArray(parent)) parent = parent[Number(k)];
    else if (isObj(parent)) parent = parent[k];
    else return "missing_parent";
    if (parent === undefined) return "missing_parent";
  }
  const key = parts[parts.length - 1];
  if (Array.isArray(parent)) {
    if (key === "-") {
      if (p.op !== "add") return "bad_op";
      parent.push(structuredClone(p.value));
      return null;
    }
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0) return "bad_index";
    if (p.op === "add") {
      if (idx > parent.length) return "bad_index";
      parent.splice(idx, 0, structuredClone(p.value));
    } else if (idx >= parent.length) return "missing";
    else if (p.op === "remove") parent.splice(idx, 1);
    else parent[idx] = structuredClone(p.value);
    return null;
  }
  if (!isObj(parent)) return "missing_parent";
  if (p.op === "remove") {
    if (!(key in parent)) return "missing";
    delete parent[key];
    return null;
  }
  if (p.op === "replace" && !(key in parent)) return "missing";
  parent[key] = structuredClone(p.value);
  return null;
}

export type PatchResult = {
  model: ProductModel;
  applied: number;
  rejected: { patch: unknown; reason: string }[];
  log: ClampLog;
};

/**
 * Apply a JSON-Patch subset (replace / add / remove) to a model. Each op must target a
 * PATCHABLE_PATHS entry; an op that fails, or that would leave fewer than 2 or more than
 * 8 bodies, is skipped (listed in `rejected`). The result is clamped again, so it is
 * always a valid ProductModel. Never throws.
 */
export function applyPatches(model: ProductModel, patches: unknown): PatchResult {
  const log: ClampLog = [];
  const rejected: PatchResult["rejected"] = [];
  let doc = structuredClone(model) as unknown as Record<string, unknown>;
  let applied = 0;
  const list = Array.isArray(patches) ? patches : [];
  if (!Array.isArray(patches)) rejected.push({ patch: patches, reason: "not_a_list" });
  for (const raw of list.slice(0, 40)) {
    if (!isObj(raw) || typeof raw.op !== "string" || typeof raw.path !== "string") {
      rejected.push({ patch: raw, reason: "malformed" });
      continue;
    }
    const op = raw.op as Op;
    if (!["replace", "add", "remove"].includes(op)) {
      rejected.push({ patch: raw, reason: "op_not_allowed" });
      continue;
    }
    if (!isPatchAllowed(op, raw.path)) {
      rejected.push({ patch: raw, reason: "path_not_allowed" });
      continue;
    }
    if (op !== "remove" && !("value" in raw)) {
      rejected.push({ patch: raw, reason: "missing_value" });
      continue;
    }
    const next = structuredClone(doc);
    const err = applyOne(next, { op, path: raw.path, value: raw.value });
    if (err) {
      rejected.push({ patch: raw, reason: err });
      continue;
    }
    const n = Array.isArray(next.bodies) ? next.bodies.length : 0;
    if (n < PRODUCT_LIMITS.bodies.min || n > PRODUCT_LIMITS.bodies.max) {
      rejected.push({ patch: raw, reason: "body_count" });
      continue;
    }
    doc = next;
    applied += 1;
  }
  return { model: clampProductModel(doc, log), applied, rejected, log };
}

/** Parse a stored value (projects.studio.product); anything unreadable → null. */
export function parseProductModel(v: unknown): ProductModel | null {
  const r = ProductModelSchema.safeParse(v);
  return r.success ? r.data : null;
}
