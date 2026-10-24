// Videos & YouTube (D6): server-side helpers around the `integrations` table
// (migration 0072) and Google's token endpoint. SERVER ONLY: reads secrets from
// env and uses the service-role client. Never import into a Client Component.
//
// Env (server-only unless noted):
//   NEXT_PUBLIC_GOOGLE_CLIENT_ID   the existing Web OAuth client (Drive picker); reused
//   GOOGLE_OAUTH_CLIENT_ID         optional override when a separate client is used
//   GOOGLE_OAUTH_CLIENT_SECRET     that client's secret
//   INTEGRATIONS_ENC_KEY           32 random bytes, base64 (AES-256-GCM + state HMAC)
//   SUPABASE_SERVICE_ROLE_KEY      already set (only service_role reads integrations)

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { decryptSecret, parseEncKey } from "@/lib/integrations/crypto";
import {
  addQuota,
  GOOGLE_TOKEN_URL,
  parseYoutubeMeta,
  YT_INTEGRATION,
  type YoutubeMeta,
} from "@/lib/youtube-upload";
import { isMissingRelation } from "@/lib/supabase/errors";

export type YoutubeConfig = { clientId: string; clientSecret: string; key: Buffer };

/** The OAuth config, or the names of the env vars still missing. */
export function youtubeConfig(): { ok: true; cfg: YoutubeConfig } | { ok: false; missing: string[] } {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
  const key = parseEncKey(process.env.INTEGRATIONS_ENC_KEY);
  const missing: string[] = [];
  if (!clientId) missing.push("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!key) missing.push("INTEGRATIONS_ENC_KEY");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length || !key) return { ok: false, missing };
  return { ok: true, cfg: { clientId, clientSecret, key } };
}

export type IntegrationRow = {
  provider: string;
  refresh_token_enc: string | null;
  scopes: string | null;
  account_label: string | null;
  metadata: unknown;
  connected_at: string | null;
};

export type ReadResult =
  | { state: "no_service" }
  | { state: "no_table" }
  | { state: "error"; message: string }
  | { state: "ok"; db: SupabaseClient; row: IntegrationRow | null; meta: YoutubeMeta };

const isMissingTable = (code: string | undefined, message: string | undefined) =>
  isMissingRelation({ code }) ||
  (/integrations/.test(message ?? "") && /does not exist|schema cache/.test(message ?? ""));

/** Read the youtube row with the service client. Missing 0072 = "no_table". */
export async function readYoutubeIntegration(): Promise<ReadResult> {
  const db = createServiceClient();
  if (!db) return { state: "no_service" };
  const { data, error } = await db
    .from("integrations")
    .select("provider, refresh_token_enc, scopes, account_label, metadata, connected_at")
    .eq("provider", YT_INTEGRATION)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.code, error.message)) return { state: "no_table" };
    return { state: "error", message: error.message };
  }
  const row = (data as IntegrationRow | null) ?? null;
  return { state: "ok", db, row, meta: parseYoutubeMeta(row?.metadata) };
}

/** Upsert the youtube row's metadata (and any other columns given). */
export async function saveYoutubeRow(
  db: SupabaseClient,
  meta: YoutubeMeta,
  extra: Partial<Omit<IntegrationRow, "provider" | "metadata">> & { connected_by?: string | null } = {},
): Promise<string | null> {
  const { error } = await db
    .from("integrations")
    .upsert({ provider: YT_INTEGRATION, metadata: meta, ...extra }, { onConflict: "provider" });
  return error ? error.message : null;
}

/**
 * Read-modify-write of the youtube row's metadata against the LATEST stored
 * value, not a copy taken minutes earlier: uploads run for a minute or more,
 * and two at once used to overwrite each other's quota and upload records
 * (2026-10-16: five videos uploaded, one recorded). `fallback` is used only
 * when the row can't be read.
 */
export async function updateYoutubeMeta(
  db: SupabaseClient,
  fallback: YoutubeMeta,
  change: (meta: YoutubeMeta) => YoutubeMeta,
): Promise<YoutubeMeta> {
  const { data, error } = await db.from("integrations").select("metadata").eq("provider", YT_INTEGRATION).maybeSingle();
  const next = change(error || !data ? fallback : parseYoutubeMeta((data as { metadata: unknown }).metadata));
  const err = await saveYoutubeRow(db, next);
  if (err) console.error("[youtube] metadata save failed:", err);
  return next;
}

/** Count `units` of YouTube API quota against today (Pacific day). Best-effort. */
export async function recordQuota(db: SupabaseClient, meta: YoutubeMeta, units: number): Promise<YoutubeMeta> {
  return updateYoutubeMeta(db, meta, (m) => ({ ...m, quota: addQuota(m.quota, units, new Date()) }));
}

export class TokenRevokedError extends Error {
  constructor() {
    super("token_revoked");
  }
}

/** A fresh access token from the stored (encrypted) refresh token. */
export async function accessTokenFor(row: IntegrationRow | null, cfg: YoutubeConfig): Promise<string> {
  const refresh = decryptSecret(row?.refresh_token_enc, cfg.key);
  if (!refresh) throw new TokenRevokedError();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    // invalid_grant = revoked, expired (Testing-mode apps: 7 days) or password changed.
    if (json.error === "invalid_grant") throw new TokenRevokedError();
    throw new Error(`token_${res.status}_${json.error ?? "unknown"}`);
  }
  return json.access_token;
}
