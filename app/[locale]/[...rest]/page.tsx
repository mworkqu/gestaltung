import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

// F-033: the 404 used the generic home <title>. Metadata is written here rather
// than in not-found.tsx because the App Router does not let not-found.tsx export
// generateMetadata, and not through pageMeta() because there is no canonical URL
// for a page that does not exist - a canonical and hreflang pointing at /404
// would be worse than none.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("notFoundTitle"),
    description: t("notFoundDescription"),
    robots: { index: false, follow: false },
  };
}

// Catch-all for URLs that match no page under a locale (e.g. /en/nothing-here).
// Without it Next renders the root not-found with no locale, header or footer;
// calling notFound() from inside [locale] shows app/[locale]/not-found.tsx
// (branded, inside the site layout) with a real 404 status.
export default function CatchAll() {
  notFound();
}
