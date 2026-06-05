"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";

export type ItemFormState = { error?: string };

type ParsedItem = {
  values: {
    sku: string;
    name: string;
    description: string | null;
    category: string | null;
    quantity: number;
    unit: string;
    unit_price: number | null;
    low_stock_threshold: number | null;
  };
};

// Shared parse + validation for create and edit. Returns either parsed values
// or a translated error string.
async function parseItem(
  formData: FormData,
  t: Awaited<ReturnType<typeof getTranslations>>
): Promise<ParsedItem | { error: string }> {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const priceRaw = String(formData.get("unit_price") ?? "").trim();
  const thresholdRaw = String(formData.get("low_stock_threshold") ?? "").trim();

  if (!sku || !name || !unit) return { error: t("error_required") };

  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { error: t("error_quantity") };
  }

  let unit_price: number | null = null;
  if (priceRaw !== "") {
    unit_price = Number(priceRaw);
    if (Number.isNaN(unit_price) || unit_price < 0) {
      return { error: t("error_price") };
    }
  }

  let low_stock_threshold: number | null = null;
  if (thresholdRaw !== "") {
    low_stock_threshold = Number(thresholdRaw);
    if (!Number.isInteger(low_stock_threshold) || low_stock_threshold < 0) {
      return { error: t("error_threshold") };
    }
  }

  return {
    values: {
      sku,
      name,
      description: description || null,
      category: category || null,
      quantity,
      unit,
      unit_price,
      low_stock_threshold,
    },
  };
}

export async function createItem(
  _prev: ItemFormState,
  formData: FormData
): Promise<ItemFormState> {
  const locale = String(formData.get("locale") ?? "en");
  const t = await getTranslations({ locale, namespace: "Inventory" });

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const parsed = await parseItem(formData, t);
  if ("error" in parsed) return { error: parsed.error };

  // Determine tenant: super_admin chooses; everyone else is forced to their own.
  let tenant_id: string | null;
  if (session.profile.role === "super_admin") {
    tenant_id = String(formData.get("tenant_id") ?? "") || null;
    if (!tenant_id) return { error: t("error_tenant_required") };
  } else {
    tenant_id = session.profile.tenant_id;
    if (!tenant_id) return { error: t("error_no_tenant") };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_items")
    .insert({ ...parsed.values, tenant_id });

  if (error) {
    if (error.code === "23505") return { error: t("error_sku_taken") };
    return { error: t("error_unknown") };
  }

  revalidatePath(`/${locale}/dashboard/inventory`);
  redirect(`/${locale}/dashboard/inventory`);
}

export async function updateItem(
  _prev: ItemFormState,
  formData: FormData
): Promise<ItemFormState> {
  const locale = String(formData.get("locale") ?? "en");
  const id = String(formData.get("id") ?? "");
  const t = await getTranslations({ locale, namespace: "Inventory" });

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!id) return { error: t("error_unknown") };

  const parsed = await parseItem(formData, t);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  // RLS restricts which rows this can touch; we never change tenant_id here.
  const { error } = await supabase
    .from("inventory_items")
    .update(parsed.values)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: t("error_sku_taken") };
    return { error: t("error_unknown") };
  }

  revalidatePath(`/${locale}/dashboard/inventory`);
  redirect(`/${locale}/dashboard/inventory`);
}

export async function deleteItem(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "en");
  const id = String(formData.get("id") ?? "");

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!id) return;

  const supabase = await createClient();
  // RLS ensures only permitted rows are deleted.
  await supabase.from("inventory_items").delete().eq("id", id);

  revalidatePath(`/${locale}/dashboard/inventory`);
}
