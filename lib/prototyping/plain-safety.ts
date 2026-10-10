// The one plain safety line under the client's wiring picture (client view,
// P5-04). Engineers see every level-shift warning and hard flag; a client reads
// a single sentence that says we took care of it, or, when something is still
// open, that an engineer will check the wiring with them. It never says the
// circuit is checked while a blocking problem stands.
//
// Pure and client-safe.

import type { LevelFlag } from "./electronics-rules";
import type { Netlist } from "./netlist";
import { plainKindOf } from "./plain-names";

export type SafetyNote = "shifter" | "protection" | "engineer" | null;

export function safetyNote({
  netlist,
  levelFlags = [],
  hardCount = 0,
}: {
  netlist: Pick<Netlist, "components"> | null;
  levelFlags?: readonly LevelFlag[];
  /** Blocking problems the electrical rules still report. */
  hardCount?: number;
}): SafetyNote {
  if (!netlist) return null;
  // Honest first: while something blocks, nobody is told it is safe.
  if (hardCount > 0) return "engineer";
  const kinds = netlist.components.map((c) => plainKindOf(c.function));
  if (levelFlags.length > 0 || kinds.includes("levelShift")) return "shifter";
  const protectedLoad = netlist.components.some(
    (c) => c.role === "driver" || /^(Q|D)\d/i.test(c.ref) || plainKindOf(c.function) === "transistor" || plainKindOf(c.function) === "diode"
  );
  return protectedLoad ? "protection" : null;
}
