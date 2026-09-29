import { getTranslations, setRequestLocale } from "next-intl/server";
import { UploadCloud, PencilRuler, ArrowUpRight, Search } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { GMark } from "@/components/g-mark";
import { cn } from "@/lib/utils";

// The custom-manufacturing hub — the single destination the store landing's
// "Design" button points to. Public. Two paths: send a ready CAD file for a
// quote (→ /design/quote) or hire us to draw it (→ /design/drawing).
// TODO(step 7): repoint the first card at /projects/new once it exists.
// Design language matches the marketing site (how-it-works): neu bento +
// blueprint panel + cobalt accents + ink CTA band.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "DesignHub" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function DesignHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("DesignHub");
  const tHome = await getTranslations("Home");
  const tHero = await getTranslations("Hero");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);


  const paths = [
    {
      href: "/design/quote",
      icon: UploadCloud,
      title: t("uploadTitle"),
      copy: t("uploadCopy"),
      meta: "STL · STEP · DXF · IGES",
      accent: true,
    },
    {
      href: "/design/drawing",
      icon: PencilRuler,
      title: t("drawingTitle"),
      copy: t("drawingCopy"),
      meta: t("drawingMeta"),
      accent: false,
    },
  ] as const;

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
            {t("subheading")}
          </p>

          {/* Maybe it's already sold: search the store before making it (owner, 2026-09-29). */}
          <form action={`/${locale}/store`} className="max-w-xl space-y-1.5">
            <label htmlFor="design-search" className="block text-xs font-semibold text-mutedtext">
              {t("searchLabel")}
            </label>
            <div className="flex items-stretch gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/60 bg-panel px-3.5 shadow-neu-inset">
                <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
                <input
                  id="design-search"
                  name="q"
                  placeholder={t("searchPlaceholder")}
                  className="w-full flex-1 bg-transparent py-3 text-sm text-heading outline-none placeholder:text-faint"
                />
              </div>
              <Button type="submit" className="rounded-2xl px-5">
                {t("searchButton")}
              </Button>
            </div>
          </form>
        </div>

        {/* Blueprint panel */}
        <div className="neu animate-fade-up delay-1 flex flex-col justify-between gap-6 p-8 lg:col-span-5">
          <div className={mono("flex items-center justify-between text-[10px] text-faint")}>
            <span>{t("panelTag")}</span>
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
        </div>
      </section>

      {/* Two paths */}
      <section className="animate-fade-up delay-2 space-y-6">
        <div className="flex flex-col gap-2 px-1">
          <span className={mono("text-[10px] text-cobalt")}>{t("pathsTag")}</span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {paths.map(({ href, icon: Icon, title, copy, meta, accent }) => (
            <Link
              key={href}
              href={href}
              className="neu neu-hover group flex flex-col p-8 sm:p-10"
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-2xl shadow-neu-sm",
                    accent ? "bg-cobalt" : "bg-panel"
                  )}
                >
                  <Icon
                    className={cn("h-6 w-6", accent ? "text-white" : "text-cobalt")}
                    strokeWidth={1.5}
                  />
                </span>
                <ArrowUpRight
                  className={cn(
                    "h-5 w-5 text-cobalt transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
                    isRtl && "-scale-x-100"
                  )}
                />
              </div>

              <h2 className="mt-6 text-xl font-bold text-heading sm:text-2xl">{title}</h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-mutedtext sm:text-base">
                {copy}
              </p>
              <span
                className={mono(
                  "mt-6 inline-flex w-fit rounded-lg bg-panel px-3 py-1.5 text-[10px] text-faint shadow-neu-sm"
                )}
              >
                {meta}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Closing CTA band */}
      <section className="animate-fade-up delay-3 overflow-hidden rounded-[1.75rem] bg-ink p-8 sm:p-12">
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div aria-hidden className="bg-blueprint-grid pointer-events-none absolute inset-0 opacity-[0.04]" />
          <div className="relative space-y-2">
            <span className={mono("text-[10px] text-white/45")}>{t("ctaTag")}</span>
            <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {t("ctaHeading")}
            </h2>
          </div>
          <Button asChild size="lg" variant="secondary" className="relative rounded-full px-7">
            <Link href="/contact">{t("ctaButton")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
