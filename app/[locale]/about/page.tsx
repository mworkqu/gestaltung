import { getTranslations, setRequestLocale } from "next-intl/server";
import { Target, MapPin, LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("About");
  const isRtl = locale === "ar";

  const values = [
    { icon: Target, title: t("value1Title"), copy: t("value1Copy") },
    { icon: MapPin, title: t("value2Title"), copy: t("value2Copy") },
    { icon: LayoutGrid, title: t("value3Title"), copy: t("value3Copy") },
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

      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-body">
        {t("lead")}
      </p>
      <div className="mt-5 max-w-2xl space-y-4 text-base leading-relaxed text-mutedtext">
        <p>{t("body1")}</p>
        <p>{t("body2")}</p>
      </div>

      <h2
        className={cn(
          "mt-14 text-sm font-semibold text-faint",
          !isRtl && "uppercase tracking-[0.18em]"
        )}
      >
        {t("valuesTitle")}
      </h2>
      <div className="mt-5 grid gap-5 sm:grid-cols-3">
        {values.map(({ icon: Icon, title, copy }) => (
          <div
            key={title}
            className="rounded-lg border border-border bg-card p-6"
          >
            <Icon className="h-6 w-6 text-azure" strokeWidth={1.75} />
            <h3 className="mt-4 text-lg font-semibold text-heading">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mutedtext">{copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
