// HTML / XML escaping. Pure, safe on server and client.
//
// Three copies existed (CODE_QUALITY_AUDIT D-25) and they are not all the same:
//   - lib/email.ts escapeHtml == lib/email/brand-layout.ts escapeHtmlText:
//     & < > " ' (apostrophe -> &#39;).
//   - lib/prototyping/schematic.ts `esc`: the same five characters, but it
//     coerces with String(s) first.
//   - lib/prototyping/netlist.ts `esc`: only & < > ", no apostrophe.
// escapeHtml and escapeXml keep the first two byte-for-byte; escapeXmlAttr keeps
// the third. For anything an apostrophe could break out of, use escapeXml.

const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text or a double/single-quoted attribute value for HTML (emails, pages). Identical to lib/email.ts escapeHtml. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => MAP[c]!);
}

/** Escape text or a quoted attribute value for XML/SVG. Identical to the `esc` in lib/prototyping/schematic.ts (coerces with String first). */
export function escapeXml(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => MAP[c]!);
}

/**
 * Escape for XML text or a DOUBLE-quoted attribute only: & < > " and not the
 * apostrophe. Identical to the `esc` in lib/prototyping/netlist.ts; kept so that
 * moving netlist.ts over cannot change its output.
 */
export function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
