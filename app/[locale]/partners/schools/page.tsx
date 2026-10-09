import { setRequestLocale } from "next-intl/server";

import { PartnerPage } from "@/components/partners/partner-page";
import { metaFor } from "@/lib/meta";

export const generateMetadata = metaFor("partnersSchools");

// Partners: schools and science-content teams (P4-06). Static, no prices.
export default async function PartnersSchoolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PartnerPage kind="schools" />;
}
