import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CcSignUpForm } from "@/components/cad-champions/auth/sign-up-form";
import { HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { ccNextOrNull, safeCcNext } from "@/lib/cad-champions/auth/paths";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.pages" });
  return ccPageMetadata({ locale, path: "/sign-up", title: t("signUp.title") });
}

// Sign up (Prompt 2 Step C). Signed out -> the full form; signed in WITHOUT a
// CC profile (e.g. a main-site account) -> the same form without email and
// password; signed in with a profile -> straight on to `next`.
export default async function CcSignUpPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const raw = (await searchParams).next;
  const next = ccNextOrNull(Array.isArray(raw) ? raw[0] : raw, locale);

  const cc = await getCcUser();
  if (cc?.profile) redirect(safeCcNext(next, locale));
  const mode = cc ? "complete" : "signUp";

  const t = await getTranslations({ locale, namespace: "CC.auth" });
  const turnstileEnabled = mode === "signUp" ? await turnstileEnabledForPages() : false;

  return (
    <div className="container max-w-2xl py-8 sm:py-12">
      <PageHeader
        title={mode === "signUp" ? t("signUp.title") : t("signUp.completeTitle")}
        purpose={mode === "signUp" ? t("signUp.purpose") : t("signUp.completePurpose")}
        help={<HelpTip label={t("signUp.title")}>{t("signUp.help")}</HelpTip>}
      />
      <div className="mt-8">
        <CcSignUpForm
          locale={locale}
          mode={mode}
          next={next}
          turnstileEnabled={turnstileEnabled}
          signedInEmail={cc?.user.email ?? null}
        />
      </div>
    </div>
  );
}
