import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("privacy", "/privacy");

export default function CcPrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="privacy" body />;
}
