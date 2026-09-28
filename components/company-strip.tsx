import { useTranslations } from "next-intl";
import { BadgeCheck, MapPin } from "lucide-react";

import { COMPANY } from "@/lib/company";
import { cn } from "@/lib/utils";

// The registered company behind the site (reviewer request, 2026-09-28):
// legal name, Commercial Registration number and location, above the header
// and in the footer. Numbers come from the owner's CR (lib/company.ts).
export function CompanyStrip({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations("Company");
  return (
    <p
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[11px] text-mutedtext",
        className
      )}
    >
      <span className="font-semibold text-heading">{t("legalName")}</span>
      <span className="inline-flex items-center gap-1">
        <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        {t("cr", { number: COMPANY.crNumber })}
      </span>
      {!compact && (
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-cobalt" aria-hidden />
          {t("location")}
        </span>
      )}
    </p>
  );
}
