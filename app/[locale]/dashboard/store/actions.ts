"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import { STOCK_STATUSES } from "@/lib/parts/constants";
import { parseSheet, type SkippedRow } from "@/lib/parts/sheet-import";
import type { StockStatus } from "@/lib/supabase/types";

export type PartFormState = { error?: string };

// The locale comes from a hidden form field (attacker-controllable). Pin it to a
// known locale so it can never steer redirect() to a crafted path.
function safeLocale(formData: FormData): "en" | "ar" {
  return String(formData.get("locale")) === "ar" ? "ar" : "en";
}

type ParsedPart = {
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

async function parsePart(
  formData: FormData,
  t: Awaited<ReturnType<typeof getTranslations>>
): Promise<ParsedPart | { error: string }> {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const priceRaw = String(formData.get("unit_price") ?? "").trim();
  const minQtyRaw = String(formData.get("min_order_qty") ?? "").trim();
  const stockStatus = String(formData.get("stock_status") ?? "").trim();

  if (!sku || !name || !category) return { error: t("error_required") };

  const unit_price = Number(priceRaw);
  if (priceRaw === "" || Number.isNaN(unit_price) || unit_price < 0) {
    return { error: t("error_price") };
  }

  let min_order_qty = 1;
  if (minQtyRaw !== "") {
    min_order_qty = Number(minQtyRaw);
    if (!Number.isInteger(min_order_qty) || min_order_qty < 1) {
      return { error: t("error_min_qty") };
    }
  }

  if (!(STOCK_STATUSES as readonly string[]).includes(stockStatus)) {
    return { error: t("error_stock") };
  }

  const opt = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v === "" ? null : v;
  };

  return {
    sku,
    name,
    name_ar: opt("name_ar"),
    description: opt("description"),
    description_ar: opt("description_ar"),
    category,
    material: opt("material"),
    standard: opt("standard"),
    unit_price,
    min_order_qty,
    stock_status: stockStatus as StockStatus,
    image_url: opt("image_url"),
    is_published: formData.get("is_published") === "on",
  };
}

export async function createPart(
  _prev: PartFormState,
  formData: FormData
): Promise<PartFormState> {
  const locale = safeLocale(formData);
  const t = await getTranslations({ locale, namespace: "PartsDashboard" });

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);

  const parsed = await parsePart(formData, t);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("parts").insert(parsed);

  if (error) {
    if (error.code === "23505") return { error: t("error_sku_taken") };
    return { error: t("error_unknown") };
  }

  revalidatePath(`/${locale}/dashboard/store`);
  redirect(`/${locale}/dashboard/store`);
}

export async function updatePart(
  _prev: PartFormState,
  formData: FormData
): Promise<PartFormState> {
  const locale = safeLocale(formData);
  const id = String(formData.get("id") ?? "");
  const t = await getTranslations({ locale, namespace: "PartsDashboard" });

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);
  if (!id) return { error: t("error_unknown") };

  const parsed = await parsePart(formData, t);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("parts").update(parsed).eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: t("error_sku_taken") };
    return { error: t("error_unknown") };
  }

  revalidatePath(`/${locale}/dashboard/store`);
  redirect(`/${locale}/dashboard/store`);
}

export async function deletePart(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const id = String(formData.get("id") ?? "");

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("parts").delete().eq("id", id);

  revalidatePath(`/${locale}/dashboard/store`);
}

// ─── Google Sheet import ("store filling") ──────────────────────────────────
// Fetches a published Google-Sheet CSV and upserts its rows into the STORE
// catalog (`parts`) by SKU. This is the store the owner sells from — separate
// from the production inventory. Re-importing treats the sheet as the source of
// truth (existing SKUs are overwritten). super_admin only; RLS enforces it too.
export type ImportResult = {
  ok?: boolean;
  error?:
    | "auth"
    | "bad_url"
    | "bad_host"
    | "fetch_failed"
    | "no_header"
    | "no_rows"
    | "missing_columns"
    | "db"
    | "empty";
  missing?: string[];
  imported?: number;
  skipped?: SkippedRow[];
  totalRows?: number;
};

export async function importPartsFromSheet(
  locale: "en" | "ar",
  csvUrl: string
): Promise<ImportResult> {
  const session = await getSessionContext();
  if (!session || session.profile.role !== "super_admin") {
    return { error: "auth" };
  }

  // Validate the URL: https only, and restricted to Google hosts. Only the
  // super_admin can reach this, but pinning the host still avoids the action
  // being used as an arbitrary server-side fetcher (SSRF).
  let url: URL;
  try {
    url = new URL(csvUrl.trim());
  } catch {
    return { error: "bad_url" };
  }
  if (url.protocol !== "https:") return { error: "bad_url" };
  const host = url.hostname.toLowerCase();
  const hostOk =
    host === "docs.google.com" ||
    host.endsWith(".google.com") ||
    host.endsWith(".googleusercontent.com");
  if (!hostOk) return { error: "bad_host" };

  // Fetch the CSV with a timeout and a size cap.
  let text: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return { error: "fetch_failed" };
    text = (await res.text()).slice(0, 2_000_000); // ~2MB cap
  } catch {
    return { error: "fetch_failed" };
  }

  const parsed = parseSheet(text);
  if (parsed.error) {
    return { error: parsed.error, missing: parsed.missing };
  }
  if (parsed.valid.length === 0) {
    return { error: "empty", skipped: parsed.skipped, totalRows: parsed.totalRows };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("parts")
    .upsert(parsed.valid, { onConflict: "sku" });
  if (error) return { error: "db" };

  revalidatePath(`/${locale}/dashboard/store`);
  revalidatePath(`/${locale}/store`);
  return {
    ok: true,
    imported: parsed.valid.length,
    skipped: parsed.skipped,
    totalRows: parsed.totalRows,
  };
}

// Inline publish/unpublish toggle from the catalog table.
export async function togglePublished(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const id = String(formData.get("id") ?? "");
  const next = formData.get("is_published") === "true";

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("parts").update({ is_published: next }).eq("id", id);

  revalidatePath(`/${locale}/dashboard/store`);
}
