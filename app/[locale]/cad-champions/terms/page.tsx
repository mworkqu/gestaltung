import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("terms", "/terms");

export default function CcTermsPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="terms" body />;
}
