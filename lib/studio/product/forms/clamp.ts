// Any value → a valid FormPart (never throws). Numbers are clamped to the
// ranges in params.ts, bad enums fall back to the default, and the few rules
// that tie two parameters together (a corner radius never larger than half the
// side, a fillet never larger than half the height…) are applied after. Every
// change goes to the ClampLog (admin only, never shown to clients).

import { clampNum, type ClampLog } from "../../schema";
import { FORM_KINDS, FORM_PARAMS, PROFILE_LIMITS, defaultForm, type FormKind, type FormPart, type ParamDef, type ProfileParam } from "./params";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pickKind(v: unknown, path: string, log: ClampLog): FormKind {
  if (typeof v === "string") {
    const norm = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const hit = (FORM_KINDS as readonly string[]).find((k) => k === norm);
    if (hit) {
      if (hit !== v) log.push({ path, from: v, to: hit });
      return hit as FormKind;
    }
  }
  log.push({ path, from: v, to: "rounded_extrude" });
  return "rounded_extrude";
}

function pickEnum(values: readonly string[], v: unknown, def: string, path: string, log: ClampLog): string {
  if (typeof v === "string") {
    const norm = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const hit = values.find((x) => x === norm);
    if (hit) {
      if (hit !== v) log.push({ path, from: v, to: hit });
      return hit;
    }
  }
  if (v !== undefined) log.push({ path, from: v, to: def });
  return def;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A lathe profile: 3–8 [r, z] points, r ∈ [0, rMax], z ∈ [0, zMax], the first point on
 * z = 0 with a real base (r ≥ 4), z never going down, at least 4 mm tall. Anything that
 * cannot be repaired → the default profile.
 */
export function clampProfile(v: unknown, def: ProfileParam, path: string, log: ClampLog): [number, number][] {
  const fallback = () => {
    log.push({ path, from: v, to: "default" });
    return def.def.map(([r, z]) => [r, z] as [number, number]);
  };
  if (!Array.isArray(v)) return fallback();
  const pts: [number, number][] = [];
  for (const p of v) {
    let r: unknown;
    let z: unknown;
    if (Array.isArray(p)) [r, z] = p;
    else if (isObj(p)) ({ r, z } = p as { r?: unknown; z?: unknown });
    const rn = typeof r === "number" ? r : Number(r);
    const zn = typeof z === "number" ? z : Number(z);
    if (!Number.isFinite(rn) || !Number.isFinite(zn)) continue;
    pts.push([rn, zn]);
  }
  if (pts.length < def.minPoints) return fallback();
  let changed = pts.length !== v.length;
  if (pts.length > def.maxPoints) {
    pts.length = def.maxPoints;
    changed = true;
  }
  let prevZ = 0;
  for (let i = 0; i < pts.length; i++) {
    let [r, z] = pts[i];
    const r0 = r;
    const z0 = z;
    r = Math.min(def.rMax, Math.max(0, r));
    z = i === 0 ? 0 : Math.min(def.zMax, Math.max(prevZ, z));
    if (r !== r0 || z !== z0) changed = true;
    pts[i] = [round3(r), round3(z)];
    prevZ = z;
  }
  if (pts[0][0] < 4) {
    pts[0][0] = 4;
    changed = true;
  }
  if (pts[pts.length - 1][1] < 4 || Math.max(...pts.map((p) => p[0])) < 4) return fallback();
  if (changed) log.push({ path, from: v, to: pts });
  return pts;
}

/** Any value → a valid FormPart. `path` prefixes log entries (e.g. "bodies[2].form"). */
export function clampForm(input: unknown, log: ClampLog = [], path = "form"): FormPart {
  const o = isObj(input) ? input : {};
  if (!isObj(input)) log.push({ path, from: input, to: "default" });
  const kind = pickKind(o.kind, `${path}.kind`, log);
  const defs = FORM_PARAMS[kind] as Record<string, ParamDef>;
  const out: Record<string, unknown> = { ...defaultForm(kind) };
  for (const [k, d] of Object.entries(defs)) {
    const p = `${path}.${k}`;
    if (d.t === "num") out[k] = o[k] === undefined ? d.def : clampNum(o[k], d.min, d.max, d.def, p, log, { int: d.int });
    else if (d.t === "enum") out[k] = pickEnum(d.values, o[k], d.def, p, log);
    else out[k] = o[k] === undefined ? d.def.map(([r, z]) => [r, z]) : clampProfile(o[k], d, p, log);
  }
  return relate(out as FormPart, log, path);
}

/** Rules between parameters (applied after each one is in range). */
function relate(f: FormPart, log: ClampLog, path: string): FormPart {
  const cap = (key: string, max: number, min = 0) => {
    const rec = f as unknown as Record<string, number>;
    const v = rec[key];
    const m = Math.max(min, max);
    if (v > m + 1e-9) {
      log.push({ path: `${path}.${key}`, from: v, to: round3(m) });
      rec[key] = round3(m);
    }
  };
  switch (f.kind) {
    case "rounded_extrude": {
      const side = Math.min(f.w, f.d);
      cap("r", side / 2 - 0.01, 1);
      cap("fillet", Math.min(f.h / 2, side / 2 - 0.5), 1);
      break;
    }
    case "loft_rounded": {
      const side = Math.min(f.w0, f.d0, f.w1, f.d1);
      cap("r", side / 2 - 0.01, 1);
      cap("fillet", Math.min(f.h / 2, side / 2 - 0.5), 1);
      // The top never leans past the bottom's half depth (keeps the loft printable).
      const s = f.d0 / 2;
      if (Math.abs(f.shiftY) > s) {
        const to = round3(Math.sign(f.shiftY) * s);
        log.push({ path: `${path}.shiftY`, from: f.shiftY, to });
        f.shiftY = to;
      }
      break;
    }
    case "stake":
      cap("thick", f.width, 2.6);
      break;
    case "ring":
      cap("r", Math.min(f.w, f.d) / 2 - 0.01, 1);
      break;
    case "tank":
      cap("r", Math.min(f.w, f.d) / 2 - 0.01, 2);
      cap("lidH", f.h / 3, 4);
      break;
    case "grille_disc":
      cap("hole", f.pitch - 1.2, 1.2);
      break;
    case "hook":
      cap("t", f.w, 2);
      break;
    case "hinge_lid":
      cap("r", Math.min(f.w, f.d) / 2 - 0.01, 1);
      break;
    case "enclosure":
      cap("r", 0.33 * Math.min(f.w, f.d), 3);
      cap("fillet", Math.min(f.r, f.h / 3), 1);
      break;
    case "nozzle":
      cap("bore", f.d - 2 * 1.2, 1.5);
      break;
    default:
      break;
  }
  return f;
}

export { PROFILE_LIMITS };
