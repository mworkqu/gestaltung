// File sizes for people: "812 B", "42.5 KB", "3.2 MB". Binary units (1 KB =
// 1024 B) like every file manager. Pure.
//
// Why this exists: the lead emails said "0.00 MB" for every file under 5 KB
// because they always divided down to megabytes.

/** Human size of `bytes`, or "" when it is missing, zero or not a number. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let i = 0;
  // Roll over at 1000 (not 1024) so we never print "1023.9 KB".
  while (Math.round(value) >= 1000 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${units[i]}`;
}
