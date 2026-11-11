import { GraduationCap } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ccPath } from "@/lib/cad-champions/routes";
import type { Locale } from "@/i18n/routing";

// Floating side tab on the store landing only (owner, 2026-10-18): one way in
// to CAD Champions until it gets a header entry. Sits mid-height on the
// inline-end edge, under the sticky header's z-index, hidden in print. A plain
// <a>: CC URLs are /cad-champions/{locale}/… and must not get the site's
// locale prefix from the i18n Link.
export async function CadChampionsSideButton({ locale }: { locale: string }) {
  const t = await getTranslations("StoreLanding");
  return (
    <a
      href={ccPath(locale as Locale)}
      aria-label={t("cadChampionsSideLabel")}
      className="fixed end-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-2 rounded-s-2xl bg-cobalt py-3 pe-3 ps-4 text-sm font-semibold text-white shadow-neu transition-colors hover:bg-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60 focus-visible:ring-offset-2 print:hidden"
    >
      <GraduationCap className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{t("cadChampionsSide")}</span>
    </a>
  );
}
