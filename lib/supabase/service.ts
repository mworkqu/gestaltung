import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client. Bypasses RLS — server-only, never import this
// into a Client Component. Used sparingly for actions a public (anon) request
// legitimately can't do under RLS, e.g. minting a short-lived signed download
// URL for a quote-upload so we can email it to the owner. Returns null when the
// service key isn't configured so callers can degrade gracefully.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
