import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("getReady", "/get-ready");

export default function CcGetReadyPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="getReady" signedIn />;
}
