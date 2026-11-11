import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CohortsManager } from "@/components/cad-champions/admin/plans/cohorts-manager";
import { CouponsManager } from "@/components/cad-champions/admin/plans/coupons-manager";
import { PlansManager } from "@/components/cad-champions/admin/plans/plans-manager";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { loadPlansData } from "@/lib/cad-champions/admin/plans-admin-server";
import { adminDb } from "@/lib/cad-champions/admin/server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Plans, prices, coupons and cohorts (Prompt 11 Step B). Admin only. Price
// changes are audited (plan.price_change, before/after). A null price shows
// "Price coming soon" and blocks checkout.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.plans" });
  return ccPageMetadata({ locale, path: "/admin/plans", title: t("title") });
}

export default async function CcAdminPlansPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/plans"));
  const t = await getTranslations({ locale, namespace: "CC.admin.plans" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });

  const db = adminDb();
  const loaded = db ? await loadPlansData(db) : null;

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("title")}>{t("help")}</HelpTip>} />
      {!db ? (
        <Alert tone="error" title={tc("errors.unavailable")} />
      ) : !loaded || !loaded.ok ? (
        loaded && loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc("errors.error")} />
        )
      ) : (
        <>
          <PlansManager plans={loaded.data.plans} />
          <CouponsManager coupons={loaded.data.coupons} plans={loaded.data.plans.map((p) => ({ id: p.id, name_en: p.name_en, name_ar: p.name_ar, kind: p.kind }))} />
          <CohortsManager cohorts={loaded.data.cohorts} seats={loaded.data.seats} />
        </>
      )}
    </div>
  );
}
