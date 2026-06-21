"use client";

import { useTranslations, useLocale } from "next-intl";

import { useRouter, usePathname } from "@/i18n/navigation";
import { STOCK_STATUSES } from "@/lib/parts/constants";
import { cn } from "@/lib/utils";

type Current = {
  category?: string;
  material?: string;
  stock?: string;
};

// Filter bar for the public catalog. Pushes ?category=&material=&stock= query
// params; the server component re-reads them and filters. No client pagination.
export function PartsFilters({
  categories,
  materials,
  current,
}: {
  categories: string[];
  materials: string[];
  current: Current;
}) {
  const t = useTranslations("Parts");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const pathname = usePathname();

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  // Merge a patch into the current params and navigate. Empty values drop.
  function apply(patch: Current) {
    const next: Record<string, string> = {};
    const merged = { ...current, ...patch };
    if (merged.category) next.category = merged.category;
    if (merged.material) next.material = merged.material;
    if (merged.stock) next.stock = merged.stock;
    router.push({ pathname, query: next });
  }

  const fieldClass =
    "rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60";

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200",
      active
        ? "bg-cobalt text-white shadow-neu-sm"
        : "bg-panel text-mutedtext shadow-neu-sm hover:text-heading"
    );

  return (
    <div className="neu flex flex-col gap-4 p-4 sm:p-5">
      {/* Category chips */}
      {categories.length > 0 && (
        <div className="space-y-2">
          <p className={mono("text-[10px] text-mutedtext")}>{t("filterCategory")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => apply({ category: "" })}
              className={chip(!current.category)}
            >
              {t("filterAll")}
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => apply({ category: c })}
                className={chip(current.category === c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        {/* Material select */}
        {materials.length > 0 && (
          <div className="space-y-2">
            <label htmlFor="material" className={mono("block text-[10px] text-mutedtext")}>
              {t("filterMaterial")}
            </label>
            <select
              id="material"
              value={current.material ?? ""}
              onChange={(e) => apply({ material: e.target.value })}
              className={cn(fieldClass, isRtl && "text-right")}
            >
              <option value="">{t("filterAllMaterials")}</option>
              {materials.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Stock status select */}
        <div className="space-y-2">
          <label htmlFor="stock" className={mono("block text-[10px] text-mutedtext")}>
            {t("filterStock")}
          </label>
          <select
            id="stock"
            value={current.stock ?? ""}
            onChange={(e) => apply({ stock: e.target.value })}
            className={cn(fieldClass, isRtl && "text-right")}
          >
            <option value="">{t("filterAllStock")}</option>
            {STOCK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`stock_${s}`)}
              </option>
            ))}
          </select>
        </div>

        {(current.category || current.material || current.stock) && (
          <button
            type="button"
            onClick={() => router.push({ pathname, query: {} })}
            className="text-xs font-medium text-cobalt hover:underline"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>
    </div>
  );
}
