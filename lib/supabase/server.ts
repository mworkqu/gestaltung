import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Server-side Supabase client, bound to the request's cookie jar. Use this in
// Server Components, Route Handlers, and Server Actions. The anon key is used
// here too — Row Level Security (not the key) is what isolates tenants.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // `setAll` was called from a Server Component, where cookies are
            // read-only. Safe to ignore: the middleware refreshes the session
            // and writes the rotated cookies on every request.
          }
        },
      },
    }
  );
}
