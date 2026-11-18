import { PolicyPage, policyMetadata } from "@/components/cad-champions/shell/policy-page";

export const generateMetadata = policyMetadata("privacy");

export default function CcPrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PolicyPage params={params} id="privacy" />;
}
