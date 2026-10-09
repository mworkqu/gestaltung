// The comment form body (P4-03): POST /api/orders/review takes either the plain
// HTML form (application/x-www-form-urlencoded) or JSON. Pure parsing, so the
// route stays thin and this is testable.

export const REVIEW_BODY_MAX_BYTES = 4096;

export type ReviewBody = {
  order: string | null;
  /** Raw score as sent; the route passes it through parseScore. */
  score: string | null;
  /** null = the field was not sent (keep the existing comment). */
  comment: string | null;
  locale: "en" | "ar";
  token: string | null;
};

function asText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Parse a request body of at most REVIEW_BODY_MAX_BYTES. Null when it cannot be parsed or is too big. */
export function parseReviewBody(contentType: string | null, raw: string): ReviewBody | null {
  if (new TextEncoder().encode(raw).length > REVIEW_BODY_MAX_BYTES) return null;
  let get: (k: string) => string | null;
  if ((contentType ?? "").toLowerCase().includes("application/json")) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const o = json as Record<string, unknown>;
    get = (k) => asText(o[k]);
  } else {
    const p = new URLSearchParams(raw);
    get = (k) => p.get(k);
  }
  return {
    order: get("order"),
    score: get("score"),
    comment: get("comment"),
    locale: get("l") === "ar" ? "ar" : "en",
    token: get("t"),
  };
}
