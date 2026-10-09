import { getLocale, getTranslations } from "next-intl/server";
import { Banknote, Landmark, Mail, MapPin, MessageCircle, Zap, type LucideIcon } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { COMPANY, COMPANY_ADDRESS, COMPANY_WHATSAPP } from "@/lib/company";
import type { PaymentMethod } from "@/lib/company";
import { LEGAL_KEYS, LEGAL_SLUGS } from "@/lib/legal/content";

const EMAIL = "info@gestaltung360.com";

// Payment chips: plain icon + label, no card logos (cards are not accepted).
const PAY_ICONS: Record<PaymentMethod, LucideIcon> = {
  cash_on_delivery: Banknote,
  fawran: Zap,
  bank_transfer: Landmark,
};

export async function Footer() {
  const locale = await getLocale();
  const t = await getTranslations("Footer");
  const tNav = await getTranslations("Nav");
  const tLegal = await getTranslations("Legal");
  const tPay = await getTranslations("PayMethods");

  const infoLinks = [
    { href: "/how-it-works", label: tNav("howItWorks") },
    { href: "/about", label: tNav("about") },
    { href: "/students", label: t("students") },
    { href: "/institutions", label: t("institutions") },
    { href: "/partners/schools", label: t("partners") },
    { href: "/trust", label: t("trust") },
    { href: "/pricing", label: t("pricing") },
    { href: "/contact", label: tNav("contact") },
  ];
  const policyLinks = LEGAL_SLUGS.map((slug) => ({
    href: `/${slug}`,
    label: tLegal(`${LEGAL_KEYS[slug]}Footer`),
  }));
  const methods: PaymentMethod[] = ["cash_on_delivery", "fawran", "bank_transfer"];

  // 44 px minimum tap target on every link.
  const linkCls =
    "inline-flex min-h-11 items-center text-sm text-mutedtext transition-colors hover:text-heading";
  const heading = "text-[11px] font-semibold uppercase tracking-wider text-heading rtl:normal-case rtl:tracking-normal";

  return (
    <footer className="container pb-8 pt-4">
      <div className="neu flex flex-col gap-6 px-6 py-6">
        {/* P1-09: why the studio exists, two sentences, above the link columns. */}
        <p className="max-w-2xl border-b border-borderstrong/40 pb-5 text-sm leading-relaxed text-mutedtext">
          {t("why")}
        </p>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <h2 className={heading}>{t("contactTitle")}</h2>
            <a
              href={COMPANY_WHATSAPP.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkCls} gap-2`}
            >
              <MessageCircle className="h-4 w-4 shrink-0 text-cobalt" aria-hidden />
              <span dir="ltr">{COMPANY_WHATSAPP.display}</span>
            </a>
            <a href={`mailto:${EMAIL}`} className={`${linkCls} gap-2`}>
              <Mail className="h-4 w-4 shrink-0 text-cobalt" aria-hidden />
              <span dir="ltr">{EMAIL}</span>
            </a>
            <p className="flex items-start gap-2 py-2 text-sm text-mutedtext">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cobalt" aria-hidden />
              {COMPANY_ADDRESS[locale === "ar" ? "ar" : "en"]}
            </p>
          </div>

          <nav aria-label={t("infoTitle")} className="space-y-1">
            <h2 className={heading}>{t("infoTitle")}</h2>
            <ul>
              {infoLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={linkCls}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t("policiesTitle")} className="space-y-1">
            <h2 className={heading}>{t("policiesTitle")}</h2>
            <ul>
              {policyLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={linkCls}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-3">
            <h2 className={heading}>{t("payTitle")}</h2>
            <ul className="flex flex-wrap gap-2">
              {methods.map((m) => {
                const Icon = PAY_ICONS[m];
                return (
                  <li
                    key={m}
                    className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-medium text-heading shadow-neu-sm"
                  >
                    <Icon className="h-3.5 w-3.5 text-cobalt" strokeWidth={1.75} aria-hidden />
                    {tPay(`${m}_title`)}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <p className="border-t border-borderstrong/40 pt-4 text-center text-xs text-mutedtext sm:text-start">
          {t("crLine", { number: COMPANY.crNumber })}
        </p>
      </div>
    </footer>
  );
}
