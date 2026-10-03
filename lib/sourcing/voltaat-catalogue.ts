// Voltaat catalogue import (owner decision 2026-09-28: fill the store mainly
// from Voltaat, our reseller partner, published at Voltaat's own price).
// Pure: turns Voltaat's public catalogue into our products + offers. One
// product per Voltaat product (its first option in stock), priced in mirror mode so the daily
// sync keeps the price equal to Voltaat's. Photos stay on Voltaat's Shopify
// CDN (resized by URL) rather than being copied, to keep our storage small.

import { partKey } from "@/lib/parts/part-key";
import { VOLTAAT_BASE } from "@/lib/sourcing/adapters/voltaat";

export type RawVoltaatProduct = {
  id: number;
  handle: string;
  title: string;
  body_html?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  images?: { src: string; variant_ids?: number[] }[];
  variants: { id: number; title: string; sku?: string | null; price: string; available: boolean; featured_image?: { src: string } | null }[];
};

// Voltaat's product_type codes → our store categories (existing names where they fit).
const TYPE_PREFIX: [RegExp, string][] = [
  [/^3DP_Printers/i, "3D printers"],
  [/^3DP_Filaments/i, "3D printing filament"],
  [/^3DP/i, "3D printer parts"],
  [/^(DEVB|DEVEB)_(RPI)/i, "Raspberry Pi"],
  [/^(DEVB|DEVEB)_ESP/i, "Microcontrollers"],
  [/^(DEVB|DEVEB)_Arduino_Kits/i, "Kits"],
  [/^(DEVB|DEVEB)_Arduino/i, "Microcontrollers"],
  [/^(DEVB|DEVEB)/i, "Microcontrollers"],
  [/^CHIPS_Microcontrollers/i, "Microcontrollers"],
  [/^CHIPS/i, "Chips & ICs"],
  [/^MOD_Display/i, "Displays"],
  [/^MOD_Relays/i, "Modules"],
  [/^(MOD|R2U)/i, "Modules"],
  [/^SENS/i, "Sensors"],
  [/^Motors_Drivers/i, "Modules"],
  [/^Motors/i, "Motors"],
  [/^PWR_Solar/i, "Power"],
  [/^PWR/i, "Power"],
  [/^COMP_Jumper/i, "Prototyping"],
  [/^COMP/i, "Components"],
  [/^MECH_Screws/i, "Fasteners"],
  [/^MECH/i, "Mechanical"],
  [/^TOOLS/i, "Tools"],
  [/^(Drones|KIDS|VOLT)/i, "Kits"],
];

const TITLE_HINTS: [RegExp, string][] = [
  [/\b(arduino|esp32|esp8266|stm32|pico|microcontroller)\b/i, "Microcontrollers"],
  [/\braspberry\b/i, "Raspberry Pi"],
  [/\bsensor\b/i, "Sensors"],
  [/\b(motor|servo|stepper|pump|fan)\b/i, "Motors"],
  [/\b(battery|charger|adapter|power supply|solar|converter|regulator)\b/i, "Power"],
  [/\b(lcd|oled|display|screen)\b/i, "Displays"],
  [/\b(filament|nozzle|hotend|extruder|bambu)\b/i, "3D printer parts"],
  [/\b(screw|nut|bolt|washer|insert)\b/i, "Fasteners"],
  [/\b(solder|plier|screwdriver|multimeter|tweezer|tool)\b/i, "Tools"],
  [/\b(module|shield|relay)\b/i, "Modules"],
  [/\b(led|resistor|capacitor|diode|transistor|switch|button|wire|cable|connector|header)\b/i, "Components"],
  [/\bkit\b/i, "Kits"],
];

export function categoryFor(productType: string | null | undefined, title: string): string {
  const t = (productType ?? "").trim();
  for (const [re, cat] of TYPE_PREFIX) if (t && re.test(t)) return cat;
  for (const [re, cat] of TITLE_HINTS) if (re.test(title)) return cat;
  return "Other";
}

export function stripHtml(html: string | null | undefined, max = 2000): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^Description\s*\n/i, "")
    .trim();
  return text ? text.slice(0, max) : null;
}

/** Shopify CDN URL at a given width. */
export function cdnImage(src: string, width: number): string {
  return `${src}${src.includes("?") ? "&" : "?"}width=${width}`;
}

export type ImportRow = {
  handle: string;
  variantId: number;
  part: {
    sku: string;
    name: string;
    description: string | null;
    category: string;
    unit_price: number;
    min_order_qty: number;
    stock_status: "in_stock";
    is_published: boolean;
    pricing_mode: "mirror";
    image_url: string | null;
    images: { web: string; thumb: string; path: null; drive_file_id: null }[];
  };
  offer: {
    supplier_url: string;
    supplier_sku: string;
    retail_price: number;
    currency: "QAR";
    availability: "in_stock" | "unavailable";
    lead_time_days: number | null;
    active: boolean;
    pack_size: 1;
    moq: 1;
  };
};

/**
 * Rows to create, one per Voltaat product. Skips products we already follow,
 * products whose name/material/pack identity already exists in our store,
 * and repeats inside Voltaat's own catalogue (it has "… copy" listings).
 * Out-of-stock options get an inactive offer: the product shows "available
 * on request" until the daily sync sees it back in stock.
 */
export function buildImportRows(
  products: RawVoltaatProduct[],
  opts: { mappedKeys: Set<string>; existingPartKeys: Set<string>; publish: boolean }
): { rows: ImportRow[]; skippedMapped: number; skippedDuplicate: number } {
  const rows: ImportRow[] = [];
  const seen = new Set(opts.existingPartKeys);
  const mappedHandles = new Set([...opts.mappedKeys].map((k) => k.split("|")[0]));
  let skippedMapped = 0;
  let skippedDuplicate = 0;
  for (const p of products) {
    const handle = p.handle.toLowerCase();
    if (mappedHandles.has(handle)) {
      skippedMapped++;
      continue;
    }
    // One product per Voltaat product (owner, 2026-09-29: one card per option
    // looked like duplicates). We follow the first option in stock, else the
    // first; the other options are listed in the description.
    const priced = p.variants.filter((v) => Number.isFinite(Number(v.price)) && Number(v.price) > 0);
    const v = priced.find((x) => x.available) ?? priced[0];
    const name = p.title.trim().slice(0, 160);
    const key = partKey(name, null, 1);
    // Voltaat's own gift cards are not ours to sell (owner, C5 2026-10-04).
    if (!v || !name || seen.has(key) || isGiftCard(p)) {
      skippedDuplicate++;
      continue;
    }
    seen.add(key);
    const price = Number(v.price);
    const options = variantOptions(p.variants);
    const description = [stripHtml(p.body_html), options.length > 1 ? optionsNote(options) : null].filter(Boolean).join("\n\n") || null;
    const img = v.featured_image?.src ?? p.images?.find((i) => i.variant_ids?.includes(v.id))?.src ?? p.images?.[0]?.src ?? null;
    rows.push({
      handle,
      variantId: v.id,
      part: {
        sku: `VLT-${v.id}`,
        name,
        description,
        category: categoryFor(p.product_type, p.title),
        unit_price: price,
        min_order_qty: 1,
        stock_status: "in_stock",
        is_published: opts.publish,
        pricing_mode: "mirror",
        image_url: img ? cdnImage(img, 1000) : null,
        images: img ? [{ web: cdnImage(img, 1000), thumb: cdnImage(img, 400), path: null, drive_file_id: null }] : [],
      },
      offer: {
        supplier_url: `${VOLTAAT_BASE}/products/${handle}?variant=${v.id}`,
        supplier_sku: v.sku || String(v.id),
        retail_price: price,
        currency: "QAR",
        availability: v.available ? "in_stock" : "unavailable",
        lead_time_days: v.available ? 1 : null,
        active: v.available,
        pack_size: 1,
        moq: 1,
      },
    });
  }
  return { rows, skippedMapped, skippedDuplicate };
}

/** A Voltaat gift card (Shopify product type "Gift Card" or the word in the title). Never imported. */
export function isGiftCard(p: Pick<RawVoltaatProduct, "title" | "product_type">): boolean {
  return /gift\s*card/i.test(p.title) || /gift\s*card/i.test(p.product_type ?? "");
}

/** Option names worth showing ("Default Title" is Shopify's name for none). */
export function variantOptions(variants: { title: string }[]): string[] {
  return variants.map((v) => v.title?.trim()).filter((t): t is string => !!t && t !== "Default Title");
}

export function optionsNote(options: string[]): string {
  return `Options: ${options.join(", ")}. Tell us which one you need in the order notes.`;
}
