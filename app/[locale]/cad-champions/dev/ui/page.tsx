import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { UiGallery } from "./gallery";

// Developer-only page: hidden in production unless CC_DEV_GALLERY=1.
export default async function UiGalleryPage({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.CC_DEV_GALLERY !== "1") notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return <UiGallery />;
}
