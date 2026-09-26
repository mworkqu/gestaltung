// Board footprints: the outline of the common development boards and
// breadboards, in millimetres, so an enclosure can be checked against what
// has to go inside it (audit #5: a 30 × 30 mm case was "ready" for an ESP32
// dev board that is 52 × 28 mm on its own).
//
// Nominal outlines of the usual versions. Where a family varies, the figure is
// the smaller common one, so the check can only ever under-call "too small",
// never cry wolf. Names are matched on the project's own lines (BOM function,
// catalog part, store product), most specific pattern first.
//
// Pure and client-safe.

export type Footprint = {
  id: string;
  /** Plain English name, used only in numbers-and-name messages. */
  label: string;
  length_mm: number;
  width_mm: number;
};

/** `not`: a name that also matches this is a different, smaller thing. */
const FOOTPRINTS: (Footprint & { match: RegExp; not?: RegExp })[] = [
  // Specific variants before their family names.
  { id: "esp32_c3_mini", label: "ESP32-C3 mini", length_mm: 34, width_mm: 26, match: /esp32[- ]?c3\b.*\bmini\b|\bc3[- ]?(super[- ]?)?mini\b/ },
  { id: "arduino_pro_mini", label: "Arduino Pro Mini", length_mm: 33, width_mm: 18, match: /\bpro[- ]?mini\b/ },
  { id: "arduino_nano", label: "Arduino Nano", length_mm: 45, width_mm: 18, match: /\b(arduino )?nano\b/ },
  { id: "esp32_cam", label: "ESP32-CAM", length_mm: 40, width_mm: 27, match: /\besp[- ]?32[- ]?cam\b/ },
  {
    id: "esp32_devkit",
    label: "ESP32 dev board",
    length_mm: 52,
    width_mm: 28,
    match: /\besp[- ]?32\w*/,
    // A bare module or chip is soldered onto something else; only a board counts.
    not: /^(?!.*\b(dev\w*|board|kit)\b).*\b(module|chip|ic|wroom|wrover)\b/,
  },
  { id: "arduino_uno", label: "Arduino Uno", length_mm: 69, width_mm: 53, match: /\barduino uno\b|\buno\b/ },
  { id: "pi_pico", label: "Raspberry Pi Pico", length_mm: 51, width_mm: 21, match: /\b(raspberry )?pi pico\b|\bpico\b/ },
  { id: "pi_zero", label: "Raspberry Pi Zero", length_mm: 65, width_mm: 30, match: /\b(raspberry )?pi zero\b|\brpi zero\b/ },
  { id: "raspberry_pi", label: "Raspberry Pi", length_mm: 85, width_mm: 56, match: /\braspberry ?pi\b|\brpi\b/ },
  // A mini breadboard (170 points) is far smaller: it never counts as one.
  {
    id: "breadboard_400",
    label: "400-point breadboard",
    length_mm: 83,
    width_mm: 55,
    match: /^(?!.*\b(mini|170|tiny)\b).*\bbread ?board\b/,
  },
];

/** The board a line's name describes, or null. */
export function footprintOf(name: string): Footprint | null {
  const n = name.toLowerCase();
  const hit = FOOTPRINTS.find((f) => f.match.test(n) && !f.not?.test(n));
  if (!hit) return null;
  return { id: hit.id, label: hit.label, length_mm: hit.length_mm, width_mm: hit.width_mm };
}

/** Every distinct known board among these names. */
export function boardsIn(names: readonly (string | null | undefined)[]): Footprint[] {
  const out: Footprint[] = [];
  for (const name of names) {
    const fp = name ? footprintOf(name) : null;
    if (fp && !out.some((x) => x.id === fp.id)) out.push(fp);
  }
  return out;
}

/**
 * The known boards a project uses, from everywhere it lists things: its bill
 * of materials (electronics lines the client hasn't removed), its catalog
 * parts and the store products on the project page.
 */
export function projectBoards(src: {
  bom?: { lines?: { id: string; function: string; spec?: string; kind?: string }[]; dismissed?: string[] } | null;
  partNames?: readonly (string | null | undefined)[];
  itemNames?: readonly (string | null | undefined)[];
}): Footprint[] {
  const dismissed = new Set(src.bom?.dismissed ?? []);
  const bomNames = (src.bom?.lines ?? [])
    .filter((l) => l.kind === "electronics" && !dismissed.has(l.id))
    .map((l) => `${l.function} ${l.spec ?? ""}`);
  return boardsIn([...bomNames, ...(src.partNames ?? []), ...(src.itemNames ?? [])]);
}

/** Clearance around a board inside its enclosure, per side pair (mm). */
export const ENCLOSURE_MARGIN_MM = 4;
