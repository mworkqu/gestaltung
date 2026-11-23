import type { User } from "@supabase/supabase-js";

import { jsonError } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

// Bearer-token auth for non-browser clients (the iOS dashboard app).
//
// WHY a second door exists at all: every guard in lib/auth/guards.ts reads the
// session from cookies via next/headers, which an installed app cannot send.
// So the app signs in to Supabase itself with the PUBLIC anon key — the only
// key that may ever ship inside an app binary — and sends the access token it
// gets back here.
//
// The token is verified server-side by asking Supabase who it belongs to; it is
// never decoded locally and trusted, never logged, and never stored. The role
// then comes from `profiles`, exactly as the cookie guards read it, so there is
// one definition of "admin" and not two. Nothing secret of ours reaches the app.

export type BearerAuth = { ok: true; user: User } | { ok: false; response: Response };

/** `Bearer <token>` → the token, or null when the header is absent or not a bearer header. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  const scheme = parts[0];
  if (!scheme || scheme.toLowerCase() !== "bearer" || parts.length !== 2) return null;
  const token = parts[1]!;
  return token.length > 0 ? token : null;
}

/**
 * The super_admin behind `Authorization: Bearer <supabase access token>`, or the
 * Response to answer with. A missing header, an expired token and a guest
 * session all answer 401 `{ error: "sign_in" }`; a real but non-admin account
 * gets 403 `{ error: "forbidden" }`, so the app can tell "log in again" from
 * "this account is not allowed".
 */
export async function requireSuperAdminBearer(request: Request): Promise<BearerAuth> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return { ok: false, response: jsonError("sign_in", 401) };

  const service = createServiceClient();
  if (!service) return { ok: false, response: jsonError("unavailable", 503) };

  const { data, error } = await service.auth.getUser(token);
  const user = error ? null : data.user;
  // An anonymous guest token is a valid session, but never an admin.
  if (!user || user.is_anonymous) return { ok: false, response: jsonError("sign_in", 401) };

  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") return { ok: false, response: jsonError("forbidden", 403) };

  return { ok: true, user };
}
