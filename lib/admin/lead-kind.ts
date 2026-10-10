// What kind of enquiry a lead is, read from the message each lead endpoint
// writes (/api/store-lead sources, /api/design-quote). Used to filter the
// Leads page and to label each card (audit Phase 6).

export const LEAD_KINDS = ["quote", "drawing", "bom", "callback", "contact"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export function leadKind(message: string | null | undefined): LeadKind {
  const m = (message ?? "").toLowerCase();
  if (m.startsWith("custom manufacturing quote request") || m.startsWith("cad file attached") || m.startsWith("design studio:") || m.startsWith("print request:"))
    return "quote";
  if (m.startsWith("drawing request") || m.startsWith("help me draw it")) return "drawing";
  if (m.startsWith("quote request for") || m.startsWith("bill of materials")) return "bom";
  if (m.startsWith("store landing") || m.includes("requested a callback")) return "callback";
  return "contact";
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The project a lead points at, when its message names one. */
export function leadProjectId(message: string | null | undefined): string | null {
  const m = message ?? "";
  const line = m.split("\n").find((l) => /^project:|drawing request for project|\/projects\//i.test(l.trim()));
  return line?.match(UUID)?.[0] ?? null;
}
