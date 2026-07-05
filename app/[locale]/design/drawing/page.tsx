import { getTranslations, setRequestLocale } from "next-intl/server";
import { MessageCircle, PencilRuler, FileCheck2, Send } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The business WhatsApp number, digits only (e.g. 974XXXXXXXX). When unset, all
// CTAs fall back to the contact page instead of a broken wa.me link.
const WHATSAPP_DIGITS =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;

export default async function CadAssistancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("CadAssistance");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const waHref = WHATSAPP_DIGITS ? `https://wa.me/${WHATSAPP_DIGITS}` : null;

  const specs = [
    { label: t("specTurnaroundLabel"), value: t("specTurnaroundValue") },
    { label: t("specOutputLabel"), value: t("specOutputValue") },
    { label: t("specPriceLabel"), value: t("specPriceValue") },
  ];

  const steps = [
    { icon: Send, title: t("step1Title"), copy: t("step1Copy") },
    { icon: PencilRuler, title: t("step2Title"), copy: t("step2Copy") },
    { icon: FileCheck2, title: t("step3Title"), copy: t("step3Copy") },
  ];

  const tiers = [
    { name: t("tier1Name"), desc: t("tier1Desc"), price: t("tier1Price") },
    { name: t("tier2Name"), desc: t("tier2Desc"), price: t("tier2Price") },
    { name: t("tier3Name"), desc: t("tier3Desc"), price: t("tier3Price") },
  ];

  // Primary CTA: WhatsApp deep link when configured, contact page otherwise.
  const cta = waHref ? (
    <Button asChild size="lg" className="rounded-full px-7">
      <a href={waHref} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="h-4 w-4" />
        {t("ctaWhatsApp")}
      </a>
    </Button>
  ) : (
    <Button asChild size="lg" className="rounded-full px-7">
      <Link href="/contact">{t("ctaFallback")}</Link>
    </Button>
  );

  return (
    <div className="container space-y-6 py-6">
      {/* Hero */}
      <section className="neu animate-fade-up flex flex-col justify-between gap-10 p-8 sm:p-10 lg:p-12">
        <div className="space-y-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
            <span className="h-2 w-2 rounded-full bg-cobalt" />
            <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
          </span>

          <h1 className="max-w-3xl text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl">
            {t("heading")}
          </h1>

          <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">
            {t("subheading")}
          </p>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          {cta}
          <div className="grid w-full grid-cols-3 gap-2 sm:max-w-md">
            {specs.map((s) => (
              <div key={s.label} className="rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm">
                <span className={mono("block text-[8.5px] text-faint")}>{s.label}</span>
                <span className="mt-1 block text-xs font-bold text-heading">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How the service works */}
      <section className="neu animate-fade-up delay-1 p-8 sm:p-10">
        <span className={mono("text-[10px] text-cobalt")}>{t("stepsTag")}</span>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
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

      {/* Pricing */}
      <section className="neu animate-fade-up delay-2 p-8 sm:p-10">
        <div className="mb-6 flex flex-col gap-2">
          <span className={mono("text-[10px] text-cobalt")}>{t("pricingTag")}</span>
          <h2 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
            {t("pricingHeading")}
          </h2>
        </div>

        {/* Header row (hidden on mobile, where each tier stacks) */}
        <div className="hidden grid-cols-[1.2fr_2fr_0.8fr] gap-4 px-4 pb-2 sm:grid">
          <span className={mono("text-[10px] text-faint")}>{t("colTier")}</span>
          <span className={mono("text-[10px] text-faint")}>{t("colDescription")}</span>
          <span className={mono("text-[10px] text-faint text-end")}>{t("colPrice")}</span>
        </div>
        <div className="space-y-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className="neu-inset flex flex-col gap-1.5 px-4 py-4 sm:grid sm:grid-cols-[1.2fr_2fr_0.8fr] sm:items-center sm:gap-4"
            >
              <span className="text-sm font-bold text-heading">{tier.name}</span>
              <span className="text-sm leading-relaxed text-mutedtext">{tier.desc}</span>
              <span className="text-sm font-extrabold tabular-nums text-cobalt sm:text-end">
                {tier.price}
              </span>
            </div>
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
          <div className="relative">
            {waHref ? (
              <Button asChild size="lg" variant="secondary" className="rounded-full px-7">
                <a href={waHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  {t("ctaWhatsApp")}
                </a>
              </Button>
            ) : (
              <Button asChild size="lg" variant="secondary" className="rounded-full px-7">
                <Link href="/contact">{t("ctaFallback")}</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
