import { getTranslations } from "next-intl/server";
import { Box, CircuitBoard, ClipboardCheck, Clock, Factory, ListChecks, Package, ShoppingBasket, type LucideIcon } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { formatQar } from "@/lib/pricing/plans";
import { cn } from "@/lib/utils";

// Partner pages (P4-06): one layout for both audiences, copy in the "Partners"
// namespace (keys prefixed s* for schools, a* for accelerators). Static server
// component, no client components. No partner names, logos or results: the
// honesty list says so. The only number is the sprint price, which the caller
// reads from service_prices.sprint_from (getServicePrices()).
export type PartnerKind = "schools" | "accelerators";

const CONTACT_HREF = "/contact?kind=partner";

const OFFER_ICONS: Record<PartnerKind, LucideIcon[]> = {
  schools: [Package, Factory, ClipboardCheck, Clock],
  accelerators: [ListChecks, CircuitBoard, ShoppingBasket, Box],
};

const NUMBERS = [1, 2, 3, 4] as const;

export async function PartnerPage({ kind, sprintFrom }: { kind: PartnerKind; sprintFrom?: number }) {
  const t = await getTranslations("Partners");
  const p = kind === "schools" ? "s" : "a";
  const kickerKey = kind === "schools" ? "schoolsKicker" : "acceleratorsKicker";
  const headingKey = kind === "schools" ? "schoolsHeading" : "acceleratorsHeading";
  const subKey = kind === "schools" ? "schoolsSub" : "acceleratorsSub";
  const icons = OFFER_ICONS[kind];

  const tabBase = "inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold transition-colors";
  const tabs: { id: PartnerKind; href: string; label: string }[] = [
    { id: "schools", href: "/partners/schools", label: t("tabSchools") },
    { id: "accelerators", href: "/partners/accelerators", label: t("tabAccelerators") },
  ];

  return (
    <div className="container page-stack">
      <nav aria-label={t("tabsAria")}>
        <ul className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const active = tab.id === kind;
            return (
              <li key={tab.id}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    tabBase,
                    active
                      ? "bg-cobalt text-white shadow-neu-sm"
                      : "bg-panel text-heading shadow-neu-sm hover:text-cobalt",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Hero */}
      <section className="neu animate-fade-up flex flex-col gap-5 hero-pad">
        <span className="inline-flex w-fit max-w-full items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 shrink-0 rounded-full bg-cobalt" />
          <span className="kicker text-mutedtext">{t(kickerKey)}</span>
        </span>
        <h1 className="max-w-3xl text-balance title-page">{t(headingKey)}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t(subKey)}</p>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
            <Link href={CONTACT_HREF}>{t("ctaTalk")}</Link>
          </Button>
          <p className="text-sm text-mutedtext">{t("ctaNote")}</p>
        </div>
      </section>

      {/* What we offer */}
      <section aria-labelledby="offer-heading" className="neu animate-fade-up delay-1 card-pad">
        <h2 id="offer-heading" className="mb-6 title-section">
          {t("offerHeading")}
        </h2>
        <ul className="grid gap-5 sm:grid-cols-2">
          {NUMBERS.map((n) => {
            const Icon = icons[n - 1];
            return (
              <li key={n} className="min-w-0 tile">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                  <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                </span>
                <h3 className="mt-4 title-card">{t(`${p}Offer${n}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t(`${p}Offer${n}Text`)}</p>
              </li>
            );
          })}
        </ul>
        {kind === "accelerators" && sprintFrom !== undefined && (
          <div className="mt-5 min-w-0 space-y-1 tile">
            <h3 className="text-xs font-semibold text-mutedtext">{t("aPriceTitle")}</h3>
            <p className="text-3xl font-extrabold tabular-nums tracking-tight text-heading">
              {t("aPriceValue", { price: formatQar(sprintFrom) })}
            </p>
            <p className="text-sm text-mutedtext">{t("aPriceNote")}</p>
          </div>
        )}
      </section>

      {/* How a partnership works */}
      <section aria-labelledby="steps-heading" className="neu animate-fade-up delay-2 card-pad">
        <h2 id="steps-heading" className="mb-6 title-section">
          {t("stepsHeading")}
        </h2>
        <ol className="grid gap-5 sm:grid-cols-2">
          {NUMBERS.map((n) => (
            <li key={n} className="min-w-0 tile">
              <span className="kicker text-cobalt">{t("step", { n })}</span>
              <h3 className="mt-2 title-card">{t(`${p}Step${n}Title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t(`${p}Step${n}Text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Plainly */}
      <section aria-labelledby="honest-heading" className="neu animate-fade-up delay-2 card-pad">
        <h2 id="honest-heading" className="mb-4 title-section">
          {t("honestHeading")}
        </h2>
        <ul className="max-w-2xl space-y-2">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="flex items-start gap-2 text-sm leading-relaxed text-heading">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt" aria-hidden />
              {t(`${p}Honest${n}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* Contact */}
      <section className="neu animate-fade-up delay-2 flex flex-col gap-5 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div className="max-w-2xl space-y-1">
          <h2 className="title-section">{t(`${p}CtaHeading`)}</h2>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("ctaNote")}</p>
        </div>
        <Button asChild size="lg" className="w-full shrink-0 rounded-full sm:w-auto">
          <Link href={CONTACT_HREF}>{t("ctaTalk")}</Link>
        </Button>
      </section>
    </div>
  );
}
