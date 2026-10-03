import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Anonymous, cookie-free Supabase client for public catalogue reads (the
// /store list). It never touches cookies or headers, so a page using only this
// client can later be cached / ISR'd. RLS applies as for any visitor (published
// parts are anon-readable, 0011). Null when Supabase env is missing so the
// page can degrade to an empty state instead of crashing.
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
