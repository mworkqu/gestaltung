"use client";

// The signed-in user's balances and redeemable refunds, on /pricing#credits.

import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useCreditSummary } from "@/lib/credits/use-credits";

export function CreditsOverview() {
  const t = useTranslations("Credits");
  const locale = useLocale();
  const s = useCreditSummary();
  if (!s) return null;
  if (s.role === "anonymous")
    return (
      <div className="neu flex flex-wrap items-center gap-3 p-5">
        <p className="min-w-0 flex-1 text-sm text-body">{t("overviewSignIn")}</p>
        <Link href="/sign-in" className="rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white hover:bg-cobalt-hover">
          {t("signInCta")}
        </Link>
      </div>
    );
  if (s.role === "admin") return <div className="neu p-5 text-sm text-body">{t("overviewAdmin")}</div>;

  const tile = (label: string, value: string, note?: string) => (
    <div className="neu space-y-1 p-5">
      <p className="text-xs font-semibold text-mutedtext">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums text-heading">{value}</p>
      {note && <p className="text-[11.5px] text-mutedtext">{note}</p>}
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tile(t("kind_wiring"), String(s.wiring))}
      {tile(t("kind_cad"), String(s.cad))}
      {tile(
        t("overviewRedeemable"),
        `QAR ${s.redeemable_qar}`,
        s.next_expiry
          ? t("overviewExpiry", {
              date: new Date(s.next_expiry).toLocaleDateString(locale === "ar" ? "ar-QA" : "en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
            })
          : undefined
      )}
    </div>
  );
}
