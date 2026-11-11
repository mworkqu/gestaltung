// Training software tracks (docs/COMPETITION_ALIGNMENT.md section A).
// Inventor is the competition software and the default.

export const CC_TRACKS = ["inventor", "fusion", "solidworks"] as const;
export type CcTrack = (typeof CC_TRACKS)[number];

export function isCcTrack(value: unknown): value is CcTrack {
  return typeof value === "string" && (CC_TRACKS as readonly string[]).includes(value);
}

/** Preselected track from the software the student already uses. */
export function defaultTrackFor(cadSoftwareUsed: string | null | undefined): CcTrack {
  if (cadSoftwareUsed === "solidworks") return "solidworks";
  if (cadSoftwareUsed === "fusion") return "fusion";
  return "inventor";
}
