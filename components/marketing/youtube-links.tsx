import { getTranslations } from "next-intl/server";
import { ExternalLink, Play, ShoppingBag } from "lucide-react";

import { IsolatedTitle } from "@/components/ltr-isolate";
import { Link } from "@/i18n/navigation";
import { getYoutube } from "@/lib/store/public-catalog";
import { hasYoutubeEntries, kitHref, videoTitle, videoUrl } from "@/lib/youtube";

// "Watch on YouTube" (P4-05 / WF-36). Server component on the ISR pages: reads
// the cached anon store_settings.youtube (tag "store-settings"), and renders
// NOTHING until the owner has added a channel or at least one video. LINKS ONLY:
// no embed, no YouTube script and no picture from YouTube — text and an inline
// icon, so the page weight and privacy stay as they are.
const link =
  "inline-flex items-center gap-1.5 text-sm font-medium text-cobalt hover:text-cobalt-hover max-md:min-h-11";

export async function YoutubeLinks({ locale }: { locale: string }) {
  const youtube = await getYoutube();
  if (!hasYoutubeEntries(youtube)) return null;
  const t = await getTranslations("Youtube");
  return (
    <section aria-labelledby="youtube-links" className="neu animate-fade-up min-w-0 space-y-5 p-5 sm:p-8">
      <div className="space-y-1">
        <span className="kicker block text-cobalt">{t("kicker")}</span>
        <h2 id="youtube-links" className="title-section">
          {t("heading")}
        </h2>
        <p className="max-w-2xl text-sm text-mutedtext">{t("intro")}</p>
      </div>

      {youtube.videos.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {youtube.videos.map((v) => {
            const title = videoTitle(v, locale);
            return (
              <li key={v.id} className="tile min-w-0 space-y-3">
                <p className="title-card break-words">
                  <IsolatedTitle text={title} locale={locale} />
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <a
                    href={videoUrl(v.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("watchAria", { title })}
                    className={link}
                  >
                    <Play className="h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden />
                    {t("watch")}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </a>
                  {v.kit_query && (
                    <Link href={kitHref(v.kit_query)} aria-label={t("partsAria", { title })} className={link}>
                      <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden />
                      {t("parts")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {youtube.channel_url && (
        <a
          href={youtube.channel_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("channelAria")}
          className={link}
        >
          {t("channel")}
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </a>
      )}
    </section>
  );
}
