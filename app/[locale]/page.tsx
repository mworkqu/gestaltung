import { getTranslations, setRequestLocale } from "next-intl/server";
import { Wrench, ShoppingCart, Sparkles } from "lucide-react";

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
  const isRtl = locale === "ar";

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

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Subtle azure glow behind the leading column */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-24 -z-10 h-[640px] w-[640px] rounded-full",
            isRtl ? "-right-32" : "-left-32"
          )}
          style={{
            background:
              "radial-gradient(circle, rgba(62,166,255,0.16) 0%, rgba(62,166,255,0.04) 38%, transparent 68%)",
          }}
        />

        <div className="container grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
          {/* Leading column */}
          <div>
            <span
              className={cn(
                "text-xs font-semibold text-azure",
                !isRtl && "uppercase tracking-[0.22em]"
              )}
            >
              {t("kicker")}
            </span>

            <h1 className="mt-5 text-[2rem] font-semibold leading-[1.1] tracking-tight text-heading sm:text-[2.375rem]">
              {t("heading")}
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-relaxed text-body">
              {t("subheading")}
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/contact">{t("ctaPrimary")}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/how-it-works">{t("ctaSecondary")}</Link>
              </Button>
            </div>
          </div>

          {/* Trailing column — blueprint panel */}
          <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-borderstrong bg-panel p-8 md:min-h-[420px]">
            <div aria-hidden className="bg-blueprint-grid absolute inset-0" />
            <div className="relative flex flex-col items-center">
              <GMark className="h-24 w-24 md:h-28 md:w-28" />
              <p className="mt-6 text-xs font-medium uppercase tracking-[0.28em] text-faint">
                {t("formats")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature row */}
      <section id="how-it-works" className="container pb-20 md:pb-28">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, copy, accent }) => (
            <div
              key={title}
              className={cn(
                "rounded-lg border border-border bg-card p-6 border-t-2",
                accent ? "border-t-azure" : "border-t-borderstrong"
              )}
            >
              <Icon
                className={cn("h-6 w-6", accent ? "text-azure" : "text-faint")}
                strokeWidth={1.75}
              />
              <h3 className="mt-4 text-lg font-semibold text-heading">
                {title}
              </h3>
              <p className="mt-2 text-sm text-mutedtext">{copy}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
