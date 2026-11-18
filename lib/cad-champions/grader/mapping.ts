// Grader response <-> site data. Pure (no I/O); tested in mapping.test.ts.
//
// - isReferenceComplete: can this reference_data be sent to the grader?
// - graderAspectsFor: cc_task_aspects (check_key) -> the grader's `aspects` list
// - aspectOutcomes: per-aspect pass/fail + points from the grader's checks
// - toStudentResult: the ONLY shape that may reach a student (no measured
//   values, no `details`, no reference numbers)

export type GraderMode = "practice" | "part" | "assembly";
export type GraderScoring = "aspects" | "practice";

export interface AspectLite {
  id: string;
  check_key: string | null;
  max_points: number;
  method: string;
}

export interface GraderCheckLike {
  name: string;
  passed: boolean;
  partial: number;
  measured?: unknown;
}

export interface GraderResultLike {
  score: number;
  max_points: number;
  checks: GraderCheckLike[];
  error_code: string | null;
  warnings?: string[];
  feedback_en: string;
  feedback_ar: string;
  help_slug?: string | null;
  passed: boolean;
  practice_score?: number | null;
  details?: unknown;
}

/** What a student may see. Never add measured values or reference numbers. */
export interface StudentGradeResult {
  score: number;
  maxPoints: number;
  passed: boolean;
  /** 0-100, practice scoring only. */
  practiceScore: number | null;
  errorCode: string | null;
  feedbackEn: string;
  feedbackAr: string;
  helpSlug: string | null;
  warnings: string[];
  checks: { name: string; passed: boolean; partial: number }[];
}

export interface AspectOutcome {
  aspectId: string;
  passed: boolean;
  points: number;
  maxPoints: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** volume_mm3 > 0, area_mm2 > 0 and three principal moments: what /grade requires. */
export function isReferenceComplete(ref: unknown): boolean {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return false;
  const r = ref as Record<string, unknown>;
  const v = num(r.volume_mm3);
  const a = num(r.area_mm2);
  const m = r.principal_moments_mm5;
  return v != null && v > 0 && a != null && a > 0 && Array.isArray(m) && m.length === 3 && m.every((x) => num(x) != null);
}

export function scoringFor(mode: GraderMode): GraderScoring {
  return mode === "practice" ? "practice" : "aspects";
}

/** check_key (cc_task_aspects) -> grader check names. "part:*" = every per-part check. */
export function graderChecksFor(checkKey: string | null, mode: GraderMode): string[] {
  const key = (checkKey ?? "").trim();
  if (!key || key.startsWith("rubric:")) return [];
  if (mode === "assembly") {
    switch (key) {
      case "volume":
      case "area":
        return ["part:*"];
      case "inertia":
        return ["assembly_position"];
      case "solids":
        return ["parts_count"];
      default:
        return [key];
    }
  }
  switch (key) {
    case "volume":
      return ["volume"];
    case "area":
      return ["surface_area"];
    case "inertia":
      return ["principal_moments"];
    case "solids":
      return ["solid_count_validity"];
    default:
      return [key];
  }
}

/** Auto-graded aspects (method auto_step with a check key). */
export function autoAspects(aspects: readonly AspectLite[]): AspectLite[] {
  return aspects.filter((a) => a.method === "auto_step" && graderChecksFor(a.check_key, "part").length > 0);
}

/**
 * The `aspects` list for /grade: only one-to-one mappings (one aspect, one
 * grader check). Many-to-one aspects (assembly volume/area over every part)
 * are scored on the site by aspectOutcomes().
 */
export function graderAspectsFor(aspects: readonly AspectLite[], mode: GraderMode): { aspect_key: string; check: string; max_points: number }[] {
  const out: { aspect_key: string; check: string; max_points: number }[] = [];
  const used = new Set<string>();
  for (const a of autoAspects(aspects)) {
    const checks = graderChecksFor(a.check_key, mode);
    if (checks.length !== 1 || checks[0].endsWith("*") || used.has(checks[0])) continue;
    used.add(checks[0]);
    out.push({ aspect_key: a.id, check: checks[0], max_points: Math.max(0, Number(a.max_points) || 0) });
  }
  return out;
}

function matching(checks: readonly GraderCheckLike[], wanted: string[]): GraderCheckLike[] {
  return checks.filter((c) => wanted.some((w) => (w.endsWith("*") ? c.name.startsWith(w.slice(0, -1)) : c.name === w)));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Per-aspect results. Measurement aspects are full marks or zero (aspects
 * scoring); practice scoring keeps the grader's partial credit. A grader
 * error code (no checks) fails every aspect.
 */
export function aspectOutcomes(aspects: readonly AspectLite[], result: GraderResultLike, mode: GraderMode): AspectOutcome[] {
  const scoring = scoringFor(mode);
  return autoAspects(aspects).map((a) => {
    const maxPoints = Math.max(0, Number(a.max_points) || 0);
    const found = result.error_code ? [] : matching(result.checks, graderChecksFor(a.check_key, mode));
    const passed = found.length > 0 && found.every((c) => c.passed);
    let fraction = passed ? 1 : 0;
    if (scoring === "practice" && found.length > 0) {
      fraction = found.reduce((s, c) => s + Math.min(1, Math.max(0, c.partial)), 0) / found.length;
    }
    return { aspectId: a.id, passed, points: round2(maxPoints * fraction), maxPoints };
  });
}

/** The task's auto score: sum of aspect points when the task has auto aspects, else the grader's score. */
export function autoScoreFor(outcomes: readonly AspectOutcome[], result: GraderResultLike): { score: number; maxPoints: number } {
  if (outcomes.length > 0) {
    return {
      score: round2(outcomes.reduce((s, o) => s + o.points, 0)),
      maxPoints: round2(outcomes.reduce((s, o) => s + o.maxPoints, 0)),
    };
  }
  return { score: round2(Math.max(0, result.score)), maxPoints: round2(Math.max(0, result.max_points)) };
}

/** Strips everything a student must not see. Built field by field on purpose. */
export function toStudentResult(result: GraderResultLike, score?: { score: number; maxPoints: number }): StudentGradeResult {
  return {
    score: score?.score ?? round2(Math.max(0, result.score)),
    maxPoints: score?.maxPoints ?? round2(Math.max(0, result.max_points)),
    passed: !!result.passed,
    practiceScore: typeof result.practice_score === "number" ? result.practice_score : null,
    errorCode: result.error_code ?? null,
    feedbackEn: String(result.feedback_en ?? ""),
    feedbackAr: String(result.feedback_ar ?? ""),
    helpSlug: result.help_slug ?? null,
    warnings: (result.warnings ?? []).filter((w) => typeof w === "string" && /^[A-Z0-9_]{1,40}$/.test(w)),
    checks: (result.checks ?? []).map((c) => ({ name: String(c.name), passed: !!c.passed, partial: Math.min(1, Math.max(0, Number(c.partial) || 0)) })),
  };
}

/** cc_task_results.details: student-safe summary (plus the manual-review flag). */
export function studentDetails(
  result: StudentGradeResult | null,
  extra: { needsManualReview?: boolean; fileName?: string | null; matchedByVolume?: boolean } = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (result) {
    out.checks = result.checks;
    out.passed = result.passed;
    if (result.practiceScore != null) out.practice_score = result.practiceScore;
    if (result.warnings.length > 0) out.warnings = result.warnings;
  }
  if (extra.needsManualReview) out.needs_manual_review = true;
  if (extra.fileName) out.file_name = extra.fileName.split("/").pop();
  if (extra.matchedByVolume) out.matched_by_volume = true;
  return out;
}
