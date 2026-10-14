import Link from "next/link";
import { BookOpen, Mail, MessageCircle } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@/components/cad-champions/ui";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";

// CC 404: unknown CC URLs (via [...rest]) and notFound() inside CAD Champions.
// Rendered inside the CC layout (CC header/footer, CC messages).
export default async function CcNotFound() {
  const raw = await getLocale();
  const locale = isCcLocale(raw) ? raw : "en";
  const t = await getTranslations({ locale, namespace: "CC.errors" });
  const tShell = await getTranslations({ locale, namespace: "CC.shell.footer" });
  const { whatsappNumber, supportEmail } = getCcContact();
  const whatsappUrl = buildWhatsAppUrl(whatsappNumber, tShell("whatsappMessage"));

  const helpLink =
    "inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-heading underline-offset-4 hover:text-cobalt hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

  return (
    <div className="container py-10 sm:py-16">
      <section className="neu mx-auto flex max-w-2xl flex-col gap-5 p-8 text-center sm:p-12">
        <p className="text-sm font-semibold text-mutedtext">{t("notFound.kicker")}</p>
        <h1 className="text-3xl font-extrabold leading-tight text-heading sm:text-4xl">{t("notFound.title")}</h1>
        <p className="text-base text-body">{t("notFound.body")}</p>
        <div className="flex justify-center">
          <Button asChild>
            <Link href={ccPath(locale, "/dashboard")}>{t("actions.goToDashboard")}</Link>
          </Button>
        </div>
        <div className="tile text-start">
          <h2 className="text-base font-bold text-heading">{t("actions.needHelp")}</h2>
          <ul className="mt-2 flex flex-wrap gap-x-6">
            {whatsappUrl ? (
              <li>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={helpLink}>
                  <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-cobalt" />
                  {t("actions.whatsapp")}
                </a>
              </li>
            ) : null}
            <li>
              <a href={`mailto:${supportEmail}`} className={helpLink}>
                <Mail aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-cobalt" />
                {t("actions.email")}
              </a>
            </li>
            <li>
              <Link href={ccPath(locale, "/help")} className={helpLink}>
                <BookOpen aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-cobalt" />
                {t("actions.helpCenter")}
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
