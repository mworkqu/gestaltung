// Social sign-in (Google, Apple, Microsoft), 2026-10-11.
//
// Pure helpers only (no Next / React / Supabase imports) so they are unit
// tested and usable from the server page, the client buttons and the
// /api/auth/callback route alike. The cached network read lives in
// lib/auth/providers-server.ts.
//
// A button is shown ONLY when Supabase says that provider is enabled
// (GET /auth/v1/settings → external.google / apple / azure). Nothing enabled
// = no buttons, no divider: the forms look exactly as before.

/** Supabase provider ids, in the order the buttons are shown. "azure" = Microsoft. */
export const OAUTH_PROVIDERS = ["google", "apple", "azure"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** The brand name a person reads on the button and in the error line. */
export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
  azure: "Microsoft",
};

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The enabled social providers from the body of GET /auth/v1/settings.
 * Anything unexpected (not an object, no `external`, non-true flags) = not enabled.
 */
export function parseEnabledProviders(settings: unknown): OAuthProvider[] {
  if (!settings || typeof settings !== "object") return [];
  const external = (settings as { external?: unknown }).external;
  if (!external || typeof external !== "object") return [];
  const flags = external as Record<string, unknown>;
  return OAUTH_PROVIDERS.filter((p) => flags[p] === true);
}

/** Extra OAuth scopes per provider. Microsoft needs "email" or Supabase gets no address. */
export function oauthScopes(provider: OAuthProvider): string | undefined {
  return provider === "azure" ? "email" : undefined;
}

/**
 * Where the provider sends the visitor back to:
 *   {origin}/api/auth/callback?next=<encoded locale path>&provider=<id>[&link=1]
 * `next` must already be a safe "/{locale}/…" path (lib/auth/next-path.ts).
 * link=1 marks a guest's linkIdentity attempt, so the callback can fall back
 * to a plain sign-in when that account already exists.
 */
export function oauthCallbackUrl(
  origin: string,
  next: string,
  provider: OAuthProvider,
  opts: { link?: boolean } = {}
): string {
  const params = new URLSearchParams({ next, provider });
  if (opts.link) params.set("link", "1");
  return `${origin.replace(/\/+$/, "")}/api/auth/callback?${params.toString()}`;
}

/**
 * True when a linkIdentity callback failed because the provider account is
 * already someone's login (or its email is): the guest should then simply
 * sign in to that account, and their work is moved over by the callback.
 */
export function isLinkConflict(errorCode: string | null | undefined, description?: string | null): boolean {
  const code = (errorCode ?? "").toLowerCase();
  if (code === "identity_already_exists" || code === "email_exists" || code === "user_already_exists") return true;
  return /already (been )?(linked|exists|registered)/i.test(description ?? "");
}

/** The ?oauth_error=<provider> value on the sign-in page, validated, or null. */
export function oauthErrorProvider(raw: unknown): OAuthProvider | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isOAuthProvider(value) ? value : null;
}
