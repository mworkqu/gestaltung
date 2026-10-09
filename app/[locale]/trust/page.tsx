import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { TrustedBy, TrustItemCards } from "@/components/trust-block";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";

export const generateMetadata = metaFor("trust");

// Trust (P1-04): the promises from the site-wide trust block, in full. Static:
// the only data read is the cached, cookie-free store_settings.trusted_by.
export default async function TrustPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Trust");
  const isRtl = locale === "ar";

  return (
    <div className="container space-y-6 py-6">
      <section className="neu animate-fade-up flex flex-col gap-5 p-8 sm:p-10 lg:p-12">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className={cn("text-[10px] text-mutedtext", isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]")}>
            {t("kicker")}
          </span>
        </span>
        <h1 className="max-w-3xl text-balance text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
          {t("pageHeading")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("pageSub")}</p>
      </section>

      <section aria-label={t("heading")} className="neu animate-fade-up delay-1 space-y-6 p-6 sm:p-8">
        <TrustItemCards full />
        <TrustedBy />
      </section>

      <section className="neu animate-fade-up delay-2 flex flex-col gap-5 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight text-heading">{t("questionsTitle")}</h2>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("questionsText")}</p>
        </div>
        <Button asChild size="lg" className="w-full shrink-0 rounded-full sm:w-auto">
          <Link href="/contact">{t("questionsCta")}</Link>
        </Button>
      </section>
    </div>
  );
}
