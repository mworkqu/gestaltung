import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";

export const generateMetadata = placeholderMetadata("dashboard", "/dashboard");

export default function CcDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  return <PlaceholderPage params={params} page="dashboard" signedIn />;
}
