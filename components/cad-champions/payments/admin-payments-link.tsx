import Link from "next/link";
import { Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";

// Link card from the admin page to the payments queue (admins only; the
// admin page decides). Prompt 11 rebuilds the admin home with counts.
export async function AdminPaymentsLink({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.payments.adminHome" });
  return (
    <div className="container pb-12">
      <div className="neu flex flex-col gap-3 p-6">
        <Wallet aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 text-accent" />
        <h2 className="text-lg font-extrabold text-heading">{t("title")}</h2>
        <p className="text-sm text-body">{t("text")}</p>
        <Link
          href={ccPath(locale, "/admin/payments")}
          className="mt-auto inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {t("cta")}
        </Link>
      </div>
    </div>
  );
}
