import { setRequestLocale } from "next-intl/server";

import { PartnerPage } from "@/components/partners/partner-page";
import { metaFor } from "@/lib/meta";
import { getServicePrices } from "@/lib/store/public-catalog";

export const generateMetadata = metaFor("partnersAccelerators");

// Partners: accelerators and incubators (P4-06). The sprint price is
// service_prices.sprint_from (cached, cookie-free read; default 20,000, owner
// to confirm). It is the only number on the page.
export default async function PartnersAcceleratorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const services = await getServicePrices();
  return <PartnerPage kind="accelerators" sprintFrom={services.sprint_from} />;
}
