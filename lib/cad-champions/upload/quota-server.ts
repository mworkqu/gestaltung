// Per-student storage quota check (SR-M7) — SERVER ONLY (service role).
//
// Called by the upload record actions AFTER the file reached Storage and
// passed its own checks. When the student's stored total is over the quota
// the just-uploaded object is removed (so it does not keep counting) and the
// action returns its "over_quota" reason, which the UI shows in both
// languages. Before migration 0087 runs (no cc_storage_used_bytes) or when
// the check itself fails, uploads are allowed: the quota is a cost brake,
// never a reason to lose a student's work.

import { createServiceClient } from "@/lib/supabase/service";

import { isOverQuota } from "./quota";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/upload/quota-server.ts is server-only");

export type QuotaCheck = { ok: true } | { ok: false; reason: "over_quota" };

export async function enforceStorageQuota(userId: string, bucket: string, justUploadedPath: string): Promise<QuotaCheck> {
  const service = createServiceClient();
  if (!service) return { ok: true };
  try {
    const { data, error } = await service.rpc("cc_storage_used_bytes", { p_user: userId });
    if (error) {
      if (error.code !== "PGRST202" && error.code !== "42883") console.error("[cc-upload] quota check failed:", error.code ?? error.message);
      return { ok: true };
    }
    if (!isOverQuota(Number(data ?? 0))) return { ok: true };
    console.warn("[cc-upload] storage quota reached");
    const { error: rmError } = await service.storage.from(bucket).remove([justUploadedPath]);
    if (rmError) console.error("[cc-upload] over-quota cleanup failed:", rmError.message);
    return { ok: false, reason: "over_quota" };
  } catch (e) {
    console.error("[cc-upload] quota check failed:", e instanceof Error ? e.message : "unknown");
    return { ok: true };
  }
}
