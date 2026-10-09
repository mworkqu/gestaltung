import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Box,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  Coins,
  ListChecks,
  PackageCheck,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getPricingPlans } from "@/lib/store/public-catalog";
import { formatPerOutput, formatQar } from "@/lib/pricing/plans";
import { CAD_GENERATIONS, ORDER_DELIVERED_CREDITS } from "@/lib/credits/constants";
import { cn } from "@/lib/utils";

// Building blocks of the v2 marketing pages (app/[locale]/v2/*, P3-03). Server
// components only: nothing here reads cookies or headers, so the pages stay
// static / ISR. Tokens come from DESIGN.md section 10; the one addition is the
// larger hero scale (V2_TITLE), shared by the four v2 heroes.

/** v2 hero h1: visibly larger than .title-page (36 / 48 / 48 px). 34 px on phones so the CTA stays above the fold. */
export const V2_TITLE =
  "text-balance text-[2.125rem] font-extrabold leading-[1.08] tracking-tight text-heading sm:text-6xl sm:leading-[1.05] lg:text-[4.5rem] lg:leading-[1.03]";

/** Blueprint motif for the hero card only (DESIGN.md: blueprint in hero and dividers). Decorative; the card needs `relative overflow-hidden`. */
export function BlueprintDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="bg-blueprint-grid absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      <span className="absolute -end-24 -top-24 hidden h-80 w-80 rounded-full border border-borderstrong opacity-70 sm:block" />
      <span className="absolute -end-40 -top-40 hidden h-[34rem] w-[34rem] rounded-full border border-dashed border-borderstrong/70 opacity-70 sm:block" />
    </div>
  );
}

/** Kicker + h2 (+ optional line) above a section. */
export function SectionHead({
  kicker,
  title,
  intro,
  id,
  className,
}: {
  kicker?: string;
  title: string;
  intro?: string;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl space-y-2", className)}>
      {kicker && <span className="kicker block text-cobalt">{kicker}</span>}
      <h2 id={id} className="text-balance title-section">
        {title}
      </h2>
      {intro && <p className="text-sm leading-relaxed text-body sm:text-base">{intro}</p>}
    </div>
  );
}

/** Icon chip + title + text, the head of a path / outcome tile. */
export function ChoiceHead({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm"
          aria-hidden
        >
          {icon}
        </span>
        <h3 className="title-card">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-body">{text}</p>
    </div>
  );
}

/**
 * "How credits work" in one picture (plan 5.2 item 6): the parts list costs no
 * credit, each wiring diagram and each 3D model costs one; below it, where
 * credits come from. Every number is data: the price per credit from
 * store_settings.pricing_plans, the rest from lib/credits/constants (the 0042
 * rules). Links to the full rules on /pricing#credits. Reads only the cached,
 * cookie-free pricing getter, so it is safe on static pages.
 */
export async function CreditsFlow({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "SiteV2" });
  const tp = await getTranslations({ locale, namespace: "Pricing" });
  const pricing = await getPricingPlans();
  const price = formatPerOutput(pricing.overage_per_credit_qar);
  const isRtl = locale === "ar";
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  const steps = [
    { icon: ListChecks, title: t("credStep1Title"), badge: t("credStep1Badge"), text: t("credStep1Text"), paid: false },
    { icon: CircuitBoard, title: t("credStep2Title"), badge: t("credStep2Badge"), text: t("credStep2Text"), paid: true },
    {
      icon: Box,
      title: t("credStep3Title"),
      badge: t("credStep3Badge"),
      text: t("credStep3Text", { n: formatQar(CAD_GENERATIONS) }),
      paid: true,
    },
  ];

  const sources = [
    { icon: CalendarCheck, title: t("credSourcePlanTitle"), text: t("credSourcePlanText") },
    { icon: Coins, title: t("credSourceBuyTitle"), text: tp("overageCredit", { price }) },
    {
      icon: PackageCheck,
      title: tp("creditEarnTitle"),
      text: tp("creditEarnText", {
        wiring: formatQar(ORDER_DELIVERED_CREDITS.wiring),
        cad: formatQar(ORDER_DELIVERED_CREDITS.cad),
      }),
    },
  ];

  return (
    <section aria-labelledby="v2-credits" className="neu animate-fade-up space-y-8 card-pad">
      <SectionHead
        id="v2-credits"
        kicker={tp("creditsKicker")}
        title={t("creditsHeading")}
        intro={tp("creditsIntro", { price })}
      />

      {/* The diagram: three steps joined by connectors. Phones stack them top to bottom. */}
      <div role="list" aria-label={t("creditsFlowLabel")} className="flex flex-col lg:flex-row lg:items-stretch">
        {steps.map(({ icon: Icon, title, badge, text, paid }, i) => (
          <Fragment key={title}>
            {i > 0 && (
              <div aria-hidden className="flex items-center justify-center py-2 text-faint lg:px-3 lg:py-0">
                <ChevronDown className="h-5 w-5 lg:hidden" strokeWidth={1.75} />
                <ChevronRight className={cn("hidden h-5 w-5 lg:block", isRtl && "-scale-x-100")} strokeWidth={1.75} />
              </div>
            )}
            <div role="listitem" className="tile min-w-0 flex-1 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                  <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                </span>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-bold",
                    paid ? "bg-cobalt text-white" : "border border-borderstrong bg-surface text-heading",
                  )}
                >
                  {badge}
                </span>
              </div>
              <h3 className="title-card">{title}</h3>
              <p className="text-sm leading-relaxed text-mutedtext">{text}</p>
            </div>
          </Fragment>
        ))}
      </div>

      <div className="neu-inset space-y-4 p-5 sm:p-6">
        <p className="kicker text-mutedtext">{t("credSourcesTitle")}</p>
        <ul className="grid gap-5 md:grid-cols-3">
          {sources.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex min-w-0 items-start gap-3">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-cobalt" strokeWidth={1.5} aria-hidden />
              <div className="min-w-0 space-y-1">
                <h3 className="title-card">{title}</h3>
                <p className="text-sm leading-relaxed text-mutedtext">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Link
        href="/pricing#credits"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
      >
        {t("creditsLink")}
        <ArrowRight className={arrow} aria-hidden />
      </Link>
    </section>
  );
}
