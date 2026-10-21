// The fingerprint of one analysis request: what the model would be asked.
// Server-only (node:crypto), pure, and the one rule both the write and the
// lookup use — /api/analyse stores it on the run it records and compares it
// before spending anything.
//
// A fingerprint rather than a cooldown. A cooldown gets both halves wrong: it
// refuses a client who fixed their brief and asked again (the one re-run worth
// paying for), and it still pays for the identical run once the window passes.
// The question is never "how long since the last run" but "is this the same
// request we already have an answer to", so that is what we store.
//
// Whitespace is normalised because a stray newline is not a changed brief.
// Case is not: "RED" and "red" can legitimately read differently. Answers go in
// too — a client who settles a question has changed the request, so that run is
// worth paying for.

import { createHash } from "node:crypto";

import type { Answer, AnalysisRequest } from "./analysis";

/** The brief as the fingerprint sees it: trimmed, one space between words. */
export const normaliseBrief = (brief: string) => brief.trim().replace(/\s+/g, " ");

/** Answers in a fixed order, so the same set never hashes two ways. */
const canonicalAnswers = (answers: Answer[]) =>
  [...answers]
    .map((a) => `${a.id}=${a.value ?? ""}`)
    .sort()
    .join("\u0000");

export function analysisFingerprint(req: Pick<AnalysisRequest, "brief" | "answers" | "locale">): string {
  const parts = [normaliseBrief(req.brief), req.locale, canonicalAnswers(req.answers ?? [])];
  return createHash("sha256").update(parts.join("\u0001")).digest("hex").slice(0, 32);
}
