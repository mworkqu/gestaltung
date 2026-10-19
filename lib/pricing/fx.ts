// One place for the exchange rates we fall back to when store_settings
// ('fx_to_qar', migration 0028) has not been read or has no row for the
// currency. The live rates are the ones in store_settings — these are only the
// default, and migration 0094 writes the same numbers into that row.
//
// The riyal is pegged to the dollar. The owner's rate (2026-10-19) is
// 3.72 QAR per USD; it was 3.64 before.

export const DEFAULT_QAR_PER_USD = 3.72;

/** The same shape as store_settings.fx_to_qar: QAR per one unit of the key. */
export const DEFAULT_FX_TO_QAR: Readonly<Record<string, number>> = {
  QAR: 1,
  USD: DEFAULT_QAR_PER_USD,
  EUR: 4.03,
  CNY: 0.52,
  GBP: 4.7,
};

/** QAR per one unit of `currency`, from a store_settings value when it has it. */
export function qarPerUnit(currency: string | null | undefined, fx?: Record<string, number> | null): number {
  const code = (currency ?? "QAR").toUpperCase();
  const live = fx ? Number(fx[code]) : Number.NaN;
  if (Number.isFinite(live) && live > 0) return live;
  return DEFAULT_FX_TO_QAR[code] ?? (code === "QAR" ? 1 : DEFAULT_QAR_PER_USD);
}
