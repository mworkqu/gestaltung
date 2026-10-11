import { NextResponse, type NextRequest } from "next/server";

import { getAuthUser, getSessionContext } from "@/lib/auth/get-session";
import { encryptSecret, verifyState } from "@/lib/integrations/crypto";
import { readYoutubeIntegration, saveYoutubeRow, youtubeConfig } from "@/lib/integrations/youtube-server";
import { addQuota, GOOGLE_TOKEN_URL, hasAllScopes, redirectUriFor, STATE_COOKIE, YT_COST } from "@/lib/youtube-upload";

// D6: Google redirects here after the consent screen. super_admin only. Checks
// the signed state against the httpOnly cookie, swaps the code for tokens,
// requires a refresh token + both scopes, reads the channel (channels.list
// mine=true, 1 unit) and stores the refresh token AES-256-GCM encrypted in
// public.integrations with the service client. Never logs or returns a token.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cookie = request.cookies.get(STATE_COOKIE)?.value ?? null;
  const c = youtubeConfig();
  const st = c.ok ? verifyState(params.get("state"), cookie, c.cfg.key) : null;
  const locale = st?.l ?? "en";

  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/${locale}/dashboard/store/youtube?${q}`, request.nextUrl.origin), 303);
    res.headers.set("Cache-Control", "private, no-store");
    res.cookies.set(STATE_COOKIE, "", { path: "/api/admin/youtube", maxAge: 0 });
    return res;
  };
  const fail = (reason: string) => back(`yt=error&reason=${reason}`);

  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  if (!c.ok) return fail("setup");
  if (!st) return fail("state");
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "denied" : "google");
  const code = params.get("code");
  if (!code) return fail("google");

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.cfg.clientId,
        client_secret: c.cfg.clientSecret,
        redirect_uri: redirectUriFor(request.nextUrl.origin),
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const tok = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tok.access_token) {
      console.error("[youtube] code exchange failed:", tokenRes.status, tok.error ?? "");
      return fail("google");
    }
    if (!hasAllScopes(tok.scope)) return fail("scopes");
    if (!tok.refresh_token) return fail("no_refresh");

    const chRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const ch = (await chRes.json().catch(() => ({}))) as { items?: { id?: string; snippet?: { title?: string } }[] };
    const channel = chRes.ok ? ch.items?.[0] : undefined;

    const read = await readYoutubeIntegration();
    if (read.state === "no_table") return fail("migration");
    if (read.state !== "ok") return fail("db");

    const meta = { ...read.meta, quota: addQuota(read.meta.quota, YT_COST.channel, new Date()) };
    if (!channel?.id) {
      await saveYoutubeRow(read.db, meta);
      return fail("no_channel");
    }
    meta.channel_id = channel.id;
    meta.channel_title = (channel.snippet?.title ?? "").slice(0, 200);

    const user = await getAuthUser();
    const err = await saveYoutubeRow(read.db, meta, {
      refresh_token_enc: encryptSecret(tok.refresh_token, c.cfg.key),
      scopes: tok.scope ?? null,
      account_label: meta.channel_title || null,
      connected_at: new Date().toISOString(),
      connected_by: user?.id ?? null,
    });
    if (err) {
      console.error("[youtube] save failed:", err);
      return fail("db");
    }
    return back("yt=connected");
  } catch (e) {
    console.error("[youtube] callback failed:", e instanceof Error ? e.message : "unknown");
    return fail("google");
  }
}
