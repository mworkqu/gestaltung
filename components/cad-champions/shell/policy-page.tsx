import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { Alert, Card, PageHeader } from "@/components/cad-champions/ui";
import { loadContentOverrides } from "@/lib/cad-champions/content/overrides-server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { arePoliciesApproved } from "@/lib/cad-champions/policies/approval";
import { loadPolicy, type PolicyId } from "@/lib/cad-champions/policies/content";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { getCcContact } from "@/lib/cad-champions/site-contact";

import { SignedInExtras } from "./signed-in-extras";

// Privacy / Terms / Refunds: the text is markdown in content/cad-champions/<id>.<locale>.md,
// rendered by the help-article renderer (no raw HTML). A DRAFT banner shows until an admin
// sets the override flag:policies.approved = "1" (lib/cad-champions/policies/approval.ts).
// A missing cc_content_overrides table reads as "not approved" (the banner stays).

type Params = { params: Promise<{ locale: string }> };

export function policyMetadata(id: PolicyId) {
  return async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { locale } = await params;
    if (!isCcLocale(locale)) return {};
    const t = await getTranslations({ locale, namespace: "CC.pages" });
    return ccPageMetadata({ locale, path: `/${id}`, title: t(`${id}.title`) });
  };
}

export async function PolicyPage({ params, id }: Params & { id: PolicyId }) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CC.pages" });
  const markdown = loadPolicy(id, locale, (await getCcContact()).supportEmail);
  const approved = arePoliciesApproved(await loadContentOverrides("en"));

  return (
    <div className="container max-w-3xl space-y-6 py-8 sm:py-12">
      <PageHeader title={t(`${id}.title`)} purpose={t(`${id}.purpose`)} />
      {approved ? null : (
        <Alert tone="warning" title={t("policies.draftTitle")}>
          {t("policies.draftBody")}
        </Alert>
      )}
      {markdown ? (
        <Card as="article" className="p-5 sm:p-8">
          <ArticleBody markdown={markdown} locale={locale} hasVideoId={false} />
        </Card>
      ) : (
        <Alert tone="error" title={t("policies.unavailable")} />
      )}
      <SignedInExtras pageName={t(`${id}.title`)} />
    </div>
  );
}
