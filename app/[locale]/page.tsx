import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  Wrench,
  ShoppingCart,
  Sparkles,
  UploadCloud,
  Cpu,
  Factory,
  PackageCheck,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { GMark } from "@/components/g-mark";
import { cn } from "@/lib/utils";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Hero");
  const tf = await getTranslations("Features");
  const th = await getTranslations("HowItWorks");
  const tHome = await getTranslations("Home");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(
      isRtl
        ? "font-sans"
        : "font-mono uppercase tracking-[0.18em]",
      extra
    );

  const steps = [
    { icon: UploadCloud, title: th("step1Title"), copy: th("step1Copy") },
    { icon: Cpu, title: th("step2Title"), copy: th("step2Copy") },
    { icon: Factory, title: th("step3Title"), copy: th("step3Copy") },
    { icon: PackageCheck, title: th("step4Title"), copy: th("step4Copy") },
  ];

  const features = [
    {
      icon: Wrench,
      title: tf("customTitle"),
      copy: tf("customCopy"),
      accent: true,
    },
    {
      icon: ShoppingCart,
      title: tf("storeTitle"),
      copy: tf("storeCopy"),
      accent: true,
    },
    {
      icon: Sparkles,
      title: tf("aiTitle"),
      copy: tf("aiCopy"),
      accent: false,
    },
  ];

  const specs = [
    { label: tHome("specMethodLabel"), value: tHome("specMethodValue") },
    { label: tHome("specNetworkLabel"), value: tHome("specNetworkValue") },
    { label: tHome("specOutputLabel"), value: tHome("specOutputValue") },
  ];

  return (
    <div className="container space-y-6 py-6">
      {/* Telemetry strip */}
      <div className="neu-inset flex items-center justify-between gap-6 overflow-x-auto px-5 py-2.5">
        <div className={mono("flex shrink-0 items-center gap-4 text-[10px] text-mutedtext")}>
          <span className="flex items-center gap-1.5 font-semibold text-heading">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            {tHome("statusOnline")}
          </span>
          <span className="text-faint">{tHome("location")}</span>
        </div>
        <div className={mono("hidden shrink-0 items-center gap-4 text-[10px] text-faint sm:flex")}>
          <span>{t("formats")}</span>
          <span>{tHome("bilingual")}</span>
        </div>
      </div>

      {/* Hero bento */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Manifesto */}
        <div className="neu animate-fade-up flex flex-col justify-between gap-10 p-8 sm:p-10 lg:col-span-7 lg:p-12">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
              <span className="h-2 w-2 rounded-full bg-cobalt" />
              <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
            </span>

            <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3.25rem]">
              {t("heading")}
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-body sm:text-lg">
              {t("subheading")}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="rounded-full px-7">
              <Link href="/contact">{t("ctaPrimary")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-7">
              <Link href="/how-it-works">{t("ctaSecondary")}</Link>
            </Button>
          </div>
        </div>

        {/* Blueprint panel */}
        <div className="neu animate-fade-up delay-1 flex flex-col justify-between gap-6 p-8 lg:col-span-5">
          <div className={mono("flex items-center justify-between text-[10px] text-faint")}>
            <span>{tHome("panelTag")}</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> FIG·01
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
              <p className={mono("mt-5 text-[10px] text-faint")}>{t("formats")}</p>
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

      {/* Process */}
      <section className="neu animate-fade-up delay-2 p-8 sm:p-10">
        <div className="mb-8 flex flex-col gap-2">
          <span className={mono("text-[10px] text-cobalt")}>{tHome("processTag")}</span>
          <h2 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
            {th("heading")}
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-mutedtext">{th("intro")}</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ icon: Icon, title, copy }, i) => (
            <div key={title} className="neu-hover rounded-2xl bg-panel p-5 shadow-neu-sm">
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
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section className="animate-fade-up delay-3 space-y-6">
        <div className="flex flex-col gap-2 px-1">
          <span className={mono("text-[10px] text-cobalt")}>{tHome("capabilitiesTag")}</span>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, copy, accent }) => (
            <div key={title} className="neu neu-hover p-7">
              <span
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-2xl shadow-neu-sm",
                  accent ? "bg-cobalt" : "bg-panel"
                )}
              >
                <Icon
                  className={cn("h-6 w-6", accent ? "text-white" : "text-mutedtext")}
                  strokeWidth={1.5}
                />
              </span>
              <h3 className="mt-5 text-lg font-bold text-heading">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA band */}
      <section className="animate-fade-up delay-4 overflow-hidden rounded-[1.75rem] bg-ink p-8 sm:p-12">
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
