import { getCcUser } from "@/lib/cad-champions/auth/server";
import { canSeeSolution, canUseExercise, canWatchLesson } from "@/lib/cad-champions/training/access";
import { getAccessContext, type Db } from "@/lib/cad-champions/training/server";
import { isSlotKey } from "@/lib/cad-champions/training/video-pick";
import { bunnyConfig, signBunnyEmbed } from "@/lib/cad-champions/videos/bunny";
import { loadContentOverrides } from "@/lib/cad-champions/content/overrides-server";
import { videoKey } from "@/lib/cad-champions/content/overrides";
import { resolveSlotRef } from "@/lib/cad-champions/videos/slot-override";
import { VIDEO_SLOTS, getPlaybackUrl, parseStoredVideo, type VideoRef } from "@/lib/cad-champions/videos/registry";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/cad-champions/video/<ref>  ->  { embedUrl, expires, provider }
//   ref = lesson:<lesson-slug>:<slot>   slot = inventor_en | fusion_ar | neutral_en ...
//         solution:<exercise-slug>      after a pass or 5 attempts
//         intro:<registry key>          Get Ready / intro videos (any signed-in user)
// Access is checked here, on the server, every time:
//   signed in, and (free preview | Orientation | enrolled | staff) for
//   lessons; exercise access + the solution rule for solutions.
// Bunny links are signed for 2 hours (lib/cad-champions/videos/bunny.ts); the
// token key never reaches the browser.
// 401 signed_out · 403 forbidden · 404 not_found · 409 no_video · 503 not_configured

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const SLUG = /^[a-z0-9-]{1,80}$/;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

type Resolved = { ok: true; ref: VideoRef } | { ok: false; status: number; error: string };

async function resolveLesson(service: Db, slug: string, slot: string, cc: NonNullable<Awaited<ReturnType<typeof getCcUser>>>): Promise<Resolved> {
  if (!SLUG.test(slug) || !isSlotKey(slot)) return { ok: false, status: 404, error: "not_found" };
  const { data } = await service
    .from("cc_lessons")
    .select(`id,is_free_preview,is_published,video_${slot},cc_levels!inner(cc_modules!inner(is_orientation))`)
    .eq("slug", slug)
    .maybeSingle<Record<string, unknown>>();
  if (!data || (!data.is_published && !cc.isStaff)) return { ok: false, status: 404, error: "not_found" };
  const level = one(data.cc_levels as { cc_modules: unknown } | { cc_modules: unknown }[] | null);
  const mod = one(level?.cc_modules as { is_orientation: boolean } | { is_orientation: boolean }[] | null);
  const access = await getAccessContext(cc);
  if (!canWatchLesson(access, { is_free_preview: data.is_free_preview === true, isOrientation: !!mod?.is_orientation })) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, ref: parseStoredVideo(data[`video_${slot}`] as string | null) };
}

async function resolveSolution(service: Db, slug: string, cc: NonNullable<Awaited<ReturnType<typeof getCcUser>>>): Promise<Resolved> {
  if (!SLUG.test(slug)) return { ok: false, status: 404, error: "not_found" };
  const { data: ex } = await service
    .from("cc_exercises")
    .select("id,is_published,is_free_sample,solution_video_id")
    .eq("slug", slug)
    .maybeSingle<{ id: string; is_published: boolean; is_free_sample: boolean; solution_video_id: string | null }>();
  if (!ex || (!ex.is_published && !cc.isStaff)) return { ok: false, status: 404, error: "not_found" };
  const access = await getAccessContext(cc);
  if (!canUseExercise(access, ex)) return { ok: false, status: 403, error: "forbidden" };
  const { data: rows } = await service.from("cc_exercise_attempts").select("passed,status").eq("user_id", cc.user.id).eq("exercise_id", ex.id).limit(1000);
  const attempts = ((rows ?? []) as { passed: boolean | null; status: string }[]).filter((r) => r.status !== "error");
  if (!canSeeSolution({ hasVideo: !!ex.solution_video_id, passed: attempts.some((r) => r.passed === true), attempts: attempts.length, staff: cc.isStaff })) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, ref: parseStoredVideo(ex.solution_video_id) };
}

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref: raw } = await params;
  const cc = await getCcUser();
  if (!cc) return json({ error: "signed_out" }, 401);

  let ref = "";
  try {
    ref = decodeURIComponent(raw ?? "");
  } catch {
    return json({ error: "not_found" }, 404);
  }
  const [kind, a = "", b = ""] = ref.split(":");

  let resolved: Resolved;
  if (kind === "intro") {
    const slot = VIDEO_SLOTS.find((v) => v.key === a);
    // Admin-edited id (cc_content_overrides, stored for both locales) wins over the registry.
    const ov = slot ? ((await loadContentOverrides("en")).get(videoKey(slot.key)) ?? (await loadContentOverrides("ar")).get(videoKey(slot.key)) ?? null) : null;
    resolved = slot ? { ok: true, ref: resolveSlotRef(slot, ov) } : { ok: false, status: 404, error: "not_found" };
  } else {
    const service = createServiceClient();
    if (!service) return json({ error: "not_configured" }, 503);
    try {
      if (kind === "lesson") resolved = await resolveLesson(service, a, b, cc);
      else if (kind === "solution") resolved = await resolveSolution(service, a, cc);
      else resolved = { ok: false, status: 404, error: "not_found" };
    } catch (e) {
      console.error("[cc-video] lookup failed:", e instanceof Error ? e.message : "unknown");
      return json({ error: "error" }, 500);
    }
  }
  if (!resolved.ok) return json({ error: resolved.error }, resolved.status);

  const videoRef = resolved.ref;
  if (videoRef.provider === "placeholder") return json({ error: "no_video" }, 409);
  if (videoRef.provider === "bunny") {
    if (!bunnyConfig()) return json({ error: "not_configured" }, 503);
    const signed = signBunnyEmbed(videoRef.providerId);
    if (!signed) return json({ error: "no_video" }, 409);
    return json({ embedUrl: signed.url, expires: signed.expires, provider: "bunny" });
  }
  const embedUrl = getPlaybackUrl(videoRef, { user: { id: cc.user.id }, signBunny: signBunnyEmbed });
  if (!embedUrl) return json({ error: "no_video" }, 409);
  return json({ embedUrl, expires: null, provider: videoRef.provider });
}
