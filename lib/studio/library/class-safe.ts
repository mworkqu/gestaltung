// Safety mode for class projects (3d). Teams are 12–15 years old and work with
// an adult nearby, so a class project may only use parts that run at 5 V or
// less from a USB supply or an AA/AAA holder. Nothing mains-powered, no bare
// lithium cell, no charger, no converter that expects more than 5 V in, and
// nothing that draws more current than a USB port or a battery holder can give.
//
// This is enforced SERVER-SIDE (the pick route's part index, the doc save and
// the wiring route), not only in the UI — see lib/schools/safe-parts.ts for the
// request-side guard.
//
// Pure: tested in lib/studio/library/class-safe.test.ts, which pins the exact
// allowed and refused set of today's library so a new part cannot silently
// become class-safe.

import type { LibraryPart } from "../schema";

/** The highest supply voltage a class part may need to run. */
export const CLASS_MAX_V = 5;

/**
 * The most current one part may draw. A USB port gives 3 A at best and an AA
 * holder far less, so anything hungrier (an MG996R servo stalls at 2.5 A)
 * belongs in a supervised build with a bench supply, not in a classroom.
 */
export const CLASS_MAX_MA = 1000;

/**
 * The only power SOURCES a class may use: a USB supply and an AA holder.
 * A source is allow-listed by id rather than by rule, because "5 V" alone does
 * not make a supply safe — psu_5v_5a is a mains barrel adapter at 5 V.
 */
export const CLASS_SAFE_SUPPLY_IDS: readonly string[] = ["usbc_power_5v", "usbc_breakout", "aa_holder_2"];

/**
 * Parts refused by name as well as by rule, so a later edit to their voltage or
 * tags cannot let them in: boost/buck converters (they exist to work outside
 * 5 V) and a mains relay.
 */
export const CLASS_DENY_IDS: readonly string[] = ["boost_5v", "buck_converter", "relay_module"];

/** A tag on any of these means the part is not for a classroom. */
export const CLASS_DENY_TAGS: readonly string[] = [
  "mains",
  "230v",
  "110v",
  "9v",
  "12v",
  "24v",
  "high-power",
  "lipo",
  "li-po",
  "li-ion",
  "lithium",
  "solder",
  "soldering",
];

/** A part that gives power rather than uses it. */
export function isPowerSource(part: LibraryPart): boolean {
  return part.power.supplyMA !== undefined || part.tags.includes("battery");
}

/** Why a part is refused, for the server log and the Engineer view. */
export type ClassSafetyReason = "supply_not_allowed" | "denied" | "unsafe_tag" | "needs_more_than_5v" | "too_much_current";

export function classSafetyReason(part: LibraryPart): ClassSafetyReason | null {
  // A supply is decided by the allow-list alone (a USB adapter is fine, a mains
  // barrel adapter at the same voltage is not).
  if (isPowerSource(part)) return CLASS_SAFE_SUPPLY_IDS.includes(part.id) ? null : "supply_not_allowed";
  if (CLASS_DENY_IDS.includes(part.id)) return "denied";
  if (part.tags.some((t) => CLASS_DENY_TAGS.includes(t))) return "unsafe_tag";
  // vMin, not vMax: a part rated 3.3–6 V runs happily at 5 V, while one rated
  // 7–12 V does not.
  if (part.power.vMin > CLASS_MAX_V) return "needs_more_than_5v";
  if (part.power.mA > CLASS_MAX_MA) return "too_much_current";
  return null;
}

export function isClassSafePart(part: LibraryPart): boolean {
  return classSafetyReason(part) === null;
}

/** The parts a class may choose from, in the order they came. */
export function classSafeParts<T extends LibraryPart>(parts: readonly T[]): T[] {
  return parts.filter((p) => isClassSafePart(p));
}

export function classSafeIds(parts: readonly LibraryPart[]): Set<string> {
  const ids = new Set<string>();
  for (const p of parts) if (isClassSafePart(p)) ids.add(p.id);
  return ids;
}

/** The ids on a list that a class may NOT use (for a refusal message). */
export function unsafeIdsAmong(ids: readonly string[], safe: ReadonlySet<string>): string[] {
  return [...new Set(ids)].filter((id) => !safe.has(id));
}
