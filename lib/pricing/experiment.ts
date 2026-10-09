// Price experiment (P4-02 / WF-42). Display only: credits are still paid by bank
// transfer or in person and granted by the admin, so an invite code only changes
// the credit price that is SHOWN / QUOTED to the people who hold it. Off by
// default; before migration 0060 runs the RPCs are missing (PGRST202) and every
// reader degrades to "no invited price" = today's behaviour.
//
// This file is pure (no Supabase, no React): code hygiene, RPC result parsing,
// the tolerant localStorage helpers and the admin funnel maths.

/** The invite code a visitor applied, kept in the browser so a later sign-in can claim it. */
export const PRICE_CODE_KEY = "g360_price_code";

const CODE_RE = /^[A-Z0-9-]{3,32}$/;

/** Trim + upper-case; null unless 3-32 characters of A-Z, 0-9 and "-". */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** The normalised `?code=` of a location.search string, or null. */
export function readCodeFromSearch(search: string): string | null {
  if (typeof search !== "string" || !search) return null;
  try {
    return normaliseCode(new URLSearchParams(search).get("code"));
  } catch {
    return null;
  }
}

/** An RPC numeric result (a number, or a numeric string as PostgREST returns numeric): a positive finite number, else null. */
export function parseQuote(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && /^\s*\d+(\.\d+)?\s*$/.test(raw)) n = Number(raw);
  else return null;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The result of my_price_quote(): rows [{cohort, credit_qar}] (0 or 1). The first valid row's price, else null. */
export function parseQuoteRows(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  for (const row of raw) {
    if (row && typeof row === "object") {
      const q = parseQuote((row as { credit_qar?: unknown }).credit_qar);
      if (q !== null) return q;
    }
  }
  return null;
}

// localStorage helpers. They never throw: a private window, blocked site data or
// a missing window (server render) just means "no stored code".

export function readStoredCode(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return normaliseCode(window.localStorage.getItem(PRICE_CODE_KEY));
  } catch {
    return null;
  }
}

/** Saves a valid code; returns false for an invalid code or when storage is unavailable. */
export function storeCode(raw: unknown): boolean {
  const code = normaliseCode(raw);
  if (!code) return false;
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(PRICE_CODE_KEY, code);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredCode(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(PRICE_CODE_KEY);
  } catch {
    // ignore
  }
}

// ── Admin funnel ───────────────────────────────────────────────────────────

export type CohortFunnelRow = {
  cohort: string;
  users: number;
  withProject: number;
  boughtCredits: number;
  withOrder: number;
};

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** price_cohort_funnel() rows → typed rows. Anything that is not an array of rows with a cohort name gives []. */
export function parseCohortFunnel(raw: unknown): CohortFunnelRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: CohortFunnelRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.cohort !== "string" || !o.cohort.trim()) continue;
    rows.push({
      cohort: o.cohort,
      users: count(o.users),
      withProject: count(o.with_project),
      boughtCredits: count(o.bought_credits),
      withOrder: count(o.with_order),
    });
  }
  return rows;
}

/** "33%" for part/total (a whole percent), "—" when there is no total. */
export function conversionPct(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}
