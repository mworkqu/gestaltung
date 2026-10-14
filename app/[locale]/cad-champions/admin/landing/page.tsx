import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { TestimonialsManager } from "@/components/cad-champions/admin/landing/testimonials-manager";
import { OverridesEditor } from "@/components/cad-champions/admin/overrides/overrides-editor";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { leafAt, type OverrideGroup } from "@/lib/cad-champions/admin/override-editor";
import { loadOverrideMaps, loadRawMessages } from "@/lib/cad-champions/admin/override-editor-server";
import { listTestimonials } from "@/lib/cad-champions/admin/testimonials-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { faqHiddenKey, msgKey } from "@/lib/cad-champions/content/overrides";
import { CC_FAQ } from "@/lib/cad-champions/landing/faq";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

import { saveLandingOverridesAction } from "./actions";

// Admin: landing page content (Prompt 11 Step B). FAQ questions / answers
// (+ hide an item) and the testimonials. The testimonials section on the
// landing page is shown only while at least one is published.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.landing" });
  return ccPageMetadata({ locale, path: "/admin/landing", title: t("title") });
}

export default async function CcAdminLandingPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/landing"));
  const t = await getTranslations({ locale, namespace: "CC.admin.landing" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });

  const [maps, testimonials] = await Promise.all([loadOverrideMaps(), listTestimonials()]);
  const header = <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />;

  const [en, ar] = await Promise.all([loadRawMessages("en"), loadRawMessages("ar")]);
  const landingEn = en.landing;
  const landingAr = ar.landing;

  let faq: ReactNode;
  if (!maps.ok) {
    faq = (
      <Alert tone={maps.reason === "not_set_up" ? "info" : "error"} title={maps.reason === "not_set_up" ? tc("notSetUp.title") : tc(`errors.${maps.reason}`)}>
        {maps.reason === "not_set_up" ? tc("notSetUp.body") : null}
      </Alert>
    );
  } else {
    const groups: OverrideGroup[] = CC_FAQ.map((item) => {
      const q = (l: typeof landingEn) => leafAt(l, item.questionKey) ?? "";
      const a = (l: typeof landingEn) => leafAt(l, item.answerKey) ?? "";
      const qKey = msgKey(`landing.${item.questionKey}`);
      const aKey = msgKey(`landing.${item.answerKey}`);
      const hKey = faqHiddenKey(item.id);
      return {
        id: item.id,
        title: q(landingEn),
        subtitle: item.id,
        items: [
          { key: qKey, label: t("fields.question"), kind: "text", defaultEn: q(landingEn), defaultAr: q(landingAr), en: maps.en.get(qKey) ?? "", ar: maps.ar.get(qKey) ?? "" },
          { key: aKey, label: t("fields.answer"), kind: "textarea", defaultEn: a(landingEn), defaultAr: a(landingAr), en: maps.en.get(aKey) ?? "", ar: maps.ar.get(aKey) ?? "" },
          { key: hKey, label: t("fields.hide"), hint: t("fields.hideHint"), kind: "flag", defaultEn: "", defaultAr: "", en: maps.en.get(hKey) ?? "", ar: maps.ar.get(hKey) ?? "" },
        ],
      };
    });
    faq = <OverridesEditor groups={groups} save={saveLandingOverridesAction} />;
  }

  return (
    <div className="space-y-8">
      {header}
      <section aria-labelledby="landing-faq" className="space-y-3">
        <h2 id="landing-faq" className="text-xl font-bold text-heading">
          {t("faqTitle")}
        </h2>
        <p className="max-w-2xl text-sm text-body">{t("faqIntro")}</p>
        {faq}
      </section>
      <section aria-labelledby="landing-testimonials" className="space-y-3">
        <h2 id="landing-testimonials" className="text-xl font-bold text-heading">
          {t("testimonialsTitle")}
        </h2>
        <p className="max-w-2xl text-sm text-body">{t("testimonialsIntro")}</p>
        {testimonials.ok ? (
          <TestimonialsManager initial={testimonials.rows} />
        ) : (
          <Alert tone={testimonials.reason === "not_set_up" ? "info" : "error"} title={testimonials.reason === "not_set_up" ? tc("notSetUp.title") : tc(`errors.${testimonials.reason}`)}>
            {testimonials.reason === "not_set_up" ? tc("notSetUp.body") : null}
          </Alert>
        )}
      </section>
    </div>
  );
}
