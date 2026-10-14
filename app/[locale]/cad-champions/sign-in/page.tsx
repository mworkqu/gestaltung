import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("signIn", "/sign-in");

export default function CcSignInPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="signIn" />;
}
