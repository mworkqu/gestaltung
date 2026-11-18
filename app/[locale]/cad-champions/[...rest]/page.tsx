import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { isCcLocale } from "@/lib/cad-champions/routes";

// Unknown CC URLs (/cad-champions/ar/nothing-here): notFound() renders the CC
// 404 (app/[locale]/cad-champions/not-found.tsx, inside the CC shell) with a
// real 404 status instead of falling through to the site's catch-all.
export default async function CcCatchAll({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (isCcLocale(locale)) setRequestLocale(locale);
  notFound();
}
