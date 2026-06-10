import { getTranslations, setRequestLocale } from "next-intl/server";
import { MessageCircle, ShoppingCart } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The business WhatsApp number, digits only. When unset, the waitlist CTA
// falls back to the contact page instead of a broken wa.me link.
const WHATSAPP_DIGITS =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;

export default async function PartsStorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("PartsStore");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const waHref = WHATSAPP_DIGITS
    ? `https://wa.me/${WHATSAPP_DIGITS}?text=${encodeURIComponent(t("waitlistMessage"))}`
    : null;

  return (
    <div className="container py-6">
      <section className="neu animate-fade-up flex flex-col items-center gap-8 p-8 text-center sm:p-12 lg:p-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <span className={mono("text-[10px] text-mutedtext")}>
            {t("kicker")} · {t("comingSoon")}
          </span>
        </span>

        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cobalt shadow-neu-sm">
          <ShoppingCart className="h-8 w-8 text-white" strokeWidth={1.5} />
        </span>

        <div className="space-y-4">
          <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl">
            {t("heading")}
          </h1>
          <p className="mx-auto max-w-xl text-base leading-relaxed text-body sm:text-lg">
            {t("subtext")}
          </p>
        </div>

        {waHref ? (
          <Button asChild size="lg" className="rounded-full px-7">
            <a href={waHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              {t("waitlistCta")}
            </a>
          </Button>
        ) : (
          <Button asChild size="lg" className="rounded-full px-7">
            <Link href="/contact">{t("waitlistFallback")}</Link>
          </Button>
        )}
      </section>
    </div>
  );
}
