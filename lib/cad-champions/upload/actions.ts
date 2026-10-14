"use server";

// Server action mirror of the UploadBox validation. Checks auth, that the
// object sits in the caller's own folder, then re-reads size + header.

import { getCcUser } from "../auth/server";
import { isStudentUploadBucket, verifyUploadedObject, type VerifyResult } from "./server";
import { DEFAULT_MAX_BYTES, UPLOAD_ACCEPTS, isPathUnderPrefix, type UploadAccept } from "./validate";

export async function checkUploadAction(input: {
  bucket: string;
  path: string;
  accept: UploadAccept;
  maxBytes?: number;
}): Promise<VerifyResult | { ok: false; code: "signed_out" | "forbidden" }> {
  const cc = await getCcUser();
  if (!cc) return { ok: false, code: "signed_out" };
  if (!isStudentUploadBucket(input?.bucket) || !UPLOAD_ACCEPTS.includes(input.accept)) return { ok: false, code: "forbidden" };
  if (!isPathUnderPrefix(input.path, `${cc.user.id}/`)) return { ok: false, code: "forbidden" };
  const max = typeof input.maxBytes === "number" && input.maxBytes > 0 ? Math.min(input.maxBytes, DEFAULT_MAX_BYTES * 6) : DEFAULT_MAX_BYTES;
  return verifyUploadedObject(input.bucket, input.path, input.accept, max);
}
