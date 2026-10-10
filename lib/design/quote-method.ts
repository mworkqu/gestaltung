// Manufacturing method on /design/quote is optional (P5-05): left empty it is
// "not sure" and our engineer picks. The form and /api/design-quote share this.

export const QUOTE_METHODS = ["not_sure", "3d_printing", "cnc_machining", "laser_cutting", "edm"] as const;
export type QuoteMethod = (typeof QUOTE_METHODS)[number];

export const DEFAULT_QUOTE_METHOD: QuoteMethod = "not_sure";

/** Anything empty, unknown or "not sure" becomes the default; known methods pass. */
export function normalizeQuoteMethod(raw: unknown): QuoteMethod {
  const v = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return (QUOTE_METHODS as readonly string[]).includes(v) ? (v as QuoteMethod) : DEFAULT_QUOTE_METHOD;
}
