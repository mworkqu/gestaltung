"use client";

import { onceUntilFailure } from "@/lib/dedupe";

import type { createClient } from "./client";

// Lazy access to the browser Supabase client for components that render on
// every page (header, auth/cart providers, credit badge, home strips). A static
// `import { createClient } from "./client"` puts the whole supabase-js bundle
// (auth, realtime, storage, postgrest) into the first-load JS of every route;
// a dynamic import() moves it to its own chunk, fetched once on first use.
// Pages that need the client right away can keep importing ./client directly.

const loadClientModule = onceUntilFailure(() => import("./client"));

/**
 * The browser Supabase client, loaded on first call. Same instance as
 * createClient() (createBrowserClient is a singleton in the browser).
 */
export async function loadSupabase(): Promise<ReturnType<typeof createClient>> {
  return (await loadClientModule()).createClient();
}
