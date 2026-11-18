import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/cad-champions/ui";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";

import { SignedInExtras } from "./signed-in-extras";

// Prompt 1 placeholder pages: a PageHeader (title + one purpose sentence from
// CC.pages.<key>) and nothing else. Later prompts replace each page's body.

export type CcPageKey =
  | "home"
  | "signIn"
  | "signUp"
  | "dashboard"
  | "getReady"
  | "test"
  | "results"
  | "training"
  | "help"
  | "admin"
  | "privacy"
  | "terms";

type Params = { params: Promise<{ locale: string }> };

/** generateMetadata for a placeholder page: its title + canonical/hreflang for `path`. */
export function placeholderMetadata(page: CcPageKey, path: string) {
  return async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { locale } = await params;
    if (!isCcLocale(locale)) return {};
    const t = await getTranslations({ locale, namespace: "CC.pages" });
    return ccPageMetadata({ locale, path, title: t(`${page}.title`), absolute: page === "home" });
  };
}

export async function PlaceholderPage({
  params,
  page,
  signedIn = false,
  body = false,
}: Params & {
  page: CcPageKey;
  /** Show the signed-in extras (Need help button). */
  signedIn?: boolean;
  /** Show CC.pages.<page>.body under the header (privacy / terms placeholders). */
  body?: boolean;
}) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CC.pages" });

  return (
    <div className="container py-8 sm:py-12">
      <PageHeader title={t(`${page}.title`)} purpose={t(`${page}.purpose`)} />
      {body ? <p className="mt-8 max-w-2xl text-base text-body">{t(`${page}.body`)}</p> : null}
      {signedIn ? <SignedInExtras pageName={t(`${page}.title`)} /> : null}
    </div>
  );
}
