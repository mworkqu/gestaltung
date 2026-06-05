"use client";

import { useActionState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InventoryItem, Tenant } from "@/lib/supabase/types";
import {
  createItem,
  updateItem,
  type ItemFormState,
} from "@/app/[locale]/dashboard/inventory/actions";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function ItemForm({
  mode,
  item,
  tenants,
}: {
  mode: "create" | "edit";
  item?: InventoryItem;
  // Provided only for super_admin on create (tenant picker).
  tenants?: Pick<Tenant, "id" | "name">[];
}) {
  const t = useTranslations("Inventory");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const action = mode === "create" ? createItem : updateItem;
  const [state, formAction, pending] = useActionState<ItemFormState, FormData>(
    action,
    {}
  );

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className={mono("block text-[10px] text-mutedtext")}>
      {text}
    </label>
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      {mode === "edit" && item && (
        <input type="hidden" name="id" value={item.id} />
      )}

      {/* super_admin picks the owning tenant on create */}
      {mode === "create" && tenants && (
        <div className="space-y-2">
          {label("tenant_id", t("tenantLabel"))}
          <select
            id="tenant_id"
            name="tenant_id"
            required
            defaultValue=""
            className={cn(fieldClass, isRtl && "text-right")}
          >
            <option value="" disabled>
              {t("tenantPlaceholder")}
            </option>
            {tenants.map((ten) => (
              <option key={ten.id} value={ten.id}>
                {ten.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("name", t("nameLabel"))}
          <input
            id="name"
            name="name"
            required
            defaultValue={item?.name ?? ""}
            placeholder={t("namePlaceholder")}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          {label("sku", t("skuLabel"))}
          <input
            id="sku"
            name="sku"
            required
            defaultValue={item?.sku ?? ""}
            placeholder={t("skuPlaceholder")}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="space-y-2">
        {label("category", t("categoryLabel"))}
        <input
          id="category"
          name="category"
          defaultValue={item?.category ?? ""}
          placeholder={t("categoryPlaceholder")}
          className={fieldClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          {label("quantity", t("quantityLabel"))}
          <input
            id="quantity"
            name="quantity"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={item?.quantity ?? 0}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          {label("unit", t("unitLabel"))}
          <input
            id="unit"
            name="unit"
            required
            defaultValue={item?.unit ?? "pcs"}
            placeholder={t("unitPlaceholder")}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          {label("unit_price", t("priceLabel"))}
          <input
            id="unit_price"
            name="unit_price"
            type="number"
            min={0}
            step="0.01"
            defaultValue={item?.unit_price ?? ""}
            placeholder={t("pricePlaceholder")}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="space-y-2">
        {label("low_stock_threshold", t("thresholdLabel"))}
        <input
          id="low_stock_threshold"
          name="low_stock_threshold"
          type="number"
          min={0}
          step={1}
          defaultValue={item?.low_stock_threshold ?? ""}
          placeholder={t("thresholdPlaceholder")}
          className={cn(fieldClass, "sm:max-w-xs")}
        />
        <p className="text-[11px] leading-snug text-faint">{t("thresholdNote")}</p>
      </div>

      <div className="space-y-2">
        {label("description", t("descriptionLabel"))}
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={item?.description ?? ""}
          placeholder={t("descriptionPlaceholder")}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="rounded-full">
          {pending && <Loader2 className="animate-spin" />}
          {mode === "create" ? t("createSubmit") : t("saveSubmit")}
        </Button>
        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/dashboard/inventory">{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
