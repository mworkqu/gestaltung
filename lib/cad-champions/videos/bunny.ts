// Bunny Stream signed embed URLs (Prompt 9 Step D) — SERVER ONLY.
//
// Env (server-only, never NEXT_PUBLIC):
//   BUNNY_LIBRARY_ID   Stream library id (number shown in the Bunny dashboard)
//   BUNNY_TOKEN_KEY    the library's "Token Authentication Key"
//                      (Stream > library > Security > Embed view token authentication)
//   BUNNY_CDN_HOST     optional embed host, default iframe.mediadelivery.net
//
// Scheme implemented [TODO-MO: verify against Bunny docs before launch]:
//   expires = unix seconds now + 2 hours
//   token   = hex( SHA256( BUNNY_TOKEN_KEY + videoId + expires ) )
//   url     = https://<host>/embed/<libraryId>/<videoId>?token=<token>&expires=<expires>
// The token key never leaves the server; the browser only gets the URL.
// Without the env vars Bunny is "not configured" and lessons show the
// "video coming soon" panel.

import { createHash } from "node:crypto";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/videos/bunny.ts is server-only");

export const BUNNY_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_HOST = "iframe.mediadelivery.net";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST = /^[a-z0-9.-]{3,253}$/i;

export interface BunnyConfig {
  libraryId: string;
  tokenKey: string;
  host: string;
}

export function bunnyConfig(env: Record<string, string | undefined> = process.env): BunnyConfig | null {
  const libraryId = (env.BUNNY_LIBRARY_ID ?? "").trim();
  const tokenKey = (env.BUNNY_TOKEN_KEY ?? "").trim();
  const hostRaw = (env.BUNNY_CDN_HOST ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!/^\d{1,12}$/.test(libraryId) || !tokenKey) return null;
  return { libraryId, tokenKey, host: hostRaw && HOST.test(hostRaw) ? hostRaw : DEFAULT_HOST };
}

export function isBunnyVideoId(id: string): boolean {
  return GUID.test(id);
}

/** The token for one video and expiry (exported for the test). */
export function bunnyToken(tokenKey: string, videoId: string, expires: number): string {
  return createHash("sha256").update(`${tokenKey}${videoId}${expires}`).digest("hex");
}

export interface SignedEmbed {
  url: string;
  /** Unix seconds. */
  expires: number;
}

/** Signed embed URL valid for 2 hours, or null (not configured / bad id). */
export function signBunnyEmbed(videoId: string, opts: { now?: number; config?: BunnyConfig | null } = {}): SignedEmbed | null {
  const config = opts.config === undefined ? bunnyConfig() : opts.config;
  if (!config || !isBunnyVideoId(videoId)) return null;
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const expires = nowSec + BUNNY_TTL_SECONDS;
  const token = bunnyToken(config.tokenKey, videoId, expires);
  const params = new URLSearchParams({ token, expires: String(expires), autoplay: "false", preload: "true", responsive: "true" });
  return { url: `https://${config.host}/embed/${config.libraryId}/${videoId}?${params.toString()}`, expires };
}
