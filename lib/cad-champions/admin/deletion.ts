// Account deletion requests (Prompt 11 Step F) — PURE: ordering, validation
// and the storage folder walk (injectable lister, so it is testable). The
// database + storage calls are deletion-server.ts.
//
// Policy (see 0085 header): approving anonymises the profile (RPC
// cc_anonymise_profile) and deletes the student's stored files in
// cc-submissions and cc-payment-proofs. Anonymised scores stay for statistics.
// Gap: the auth.users row is NOT deleted. [TODO-MO: retention policy]

export const DELETION_BUCKETS = ["cc-submissions", "cc-payment-proofs"] as const;
export type DeletionBucket = (typeof DELETION_BUCKETS)[number];

export const NOTE_MAX = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function cleanNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n/g, "\n").trim().slice(0, NOTE_MAX);
  return t || null;
}

export interface DeletionRow {
  id: string;
  userId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  processedAt: string | null;
}

/** Pending first (oldest first: longest wait on top), then processed (newest first). */
export function sortDeletionRequests<T extends Pick<DeletionRow, "status" | "createdAt" | "processedAt" | "id">>(rows: readonly T[]): T[] {
  const t = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  return [...rows].sort((a, b) => {
    const ap = a.status === "pending";
    const bp = b.status === "pending";
    if (ap !== bp) return ap ? -1 : 1;
    if (ap) return t(a.createdAt) - t(b.createdAt) || a.id.localeCompare(b.id);
    return t(b.processedAt ?? b.createdAt) - t(a.processedAt ?? a.createdAt) || a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------- storage walk

export interface StorageEntry {
  name: string;
  /** Supabase marks a folder with a null id. */
  id: string | null;
}

/** One page of a folder listing: list(prefix, offset, limit). Returns null on error. */
export type StorageLister = (prefix: string, offset: number, limit: number) => Promise<StorageEntry[] | null>;

export interface CollectResult {
  paths: string[];
  /** Hit maxFiles / maxDepth, or a listing failed: run again to continue. */
  incomplete: boolean;
}

/**
 * Every file path under `root` (a user id folder), paging each folder.
 * Never leaves the root: a name with "/" or ".." is ignored.
 */
export async function collectStoragePaths(list: StorageLister, root: string, opts: { pageSize?: number; maxFiles?: number; maxDepth?: number } = {}): Promise<CollectResult> {
  const pageSize = opts.pageSize ?? 100;
  const maxFiles = opts.maxFiles ?? 5000;
  const maxDepth = opts.maxDepth ?? 8;
  const paths: string[] = [];
  let incomplete = false;
  const walk = async (prefix: string, depth: number): Promise<void> => {
    for (let offset = 0; ; offset += pageSize) {
      if (paths.length >= maxFiles) {
        incomplete = true;
        return;
      }
      const page = await list(prefix, offset, pageSize);
      if (page == null) {
        incomplete = true;
        return;
      }
      for (const e of page) {
        if (!e.name || e.name.includes("/") || e.name === "." || e.name === "..") continue;
        const full = `${prefix}/${e.name}`;
        if (e.id == null) {
          if (depth >= maxDepth) incomplete = true;
          else await walk(full, depth + 1);
        } else if (paths.length < maxFiles) paths.push(full);
        else incomplete = true;
      }
      if (page.length < pageSize) return;
    }
  };
  await walk(root, 0);
  return { paths, incomplete };
}

export function removeChunks(paths: readonly string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < paths.length; i += size) out.push(paths.slice(i, i + size));
  return out;
}
