import { getTranslations, setRequestLocale } from "next-intl/server";

import { ContactInfoEditor } from "@/components/admin/contact-info-editor";
import { COMPANY_ADDRESS } from "@/lib/company";
import { getContactPhone } from "@/lib/contact-phone-server";

// Dashboard → Settings → Contact info: the one phone number (WhatsApp + calls)
// shown across the website and in emails. Email and address are listed for
// reference; they are still code constants (lib/company.ts).
export const dynamic = "force-dynamic";

export default async function ContactInfoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("ContactInfo");
  const phone = await getContactPhone();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-heading">{t("title")}</h1>
        <p className="mt-1 text-sm text-mutedtext">{t("intro")}</p>
      </div>
      <ContactInfoEditor locale={locale} phone={phone} />
      <div className="neu space-y-3 p-6">
        <h2 className="text-lg font-bold text-heading">{t("otherTitle")}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-mutedtext">{t("email")}</dt>
            <dd className="text-heading" dir="ltr">
              info@gestaltung360.com
            </dd>
          </div>
          <div>
            <dt className="text-xs text-mutedtext">{t("address")}</dt>
            <dd className="text-heading">{COMPANY_ADDRESS[locale === "ar" ? "ar" : "en"]}</dd>
          </div>
        </dl>
        <p className="text-xs text-mutedtext">{t("otherNote")}</p>
      </div>
    </div>
  );
}
