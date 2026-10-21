// The fingerprint of one model call: everything we would send it. Server-only
// (node:crypto), pure, and the one rule both the lookup and the stored row use
// — validatedCall compares it before spending anything.
//
// Same idea as analysis-request.ts one level down. There the fingerprint is of
// a client's brief, so /api/analyse alone gets reuse; here it is of the request
// itself, so every step that goes through validatedCall (every Design Studio
// step) gets it without each one having to define what "the same request"
// means. The prompt IS the request: a step whose words have not changed cannot
// have a different answer worth paying for.
//
// The retry prompt is deliberately not what we hash: the fingerprint names the
// request, not the attempt, so one hash goes on every row of a call and the row
// a retry finally answered is still found by the next identical request.

import { createHash } from "node:crypto";

export type CallFingerprintInput = {
  step?: string;
  system: string;
  prompt: string;
  schema: object;
  /** A tier's stronger first model answers differently; it belongs in the hash. */
  model?: string;
  images?: readonly { mimeType: string; data: string }[];
};

export function callFingerprint(i: CallFingerprintInput): string {
  const h = createHash("sha256");
  for (const part of [i.step ?? "", i.system, i.prompt, JSON.stringify(i.schema), i.model ?? ""]) {
    h.update(part).update("\u0001");
  }
  // The image bytes, not just how many: a vision check's answer is about the
  // pictures. Two renders of the same solved product in the same browser are
  // the same bytes, so this still matches on the press we want to stop paying
  // for twice, and a genuinely different picture is a different question.
  for (const img of i.images ?? []) h.update(img.mimeType).update("\u0000").update(img.data).update("\u0001");
  return h.digest("hex").slice(0, 32);
}
