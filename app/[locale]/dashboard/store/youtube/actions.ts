"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { validateYoutube, YOUTUBE_KEY, type YoutubeDraft, type YoutubeError } from "@/lib/youtube";

// YouTube links (P4-05): store_settings.youtube. super_admin only — checked here
// and again by RLS (store_settings_write). The draft is validated with the same
// rules the public read uses (lib/youtube.ts), so a saved list is always one the
// storefront shows in full. A pasted video link is stored as its 11-character id.
export type SaveYoutubeResult =
  | { ok: true; count: number }
  | { ok: false; errors: YoutubeError[]; message?: string };

export async function saveYoutube(locale: string, draft: YoutubeDraft): Promise<SaveYoutubeResult> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return { ok: false, errors: [], message: "forbidden" };

  const checked = validateYoutube(draft);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: YOUTUBE_KEY, value: checked.value, updated_at: new Date().toISOString() });
  if (error) return { ok: false, errors: [], message: error.message };

  revalidateStorefront();
  const safeLocale = locale === "ar" ? "ar" : "en";
  revalidatePath(`/${safeLocale}/dashboard/store/youtube`);
  return { ok: true, count: checked.value.videos.length };
}
