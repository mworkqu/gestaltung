"use client";

import { useActionState, useRef, useState } from "react";
import NextLink from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { hasGalleryPhoto, partMissing, type MissingKey } from "@/lib/admin/part-missing";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Part } from "@/lib/supabase/types";
import { STOCK_STATUSES } from "@/lib/parts/constants";
import { STORE_CATEGORIES } from "@/lib/store/store-categories";
import { categoryLabel } from "@/lib/store/category-label";
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
  returnTo,
  deliveryMissing = false,
  onMissingChange,
}: {
  mode: "create" | "edit";
  part?: Part;
  /** Validated /{locale}/dashboard/... path to go back to after Save / Cancel (D1). */
  returnTo?: string | null;
  /** Edit page: the product has no delivery date (shown in "What's missing"). */
  deliveryMissing?: boolean;
  /** When set, the parent renders <MissingSummary> itself (above the Delivery section). */
  onMissingChange?: (missing: MissingKey[]) => void;
}) {
  const t = useTranslations("PartsDashboard");
  const tm = useTranslations("PartEdit");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const action = mode === "create" ? createPart : updatePart;
  const [state, formAction, pending] = useActionState<PartFormState, FormData>(
    action,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const gallery = hasGalleryPhoto((part as { images?: unknown } | undefined)?.images);
  const showMissing = mode === "edit";
  const [missing, setMissing] = useState<MissingKey[]>(() =>
    showMissing
      ? partMissing({
          name: part?.name,
          sku: part?.sku,
          category: part?.category,
          unit_price: part?.unit_price,
          image_url: part?.image_url,
          hasGalleryPhoto: gallery,
          deliveryMissing,
        })
      : []
  );
  const recompute = () => {
    const form = formRef.current;
    if (!showMissing || !form) return;
    const fd = new FormData(form);
    const next = partMissing({
      name: String(fd.get("name") ?? ""),
      sku: String(fd.get("sku") ?? ""),
      category: String(fd.get("category") ?? ""),
      unit_price: String(fd.get("unit_price") ?? ""),
      image_url: String(fd.get("image_url") ?? ""),
      hasGalleryPhoto: gallery,
      deliveryMissing,
    });
    setMissing(next);
    onMissingChange?.(next);
  };
  const miss = (k: MissingKey) => missing.includes(k);
  const red = (k: MissingKey) => (miss(k) ? "ring-2 ring-red-400" : undefined);
  const aria = (k: MissingKey) =>
    miss(k) ? { "aria-invalid": true as const, "aria-describedby": `${k}-missing` } : {};
  const hint = (k: MissingKey) =>
    miss(k) ? (
      <p id={`${k}-missing`} className="text-[11px] font-medium text-red-700">
        {tm(`hint_${k}`)}
      </p>
    ) : null;

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className={mono("block text-[10px] text-mutedtext")}>
      {text}
    </label>
  );

  return (
    <form ref={formRef} action={formAction} onChange={recompute} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {mode === "edit" && part && <input type="hidden" name="id" value={part.id} />}

      {showMissing && !onMissingChange && <MissingSummary missing={missing} />}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("name", t("nameLabel"))}
          <input id="name" name="name" required defaultValue={part?.name ?? ""} className={cn(fieldClass, red("name"))} {...aria("name")} />
          {hint("name")}
        </div>
        <div className="space-y-2">
          {label("name_ar", t("nameArLabel"))}
          <input id="name_ar" name="name_ar" dir="rtl" defaultValue={part?.name_ar ?? ""} className={fieldClass} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("sku", t("skuLabel"))}
          <input id="sku" name="sku" required defaultValue={part?.sku ?? ""} className={cn(fieldClass, red("sku"))} {...aria("sku")} />
          {hint("sku")}
        </div>
        <div className="space-y-2">
          {label("category", t("categoryLabel"))}
          <input
            id="category"
            name="category"
            required
            defaultValue={part?.category ?? ""}
            placeholder={t("categoryPlaceholder")}
            className={cn(fieldClass, red("category"))}
            {...aria("category")}
          />
          {hint("category")}
        </div>
      </div>

      {/* C5 (0048): the storefront category. Shown only once the column exists
          (the edit page reads the row with select("*")); new products get
          theirs from the supplier category via the DB trigger. */}
      {mode === "edit" && part && "store_category" in part && (
        <div className="space-y-2">
          {label("store_category", t("storeCategoryLabel"))}
          <select
            id="store_category"
            name="store_category"
            defaultValue={part.store_category ?? ""}
            className={cn(fieldClass, isRtl && "text-right")}
          >
            <option value="">{t("storeCategoryAuto")}</option>
            {STORE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c, locale)}
              </option>
            ))}
          </select>
          <p className="text-[11px] leading-snug text-faint">{t("storeCategoryNote")}</p>
        </div>
      )}

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
            className={cn(fieldClass, red("unit_price"))}
            {...aria("unit_price")}
          />
          {hint("unit_price")}
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
          className={cn(fieldClass, red("image_url"))}
          {...aria("image_url")}
        />
        {hint("image_url")}
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
          {returnTo ? (
            <NextLink href={returnTo}>{t("cancel")}</NextLink>
          ) : (
            <Link href="/dashboard/store">{t("cancel")}</Link>
          )}
        </Button>
      </div>
    </form>
  );
}

/** Sticky "What's missing" line (D1): one chip per missing field, each jumps to it. */
export function MissingSummary({ missing }: { missing: MissingKey[] }) {
  const tm = useTranslations("PartEdit");
  const jump = (k: MissingKey) => (e: React.MouseEvent) => {
    const target = document.getElementById(k);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = target.matches("input, textarea, select") ? target : target.querySelector<HTMLElement>("button, input, select");
    focusable?.focus({ preventScroll: true });
  };
  return (
    <div
      className={cn(
        "sticky top-0 z-20 rounded-xl px-3 py-2 text-sm shadow-neu-sm",
        missing.length ? "bg-red-50 text-red-800" : "bg-panel text-mutedtext"
      )}
      role="status"
      aria-live="polite"
    >
      {missing.length ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold">{tm("missingTitle")}</span>
          {missing.map((k) => (
            <a
              key={k}
              href={`#${k}`}
              onClick={jump(k)}
              className="inline-flex min-h-8 items-center rounded-full bg-white/70 px-2.5 text-xs font-semibold text-red-800 underline-offset-2 hover:underline"
            >
              {tm(`field_${k}`)}
            </a>
          ))}
        </p>
      ) : (
        <p>{tm("nothingMissing")}</p>
      )}
    </div>
  );
}
