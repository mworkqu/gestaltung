"use client";

// Why an AI step is blocked, with the way out: sign in, or get credits.

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Warn } from "@/components/prototyping/ui";

export function AccessNote({ reason, step }: { reason: string | null | undefined; step: "wiring" | "cad" }) {
  const t = useTranslations("Credits");
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
  if (reason === "no_credits")
    return (
      <Warn
        blocking={false}
        action={
          <Link href="/credits" className="text-xs font-semibold text-cobalt hover:text-cobalt-hover">
            {t("getCreditsCta")}
          </Link>
        }
      >
        {t(step === "wiring" ? "blockedNoWiring" : "blockedNoCad")}
      </Warn>
    );
  return null;
}

/** "Free" / "1 credit (QAR 20)" / "Included" next to an AI button. */
export function CostLabel({ cost, regens }: { cost: string | null | undefined; regens?: number }) {
  const t = useTranslations("Credits");
  if (!cost || cost === "none") return null;
  return (
    <span className="rounded-full bg-cobalt/10 px-2 py-0.5 text-[10.5px] font-semibold text-cobalt">
      {cost === "free" ? t("costFree") : cost === "included" ? t("costIncluded", { n: regens ?? 0 }) : t("costCredit", { qar: 20 })}
    </span>
  );
}
