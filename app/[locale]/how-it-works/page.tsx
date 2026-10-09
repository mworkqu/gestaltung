import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";
import {
  ArrowRight,
  Boxes,
  CircuitBoard,
  CreditCard,
  Cpu,
  Factory,
  Lightbulb,
  MessageCircle,
  PackageCheck,
  Search,
  ShoppingBag,
  Truck,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { GMark } from "@/components/g-mark";
import { FeatureVideoSection } from "@/components/feature-video-section";
import { YoutubeLinks } from "@/components/marketing/youtube-links";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HowItWorks" });
  return pageMetadata({ locale, path: "/how-it-works", title: t("metaTitle"), description: t("metaDescription") });
}

// How it works (audit #14): the three ways to work with us — buy parts, make a
// part from a file, turn an idea into a product — each in four steps.
export default async function HowItWorksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("HowItWorks");
  const tHero = await getTranslations("Hero");
  const isRtl = locale === "ar";

  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const paths: { key: string; icon: LucideIcon; href: string; video: string; steps: LucideIcon[] }[] = [
    { key: "buy", icon: ShoppingBag, href: "/store", video: "store-to-door", steps: [Search, Boxes, CreditCard, Truck] },
    { key: "make", icon: UploadCloud, href: "/design", video: "file-to-part", steps: [UploadCloud, Cpu, Factory, PackageCheck] },
    { key: "idea", icon: Lightbulb, href: "/projects/new", video: "idea-to-kit", steps: [Lightbulb, CircuitBoard, Boxes, Factory] },
  ];

  return (
    <div className="container page-stack">
      {/* Hero bento */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="neu animate-fade-up flex flex-col justify-center gap-6 p-8 sm:p-10 lg:col-span-7 lg:p-12">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
            <span className="h-2 w-2 rounded-full bg-cobalt" />
            <span className="kicker text-mutedtext">{t("kicker")}</span>
          </span>
          <h1 className="title-page">
            {t("headingPaths")}
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-body sm:text-lg">{t("introPaths")}</p>
          <nav className="flex flex-wrap gap-2" aria-label={t("jumpTo")}>
            {paths.map((p) => (
              <a
                key={p.key}
                href={`#${p.key}`}
                className="rounded-full bg-panel px-3.5 py-1.5 text-xs font-semibold text-heading shadow-neu-sm hover:text-cobalt max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                {t(`${p.key}Title`)}
              </a>
            ))}
          </nav>
        </div>

        <div className="neu animate-fade-up delay-1 flex p-8 lg:col-span-5">
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

      {paths.map(({ key, icon: PathIcon, href, video, steps }, n) => (
        <section key={key} id={key} className="neu animate-fade-up scroll-mt-28 card-pad">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-panel text-cobalt shadow-neu-sm">
                <PathIcon className="h-6 w-6" strokeWidth={1.5} />
              </span>
              <div className="space-y-1">
                <p className="kicker text-cobalt">{t("pathLabel", { n: n + 1 })}</p>
                <h2 className="title-section">{t(`${key}Title`)}</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-body">{t(`${key}Intro`)}</p>
              </div>
            </div>
            <Button asChild className="rounded-full px-5">
              <Link href={href}>
                {t(`${key}Cta`)}
                <ArrowRight className={cn("ms-1 h-4 w-4", isRtl && "-scale-x-100")} />
              </Link>
            </Button>
          </div>

          {/* One short clip per path, above its four steps. */}
          <div className="mb-8 max-w-2xl">
            <FeatureVideoSection slug={video} locale={locale} size="large" />
          </div>

          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((Icon, i) => (
              <li key={i} className="tile">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface shadow-neu-sm">
                    <Icon className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
                  </span>
                  <span className="font-mono text-xs font-medium text-faint">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mt-4 title-card">{t(`${key}Step${i + 1}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t(`${key}Step${i + 1}Copy`)}</p>
              </li>
            ))}
          </ol>

          {/* What a guest can do before signing up (idea tool only). */}
          {key === "idea" && <p className="mt-5 text-sm text-mutedtext">{t("ideaLimits")}</p>}
        </section>
      ))}

      {/* Watch on YouTube: links only, renders nothing until the owner adds some. */}
      <YoutubeLinks locale={locale} />

      {/* Closing CTA band: one WhatsApp link for people who need design help. */}
      <section className="animate-fade-up overflow-hidden rounded-[1.75rem] bg-ink p-8 sm:p-12">
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div aria-hidden className="bg-blueprint-grid pointer-events-none absolute inset-0 opacity-[0.04]" />
          <Button asChild size="lg" variant="secondary" className="relative h-auto whitespace-normal rounded-full px-7 py-3 text-start">
            <a href={COMPANY_WHATSAPP.url} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4 shrink-0" />
              {t("helpCta")}
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}
