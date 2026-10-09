import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { YoutubeEditor } from "@/components/admin/youtube-editor";
import { toDraft, YOUTUBE_KEY } from "@/lib/youtube";

// YouTube links (P4-05 / WF-36): the editor. super_admin only (the store layout
// redirects everyone else). Reads store_settings.youtube as the signed-in admin;
// the editor saves through saveYoutube().
export const dynamic = "force-dynamic";

export default async function YoutubePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Youtube");

  const supabase = await createClient();
  const { data } = await supabase.from("store_settings").select("value").eq("key", YOUTUBE_KEY).maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-heading">{t("adminPageTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("adminPageIntro")}</p>
      </div>
      <YoutubeEditor locale={locale} initial={toDraft(data?.value)} />
    </div>
  );
}
