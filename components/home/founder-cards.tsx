import { getTranslations } from "next-intl/server";
import { ArrowRight, MessageCircle, PackageCheck, Rocket } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { ChoiceHead } from "@/components/marketing/v2";
import { getContactPhone } from "@/lib/contact-phone-server";
import { cn } from "@/lib/utils";

// "Built for hardware founders" (W7): each outcome card is one link with a
// hover lift and a direction arrow (mirrored in RTL). Server component, no JS.
//   Weeks to a prototype → /projects/new · Parts stocked → /store · One contact → WhatsApp.

const cardBase =
  "group flex min-w-0 flex-col gap-4 text-start outline-none transition-[transform,border-color,box-shadow] duration-200 hover:border-cobalt/40 hover:shadow-neu-sm focus-visible:ring-2 focus-visible:ring-cobalt/60 motion-safe:hover:-translate-y-0.5";

/** Flat tiles inside the home page's .neu "Built for founders" section. */
export async function FounderCards({ locale }: { locale: string }) {
  const card = cn(cardBase, "tile");
  const t = await getTranslations("StoreLanding");
  const th = await getTranslations("HomeHero");
  const phone = await getContactPhone();
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
      <a href={phone.whatsappUrl} target="_blank" rel="noopener noreferrer" className={card}>
        <ChoiceHead icon={<MessageCircle className="h-4 w-4" />} title={t("founders3Title")} text={t("founders3Text")} />
        <span className="sr-only">{th("opensWhatsapp")}</span>
        {arrow}
      </a>
    </div>
  );
}
