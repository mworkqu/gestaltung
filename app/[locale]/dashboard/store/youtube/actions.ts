"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { extractVideoId, validateYoutube, YOUTUBE_KEY, type YoutubeDraft, type YoutubeError } from "@/lib/youtube";
import { decryptSecret } from "@/lib/integrations/crypto";
import { runRetirements, type RetireSummary } from "@/lib/integrations/youtube-retire";
import { readYoutubeIntegration, saveYoutubeRow, updateYoutubeMeta, youtubeConfig } from "@/lib/integrations/youtube-server";
import { cancelRetire, queueRetire, type QueueOutcome } from "@/lib/youtube-retire";
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

// ── Videos & YouTube: the retire log (lib/youtube-retire.ts) ─────────────────
// super_admin only. Add a video by link / id (deleted from YouTube and the site
// RETIRE_GRACE_HOURS later by the daily cron), cancel one, or delete one now.
// Writes go through updateYoutubeMeta (latest metadata, never a stale copy).
export type RetireActionResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "migration" | "db" | Exclude<QueueOutcome, "queued"> };

const revalidateYoutubePages = () => {
  revalidatePath("/en/dashboard/store/youtube");
  revalidatePath("/ar/dashboard/store/youtube");
};

export async function queueRetireAction(input: { link: string; title?: string }): Promise<RetireActionResult> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return { ok: false, error: "forbidden" };

  const id = extractVideoId(input?.link);
  if (!id) return { ok: false, error: "bad_id" };
  const read = await readYoutubeIntegration();
  if (read.state === "no_table") return { ok: false, error: "migration" };
  if (read.state !== "ok") return { ok: false, error: "db" };

  let outcome = "queued" as QueueOutcome;
  await updateYoutubeMeta(read.db, read.meta, (m) => {
    const r = queueRetire(m, { video_id: id, title: typeof input.title === "string" ? input.title : "", reason: "manual" }, new Date());
    outcome = r.outcome;
    return r.meta;
  });
  if (outcome !== "queued") return { ok: false, error: outcome };
  revalidateYoutubePages();
  return { ok: true };
}

export async function cancelRetireAction(videoId: string): Promise<RetireActionResult> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return { ok: false, error: "forbidden" };

  const read = await readYoutubeIntegration();
  if (read.state === "no_table") return { ok: false, error: "migration" };
  if (read.state !== "ok") return { ok: false, error: "db" };
  await updateYoutubeMeta(read.db, read.meta, (m) => cancelRetire(m, String(videoId)));
  revalidateYoutubePages();
  return { ok: true };
}

export type DeleteNowResult = { ok: true; summary: RetireSummary } | { ok: false; error: "forbidden" };

export async function deleteRetireNowAction(videoId: string): Promise<DeleteNowResult> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return { ok: false, error: "forbidden" };

  const summary = await runRetirements({ onlyIds: [String(videoId)] });
  revalidateYoutubePages();
  return { ok: true, summary };
}
