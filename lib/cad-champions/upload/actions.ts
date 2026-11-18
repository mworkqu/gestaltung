"use server";

// Server action mirror of the UploadBox validation. Checks auth, that the
// object sits in the caller's own folder, then re-reads size + header.

import { getCcUser } from "../auth/server";
import { ccRateLimited } from "../rate-limits";
import { isStudentUploadBucket, verifyUploadedObject, type VerifyResult } from "./server";
import { CC_BUCKET_LIMITS } from "../db/types";
import { DEFAULT_MAX_BYTES, UPLOAD_ACCEPTS, isPathUnderPrefix, type UploadAccept } from "./validate";

export async function checkUploadAction(input: {
  bucket: string;
  path: string;
  accept: UploadAccept;
  maxBytes?: number;
}): Promise<VerifyResult | { ok: false; code: "signed_out" | "forbidden" }> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, code: "signed_out" };
  if (ccRateLimited("upload", cc.user.id)) return { ok: false, code: "forbidden" };
  if (!isStudentUploadBucket(input?.bucket) || !UPLOAD_ACCEPTS.includes(input.accept)) return { ok: false, code: "forbidden" };
  if (!isPathUnderPrefix(input.path, `${cc.user.id}/`)) return { ok: false, code: "forbidden" };
  // The client may ask for a smaller limit, never a bigger one than the bucket's
  // own (CC_BUCKET_LIMITS mirrors storage.buckets.file_size_limit).
  // module_package ZIPs in cc-submissions may be up to 300 MB (0080).
  const bucketMax =
    input.accept === "zip" && input.bucket === "cc-submissions"
      ? DEFAULT_MAX_BYTES * 6
      : (CC_BUCKET_LIMITS[input.bucket as keyof typeof CC_BUCKET_LIMITS] ?? DEFAULT_MAX_BYTES);
  const max = typeof input.maxBytes === "number" && input.maxBytes > 0 ? Math.min(input.maxBytes, bucketMax) : Math.min(DEFAULT_MAX_BYTES, bucketMax);
  return verifyUploadedObject(input.bucket, input.path, input.accept, max);
}
