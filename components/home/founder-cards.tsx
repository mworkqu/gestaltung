import { getTranslations } from "next-intl/server";
import { ArrowRight, MessageCircle, PackageCheck, Rocket } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { ChoiceHead } from "@/components/marketing/v2";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";

// "Built for hardware founders" (W7): each outcome card is one link with a
// hover lift and a direction arrow (mirrored in RTL). Server component, no JS.
//   Weeks to a prototype → /projects/new · Parts stocked → /store · One contact → WhatsApp.

const cardBase =
  "group flex min-w-0 flex-col gap-4 text-start outline-none transition-[transform,border-color,box-shadow] duration-200 hover:border-cobalt/40 hover:shadow-neu-sm focus-visible:ring-2 focus-visible:ring-cobalt/60 motion-safe:hover:-translate-y-0.5";

/** `neu` = raised cards on the page background (v1 home); `tile` = flat tiles inside a .neu section (v2). */
export async function FounderCards({ locale, variant = "tile" }: { locale: string; variant?: "tile" | "neu" }) {
  const card = cn(cardBase, variant === "tile" ? "tile" : "neu border border-transparent p-5");
  const t = await getTranslations("StoreLanding");
  const th = await getTranslations("HomeHero");
  const isRtl = locale === "ar";
  const arrow = (
    <span
      aria-hidden
      className="mt-auto flex h-9 w-9 items-center justify-center self-end rounded-full bg-surface text-cobalt shadow-neu-sm transition-transform duration-200 group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
    >
      <ArrowRight className={cn("h-4 w-4", isRtl && "-scale-x-100")} />
    </span>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="founder-cards">
      <Link href="/projects/new" className={card}>
        <ChoiceHead icon={<Rocket className="h-4 w-4" />} title={t("founders1Title")} text={t("founders1Text")} />
        {arrow}
      </Link>
      <Link href="/store" className={card}>
        <ChoiceHead icon={<PackageCheck className="h-4 w-4" />} title={t("founders2Title")} text={t("founders2Text")} />
        {arrow}
      </Link>
      <a href={COMPANY_WHATSAPP.url} target="_blank" rel="noopener noreferrer" className={card}>
        <ChoiceHead icon={<MessageCircle className="h-4 w-4" />} title={t("founders3Title")} text={t("founders3Text")} />
        <span className="sr-only">{th("opensWhatsapp")}</span>
        {arrow}
      </a>
    </div>
  );
}
