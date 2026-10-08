"use client";

import { useLocale, useTranslations } from "next-intl";

import { FeatureVideo, type FeatureVideoProps } from "@/components/feature-video";
import { videoBase, videoEntry } from "@/lib/videos";

// For client components (the prototyping workspace, message scope "all"):
// same as FeatureVideoSection, with the copy read in the browser.
export function FeatureVideoClient({
  slug,
  size,
  posterOnly,
  href,
  ratio,
}: {
  slug: string;
  size?: FeatureVideoProps["size"];
  posterOnly?: boolean;
  href?: string;
  ratio?: FeatureVideoProps["ratio"];
}) {
  const t = useTranslations("Videos");
  const locale = useLocale();
  const entry = videoEntry(slug);
  if (!entry) return null;

  return (
    <FeatureVideo
      slug={slug}
      // NEXT_PUBLIC_ vars are inlined into the client bundle at build time.
      base={videoBase(process.env.NEXT_PUBLIC_SUPABASE_URL)}
      title={t(entry.titleKey)}
      caption={t(entry.captionKey)}
      playLabel={t("play")}
      pauseLabel={t("pause")}
      replayLabel={t("replay")}
      ratio={ratio}
      size={size}
      posterOnly={posterOnly}
      locale={locale === "ar" ? "ar" : "en"}
      href={href}
    />
  );
}
