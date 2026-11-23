/**
 * Who is calling the MCP server (chat plugin Phase 4a).
 *
 * Supabase Auth is the authorization server: it serves /authorize, /token,
 * RFC 8414 discovery and the JWKS, and it registers Claude / ChatGPT itself
 * (dynamic client registration). Our MCP endpoint is only the RESOURCE server,
 * so all it has to do is decide whether an access token it was handed may act
 * for a user — which is what this module does. Pure: no network, no Supabase
 * client, so every rule below is unit-tested on plain claims.
 *
 * Signing in is never required: everything from Phases 1-3 keeps working with
 * no account at all. A token only ever ADDS what an account allows.
 */

/** Our own scope names. Supabase documents only openid/email/profile/phone, so see scopesFromClaims(). */
export const PLUGIN_SCOPES = {
  project: "project:write",
  cart: "cart:write",
  meetings: "meetings:write",
} as const;

export type PluginScope = (typeof PLUGIN_SCOPES)[keyof typeof PLUGIN_SCOPES];

export const ALL_PLUGIN_SCOPES: readonly PluginScope[] = Object.values(PLUGIN_SCOPES);

/** RFC 9728: where a client finds out which authorization server protects us. */
export const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** The RFC 8707 resource identifier of this MCP server. */
export const mcpResourceUrl = (siteUrl: string) => `${trimSlash(siteUrl)}/api/mcp`;

/** Supabase keeps its issuer on the project host even behind our own domain. */
export const supabaseIssuer = (supabaseUrl: string) => `${trimSlash(supabaseUrl)}/auth/v1`;

/** The claims we read. Supabase adds plenty more; none of them matter here. */
export type TokenClaims = {
  sub?: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  scope?: unknown;
  client_id?: unknown;
  is_anonymous?: unknown;
  email?: unknown;
  [key: string]: unknown;
};

export type TokenRefusal =
  | "no_subject"
  | "wrong_issuer"
  | "not_oauth"
  | "guest"
  | "wrong_audience"
  | "expired";

export type TokenCheck =
  | { ok: true; userId: string; clientId: string; scopes: PluginScope[]; email: string | null; expiresAt?: number }
  | { ok: false; reason: TokenRefusal };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * Which of our scopes a token carries.
 *
 * Supabase's own documented scopes are openid / email / profile / phone, and it
 * is not documented whether a custom scope survives to the access token. So:
 * a token that names any of OUR scopes is taken at its word (least privilege),
 * and a token that names none of them gets all three — because in that case the
 * person's consent was per CLIENT, not per scope, and that is exactly what the
 * consent page tells them. The moment custom scopes do come through, the first
 * branch takes over with no code change.
 */
export function scopesFromClaims(claims: TokenClaims): PluginScope[] {
  const raw = str(claims.scope);
  const named = raw ? ALL_PLUGIN_SCOPES.filter((s) => raw.split(/\s+/).includes(s)) : [];
  return named.length ? named : [...ALL_PLUGIN_SCOPES];
}

/**
 * Does this token's audience allow it to be used HERE?
 *
 * The spec is explicit that a resource server must refuse a token that was not
 * issued for it. Supabase's access tokens carry the fixed `aud: "authenticated"`
 * unless a Custom Access Token Hook sets something else, and RFC 8707 resource
 * indicators are not documented, so there are two cases:
 *
 *  - `aud` names a URL (a hook is in place): it MUST be our resource URI.
 *  - `aud` is Supabase's default, or absent: no audience to check, so the
 *    `client_id` claim is what we rely on instead — see checkTokenClaims.
 */
export function audienceAllowed(aud: unknown, resource: string): boolean {
  const list = (Array.isArray(aud) ? aud : [aud]).map(str).filter((v): v is string => v !== null);
  const urls = list.filter((v) => v.startsWith("http://") || v.startsWith("https://"));
  if (!urls.length) return true;
  return urls.some((v) => trimSlash(v) === trimSlash(resource));
}

/**
 * The gate. Every refusal is a 401 with a WWW-Authenticate challenge, which is
 * how a host knows to start (or redo) the OAuth flow.
 */
export function checkTokenClaims(claims: TokenClaims, opts: { issuer: string; resource: string; now: Date }): TokenCheck {
  const userId = str(claims.sub);
  if (!userId) return { ok: false, reason: "no_subject" };

  const iss = str(claims.iss);
  if (!iss || trimSlash(iss) !== trimSlash(opts.issuer)) return { ok: false, reason: "wrong_issuer" };

  const exp = typeof claims.exp === "number" ? claims.exp : null;
  if (exp !== null && exp * 1000 <= opts.now.getTime()) return { ok: false, reason: "expired" };

  if (claims.is_anonymous === true) return { ok: false, reason: "guest" };

  // The audience substitute, and the reason a stolen website cookie is useless
  // here: a token issued by an ordinary sign-in on our own site has no
  // client_id, so it can never act through the chat.
  const clientId = str(claims.client_id);
  if (!clientId) return { ok: false, reason: "not_oauth" };

  if (!audienceAllowed(claims.aud, opts.resource)) return { ok: false, reason: "wrong_audience" };

  return {
    ok: true,
    userId,
    clientId,
    scopes: scopesFromClaims(claims),
    email: str(claims.email),
    ...(exp !== null ? { expiresAt: exp } : {}),
  };
}

/** The signed-in person on a request the gate let through. */
export type PluginUser = { userId: string; email: string | null; token: string; scopes: readonly string[] };

/**
 * Reads the user out of the verified token info the transport hands a tool.
 * Structural on purpose: the only thing that may create one of these is
 * verifyPluginToken, so a tool cannot invent an identity.
 */
export function pluginUserFrom(
  auth: { token: string; scopes?: readonly string[]; extra?: Record<string, unknown> } | undefined,
): PluginUser | null {
  const userId = typeof auth?.extra?.userId === "string" ? auth.extra.userId : null;
  if (!auth || !userId) return null;
  const email = typeof auth.extra?.email === "string" ? auth.extra.email : null;
  return { userId, email, token: auth.token, scopes: auth.scopes ?? [] };
}

/** Does this token allow the tool that needs `scope`? */
export const hasScope = (user: PluginUser | null, scope: PluginScope): boolean => !!user && user.scopes.includes(scope);
