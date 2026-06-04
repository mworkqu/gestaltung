import { getTranslations, setRequestLocale } from "next-intl/server";
import { Target, MapPin, LayoutGrid } from "lucide-react";

import { GMark } from "@/components/g-mark";
import { cn } from "@/lib/utils";

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("About");
  const tBrand = await getTranslations("Brand");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const values = [
    { icon: Target, title: t("value1Title"), copy: t("value1Copy") },
    { icon: MapPin, title: t("value2Title"), copy: t("value2Copy") },
    { icon: LayoutGrid, title: t("value3Title"), copy: t("value3Copy") },
  ];

  const stats = [
    { label: t("stat1Label"), value: t("stat1Value") },
    { label: t("stat2Label"), value: t("stat2Value") },
    { label: t("stat3Label"), value: t("stat3Value") },
  ];

  return (
    <div className="container space-y-6 py-6">
      {/* Hero bento */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Manifesto */}
        <div className="neu animate-fade-up flex flex-col gap-6 p-8 sm:p-10 lg:col-span-7 lg:p-12">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
            <span className="h-2 w-2 rounded-full bg-cobalt" />
            <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
          </span>

          <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
            {t("heading")}
          </h1>

          <p className="max-w-xl text-base leading-relaxed text-body sm:text-lg">
            {t("lead")}
          </p>
          <div className="max-w-xl space-y-4 text-sm leading-relaxed text-mutedtext sm:text-base">
            <p>{t("body1")}</p>
            <p>{t("body2")}</p>
          </div>
        </div>

        {/* Blueprint panel */}
        <div className="neu animate-fade-up delay-1 flex flex-col justify-between gap-6 p-8 lg:col-span-5">
          <div className={mono("flex items-center justify-between text-[10px] text-faint")}>
            <span>{t("panelTag")}</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> FIG·02
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
              <p className={mono("mt-5 text-[10px] text-faint")}>{tBrand("tagline")}</p>
            </div>
          </div>

          {/* Spec readouts */}
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm">
                <span className={mono("block text-[8.5px] text-faint")}>{s.label}</span>
                <span className="mt-1 block text-xs font-bold text-heading">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="animate-fade-up delay-2 space-y-6">
        <div className="flex flex-col gap-2 px-1">
          <h2 className={mono("text-[10px] text-cobalt")}>{t("valuesTitle")}</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          {values.map(({ icon: Icon, title, copy }, i) => (
            <div key={title} className="neu neu-hover p-7">
              <div className="flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
                  <Icon className="h-6 w-6 text-cobalt" strokeWidth={1.5} />
                </span>
                <span className="font-mono text-xs font-medium text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-bold text-heading">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{copy}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
