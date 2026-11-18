import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CcSignInForm } from "@/components/cad-champions/auth/sign-in-form";
import { PageHeader } from "@/components/cad-champions/ui";
import { ccContinueHref, ccNextOrNull } from "@/lib/cad-champions/auth/paths";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[]; expired?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.pages" });
  return ccPageMetadata({ locale, path: "/sign-in", title: t("signIn.title") });
}

// Sign in (Prompt 2 Step C). Already signed in -> on to `next` via auth/continue.
// ?expired=1 comes from /api/auth/callback when an emailed link no longer works.
export default async function CcSignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const sp = await searchParams;
  const next = ccNextOrNull(Array.isArray(sp.next) ? sp.next[0] : sp.next, locale);

  if (await getCcUser()) redirect(ccContinueHref(locale, next));

  const t = await getTranslations({ locale, namespace: "CC.auth" });
  const turnstileEnabled = await turnstileEnabledForPages();

  return (
    <div className="container max-w-xl py-8 sm:py-12">
      <PageHeader title={t("signIn.title")} purpose={t("signIn.purpose")} />
      <div className="mt-8">
        <CcSignInForm locale={locale} next={next} turnstileEnabled={turnstileEnabled} expired={sp.expired === "1"} />
      </div>
    </div>
  );
}
