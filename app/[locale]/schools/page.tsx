import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Coins, Printer, ShieldCheck, Truck, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";
import { formatQar } from "@/lib/pricing/plans";
import { getSchoolPricing } from "@/lib/store/public-catalog";

export const generateMetadata = metaFor("schools");

// /schools: the teacher's entry point. Static server component (ISR through the
// cached getSchoolPricing read), no client components, so no MessagesScope.
// Prices are the ones the owner edits in Dashboard → Store → Schools.
export default async function SchoolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, pricing] = await Promise.all([getTranslations("Schools"), getSchoolPricing()]);
  const isRtl = locale === "ar";
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  // Western digits in both locales (formatQar), interpolated into the copy.
  const steps = ["step1", "step2", "step3", "step4"] as const;
  const prices: { key: string; title: string; text: string; icon: typeof Coins }[] = [
    {
      key: "teamPack",
      title: t("teamPackTitle"),
      text: t("teamPackText", { credits: formatQar(pricing.team_pack.credits), qar: formatQar(pricing.team_pack.qar) }),
      icon: Users,
    },
    {
      key: "classPack",
      title: t("classPackTitle"),
      text: t("classPackText", { credits: formatQar(pricing.class_pack.credits), qar: formatQar(pricing.class_pack.qar) }),
      icon: Coins,
    },
    {
      key: "print",
      title: t("printTitle"),
      text: t("printText", { base: formatQar(pricing.print.base_qar), perGram: formatQar(pricing.print.per_gram_qar) }),
      icon: Printer,
    },
    { key: "delivery", title: t("deliveryTitle"), text: t("deliveryText"), icon: Truck },
  ];

  return (
    <div className="container page-stack">
      {/* Hero */}
      <section className="neu animate-fade-up flex flex-col gap-5 hero-pad">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className="kicker text-mutedtext">{t("kicker")}</span>
        </span>
        <h1 className="max-w-3xl text-balance title-page">{t("heading")}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("sub")}</p>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-6">
          <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
            <Link href="/schools/classes">{t("ctaPrimary")}</Link>
          </Button>
          <Link
            href="/contact?kind=school"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("ctaSecondary")}
            <ArrowRight className={arrow} />
          </Link>
        </div>
      </section>

      {/* How it works for a teacher */}
      <section className="neu animate-fade-up delay-1 card-pad">
        <h2 className="mb-6 title-section">{t("stepsHeading")}</h2>
        <ol className="grid gap-5 sm:grid-cols-2">
          {steps.map((key, index) => (
            <li key={key} className="min-w-0 tile">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-sm font-bold text-cobalt shadow-neu-sm">
                {index + 1}
              </span>
              <h3 className="mt-4 title-card">{t(`${key}Title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t(`${key}Text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Prices */}
      <section className="neu animate-fade-up delay-2 card-pad">
        <h2 className="mb-6 title-section">{t("pricesHeading")}</h2>
        <ul className="grid gap-5 sm:grid-cols-2">
          {prices.map(({ key, title, text, icon: Icon }) => (
            <li key={key} className="min-w-0 tile">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <h3 className="mt-4 title-card">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-mutedtext">{t("creditNote")}</p>
      </section>

      {/* Safety */}
      <section className="neu animate-fade-up delay-2 card-pad">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="max-w-3xl space-y-2">
            <h2 className="title-section">{t("safetyHeading")}</h2>
            <p className="text-sm leading-relaxed text-body sm:text-base">{t("safetyText")}</p>
            <p className="text-sm leading-relaxed text-mutedtext">{t("reviewNote")}</p>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="neu animate-fade-up delay-2 flex flex-col gap-5 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div className="max-w-2xl space-y-2">
          <h2 className="title-section">{t("ctaHeading")}</h2>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("ctaText")}</p>
          <Link
            href="/contact?kind=school"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("ctaSecondary")}
            <ArrowRight className={arrow} />
          </Link>
        </div>
        <Button asChild size="lg" className="w-full shrink-0 rounded-full sm:w-auto">
          <Link href="/schools/classes">{t("ctaPrimary")}</Link>
        </Button>
      </section>
    </div>
  );
}
