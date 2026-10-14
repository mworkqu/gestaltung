import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
// Admin placeholder. TODO(Prompt 2+): staff-only gate.

export const generateMetadata = placeholderMetadata("admin", "/admin");

export default function CcAdminPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="admin" signedIn />;
}
