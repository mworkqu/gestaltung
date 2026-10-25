import { createBrowserClient } from "@supabase/ssr";

import { supabaseCookieOptions } from "./cookie-options";
import { requireSupabaseEnv } from "./env";

// Browser-side Supabase client. Reads only the public (NEXT_PUBLIC_*) env vars,
// so nothing secret ever reaches the browser. Used by the auth forms.
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient(url, anonKey, { cookieOptions: supabaseCookieOptions() });
}
