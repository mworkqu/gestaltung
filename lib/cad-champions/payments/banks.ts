// Banks in Qatar for the proof form (client + server safe, no secrets).

/** Banks in Qatar for the "I've made the transfer" dropdown (+ "other"). Labels live in payments.json. */
export const QATAR_BANKS = [
  "qnb",
  "cbq",
  "doha_bank",
  "qib",
  "qiib",
  "masraf_al_rayan",
  "dukhan_bank",
  "ahli_bank",
  "hsbc",
  "standard_chartered",
  "arab_bank",
  "other",
] as const;
export type QatarBank = (typeof QATAR_BANKS)[number];

export function isQatarBank(v: unknown): v is QatarBank {
  return typeof v === "string" && (QATAR_BANKS as readonly string[]).includes(v);
}

/** Stored payer_bank ("qnb" or "other: Name") -> a label key, or the free text. */
export function bankLabelKey(stored: string | null | undefined): { key: QatarBank | null; other: string | null } {
  const v = (stored ?? "").trim();
  if (!v) return { key: null, other: null };
  if (isQatarBank(v) && v !== "other") return { key: v, other: null };
  const m = /^other:\s*([\s\S]*)$/.exec(v);
  return { key: null, other: m ? m[1] || null : v };
}
