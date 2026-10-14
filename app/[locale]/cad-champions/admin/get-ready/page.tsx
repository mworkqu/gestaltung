import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OverridesEditor } from "@/components/cad-champions/admin/overrides/overrides-editor";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { buildMessageGroups, buildVideoItems, type OverrideGroup } from "@/lib/cad-champions/admin/override-editor";
import { loadOverrideMaps, loadRawMessages } from "@/lib/cad-champions/admin/override-editor-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { getVideoSlot, type VideoKey } from "@/lib/cad-champions/videos/registry";

import { saveGetReadyOverridesAction } from "./actions";

// Admin: Get Ready content (Prompt 11 Step B). Every text of the 7 steps and
// the software tabs, plus the intro video ids. Overrides win over the message
// files; an empty field goes back to the file text.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.getReady" });
  return ccPageMetadata({ locale, path: "/admin/get-ready", title: t("title") });
}

export default async function CcAdminGetReadyPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/get-ready"));
  const t = await getTranslations({ locale, namespace: "CC.admin.getReady" });
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

  const [en, ar] = await Promise.all([loadRawMessages("en"), loadRawMessages("ar")]);
  const messageGroups = buildMessageGroups("get-ready", en["get-ready"], ar["get-ready"], maps, {
    titleFor: (top) => (t.has(`groups.${top}`) ? t(`groups.${top}`) : top),
  });

  const videoItems = buildVideoItems(maps, (slot) => {
    const reg = getVideoSlot(slot.key as VideoKey);
    const base = reg.provider === "placeholder" ? t("videos.defaultNone") : t("videos.defaultSet", { value: reg.provider === "youtube" ? `youtube:${reg.providerId}` : reg.providerId });
    return { label: locale === "ar" ? slot.title_ar : slot.title_en, hint: base };
  });
  const groups: OverrideGroup[] = [
    { id: "__videos", title: t("videos.title"), subtitle: t("videos.subtitle"), items: videoItems },
    ...messageGroups,
  ];

  return (
    <div className="space-y-6">
      {header}
      <OverridesEditor groups={groups} save={saveGetReadyOverridesAction} defaultOpenFirst />
    </div>
  );
}
