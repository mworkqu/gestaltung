import Link from "next/link";
import { Mail, MapPin, MessageCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";

// CAD Champions footer: who runs it, where, how to reach us, legal links and
// the trademark disclaimer (the only place "WorldSkills" may appear).
export async function CcFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.shell.footer" });
  const { whatsappNumber, supportEmail } = await getCcContact();
  const whatsappUrl = buildWhatsAppUrl(whatsappNumber, t("whatsappMessage"));

  const link =
    "inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-body underline-offset-4 hover:text-cobalt hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

  return (
    <footer aria-label={t("label")} className="mt-12 border-t border-white/60 bg-panel/60 pb-20">
      <div className="container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-heading">{t("byline")}</p>
          <p className="flex items-start gap-2 text-body">
            <MapPin aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-cobalt" />
            <span>
              {t("address")}
              <span className="block text-mutedtext">{t("addressTodo")}</span>
            </span>
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-heading">{t("contactHeading")}</h2>
          <ul className="mt-1">
            {whatsappUrl ? (
              <li>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={link}>
                  <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-cobalt" />
                  {t("whatsapp")}
                </a>
              </li>
            ) : null}
            <li>
              <a href={`mailto:${supportEmail}`} className={link}>
                <Mail aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-cobalt" />
                <span className="sr-only">{t("email")}: </span>
                <Ltr>{supportEmail}</Ltr>
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-heading">{t("legalHeading")}</h2>
          <ul className="mt-1">
            <li>
              <Link href={ccPath(locale, "/privacy")} className={link}>
                {t("privacy")}
              </Link>
            </li>
            <li>
              <Link href={ccPath(locale, "/terms")} className={link}>
                {t("terms")}
              </Link>
            </li>
            <li>
              <Link href={ccPath(locale, "/refunds")} className={link}>
                {t("refunds")}
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/60">
        <p className="container py-5 text-xs text-mutedtext">{t("disclaimer")}</p>
      </div>
    </footer>
  );
}
