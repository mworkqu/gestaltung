// Review comment validation (P4-03). Mirrors record_order_review in
// supabase/migrations/0058_reviews.sql: at most 280 characters, no links. The
// database re-checks both and raises 'bad_comment'; this runs first so the
// customer gets a polite message instead of a failed request.

export const REVIEW_COMMENT_MAX = 280;

export type CommentCheck =
  | { ok: true; comment: string }
  | { ok: false; reason: "too_long" | "link" };

// Domain-like tokens: x.com, shop.example.qa, bit.ly/abc. Only well-known
// endings, so "great.Fast delivery" or "5.5 mm" are not mistaken for a link.
const TLDS =
  "com|net|org|io|co|qa|me|app|dev|info|biz|xyz|ly|gl|to|tv|us|uk|ae|sa|in|shop|store|online|site|link|click|top|ai|gg|cc|ws|pro|live|cloud|tech|page|website|space";
const DOMAIN_LIKE = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:${TLDS})(?![\p{L}\p{N}-])`,
  "iu",
);

/** Trim and collapse every run of whitespace (newlines included) to one space. */
export function normalizeComment(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Does the text contain a URL, a "www." address or a domain-like token (or an email address)? */
export function hasLink(text: string): boolean {
  const s = text.normalize("NFKC");
  return /https?:\/\//i.test(s) || /(?:^|[^a-z0-9])www\./i.test(s) || /\S@\S/.test(s) || DOMAIN_LIKE.test(s);
}

/**
 * Validate one comment from the form. Empty is fine (it clears the comment).
 * Length is counted after whitespace is collapsed, in characters (code points).
 */
export function validateComment(raw: unknown): CommentCheck {
  const comment = normalizeComment(typeof raw === "string" ? raw : "");
  if (Array.from(comment).length > REVIEW_COMMENT_MAX) return { ok: false, reason: "too_long" };
  if (hasLink(comment)) return { ok: false, reason: "link" };
  return { ok: true, comment };
}
