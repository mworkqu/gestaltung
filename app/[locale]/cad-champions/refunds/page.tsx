import { PolicyPage, policyMetadata } from "@/components/cad-champions/shell/policy-page";

export const generateMetadata = policyMetadata("refunds");

export default function CcRefundsPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PolicyPage params={params} id="refunds" />;
}
