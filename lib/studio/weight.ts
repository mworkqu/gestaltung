// How much a printed part weighs — THE one calculation (F-004).
//
// The tester downloaded the real STLs and weighed them in a slicer: 327 g for a
// plate the Print step called 118 g and the Request page called 50 g. Three
// numbers for one object, because three places each did their own sum:
//   * the kernel / mech builder multiplied the mesh volume by a 0.35 "infill"
//     factor — but a Studio body is already a hollow shell, so the mesh volume
//     IS the plastic that comes out of the nozzle;
//   * the Print step read the BUILT volume, the Request page read a parametric
//     volume guess stored on doc.mech.
// So: grams = mesh volume x material density, from this file only, and the
// printed list the Print step shows is stored on the doc (doc.printed) so the
// Request page and the quote estimate read the same rows.

import type { MATERIALS } from "./schema-enums";

export type WeightMaterial = (typeof MATERIALS)[number];

/** Filament density, g/cm³ (manufacturer figures; PLA 1.24 is what the tester weighed against). */
export const MATERIAL_DENSITY: Record<WeightMaterial, number> = {
  PLA: 1.24,
  PETG: 1.27,
  TPU: 1.21,
};

const density = (m: string): number => MATERIAL_DENSITY[m as WeightMaterial] ?? MATERIAL_DENSITY.PLA;

/**
 * Grams of one printed body from its MESH volume (mm³) and its material.
 * No infill factor: the mesh of a Studio body is the shell that gets printed.
 */
export function gramsFromVolume(volumeMm3: number, material: string = "PLA"): number {
  if (!Number.isFinite(volumeMm3) || volumeMm3 <= 0) return 0;
  return Math.max(1, Math.round((volumeMm3 / 1000) * density(material)));
}

/** One line of the printed list, as the Print step shows it and the doc stores it. */
export type PrintedRow = {
  /** Groups identical parts: same template/role, material AND size. */
  key: string;
  /** Plain name in both languages (the Print step already has them). */
  name: { en: string; ar: string };
  material: string;
  count: number;
  grams: number;
};

/** Sum of a printed list (what "Total: N g" and the quote's printed grams are). */
export function printedGramsOf(rows: readonly Pick<PrintedRow, "grams">[]): number {
  return rows.reduce((g, r) => g + (Number.isFinite(r.grams) ? r.grams : 0), 0);
}

/**
 * Group built bodies into printed rows. `key` must already separate different
 * sizes (F-027: two clips of different lengths are two rows, never one "x 2").
 */
export function groupPrinted(
  items: readonly { key: string; name: { en: string; ar: string }; material: string; grams: number }[],
): PrintedRow[] {
  const rows = new Map<string, PrintedRow>();
  for (const it of items) {
    const row = rows.get(it.key);
    if (row) {
      row.count += 1;
      row.grams += it.grams;
    } else rows.set(it.key, { key: it.key, name: it.name, material: it.material, count: 1, grams: it.grams });
  }
  return [...rows.values()];
}
