// Server-only: read the parts rows a supplier sync may change, before and
// after its writes, so lib/cache/catalog-tags.ts can tell which storefront
// tags to purge. Read-only; the caller passes the service client it already has.

import type { SupabaseClient } from "@supabase/supabase-js";

import { PART_SNAPSHOT_COLUMNS, type PartSnapshot } from "@/lib/cache/catalog-tags";

const CHUNK = 200;

/** These parts plus the products they are a backup for (one level). */
export async function snapshotParts(db: SupabaseClient, ids: readonly string[]): Promise<PartSnapshot[]> {
  const rows = await readParts(db, [...new Set(ids)]);
  const have = new Set(rows.map((r) => r.id));
  const mains = [...new Set(rows.map((r) => r.backup_for).filter((m): m is string => !!m && !have.has(m)))];
  return mains.length ? [...rows, ...(await readParts(db, mains))] : rows;
}

async function readParts(db: SupabaseClient, ids: string[]): Promise<PartSnapshot[]> {
  const out: PartSnapshot[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await db.from("parts").select(PART_SNAPSHOT_COLUMNS).in("id", ids.slice(i, i + CHUNK));
    out.push(...((data ?? []) as unknown as PartSnapshot[]));
  }
  return out;
}
