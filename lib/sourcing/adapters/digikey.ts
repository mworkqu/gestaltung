// DigiKey adapter (Task 19b): the official Product Information API v4 with a
// two-legged OAuth token (DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET,
// server-only). Gives price, stock, manufacturer lead time and full
// parametric data — the source for our typed attributes.

import type { SupplierAdapter, SupplierProduct } from "@/lib/sourcing/types";

export const digikeyAdapter: SupplierAdapter = { code: "digikey", kind: "api" };

const API = "https://api.digikey.com";

type Category = { Name?: string; ChildCategories?: Category[] };
type Variation = {
  DigiKeyProductNumber?: string;
  MinimumOrderQuantity?: number;
  QuantityAvailableforPackageType?: number;
  StandardPricing?: { BreakQuantity: number; UnitPrice: number }[];
};
type DkProduct = {
  Description?: { ProductDescription?: string; DetailedDescription?: string };
  Manufacturer?: { Name?: string };
  ManufacturerProductNumber?: string;
  UnitPrice?: number;
  ProductUrl?: string;
  DatasheetUrl?: string;
  PhotoUrl?: string;
  ProductVariations?: Variation[];
  QuantityAvailable?: number;
  ManufacturerLeadWeeks?: string;
  Discontinued?: boolean;
  EndOfLife?: boolean;
  Parameters?: { ParameterText?: string; ValueText?: string }[];
  Category?: Category;
};

export function digikeyConfigured() {
  return Boolean(process.env.DIGIKEY_CLIENT_ID && process.env.DIGIKEY_CLIENT_SECRET);
}

let token: { value: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const id = process.env.DIGIKEY_CLIENT_ID;
  const secret = process.env.DIGIKEY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("digikey_not_configured");
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`digikey_token_${res.status}`);
  const d = (await res.json()) as { access_token: string; expires_in?: number };
  token = { value: d.access_token, expires: Date.now() + (d.expires_in ?? 600) * 1000 };
  return token.value;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "X-DIGIKEY-Client-Id": process.env.DIGIKEY_CLIENT_ID!,
      "X-DIGIKEY-Locale-Site": "US",
      "X-DIGIKEY-Locale-Language": "en",
      "X-DIGIKEY-Locale-Currency": "USD",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error("digikey_rate_limited");
  if (!res.ok) throw new Error(`digikey_${res.status}`);
  return (await res.json()) as T;
}

function leafCategory(c: Category | undefined): string | null {
  let cur = c;
  while (cur?.ChildCategories?.length) cur = cur.ChildCategories[0];
  return cur?.Name ?? null;
}

export function mapDigikey(p: DkProduct): SupplierProduct | null {
  // The variation you can buy in the smallest quantity (cut tape, bulk) is the one we'd order.
  const v = [...(p.ProductVariations ?? [])]
    .filter((x) => x.DigiKeyProductNumber)
    .sort((a, b) => (a.MinimumOrderQuantity ?? 1e9) - (b.MinimumOrderQuantity ?? 1e9))[0];
  const sku = v?.DigiKeyProductNumber ?? p.ManufacturerProductNumber;
  if (!sku) return null;
  const firstBreak = [...(v?.StandardPricing ?? [])].sort((a, b) => a.BreakQuantity - b.BreakQuantity)[0];
  const stock = v?.QuantityAvailableforPackageType ?? p.QuantityAvailable ?? 0;
  const weeks = Number(p.ManufacturerLeadWeeks);
  return {
    supplierCode: "digikey",
    supplierSku: sku,
    mpn: p.ManufacturerProductNumber ?? null,
    manufacturer: p.Manufacturer?.Name ?? null,
    name: [p.Manufacturer?.Name, p.ManufacturerProductNumber].filter(Boolean).join(" ") || sku,
    description: p.Description?.DetailedDescription || p.Description?.ProductDescription || null,
    category: leafCategory(p.Category),
    imageUrl: p.PhotoUrl || null,
    url: p.ProductUrl || null,
    datasheetUrl: p.DatasheetUrl || null,
    cost: firstBreak?.UnitPrice ?? p.UnitPrice ?? null,
    currency: "USD",
    availability: p.Discontinued || p.EndOfLife ? "unavailable" : stock > 0 ? "in_stock" : "backorder",
    // In stock: DigiKey ships within days; otherwise the manufacturer's lead time.
    leadTimeDays: stock > 0 ? 7 : Number.isFinite(weeks) && weeks > 0 ? weeks * 7 : null,
    moq: Math.max(1, v?.MinimumOrderQuantity ?? 1),
    parameters: (p.Parameters ?? [])
      .filter((x) => x.ParameterText && x.ValueText && x.ValueText !== "-")
      .map((x) => ({ name: x.ParameterText!, value: x.ValueText! })),
  };
}

export async function digikeySearch(keyword: string, limit = 10): Promise<SupplierProduct[]> {
  const d = await call<{ Products?: DkProduct[] }>("/products/v4/search/keyword", {
    method: "POST",
    body: JSON.stringify({ Keywords: keyword, Limit: Math.min(limit, 50), Offset: 0 }),
  });
  return (d?.Products ?? []).map(mapDigikey).filter((x): x is SupplierProduct => !!x);
}

export async function digikeyPart(productNumber: string): Promise<SupplierProduct | null> {
  const d = await call<{ Product?: DkProduct }>(
    `/products/v4/search/${encodeURIComponent(productNumber)}/productdetails`
  );
  return d?.Product ? mapDigikey(d.Product) : null;
}
