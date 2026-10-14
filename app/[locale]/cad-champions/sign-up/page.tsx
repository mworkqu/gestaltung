import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("signUp", "/sign-up");

export default function CcSignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="signUp" />;
}
