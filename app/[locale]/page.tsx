import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Home");

  return (
    <section className="relative flex min-h-[calc(100vh-9rem)] flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 35%, hsl(210 30% 18%) 0%, hsl(220 22% 7%) 60%, hsl(220 24% 5%) 100%)",
        }}
      />

      <div className="flex flex-col items-center text-center">
        <span className="mb-6 rounded-full border border-border bg-card/60 px-4 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {t("location")}
        </span>

        <h1 className="bg-gradient-to-b from-primary to-foreground bg-clip-text text-6xl font-semibold tracking-tight text-transparent sm:text-7xl">
          {t("heading")}
        </h1>

        <p className="mt-5 max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
          {t("subheading")}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg">{t("ctaPrimary")}</Button>
          <Button size="lg" variant="outline">
            {t("ctaSecondary")}
          </Button>
        </div>

        <p className="mt-16 text-xs text-muted-foreground/70">
          {t("stageNote")}
        </p>
      </div>
    </section>
  );
}
