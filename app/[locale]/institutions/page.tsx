import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Building2, FlaskConical, GraduationCap, MessageCircle, Printer, type LucideIcon } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ltr-isolate";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { metaFor } from "@/lib/meta";
import { formatQar } from "@/lib/pricing/plans";
import { getServicePrices } from "@/lib/store/public-catalog";
import { cn } from "@/lib/utils";

export const generateMetadata = metaFor("institutions");

// Lab licence for teams and institutions (P2-05). Static server component, no
// client components. The pilot price is service_prices.pilot_from (cached,
// cookie-free; default 15,000, owner to confirm). The licence itself has NO fixed
// numbers: base fee + pooled generations + named engineer hours, agreed per lab.
// The KPIs are things we measure together, never promises.
export default async function InstitutionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, services] = await Promise.all([getTranslations("Institutions"), getServicePrices()]);
  const price = formatQar(services.pilot_from);
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");
  const whatsapp = `${COMPANY_WHATSAPP.url}?text=${encodeURIComponent(t("whatsappText"))}`;

  const audiences: { key: "for1" | "for2" | "for3"; icon: LucideIcon }[] = [
    { key: "for1", icon: GraduationCap },
    { key: "for2", icon: FlaskConical },
    { key: "for3", icon: Building2 },
  ];
  const scope = ["scope1", "scope2", "scope3", "scope4"] as const;
  const kpis = ["kpi1", "kpi2", "kpi3"] as const;
  const subHeading = "text-xs font-semibold text-mutedtext";
  const bullet = "flex items-start gap-2 text-sm leading-relaxed text-heading";
  const dot = "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt";

  return (
    <div className="container space-y-6 py-6">
      {/* Hero */}
      <section className="neu animate-fade-up flex flex-col gap-5 p-8 sm:p-10 lg:p-12">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
        </span>
        <h1 className="max-w-3xl text-balance text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("sub")}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
            <Link href="/contact?kind=institution">{t("ctaPilot")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full rounded-full sm:w-auto">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden />
              {t("ctaWhatsApp")}
            </a>
          </Button>
        </div>
      </section>

      {/* Who it is for */}
      <section className="neu animate-fade-up delay-1 p-8 sm:p-10">
        <h2 className="mb-6 text-2xl font-extrabold tracking-tight text-heading">{t("forHeading")}</h2>
        <ul className="grid gap-5 md:grid-cols-3">
          {audiences.map(({ key, icon: Icon }) => (
            <li key={key} className="min-w-0 rounded-2xl bg-panel p-5 shadow-neu-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-bold text-heading">{t(`${key}Title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t(`${key}Text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* The pilot */}
      <section aria-labelledby="pilot-heading" className="neu animate-fade-up delay-2 space-y-6 p-8 sm:p-10">
        <div className="space-y-1">
          <span className={mono("text-[10px] text-cobalt")}>{t("pilotKicker")}</span>
          <h2 id="pilot-heading" className="text-2xl font-extrabold tracking-tight text-heading">
            {t("pilotHeading")}
          </h2>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-5 rounded-2xl bg-panel p-5 shadow-neu-sm">
            <div className="space-y-2">
              <h3 className={subHeading}>{t("scopeTitle")}</h3>
              <ul className="space-y-1.5">
                {scope.map((k) => (
                  <li key={k} className={bullet}>
                    <span className={dot} aria-hidden />
                    {t(k)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <h3 className={subHeading}>{t("durationTitle")}</h3>
              <p className="text-lg font-bold text-heading">{t("durationText")}</p>
            </div>
          </div>

          <div className="min-w-0 space-y-2 rounded-2xl bg-panel p-5 shadow-neu-sm">
            <h3 className={subHeading}>{t("measureTitle")}</h3>
            <p className="text-sm leading-relaxed text-mutedtext">{t("measureIntro")}</p>
            <ul className="space-y-1.5 pt-1">
              {kpis.map((k) => (
                <li key={k} className={bullet}>
                  <span className={dot} aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 space-y-1 rounded-2xl bg-panel p-5 shadow-neu-sm">
            <h3 className={subHeading}>{t("priceTitle")}</h3>
            <p className="text-3xl font-extrabold tabular-nums tracking-tight text-heading">
              {t("priceValue", { price })}
            </p>
            <p className="text-sm text-mutedtext">{t("priceNote")}</p>
          </div>

          <div className="min-w-0 space-y-1 rounded-2xl bg-panel p-5 shadow-neu-sm">
            <h3 className={subHeading}>{t("afterTitle")}</h3>
            <p className="text-sm leading-relaxed text-heading">{t("afterText")}</p>
          </div>
        </div>

        <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
          <Link href="/contact?kind=institution">{t("ctaPilot")}</Link>
        </Button>
      </section>

      {/* Invoice and PO */}
      <section className="neu animate-fade-up delay-2 flex flex-col gap-5 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight text-heading">{t("invoiceTitle")}</h2>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("invoiceText")}</p>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("contactLine")}</p>
          <p className="text-sm text-mutedtext">
            <Ltr>{COMPANY_WHATSAPP.display}</Ltr>
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-1 sm:w-auto sm:items-end">
          <p className="max-w-xs text-sm text-mutedtext sm:text-end">{t("proposalLead")}</p>
          <Link
            href="/institutions/proposal"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            <Printer className="h-4 w-4" aria-hidden />
            {t("ctaProposal")}
            <ArrowRight className={arrow} aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
