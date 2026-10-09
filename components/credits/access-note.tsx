"use client";

// Why an AI step is blocked, with the way out: sign in, or buy credits.
// There is no card payment yet (owner, 2026-10-09): credits are paid by bank
// transfer or in person, so the way out is a WhatsApp message (prefilled with
// the project name) plus the "How credits work" link to /pricing#credits.

import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Warn } from "@/components/prototyping/ui";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { CREDIT_QAR } from "@/lib/credits/constants";
import { formatQar } from "@/lib/pricing/plans";
import { usePriceQuote } from "@/lib/pricing/use-price-quote";

const linkCls = "inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-cobalt hover:text-cobalt-hover";

export function AccessNote({
  reason,
  step,
  projectName,
}: {
  reason: string | null | undefined;
  step: "wiring" | "cad";
  /** Prefills the WhatsApp message ("…buy credits for project {name}"). */
  projectName?: string | null;
}) {
  const t = useTranslations("Credits");
  // Price experiment (display only): the invited price when this person has one, else the listed price.
  const invited = usePriceQuote();
  if (reason === "sign_in")
    return (
      <Warn
        blocking={false}
        action={
          <Link href="/sign-in" className="text-xs font-semibold text-cobalt hover:text-cobalt-hover">
            {t("signInCta")}
          </Link>
        }
      >
        {t(step === "wiring" ? "blockedSignInWiring" : "blockedSignInCad")}
      </Warn>
    );
  if (reason === "no_credits") {
    const name = projectName?.trim();
    const text = name ? t("buyWhatsappText", { name }) : t("buyWhatsappTextNoName");
    return (
      <Warn blocking={false}>
        <span className="block font-semibold">{t(step === "wiring" ? "blockedNoWiring" : "blockedNoCad")}</span>
        <span className="mt-0.5 block">{t("buyCreditsText", { price: invited !== null ? formatQar(invited) : CREDIT_QAR })}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-4">
          <a
            href={`${COMPANY_WHATSAPP.url}?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={linkCls}
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            {t("buyCreditsCta")}
          </a>
          <Link href="/pricing#credits" className={linkCls}>
            {t("howCreditsLink")}
          </Link>
        </span>
      </Warn>
    );
  }
  return null;
}

/** "1 credit (QAR 20)" / "Included" next to an AI button. Nothing for a free (bom/admin) step. */
export function CostLabel({ cost, regens }: { cost: string | null | undefined; regens?: number }) {
  const t = useTranslations("Credits");
  if (!cost || cost === "none") return null;
  return (
    <span className="rounded-full bg-cobalt/10 px-2 py-0.5 text-[10.5px] font-semibold text-cobalt">
      {cost === "included" ? t("costIncluded", { n: regens ?? 0 }) : t("costCredit", { qar: CREDIT_QAR })}
    </span>
  );
}
