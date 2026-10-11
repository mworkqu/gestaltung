// Which supplier an order line comes from (D3). Pure.
// Order of trust: the product's preferred offer, then any active offer, then
// the SKU prefix (VLT- = Voltaat, DK- = DigiKey, MS- = Mouser).

export type LineSupplier = { code: string; name: string };

const PREFIX_SUPPLIERS: readonly { prefix: string; supplier: LineSupplier }[] = [
  { prefix: "VLT-", supplier: { code: "voltaat", name: "Voltaat" } },
  { prefix: "DK-", supplier: { code: "digikey", name: "DigiKey" } },
  { prefix: "MS-", supplier: { code: "mouser", name: "Mouser" } },
];

export function supplierFromSku(sku: string | null | undefined): LineSupplier | null {
  const s = (sku ?? "").trim().toUpperCase();
  return PREFIX_SUPPLIERS.find((p) => s.startsWith(p.prefix))?.supplier ?? null;
}

export type OfferRef = { id: string; active: boolean; supplier: LineSupplier };

/** The supplier for one line: preferred offer, else first active offer, else the SKU prefix. */
export function supplierForLine(input: {
  sku: string | null | undefined;
  preferredOfferId?: string | null;
  offers?: readonly OfferRef[];
}): LineSupplier | null {
  const offers = input.offers ?? [];
  const preferred = input.preferredOfferId ? offers.find((o) => o.id === input.preferredOfferId) : undefined;
  if (preferred) return preferred.supplier;
  const active = offers.find((o) => o.active);
  if (active) return active.supplier;
  return supplierFromSku(input.sku);
}

/** The supplier's page in the dashboard (Voltaat has its own sync page; the rest share the suppliers list). */
export function supplierAdminHref(code: string): string {
  return code === "voltaat" ? "/dashboard/store/suppliers/voltaat" : "/dashboard/store/suppliers";
}

/** Distinct suppliers of an order, in first-seen order. */
export function suppliersOfOrder(lines: readonly { supplier: LineSupplier | null }[]): LineSupplier[] {
  const seen = new Map<string, LineSupplier>();
  for (const l of lines) if (l.supplier && !seen.has(l.supplier.code)) seen.set(l.supplier.code, l.supplier);
  return [...seen.values()];
}
