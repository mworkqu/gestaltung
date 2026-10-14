import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("results", "/results");

export default function CcResultsPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="results" signedIn />;
}
