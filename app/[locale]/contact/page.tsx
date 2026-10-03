import { getTranslations, setRequestLocale } from "next-intl/server";
import { MapPin, Mail, Building2, MessageCircle, Phone, BadgeCheck } from "lucide-react";

import { ContactForm } from "@/components/contact-form";
import { COMPANY, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";

export const generateMetadata = metaFor("contact");

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Contact");
  const tCompany = await getTranslations("Company");
  const isRtl = locale === "ar";

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const address = COMPANY_ADDRESS[isRtl ? "ar" : "en"];

  // One row of the contact list. `href` makes the value a link; numbers and
  // emails stay left-to-right inside Arabic text. min-h-11 = 44 px tap target.
  const rowCls = "flex items-center gap-3 rounded-2xl bg-panel p-4 shadow-neu-sm";
  const iconCls =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface shadow-neu-sm";
  const linkCls = "inline-flex min-h-11 items-center text-sm text-body transition-colors hover:text-cobalt";


  return (
    <div className="container space-y-6 py-6">
      {/* Header */}
      <section className="animate-fade-up flex flex-col gap-5 px-1">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
        </span>
        <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">
          {t("intro")}
        </p>
      </section>

      {/* Form + details bento */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form card */}
        <div className="neu animate-fade-up delay-1 flex flex-col gap-6 p-8 sm:p-10 lg:col-span-7">
          <div className={mono("flex items-center justify-between text-[10px] text-faint")}>
            <span className="flex items-center gap-1.5 font-semibold text-mutedtext">
              <span className="h-1.5 w-1.5 rounded-full bg-cobalt" />
              {t("formTag")}
            </span>
          </div>
          <ContactForm />
        </div>

        {/* Details card */}
        <div className="neu animate-fade-up delay-2 flex min-w-0 flex-col gap-6 p-6 sm:p-8 lg:col-span-5">
          <h2 className={mono("text-[10px] text-cobalt")}>{t("reachTitle")}</h2>

          <ul className="space-y-3">
            <li className={rowCls}>
              <span className={iconCls}>
                <MessageCircle className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[11px] text-mutedtext">{t("whatsappLine")}</span>
                <a
                  href={COMPANY_WHATSAPP.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className={cn(linkCls, "justify-start")}
                >
                  {COMPANY_WHATSAPP.display}
                </a>
              </span>
            </li>
            <li className={rowCls}>
              <span className={iconCls}>
                <Phone className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[11px] text-mutedtext">{t("phoneLabel")}</span>
                <a href={COMPANY_PHONE.tel} dir="ltr" className={cn(linkCls, "justify-start")}>
                  {COMPANY_PHONE.display}
                </a>
              </span>
            </li>
            <li className={rowCls}>
              <span className={iconCls}>
                <MapPin className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[11px] text-mutedtext">{t("addressLabel")}</span>
                <span className="text-sm text-body">{address}</span>
              </span>
            </li>
            <li className={rowCls}>
              <span className={iconCls}>
                <Mail className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
              </span>
              <a href={`mailto:${t("email")}`} dir="ltr" className={cn(linkCls, "min-w-0 break-all")}>
                {t("email")}
              </a>
            </li>
          </ul>

          {/* Company details: legal name + Commercial Registration */}
          <div className="space-y-3">
            <h2 className={mono("text-[10px] text-cobalt")}>{t("detailsTitle")}</h2>
            <ul className="space-y-3">
              <li className={rowCls}>
                <span className={iconCls}>
                  <Building2 className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
                </span>
                <span className="text-sm font-semibold text-heading">{tCompany("legalName")}</span>
              </li>
              <li className={rowCls}>
                <span className={iconCls}>
                  <BadgeCheck className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
                </span>
                <span className="text-sm text-body">{t("crLine", { number: COMPANY.crNumber })}</span>
              </li>
            </ul>
          </div>

          {/* Response telemetry note */}
          <div className="neu-inset mt-auto flex items-center gap-2.5 px-4 py-3">
            <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
            <span
              className={cn(
                "text-[11px] leading-snug text-mutedtext",
                isRtl ? "font-sans" : "font-mono"
              )}
            >
              {t("responseNote")}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
