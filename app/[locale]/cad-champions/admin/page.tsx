import { notFound } from "next/navigation";

import { AdminReviewLinks } from "@/components/cad-champions/review/admin-links";
import { PlaceholderPage, placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Staff only (instructor or admin): requireCcStaff redirects everyone else.
export const generateMetadata = placeholderMetadata("admin", "/admin");

export default async function CcAdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  await requireCcStaff(locale, ccPath(locale, "/admin"));
  return (
    <>
      <PlaceholderPage params={params} page="admin" signedIn />
      <AdminReviewLinks locale={locale} />
    </>
  );
}
