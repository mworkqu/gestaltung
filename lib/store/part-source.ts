// The product page's "Source" line (P2-07). The data comes from
// public.part_public_source() (migration 0054): the preferred offer's supplier
// CODE, the product's lead class and the backup product (parts.backup_for, 0041).
// It never carries a cost, landed cost, income or margin, and nothing here
// may add one: the customer sees a supplier name and a lead class only.

import { LEAD_TIME_CLASSES, type LeadTimeClass } from "@/lib/store/sourcing";

export type PartSourceBackup = {
  sku: string;
  supplier: string | null;
  leadTimeClass: LeadTimeClass | null;
};

export type PartSource = {
  /** suppliers.code of the preferred offer; null = no offer. */
  supplier: string | null;
  leadTimeClass: LeadTimeClass | null;
  /** A published product that stands in for this one (its backup_for = this id). */
  backup: PartSourceBackup | null;
};

/** Customer-facing supplier names; an unknown code shows no line at all. */
export const SUPPLIER_LABELS: Readonly<Record<string, string>> = {
  voltaat: "Voltaat",
  digikey: "DigiKey",
  mouser: "Mouser",
  alibaba: "Alibaba",
  aliexpress: "AliExpress",
};

/** The supplier that stocks in Qatar (its in-stock items are "Stocked by … in Qatar"). */
export const LOCAL_SUPPLIER = "voltaat";

export function supplierLabel(code: string | null | undefined): string | null {
  return code ? (SUPPLIER_LABELS[code.toLowerCase()] ?? null) : null;
}

const leadClass = (v: unknown): LeadTimeClass | null =>
  typeof v === "string" && (LEAD_TIME_CLASSES as readonly string[]).includes(v) ? (v as LeadTimeClass) : null;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The RPC's jsonb → PartSource, keeping only the allowed fields; null when empty. */
export function parsePartSource(raw: unknown): PartSource | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const b = r.backup && typeof r.backup === "object" && !Array.isArray(r.backup) ? (r.backup as Record<string, unknown>) : null;
  const backupSku = b ? text(b.sku) : null;
  return {
    supplier: text(r.supplier),
    leadTimeClass: leadClass(r.lead_time_class),
    backup: b && backupSku ? { sku: backupSku, supplier: text(b.supplier), leadTimeClass: leadClass(b.lead_time_class) } : null,
  };
}

export type SourceLine =
  | { kind: "stocked_local"; supplier: string }
  | { kind: "sourced"; supplier: string }
  | { kind: "sourced_lead"; supplier: string; leadTimeClass: LeadTimeClass }
  | { kind: "on_request" };

/**
 * Which source sentence a product gets:
 *   no lead class (no offer)            → on_request ("Available on request")
 *   Voltaat + in_stock                  → "Stocked by Voltaat in Qatar"
 *   Voltaat, any other class            → "Sourced from Voltaat"
 *   another known supplier              → "Sourced from DigiKey, 1–2 weeks"
 *   no source data / unknown supplier   → null (no line)
 * `leadTimeClass` is the product row's (the page already has it).
 */
export function sourceLine(source: PartSource | null, leadTimeClass: LeadTimeClass | null | undefined): SourceLine | null {
  if (!leadTimeClass) return { kind: "on_request" };
  const supplier = supplierLabel(source?.supplier);
  if (!source || !supplier) return null;
  if (source.supplier!.toLowerCase() === LOCAL_SUPPLIER) {
    return leadTimeClass === "in_stock" ? { kind: "stocked_local", supplier } : { kind: "sourced", supplier };
  }
  return { kind: "sourced_lead", supplier, leadTimeClass };
}

/** "Backup: DigiKey" — only when the backup's supplier is a known one. */
export function backupLine(source: PartSource | null): { supplier: string; sku: string } | null {
  const b = source?.backup;
  const supplier = supplierLabel(b?.supplier);
  return b && supplier ? { supplier, sku: b.sku } : null;
}

/** A lead label inside an English sentence: "In stock" → "in stock"; other locales unchanged. */
export function leadInSentence(label: string, locale: string): string {
  return locale === "en" && /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/**
 * parts columns that are the business's own numbers or sourcing internals
 * (0028). The anon product read uses select("*") (column sets differ between
 * migrations), so the cached public row drops these before anything renders.
 */
export const PRIVATE_PART_FIELDS = [
  "landed_cost_qar",
  "expected_income_qar",
  "income_pct",
  "below_floor",
  "pricing_mode",
  "pinned_offer_id",
  "preferred_offer_id",
] as const;

/** A copy of the row without PRIVATE_PART_FIELDS. */
export function withoutPrivateFields<T extends object>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const k of PRIVATE_PART_FIELDS) delete copy[k];
  return copy as T;
}
