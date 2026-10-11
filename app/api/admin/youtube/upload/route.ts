import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { createClient } from "@/lib/supabase/server";
import {
  accessTokenFor,
  readYoutubeIntegration,
  recordQuota,
  saveYoutubeRow,
  TokenRevokedError,
  youtubeConfig,
} from "@/lib/integrations/youtube-server";
import { videoBase, videoEntry, type VideoSlug } from "@/lib/videos";
import { YOUTUBE_KEY } from "@/lib/youtube";
import {
  CHUNK_BYTES,
  contentRange,
  multipartRelated,
  nextOffsetFromRange,
  PRIVACY,
  quotaSummary,
  UPLOAD_COST,
  validateUploadMeta,
  withUploadedVideo,
  YT_CATEGORY_SCIENCE_TECH,
  YT_COST,
  type Privacy,
  type YoutubeMeta,
} from "@/lib/youtube-upload";

// D6: "Upload to YouTube" for one feature clip. super_admin only.
//
// 1. videos.insert, uploadType=resumable (1,600 units): the MP4 is STREAMED from
//    the public `videos` bucket and sent in 8 MiB chunks (Content-Range), so
//    memory stays at one chunk whatever the file size.
// 2. captions.insert (400 units each) with <slug>.en.vtt and <slug>.ar.vtt.
// 3. thumbnails.set (50 units) with <slug>.jpg (needs a verified channel).
// 4. Saves the video id into store_settings.youtube (the format the site reads)
//    when "Show on the website" is ticked, then revalidates the storefront.
// Steps 2–4 never undo the upload: a failure is reported as a warning.
//
// LIMIT: the whole request must finish within maxDuration (300 s here; Vercel
// Hobby with Fluid compute allows up to 300 s, Pro up to 800 s). The clips are
// 30–45 s and a few MB, so this takes seconds; a file near the bucket's 50 MB
// limit on a slow link could time out — then upload it from YouTube Studio
// (Download MP4 below) instead.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  tags?: unknown;
  privacy?: unknown;
  addToSite?: unknown;
};

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return json(403, { ok: false, error: "forbidden" });

  const body = (await request.json().catch(() => null)) as Body | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const entry = videoEntry(slug);
  if (!entry) return json(400, { ok: false, error: "bad_slug" });
  const checked = validateUploadMeta(body);
  if (!checked.ok) return json(422, { ok: false, error: "bad_meta", fields: checked.errors });
  const meta = checked.value;
  const addToSite = body?.addToSite !== false;

  const c = youtubeConfig();
  if (!c.ok) return json(503, { ok: false, error: "setup" });
  const read = await readYoutubeIntegration();
  if (read.state === "no_table") return json(503, { ok: false, error: "migration" });
  if (read.state !== "ok") return json(500, { ok: false, error: "db" });
  if (!read.row?.refresh_token_enc) return json(409, { ok: false, error: "not_connected" });
  const db = read.db;
  let state: YoutubeMeta = read.meta;

  if (quotaSummary(state.quota, new Date()).remaining < UPLOAD_COST) return json(429, { ok: false, error: "quota" });

  let token: string;
  try {
    token = await accessTokenFor(read.row, c.cfg);
  } catch (e) {
    if (e instanceof TokenRevokedError) {
      await saveYoutubeRow(db, state, { refresh_token_enc: null, connected_at: null });
      return json(409, { ok: false, error: "reconnect" });
    }
    console.error("[youtube] token refresh failed:", e instanceof Error ? e.message : "unknown");
    return json(502, { ok: false, error: "google" });
  }
  const auth = { Authorization: `Bearer ${token}` };

  const base = `${videoBase(process.env.NEXT_PUBLIC_SUPABASE_URL)}/${slug}/${slug}`;
  const file = await fetch(`${base}.mp4`, { cache: "no-store" }).catch(() => null);
  const total = Number(file?.headers.get("content-length") ?? 0);
  if (!file?.ok || !file.body || !total) return json(404, { ok: false, error: "file_missing" });

  // ── 1. resumable session + chunks ──
  let videoId = "";
  let actualPrivacy: Privacy = meta.privacy;
  try {
    const init = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          ...auth,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(total),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet: {
            title: meta.title,
            description: meta.description,
            tags: meta.tags,
            categoryId: YT_CATEGORY_SCIENCE_TECH,
            defaultLanguage: "en",
          },
          status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false, embeddable: true },
        }),
        cache: "no-store",
      },
    );
    state = await recordQuota(db, state, YT_COST.insert);
    const session = init.headers.get("location");
    if (!init.ok || !session) {
      const err = (await init.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
      const reason = err.error?.errors?.[0]?.reason ?? "";
      console.error("[youtube] resumable init failed:", init.status, reason);
      if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") return json(429, { ok: false, error: "quota" });
      return json(502, { ok: false, error: "google" });
    }

    const reader = file.body.getReader();
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let sent = 0;
    let done = false;
    while (!done || pendingBytes > 0) {
      while (!done && pendingBytes < CHUNK_BYTES) {
        const r = await reader.read();
        if (r.done) done = true;
        else {
          pending.push(r.value);
          pendingBytes += r.value.byteLength;
        }
      }
      const all = Buffer.concat(pending);
      const chunk = done ? all : all.subarray(0, CHUNK_BYTES);
      const rest = done ? Buffer.alloc(0) : all.subarray(CHUNK_BYTES);
      pending = rest.length ? [rest] : [];
      pendingBytes = rest.length;
      if (!chunk.length) break;
      if (sent + chunk.length > total) return json(502, { ok: false, error: "file_changed" });

      const put = await fetch(session, {
        method: "PUT",
        headers: { ...auth, "Content-Range": contentRange(sent, chunk.length, total) },
        body: chunk,
        cache: "no-store",
      });
      if (put.status === 308) {
        const next = nextOffsetFromRange(put.headers.get("range"));
        if (next !== sent + chunk.length) {
          console.error("[youtube] chunk not fully received", next, sent + chunk.length);
          return json(502, { ok: false, error: "upload_incomplete" });
        }
        sent = next;
        continue;
      }
      if (put.ok) {
        const v = (await put.json().catch(() => ({}))) as { id?: string; status?: { privacyStatus?: string } };
        videoId = v.id ?? "";
        // Unaudited API projects get "private" whatever was asked: keep what YouTube says.
        if ((PRIVACY as readonly string[]).includes(v.status?.privacyStatus ?? "")) {
          actualPrivacy = v.status?.privacyStatus as Privacy;
        }
        sent += chunk.length;
        break;
      }
      console.error("[youtube] chunk failed:", put.status);
      return json(502, { ok: false, error: "upload_failed" });
    }
    reader.cancel().catch(() => {});
  } catch (e) {
    console.error("[youtube] upload failed:", e instanceof Error ? e.message : "unknown");
    return json(502, { ok: false, error: "upload_failed" });
  }
  if (!videoId) return json(502, { ok: false, error: "upload_failed" });

  const warnings: string[] = [];

  // ── 2. captions ──
  for (const lang of ["en", "ar"] as const) {
    try {
      const vtt = await fetch(`${base}.${lang}.vtt`, { cache: "no-store" });
      if (!vtt.ok) {
        warnings.push(`captions_${lang}`);
        continue;
      }
      const data = new Uint8Array(await vtt.arrayBuffer());
      const boundary = `gestaltung${crypto.randomUUID().replace(/-/g, "")}`;
      const res = await fetch("https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart", {
        method: "POST",
        headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: new Uint8Array(
          multipartRelated(
            boundary,
            { snippet: { videoId, language: lang, name: lang === "en" ? "English" : "العربية", isDraft: false } },
            "text/vtt",
            data,
          ),
        ),
        cache: "no-store",
      });
      state = await recordQuota(db, state, YT_COST.caption);
      if (!res.ok) {
        console.error("[youtube] captions failed:", lang, res.status);
        warnings.push(`captions_${lang}`);
      }
    } catch {
      warnings.push(`captions_${lang}`);
    }
  }

  // ── 3. thumbnail ──
  try {
    const jpg = await fetch(`${base}.jpg`, { cache: "no-store" });
    if (!jpg.ok) warnings.push("thumbnail");
    else {
      const res = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
        { method: "POST", headers: { ...auth, "Content-Type": "image/jpeg" }, body: new Uint8Array(await jpg.arrayBuffer()), cache: "no-store" },
      );
      state = await recordQuota(db, state, YT_COST.thumbnail);
      if (!res.ok) {
        // 403 forbidden = the channel is not verified for custom thumbnails yet.
        console.error("[youtube] thumbnail failed:", res.status);
        warnings.push("thumbnail");
      }
    }
  } catch {
    warnings.push("thumbnail");
  }

  // ── 4. the site's YouTube links ──
  const previous = state.uploads[slug]?.video_id ?? null;
  if (addToSite) {
    try {
      const [tEn, tAr] = await Promise.all([
        getTranslations({ locale: "en", namespace: "Videos" }),
        getTranslations({ locale: "ar", namespace: "Videos" }),
      ]);
      const supabase = await createClient();
      const { data, error } = await supabase.from("store_settings").select("value").eq("key", YOUTUBE_KEY).maybeSingle();
      if (error) throw new Error(error.message);
      const merged = withUploadedVideo(
        data?.value,
        { id: videoId, title_en: tEn(entry.titleKey as `${VideoSlug}Title`), title_ar: tAr(entry.titleKey as `${VideoSlug}Title`) },
        previous,
      );
      if (!merged.ok) warnings.push(merged.reason === "full" ? "site_full" : "site");
      else {
        const { error: upErr } = await supabase
          .from("store_settings")
          .upsert({ key: YOUTUBE_KEY, value: merged.value, updated_at: new Date().toISOString() });
        if (upErr) throw new Error(upErr.message);
        revalidateStorefront();
      }
    } catch (e) {
      console.error("[youtube] site link save failed:", e instanceof Error ? e.message : "unknown");
      warnings.push("site");
    }
  }

  state = {
    ...state,
    uploads: {
      ...state.uploads,
      [slug]: { video_id: videoId, uploaded_at: new Date().toISOString(), privacy: actualPrivacy, warnings },
    },
  };
  const saveErr = await saveYoutubeRow(db, state);
  if (saveErr) console.error("[youtube] upload record save failed:", saveErr);

  revalidatePath("/en/dashboard/store/youtube");
  revalidatePath("/ar/dashboard/store/youtube");
  return json(200, { ok: true, videoId, warnings });
}
