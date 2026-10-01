"use client";

// Wiring / CAD credit balance for a signed-in, verified user (or "unlimited"
// for the admin). Links to /credits. Shows nothing for guests and before 0042.

import { useTranslations } from "next-intl";
import { Zap } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useCreditSummary } from "@/lib/credits/use-credits";

export function CreditsBadge() {
  const t = useTranslations("Credits");
  const s = useCreditSummary();
  if (!s || s.role === "anonymous") return null;
  return (
    <Link
      href="/credits"
      title={t("badgeTitle")}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-panel px-3 py-1.5 text-[11.5px] font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt"
    >
      <Zap className="h-3.5 w-3.5 text-cobalt" aria-hidden />
      {s.role === "admin" ? (
        t("badgeAdmin")
      ) : (
        <>
          <span className="hidden sm:inline">{t("badge", { wiring: s.wiring, cad: s.cad })}</span>
          <span className="sm:hidden" aria-label={t("badge", { wiring: s.wiring, cad: s.cad })}>
            {s.wiring}·{s.cad}
          </span>
        </>
      )}
    </Link>
  );
}
