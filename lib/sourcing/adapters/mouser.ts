// Mouser adapter (Task 19b): the official Search API (key in MOUSER_API_KEY,
// server-only). Limits: 30 calls a minute, 1,000 a day — callers keep lookups
// few and explicit. Mouser's API carries few parameters, so specifications
// mostly come from DigiKey; Mouser gives price, stock and lead time.

import type { SupplierAdapter, SupplierProduct } from "@/lib/sourcing/types";

export const mouserAdapter: SupplierAdapter = { code: "mouser", kind: "api" };

const BASE = "https://api.mouser.com/api/v1/search";

type MouserPart = {
  MouserPartNumber?: string;
  ManufacturerPartNumber?: string;
  Manufacturer?: string;
  Description?: string;
  Category?: string;
  ImagePath?: string;
  ProductDetailUrl?: string;
  DataSheetUrl?: string;
  PriceBreaks?: { Quantity: number; Price: string; Currency: string }[];
  AvailabilityInStock?: string | null;
  Availability?: string;
  AvailabilityOnOrder?: unknown[];
  LeadTime?: string;
  Min?: string;
  ProductAttributes?: { AttributeName: string; AttributeValue: string }[];
};

export function mouserConfigured() {
  return Boolean(process.env.MOUSER_API_KEY);
}

async function call(path: string, body: unknown): Promise<MouserPart[]> {
  const key = process.env.MOUSER_API_KEY;
  if (!key) throw new Error("mouser_not_configured");
  const res = await fetch(`${BASE}/${path}?apiKey=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429) throw new Error("mouser_rate_limited");
  if (!res.ok) throw new Error(`mouser_${res.status}`);
  const data = (await res.json()) as { Errors?: { Message?: string }[]; SearchResults?: { Parts?: MouserPart[] } };
  if (data.Errors?.length) throw new Error(`mouser: ${data.Errors.map((e) => e.Message).join("; ")}`);
  return data.SearchResults?.Parts ?? [];
}

/** "$1,234.50" / "1.234,50 €" → 1234.5 */
function money(s: string | undefined): number | null {
  if (!s) return null;
  let t = s.replace(/[^\d.,]/g, "");
  if (/,\d{1,3}$/.test(t) && !t.includes(".")) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return t && Number.isFinite(n) ? n : null;
}

export function mapMouser(p: MouserPart): SupplierProduct | null {
  if (!p.MouserPartNumber || p.MouserPartNumber === "N/A") return null;
  const first = [...(p.PriceBreaks ?? [])].sort((a, b) => a.Quantity - b.Quantity)[0];
  const inStock = Number(p.AvailabilityInStock ?? 0);
  const lead = /(\d+)\s*day/i.exec(p.LeadTime ?? "");
  const leadWeeks = /(\d+)\s*week/i.exec(p.LeadTime ?? "");
  return {
    supplierCode: "mouser",
    supplierSku: p.MouserPartNumber,
    mpn: p.ManufacturerPartNumber ?? null,
    manufacturer: p.Manufacturer ?? null,
    name: [p.Manufacturer, p.ManufacturerPartNumber].filter(Boolean).join(" ") || p.MouserPartNumber,
    description: p.Description ?? null,
    category: p.Category ?? null,
    imageUrl: p.ImagePath || null,
    url: p.ProductDetailUrl || null,
    datasheetUrl: p.DataSheetUrl || null,
    cost: money(first?.Price),
    currency: first?.Currency || "USD",
    // In stock at Mouser means it ships from their warehouse; we still add our own transit.
    availability: inStock > 0 ? "in_stock" : (p.AvailabilityOnOrder?.length ?? 0) > 0 ? "backorder" : "unavailable",
    leadTimeDays: inStock > 0 ? 7 : lead ? Number(lead[1]) : leadWeeks ? Number(leadWeeks[1]) * 7 : null,
    moq: Math.max(1, Number(p.Min) || 1),
    parameters: (p.ProductAttributes ?? []).map((a) => ({ name: a.AttributeName, value: a.AttributeValue })),
  };
}

export async function mouserSearch(keyword: string, limit = 10): Promise<SupplierProduct[]> {
  const parts = await call("keyword", {
    SearchByKeywordRequest: { keyword, records: Math.min(limit, 50), startingRecord: 0 },
  });
  return parts.map(mapMouser).filter((x): x is SupplierProduct => !!x);
}

export async function mouserPart(partNumber: string): Promise<SupplierProduct | null> {
  const parts = await call("partnumber", {
    SearchByPartRequest: { mouserPartNumber: partNumber, partSearchOptions: "Exact" },
  });
  return parts.map(mapMouser).find((x): x is SupplierProduct => !!x) ?? null;
}
