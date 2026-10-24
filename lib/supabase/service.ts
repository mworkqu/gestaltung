import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let warnedMissingServiceKey = false;

// One warning per server instance (module evaluation + the flag), so a missing
// key shows up in the logs at cold start instead of only as 503s. Never logs
// the key itself. Skipped during `next build`, where runtime env is often absent.
export function warnIfServiceKeyMissing() {
  if (warnedMissingServiceKey || typeof window !== "undefined") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  warnedMissingServiceKey = true;
  console.warn(
    "[supabase] SUPABASE_SERVICE_ROLE_KEY is not set: server-only API routes that need it will answer 503. " +
      "Set it in the Vercel project environment variables for Production, Preview and Development.",
  );
}

warnIfServiceKeyMissing();

// Service-role Supabase client. Bypasses RLS — server-only, never import this
// into a Client Component. Used sparingly for actions a public (anon) request
// legitimately can't do under RLS, e.g. minting a short-lived signed download
// URL for a quote-upload so we can email it to the owner. Returns null when the
// service key isn't configured so callers can degrade gracefully.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) warnIfServiceKeyMissing();
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
