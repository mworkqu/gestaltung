import { PolicyPage, policyMetadata } from "@/components/cad-champions/shell/policy-page";

export const generateMetadata = policyMetadata("terms");

export default function CcTermsPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PolicyPage params={params} id="terms" />;
}
