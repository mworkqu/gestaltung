// Money helpers. QAR is the only currency the app prices in.
//
// formatQar reproduces lib/parts/format.ts formatPrice exactly by default, so
// callers can be pointed at it without a visible change: "QAR 12.50" (en) and
// "12.50 ر.ق" (ar), Western digits, two decimals, no thousands separator. The
// email, Intl-based and 0-dp variants listed in CODE_QUALITY_AUDIT D-08 map onto
// the options (`decimals`, `symbol`) or stay thin wrappers around this.

export { CREDIT_QAR } from "@/lib/credits/constants";

/** Round to 2 decimal places (the `Math.round(n * 100) / 100` written inline in ~17 places). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type FormatQarOptions = {
  /** Digits after the decimal point. Default 2. */
  decimals?: number;
  /** Prefix/suffix the currency ("QAR " / " ر.ق"). Default true; false returns the bare amount. */
  symbol?: boolean;
};

/** `formatQar(12.5, "en")` -> "QAR 12.50"; `formatQar(12.5, "ar")` -> "12.50 ر.ق". Any locale other than "ar" formats as English. */
export function formatQar(n: number, locale: string, opts: FormatQarOptions = {}): string {
  const { decimals = 2, symbol = true } = opts;
  const amount = n.toFixed(decimals);
  if (!symbol) return amount;
  return locale === "ar" ? `${amount} ر.ق` : `QAR ${amount}`;
}
