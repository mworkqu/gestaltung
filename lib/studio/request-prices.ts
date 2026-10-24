// F-044: the "Get it made" dialog shows the same rough range as the Request page, so it feeds
// quoteBreakdown() (lib/studio/request-summary.ts, the one calculation) the same kind of input:
// store SKU -> listed QAR price, published products only.

export function pricesBySku(products: ReadonlyMap<string, { sku: string; unit_price: number | null | undefined }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of products.values()) {
    const price = Number(p.unit_price);
    if (p.sku && Number.isFinite(price) && price > 0) out.set(p.sku, price);
  }
  return out;
}
