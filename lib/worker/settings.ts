// The worker switch: store_settings.worker = {"enabled": true|false}. Pure.
//
// A MISSING row, a malformed value or anything but enabled === true means
// DISABLED: every cron runs in Vercel exactly as before, and the worker's own
// schedules skip their runs (so a job never runs on both sides). Migration
// 0111 seeds {"enabled": false}.

import type { SupabaseClient } from "@supabase/supabase-js";

export const WORKER_SETTINGS_KEY = "worker";
/** WORKER_SECRET shorter than this is treated as unset, everywhere. */
export const MIN_WORKER_SECRET_LENGTH = 32;

export type WorkerSettings = { enabled: boolean };

export function parseWorkerSettings(value: unknown): WorkerSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { enabled: false };
  return { enabled: (value as Record<string, unknown>).enabled === true };
}

/** Uncached read with any client that may read the row (service role). Errors = disabled. */
export async function readWorkerSettings(db: SupabaseClient | null): Promise<WorkerSettings> {
  if (!db) return { enabled: false };
  try {
    const { data, error } = await db.from("store_settings").select("value").eq("key", WORKER_SETTINGS_KEY).maybeSingle();
    if (error) return { enabled: false };
    return parseWorkerSettings(data?.value);
  } catch {
    return { enabled: false };
  }
}
