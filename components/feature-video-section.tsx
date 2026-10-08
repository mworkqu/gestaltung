import { getTranslations } from "next-intl/server";

import { FeatureVideo, type FeatureVideoProps } from "@/components/feature-video";
import { videoBase, videoEntry } from "@/lib/videos";

// Server wrapper for public pages: reads the copy and the bucket URL, hands the
// client player plain strings (so no MessagesScope change is needed).
export async function FeatureVideoSection({
  slug,
  locale,
  size,
  posterOnly,
  href,
  ratio,
}: {
  slug: string;
  locale: string;
  size?: FeatureVideoProps["size"];
  posterOnly?: boolean;
  href?: string;
  ratio?: FeatureVideoProps["ratio"];
}) {
  const entry = videoEntry(slug);
  if (!entry) return null;
  const t = await getTranslations({ locale, namespace: "Videos" });

  return (
    <FeatureVideo
      slug={slug}
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
