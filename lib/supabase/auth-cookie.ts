/**
 * Does the request carry a Supabase auth cookie (`sb-<ref>-auth-token`, also
 * chunked as `.0`, `.1`, … and the PKCE `-code-verifier`)? Without one there is
 * no session to refresh, so the middleware skips Supabase entirely.
 */
export function hasSupabaseAuthCookie(names: readonly string[]): boolean {
  return names.some((n) => n.startsWith("sb-") && n.includes("-auth-token"));
}
