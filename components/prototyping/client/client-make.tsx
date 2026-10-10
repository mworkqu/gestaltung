"use client";

// Step 4 of the client view, "Get it made" (P5-04): the 3D model of the
// enclosure, and "Ask for a quote" with the price rule in ONE sentence. The
// number in that sentence is read from store_settings.service_prices by the
// server page and passed in; nothing is hard-coded here.

import { useTranslations } from "next-intl";
import { Receipt } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { CadCard } from "@/components/credits/cad-card";
import { cn } from "@/lib/utils";

export function ClientMakeBody({ enclosureFrom }: { enclosureFrom: string | null }) {
  const t = useTranslations("ClientView");
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-heading">
        {enclosureFrom ? t("makePrice", { price: enclosureFrom }) : t("makePriceNoNumber")}
      </p>
      <Link
        href="/design/quote"
        className={cn(
          "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-cobalt px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover sm:w-auto"
        )}
      >
        <Receipt className="h-4 w-4" aria-hidden />
        {t("makeQuote")}
      </Link>
      <p className="text-xs text-mutedtext">{t("makeModelHint")}</p>
    </div>
  );
}

/** The 3D model card sits right under the quote card, as part of the same step. */
export function ClientModel({ projectId, projectName, brief }: { projectId: string; projectName: string; brief: string }) {
  return <CadCard projectId={projectId} projectName={projectName} brief={brief} />;
}

