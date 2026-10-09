// Review rows, display helpers and the home-strip rule (P4-03). Rows come from
// the 0058 RPCs (approved_reviews, approved_review_count) and the reviews
// table; anything malformed is dropped rather than rendered.

export type ReviewLocale = "en" | "ar";
export type ReviewStatus = "pending" | "approved" | "rejected";
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["pending", "approved", "rejected"];

/** A public review: no order id, no email, no surname. */
export type ApprovedReview = {
  id: string;
  score: number;
  comment: string | null;
  firstName: string | null;
  locale: ReviewLocale;
  createdAt: string;
};

/** A row in the admin moderation list. */
export type AdminReview = ApprovedReview & {
  orderId: string;
  status: ReviewStatus;
  skus: string[];
};

/** The home strip needs at least this many approved reviews to appear. */
export const HOME_STRIP_MIN = 3;
export const HOME_STRIP_SHOWN = 3;

export function shouldShowHomeStrip(count: number): boolean {
  return Number.isFinite(count) && count >= HOME_STRIP_MIN;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function validDate(v: unknown): string | null {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
}

function parseOne(v: unknown): ApprovedReview | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id);
  const createdAt = validDate(r.created_at);
  const score = typeof r.score === "number" ? r.score : NaN;
  if (!id || !createdAt || !Number.isInteger(score) || score < 1 || score > 5) return null;
  return {
    id,
    score,
    comment: str(r.comment),
    firstName: str(r.first_name),
    locale: r.locale === "ar" ? "ar" : "en",
    createdAt,
  };
}

/** The approved_reviews() rows, invalid ones dropped. Anything that is not an array is []. */
export function parseApprovedReviews(data: unknown): ApprovedReview[] {
  if (!Array.isArray(data)) return [];
  return data.map(parseOne).filter((r): r is ApprovedReview => r !== null);
}

/** approved_review_count(): a non-negative integer, else 0. */
export function parseReviewCount(data: unknown): number {
  const n = typeof data === "number" ? data : typeof data === "string" && /^\d+$/.test(data.trim()) ? Number(data) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Rows of the reviews table for the admin page (status, order id and SKUs included). */
export function parseAdminReviews(data: unknown): AdminReview[] {
  if (!Array.isArray(data)) return [];
  const out: AdminReview[] = [];
  for (const raw of data) {
    const base = parseOne(raw);
    if (!base) continue;
    const r = raw as Record<string, unknown>;
    const orderId = str(r.order_id);
    const status = REVIEW_STATUSES.find((s) => s === r.status);
    if (!orderId || !status) continue;
    const skus = Array.isArray(r.skus) ? r.skus.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];
    out.push({ ...base, orderId, status, skus });
  }
  return out;
}

/** Counts per status, for the filter tabs. */
export function countByStatus(rows: readonly AdminReview[]): Record<ReviewStatus, number> {
  const c: Record<ReviewStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

/** The first name as written, or the copy for "A customer in Qatar" when there is none. */
export function displayName(firstName: string | null | undefined, anonymous: string): string {
  const n = typeof firstName === "string" ? firstName.trim() : "";
  return n || anonymous;
}

/**
 * The reviews the home strip shows: newest first, those with a comment before
 * score-only ones (each group keeps its order), at most `limit`.
 */
export function pickHomeReviews(reviews: readonly ApprovedReview[], limit = HOME_STRIP_SHOWN): ApprovedReview[] {
  const withComment = reviews.filter((r) => r.comment);
  const scoreOnly = reviews.filter((r) => !r.comment);
  return [...withComment, ...scoreOnly].slice(0, limit);
}

/** A medium date ("9 Oct 2026") in Qatar time; Western digits in both languages. */
export function formatReviewDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Qatar",
  }).format(d);
}
