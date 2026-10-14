import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("test", "/test");

export default function CcTestPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="test" signedIn />;
}
