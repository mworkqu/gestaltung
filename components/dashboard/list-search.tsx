import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

// Search box for a long dashboard list (D2). A plain GET form, so the search
// lives in the URL (?q=) next to the list's filters (kept as hidden fields)
// and a new search starts again at page 1. Works without JavaScript.
export function ListSearch({
  q,
  placeholder,
  keep,
  className,
}: {
  q?: string;
  placeholder: "listSearchProducts";
  /** Filters to keep when searching (empty values are left out). */
  keep?: Record<string, string | undefined>;
  className?: string;
}) {
  const t = useTranslations("DashboardNav");
  return (
    <form method="get" role="search" className={cn("flex flex-wrap items-center gap-2", className)}>
      {Object.entries(keep ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="relative min-w-0 flex-1 sm:max-w-sm">
        <span className="sr-only">{t(placeholder)}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t(placeholder)}
          className="h-11 w-full rounded-xl border border-borderstrong/60 bg-surface ps-9 pe-3 text-sm text-heading shadow-neu-inset placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/50"
        />
      </label>
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-xl bg-cobalt px-4 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover"
      >
        {t("listSearch")}
      </button>
    </form>
  );
}
