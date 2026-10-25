// The one reader for the public Supabase env pair. Both values are NEXT_PUBLIC_*
// (inlined into the browser bundle at build time), so the literal
// `process.env.NEXT_PUBLIC_…` accesses below must stay literal.
//
// supabaseEnv() is for callers that degrade when Supabase is not configured
// (public catalogue, middleware); requireSupabaseEnv() is for the cookie-bound
// clients, which cannot work without it.

export type SupabaseEnv = { url: string; anonKey: string };

/** The URL and anon key, or null when either is missing or empty. */
export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Like supabaseEnv(), but throws a message that names the missing variables. */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = supabaseEnv();
  if (env) return env;
  const missing = [
    !process.env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean);
  throw new Error(`Supabase is not configured: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set.`);
}
