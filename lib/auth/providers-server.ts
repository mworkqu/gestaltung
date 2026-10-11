// Which social sign-in buttons to show (server side, cached).
//
// GET {NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings with the public anon key,
// no cookies, no headers() — so a static page that calls this stays static.
// Cached 5 minutes under the "auth-providers" tag: after the owner turns a
// provider on in Supabase, the button appears within 5 minutes (or at once
// after revalidateTag("auth-providers") / a redeploy). Any error = no buttons
// (the email form still works), and an error is not cached.

import { unstable_cache } from "next/cache";

import { parseEnabledProviders, type OAuthProvider } from "./providers";

export const AUTH_PROVIDERS_TAG = "auth-providers";
const TIMEOUT_MS = 4_000;

const readProviders = unstable_cache(
  async (): Promise<OAuthProvider[]> => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return [];
    const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Throw (not return []) so a failed read is not cached for 5 minutes.
    if (!res.ok) throw new Error(`auth settings ${res.status}`);
    return parseEnabledProviders(await res.json());
  },
  ["auth-providers"],
  { revalidate: 300, tags: [AUTH_PROVIDERS_TAG] }
);

/** The enabled providers in button order; [] when none or on any error. */
export async function getEnabledProviders(): Promise<OAuthProvider[]> {
  try {
    return await readProviders();
  } catch {
    return [];
  }
}
