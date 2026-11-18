// Should the landing hero load the live 3D assembly or keep the static
// drawing? Pure, so the rule is unit-tested; the hero reads the browser
// signals and passes them in.

export type HeroSignals = {
  reducedMotion: boolean;
  /** navigator.connection.saveData */
  saveData?: boolean | null;
  /** navigator.connection.effectiveType ("slow-2g" | "2g" | "3g" | "4g") */
  effectiveType?: string | null;
  /** navigator.deviceMemory in GB (Chrome only; undefined elsewhere) */
  deviceMemory?: number | null;
  /** navigator.hardwareConcurrency */
  cores?: number | null;
  /** A WebGL context could be created. */
  webgl: boolean;
};

export type HeroMode = "3d" | "static";

/** Below this many GB of device memory the static drawing is kept. */
export const HERO_MIN_MEMORY_GB = 4;

export function heroMode(s: HeroSignals): HeroMode {
  if (s.reducedMotion || !s.webgl) return "static";
  if (s.saveData) return "static";
  if (s.effectiveType === "slow-2g" || s.effectiveType === "2g") return "static";
  if (typeof s.deviceMemory === "number" && s.deviceMemory > 0 && s.deviceMemory < HERO_MIN_MEMORY_GB) return "static";
  if (typeof s.cores === "number" && s.cores > 0 && s.cores < 4) return "static";
  return "3d";
}
