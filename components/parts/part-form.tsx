"use client";

import { useActionState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Part } from "@/lib/supabase/types";
import { STOCK_STATUSES } from "@/lib/parts/constants";
import {
  createPart,
  updatePart,
  type PartFormState,
} from "@/app/[locale]/dashboard/store/actions";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function PartForm({
  mode,
  part,
}: {
  mode: "create" | "edit";
  part?: Part;
}) {
  const t = useTranslations("PartsDashboard");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const action = mode === "create" ? createPart : updatePart;
  const [state, formAction, pending] = useActionState<PartFormState, FormData>(
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
      {mode === "edit" && part && <input type="hidden" name="id" value={part.id} />}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("name", t("nameLabel"))}
          <input id="name" name="name" required defaultValue={part?.name ?? ""} className={fieldClass} />
        </div>
        <div className="space-y-2">
          {label("name_ar", t("nameArLabel"))}
          <input id="name_ar" name="name_ar" dir="rtl" defaultValue={part?.name_ar ?? ""} className={fieldClass} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("sku", t("skuLabel"))}
          <input id="sku" name="sku" required defaultValue={part?.sku ?? ""} className={fieldClass} />
        </div>
        <div className="space-y-2">
          {label("category", t("categoryLabel"))}
          <input
            id="category"
            name="category"
            required
            defaultValue={part?.category ?? ""}
            placeholder={t("categoryPlaceholder")}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("material", t("materialLabel"))}
          <input id="material" name="material" defaultValue={part?.material ?? ""} className={fieldClass} />
        </div>
        <div className="space-y-2">
          {label("standard", t("standardLabel"))}
          <input
            id="standard"
            name="standard"
            defaultValue={part?.standard ?? ""}
            placeholder={t("standardPlaceholder")}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          {label("unit_price", t("priceLabel"))}
          <input
            id="unit_price"
            name="unit_price"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={part?.unit_price ?? ""}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          {label("min_order_qty", t("minQtyLabel"))}
          <input
            id="min_order_qty"
            name="min_order_qty"
            type="number"
            min={1}
            step={1}
            defaultValue={part?.min_order_qty ?? 1}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          {label("stock_status", t("stockLabel"))}
          <select
            id="stock_status"
            name="stock_status"
            defaultValue={part?.stock_status ?? "in_stock"}
            className={cn(fieldClass, isRtl && "text-right")}
          >
            {STOCK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`stock_${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {label("description", t("descriptionLabel"))}
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={part?.description ?? ""}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

      <div className="space-y-2">
        {label("description_ar", t("descriptionArLabel"))}
        <textarea
          id="description_ar"
          name="description_ar"
          dir="rtl"
          rows={3}
          defaultValue={part?.description_ar ?? ""}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

      <div className="space-y-2">
        {label("image_url", t("imageUrlLabel"))}
        <input
          id="image_url"
          name="image_url"
          type="url"
          defaultValue={part?.image_url ?? ""}
          placeholder={t("imageUrlPlaceholder")}
          className={fieldClass}
        />
        <p className="text-[11px] leading-snug text-faint">{t("imageUrlNote")}</p>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name="is_published"
          defaultChecked={part?.is_published ?? false}
          className="h-4 w-4 rounded border-borderstrong text-cobalt focus:ring-cobalt"
        />
        <span className="text-sm text-body">{t("publishedLabel")}</span>
      </label>

      {state.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="rounded-full">
          {pending && <Loader2 className="animate-spin" />}
          {mode === "create" ? t("createSubmit") : t("saveSubmit")}
        </Button>
        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/dashboard/store">{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
