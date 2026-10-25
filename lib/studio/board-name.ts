// F-045: the Code step says "Written for your Arduino Nano", never "…your arduino:avr:nano".
// The stored firmware board is whatever the model wrote, often the Arduino FQBN; the library
// part the visitor picked already has the human name, so that wins.

/** vendor:architecture:board[:options], e.g. arduino:avr:nano or esp32:esp32:esp32doit-devkit-v1. */
const FQBN = /^[a-z0-9_.-]+:[a-z0-9_.-]+:[a-z0-9_.-]+(?::[^\s]*)?$/i;

export const looksLikeFqbn = (s: string): boolean => FQBN.test(s.trim());

/** "nano_every" -> "Nano Every": the last-resort name for an FQBN with no library part behind it. */
function prettyBoardId(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * @param stored   doc.firmware.board (model text or FQBN), may be empty
 * @param partName the microcontroller part's display name in the page language, if the library has one
 */
export function boardDisplayName(stored: string | null | undefined, partName: string | null | undefined): string {
  const name = partName?.trim() ?? "";
  const board = stored?.trim() ?? "";
  if (!board) return name;
  if (!looksLikeFqbn(board)) return board;
  if (name) return name;
  return prettyBoardId(board.split(":")[2] ?? "");
}
