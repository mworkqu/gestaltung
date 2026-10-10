// Test-only routes under app/[locale]/e2e-fixtures/* render a component in
// isolation for the Playwright smoke suite (which runs read-only, without
// sign-in, against the PRODUCTION Supabase). They are reachable ONLY when
//   E2E_FIXTURES=1 is set on the server (playwright.config.ts sets it for its
//   own `npm run start`), AND
//   the server is not on Vercel (VERCEL unset) and not a Vercel production
//   deployment (VERCEL_ENV !== "production").
// `next start` runs with NODE_ENV=production, so NODE_ENV cannot be the gate;
// the Vercel variables are, and E2E_FIXTURES is never set in Vercel.
// Everything else gets notFound().

export function e2eFixturesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.E2E_FIXTURES === "1" && !env.VERCEL && env.VERCEL_ENV !== "production";
}
