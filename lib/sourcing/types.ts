// Supplier adapters (Part 4, Task 19). Every supplier's data — a CSV price
// list, an API response — is turned into SourcedOffer rows by its adapter.
// One adapter per supplier, each in its own file under lib/sourcing/adapters/.
//
// A SourcedOffer carries numbers only for existing offers: cost, retail
// price, currency, availability and lead time (SOURCED_OFFER_FIELDS). The
// name is used only to create a DRAFT product for a row that matches nothing,
// from a file the supplier gave us — never to overwrite our catalogue.

import type { Availability } from "@/lib/store/sourcing";

export type SourcedOffer = {
  /** The supplier's own SKU — the key that ties a row to our offer. */
  supplierSku: string;
  /** Our SKU, when the file carries it: attaches a new offer to that product. */
  ourSku?: string | null;
  name?: string | null;
  category?: string | null;
  cost?: number | null;
  retailPrice?: number | null;
  currency?: string | null;
  availability?: Availability | null;
  leadTimeDays?: number | null;
  packSize?: number | null;
  moq?: number | null;
  url?: string | null;
};

export type AdapterRowError = { row: number; reason: "no_sku" | "bad_number"; field?: string };

export interface SupplierAdapter {
  /** Matches suppliers.code, or "csv" for the generic file importer. */
  code: string;
  kind: "file" | "api";
}

/** A supplier's catalogue entry, as an API adapter returns it (Mouser, DigiKey). */
export type SupplierProduct = {
  supplierCode: string;
  supplierSku: string;
  mpn: string | null;
  manufacturer: string | null;
  /** Catalogue content from the supplier's API — used only to create a new product. */
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  url: string | null;
  datasheetUrl: string | null;
  /** Unit price at quantity 1 (or the lowest break), in `currency`. */
  cost: number | null;
  currency: string;
  availability: Availability;
  leadTimeDays: number | null;
  moq: number;
  parameters: { name: string; value: string }[];
};
