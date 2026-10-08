// Names as people read them (audit #34, P0-07). Pure and dependency-free so
// readiness, the netlist and the components can all share it.

/** An identifier-style name the analysis sometimes returns, e.g. monitor_firmware. */
const IDENTIFIER_NAME = /^[a-z0-9]+(_[a-z0-9]+)+$/;

/**
 * A part's name as people read it. An identifier ("monitor_firmware") shows
 * as "Monitor firmware"; any other name is shown exactly as stored. Display
 * only — the stored name never changes (audit #34).
 */
export function humanPartName(name: string): string {
  const trimmed = name.trim();
  if (!IDENTIFIER_NAME.test(trimmed)) return name;
  const words = trimmed.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "plant_monitor_enclosure" -> "Plant Monitor Enclosure". Display only. */
export function titleCaseId(id: string): string {
  return id
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The label for something that has a name and an id: its name (an
 * identifier-style name shown as words), else a Title Case of the id — a raw
 * snake_case concept id never reaches a label.
 */
export function humanName(name: string | null | undefined, fallbackId?: string | null): string {
  if (name && name.trim()) return humanPartName(name);
  return fallbackId ? titleCaseId(fallbackId) : "";
}
