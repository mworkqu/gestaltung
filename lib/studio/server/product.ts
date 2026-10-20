// Server plumbing for app/api/studio/product/* (P5-16 Phase 2a). Server-only.
//
//  * request bodies (zod) and a no-store JSON helper;
//  * the picked parts as layout inputs, the spec hash, design ids;
//  * the guest limit: 3 design builds per Qatar day per guest session AND per
//    hashed IP (same salt/hash as bom_rate_check), counted in the existing
//    ai_rate_limits table (0042) through the service client — no migration;
//  * preview pictures: the EXISTING private bucket `project-images` under
//    studio-previews/<projectId>/<designId>.png. Uploads go through the service
//    client after the route's owner check (the bucket's insert policy wants the
//    user id as first folder); reads are signed with the VIEWER's own session —
//    0045's owns_storage_project() lets the project owner (folder 2 = project id)
//    and the super_admin read them, nobody else.

import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ipHash } from "@/lib/credits/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stableHash } from "../cache";
import type { LayoutInput } from "../layout";
import type { LibraryPart, ProductSpec, StudioComponent } from "../schema";
import { ARCHETYPES } from "../product/schema";

export const PREVIEW_BUCKET = "project-images";
export const PREVIEW_PREFIX = "studio-previews";
export const GUEST_DESIGNS_PER_DAY = 3;
/** 512 px renders are ~100–400 kB; the final 3/4 view is at most 1024 px. */
export const CHECK_IMAGE_MAX_BYTES = 1_500_000;
export const PREVIEW_MAX_BYTES = 3_000_000;

const ProjectId = z.string().uuid();
const DesignId = z.string().regex(/^d_[a-z0-9]{6,16}$/);
const Archetype = z.enum(ARCHETYPES);
/** base64 (optionally a data: URL); the size is checked again after decoding. */
const B64 = (maxBytes: number) => z.string().min(16).max(Math.ceil((maxBytes * 4) / 3) + 64);

/** Longest "what is wrong with these?" text. */
export const FEEDBACK_MAX = 400;

export const DesignBody = z.object({
  projectId: ProjectId,
  count: z.number().int().min(1).max(3).optional().default(3),
  exclude: z.array(z.string().max(32)).max(12).optional().default([]),
  /** What is wrong with the designs shown: steers a NEW set of three (never edits the old ones). */
  feedback: z
    .string()
    .max(FEEDBACK_MAX * 5)
    .transform((s) => s.trim().slice(0, FEEDBACK_MAX).trim())
    .optional(),
});
export const CheckBody = z.object({
  projectId: ProjectId,
  designId: DesignId,
  images: z.object({ front: B64(CHECK_IMAGE_MAX_BYTES), side: B64(CHECK_IMAGE_MAX_BYTES), iso: B64(CHECK_IMAGE_MAX_BYTES) }),
  loop: z.number().int().min(0).max(2),
});
export const PreviewBody = z.object({ projectId: ProjectId, designId: DesignId, png: B64(PREVIEW_MAX_BYTES) });
export const DesignRefBody = z.object({ projectId: ProjectId, designId: DesignId });
export const DesignRefQuery = DesignRefBody;
export const ExcludeArchetypes = z.array(Archetype);

/** JSON, never cached anywhere (models and private data pass through here). */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

/** updateProductDoc error → HTTP status. */
export function saveErrorStatus(error: string | undefined): number {
  if (error === "not_found" || error === "no_doc") return 404;
  if (error === "conflict" || error === "run_0068") return 409;
  return 503;
}

/** The doc's parts as layout inputs (unknown library ids skipped). */
export function partsOf(components: readonly StudioComponent[], getPart: (id: string) => LibraryPart | undefined): LayoutInput[] {
  const out: LayoutInput[] = [];
  for (const c of components) {
    const part = getPart(c.partId);
    if (part) out.push({ instanceId: c.instanceId, part });
  }
  return out;
}

/** What the designs were made for: a new spec or parts list starts a new set. */
export function productSpecHash(spec: ProductSpec, components: readonly StudioComponent[]): string {
  return stableHash({ spec, parts: components.map((c) => c.partId).sort() });
}

export function newDesignId(): string {
  return `d_${Array.from(randomBytes(10), (b) => (b % 36).toString(36)).join("")}`;
}

/** base64 / data URL → PNG bytes, or null when it isn't a PNG of an allowed size. */
export function decodePng(b64: string, maxBytes: number): Buffer | null {
  const s = b64.replace(/^data:image\/png;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  if (buf.length < 24 || buf.length > maxBytes) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => buf[i] === b) ? buf : null;
}

/** The PNG as plain base64 (what Gemini's inlineData takes). */
export const pngBase64 = (buf: Buffer) => buf.toString("base64");

// ---------------------------------------------------------------------------
// Guest limit
// ---------------------------------------------------------------------------

/** Qatar calendar day (UTC+3, no DST) as YYYY-MM-DD. */
export function qatarDay(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

export type LimitStore = {
  hits(keys: string[], day: string): Promise<number[]>;
  bump(keys: string[], day: string): Promise<void>;
};

/** ai_rate_limits (0042) through the service client; null when the key isn't configured. */
export function serviceLimitStore(): LimitStore | null {
  const svc = createServiceClient();
  if (!svc) return null;
  return {
    async hits(keys, day) {
      const { data, error } = await svc.from("ai_rate_limits").select("key, hits").in("key", keys).eq("day", day);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { key: string; hits: number }[];
      return keys.map((k) => Number(rows.find((r) => r.key === k)?.hits) || 0);
    },
    async bump(keys, day) {
      const now = await this.hits(keys, day);
      const rows = keys.map((key, i) => ({ key, day, hits: now[i] + 1 }));
      const { error } = await svc.from("ai_rate_limits").upsert(rows, { onConflict: "key,day" });
      if (error) throw new Error(error.message);
    },
  };
}

export type GuestLimit = { allowed: boolean; used: number; limit: number };

/**
 * One design build for a guest: refused at GUEST_DESIGNS_PER_DAY per guest
 * session or per hashed IP, else counted. Signed-in users are not limited here.
 * Unknown store (no service key / table missing) → allowed, with a warning
 * (same as bom_rate_check before 0042).
 */
export async function guestDesignLimit(request: Request, userId: string, store: LimitStore | null, now = Date.now()): Promise<GuestLimit> {
  const limit = GUEST_DESIGNS_PER_DAY;
  if (!store) {
    console.warn("[studio/product] guest limit not counted (no service key)");
    return { allowed: true, used: 0, limit };
  }
  const ip = ipHash(request);
  const keys = [`studio:u:${userId}`, ...(ip ? [`studio:ip:${ip.slice(0, 64)}`] : [])];
  const day = qatarDay(now);
  try {
    const used = Math.max(0, ...(await store.hits(keys, day)));
    if (used >= limit) return { allowed: false, used, limit };
    await store.bump(keys, day);
    return { allowed: true, used: used + 1, limit };
  } catch (e) {
    console.warn("[studio/product] guest limit unavailable:", e instanceof Error ? e.message : e);
    return { allowed: true, used: 0, limit };
  }
}

// ---------------------------------------------------------------------------
// Roles + preview storage
// ---------------------------------------------------------------------------

export async function isSuperAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data as { role?: string } | null)?.role === "super_admin";
}

export const previewPathFor = (projectId: string, designId: string) => `${PREVIEW_PREFIX}/${projectId}/${designId}.png`;

/** A stored preview path is one of ours (never sign an arbitrary object). */
export const isPreviewPath = (p: unknown): p is string =>
  typeof p === "string" && /^studio-previews\/[0-9a-f-]{36}\/d_[a-z0-9]{6,16}\.png$/i.test(p);

export async function uploadPreview(projectId: string, designId: string, png: Buffer): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const svc = createServiceClient();
  if (!svc) return { ok: false, error: "storage_unavailable" };
  const path = previewPathFor(projectId, designId);
  const { error } = await svc.storage.from(PREVIEW_BUCKET).upload(path, png, { contentType: "image/png", upsert: true, cacheControl: "3600" });
  if (error) {
    console.error("[studio/product] preview upload failed:", error.message);
    return { ok: false, error: "upload_failed" };
  }
  return { ok: true, path };
}
