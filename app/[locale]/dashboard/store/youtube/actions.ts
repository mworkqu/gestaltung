"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { validateYoutube, YOUTUBE_KEY, type YoutubeDraft, type YoutubeError } from "@/lib/youtube";
import { decryptSecret } from "@/lib/integrations/crypto";
import { readYoutubeIntegration, saveYoutubeRow, youtubeConfig } from "@/lib/integrations/youtube-server";
import { GOOGLE_REVOKE_URL } from "@/lib/youtube-upload";

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

// ── Videos & YouTube (D6): disconnect the channel ────────────────────────────
// super_admin only. Revokes the refresh token at Google (best effort) and
// clears it from public.integrations (service client; 0072). The quota counter
// and the upload history stay, so a reconnect shows the same state.
export type DisconnectResult = { ok: true } | { ok: false; error: "forbidden" | "migration" | "db" };

export async function disconnectYoutube(locale: string): Promise<DisconnectResult> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return { ok: false, error: "forbidden" };

  const read = await readYoutubeIntegration();
  if (read.state === "no_table") return { ok: false, error: "migration" };
  if (read.state !== "ok") return { ok: false, error: "db" };
  if (!read.row) return { ok: true };

  const c = youtubeConfig();
  const token = c.ok ? decryptSecret(read.row.refresh_token_enc, c.cfg.key) : null;
  if (token) {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  }
  const err = await saveYoutubeRow(read.db, read.meta, { refresh_token_enc: null, scopes: null, connected_at: null });
  if (err) return { ok: false, error: "db" };

  revalidatePath(`/${locale === "ar" ? "ar" : "en"}/dashboard/store/youtube`);
  return { ok: true };
}
