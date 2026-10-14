import { Mail, MessageCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { Ltr } from "@/lib/cad-champions/ltr";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";

const link =
  "tile flex min-h-[44px] items-center gap-3 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

/** "Still need help?" block: WhatsApp (when configured) + email. Server component. */
export async function StillNeedHelp({
  locale,
  topic,
  title,
  body,
}: {
  locale: Locale;
  topic: string;
  title?: string;
  body?: string;
}) {
  const t = await getTranslations({ locale, namespace: "CC.help" });
  const { whatsappNumber, supportEmail } = getCcContact();
  const whatsapp = buildWhatsAppUrl(whatsappNumber, t("whatsappMessage", { topic }));
  const mail = `mailto:${supportEmail}?subject=${encodeURIComponent(t("emailSubject", { topic }))}`;
  return (
    <Card as="section">
      <h2 className="text-xl font-extrabold text-heading">{title ?? t("stillNeedTitle")}</h2>
      <p className="mt-1 text-base text-body">{body ?? t("stillNeedBody")}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={link}>
            <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
            <span className="text-sm font-bold text-ink">{t("whatsappCta")}</span>
          </a>
        ) : null}
        <a href={mail} className={link}>
          <Mail aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-ink">{t("emailCta")}</span>
            <span className="block break-all text-sm text-body">
              <Ltr>{supportEmail}</Ltr>
            </span>
          </span>
        </a>
      </div>
    </Card>
  );
}
