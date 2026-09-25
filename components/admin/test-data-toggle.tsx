import { getTranslations } from "next-intl/server";
import { FlaskConical } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// Admin lists hide rows flagged is_test (migration 0031) unless ?test=1.
// This link flips that flag and keeps the page's other filters.

export function showsTestData(test: string | string[] | undefined): boolean {
  return test === "1";
}

export async function TestDataToggle({
  pathname,
  showing,
  query = {},
}: {
  pathname: string;
  showing: boolean;
  /** Other filters on the page, kept when toggling. */
  query?: Record<string, string | undefined>;
}) {
  const t = await getTranslations("TestData");
  const kept = Object.fromEntries(Object.entries(query).filter((e): e is [string, string] => Boolean(e[1])));
  const next = showing ? kept : { ...kept, test: "1" };
  return (
    <Link
      href={{ pathname, query: next }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        showing ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : "bg-panel text-mutedtext shadow-neu-sm hover:text-heading"
      )}
    >
      <FlaskConical className="h-3.5 w-3.5" strokeWidth={1.75} />
      {showing ? t("hide") : t("show")}
    </Link>
  );
}

export async function TestBadge() {
  const t = await getTranslations("TestData");
  return (
    <span className="ms-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-semibold text-amber-900">
      {t("badge")}
    </span>
  );
}
