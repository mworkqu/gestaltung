import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("training", "/training");

export default function CcTrainingPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="training" signedIn />;
}
