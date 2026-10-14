import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("help", "/help");

export default function CcHelpPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="help" signedIn />;
}
