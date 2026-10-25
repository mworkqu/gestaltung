// F-009: why the product pictures could not be made, in a form the UI can say in plain words.
// The preview job only reports "failed" / "no_render"; the cause (offline, service said no,
// pictures would not draw, browser cannot draw them) is told apart here so the Enclosure step
// never shows a bare "could not draw" with nothing to do about it.

export type PreviewFailureReason = "network" | "setup" | "service" | "pictures";
export type ProductFailure = "browser" | "worker" | PreviewFailureReason;

/** The /design reply of the preview job, reduced to a reason (status 0 = the request never arrived). */
export function reasonOfDesignReply(status: number, designCount: number): PreviewFailureReason {
  if (status === 0) return "network";
  if (status === 409) return "setup";
  if (status < 200 || status >= 300 || designCount === 0) return "service";
  return "pictures";
}

/** Retrying can only help when the cause was not this browser. */
export const canRetry = (f: ProductFailure): boolean => f !== "browser";
