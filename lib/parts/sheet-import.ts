import type { StockStatus } from "@/lib/supabase/types";

// Google-Sheet → store catalog import (Stage "store filling"). The owner keeps a
// spreadsheet on Google Drive, publishes it to the web as CSV, and the admin
// import page upserts those rows into the `parts` table (the STORE catalog — a
// completely separate thing from the production `inventory_items`). Pure /
// dependency-free so it stays easy to reason about and test.

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
};

export type SkippedRow = { row: number; sku: string; reason: string };

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
  image: "image_url",
  photo: "image_url",
  is_published: "is_published",
  published: "is_published",
  visible: "is_published",
};

const REQUIRED = ["sku", "name", "category", "unit_price"];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
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

function parseStock(v: string): StockStatus {
  const t = v.trim().toLowerCase().replace(/\s+/g, "_");
  if (["low", "low_stock"].includes(t)) return "low_stock";
  if (["out", "out_of_stock", "oos", "sold_out"].includes(t)) return "out_of_stock";
  return "in_stock"; // default + "in"/"in_stock"/blank/unknown
}

// Turn raw CSV text into validated catalog rows. Blank lines are ignored; rows
// missing a required field are collected in `skipped` with a reason.
export function parseSheet(text: string): SheetParseResult {
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

  const valid: SheetPart[] = [];
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
    valid.push({
      sku,
      name,
      name_ar: opt(r, "name_ar"),
      description: opt(r, "description"),
      description_ar: opt(r, "description_ar"),
      category,
      material: opt(r, "material"),
      standard: opt(r, "standard"),
      unit_price,
      min_order_qty,
      stock_status: parseStock(cell(r, "stock_status")),
      image_url: opt(r, "image_url"),
      // Default to published so a freshly filled sheet shows up in the store.
      is_published: parseBool(cell(r, "is_published"), true),
    });
  });

  return { valid, skipped, totalRows: dataRows.length };
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
] as const;
