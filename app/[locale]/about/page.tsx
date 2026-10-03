import { getTranslations, setRequestLocale } from "next-intl/server";
import { Building2, Wrench, Handshake, MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";

export const generateMetadata = metaFor("about");

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("About");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const sections = [
    { icon: Building2, title: t("whoTitle"), paragraphs: [t("whoBody")] },
    { icon: Wrench, title: t("makeTitle"), paragraphs: [t("makeBody"), t("makeBody2")] },
    { icon: Handshake, title: t("partnersTitle"), paragraphs: [t("partnersBody")] },
  ];

  return (
    <div className="container space-y-6 py-6">
      {/* Hero */}
      <section className="neu animate-fade-up flex flex-col gap-6 p-8 sm:p-10 lg:p-12">
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
      </section>

      {/* Who / what / partners */}
      <section className="animate-fade-up delay-1 grid gap-6 md:grid-cols-3">
        {sections.map(({ icon: Icon, title, paragraphs }) => (
          <div key={title} className="neu p-7">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
              <Icon className="h-6 w-6 text-cobalt" strokeWidth={1.5} />
            </span>
            <h2 className="mt-5 text-lg font-bold text-heading">{title}</h2>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-mutedtext">
              {paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Contact */}
      <section className="neu animate-fade-up delay-2 flex flex-col gap-5 p-8 sm:p-10">
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-heading">{t("ctaTitle")}</h2>
          <p className="max-w-xl text-sm leading-relaxed text-mutedtext sm:text-base">
            {t("ctaCopy")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button asChild size="lg" className="rounded-full">
            <a href={COMPANY_WHATSAPP.url} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              {t("ctaWhatsapp")}
              <span dir="ltr">{COMPANY_WHATSAPP.display}</span>
            </a>
          </Button>
          <Link
            href="/contact"
            className="text-sm font-semibold text-azure transition-colors hover:text-cobalt-hover"
          >
            {t("ctaContact")}
          </Link>
        </div>
      </section>
    </div>
  );
}
