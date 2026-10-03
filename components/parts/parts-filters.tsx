"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { Sheet } from "@/components/ui/sheet";
import {
  activeFilterCount,
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
//
// Phones (< md): the search box stays on the bar and category / material /
// delivery time / sort move into a "Filters" drawer (components/ui/sheet.tsx)
// opened from a button with a count badge. md and up keeps the filters inline.
// Both places render the same controls from the same functions below.
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
  // Always /store: filtered views are served by an internal rewrite to
  // /store/search (next.config.mjs), which must never end up in the URL.
  const pathname = "/store" as const;
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

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
  // The drawer is a phone-only control: if the window grows past md (rotated
  // tablet, resized desktop window) while it is open, close it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && setSheetOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  // Drawer "Clear filters": resets the drawer's controls, keeps the search text.
  function clearDrawerFilters() {
    go({ category: "", material: "", stock: "", sort: "" });
  }

  // max-md:min-h-11 → 44 px touch targets on phones; desktop stays compact.
  const fieldClass =
    "rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60 max-md:min-h-11";

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 max-md:min-h-11 max-md:px-4",
      active
        ? "bg-cobalt text-white shadow-neu-sm"
        : "bg-panel text-mutedtext shadow-neu-sm hover:text-heading"
    );

  const hasQuery = !!state.q;
  const filterCount = activeFilterCount(state);

  // Category chips: same markup inline (md+) and inside the drawer (< md).
  const categoryBlock =
    categories.length > 0 ? (
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
              className={cn(chip(state.category === c), "max-w-full break-words text-start")}
            >
              {categoryLabel(c, locale)}
            </button>
          ))}
        </div>
      </div>
    ) : null;

  // Material / delivery time / sort. `idp` keeps ids unique between the inline
  // copy and the drawer copy; `full` stretches the selects to the drawer width.
  const selectsBlock = (idp: string, full: boolean) => (
    <>
      {materials.length > 0 && (
        <div className="space-y-2">
          <label htmlFor={`${idp}material`} className={mono("block text-[10px] text-mutedtext")}>
            {t("filterMaterial")}
          </label>
          <select
            id={`${idp}material`}
            value={state.material ?? ""}
            onChange={(e) => go({ material: e.target.value })}
            className={cn(fieldClass, full && "w-full", isRtl && "text-right")}
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
        <label htmlFor={`${idp}stock`} className={mono("block text-[10px] text-mutedtext")}>
          {tD("filterLead")}
        </label>
        <select
          id={`${idp}stock`}
          value={state.stock ?? ""}
          onChange={(e) => go({ stock: e.target.value as StorePatch["stock"] })}
          className={cn(fieldClass, full && "w-full", isRtl && "text-right")}
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
        <label htmlFor={`${idp}sort`} className={mono("block text-[10px] text-mutedtext")}>
          {t("sortLabel")}
        </label>
        <select
          id={`${idp}sort`}
          value={state.sort}
          onChange={(e) => go({ sort: e.target.value as StorePatch["sort"] })}
          className={cn(fieldClass, full && "w-full", isRtl && "text-right")}
        >
          {sortOptions(hasQuery).map((s) => (
            <option key={s} value={s}>
              {t(`sort_${s}`)}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <div className="neu flex flex-col gap-4 p-4 sm:p-5" aria-busy={pending}>
      {/* Search: always visible, also on phones. */}
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
                className="tap-hit rounded-full p-1 text-mutedtext hover:text-heading focus:outline-none focus:ring-2 focus:ring-cobalt/60"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </span>
        </div>
      </form>

      {/* Phones: one button opens the filters drawer. */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-panel px-4 text-sm font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60"
        >
          <SlidersHorizontal className="h-4 w-4 text-cobalt" strokeWidth={1.75} aria-hidden />
          {t("filtersButton")}
          {filterCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cobalt px-1.5 text-[11px] font-bold leading-none text-white">
              {filterCount}
            </span>
          )}
        </button>
      </div>

      {/* md and up: the filters stay inline (unchanged). */}
      <div className="hidden flex-col gap-4 md:flex">
        {categoryBlock}
        <div className="flex flex-wrap items-end gap-4">
          {selectsBlock("", false)}
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

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t("filtersButton")}
        closeLabel={t("filtersClose")}
        footer={
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cobalt px-6 text-sm font-semibold text-white shadow transition-colors hover:bg-cobalt-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60"
          >
            {t("showResults")}
          </button>
        }
      >
        <div className="flex flex-col gap-5" aria-busy={pending}>
          {categoryBlock}
          {selectsBlock("sheet-", true)}
          <button
            type="button"
            onClick={clearDrawerFilters}
            disabled={filterCount === 0}
            className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-cobalt hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            {t("clearFilters")}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
