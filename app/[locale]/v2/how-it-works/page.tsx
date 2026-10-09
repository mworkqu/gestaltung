import { getTranslations, setRequestLocale } from "next-intl/server";
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
import { FeatureVideoSection } from "@/components/feature-video-section";
import { BlueprintDecor, V2_TITLE } from "@/components/marketing/v2";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { v2PageMetadata } from "@/lib/site-v2-server";
import { cn } from "@/lib/utils";

// v2 How it works (P3-03): the three paths in plan order (Plan, Make, Shop),
// each a short persona story, its video and the four steps. Static like v1.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HowItWorks" });
  return v2PageMetadata({ locale, path: "/how-it-works", title: t("metaTitle"), description: t("metaDescription") });
}

export default async function HowItWorksV2({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("HowItWorks");
  const ts = await getTranslations("SiteV2");
  const isRtl = locale === "ar";
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  const paths: {
    key: "idea" | "make" | "buy";
    icon: LucideIcon;
    href: string;
    video: string;
    story: string;
    steps: LucideIcon[];
  }[] = [
    {
      key: "idea",
      icon: Lightbulb,
      href: "/projects/new",
      video: "idea-to-kit",
      story: ts("hwStoryIdea"),
      steps: [Lightbulb, CircuitBoard, Boxes, Factory],
    },
    {
      key: "make",
      icon: UploadCloud,
      href: "/design",
      video: "file-to-part",
      story: ts("hwStoryMake"),
      steps: [UploadCloud, Cpu, Factory, PackageCheck],
    },
    {
      key: "buy",
      icon: ShoppingBag,
      href: "/store",
      video: "store-to-door",
      story: ts("hwStoryShop"),
      steps: [Search, Boxes, CreditCard, Truck],
    },
  ];

  return (
    <div className="container page-stack">
      {/* Hero */}
      <section className="neu animate-fade-up relative overflow-hidden px-5 py-10 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
        <BlueprintDecor />
        <div className="relative max-w-4xl space-y-5 sm:space-y-7">
          <span className="kicker block text-mutedtext">{t("kicker")}</span>
          <h1 className={V2_TITLE}>{t("headingPaths")}</h1>
          <p className="max-w-2xl text-base leading-relaxed text-body sm:text-xl">{t("introPaths")}</p>
          <nav className="flex flex-wrap gap-2" aria-label={t("jumpTo")}>
            {paths.map((p) => (
              <a
                key={p.key}
                href={`#${p.key}`}
                className="rounded-full bg-panel px-4 py-2 text-xs font-semibold text-heading shadow-neu-sm hover:text-cobalt max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                {t(`${p.key}Title`)}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {paths.map(({ key, icon: PathIcon, href, video, story, steps }, n) => (
        <section key={key} id={key} className="neu animate-fade-up scroll-mt-28 space-y-8 card-pad">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-12">
            <div className="min-w-0 space-y-5">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-panel text-cobalt shadow-neu-sm">
                  <PathIcon className="h-6 w-6" strokeWidth={1.5} aria-hidden />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="kicker text-cobalt">{t("pathLabel", { n: n + 1 })}</p>
                  <h2 className="text-balance title-section">{t(`${key}Title`)}</h2>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-body sm:text-base">{t(`${key}Intro`)}</p>
              <div className="tile space-y-2">
                <p className="kicker text-mutedtext">{ts("hwStoryLabel")}</p>
                <p className="text-sm leading-relaxed text-body">{story}</p>
              </div>
              <Button asChild size="lg" className="rounded-full">
                <Link href={href}>
                  {t(`${key}Cta`)}
                  <ArrowRight className={cn("ms-1", arrow)} aria-hidden />
                </Link>
              </Button>
            </div>
            <div className="min-w-0">
              <FeatureVideoSection slug={video} locale={locale} size="large" />
            </div>
          </div>

          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((Icon, i) => (
              <li key={i} className="tile">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface shadow-neu-sm">
                    <Icon className="h-5 w-5 text-cobalt" strokeWidth={1.5} aria-hidden />
                  </span>
                  <span className="font-mono text-xs font-medium text-faint">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mt-4 title-card">{t(`${key}Step${i + 1}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t(`${key}Step${i + 1}Copy`)}</p>
              </li>
            ))}
          </ol>

          {/* What a guest can do before signing up (idea tool only). */}
          {key === "idea" && <p className="text-sm text-mutedtext">{t("ideaLimits")}</p>}
        </section>
      ))}

      {/* Closing band: one WhatsApp link for people who need design help. */}
      <section className="animate-fade-up overflow-hidden rounded-[1.75rem] bg-ink p-8 sm:p-12">
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div aria-hidden className="bg-blueprint-grid pointer-events-none absolute inset-0 opacity-[0.04]" />
          <Button
            asChild
            size="lg"
            variant="secondary"
            className="relative h-auto whitespace-normal rounded-full px-7 py-3 text-start"
          >
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
