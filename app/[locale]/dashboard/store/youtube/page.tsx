import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { YoutubeEditor } from "@/components/admin/youtube-editor";
import { VideosYoutube, type ClipView, type ConnectionView } from "@/components/admin/videos-youtube";
import { readYoutubeIntegration, youtubeConfig } from "@/lib/integrations/youtube-server";
import { SITE_URL } from "@/lib/seo";
import { videoBase, VIDEOS, type VideoSlug } from "@/lib/videos";
import { toDraft, YOUTUBE_KEY } from "@/lib/youtube";
import { defaultUploadMeta, quotaSummary, UPLOAD_COST, YT_DAILY_QUOTA } from "@/lib/youtube-upload";
import { RETIRE_GRACE_HOURS } from "@/lib/youtube-retire";
import { requireSuperAdmin } from "@/lib/auth/guards";

// Videos & YouTube (D6, was "YouTube links" P4-05). super_admin only (the store
// layout redirects everyone else). Top: the six feature clips from the public
// `videos` bucket with Download MP4 + copy title/description (always works) and,
// once the channel is connected (Google OAuth, migration 0072), "Upload to
// YouTube". Bottom: the existing website links editor (store_settings.youtube).
export const dynamic = "force-dynamic";

/** File size of a clip via HEAD on the public bucket; null when missing / unreachable. */
async function headSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const n = Number(res.headers.get("content-length") ?? 0);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export default async function YoutubePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ yt?: string; reason?: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const sp = await searchParams;
  setRequestLocale(locale);
  const [t, tEn, tAr, tYtEn, tYtAr] = await Promise.all([
    getTranslations("VideosYoutube"),
    getTranslations({ locale: "en", namespace: "Videos" }),
    getTranslations({ locale: "ar", namespace: "Videos" }),
    getTranslations({ locale: "en", namespace: "VideosYoutube" }),
    getTranslations({ locale: "ar", namespace: "VideosYoutube" }),
  ]);
  const tLoc = locale === "ar" ? tAr : tEn;

  const supabase = await createClient();
  const [{ data }, read] = await Promise.all([
    supabase.from("store_settings").select("value").eq("key", YOUTUBE_KEY).maybeSingle(),
    readYoutubeIntegration(),
  ]);

  const cfg = youtubeConfig();
  const now = new Date();
  let connection: ConnectionView;
  if (read.state === "no_table") connection = { state: "migration" };
  else if (read.state === "no_service") connection = { state: "setup", missing: ["SUPABASE_SERVICE_ROLE_KEY"] };
  else if (read.state === "error") connection = { state: "error" };
  else if (!cfg.ok) connection = { state: "setup", missing: cfg.missing };
  else
    connection = {
      state: read.row?.refresh_token_enc ? "connected" : "disconnected",
      channel: read.meta.channel_title,
      quota: quotaSummary(read.meta.quota, now),
    };
  const meta = read.state === "ok" ? read.meta : null;

  const base = videoBase(process.env.NEXT_PUBLIC_SUPABASE_URL);
  // The YouTube description is bilingual whatever the dashboard language.
  const footer = `${tYtEn("descFooter")}\n${tYtAr("descFooter")}`;
  const clips: ClipView[] = await Promise.all(
    VIDEOS.map(async (v) => {
      const slug = v.slug as VideoSlug;
      const file = `${base}/${slug}/${slug}`;
      const en = { title: tEn(v.titleKey), description: tEn(v.descriptionKey) };
      const ar = { title: tAr(v.titleKey), description: tAr(v.descriptionKey) };
      return {
        slug,
        title: tLoc(v.titleKey),
        poster: `${file}.jpg?v=${v.uploadDate}`,
        download: `${file}.mp4?download=${slug}.mp4`,
        durationSeconds: v.durationSeconds,
        sizeBytes: await headSize(`${file}.mp4`),
        defaults: defaultUploadMeta({ slug, en, ar, siteUrl: SITE_URL, pages: v.pages, footer }),
        upload: meta?.uploads[slug] ?? null,
      };
    }),
  );

  const flash =
    sp.yt === "connected" ? "connected" : sp.yt === "error" ? `error_${(sp.reason ?? "google").replace(/[^a-z_]/g, "")}` : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-heading">{t("pageTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("pageIntro")}</p>
      </div>
      <VideosYoutube
        locale={locale}
        clips={clips}
        connection={connection}
        flash={flash}
        uploadCost={UPLOAD_COST}
        dailyQuota={YT_DAILY_QUOTA}
        retire={meta ? [...meta.retire].reverse() : null}
        graceHours={RETIRE_GRACE_HOURS}
      />
      <YoutubeEditor locale={locale} initial={toDraft(data?.value)} />
    </div>
  );
}
