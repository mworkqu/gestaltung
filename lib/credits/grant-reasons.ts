// Admin credit grant helpers (D7): quick amounts, the reason dropdown and the
// ledger note built from it. Pure. The note is stored in English whatever the
// admin's language, so the ledger reads the same for everyone.

export const QUICK_AMOUNTS = [1, 3, 10] as const;

export const GRANT_REASONS = ["bank_transfer", "whatsapp_topup", "goodwill", "correction", "other"] as const;
export type GrantReason = (typeof GRANT_REASONS)[number];

const REASON_NOTE: Record<GrantReason, string> = {
  bank_transfer: "Bank transfer",
  whatsapp_topup: "WhatsApp top-up",
  goodwill: "Goodwill",
  correction: "Correction",
  other: "",
};

export function parseGrantReason(v: unknown): GrantReason {
  return (GRANT_REASONS as readonly string[]).includes(String(v)) ? (v as GrantReason) : "other";
}

/** "Bank transfer — 60 QAR". "Other" needs a free-text detail (returns "" so admin_grant answers note_required). */
export function buildGrantNote(reason: GrantReason, detail: string): string {
  const d = detail.trim();
  const label = REASON_NOTE[reason];
  if (!label) return d;
  return d ? `${label} — ${d}` : label;
}

/** Amount from a quick button (wins) or the custom field; NaN when neither is a whole number. */
export function pickAmount(quick: unknown, custom: unknown): number {
  const raw = quick !== null && quick !== undefined && String(quick).trim() !== "" ? quick : custom;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

type LedgerLike = { delta: number; reason: string; created_at: string; kind: string };

/** The last few times the user spent credits (negative deltas), newest first. */
export function recentUse<T extends LedgerLike>(ledger: T[], n = 3): T[] {
  return ledger
    .filter((l) => l.delta < 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, n);
}

/** A mailto: link for the owner's own mail client (the automatic email is separate). */
export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
