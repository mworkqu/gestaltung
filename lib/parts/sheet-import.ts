import type { StockStatus } from "@/lib/supabase/types";
import { compareSku, normalizeMaterial, partKey } from "@/lib/parts/part-key";

// Google-Sheet → store catalog import (Stage "store filling"). The owner keeps a
// spreadsheet on Google Drive, publishes it to the web as CSV, and the admin
// import page upserts those rows into the `parts` table (the STORE catalog — a
// completely separate thing from the production `inventory_items`). Pure /
// dependency-free so it stays easy to reason about and test.
//
// One product per normalised name + material + pack size (audit #7, migration
// 0030). Rows that would create a second copy are skipped with a reason:
//   duplicate_of <sku>  the sheet already has this product on another row
//   exists_as <sku>     the store already has it under another SKU (or this
//                       SKU was merged into <sku>)

export type SheetPart = {
  sku: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  category: string;
  material: string | null;
  standard: string | null;
  unit_price: number;
  min_order_qty: number;
  stock_status: StockStatus;
  image_url: string | null;
  is_published: boolean;
  /** Matcher keywords (migration 0023). Only sent when the sheet has the column. */
  tags?: string[];
  /** Pieces per sold unit (0025). Only sent when the sheet has the column. */
  pack_size?: number;
};

export type SkipReason = "missing_required" | "duplicate_sku" | "bad_price" | "duplicate_of" | "exists_as";

/** `ref` is the SKU the row duplicates (duplicate_of / exists_as). */
export type SkippedRow = { row: number; sku: string; reason: SkipReason; ref?: string };

/** A product already in the store, as the import needs to see it. */
export type ExistingPart = {
  sku: string;
  name: string;
  material: string | null;
  pack_size: number | null;
  /** SKU of the product this row was merged into (0030), else null. */
  merged_into_sku: string | null;
};

export type SheetParseResult = {
  valid: SheetPart[];
  skipped: SkippedRow[];
  totalRows: number;
  error?: "no_header" | "no_rows" | "missing_columns";
  missing?: string[];
};

// The columns the sheet may provide. Header matching is case-insensitive and
// space/underscore-insensitive; several friendly aliases map to each field.
const HEADER_ALIASES: Record<string, string> = {
  sku: "sku",
  name: "name",
  name_en: "name",
  name_ar: "name_ar",
  arabic_name: "name_ar",
  description: "description",
  description_en: "description",
  description_ar: "description_ar",
  category: "category",
  material: "material",
  standard: "standard",
  unit_price: "unit_price",
  price: "unit_price",
  price_qar: "unit_price",
  min_order_qty: "min_order_qty",
  min_qty: "min_order_qty",
  minimum_order: "min_order_qty",
  stock_status: "stock_status",
  stock: "stock_status",
  availability: "stock_status",
  image_url: "image_url",
  tags: "tags",
  pack_size: "pack_size",
  pack: "pack_size",
  keywords: "tags",
  image: "image_url",
  photo: "image_url",
  is_published: "is_published",
  published: "is_published",
  visible: "is_published",
};

const REQUIRED = ["sku", "name", "category", "unit_price"];

function normalizeHeader(h: string): string {
  // Tolerant: strip the "*" required-markers people copy from the column list,
  // collapse any run of punctuation/space (stray commas, quotes) to a single
  // underscore, and trim edge underscores. So "sku*", "name *", ", category*"
  // and "Unit Price" all resolve to sku / name / category / unit_price.
  return h
    .trim()
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""),
// commas inside quotes, and both \n and \r\n line endings.
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseBool(v: string, fallback: boolean): boolean {
  const t = v.trim().toLowerCase();
  if (t === "") return fallback;
  if (["true", "1", "yes", "y", "published", "visible"].includes(t)) return true;
  if (["false", "0", "no", "n", "draft", "hidden"].includes(t)) return false;
  return fallback;
}

// Only keep image values that are real http(s) URLs. Guards the catalog against
// junk in the sheet's image column (e.g. the literal "[link removed]" or a bare
// filename) that would otherwise render as a broken image.
function cleanImageUrl(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseStock(v: string): StockStatus {
  const t = v.trim().toLowerCase().replace(/\s+/g, "_");
  if (["low", "low_stock"].includes(t)) return "low_stock";
  if (["out", "out_of_stock", "oos", "sold_out"].includes(t)) return "out_of_stock";
  return "in_stock"; // default + "in"/"in_stock"/blank/unknown
}

// Turn raw CSV text into validated catalog rows. Blank lines are ignored; rows
// missing a required field, or that would duplicate a product (in the sheet or
// in `existing`, the store as it is now), are collected in `skipped` with a
// reason, in row order.
export function parseSheet(text: string, existing: ExistingPart[] = []): SheetParseResult {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) {
    return { valid: [], skipped: [], totalRows: 0, error: "no_header" };
  }

  const headerRow = rows[0].map(normalizeHeader);
  const colIndex: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const canon = HEADER_ALIASES[h];
    if (canon && !(canon in colIndex)) colIndex[canon] = i;
  });

  const missing = REQUIRED.filter((r) => !(r in colIndex));
  if (missing.length > 0) {
    return {
      valid: [],
      skipped: [],
      totalRows: rows.length - 1,
      error: "missing_columns",
      missing,
    };
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    return { valid: [], skipped: [], totalRows: 0, error: "no_rows" };
  }

  const candidates: { row: number; part: SheetPart }[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();

  const cell = (r: string[], key: string) => {
    const i = colIndex[key];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };
  const opt = (r: string[], key: string) => {
    const v = cell(r, key);
    return v === "" ? null : v;
  };

  dataRows.forEach((r, idx) => {
    const rowNum = idx + 2; // 1-based, +1 for the header row
    const sku = cell(r, "sku");
    const name = cell(r, "name");
    const category = cell(r, "category");
    const priceRaw = cell(r, "unit_price").replace(/[^\d.,-]/g, "").replace(",", ".");

    if (!sku || !name || !category) {
      skipped.push({ row: rowNum, sku, reason: "missing_required" });
      return;
    }
    if (seen.has(sku.toLowerCase())) {
      skipped.push({ row: rowNum, sku, reason: "duplicate_sku" });
      return;
    }
    const unit_price = Number(priceRaw);
    if (priceRaw === "" || Number.isNaN(unit_price) || unit_price < 0) {
      skipped.push({ row: rowNum, sku, reason: "bad_price" });
      return;
    }

    let min_order_qty = 1;
    const minRaw = cell(r, "min_order_qty");
    if (minRaw !== "") {
      const n = Number(minRaw);
      if (Number.isInteger(n) && n >= 1) min_order_qty = n;
    }

    seen.add(sku.toLowerCase());
    candidates.push({ row: rowNum, part: {
      sku,
      name,
      name_ar: opt(r, "name_ar"),
      description: opt(r, "description"),
      description_ar: opt(r, "description_ar"),
      category,
      // Stored lower snake_case ("Aluminum" → "aluminum"), as 0030 does.
      material: normalizeMaterial(opt(r, "material")),
      standard: opt(r, "standard"),
      unit_price,
      min_order_qty,
      stock_status: parseStock(cell(r, "stock_status")),
      image_url: cleanImageUrl(opt(r, "image_url")),
      // Default to published so a freshly filled sheet shows up in the store.
      is_published: parseBool(cell(r, "is_published"), true),
      // Comma- or semicolon-separated, e.g. "servo, 5v, 3kg". Only included
      // when the column exists, so a sheet without it still imports into a
      // database that has not run 0023.
      ...("pack_size" in colIndex && Number(cell(r, "pack_size")) >= 1
        ? { pack_size: Math.trunc(Number(cell(r, "pack_size"))) }
        : {}),
      ...("tags" in colIndex
        ? {
            tags: cell(r, "tags")
              .split(/[,;،]/)
              .map((x) => x.trim().toLowerCase())
              .filter(Boolean)
              .slice(0, 30),
          }
        : {}),
    } });
  });

  const { valid, skipped: dupes } = collapseDuplicates(candidates, existing);
  skipped.push(...dupes);
  skipped.sort((a, b) => a.row - b.row);

  return { valid, skipped, totalRows: dataRows.length };
}

// One product per key. Within a key group:
//   * a row whose SKU was merged into another product → exists_as <survivor>
//   * the store already has the key under SKU S:
//       the row with SKU S (if any) is imported, the rest → duplicate_of S;
//       with no row for S, every row → exists_as S
//   * otherwise the first row is imported, the rest → duplicate_of <first>
// A row without a pack_size column is keyed with the stored pack size for its
// SKU (the upsert leaves that column alone), else 1.
function collapseDuplicates(
  candidates: { row: number; part: SheetPart }[],
  existing: ExistingPart[]
): { valid: SheetPart[]; skipped: SkippedRow[] } {
  const bySku = new Map(existing.map((e) => [e.sku.toLowerCase(), e]));
  // Key → SKU of the live (unmerged) product. With several (a store that has
  // not run 0030 yet), the one 0030 would keep: lowest SKU in natural order.
  const liveByKey = new Map<string, string>();
  for (const e of existing) {
    if (e.merged_into_sku) continue;
    const k = partKey(e.name, e.material, e.pack_size);
    const cur = liveByKey.get(k);
    if (cur === undefined || compareSku(e.sku, cur) < 0) liveByKey.set(k, e.sku);
  }

  const groups = new Map<string, { row: number; part: SheetPart }[]>();
  const skipped: SkippedRow[] = [];
  for (const c of candidates) {
    const stored = bySku.get(c.part.sku.toLowerCase());
    if (stored?.merged_into_sku) {
      skipped.push({ row: c.row, sku: c.part.sku, reason: "exists_as", ref: stored.merged_into_sku });
      continue;
    }
    const k = partKey(c.part.name, c.part.material, c.part.pack_size ?? stored?.pack_size ?? 1);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }

  const keep = new Set<{ row: number; part: SheetPart }>();
  for (const [k, rows] of groups) {
    const liveSku = liveByKey.get(k);
    const winner = liveSku
      ? rows.find((c) => c.part.sku.toLowerCase() === liveSku.toLowerCase())
      : rows[0];
    for (const c of rows) {
      if (c === winner) keep.add(c);
      else if (winner) skipped.push({ row: c.row, sku: c.part.sku, reason: "duplicate_of", ref: winner.part.sku });
      else skipped.push({ row: c.row, sku: c.part.sku, reason: "exists_as", ref: liveSku });
    }
  }

  return { valid: candidates.filter((c) => keep.has(c)).map((c) => c.part), skipped };
}

// The canonical column list, shown to the owner on the import page.
export const SHEET_COLUMNS = [
  { key: "sku", required: true },
  { key: "name", required: true },
  { key: "category", required: true },
  { key: "unit_price", required: true },
  { key: "name_ar", required: false },
  { key: "description", required: false },
  { key: "description_ar", required: false },
  { key: "material", required: false },
  { key: "standard", required: false },
  { key: "min_order_qty", required: false },
  { key: "stock_status", required: false },
  { key: "image_url", required: false },
  { key: "is_published", required: false },
  { key: "tags", required: false },
  { key: "pack_size", required: false },
] as const;
