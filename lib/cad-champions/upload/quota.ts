// Per-student storage quota (SECURITY_REVIEW.md SR-M7). PURE, tested.
//
// Every file a student uploads to cc-submissions (test files, package ZIPs,
// Get Ready practice files, exercise files, question screenshots) counts
// against one quota. Migration 0087 enforces the same numbers in the Storage
// insert policy (public.cc_storage_upload_allowed), so direct uploads through
// the Storage API stop at the quota too. Keep both in step: a test reads the
// migration and checks it.

/** 2 GiB per student in cc-submissions. */
export const CC_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** New objects per student per 24 hours, across cc-submissions and cc-payment-proofs. */
export const CC_UPLOADS_PER_DAY = 200;

/** True when the stored total (which already includes the file just uploaded) is over the quota. */
export function isOverQuota(usedBytes: number, quotaBytes: number = CC_STORAGE_QUOTA_BYTES): boolean {
  if (!Number.isFinite(usedBytes) || usedBytes < 0) return false;
  return usedBytes > quotaBytes;
}
