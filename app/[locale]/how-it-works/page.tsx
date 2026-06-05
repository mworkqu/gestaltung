import { getTranslations, setRequestLocale } from "next-intl/server";
import { UploadCloud, Cpu, Factory, PackageCheck } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { GMark } from "@/components/g-mark";
import { cn } from "@/lib/utils";

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("HowItWorks");
  const tHero = await getTranslations("Hero");
  const tHome = await getTranslations("Home");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const steps = [
    { icon: UploadCloud, title: t("step1Title"), copy: t("step1Copy") },
    { icon: Cpu, title: t("step2Title"), copy: t("step2Copy") },
    { icon: Factory, title: t("step3Title"), copy: t("step3Copy") },
    { icon: PackageCheck, title: t("step4Title"), copy: t("step4Copy") },
  ];

  const specs = [
    { label: tHome("specMethodLabel"), value: tHome("specMethodValue") },
    { label: tHome("specNetworkLabel"), value: tHome("specNetworkValue") },
    { label: tHome("specOutputLabel"), value: tHome("specOutputValue") },
  ];

  return (
    <div className="container space-y-6 py-6">
      {/* Hero bento */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Intro */}
        <div className="neu animate-fade-up flex flex-col justify-center gap-6 p-8 sm:p-10 lg:col-span-7 lg:p-12">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
            <span className="h-2 w-2 rounded-full bg-cobalt" />
            <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
          </span>

          <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
            {t("heading")}
          </h1>

          <p className="max-w-xl text-base leading-relaxed text-body sm:text-lg">
            {t("intro")}
          </p>
        </div>

        {/* Blueprint panel */}
        <div className="neu animate-fade-up delay-1 flex flex-col justify-between gap-6 p-8 lg:col-span-5">
          <div className={mono("flex items-center justify-between text-[10px] text-faint")}>
            <span>{t("panelTag")}</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> FIG·03
            </span>
          </div>

          {/* Inset well with grid + concentric geometry + G mark */}
          <div className="neu-inset relative flex flex-1 items-center justify-center overflow-hidden p-8">
            <div aria-hidden className="bg-blueprint-grid absolute inset-0 opacity-70" />
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-50">
              <span className="absolute h-40 w-40 rounded-full border border-borderstrong" />
              <span className="absolute h-56 w-56 rounded-full border border-dashed border-borderstrong/70" />
            </div>
            <div className="relative flex flex-col items-center">
              <GMark className="h-24 w-24" />
              <p className={mono("mt-5 text-[10px] text-faint")}>{tHero("formats")}</p>
            </div>
          </div>

          {/* Spec readouts */}
          <div className="grid grid-cols-3 gap-2">
            {specs.map((s) => (
              <div key={s.label} className="rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm">
                <span className={mono("block text-[8.5px] text-faint")}>{s.label}</span>
                <span className="mt-1 block text-xs font-bold text-heading">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Process steps */}
      <section className="neu animate-fade-up delay-2 p-8 sm:p-10">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className={mono("text-[10px] text-cobalt")}>{t("stepsTag")}</h2>
        </div>

        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ icon: Icon, title, copy }, i) => (
            <li key={title} className="neu-hover rounded-2xl bg-panel p-5 shadow-neu-sm">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface shadow-neu-sm">
                  <Icon className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
                </span>
                <span className="font-mono text-xs font-medium text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 text-base font-bold text-heading">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Closing CTA band */}
      <section className="animate-fade-up delay-3 overflow-hidden rounded-[1.75rem] bg-ink p-8 sm:p-12">
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div aria-hidden className="bg-blueprint-grid pointer-events-none absolute inset-0 opacity-[0.04]" />
          <div className="relative space-y-2">
            <span className={mono("text-[10px] text-white/45")}>{tHome("ctaTag")}</span>
            <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {tHome("ctaHeading")}
            </h2>
          </div>
          <Button asChild size="lg" variant="secondary" className="relative rounded-full px-7">
            <Link href="/contact">{tHome("ctaButton")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
