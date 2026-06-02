import { getTranslations, setRequestLocale } from "next-intl/server";
import { MapPin, Mail, Building2 } from "lucide-react";

import { ContactForm } from "@/components/contact-form";
import { cn } from "@/lib/utils";

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Contact");
  const isRtl = locale === "ar";

  return (
    <section className="container py-16 md:py-24">
      <span
        className={cn(
          "text-xs font-semibold text-azure",
          !isRtl && "uppercase tracking-[0.22em]"
        )}
      >
        {t("kicker")}
      </span>
      <h1 className="mt-4 text-[2rem] font-semibold leading-[1.1] text-heading sm:text-[2.375rem]">
        {t("heading")}
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-body">
        {t("intro")}
      </p>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <ContactForm />

        <div className="rounded-xl border border-borderstrong bg-panel p-6">
          <h2 className="text-sm font-semibold text-faint">
            {t("detailsTitle")}
          </h2>
          <ul className="mt-5 space-y-4 text-sm">
            <li className="flex items-center gap-3">
              <Building2 className="h-5 w-5 shrink-0 text-azure" strokeWidth={1.75} />
              <span className="text-body">{t("company")}</span>
            </li>
            <li className="flex items-center gap-3">
              <MapPin className="h-5 w-5 shrink-0 text-azure" strokeWidth={1.75} />
              <span className="text-body">{t("location")}</span>
            </li>
            <li className="flex items-center gap-3">
              <Mail className="h-5 w-5 shrink-0 text-azure" strokeWidth={1.75} />
              <a
                href={`mailto:${t("email")}`}
                className="text-body transition-colors hover:text-azure"
                dir="ltr"
              >
                {t("email")}
              </a>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
