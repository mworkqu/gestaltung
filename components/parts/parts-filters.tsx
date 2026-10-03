"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Search, X } from "lucide-react";

import { useRouter, usePathname } from "@/i18n/navigation";
import {
  hasActiveFilters,
  LEAD_FILTER_OPTIONS,
  sortOptions,
  storeQuery,
  type StorePatch,
  type StoreState,
} from "@/lib/store/catalog";
import { materialLabel } from "@/lib/parts/part-key";
import { categoryLabel } from "@/lib/store/category-label";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

// Search + filter bar for the public catalog. The URL is the single source of
// truth: every control navigates to /store?… (storeQuery: empty values drop,
// any change resets to page 1) and the server component re-reads it. Typing
// is debounced; Enter searches at once; the × clears the search. Categories
// and materials come from the data, never from a list in code.
export function PartsFilters({
  categories,
  materials,
  state,
}: {
  categories: string[];
  materials: string[];
  state: StoreState;
}) {
  const t = useTranslations("Parts");
  const tD = useTranslations("Delivery");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [text, setText] = useState(state.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The q we last navigated to: a URL change to anything else (back button,
  // "Clear filters", a link) replaces the box; our own navigation doesn't, so
  // a slow response never overwrites what is being typed.
  const lastSent = useRef(state.q);
  useEffect(() => {
    if (state.q !== lastSent.current) {
      lastSent.current = state.q;
      setText(state.q);
    }
  }, [state.q]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  function go(patch: StorePatch, mode: "push" | "replace" = "push") {
    // A filter clicked mid-typing carries the typed text with it.
    if (timer.current && !("q" in patch)) {
      cancelTyping();
      const q = text.replace(/\s+/g, " ").trim();
      lastSent.current = q;
      patch = { ...patch, q };
    }
    const query = storeQuery(state, patch);
    startTransition(() => {
      if (mode === "replace") router.replace({ pathname, query }, { scroll: false });
      else router.push({ pathname, query }, { scroll: false });
    });
  }

  function cancelTyping() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function search(value: string, mode: "push" | "replace") {
    cancelTyping();
    const q = value.replace(/\s+/g, " ").trim();
    if (q === state.q) return;
    lastSent.current = q;
    go({ q }, mode);
  }

  function onType(value: string) {
    setText(value);
    cancelTyping();
    // Typing replaces the history entry instead of adding one per pause.
    timer.current = setTimeout(() => search(value, "replace"), DEBOUNCE_MS);
  }

  function clearAll() {
    cancelTyping();
    setText("");
    lastSent.current = "";
    startTransition(() => router.push({ pathname, query: {} }, { scroll: false }));
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

  const hasQuery = !!state.q;

  return (
    <div className="neu flex flex-col gap-4 p-4 sm:p-5" aria-busy={pending}>
      {/* Search */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          search(text, "push");
        }}
        className="space-y-2"
      >
        <label htmlFor="store-search" className={mono("block text-[10px] text-mutedtext")}>
          {t("searchLabel")}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mutedtext" aria-hidden />
          <input
            id="store-search"
            type="search"
            value={text}
            onChange={(e) => onType(e.target.value)}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={100}
            className={cn(fieldClass, "w-full ps-9 pe-10 [&::-webkit-search-cancel-button]:hidden")}
          />
          <span className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {pending && <Loader2 className="h-4 w-4 animate-spin text-mutedtext" aria-hidden />}
            {text && (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  search("", "push");
                }}
                aria-label={t("searchClear")}
                className="rounded-full p-1 text-mutedtext hover:text-heading focus:outline-none focus:ring-2 focus:ring-cobalt/60"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </span>
        </div>
      </form>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="space-y-2">
          <p className={mono("text-[10px] text-mutedtext")}>{t("filterCategory")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => go({ category: "" })}
              aria-pressed={!state.category}
              className={chip(!state.category)}
            >
              {t("filterAll")}
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => go({ category: c })}
                aria-pressed={state.category === c}
                className={chip(state.category === c)}
              >
                {categoryLabel(c, locale)}
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
              value={state.material ?? ""}
              onChange={(e) => go({ material: e.target.value })}
              className={cn(fieldClass, isRtl && "text-right")}
            >
              <option value="">{t("filterAllMaterials")}</option>
              {materials.map((m) => (
                <option key={m} value={m}>
                  {materialLabel(m)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Delivery time (lead-time ranges; never "out of stock") */}
        <div className="space-y-2">
          <label htmlFor="stock" className={mono("block text-[10px] text-mutedtext")}>
            {tD("filterLead")}
          </label>
          <select
            id="stock"
            value={state.stock ?? ""}
            onChange={(e) => go({ stock: e.target.value as StorePatch["stock"] })}
            className={cn(fieldClass, isRtl && "text-right")}
          >
            <option value="">{tD("filterAllLead")}</option>
            {LEAD_FILTER_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {tD(`leadOpt_${o}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div className="space-y-2">
          <label htmlFor="sort" className={mono("block text-[10px] text-mutedtext")}>
            {t("sortLabel")}
          </label>
          <select
            id="sort"
            value={state.sort}
            onChange={(e) => go({ sort: e.target.value as StorePatch["sort"] })}
            className={cn(fieldClass, isRtl && "text-right")}
          >
            {sortOptions(hasQuery).map((s) => (
              <option key={s} value={s}>
                {t(`sort_${s}`)}
              </option>
            ))}
          </select>
        </div>

        {hasActiveFilters(state) && (
          <button
            type="button"
            onClick={clearAll}
            className="pb-2 text-xs font-medium text-cobalt hover:underline"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>
    </div>
  );
}
