import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OverridesEditor } from "@/components/cad-champions/admin/overrides/overrides-editor";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { type OverrideGroup } from "@/lib/cad-champions/admin/override-editor";
import { loadOverrideMaps } from "@/lib/cad-champions/admin/override-editor-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { glossaryKey } from "@/lib/cad-champions/content/overrides";
import { GLOSSARY, GLOSSARY_IDS } from "@/lib/cad-champions/glossary";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

import { saveGlossaryOverridesAction } from "./actions";

// Admin: glossary terms and definitions (Prompt 11 Step B). Term popovers
// everywhere read these overrides; empty = the text in lib/cad-champions/glossary.ts.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.glossary" });
  return ccPageMetadata({ locale, path: "/admin/glossary", title: t("title") });
}

export default async function CcAdminGlossaryPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/glossary"));
  const t = await getTranslations({ locale, namespace: "CC.admin.glossary" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });

  const maps = await loadOverrideMaps();
  const header = <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />;
  if (!maps.ok) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone={maps.reason === "not_set_up" ? "info" : "error"} title={maps.reason === "not_set_up" ? tc("notSetUp.title") : tc(`errors.${maps.reason}`)}>
          {maps.reason === "not_set_up" ? tc("notSetUp.body") : null}
        </Alert>
      </div>
    );
  }

  const groups: OverrideGroup[] = GLOSSARY_IDS.map((id) => {
    const e = GLOSSARY[id];
    const item = (field: "term" | "definition", label: string) => {
      const key = glossaryKey(id, field);
      return {
        key,
        label,
        kind: field === "term" ? ("text" as const) : ("textarea" as const),
        defaultEn: e.en[field],
        defaultAr: e.ar[field],
        en: maps.en.get(key) ?? "",
        ar: maps.ar.get(key) ?? "",
      };
    };
    return { id, title: e.en.term, subtitle: `${e.ar.term} · ${id}`, items: [item("term", t("fields.term")), item("definition", t("fields.definition"))] };
  });

  return (
    <div className="space-y-6">
      {header}
      <OverridesEditor groups={groups} save={saveGlossaryOverridesAction} />
    </div>
  );
}
