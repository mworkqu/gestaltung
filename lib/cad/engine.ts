// Which engine builds a 3D model, and the small pure rules around the cloud
// (CadQuery) engine. Pure and client-safe: no server imports.
//
// store_settings.cad_engine (migration 0067) = {"engine": "browser" | "admin" |
// "cloud", "min_wall_mm": 1.2}
//   browser  Gemini writes OpenSCAD and the customer's browser builds it (default)
//   admin    the cloud worker for super_admin only (the owner tests it first)
//   cloud    the cloud worker for everyone
// No row, a malformed value or any read error = browser.

import type { Footprint } from "@/lib/prototyping/footprints";

export type CadEngineMode = "browser" | "admin" | "cloud";
export type CadEngine = "browser" | "cloud";

export const CAD_ENGINE_KEY = "cad_engine";
/** Thinnest wall the worker accepts when the setting does not say (mm). */
export const DEFAULT_MIN_WALL_MM = 1.2;

export type CadEngineSetting = { mode: CadEngineMode; minWallMm: number };
export const DEFAULT_CAD_ENGINE: CadEngineSetting = { mode: "browser", minWallMm: DEFAULT_MIN_WALL_MM };

/** A jsonb value as PostgREST returns it (object), or a JSON string typed in by hand. */
export function parseCadEngineSetting(raw: unknown): CadEngineSetting {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return DEFAULT_CAD_ENGINE;
    }
  }
  if (typeof value !== "object" || value === null) return DEFAULT_CAD_ENGINE;
  const v = value as { engine?: unknown; min_wall_mm?: unknown };
  const mode: CadEngineMode = v.engine === "admin" || v.engine === "cloud" ? v.engine : "browser";
  const wall = Number(v.min_wall_mm);
  const minWallMm = Number.isFinite(wall) && wall > 0 && wall <= 10 ? wall : DEFAULT_MIN_WALL_MM;
  return { mode, minWallMm };
}

/** The engine one caller gets: "admin" mode = cloud for super_admin only. */
export function resolveCadEngine(mode: CadEngineMode, isSuperAdmin: boolean): CadEngine {
  if (mode === "cloud") return "cloud";
  if (mode === "admin" && isSuperAdmin) return "cloud";
  return "browser";
}

/** Stored code that is CadQuery (Python), not OpenSCAD. */
export function isCadQueryCode(code: string | null | undefined): boolean {
  return !!code && /^\s*(import\s+cadquery\b|from\s+cadquery\b)/m.test(code);
}

/**
 * Height (mm) of the space a dev board needs inside its case: board, headers
 * and the usual parts on it. Footprints carry no height; this is the lower,
 * common figure so the fit check can only under-call.
 */
export const BOARD_HEIGHT_MM = 12;

export type Box3 = { x: number; y: number; z: number };

/**
 * The box the enclosure must hold: the largest known board of the project
 * (by area), or null when no board is known. Same footprints as the
 * enclosure-too-small check (audit #5, lib/prototyping/footprints.ts).
 */
export function mustContainBox(boards: readonly Footprint[]): Box3 | null {
  if (!boards.length) return null;
  const main = [...boards].sort((a, b) => b.length_mm * b.width_mm - a.length_mm * a.width_mm)[0];
  return { x: main.length_mm, y: main.width_mm, z: BOARD_HEIGHT_MM };
}

/** Where a cloud version's files live in the cad-files bucket (owner-scoped path). */
export function cloudFilePaths(userId: string, projectId: string, generationId: string) {
  const base = `${userId}/${projectId}/cad/${generationId}`;
  return { step: `${base}.step`, stl: `${base}.stl`, svg: `${base}.svg`, manifest: `${base}.json` };
}

export type CadCheck = { name: string; pass: boolean; detail: string };

/** What a cloud version's manifest (<id>.json) holds. */
export type CloudManifest = {
  engine: "cloud";
  bbox: Box3 | null;
  volumeMm3: number | null;
  checks: CadCheck[];
  log: string;
  minWallMm: number;
  board: { label: string; box: Box3 } | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A manifest read back from storage; anything malformed = null. */
export function parseManifest(raw: unknown): CloudManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.engine !== "cloud") return null;
  const box = (b: unknown): Box3 | null => {
    if (typeof b !== "object" || b === null) return null;
    const o = b as Record<string, unknown>;
    const x = num(o.x), y = num(o.y), z = num(o.z);
    return x !== null && y !== null && z !== null ? { x, y, z } : null;
  };
  const checks = Array.isArray(m.checks)
    ? m.checks
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        .map((c) => ({ name: String(c.name ?? ""), pass: c.pass === true, detail: String(c.detail ?? "") }))
    : [];
  const b = m.board as Record<string, unknown> | null | undefined;
  const boardBox = b ? box(b.box) : null;
  return {
    engine: "cloud",
    bbox: box(m.bbox),
    volumeMm3: num(m.volumeMm3),
    checks,
    log: typeof m.log === "string" ? m.log : "",
    minWallMm: num(m.minWallMm) ?? DEFAULT_MIN_WALL_MM,
    board: b && boardBox ? { label: String(b.label ?? ""), box: boardBox } : null,
  };
}

/**
 * The plain check line a client sees, without check names: does it fit the
 * board (null = no board known), the thinnest wall in mm when the worker
 * reports one, and whether every check passed.
 */
export function clientCheckSummary(m: Pick<CloudManifest, "checks" | "board" | "minWallMm">): {
  fits: boolean | null;
  wallMm: number;
  allPass: boolean;
} {
  const fitCheck = m.checks.find((c) => /contain|fit|board|box/i.test(c.name));
  const wallCheck = m.checks.find((c) => /wall/i.test(c.name));
  const measured = wallCheck ? /(\d+(?:\.\d+)?)\s*mm/i.exec(wallCheck.detail) : null;
  const wallMm = measured ? Number(measured[1]) : m.minWallMm;
  return {
    fits: m.board ? (fitCheck ? fitCheck.pass : null) : null,
    wallMm: Math.round(wallMm * 10) / 10,
    allPass: m.checks.every((c) => c.pass),
  };
}
