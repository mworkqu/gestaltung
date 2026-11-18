import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Box,
  Camera,
  CheckCircle2,
  Clapperboard,
  ClipboardList,
  Clock,
  Cog,
  Cpu,
  DraftingCompass,
  Gauge,
  GraduationCap,
  Mail,
  MapPin,
  MessageCircle,
  Monitor,
  Mouse,
  Printer,
  Ruler,
  ScanLine,
  Timer,
  Trophy,
  UserPlus,
  Users,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { FaqAccordion } from "@/components/cad-champions/landing/faq-accordion";
import { HeroVisual } from "@/components/cad-champions/landing/hero-visual";
import { ScrollLink, TrackLink } from "@/components/cad-champions/landing/track-link";
import { Term } from "@/components/cad-champions/ui";
import { FilePlayer } from "@/components/cad-champions/video/file-player";
import type { Locale } from "@/i18n/routing";
import { ccSignUpHref } from "@/lib/cad-champions/auth/paths";
import { loadPublishedTestimonials } from "@/lib/cad-champions/admin/testimonials-server";
import { publicTestimonials } from "@/lib/cad-champions/admin/testimonials";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { faqHiddenKey, getOverride, msgKey } from "@/lib/cad-champions/content/overrides";
import { loadContentOverrides } from "@/lib/cad-champions/content/overrides-server";
import { formatNumber } from "@/lib/cad-champions/format";
import { getLandingData } from "@/lib/cad-champions/landing/data";
import { visibleFaq } from "@/lib/cad-champions/landing/faq";
import { buildLandingJsonLd, serializeJsonLd } from "@/lib/cad-champions/landing/json-ld";
import { moduleText, skillAreaText, totalHours } from "@/lib/cad-champions/landing/seed";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccAlternates } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";
import { SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";

// /cad-champions/{en,ar}: the public landing page (Prompt 3). Twelve sections
// in the plan's order; all copy in messages/cad-champions/{en,ar}/landing.json.
// Skill areas + competition modules come from the DB with a seed fallback
// (lib/cad-champions/landing/data.ts). The layout keeps every CC route noindex.

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.landing" });
  const tShell = await getTranslations({ locale, namespace: "CC.shell" });
  const title = t("meta.title");
  const description = t("meta.description");
  const url = `${SITE_URL}${ccPath(locale, "/")}`;
  return {
    title: { absolute: title },
    description,
    alternates: ccAlternates(locale, "/"),
    openGraph: {
      type: "website",
      siteName: tShell("brand"),
      title,
      description,
      url,
      locale: locale === "ar" ? "ar_QA" : "en_US",
      alternateLocale: locale === "ar" ? ["en_US"] : ["ar_QA"],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const STEP_ICONS: Record<string, LucideIcon> = {
  account: UserPlus,
  ready: Wrench,
  test: Timer,
  report: BarChart3,
  train: GraduationCap,
};
const STEPS = ["account", "ready", "test", "report", "train"] as const;

const NEED_ICONS: Record<string, LucideIcon> = {
  computer: Monitor,
  software: Box,
  mouse: Mouse,
  time: Clock,
  internet: Wifi,
};
const NEEDS = ["computer", "software", "mouse", "time", "internet"] as const;
const TRACKS = ["inventor", "fusion", "solidworks"] as const;

const SKILL_ICONS: Record<number, LucideIcon> = {
  1: ClipboardList,
  2: Cpu,
  3: Box,
  4: Clapperboard,
  5: Ruler,
  6: DraftingCompass,
};

const LEVELS = ["l1", "l2", "l3", "l4", "l5", "l6"] as const;
const EQUIPMENT: { key: string; icon: LucideIcon }[] = [
  { key: "printers", icon: Printer },
  { key: "scanner", icon: ScanLine },
  { key: "cnc", icon: Cog },
  { key: "laser", icon: Zap },
];
const IN_PERSON = ["measure", "scan", "print", "mock"] as const;

function SectionHead({ id, kicker, title, intro }: { id: string; kicker: string; title: string; intro?: ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="kicker text-cobalt">{kicker}</span>
      <h2 id={id} className="title-section text-balance">
        {title}
      </h2>
      {intro ? <p className="max-w-2xl text-sm leading-relaxed text-body sm:text-base">{intro}</p> : null}
    </div>
  );
}

function IconBadge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cobalt/10 text-accent", className)}>
      <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
    </span>
  );
}

export default async function CcLandingPage({ params }: Params) {
  const { locale: raw } = await params;
  if (!isCcLocale(raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "CC.landing" });

  // A "[TODO-MO" placeholder or an empty name means no trainer has been hired yet (owner, 2026-10-16).

  const trainerName = t("studio.trainerName");

  const hasTrainer = trainerName.trim().length > 0 && !trainerName.includes("[TODO-MO");
  const [cc, data, overrides, overridesEn, testimonialRows] = await Promise.all([
    getCcUser(),
    getLandingData(),
    loadContentOverrides(locale),
    loadContentOverrides("en"),
    loadPublishedTestimonials(),
  ]);
  // Section 10: shown only while at least one testimonial is published (admin: Landing).
  const testimonials = publicTestimonials(testimonialRows, locale);

  const signedIn = Boolean(cc);
  const ctaHref = signedIn ? ccPath(locale, "/dashboard") : ccSignUpHref(locale, ccPath(locale, "/dashboard"));
  const contact = await getCcContact();
  const needWhatsapp = buildWhatsAppUrl(contact.whatsappNumber, t("need.whatsappText"));
  const finalWhatsapp = buildWhatsAppUrl(contact.whatsappNumber, t("final.whatsappText"));
  const n = (v: number) => formatNumber(v, locale);

  // Admin-edited FAQ copy (cc_content_overrides, 0085) wins; hidden items are dropped.
  const faq = visibleFaq()
    .filter((item) => overrides.get(faqHiddenKey(item.id)) !== "1" && overridesEn.get(faqHiddenKey(item.id)) !== "1")
    .map((item) => ({
      id: item.id,
      question: getOverride(overrides, msgKey(`landing.${item.questionKey}`), t(item.questionKey)),
      answer: getOverride(overrides, msgKey(`landing.${item.answerKey}`), t(item.answerKey)),
    }));
  const url = `${SITE_URL}${ccPath(locale, "/")}`;
  const jsonLd = buildLandingJsonLd({
    locale,
    url,
    siteUrl: SITE_URL,
    name: t("jsonLd.courseName"),
    description: t("jsonLd.courseDescription"),
    orgName: t("jsonLd.orgName"),
    orgDescription: t("jsonLd.orgDescription"),
    addressLocality: t("jsonLd.locality"),
    addressCountry: "QA",
    faq: faq.map((f) => ({ question: f.question, answer: f.answer })),
  });

  const ctaClass =
    "inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-accent px-7 py-3 text-base font-semibold text-accent-foreground shadow-neu-sm transition-colors hover:bg-cobalt-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:w-auto";
  const linkClass =
    "inline-flex min-h-[44px] items-center gap-1.5 rounded-full text-sm font-semibold text-cobalt hover:text-cobalt-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

  return (
    <div className="container space-y-6 py-6 sm:space-y-8 sm:py-10">
      {jsonLd.map((block, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(block) }} />
      ))}

      {/* 1. Hero */}
      <section aria-labelledby="cc-hero-title" className="neu grid grid-cols-1 items-center gap-6 px-5 py-7 sm:p-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10">
        <div className="min-w-0 space-y-4 sm:space-y-5">
          <span className="kicker text-cobalt">{t("hero.kicker")}</span>
          <h1 id="cc-hero-title" className="text-balance text-3xl font-extrabold leading-[1.15] tracking-tight text-heading sm:text-5xl sm:leading-[1.08]">
            {t("hero.title")}
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-body sm:text-lg">{t("hero.sub")}</p>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-6">
            <TrackLink href={ctaHref} event="cc_landing_hero_cta" props={{ signed_in: signedIn }} className={ctaClass}>
              {signedIn ? t("hero.ctaSignedIn") : t("hero.ctaSignedOut")}
              <ArrowRight aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
            </TrackLink>
            <ScrollLink targetId="how-it-works" className={cn(linkClass, "justify-center px-3 sm:justify-start sm:px-0")}>
              {t("hero.secondary")}
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
            </ScrollLink>
          </div>
          <p className="border-t border-borderstrong/40 pt-4 text-xs leading-relaxed text-mutedtext">{t("hero.note")}</p>
        </div>
        <div className="mx-auto w-full max-w-[22rem] sm:max-w-md lg:max-w-none">
          <HeroVisual label={t("hero.visualLabel")} />
        </div>
      </section>

      {/* 1b. Walkthrough video (self-hosted, poster first, plays on click; the
          get_ready_welcome clip, registry FILE_VIDEOS "cc-intro"). */}
      <section id="cc-intro-video" aria-labelledby="cc-video" className="neu grid grid-cols-1 items-center gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10">
        <SectionHead id="cc-video" kicker={t("video.kicker")} title={t("video.title")} intro={t("video.intro")} />
        <FilePlayer id="cc-intro" locale={locale} title={t("video.title")} playLabel={t("video.play")} />
      </section>

      {/* 2. Trust strip */}
      <section aria-labelledby="cc-trust" className="tile flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="cc-trust" className="sr-only">
          {t("trust.factsLabel")}
        </h2>
        <p className="text-sm font-semibold text-heading sm:text-base">{t("trust.by")}</p>
        <ul className="grid grid-cols-1 gap-2 text-sm text-body sm:grid-cols-3 sm:gap-6">
          {(["one", "two", "three"] as const).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
              <span>{t(`trust.facts.${k}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 3. How it works */}
      <section id="how-it-works" tabIndex={-1} aria-labelledby="cc-how" className="neu scroll-mt-24 space-y-6 p-5 focus:outline-none sm:p-8">
        <SectionHead id="cc-how" kicker={t("how.kicker")} title={t("how.title")} intro={t("how.intro")} />
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {STEPS.map((key, i) => (
            <li key={key} className="tile flex gap-3 md:flex-col">
              <IconBadge icon={STEP_ICONS[key]} />
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-semibold text-mutedtext">{t("how.stepLabel", { n: n(i + 1) })}</p>
                <h3 className="title-card">{t(`how.steps.${key}.title`)}</h3>
                <p className="text-sm leading-relaxed text-body">{t(`how.steps.${key}.text`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. What you need */}
      <section aria-labelledby="cc-need" className="neu space-y-6 p-5 sm:p-8">
        <SectionHead id="cc-need" kicker={t("need.kicker")} title={t("need.title")} intro={t("need.intro")} />
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {NEEDS.map((key) => {
            const Icon = NEED_ICONS[key];
            return (
              <li key={key} className="flex items-start gap-3 rounded-2xl bg-panel/60 p-3">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cobalt" />
                <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-mutedtext" strokeWidth={1.75} />
                <span className="text-sm leading-relaxed text-body sm:text-base">
                  {key === "software"
                    ? t.rich("need.items.software", { term: (chunks) => <Term id="step-file">{chunks}</Term> })
                    : t(`need.items.${key}`)}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="space-y-3">
          <h3 className="title-card">{t("need.tracksTitle")}</h3>
          <p className="text-sm text-body">{t("need.tracksIntro")}</p>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {TRACKS.map((key, i) => (
              <li key={key} className={cn("tile flex flex-col gap-2", i === 0 && "border-cobalt/50 ring-1 ring-cobalt/30")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cobalt/10 text-xs font-bold text-accent">
                    {n(i + 1)}
                  </span>
                  <Ltr className="font-bold text-heading">{t(`need.tracks.${key}.name`)}</Ltr>
                </div>
                {i === 0 ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
                    <Trophy aria-hidden="true" className="h-3.5 w-3.5" />
                    {t("need.recommended")}
                  </span>
                ) : null}
                <p className="text-sm leading-relaxed text-body">{t(`need.tracks.${key}.text`)}</p>
                {key === "solidworks" ? <p className="text-xs leading-relaxed text-mutedtext">{t("need.solidworksNote")}</p> : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="neu-inset flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-heading">{t("need.help")}</p>
          {needWhatsapp ? (
            <TrackLink href={needWhatsapp} external event="cc_landing_whatsapp" props={{ where: "need" }} className={linkClass}>
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
              {t("need.helpWhatsapp")}
            </TrackLink>
          ) : (
            <a href={`mailto:${contact.supportEmail}`} className={linkClass}>
              <Mail aria-hidden="true" className="h-4 w-4" />
              {t("need.helpEmail")}
            </a>
          )}
        </div>
      </section>

      {/* 5. What the competition tests + what it looks like */}
      <section aria-labelledby="cc-skills" className="neu space-y-6 p-5 sm:p-8">
        <SectionHead id="cc-skills" kicker={t("skills.kicker")} title={t("skills.title")} intro={t("skills.intro")} />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.skillAreas.map((area) => {
            const text = skillAreaText(area, locale);
            const weight = n(area.weight_percent);
            return (
              <li key={area.id} className="tile flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <IconBadge icon={SKILL_ICONS[area.id] ?? Box} />
                  <span
                    className="rounded-full bg-cobalt/10 px-2.5 py-1 text-xs font-bold text-accent"
                    aria-label={t("skills.weightAria", { name: text.name, weight })}
                  >
                    {t("skills.weight", { weight })}
                  </span>
                </div>
                <h3 className="title-card">{text.name}</h3>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-borderstrong/30" aria-hidden="true">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, area.weight_percent * (100 / 30))}%` }} />
                </div>
                <p className="text-sm leading-relaxed text-body">{text.description}</p>
              </li>
            );
          })}
        </ul>

        <div className="space-y-4 border-t border-borderstrong/30 pt-6">
          <div className="space-y-2">
            <span className="kicker text-cobalt">{t("modules.kicker")}</span>
            <h3 className="text-xl font-extrabold tracking-tight text-heading sm:text-2xl">{t("modules.title")}</h3>
            <p className="max-w-2xl text-sm leading-relaxed text-body sm:text-base">{t("modules.intro")}</p>
          </div>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data.modules.map((m) => {
              const text = moduleText(m, locale);
              return (
                <li key={m.code} className="tile flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase text-accent">
                      {t("modules.code", { code: m.code })}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-white">
                      <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("modules.hours", { hours: n(m.hours) })}
                    </span>
                  </div>
                  <h4 className="title-card">{text.name}</h4>
                  <p className="text-sm leading-relaxed text-body">{text.summary}</p>
                </li>
              );
            })}
          </ol>
          <p className="text-sm font-semibold text-heading">{t("modules.total", { hours: n(totalHours(data.modules)) })}</p>
          <p className="text-sm leading-relaxed text-body">
            {t.rich("modules.projection", { term: (chunks) => <Term id="first-angle-projection">{chunks}</Term> })}
          </p>
          <p className="text-sm leading-relaxed text-body">
            {t.rich("modules.alsoTested", { term: (chunks) => <Term id="mbd">{chunks}</Term> })}
          </p>
        </div>

        <div className="neu-inset space-y-2 p-4 text-xs leading-relaxed text-mutedtext sm:text-sm">
          <p>{t("skills.about")}</p>
          <p className="font-semibold">{t("skills.disclaimer")}</p>
        </div>
      </section>

      {/* 6. How your test is graded */}
      <section aria-labelledby="cc-grading" className="neu space-y-6 p-5 sm:p-8">
        <SectionHead
          id="cc-grading"
          kicker={t("grading.kicker")}
          title={t("grading.title")}
          intro={t.rich("grading.body", { term: (chunks) => <Term id="mass-properties">{chunks}</Term> })}
        />
        <figure aria-label={t("grading.flowLabel")} className="m-0">
          <ol className="grid grid-cols-1 items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-3">
            {(
              [
                { key: "model", icon: Box },
                { key: "measure", icon: Ruler },
                { key: "score", icon: Gauge },
              ] as const
            ).map((step, i, arr) => (
              <li key={step.key} className="contents">
                <div className="tile flex items-center gap-3 md:flex-col md:text-center">
                  <IconBadge icon={step.icon} />
                  <div className="min-w-0">
                    <p className="title-card">{t(`grading.flow.${step.key}.title`)}</p>
                    <p className="text-sm text-body">{t(`grading.flow.${step.key}.text`)}</p>
                  </div>
                </div>
                {i < arr.length - 1 ? (
                  <div className="flex items-center justify-center text-accent" aria-hidden="true">
                    <ArrowDown className="h-5 w-5 md:hidden" />
                    <ArrowRight className="hidden h-5 w-5 rtl:-scale-x-100 md:block" />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </figure>
        <p className="text-sm leading-relaxed text-body">{t("grading.judgement")}</p>
      </section>

      {/* 7. Training ladder */}
      <section aria-labelledby="cc-ladder" className="neu space-y-6 p-5 sm:p-8">
        <SectionHead id="cc-ladder" kicker={t("ladder.kicker")} title={t("ladder.title")} intro={t("ladder.caption")} />
        <ol className="flex flex-col gap-2 md:grid md:grid-cols-6 md:items-end md:gap-2">
          {LEVELS.map((key, i) => (
            <li
              key={key}
              style={{ "--lvl": i + 1 } as CSSProperties}
              className={cn(
                "flex flex-col justify-start gap-1 rounded-2xl border border-border p-4",
                "ms-[calc((var(--lvl)_-_1)_*_0.6rem)] md:ms-0 md:min-h-[calc(6.5rem_+_var(--lvl)_*_1.75rem)]",
                i === LEVELS.length - 1 ? "bg-accent text-accent-foreground" : "bg-panel",
              )}
            >
              <span className={cn("text-xs font-bold", i === LEVELS.length - 1 ? "text-white/90" : "text-accent")}>
                {t("ladder.level", { n: n(i + 1) })}
              </span>
              <h3 className={cn("text-sm font-bold", i === LEVELS.length - 1 ? "text-accent-foreground" : "text-heading")}>
                {t(`ladder.levels.${key}.title`)}
              </h3>
              <p className={cn("text-xs leading-relaxed", i === LEVELS.length - 1 ? "text-white/90" : "text-body")}>
                {t(`ladder.levels.${key}.text`)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* 8. Trainer and studio */}
      <section aria-labelledby="cc-studio" className="neu space-y-6 p-5 sm:p-8">
        <SectionHead id="cc-studio" kicker={t("studio.kicker")} title={t("studio.title")} intro={t("studio.intro")} />
        <div className={cn("grid grid-cols-1 gap-4", hasTrainer && "md:grid-cols-2")}>
          {/* Trainer card: hidden until a trainer is hired (owner, 2026-10-16). Set
              studio.trainerName in Admin -> Landing to show it again. */}
          {hasTrainer && (
          <div className="tile flex flex-col gap-4 sm:flex-row">
            <div
              role="img"
              aria-label={t("studio.photoTrainer")}
              className="flex aspect-square w-full shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-borderstrong bg-background text-mutedtext sm:w-36"
            >
              <Camera aria-hidden="true" className="h-6 w-6" />
              <span className="px-2 text-center text-xs">{t("studio.photoTrainer")}</span>
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="title-card">{t("studio.trainerName")}</h3>
              <p className="text-xs font-semibold text-mutedtext">{t("studio.trainerRole")}</p>
              <p className="text-sm leading-relaxed text-body">{t("studio.bio")}</p>
            </div>
          </div>
          )}
          <div className="tile flex flex-col gap-4">
            <div
              role="img"
              aria-label={t("studio.photoStudio")}
              className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-borderstrong bg-background text-mutedtext"
            >
              <Camera aria-hidden="true" className="h-6 w-6" />
              <span className="px-2 text-center text-xs">{t("studio.photoStudio")}</span>
            </div>
            <div className="space-y-2">
              <h3 className="title-card">{t("studio.equipmentTitle")}</h3>
              <ul className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                {EQUIPMENT.map(({ key, icon: Icon }) => (
                  <li key={key} className="flex items-center gap-2 text-sm text-body">
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
                    {t(`studio.equipment.${key}`)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 9. In-person sessions */}
      <section aria-labelledby="cc-in-person" className="neu space-y-6 p-5 sm:p-8">
        <SectionHead id="cc-in-person" kicker={t("inPerson.kicker")} title={t("inPerson.title")} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="tile space-y-2 md:col-span-1">
            <h3 className="title-card">{t("inPerson.whatTitle")}</h3>
            <ul className="space-y-2">
              {IN_PERSON.map((k) => (
                <li key={k} className="flex items-start gap-2 text-sm leading-relaxed text-body">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {t(`inPerson.what.${k}`)}
                </li>
              ))}
            </ul>
          </div>
          <div className="tile space-y-2">
            <h3 className="flex items-center gap-2 title-card">
              <MapPin aria-hidden="true" className="h-4 w-4 text-accent" />
              {t("inPerson.whereTitle")}
            </h3>
            <p className="text-sm leading-relaxed text-body">{t("inPerson.where")}</p>
          </div>
          <div className="tile space-y-2">
            <h3 className="flex items-center gap-2 title-card">
              <Users aria-hidden="true" className="h-4 w-4 text-accent" />
              {t("inPerson.whoTitle")}
            </h3>
            <p className="text-sm leading-relaxed text-body">{t("inPerson.who")}</p>
          </div>
        </div>
      </section>

      {/* 10. Testimonials: hidden until at least one is published (admin: Landing). */}
      {testimonials.length > 0 ? (
        <section aria-labelledby="cc-testimonials" className="neu space-y-4 p-5 sm:p-8">
          <h2 id="cc-testimonials" className="title-section">
            {t("testimonials.title")}
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {testimonials.map((q) => (
              <li key={q.id} className="tile">
                <blockquote className="text-sm text-body">{q.quote}</blockquote>
                <p className="mt-2 text-xs font-semibold text-mutedtext">
                  {q.name}
                  {q.role ? ` · ${q.role}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 11. FAQ */}
      <section aria-labelledby="cc-faq" className="neu space-y-6 p-5 sm:p-8">
        <SectionHead id="cc-faq" kicker={t("faq.kicker")} title={t("faq.title")} intro={t("faq.intro")} />
        <FaqAccordion items={faq} />
      </section>

      {/* 12. Final call to action */}
      <section aria-labelledby="cc-final" className="neu flex flex-col items-start gap-4 p-6 sm:p-10">
        <h2 id="cc-final" className="title-section text-balance">
          {t("final.title")}
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-body">{t("final.text")}</p>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-6">
          <TrackLink href={ctaHref} event="cc_landing_final_cta" props={{ signed_in: signedIn }} className={ctaClass}>
            {signedIn ? t("final.ctaSignedIn") : t("final.ctaSignedOut")}
            <ArrowRight aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
          </TrackLink>
          {finalWhatsapp ? (
            <TrackLink
              href={finalWhatsapp}
              external
              event="cc_landing_whatsapp"
              props={{ where: "final" }}
              className={cn(linkClass, "justify-center px-3 sm:px-0")}
            >
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
              {t("final.whatsapp")}
            </TrackLink>
          ) : null}
        </div>
      </section>
    </div>
  );
}
