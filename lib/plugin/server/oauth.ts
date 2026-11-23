/**
 * The resource-server half of Phase 4a: turning a bearer token on an MCP
 * request into a user we may act for.
 *
 * Supabase Auth is the authorization server (it serves /authorize, /token, the
 * RFC 8414 metadata and the JWKS, and registers Claude / ChatGPT itself). Here
 * we only verify. Verification is `auth.getClaims()`: with an asymmetric
 * signing key (ES256 / RS256) it checks the signature locally against the
 * cached JWKS, so an authenticated call costs no extra round trip.
 *
 * Every rule about WHICH verified token may act lives in ../oauth.ts and is
 * unit-tested there; this file is the wiring and the network.
 */
import "server-only";

import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { createClient } from "@supabase/supabase-js";

import { defaultSiteUrl } from "@/lib/email/brand-layout";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseEnv } from "@/lib/supabase/env";
import {
  checkTokenClaims,
  mcpResourceUrl,
  RESOURCE_METADATA_PATH,
  supabaseIssuer,
  type TokenClaims,
  type TokenRefusal,
} from "../oauth";

/** One client for verifying, so the JWKS cache is shared between requests. */
let verifier: ReturnType<typeof createClient<Database>> | null = null;

function verifyingClient() {
  if (verifier) return verifier;
  const env = supabaseEnv();
  if (!env) return null;
  verifier = createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return verifier;
}

/**
 * A Supabase client that acts AS the user, so RLS and auth.uid() are theirs.
 * Used for the cart RPC and for claiming a hand-off into their account — the
 * service client is never used for a signed-in action, because then ownership
 * would be ours to check instead of the database's.
 */
export function userClient(accessToken: string) {
  const env = supabaseEnv();
  if (!env) return null;
  return createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * withMcpAuth's verifier.
 *
 * Returning undefined means "nobody is signed in", which the gate allows
 * (`required: false`): the anonymous tools of Phases 1-3 keep working. It is
 * therefore only ever returned when there is NO token at all.
 *
 * A token that is present but not acceptable THROWS, which the gate turns into
 * 401 plus a WWW-Authenticate challenge naming our RFC 9728 metadata. That
 * distinction matters: silently treating a bad token as "anonymous" would hide
 * an expired or wrong-audience token behind a confusing refusal from a tool,
 * instead of telling the host to authorize again.
 */
const invalid = (why: string): never => {
  throw new OAuthError(OAuthErrorCode.InvalidToken, why);
};

export async function verifyPluginToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const token = bearerToken?.trim();
  if (!token) return undefined;

  const env = supabaseEnv();
  const supabase = verifyingClient();
  if (!supabase || !env) return invalid("This server cannot verify access tokens right now.");

  let claims: TokenClaims;
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) return invalid("The access token could not be verified.");
    claims = data.claims as TokenClaims;
  } catch (err) {
    // A JWKS fetch that fails, or a project still on the legacy HS256 secret
    // with no network: never a 500, and never a silent downgrade either.
    console.warn("[mcp] token verification failed:", err);
    return invalid("The access token could not be verified.");
  }

  const siteUrl = defaultSiteUrl();
  const resource = mcpResourceUrl(siteUrl);
  const checked = checkTokenClaims(claims, { issuer: supabaseIssuer(env.url), resource, now: new Date() });
  if (!checked.ok) {
    console.warn(`[mcp] token refused: ${checked.reason}`);
    return invalid(REFUSAL_TEXT[checked.reason]);
  }

  return {
    token,
    clientId: checked.clientId,
    scopes: checked.scopes,
    ...(checked.expiresAt !== undefined ? { expiresAt: checked.expiresAt } : {}),
    resource: new URL(resource),
    resourceMetadataUrl: `${siteUrl}${RESOURCE_METADATA_PATH}`,
    extra: { userId: checked.userId, email: checked.email },
  };
}

/** Short, non-revealing reasons. The host shows these to nobody; they go in the challenge. */
const REFUSAL_TEXT: Record<TokenRefusal, string> = {
  no_subject: "The access token names no user.",
  wrong_issuer: "The access token was not issued by this site's sign-in.",
  not_oauth: "That token was not issued for this server. Authorize the connector again.",
  guest: "A guest session cannot be used here. Sign in with an account.",
  wrong_audience: "The access token was issued for a different server.",
  expired: "The access token has expired.",
};
