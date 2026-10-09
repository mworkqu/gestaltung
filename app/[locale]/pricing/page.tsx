import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  Box,
  CircuitBoard,
  FolderKanban,
  Gift,
  ListChecks,
  MessageCircle,
  PencilRuler,
  Rocket,
  RotateCcw,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PricingViewed } from "@/components/analytics/pricing-viewed";
import { TrackClick } from "@/components/analytics/track-click";
import { CreditsOverview } from "@/components/credits/credits-overview";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { CAD_GENERATIONS, ORDER_DELIVERED_CREDITS, PROJECT_LIMIT } from "@/lib/credits/constants";
import { metaFor } from "@/lib/meta";
import type { Plan } from "@/lib/pricing/defaults";
import { formatPerOutput, formatQar, isContactPlan, planOrderDesktop, planOrderMobile } from "@/lib/pricing/plans";
import { getPricingPlans, getServicePrices } from "@/lib/store/public-catalog";
import { cn } from "@/lib/utils";

export const generateMetadata = metaFor("pricing");

// Literal class names so Tailwind generates them: phones follow the DOM order
// (mobile order), lg follows the desktop order. One markup, two orders.
const ORDER = ["order-1", "order-2", "order-3", "order-4"] as const;
const LG_ORDER = ["lg:order-1", "lg:order-2", "lg:order-3", "lg:order-4"] as const;

// Pricing (P1-06 / P1-07 / P1-10). Static: the only data read is the cached,
// cookie-free store_settings (pricing_plans, service_prices; defaults until
// 0051 runs). Plans are DISPLAY-ONLY: no billing, the CTAs open a project, a
// WhatsApp chat or the contact form. Every number comes from the settings
// objects (or lib/credits/constants for the 0042 rules), never from JSX.
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Pricing");
  const [pricing, services] = await Promise.all([getPricingPlans(), getServicePrices()]);
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  const price = formatPerOutput(pricing.overage_per_credit_qar);
  const days = formatQar(pricing.refund_window_days);
  const maker = pricing.plans.find((p) => p.id === "maker");
  const makerProjects = formatQar(
    maker && !isContactPlan(maker) && maker.active_projects ? maker.active_projects : PROJECT_LIMIT,
  );

  const mobile = planOrderMobile(pricing.plans);
  const desktop = planOrderDesktop(pricing.plans);

  const whatsappFor = (text: string) => `${COMPANY_WHATSAPP.url}?text=${encodeURIComponent(text)}`;

  /** The rows under the price, in the order of the plan table (doc 01 §4.3). */
  const rowsFor = (plan: Plan): { label: string; value: string }[] => {
    if (isContactPlan(plan)) {
      return [
        { label: t("rowProjects"), value: t("projectsInstitutions") },
        { label: t("rowAi"), value: t("aiPooled") },
        { label: t("rowOverage"), value: t("invoice") },
        { label: t("rowHuman"), value: t("humanInstitutions") },
        { label: t("rowFab"), value: t("fabNegotiated") },
        { label: t("rowRefund"), value: t("invoice") },
      ];
    }
    const includesAi = plan.wiring_per_month > 0 || plan.cad_per_month > 0;
    return [
      {
        label: t("rowProjects"),
        value:
          plan.active_projects === null
            ? t("projectsUnlimited")
            : t("projectsCount", { n: formatQar(plan.active_projects) }),
      },
      {
        label: t("rowAi"),
        value: includesAi
          ? t("aiIncluded", { wiring: formatQar(plan.wiring_per_month), cad: formatQar(plan.cad_per_month) })
          : t("aiFree"),
      },
      { label: t("rowOverage"), value: t("overageCredit", { price }) },
      { label: t("rowHuman"), value: t(`human_${plan.human}`) },
      {
        label: t("rowFab"),
        value: plan.kit_discount_pct > 0 ? t("fabKitDiscount", { pct: formatQar(plan.kit_discount_pct) }) : t("fabList"),
      },
      { label: t("rowRefund"), value: t("refundWindow", { days }) },
    ];
  };

  const ctaFor = (plan: Plan, primary: boolean) => {
    const cls = "w-full rounded-full";
    const variant = primary ? "default" : "outline";
    if (isContactPlan(plan))
      return (
        <div className="space-y-1">
          <Button asChild size="lg" variant={variant} className={cls}>
            <Link href="/contact?kind=institution">{t("ctaContact")}</Link>
          </Button>
          {/* P2-05: the lab licence page. */}
          <Link
            href="/institutions"
            className="flex min-h-11 items-center justify-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("institutionsLearn")}
            <ArrowRight className={arrow} />
          </Link>
        </div>
      );
    if (plan.price_qar_month === 0)
      return (
        <Button asChild size="lg" variant={variant} className={cls}>
          <Link href="/projects/new">{t("ctaStart")}</Link>
        </Button>
      );
    return (
      <TrackClick event="pricing_viewed" params={{ plan: plan.id }}>
        <Button asChild size="lg" variant={variant} className={cls}>
          <a
            href={whatsappFor(t("whatsappText", { plan: t(`plan_${plan.id}`) }))}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            {t("ctaWhatsApp")}
          </a>
        </Button>
      </TrackClick>
    );
  };

  const creditCards: { icon: LucideIcon; title: string; text: string }[] = [
    { icon: CircuitBoard, title: t("creditCostTitle"), text: t("creditCostText", { n: formatQar(CAD_GENERATIONS) }) },
    { icon: ListChecks, title: t("creditFreeTitle"), text: t("creditFreeText") },
    { icon: RotateCcw, title: t("creditBackTitle"), text: t("creditBackText", { days, price }) },
    { icon: FolderKanban, title: t("creditProjectsTitle"), text: t("creditProjectsText", { n: makerProjects }) },
    {
      icon: ShoppingBag,
      title: t("creditEarnTitle"),
      text: t("creditEarnText", {
        wiring: formatQar(ORDER_DELIVERED_CREDITS.wiring),
        cad: formatQar(ORDER_DELIVERED_CREDITS.cad),
      }),
    },
  ];

  const serviceCards: {
    icon: LucideIcon;
    title: string;
    price: string;
    text: string;
    cta: string;
    href: string;
  }[] = [
    {
      icon: Box,
      title: t("enclosureTitle"),
      price: t("enclosurePrice", { n: formatQar(services.enclosure_from) }),
      text: t("enclosureText"),
      cta: t("enclosureCta"),
      href: "/projects/new",
    },
    {
      icon: PencilRuler,
      title: t("drawingTitle"),
      price: t("drawingPrice", {
        simple: formatQar(services.drawing_simple),
        assembly: formatQar(services.drawing_assembly),
        complex: formatQar(services.drawing_complex_from),
      }),
      text: t("drawingText"),
      cta: t("drawingCta"),
      href: "/design/drawing",
    },
    {
      icon: Rocket,
      title: t("sprintTitle"),
      price: t("sprintPrice", { n: formatQar(services.sprint_from) }),
      text: t("sprintText"),
      cta: t("sprintCta"),
      href: "/contact?kind=institution",
    },
  ];

  const linkCls = "font-semibold text-cobalt hover:underline";
  const faqs: { q: string; a: React.ReactNode }[] = [
    { q: t("faq1Q"), a: t("faq1A", { price, days }) },
    { q: t("faq2Q"), a: t("faq2A") },
    { q: t("faq3Q"), a: t("faq3A") },
    {
      q: t("faq4Q"),
      a: t.rich("faq4A", {
        terms: (chunks) => (
          <Link href="/terms" className={linkCls}>
            {chunks}
          </Link>
        ),
      }),
    },
    {
      q: t("faq5Q"),
      a: t.rich("faq5A", {
        contact: (chunks) => (
          <Link href="/contact?kind=institution" className={linkCls}>
            {chunks}
          </Link>
        ),
      }),
    },
    { q: t("faq6Q"), a: t("faq6A", { n: makerProjects }) },
  ];

  return (
    <div className="container space-y-6 py-6">
      <PricingViewed />
      {/* Hero */}
      <section className="neu animate-fade-up flex flex-col gap-5 p-8 sm:p-10 lg:p-12">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
        </span>
        <h1 className="max-w-3xl text-balance text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("sub", { price, days })}</p>
      </section>

      {/* Plans: Studio first on wide screens (anchor), Maker first on phones. */}
      <section aria-labelledby="plans-heading" className="animate-fade-up delay-1 space-y-5">
        <div className="space-y-1 px-1">
          <h2 id="plans-heading" className="text-balance text-2xl font-extrabold tracking-tight text-heading">
            {t("plansHeading")}
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-body">{t("plansIntro")}</p>
        </div>

        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {mobile.map((plan, i) => {
            const target = !isContactPlan(plan) && plan.target === true;
            const d = desktop.findIndex((p) => p.id === plan.id);
            return (
              <li
                key={plan.id}
                className={cn(
                  "neu relative flex min-w-0 flex-col gap-5 p-6",
                  ORDER[i],
                  LG_ORDER[d],
                  target && "ring-2 ring-cobalt/60",
                )}
              >
                <div className="space-y-1">
                  {target && (
                    <span className="mb-2 inline-flex w-fit rounded-full bg-cobalt px-3 py-1 text-[11px] font-semibold text-white shadow-neu-sm">
                      {t("targetBadge")}
                    </span>
                  )}
                  <h3 className="text-xl font-extrabold tracking-tight text-heading">{t(`plan_${plan.id}`)}</h3>
                  <p className="text-sm text-mutedtext">{t(`for_${plan.id}`)}</p>
                </div>

                <p className="min-h-[3.25rem] text-heading">
                  <span className="sr-only">{t("rowPrice")}: </span>
                  {isContactPlan(plan) ? (
                    <span className="text-lg font-bold">{t("priceInstitutions")}</span>
                  ) : plan.price_qar_month === 0 ? (
                    <span className="text-3xl font-extrabold tracking-tight">{t("priceFree")}</span>
                  ) : (
                    <>
                      <span className="text-3xl font-extrabold tabular-nums tracking-tight">
                        {t("priceAmount", { n: formatQar(plan.price_qar_month) })}
                      </span>{" "}
                      <span className="text-sm text-mutedtext">{t("perMonth")}</span>
                    </>
                  )}
                </p>

                <dl className="flex-1 space-y-3 border-t border-borderstrong/40 pt-4 text-sm">
                  {rowsFor(plan).map((row) => (
                    <div key={row.label} className="space-y-0.5">
                      <dt className="text-xs font-semibold text-mutedtext">{row.label}</dt>
                      <dd className="tabular-nums text-heading">{row.value}</dd>
                    </div>
                  ))}
                </dl>

                {ctaFor(plan, target)}
              </li>
            );
          })}
        </ul>

        <p className="px-1 text-sm text-body">{t("paidNote")}</p>
      </section>

      {/* How credits work — explained once; /credits redirects here. */}
      <section id="credits" className="neu animate-fade-up delay-2 scroll-mt-24 space-y-6 p-8 sm:p-10">
        <div className="max-w-2xl space-y-2">
          <span className={mono("text-[10px] text-cobalt")}>{t("creditsKicker")}</span>
          <h2 className="text-balance text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
            {t("creditsHeading")}
          </h2>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("creditsIntro", { price })}</p>
        </div>

        {/* The signed-in visitor's own balance (client; nothing until it loads). */}
        <MessagesScope scope="pricing">
          <CreditsOverview />
        </MessagesScope>

        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {creditCards.map(({ icon: Icon, title, text }) => (
            <li key={title} className="min-w-0 rounded-2xl bg-panel p-5 shadow-neu-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-bold text-heading">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{text}</p>
            </li>
          ))}
          <li className="min-w-0 rounded-2xl bg-panel p-5 shadow-neu-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
              <Gift className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            </span>
            <h3 className="mt-4 text-base font-bold text-heading">{t("creditTopupTitle")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t("creditTopupText", { price })}</p>
            <a
              href={whatsappFor(t("topupWhatsappText"))}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
            >
              {t("creditTopupCta")}
              <ArrowRight className={arrow} aria-hidden />
            </a>
          </li>
        </ul>

        <p className="neu-inset px-5 py-4 text-sm font-semibold leading-relaxed text-heading sm:text-base">
          {t("lossLine", { price })}
        </p>
      </section>

      {/* Services, from (P1-07) */}
      <section aria-labelledby="services-heading" className="neu animate-fade-up delay-2 space-y-6 p-8 sm:p-10">
        <div className="max-w-2xl space-y-2">
          <span className={mono("text-[10px] text-cobalt")}>{t("servicesKicker")}</span>
          <h2 id="services-heading" className="text-balance text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
            {t("servicesHeading")}
          </h2>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("servicesIntro")}</p>
        </div>
        <ul className="grid gap-5 lg:grid-cols-3">
          {serviceCards.map(({ icon: Icon, title, price: from, text, cta, href }) => (
            <li key={href} className="flex min-w-0 flex-col rounded-2xl bg-panel p-5 shadow-neu-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-bold text-heading">{title}</h3>
              <p className="mt-1 text-lg font-extrabold tabular-nums text-cobalt">{from}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-mutedtext">{text}</p>
              <Link
                href={href}
                className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
              >
                {cta}
                <ArrowRight className={arrow} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-heading" className="neu animate-fade-up delay-3 p-8 sm:p-10">
        <h2 id="faq-heading" className="mb-6 text-balance text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
          {t("faqHeading")}
        </h2>
        <dl className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          {faqs.map(({ q, a }) => (
            <div key={q} className="space-y-1.5">
              <dt className="text-base font-bold text-heading">{q}</dt>
              <dd className="text-sm leading-relaxed text-body">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
