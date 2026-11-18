// Should a cron route forward to the Mac Mini worker? SERVER ONLY (Next).
//
// Enabled only when ALL of these hold; anything else = disabled and the routes
// run in Vercel exactly as before:
//   - WORKER_URL is an https:// URL (http://localhost is allowed outside production),
//   - WORKER_SECRET is set (32+ characters),
//   - store_settings.worker = {"enabled": true} (migration 0111 seeds false; a
//     missing row is false).
// Without the two env vars no database read is made at all. The row is read
// with the service client through unstable_cache under the "store-settings"
// tag (any storefront settings purge refreshes it) and expires after 60 s, so
// flipping the switch by SQL takes effect within a minute.

import { unstable_cache } from "next/cache";

import { SETTINGS_TAG } from "@/lib/cache/storefront";
import { createServiceClient } from "@/lib/supabase/service";
import { MIN_WORKER_SECRET_LENGTH, readWorkerSettings, WORKER_SETTINGS_KEY } from "@/lib/worker/settings";

export type WorkerConfig = { enabled: false } | { enabled: true; url: string; secret: string };

/** Env part of the decision; pure, exported for tests. */
export function workerEnv(env: Record<string, string | undefined> = process.env): { url: string; secret: string } | null {
  const url = (env.WORKER_URL ?? "").trim().replace(/\/+$/, "");
  const secret = env.WORKER_SECRET ?? "";
  if (!url || secret.length < MIN_WORKER_SECRET_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && env.NODE_ENV !== "production")) return null;
  return { url, secret };
}

const readSwitch = unstable_cache(async () => (await readWorkerSettings(createServiceClient())).enabled, [`store-settings:${WORKER_SETTINGS_KEY}`], {
  revalidate: 60,
  tags: [SETTINGS_TAG],
});

export async function getWorkerConfig(): Promise<WorkerConfig> {
  const env = workerEnv();
  if (!env) return { enabled: false };
  let on = false;
  try {
    on = await readSwitch();
  } catch {
    on = false;
  }
  return on ? { enabled: true, ...env } : { enabled: false };
}
