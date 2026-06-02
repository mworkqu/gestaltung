import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("HowItWorks");
  const isRtl = locale === "ar";

  const steps = [
    { title: t("step1Title"), copy: t("step1Copy") },
    { title: t("step2Title"), copy: t("step2Copy") },
    { title: t("step3Title"), copy: t("step3Copy") },
    { title: t("step4Title"), copy: t("step4Copy") },
  ];

  return (
    <section className="container py-16 md:py-24">
      <span
        className={cn(
          "text-xs font-semibold text-azure",
          !isRtl && "uppercase tracking-[0.22em]"
        )}
      >
        {t("kicker")}
      </span>
      <h1 className="mt-4 text-[2rem] font-semibold leading-[1.1] text-heading sm:text-[2.375rem]">
        {t("heading")}
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-body">
        {t("intro")}
      </p>

      <ol className="mt-12 grid gap-5 sm:grid-cols-2">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="rounded-lg border border-border bg-card p-6"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-azure/40 bg-azure/10 text-sm font-semibold text-azure">
              {i + 1}
            </span>
            <h2 className="mt-4 text-lg font-semibold text-heading">
              {step.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-mutedtext">
              {step.copy}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-12 flex flex-wrap items-center gap-4 rounded-xl border border-borderstrong bg-panel p-6">
        <p className="text-base font-medium text-heading">{t("ctaText")}</p>
        <Button asChild className="ms-auto">
          <Link href="/contact">{t("ctaButton")}</Link>
        </Button>
      </div>
    </section>
  );
}
