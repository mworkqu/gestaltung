import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
// /cad-champions/{locale}: CAD Champions home (placeholder until a later prompt).

export const generateMetadata = placeholderMetadata("home", "/");

export default function CcHomePage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="home" />;
}
