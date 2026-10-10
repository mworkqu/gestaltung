// Admin form <-> LibraryPart (P5-15c, /dashboard/studio-library). Pure.
//
// The form keeps every input as a string (what the owner typed); draftToPart()
// turns it into a LibraryPart or a list of field errors with a code each (the
// page shows them in plain words from the StudioLibrary messages). The full
// checks (LibraryPartSchema + validatePart) run afterwards in checkLibraryPart.

import {
  CATEGORIES, FACES, LOOKS, PIN_ROLES, PIN_SIDES, PORT_KINDS,
  type Category, type Face, type LibraryPart, type Look, type PinRole, type PortKind,
} from "../schema";

export type HoleDraft = { x: string; y: string; d: string };
export type PortDraft = { kind: string; face: string; u: string; v: string; w: string; h: string };
export type PinDraft = { id: string; label: string; role: string; voltage: string; side: string };

export type PartDraft = {
  id: string;
  nameEn: string;
  nameAr: string;
  blurbEn: string;
  blurbAr: string;
  category: string;
  tags: string;
  storeSkus: string;
  dimX: string;
  dimY: string;
  dimZ: string;
  lookBody: string;
  lookAccent: string;
  hasMount: boolean;
  holes: HoleDraft[];
  standoffHeight: string;
  ports: PortDraft[];
  pins: PinDraft[];
  vMin: string;
  vMax: string;
  logicV: string;
  mA: string;
  clearance: string;
  helper: boolean;
  modelKind: "procedural" | "stl";
  builder: string;
  params: string;
  stlUrl: string;
  /** Not edited on the form: kept as it was (JSON). */
  requires: string;
};

export type FieldErrorCode =
  | "required" | "id" | "number" | "positive" | "nonnegative" | "unit" | "json" | "choice" | "url" | "duplicate_pin";
export type FieldError = { field: string; code: FieldErrorCode };

export type DraftResult = { ok: true; part: LibraryPart } | { ok: false; errors: FieldError[] };

const s = (n: number | undefined | null) => (n === undefined || n === null ? "" : String(n));

/** "a, b ,, c" → ["a", "b", "c"] (trimmed, empties and repeats dropped). */
export function parseCommaList(v: string): string[] {
  const out: string[] = [];
  for (const raw of v.split(/[,\n،]/)) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** "" → null; "12.5" / " 12,5 " → 12.5; anything else → NaN. */
export function parseNumber(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Builder params: "" → {}; an object → it; anything else → null. */
export function parseParams(v: string): Record<string, unknown> | null {
  const t = v.trim();
  if (!t) return {};
  try {
    const o = JSON.parse(t) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function emptyDraft(): PartDraft {
  return {
    id: "", nameEn: "", nameAr: "", blurbEn: "", blurbAr: "", category: "sensor", tags: "", storeSkus: "",
    dimX: "", dimY: "", dimZ: "", lookBody: "pcb_blue", lookAccent: "", hasMount: false, holes: [], standoffHeight: "3",
    ports: [], pins: [], vMin: "3.3", vMax: "5", logicV: "3.3", mA: "10", clearance: "1", helper: false,
    modelKind: "procedural", builder: "moduleBoard", params: "{}", stlUrl: "", requires: "",
  };
}

export function partToDraft(p: LibraryPart): PartDraft {
  return {
    id: p.id,
    nameEn: p.name.en,
    nameAr: p.name.ar,
    blurbEn: p.blurb.en,
    blurbAr: p.blurb.ar,
    category: p.category,
    tags: p.tags.join(", "),
    storeSkus: p.storeSkus.join(", "),
    dimX: s(p.dims.x),
    dimY: s(p.dims.y),
    dimZ: s(p.dims.z),
    lookBody: p.look.body,
    lookAccent: p.look.accent ?? "",
    hasMount: !!p.mount,
    holes: (p.mount?.holes ?? []).map((h) => ({ x: s(h.x), y: s(h.y), d: s(h.d) })),
    standoffHeight: s(p.mount?.standoffHeight ?? 3),
    ports: p.ports.map((q) => ({ kind: q.kind, face: q.face, u: s(q.at.u), v: s(q.at.v), w: s(q.size.w), h: s(q.size.h) })),
    pins: p.pins.map((q) => ({ id: q.id, label: q.label, role: q.role, voltage: s(q.voltage), side: q.side ?? "" })),
    vMin: s(p.power.vMin),
    vMax: s(p.power.vMax),
    logicV: s(p.power.logicV),
    mA: s(p.power.mA),
    clearance: s(p.clearance),
    helper: !!p.helper,
    modelKind: p.model.kind,
    builder: p.model.kind === "procedural" ? p.model.builder : "moduleBoard",
    params: p.model.kind === "procedural" ? JSON.stringify(p.model.params) : "{}",
    stlUrl: p.model.kind === "stl" ? p.model.url : "",
    requires: p.requires?.length ? JSON.stringify(p.requires) : "",
  };
}

export function draftToPart(d: PartDraft): DraftResult {
  const errors: FieldError[] = [];
  const err = (field: string, code: FieldErrorCode) => errors.push({ field, code });

  const num = (field: string, v: string, rule: "any" | "positive" | "nonnegative" | "unit", required = true): number => {
    const n = parseNumber(v);
    if (n === null) {
      if (required) err(field, "required");
      return 0;
    }
    if (Number.isNaN(n)) {
      err(field, "number");
      return 0;
    }
    if (rule === "positive" && n <= 0) err(field, "positive");
    if (rule === "nonnegative" && n < 0) err(field, "nonnegative");
    if (rule === "unit" && (n < 0 || n > 1)) err(field, "unit");
    return n;
  };
  const text = (field: string, v: string) => {
    const t = v.trim();
    if (!t) err(field, "required");
    return t;
  };
  const pick = <T extends string>(field: string, values: readonly T[], v: string): T => {
    if (!(values as readonly string[]).includes(v)) err(field, "choice");
    return v as T;
  };

  const id = d.id.trim();
  if (!id) err("id", "required");
  else if (!/^[a-z0-9_]+$/.test(id) || id.length > 64) err("id", "id");

  const name = { en: text("nameEn", d.nameEn), ar: text("nameAr", d.nameAr) };
  const blurb = { en: text("blurbEn", d.blurbEn), ar: text("blurbAr", d.blurbAr) };
  const category = pick<Category>("category", CATEGORIES, d.category);
  const dims = { x: num("dimX", d.dimX, "positive"), y: num("dimY", d.dimY, "positive"), z: num("dimZ", d.dimZ, "positive") };
  const body = pick<Look>("lookBody", LOOKS, d.lookBody);
  const accent = d.lookAccent.trim();

  const mount = d.hasMount
    ? {
        holes: d.holes.map((h, i) => ({
          x: num(`holes.${i}.x`, h.x, "any"),
          y: num(`holes.${i}.y`, h.y, "any"),
          d: num(`holes.${i}.d`, h.d, "positive"),
        })),
        standoffHeight: num("standoffHeight", d.standoffHeight, "nonnegative"),
      }
    : null;

  const ports = d.ports.map((p, i) => ({
    kind: pick<PortKind>(`ports.${i}.kind`, PORT_KINDS, p.kind),
    face: pick<Face>(`ports.${i}.face`, FACES, p.face),
    at: { u: num(`ports.${i}.u`, p.u, "unit"), v: num(`ports.${i}.v`, p.v, "unit") },
    size: { w: num(`ports.${i}.w`, p.w, "positive"), h: num(`ports.${i}.h`, p.h, "positive") },
  }));

  const seen = new Set<string>();
  const pins = d.pins.map((p, i) => {
    const pid = text(`pins.${i}.id`, p.id);
    if (pid && seen.has(pid)) err(`pins.${i}.id`, "duplicate_pin");
    seen.add(pid);
    const voltage = parseNumber(p.voltage);
    if (Number.isNaN(voltage)) err(`pins.${i}.voltage`, "number");
    const side = p.side.trim();
    if (side && !(PIN_SIDES as readonly string[]).includes(side)) err(`pins.${i}.side`, "choice");
    return {
      id: pid,
      label: p.label.trim() || pid,
      role: pick<PinRole>(`pins.${i}.role`, PIN_ROLES, p.role),
      ...(voltage !== null && !Number.isNaN(voltage) ? { voltage } : {}),
      ...(side ? { side: side as (typeof PIN_SIDES)[number] } : {}),
    };
  });

  const logic = d.logicV.trim();
  if (logic !== "3.3" && logic !== "5") err("logicV", "choice");
  const power = {
    vMin: num("vMin", d.vMin, "nonnegative"),
    vMax: num("vMax", d.vMax, "nonnegative"),
    logicV: (logic === "5" ? 5 : 3.3) as 3.3 | 5,
    mA: num("mA", d.mA, "nonnegative"),
  };
  const clearance = num("clearance", d.clearance, "nonnegative");

  let model: LibraryPart["model"];
  if (d.modelKind === "stl") {
    const url = d.stlUrl.trim();
    if (!url) err("stlUrl", "required");
    else if (!/^https:\/\/\S+$/.test(url)) err("stlUrl", "url");
    model = { kind: "stl", url };
  } else {
    const params = parseParams(d.params);
    if (!params) err("params", "json");
    if (!d.builder.trim()) err("builder", "required");
    model = { kind: "procedural", builder: d.builder.trim(), params: params ?? {} };
  }

  let requires: LibraryPart["requires"];
  if (d.requires.trim()) {
    try {
      const r = JSON.parse(d.requires) as unknown;
      if (Array.isArray(r)) requires = r as LibraryPart["requires"];
    } catch {
      /* not editable on the form: drop an unreadable value */
    }
  }

  if (errors.length) return { ok: false, errors };
  const part: LibraryPart = {
    id,
    name,
    blurb,
    category,
    storeSkus: parseCommaList(d.storeSkus),
    tags: parseCommaList(d.tags).map((t) => t.toLowerCase()),
    dims,
    model,
    look: accent ? { body, accent } : { body },
    mount,
    ports,
    pins,
    power,
    ...(requires?.length ? { requires } : {}),
    clearance,
    ...(d.helper ? { helper: true } : {}),
  };
  return { ok: true, part };
}

/** validatePart / schema lines without the "<id>:" prefix, for the form. */
export function plainCheck(line: string, id: string): string {
  return line.startsWith(`${id}:`) ? line.slice(id.length + 1).trim() : line;
}
