import { getTranslations, setRequestLocale } from "next-intl/server";
import { MessageCircle, ShoppingBag, Zap } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { CreditsOverview } from "@/components/credits/credits-overview";
import { CREDIT_QAR, REDEEM_DAYS } from "@/lib/credits/constants";
import { metaFor } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { MessagesScope } from "@/components/i18n/messages-scope";

// "Get credits": how AI credits work and how to get more. No online payment
// yet — credits come with store orders, or a WhatsApp/bank top-up the owner
// records by hand (dashboard › AI credits). Online payment comes later.

export const generateMetadata = metaFor("credits");

const WHATSAPP_DIGITS = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;

export default async function CreditsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Credits");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const whatsapp = WHATSAPP_DIGITS
    ? `https://wa.me/${WHATSAPP_DIGITS}?text=${encodeURIComponent(t("whatsappText"))}`
    : null;

  const rules = [t("rule1"), t("rule2", { qar: CREDIT_QAR }), t("rule3", { qar: CREDIT_QAR, days: REDEEM_DAYS }), t("rule4")];

  return (
    <MessagesScope scope="credits">
    <div className="container max-w-4xl space-y-8 py-8">
      <header className="space-y-2">
        <p className={mono("text-[10px] text-azure")}>{t("pageKicker")}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">{t("pageTitle")}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-body">{t("pageIntro")}</p>
      </header>

      <CreditsOverview />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="neu space-y-3 p-6">
          <ShoppingBag className="h-5 w-5 text-cobalt" aria-hidden />
          <h2 className="text-lg font-bold text-heading">{t("wayStoreTitle")}</h2>
          <p className="text-sm text-body">{t("wayStoreBody")}</p>
          <Link href="/store" className="inline-block text-sm font-semibold text-cobalt hover:text-cobalt-hover">
            {t("wayStoreCta")}
          </Link>
        </section>
        <section className="neu space-y-3 p-6">
          <MessageCircle className="h-5 w-5 text-cobalt" aria-hidden />
          <h2 className="text-lg font-bold text-heading">{t("wayTopupTitle")}</h2>
          <p className="text-sm text-body">{t("wayTopupBody", { qar: CREDIT_QAR })}</p>
          {whatsapp ? (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-cobalt hover:text-cobalt-hover">
              {t("wayTopupCta")}
            </a>
          ) : (
            <Link href="/contact" className="inline-block text-sm font-semibold text-cobalt hover:text-cobalt-hover">
              {t("wayTopupContact")}
            </Link>
          )}
          <p className="text-[11.5px] text-mutedtext">{t("onlineLater")}</p>
        </section>
      </div>

      <section className="neu space-y-3 p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
          <Zap className="h-4 w-4 text-cobalt" aria-hidden />
          {t("rulesTitle")}
        </h2>
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-body">
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
    </MessagesScope>
  );
}
